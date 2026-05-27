import { getDedupeKey } from '../core/urls.js';

// ─── Audit log transforms ────────────────────────────────────────────────────

function isPdfSvgOrFragment(path) {
  if (!path) return false;
  const cleanPath = path.split('?')[0].split('#')[0];
  return /\.(pdf|svg)$/i.test(cleanPath)
    || (cleanPath.includes('/fragments/') && !cleanPath.includes('.'));
}

function getContentType(ext) {
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'svg') return 'image/svg+xml';
  return null;
}

/**
 * Filter and transform raw audit log entries into media items.
 * Only preview-route entries for PDF, SVG, or fragment paths are included.
 * @param {Array} entries
 * @param {string} org
 * @param {string} site
 * @returns {Array}
 */
export function processAuditLog(entries, org, site) {
  if (!entries || entries.length === 0) return [];

  return entries
    .filter((entry) => entry.route === 'preview')
    .filter((entry) => isPdfSvgOrFragment(entry.path))
    .map((entry) => {
      const cleanPath = entry.path.split('?')[0].split('#')[0];
      const ext = cleanPath.split('.').pop()?.toLowerCase() || '';

      const url = `https://main--${site}--${org}.aem.page${entry.path}`;
      return {
        hash: url,
        url,
        path: url,
        name: cleanPath.split('/').pop() || cleanPath,
        timestamp: entry.timestamp,
        user: entry.user || 'Unknown',
        operation: 'ingest',
        doc: '',
        resourcePath: null,
        contentType: getContentType(ext),
        mediaHash: null,
        width: null,
        height: null,
      };
    });
}

// ─── Media log transforms ────────────────────────────────────────────────────

/**
 * Detect media type from an entry's contentType header and/or path.
 * contentType takes precedence; extension and path patterns are the fallback.
 * @param {{ path: string, contentType?: string }} entry
 * @returns {string}
 */
export function detectMediaType(entry) {
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

function extractFilename(path) {
  return path.split('/').pop().split('?')[0];
}

function extractFolder(path) {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/') || '/';
}

function toMediaDedupeKey(pathOrUrl) {
  return getDedupeKey(pathOrUrl || '');
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
 * Transform medialog + auditlog entries to media data structure.
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
