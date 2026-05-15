import admin from '../../../scripts/helix-admin.js';
import { executeAdminRequest, AuthMode } from '../../../utils/admin-request.js';
import { getDedupeKey } from '../core/urls.js';
import { MediaLibraryError, ErrorCodes, logMediaLibraryError } from '../core/errors.js';
import t from '../core/messages.js';

const DEFAULT_LIMIT = 1000;
const authedAdmin = admin.withRequestInit({ credentials: 'include' });

function checkError(result) {
  if (result.ok) return;
  const { url } = result.request;
  if (result.status === 401) {
    logMediaLibraryError(ErrorCodes.EDS_AUTH_EXPIRED, { status: 401, endpoint: url });
    throw new MediaLibraryError(ErrorCodes.EDS_AUTH_EXPIRED, t('EDS_AUTH_EXPIRED'), { status: 401 });
  }
  if (result.status === 403) {
    logMediaLibraryError(ErrorCodes.EDS_LOG_DENIED, { status: 403, endpoint: url });
    throw new MediaLibraryError(ErrorCodes.EDS_LOG_DENIED, t('EDS_LOG_DENIED'), { status: 403 });
  }
  throw new Error(`Failed to fetch medialog: ${result.status}`);
}

/**
 * Fetch all medialog entries (with pagination).
 * @param {string} org
 * @param {string} site
 * @param {object} timeParams - { from, to } for incremental; empty for full
 * @param {Function} [onChunk] - Callback (entries) for each page; enables progressive display
 */
export async function fetchAllMediaLog(org, site, timeParams, onChunk = null) {
  const handle = authedAdmin.medialog({ org, site });
  const allEntries = [];
  let nextToken = null;
  let first = true;

  for (;;) {
    const params = { limit: DEFAULT_LIMIT };
    if (timeParams.from && timeParams.to) {
      params.from = timeParams.from;
      params.to = timeParams.to;
    }
    if (nextToken) params.nextToken = nextToken;

    const policy = first ? AuthMode.PREFLIGHT_AND_RETRY : AuthMode.RETRY_ON_401;
    first = false;

    // eslint-disable-next-line no-await-in-loop -- pagination must be sequential
    const result = await executeAdminRequest(() => handle.get('', { params }), { org, site, policy });
    if (!result) return allEntries; // login cancelled

    checkError(result);

    // eslint-disable-next-line no-await-in-loop
    const data = await result.json();
    const { entries = [] } = data;
    const token = data.nextToken || (data.links?.next
      ? new URL(data.links.next).searchParams.get('nextToken')
      : null);

    if (!entries.length) break;
    allEntries.push(...entries);
    if (onChunk) onChunk(entries);
    nextToken = token;
    if (entries.length < DEFAULT_LIMIT || !nextToken) break;
  }

  return allEntries;
}

/**
 * Media key for deduplication - must match getDedupeKey used in merge/cache.
 */
function toMediaDedupeKey(pathOrUrl) {
  return getDedupeKey(pathOrUrl || '');
}

/**
 * Extract filename from path
 */
function extractFilename(path) {
  return path.split('/').pop().split('?')[0];
}

/**
 * Extract folder path from media URL
 */
function extractFolder(path) {
  const parts = path.split('/');
  parts.pop(); // Remove filename
  return parts.join('/') || '/';
}

/**
 * Detect media type from entry
 */
function detectMediaType(entry) {
  const { path, contentType } = entry;

  if (contentType) {
    if (contentType.startsWith('image/')) {
      if (contentType === 'image/svg+xml') {
        return path.includes('/icons/') ? 'icon' : 'svg';
      }
      return 'image';
    }
    if (contentType.startsWith('video/')) return 'video';
    if (contentType === 'application/pdf') return 'document';
  }

  if (path.includes('/fragments/')) return 'fragment';

  const ext = path.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'avi', 'webm'].includes(ext)) return 'video';
  if (ext === 'svg') return path.includes('/icons/') ? 'icon' : 'svg';
  if (ext === 'pdf') return 'document';

  return 'document';
}

