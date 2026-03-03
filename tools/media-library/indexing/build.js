import { toCanonicalMediaKey } from '../core/urls.js';
import { fetchAllMediaLog, transformToMediaData, mergeEntriesIntoMediaMap } from './medialog-api.js';
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
import { DEFAULT_FULL_SINCE, getIncrementalTimeBounds } from '../core/storage.js';

const PROGRESSIVE_DISPLAY_CAP = 3000;

export async function buildMediaDataFromEntries(
  medialogEntries,
  auditlogEntries,
  org,
  site,
  onProgress = null,
  onProgressiveData = null,
) {
  const { linkedEntries } = await processLinkedContent(
    auditlogEntries,
    medialogEntries,
    org,
    site,
    'main',
    onProgress,
  );

  const referencedHashes = new Set();
  [...medialogEntries, ...linkedEntries].forEach((e) => {
    if (e.resourcePath) {
      const k = toCanonicalMediaKey(e.path || e.mediaHash);
      if (k) referencedHashes.add(k);
    }
  });

  const standalone = processStandaloneUploads(medialogEntries, referencedHashes);
  const processedAuditlog = processAuditLog(auditlogEntries, org, site);
  const allMedialog = [...medialogEntries, ...standalone];
  const allAudit = [...processedAuditlog, ...linkedEntries];
  const mediaData = transformToMediaData(allMedialog, allAudit);

  if (onProgressiveData && mediaData.length > 0) {
    const toEmit = mediaData.length > PROGRESSIVE_DISPLAY_CAP
      ? mediaData.slice(0, PROGRESSIVE_DISPLAY_CAP)
      : mediaData;
    onProgressiveData(toEmit);
  }

  return mediaData;
}

export async function fetchAndBuildMediaData(org, site, options = {}) {
  const {
    incremental,
    metadata,
    onProgress = () => {},
    onProgressiveData = () => {},
  } = options;

  const buildMode = incremental ? 'incremental' : 'full';
  const mediaMap = new Map();
  const pagesByPath = new Map();
  const filesByPath = new Map();
  const deletedPaths = new Set();

  let newMedialog;
  let newAuditlog;

  if (incremental) {
    const timeParams = getIncrementalTimeBounds(metadata?.lastFetchTime);

    const onAuditChunk = (entries) => {
      applyAuditChunkToMaps(entries, pagesByPath, filesByPath, deletedPaths);
      const earlyLinked = buildEarlyLinkedPlaceholders(filesByPath, deletedPaths, org, site);
      const fromLinked = transformToMediaData([], earlyLinked);
      if (fromLinked.length > 0) onProgressiveData(fromLinked);
    };

    const onMedialogChunk = (entries) => {
      mergeEntriesIntoMediaMap(entries, mediaMap);
      const fromMedialog = mergeEntriesIntoMediaMap([], mediaMap);
      if (fromMedialog.length > 0) onProgressiveData(fromMedialog);
    };

    [newMedialog, newAuditlog] = await Promise.all([
      fetchAllMediaLog(org, site, timeParams, onMedialogChunk),
      fetchAllAuditLog(org, site, timeParams, onAuditChunk),
    ]);
  } else {
    const timeParams = { since: DEFAULT_FULL_SINCE };

    const onMedialogChunk = (entries) => {
      mergeEntriesIntoMediaMap(entries, mediaMap);
      const fromMedialog = mergeEntriesIntoMediaMap([], mediaMap);
      if (fromMedialog.length > 0) onProgressiveData(fromMedialog);
    };

    const statusTask = (async () => {
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
    })();

    const [statusResources, medialogResult] = await Promise.all([
      statusTask,
      fetchAllMediaLog(org, site, timeParams, onMedialogChunk),
    ]);

    const syntheticAudit = statusResources.map((r) => {
      const path = toAbsoluteFilePath(r.path);
      return {
        path,
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
  );

  return { mediaData, buildMode };
}
