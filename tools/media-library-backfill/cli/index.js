#!/usr/bin/env node
/* eslint-disable no-console */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import zlib from 'node:zlib';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const INDEX_FILE = '.index';
const MAX_OBJECT_SIZE = 512 * 1024;

function printUsage() {
  console.log(`
Usage:
  node tools/media-library-backfill/cli/index.js \\
    --bundle /path/to/medialog-import-bundle.json \\
    --bucket <bucket-name> \\
    --content-bus-id <folder/prefix> [--dry-run] [--output-dir /path]

Options:
  --bundle            Path to the exported medialog import bundle JSON.
  --bucket            Required. Target S3 bucket name.
  --content-bus-id    Required. Target folder/prefix within the bucket.
  --region            Optional AWS region override.
  --output-dir        Optional output directory for generated artifacts and reports.
  --dry-run           Build artifacts and reports locally, but do not upload to S3.
  --help              Show this help.

Behavior:
  - If no existing .index is present, imports all valid entries.
  - If an existing .index is present, only prepends imported entries strictly older than the
    earliest existing medialog entry.
  - Entries at or after that existing boundary are treated as already recorded and skipped.
  - Entries with validation or packaging issues are written to unmerged-errors.json.
`);
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePrefix(value) {
  return normalizeString(value).replace(/^\/+|\/+$/g, '');
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    region: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--bundle':
        args.bundle = argv[i + 1];
        i += 1;
        break;
      case '--bucket':
        args.bucket = argv[i + 1];
        i += 1;
        break;
      case '--content-bus-id':
        args.contentBusId = argv[i + 1];
        i += 1;
        break;
      case '--region':
        args.region = argv[i + 1];
        i += 1;
        break;
      case '--output-dir':
        args.outputDir = argv[i + 1];
        i += 1;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        if (arg.startsWith('--')) {
          throw new Error(`Unknown option: ${arg}`);
        }
        break;
    }
  }

  args.bundle = normalizeString(args.bundle);
  args.bucket = normalizeString(args.bucket);
  args.contentBusId = normalizePrefix(args.contentBusId);
  args.region = normalizeString(args.region);
  args.outputDir = normalizeString(args.outputDir);

  return args;
}

function normalizeTimestampMs(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : NaN;
  }
  if (typeof value === 'string' && value) {
    const ts = Date.parse(value);
    return Number.isNaN(ts) ? NaN : ts;
  }
  return NaN;
}

function formatTimestamp(timestamp) {
  return new Date(timestamp).toISOString().substring(0, 19).replace(/[T:]/g, '-');
}

function createTimestampRange(entries) {
  if (!entries.length) {
    return { first: null, last: null };
  }
  return {
    first: new Date(entries[0].timestamp).toISOString(),
    last: new Date(entries[entries.length - 1].timestamp).toISOString(),
  };
}

function compareEntries(a, b) {
  const tsDiff = a.timestamp - b.timestamp;
  if (tsDiff !== 0) return tsDiff;
  const operationDiff = (a.operation || '').localeCompare(b.operation || '');
  if (operationDiff !== 0) return operationDiff;
  const pathDiff = (a.path || '').localeCompare(b.path || '');
  if (pathDiff !== 0) return pathDiff;
  const resourcePathDiff = (a.resourcePath || '').localeCompare(b.resourcePath || '');
  if (resourcePathDiff !== 0) return resourcePathDiff;
  const contentTypeDiff = (a.contentType || '').localeCompare(b.contentType || '');
  if (contentTypeDiff !== 0) return contentTypeDiff;
  const userDiff = (a.user || '').localeCompare(b.user || '');
  if (userDiff !== 0) return userDiff;
  return (a.sourceOrder || 0) - (b.sourceOrder || 0);
}