function toMediaItem(media) {
  return {
    hash: media.hash,
    url: media.url,
    name: media.name,
    timestamp: media.timestamp,
    user: media.user,
    operation: media.operation,
    type: media.type,
    doc: media.uniqueSources.size > 0 ? [...media.uniqueSources][0] : null,
    status: media.uniqueSources.size === 0 ? 'unused' : 'referenced',
    usageCount: media.usageCount,
    uniqueSources: Array.from(media.uniqueSources),
    uniqueUsers: Array.from(media.uniqueUsers),
    folder: extractFolder(media.url),
    alt: null,
  };
}

/**
 * Extract media items array from an existing media map (no merge).
 * Use after mergeEntriesIntoMediaMap to avoid redundant full-map rebuild.
 */
export function getMediaItemsFromMap(mediaMap) {
  return Array.from(mediaMap.values()).map(toMediaItem);
}

/**
 * Merge new medialog/auditlog entries into existing media map (incremental, no full recompute).
 * @param {Array} entries - New entries to merge
 * @param {Map} mediaMap - Mutable map (key -> media), reused across chunks
 * @returns {Array} Media items for emit
 */
export function mergeEntriesIntoMediaMap(entries, mediaMap) {
  entries.forEach((entry) => {
    const pathOrUrl = entry.path || entry.url;
    if (!pathOrUrl) return;
    const key = toMediaDedupeKey(pathOrUrl);

    if (!mediaMap.has(key)) {
      mediaMap.set(key, {
        hash: entry.mediaHash || entry.hash || key,
        url: pathOrUrl,
        name: entry.name || extractFilename(pathOrUrl),
        timestamp: entry.timestamp,
        user: entry.user || '',
        operation: entry.operation || '',
        type: entry.type || detectMediaType(entry),
        doc: '',
        status: 'referenced',
        usageCount: 0,
        uniqueSources: new Set(),
        uniqueUsers: new Set(),
        auditLog: [],
        width: entry.width || null,
        height: entry.height || null,
        contentType: entry.contentType || null,
        folder: null,
      });
    }

    const media = mediaMap.get(key);
    const doc = entry.doc ?? entry.resourcePath;
    if (doc) media.uniqueSources.add(doc);
    if (entry.user) media.uniqueUsers.add(entry.user);
    media.auditLog.push(entry);
    media.usageCount = media.auditLog.length;

    if (entry.timestamp > media.timestamp) {
      media.timestamp = entry.timestamp;
      media.user = entry.user || media.user;
      media.operation = entry.operation || media.operation;
    }
  });

  return getMediaItemsFromMap(mediaMap);
}

/**
 * Transform medialog + auditlog entries to media data structure
 */
export function transformToMediaData(medialogEntries, auditlogEntries) {
  const allEntries = [...medialogEntries, ...auditlogEntries];
  const mediaMap = new Map();

  allEntries.forEach((entry) => {
    const pathOrUrl = entry.path || entry.url;
    if (!pathOrUrl) return;
    const key = toMediaDedupeKey(pathOrUrl);

    if (!mediaMap.has(key)) {
      mediaMap.set(key, {
        hash: entry.mediaHash || entry.hash || key,
        url: pathOrUrl,
        name: entry.name || extractFilename(pathOrUrl),
        timestamp: entry.timestamp,
        user: entry.user || '',
        operation: entry.operation || '',
        type: entry.type || detectMediaType(entry),
        doc: '',
        status: 'referenced',
        usageCount: 0,
        uniqueSources: new Set(),
        uniqueUsers: new Set(),
        auditLog: [],
        width: entry.width || null,
        height: entry.height || null,
        contentType: entry.contentType || null,
        folder: null,
      });
    }

    const media = mediaMap.get(key);
    const doc = entry.doc ?? entry.resourcePath;
    if (doc) media.uniqueSources.add(doc);
    if (entry.user) media.uniqueUsers.add(entry.user);
    media.auditLog.push(entry);
    media.usageCount = media.auditLog.length;

    if (entry.timestamp > media.timestamp) {
      media.timestamp = entry.timestamp;
      media.user = entry.user || media.user;
      media.operation = entry.operation || media.operation;
    }
  });

  return Array.from(mediaMap.values()).map(toMediaItem);
}
