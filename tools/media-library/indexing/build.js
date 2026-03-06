import { toCanonicalMediaKey, pathUnder } from '../core/urls.js';
import { MediaLibraryError, ErrorCodes, logMediaLibraryError } from '../core/errors.js';
import t from '../core/messages.js';
import {
  fetchAllMediaLog,
  transformToMediaData,
  mergeEntriesIntoMediaMap,
  getMediaItemsFromMap,
} from './medialog-api.js';
import { fetchAllAuditLog, processAuditLog } from './auditlog-api.js';
import {
  createBulkStatusJob,
  pollStatusJob,
  getStatusJobDetails,
} from './status-api.js';
import {
  processLinkedContent,
  processStandaloneUploads,
  applyAuditChunkToMaps,
  buildEarlyLinkedPlaceholders,
} from './reconcile.js';
import { toAbsoluteFilePath } from './parse.js';
import { IndexConfig } from '../core/constants.js';
import { incrementalTimeParams, initialTimeParams } from '../core/storage.js';

const PROGRESSIVE_DISPLAY_CAP = 3000;

function normalizePathForFilter(p) {
  if (!p || typeof p !== 'string') return '';
  const trimmed = p.trim().replace(/\/+$/, '');
  if (!trimmed || trimmed === '/') return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export async function buildMediaDataFromEntries(
  medialogEntries,
  auditlogEntries,
  org,
  site,
  onProgress = null,
  onProgressiveData = null,
  path = '',
) {
  const pathNorm = normalizePathForFilter(path);
  let medialogScoped = medialogEntries;
  if (pathNorm) {
    medialogScoped = medialogEntries.filter(
      (m) => m.resourcePath && pathUnder(m.resourcePath, pathNorm),
    );
  }

  const { linkedEntries } = await processLinkedContent(
    auditlogEntries,
    medialogScoped,
    org,
    site,
    'main',
    onProgress,
    path,
  );

  const referencedHashes = new Set();
  [...medialogScoped, ...linkedEntries].forEach((e) => {
    if (e.resourcePath) {
      const k = toCanonicalMediaKey(e.path || e.mediaHash);
      if (k) referencedHashes.add(k);
    }
  });

  const standalone = processStandaloneUploads(medialogScoped, referencedHashes);
  const processedAuditlog = processAuditLog(auditlogEntries, org, site);
  const allMedialog = [...medialogScoped, ...standalone];
  const allAudit = [...processedAuditlog, ...linkedEntries];
  let mediaData = transformToMediaData(allMedialog, allAudit);

  if (pathNorm) {
    mediaData = mediaData.filter((item) => {
      const sources = item.uniqueSources || [];
      return sources.some((doc) => pathUnder(doc, pathNorm));
    });
  }

  if (onProgressiveData && mediaData.length > 0) {
    const toEmit = mediaData.length > PROGRESSIVE_DISPLAY_CAP
      ? mediaData.slice(0, PROGRESSIVE_DISPLAY_CAP)
      : mediaData;
    onProgressiveData(toEmit);
  }

  return mediaData;
}

/**
 * Validates path exists via status API. Throws if path has no resources.
 * Returns { statusResources, filteredResources }.
 */
export async function validatePathWithStatus(org, site, path, onProgress = () => {}) {
  onProgress({ stage: 'fetching', message: 'Validating path...' });
  const { jobUrl } = await createBulkStatusJob(org, site, 'main');
  onProgress({ stage: 'fetching', message: 'Checking path...' });
  await pollStatusJob(
    jobUrl,
    IndexConfig.STATUS_POLL_INTERVAL_MS,
    (progress) => {
      const msg = `Status: ${progress?.processed ?? 0}/${progress?.total ?? 0}...`;
      onProgress({ stage: 'fetching', message: msg });
    },
    IndexConfig.STATUS_POLL_MAX_DURATION_MS,
  );
  const statusResources = await getStatusJobDetails(jobUrl);
  const filteredResources = path
    ? statusResources.filter((r) => pathUnder(r.path, path))
    : statusResources;

  if (path && filteredResources.length === 0) {
    const displayPath = path.trim() || '/';
    logMediaLibraryError(ErrorCodes.VALIDATION_PATH_NOT_FOUND, { path: displayPath });
    throw new MediaLibraryError(
      ErrorCodes.VALIDATION_PATH_NOT_FOUND,
      t('VALIDATION_PATH_NOT_FOUND', { path: displayPath }),
      { path: displayPath },
    );
  }

  return { statusResources, filteredResources };
}

export async function fetchAndBuildMediaData(org, site, options = {}) {
  const {
    incremental,
    metadata,
    onProgress = () => {},
    onProgressiveData = () => {},
    path = '',
    statusResources: preValidatedStatusResources = null,
  } = options;

  const buildMode = incremental ? 'incremental' : 'full';
  const mediaMap = new Map();
  const pagesByPath = new Map();
  const filesByPath = new Map();
  const deletedPaths = new Set();

  let newMedialog;
  let newAuditlog;

  if (incremental) {
    const timeParams = incrementalTimeParams(metadata?.lastFetchTime);

    const onAuditChunk = (entries) => {
      applyAuditChunkToMaps(entries, pagesByPath, filesByPath, deletedPaths);
      const earlyLinked = buildEarlyLinkedPlaceholders(filesByPath, deletedPaths, org, site);
      const fromLinked = transformToMediaData([], earlyLinked);
      if (fromLinked.length > 0) onProgressiveData(fromLinked);
    };

    const onMedialogChunk = (entries) => {
      mergeEntriesIntoMediaMap(entries, mediaMap);
      const fromMedialog = getMediaItemsFromMap(mediaMap);
      if (fromMedialog.length > 0) onProgressiveData(fromMedialog);
    };

    [newMedialog, newAuditlog] = await Promise.all([
      fetchAllMediaLog(org, site, timeParams, onMedialogChunk),
      fetchAllAuditLog(org, site, timeParams, onAuditChunk),
    ]);
  } else {
    const timeParams = initialTimeParams();

    const onMedialogChunk = (entries) => {
      mergeEntriesIntoMediaMap(entries, mediaMap);
      const fromMedialog = getMediaItemsFromMap(mediaMap);
      if (fromMedialog.length > 0) onProgressiveData(fromMedialog);
    };

    const runStatusJob = async () => {
      onProgress({ stage: 'fetching', message: 'Creating status job...' });
      const { jobUrl } = await createBulkStatusJob(org, site, 'main');
      onProgress({ stage: 'fetching', message: 'Polling status job for site discovery...' });
      await pollStatusJob(
        jobUrl,
        IndexConfig.STATUS_POLL_INTERVAL_MS,
        (progress) => {
          const msg = `Status: ${progress?.processed ?? 0}/${progress?.total ?? 0}...`;
          onProgress({ stage: 'fetching', message: msg });
        },
        IndexConfig.STATUS_POLL_MAX_DURATION_MS,
      );
      return getStatusJobDetails(jobUrl);
    };

    let statusPromise = null;
    if (preValidatedStatusResources != null) {
      statusPromise = typeof preValidatedStatusResources.then === 'function'
        ? preValidatedStatusResources
        : Promise.resolve(preValidatedStatusResources);
    }

    let statusResources;
    let medialogResult;
    if (statusPromise) {
      [statusResources, medialogResult] = await Promise.all([
        statusPromise,
        fetchAllMediaLog(org, site, timeParams, onMedialogChunk),
      ]);
    } else {
      [statusResources, medialogResult] = await Promise.all([
        runStatusJob(),
        fetchAllMediaLog(org, site, timeParams, onMedialogChunk),
      ]);
    }

    const filteredResources = path
      ? statusResources.filter((r) => pathUnder(r.path, path))
      : statusResources;

    if (path && filteredResources.length === 0) {
      const displayPath = path.trim() || '/';
      logMediaLibraryError(ErrorCodes.VALIDATION_PATH_NOT_FOUND, { path: displayPath });
      throw new MediaLibraryError(
        ErrorCodes.VALIDATION_PATH_NOT_FOUND,
        t('VALIDATION_PATH_NOT_FOUND', { path: displayPath }),
        { path: displayPath },
      );
    }

    const syntheticAudit = filteredResources.map((r) => {
      const entryPath = toAbsoluteFilePath(r.path);
      return {
        path: entryPath,
        route: 'preview',
        method: 'UPDATE',
        timestamp: Date.now(),
      };
    });

    applyAuditChunkToMaps(syntheticAudit, pagesByPath, filesByPath, deletedPaths);
    const earlyLinked = buildEarlyLinkedPlaceholders(filesByPath, deletedPaths, org, site);
    const fromLinked = transformToMediaData([], earlyLinked);
    if (fromLinked.length > 0) onProgressiveData(fromLinked);

    newMedialog = medialogResult;
    newAuditlog = syntheticAudit;
  }

  const mediaData = await buildMediaDataFromEntries(
    newMedialog,
    newAuditlog,
    org,
    site,
    onProgress,
    onProgressiveData,
    path,
  );

  return { mediaData, buildMode };
}