function validateEntry(entry, index) {
  if (!entry || typeof entry !== 'object') {
    return {
      valid: false,
      error: {
        index,
        reason: 'entry must be an object',
        entry,
      },
    };
  }

  const errors = [];
  const timestamp = normalizeTimestampMs(entry.timestamp);

  if (!Number.isFinite(timestamp)) {
    errors.push('invalid timestamp');
  }
  if (!entry.operation || typeof entry.operation !== 'string') {
    errors.push('missing operation');
  }
  if (!entry.path || typeof entry.path !== 'string') {
    errors.push('missing path');
  }
  if (!entry.resourcePath || typeof entry.resourcePath !== 'string') {
    errors.push('missing resourcePath');
  }
  if (!entry.contentType || typeof entry.contentType !== 'string') {
    errors.push('missing contentType');
  }

  if (errors.length) {
    return {
      valid: false,
      error: {
        index,
        reason: errors.join(', '),
        entry,
      },
    };
  }

  return {
    valid: true,
    entry: {
      ...entry,
      timestamp,
      sourceOrder: index,
    },
  };
}

async function streamToBuffer(stream) {
  if (typeof stream?.transformToByteArray === 'function') {
    const bytes = await stream.transformToByteArray();
    return Buffer.from(bytes);
  }

  const chunks = [];
  // eslint-disable-next-line no-restricted-syntax
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function getObjectText(s3, bucket, key) {
  try {
    const result = await s3.send(new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }));
    const buffer = await streamToBuffer(result.Body);
    return buffer.toString('utf8');
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NoSuchKey') {
      return null;
    }
    throw err;
  }
}

async function getObjectEntries(s3, bucket, key) {
  try {
    const result = await s3.send(new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }));
    const gzBuffer = await streamToBuffer(result.Body);
    return JSON.parse(zlib.gunzipSync(gzBuffer).toString('utf8'));
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NoSuchKey') {
      return null;
    }
    throw err;
  }
}

async function readExistingIndex(s3, bucket, prefix) {
  const rawIndex = await getObjectText(s3, bucket, `${prefix}/${INDEX_FILE}`);
  if (!rawIndex) {
    return {
      rawIndex: '',
      files: [],
    };
  }

  return {
    rawIndex,
    files: rawIndex.split('\n').map((line) => line.trim()).filter(Boolean),
  };
}

async function getEarliestExistingState(s3, bucket, prefix, existingFiles) {
  async function inspectFile(index) {
    if (index >= existingFiles.length) {
      return {
        basename: '',
        firstTimestamp: null,
      };
    }

    const basename = existingFiles[index];
    const key = `${prefix}/${basename}.gz`;
    const entries = await getObjectEntries(s3, bucket, key);
    if (!Array.isArray(entries) || entries.length === 0) {
      return inspectFile(index + 1);
    }

    const firstTimestamp = normalizeTimestampMs(entries[0].timestamp);
    if (!Number.isFinite(firstTimestamp)) {
      return inspectFile(index + 1);
    }

    return {
      basename,
      firstTimestamp,
    };
  }

  return inspectFile(0);
}

function gzipEntries(entries) {
  const gzipBuffer = zlib.gzipSync(JSON.stringify(entries));
  return { gzipBuffer };
}

function createChunkBasename(entries, chunkIndex) {
  const hash = crypto
    .createHash('sha1')
    .update(JSON.stringify(entries))
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
  return `${formatTimestamp(entries[0].timestamp)}-${String(chunkIndex).padStart(6, '0')}-${hash}`;
}

function buildArtifacts(entries) {
  const artifacts = [];
  const packagingErrors = [];
  let currentChunk = [];
  let chunkIndex = 0;

  const flushCurrentChunk = () => {
    if (!currentChunk.length) {
      return;
    }

    const { gzipBuffer } = gzipEntries(currentChunk);
    const basename = createChunkBasename(currentChunk, chunkIndex);
    artifacts.push({
      basename,
      entries: currentChunk,
      gzipBuffer,
      firstTimestamp: currentChunk[0].timestamp,
      lastTimestamp: currentChunk[currentChunk.length - 1].timestamp,
    });
    chunkIndex += 1;
    currentChunk = [];
  };

  entries.forEach((entry) => {
    const standalone = gzipEntries([entry]);
    if (standalone.gzipBuffer.length > MAX_OBJECT_SIZE) {
      packagingErrors.push({
        reason: `single entry exceeds medialog object size limit (${standalone.gzipBuffer.length} bytes gzip)`,
        entry,
      });
      return;
    }

    const candidateChunk = [...currentChunk, entry];
    const candidate = gzipEntries(candidateChunk);
    if (candidate.gzipBuffer.length > MAX_OBJECT_SIZE && currentChunk.length > 0) {
      flushCurrentChunk();
      currentChunk = [entry];
      return;
    }

    currentChunk = candidateChunk;
  });

  flushCurrentChunk();

  return { artifacts, packagingErrors };
}

