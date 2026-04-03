import { getDedupeKey, pathUnder } from '../core/urls.js';
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
import runBulkStatus from './bulk-status.js';
import {
  processLinkedContent,
  processStandaloneUploads,
  applyAuditChunkToMaps,
  buildEarlyLinkedPlaceholders,
  toCanonicalPath,
} from './reconcile.js';
import { toAbsoluteFilePath } from './parse.js';
import { IndexConfig } from '../core/constants.js';
import { incrementalTimeParams, initialTimeParams } from '../core/storage.js';
import isPerfEnabled from '../core/params.js';

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
  perf = null,
) {
  const pathNorm = normalizePathForFilter(path);
  let medialogScoped = medialogEntries;
  if (pathNorm) {
    medialogScoped = medialogEntries.filter(
      (m) => m.resourcePath && pathUnder(m.resourcePath, pathNorm),
    );
  } else {
    // Match DA-NX: keep referenced (resourcePath) or standalone; drop orphaned.
    medialogScoped = medialogEntries.filter(
      (m) => m.resourcePath || (m.originalFilename && !m.resourcePath),
    );
  }

  const { linkedEntries, parseStats } = await processLinkedContent(
    auditlogEntries,
    medialogScoped,
    org,
    site,
    'main',
    onProgress,
    path,
    onProgressiveData,
  );

  // Track markdown parsing stats if perf object provided
  if (perf && parseStats) {
    perf.markdownParse.pages = parseStats.pages || 0;
    perf.markdownParse.durationMs = parseStats.durationMs || 0;
    perf.markdownParse.success = parseStats.success || 0;
    perf.markdownParse.fail = parseStats.fail || 0;
    perf.markdownParse.fetchTimes = parseStats.fetchTimes || { avg: 0, min: 0, max: 0 };
  }

  const referencedHashes = new Set();
  [...medialogScoped, ...linkedEntries].forEach((e) => {
    if (e.resourcePath) {
      const k = getDedupeKey(e.path || e.mediaHash);
      if (k) referencedHashes.add(k);
    }
  });

  const standalone = processStandaloneUploads(medialogScoped, referencedHashes);
  const processedAuditlog = processAuditLog(auditlogEntries, org, site);

  // Filter out self-referencing entries from medialogScoped (they're now in standalone)
  const medialogWithoutSelfReferencing = medialogScoped.filter((m) => {
    if (!m.resourcePath) return true; // Keep unreferenced entries
    const normResourcePath = toCanonicalPath(m.resourcePath);
    const mediaFilePath = toCanonicalPath(m.path || m.mediaHash);
    return mediaFilePath !== normResourcePath; // Filter out self-referencing
  });

  // Count matched vs unmatched (self-referencing)
  const matchedCount = medialogWithoutSelfReferencing.filter((m) => m.resourcePath).length;
  const unmatchedCount = medialogScoped.length - matchedCount - standalone.length;
  if (perf) {
    perf.medialog.matched = matchedCount;
    perf.medialog.standalone = standalone.length;
    perf.medialog.unmatched = unmatchedCount;
  }

  const allMedialog = [...medialogWithoutSelfReferencing, ...standalone];
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

  if (isPerfEnabled()) {
    // eslint-disable-next-line no-console
    console.log(`[MediaLibrary:build] Final mediaData count: ${mediaData.length} (matched: ${matchedCount}, standalone: ${standalone.length}, unmatched: ${unmatchedCount})`);
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
  const buildStartTime = Date.now();

  if (isPerfEnabled()) {
    // eslint-disable-next-line no-console -- perf debug when ?debug=perf
    console.log(`[MediaLibrary:build] Starting ${buildMode} build for ${org}/${site}${path || '/'}`);
  }

  // Performance instrumentation
  const perf = {
    mode: buildMode,
    org,
    site,
    path: path || '/',
    medialog: {
      streamed: 0,
      chunks: 0,
      matched: 0,
      standalone: 0,
      unmatched: 0,
      durationMs: 0,
    },
    auditlog: {
      streamed: 0,
      chunks: 0,
      durationMs: 0,
    },
    statusAPI: {
      durationMs: 0,
      resourcesDiscovered: 0,
      pagesDiscovered: 0,
      filesDiscovered: 0,
    },
    markdownParse: {
      pages: 0,
      durationMs: 0,
      success: 0,
      fail: 0,
      fetchTimes: { avg: 0, min: 0, max: 0 },
    },
    totalDurationMs: 0,
  };

  const mediaMap = new Map();
  const pagesByPath = new Map();
  const filesByPath = new Map();
  const deletedPaths = new Set();

  let newMedialog;
  let newAuditlog;

  if (incremental) {
    const timeParams = incrementalTimeParams(metadata?.lastFetchTime);

    const medialogStart = Date.now();
    const auditlogStart = Date.now();

    const onAuditChunk = (entries) => {
      perf.auditlog.chunks += 1;
      perf.auditlog.streamed += entries.length;
      applyAuditChunkToMaps(entries, pagesByPath, filesByPath, deletedPaths);
      const earlyLinked = buildEarlyLinkedPlaceholders(filesByPath, deletedPaths, org, site);
      const fromLinked = transformToMediaData([], earlyLinked);
      if (fromLinked.length > 0) onProgressiveData(fromLinked);
    };

    const onMedialogChunk = (entries) => {
      perf.medialog.chunks += 1;
      perf.medialog.streamed += entries.length;
      mergeEntriesIntoMediaMap(entries, mediaMap);
      const fromMedialog = getMediaItemsFromMap(mediaMap);
      if (fromMedialog.length > 0) onProgressiveData(fromMedialog);
    };

    [newMedialog, newAuditlog] = await Promise.all([
      fetchAllMediaLog(org, site, timeParams, onMedialogChunk),
      fetchAllAuditLog(org, site, timeParams, onAuditChunk),
    ]);

    perf.medialog.durationMs = Date.now() - medialogStart;
    perf.auditlog.durationMs = Date.now() - auditlogStart;
  } else {
    const timeParams = initialTimeParams();

    const medialogStart = Date.now();

    const onMedialogChunk = (entries) => {
      perf.medialog.chunks += 1;
      perf.medialog.streamed += entries.length;
      mergeEntriesIntoMediaMap(entries, mediaMap);
      const fromMedialog = getMediaItemsFromMap(mediaMap);
      if (fromMedialog.length > 0) onProgressiveData(fromMedialog);
    };

    const pathNorm = path ? (path.trim().replace(/\/+$/, '') || '').replace(/^(?!\/)/, '/') : '';
    const contentPathForStatus = pathNorm || null;

    let statusPromise = null;
    if (preValidatedStatusResources != null) {
      statusPromise = typeof preValidatedStatusResources.then === 'function'
        ? preValidatedStatusResources
        : Promise.resolve(preValidatedStatusResources);
    }

    let statusResources;
    let medialogResult;
    const statusStart = Date.now();

    if (isPerfEnabled()) {
      // eslint-disable-next-line no-console -- perf debug when ?debug=perf
      console.log('[MediaLibrary:build] Fetching status API and medialog in parallel...');
    }

    try {
      if (statusPromise) {
        [statusResources, medialogResult] = await Promise.all([
          statusPromise,
          fetchAllMediaLog(org, site, timeParams, onMedialogChunk),
        ]);
      } else {
        const progressCallback = (p) => {
          const msg = p.message || `Status: ${p.progress?.processed ?? 0}/${p.progress?.total ?? 0}...`;
          onProgress({ stage: p.stage || 'fetching', message: msg });
        };
        [statusResources, medialogResult] = await Promise.all([
          runBulkStatus(org, site, 'main', contentPathForStatus, {
            onProgress: progressCallback,
            pollInterval: IndexConfig.STATUS_POLL_INTERVAL_MS,
            maxDurationMs: IndexConfig.STATUS_POLL_MAX_DURATION_MS,
          }).then(({ resources: r }) => r),
          fetchAllMediaLog(org, site, timeParams, onMedialogChunk),
        ]);
      }

      if (isPerfEnabled()) {
        // eslint-disable-next-line no-console -- perf debug when ?debug=perf
        console.log(`[MediaLibrary:build] Status API returned ${statusResources.length} resources`);
        // eslint-disable-next-line no-console -- perf debug when ?debug=perf
        console.log(`[MediaLibrary:build] Medialog returned ${medialogResult.length} entries`);
      }
    } catch (error) {
      if (isPerfEnabled()) {
        // eslint-disable-next-line no-console -- perf debug: log fetch error when ?debug=perf
        console.error('[MediaLibrary:build] Error during fetch:', error);
      }
      throw error;
    }

    perf.statusAPI.durationMs = Date.now() - statusStart;
    perf.statusAPI.resourcesDiscovered = statusResources.length;
    perf.medialog.durationMs = Date.now() - medialogStart;

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

  // Track pages and files from status/audit
  perf.statusAPI.pagesDiscovered = [...pagesByPath.keys()].length;
  perf.statusAPI.filesDiscovered = [...filesByPath.keys()].length;

  const mediaData = await buildMediaDataFromEntries(
    newMedialog,
    newAuditlog,
    org,
    site,
    onProgress,
    onProgressiveData,
    path,
    perf, // Pass perf object for markdown parse tracking
  );

  perf.totalDurationMs = Date.now() - buildStartTime;
  perf.collectedAt = new Date().toISOString();

  // Log performance metrics only when debug=perf is enabled
  if (isPerfEnabled()) {
    // eslint-disable-next-line no-console -- perf debug when ?debug=perf
    console.log('[MediaLibrary:build] Build completed successfully');
    // eslint-disable-next-line no-console -- perf debug when ?debug=perf
    console.log('[MediaLibrary:perf]', JSON.stringify(perf, null, 2));
  }

  return { mediaData, buildMode, perf };
}