function createSummary({
  args,
  bundle,
  outputDir,
  existingState,
  mergeableEntries,
  alreadyRecordedEntries,
  validationErrors,
  packagingErrors,
  artifacts,
  uploaded,
}) {
  const unmergedErrors = [...validationErrors, ...packagingErrors];

  return {
    generatedAt: new Date().toISOString(),
    bundlePath: args.bundle,
    target: {
      bucket: args.bucket,
      prefix: args.contentBusId,
    },
    dryRun: args.dryRun,
    bundleSummary: bundle.summary || {},
    existingMedialog: {
      hasIndex: existingState.files.length > 0,
      fileCount: existingState.files.length,
      earliestExistingTimestamp: existingState.earliestTimestamp
        ? new Date(existingState.earliestTimestamp).toISOString()
        : null,
      earliestExistingBasename: existingState.earliestBasename || null,
    },
    importPlan: {
      validEntryCount: mergeableEntries.length + alreadyRecordedEntries.length,
      mergeableCount: mergeableEntries.length,
      alreadyRecordedSkippedCount: alreadyRecordedEntries.length,
      alreadyRecordedRange: createTimestampRange(alreadyRecordedEntries),
      unmergedErrorCount: unmergedErrors.length,
    },
    output: {
      directory: outputDir,
      uploaded,
      files: artifacts.map((artifact) => ({
        basename: artifact.basename,
        entryCount: artifact.entries.length,
        gzipBytes: artifact.gzipBuffer.length,
        firstTimestamp: new Date(artifact.firstTimestamp).toISOString(),
        lastTimestamp: new Date(artifact.lastTimestamp).toISOString(),
      })),
    },
  };
}

function writeJson(filepath, value) {
  fs.writeFileSync(filepath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeLocalArtifacts({
  outputDir,
  artifacts,
  newIndexContents,
  existingIndex,
  summary,
  unmergedErrors,
}) {
  fs.mkdirSync(outputDir, { recursive: true });

  artifacts.forEach((artifact) => {
    fs.writeFileSync(path.join(outputDir, `${artifact.basename}.gz`), artifact.gzipBuffer);
  });

  if (newIndexContents) {
    fs.writeFileSync(path.join(outputDir, INDEX_FILE), `${newIndexContents}\n`, 'utf8');
  }

  if (existingIndex) {
    fs.writeFileSync(path.join(outputDir, 'existing-index.txt'), existingIndex, 'utf8');
  }

  writeJson(path.join(outputDir, 'import-summary.json'), summary);

  if (unmergedErrors.length) {
    writeJson(path.join(outputDir, 'unmerged-errors.json'), unmergedErrors);
  }
}

async function uploadArtifacts({
  s3,
  bucket,
  prefix,
  artifacts,
  newIndexContents,
}) {
  await artifacts.reduce(
    (promise, artifact) => promise.then(() => s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: `${prefix}/${artifact.basename}.gz`,
      Body: artifact.gzipBuffer,
      ContentType: 'application/json',
      ContentEncoding: 'gzip',
      Metadata: {
        'last-event-time': formatTimestamp(artifact.lastTimestamp),
      },
    }))),
    Promise.resolve(),
  );

  if (newIndexContents) {
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: `${prefix}/${INDEX_FILE}`,
      Body: newIndexContents,
      ContentType: 'text/plain',
    }));
  }
}

function printSummary(summary, artifacts) {
  console.log(`Bucket: ${summary.target.bucket}`);
  console.log(`Target prefix (contentBusId): ${summary.target.prefix}`);
  console.log(
    `Earliest existing medialog timestamp: ${
      summary.existingMedialog.earliestExistingTimestamp || 'none'
    }`,
  );
  console.log(`Mergeable entries: ${summary.importPlan.mergeableCount}`);
  console.log(`Already recorded/skipped: ${summary.importPlan.alreadyRecordedSkippedCount}`);
  if (
    summary.importPlan.alreadyRecordedRange.first
    || summary.importPlan.alreadyRecordedRange.last
  ) {
    console.log(
      `Already recorded range: ${summary.importPlan.alreadyRecordedRange.first || 'n/a'} -> `
        + `${summary.importPlan.alreadyRecordedRange.last || 'n/a'}`,
    );
  }
  console.log(`True unmerged errors: ${summary.importPlan.unmergedErrorCount}`);
  console.log(`Output directory: ${summary.output.directory}`);
  console.log(`Artifacts generated: ${artifacts.length}`);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    printUsage();
    process.exit(1);
  }

  if (args.help) {
    printUsage();
    return;
  }

  if (!args.bundle) {
    console.error('Missing required --bundle');
    printUsage();
    process.exit(1);
  }

  if (!args.bucket) {
    console.error('Missing required --bucket');
    process.exit(1);
  }

  if (!args.contentBusId) {
    console.error('Missing required --content-bus-id');
    process.exit(1);
  }

  const bundlePath = path.resolve(args.bundle);
  const outputDir = path.resolve(
    args.outputDir
      || path.join(
        path.dirname(bundlePath),
        `${path.basename(bundlePath, path.extname(bundlePath))}-artifacts`,
      ),
  );

  const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  if (!Array.isArray(bundle.entries)) {
    throw new Error('Bundle does not contain an entries array');
  }

  const validationErrors = [];
  const validEntries = [];
  bundle.entries.forEach((entry, index) => {
    const validated = validateEntry(entry, index);
    if (!validated.valid) {
      validationErrors.push(validated.error);
      return;
    }
    validEntries.push(validated.entry);
  });
  validEntries.sort(compareEntries);

  const s3 = new S3Client(args.region ? { region: args.region } : {});
  const existingIndex = await readExistingIndex(s3, args.bucket, args.contentBusId);
  const earliestExistingState = await getEarliestExistingState(
    s3,
    args.bucket,
    args.contentBusId,
    existingIndex.files,
  );

  if (existingIndex.files.length > 0 && !Number.isFinite(earliestExistingState.firstTimestamp)) {
    throw new Error(
      `Existing medialog index found at ${args.bucket}/${args.contentBusId}, `
      + 'but the earliest existing timestamp could not be determined safely.',
    );
  }

  const existingBoundary = earliestExistingState.firstTimestamp;
  const mergeableEntries = [];
  const alreadyRecordedEntries = [];

  validEntries.forEach((entry) => {
    if (Number.isFinite(existingBoundary) && entry.timestamp >= existingBoundary) {
      alreadyRecordedEntries.push(entry);
      return;
    }
    mergeableEntries.push(entry);
  });

  const { artifacts, packagingErrors } = buildArtifacts(mergeableEntries);
  const importableEntries = artifacts.flatMap((artifact) => artifact.entries);
  const newBasenames = artifacts.map((artifact) => artifact.basename);
  const newIndexContents = [...newBasenames, ...existingIndex.files].join('\n');

  const summary = createSummary({
    args: { ...args, bundle: bundlePath },
    bundle,
    outputDir,
    existingState: {
      files: existingIndex.files,
      earliestTimestamp: earliestExistingState.firstTimestamp,
      earliestBasename: earliestExistingState.basename,
    },
    mergeableEntries: importableEntries,
    alreadyRecordedEntries,
    validationErrors,
    packagingErrors,
    artifacts,
    uploaded: !args.dryRun && artifacts.length > 0,
  });

  const unmergedErrors = [...validationErrors, ...packagingErrors];
  writeLocalArtifacts({
    outputDir,
    artifacts,
    newIndexContents,
    existingIndex: existingIndex.rawIndex,
    summary,
    unmergedErrors,
  });

  printSummary(summary, artifacts);

  if (args.dryRun) {
    console.log('Dry run enabled. No S3 writes performed.');
    process.exit(unmergedErrors.length ? 2 : 0);
  }

  if (!artifacts.length) {
    console.log('No mergeable entries remain after applying the existing-history boundary. No upload performed.');
    process.exit(unmergedErrors.length ? 2 : 0);
  }

  await uploadArtifacts({
    s3,
    bucket: args.bucket,
    prefix: args.contentBusId,
    artifacts,
    newIndexContents,
  });

  console.log('Upload complete.');
  process.exit(unmergedErrors.length ? 2 : 0);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
