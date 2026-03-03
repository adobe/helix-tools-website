/**
 * Media reconciliation: processLinkedContent, processStandaloneUploads.
 * Client-side IndexedDB flow for reconciling medialog and auditlog data.
 */

import {
  isPage,
  isPdf,
  isSvg,
  isFragmentDoc,
  isPdfOrSvg,
  buildUsageMap,
  getExternalMediaType,
  getLinkedContentType,
} from './parse.js';
import { Operation, Paths } from '../core/constants.js';
import { getDedupeKey } from '../core/urls.js';

function toCanonicalPath(path) {
  if (!path) return '';
  try {
    if (path.startsWith('http')) return new URL(path).pathname;
    return path.startsWith('/') ? path : `/${path}`;
  } catch {
    return path.split('?')[0].split('#')[0];
  }
}

function normalizeMediaKey(path) {
  return getDedupeKey(path || '');
}

function getContentTypeFromPath(filePath) {
  if (filePath.endsWith('.pdf')) return 'application/pdf';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  return null;
}

/**
 * Apply audit chunk to streaming maps. Used during parallel fetch for early-linked emit.
 * @param {Array} entries - Audit log entries from one page
 * @param {Map} pagesByPath - Mutable map path -> [events]
 * @param {Map} filesByPath - Mutable map path -> event
 * @param {Set} deletedPaths - Mutable set of deleted paths
 */
export function applyAuditChunkToMaps(entries, pagesByPath, filesByPath, deletedPaths) {
  (entries || []).forEach((e) => {
    if (!e?.path || e.route !== 'preview') return;
    const p = toCanonicalPath(e.path);
    if (isPage(e.path)) {
      if (e.method === 'DELETE' || e.operation === 'delete') {
        deletedPaths.add(p);
        pagesByPath.delete(p);
      } else {
        const existing = pagesByPath.get(p);
        if (!existing || (e.timestamp || 0) > (existing[0]?.timestamp || 0)) {
          pagesByPath.set(p, [e]);
        }
      }
    } else if (isPdfOrSvg(e.path) || isFragmentDoc(e.path)) {
      if (e.method === 'DELETE' || e.operation === 'delete') {
        deletedPaths.add(p);
        filesByPath.delete(p);
      } else {
        const existing = filesByPath.get(p);
        if (!existing || (e.timestamp || 0) > (existing.timestamp || 0)) {
          filesByPath.set(p, e);
        }
      }
    }
  });
}

function toLinkedContentEntry(filePath, doc, fileEvent, status, org, repo) {
  let urlPath = filePath;
  if (filePath.startsWith(Paths.FRAGMENTS) && filePath.endsWith(Paths.EXT_HTML)) {
    urlPath = filePath.replace(/\.html$/, '');
  }
  const url = `https://main--${repo}--${org}.aem.page${urlPath}`;

  /* Entry shape: hash, url, name, timestamp, user, operation, type, doc, status */
  return {
    hash: filePath,
    url,
    path: url,
    name: filePath.split('/').pop() || filePath,
    timestamp: fileEvent?.timestamp ?? 0,
    user: fileEvent?.user || '',
    operation: 'auditlog-parsed',
    type: getLinkedContentType(filePath),
    doc: doc || '',
    status,
    resourcePath: doc || null,
    contentType: getContentTypeFromPath(filePath),
    mediaHash: filePath,
  };
}

/**
 * Build early-linked placeholder entries (doc='', status='discovering') from filesByPath.
 * Emitted during stream before markdown parse.
 */
export function buildEarlyLinkedPlaceholders(filesByPath, deletedPaths, org, repo) {
  const entries = [];
  filesByPath.forEach((fileEvent, filePath) => {
    if (deletedPaths.has(filePath)) return;
    entries.push(toLinkedContentEntry(filePath, '', fileEvent, 'discovering', org, repo));
  });
  return entries;
}

function toExternalMediaEntry(url, doc, latestPageTimestamp = 0) {
  const info = getExternalMediaType(url);
  if (!info) return null;

  /* Entry shape: hash, url, name, timestamp, user, operation, type, doc, status */
  return {
    hash: url,
    url,
    path: url,
    name: info.name,
    timestamp: latestPageTimestamp,
    user: '',
    operation: Operation.EXTLINKS,
    type: info.type,
    doc: doc || '',
    status: 'referenced',
    resourcePath: doc || null,
    mediaHash: url,
  };
}

/**
 * Build set of media paths that are referenced (have resourcePath) from entries.
 */
function buildReferencedHashes(entries) {
  const refs = new Set();
  entries.forEach((e) => {
    if (e.resourcePath) {
      const key = normalizeMediaKey(e.path || e.mediaHash);
      if (key) refs.add(key);
    }
  });
  return refs;
}

/**
 * Add standalone uploads (medialog with originalFilename, no resourcePath).
 */
export function processStandaloneUploads(medialogEntries, referencedHashes) {
  const refs = referencedHashes instanceof Set
    ? referencedHashes
    : buildReferencedHashes(referencedHashes || []);
  const added = [];
  const standaloneUploads = medialogEntries.filter(
    (m) => !m.resourcePath && m.originalFilename,
  );

  standaloneUploads.forEach((media) => {
    const key = normalizeMediaKey(media.mediaHash || media.path);
    if (refs.has(key)) return;

    added.push({
      path: media.path,
      originalFilename: media.originalFilename?.split('/').pop() || media.path?.split('/').pop(),
      timestamp: media.timestamp,
      user: media.user || '',
      resourcePath: null,
      operation: media.operation || 'upload',
      source: 'medialog',
      contentType: media.contentType,
      mediaHash: media.mediaHash || media.path,
      width: media.width,
      height: media.height,
    });
  });

  return added;
}

/**
 * Process linked content (PDFs, SVGs, fragments) from page markdown.
 * Fetches pages, parses markdown. Pages from audit log (route=preview).
 */
export async function processLinkedContent(
  auditlogEntries,
  medialogEntries,
  org,
  repo,
  ref = 'main',
  onProgress = null,
) {
  const aud = auditlogEntries || [];
  const med = medialogEntries || [];
  const pageEntries = aud.filter((e) => isPage(e.path) && e.route === 'preview');
  const allFiles = [...aud, ...med].filter((e) => !isPage(e.path));

  const filesByPath = new Map();
  allFiles.forEach((e) => {
    if (!isPdfOrSvg(e.path) && !isFragmentDoc(e.path)) return;
    const p = toCanonicalPath(e.path);
    const existing = filesByPath.get(p);
    if (!existing || (e.timestamp || 0) > (existing.timestamp || 0)) filesByPath.set(p, e);
  });

  const deletedPaths = new Set();
  filesByPath.forEach((event, path) => {
    if (event.method === 'DELETE' || event.operation === 'delete') deletedPaths.add(path);
  });

  if (pageEntries.length === 0) {
    return { added: [], linkedEntries: [] };
  }

  onProgress?.({ stage: 'parsing', message: 'Building usage map from page content...' });
  const usageMap = await buildUsageMap(pageEntries, org, repo, ref, onProgress);

  const allLinkedPaths = new Set(filesByPath.keys());
  ['pdfs', 'svgs', 'fragments'].forEach((key) => {
    usageMap[key]?.forEach((_, path) => allLinkedPaths.add(path));
  });

  const linkedEntries = [];

  allLinkedPaths.forEach((filePath) => {
    if (deletedPaths.has(filePath)) return;

    let key = 'fragments';
    if (isPdf(filePath)) key = 'pdfs';
    else if (isSvg(filePath)) key = 'svgs';

    const linkedPages = usageMap[key]?.get(filePath) || [];
    const status = linkedPages.length > 0 ? 'referenced' : 'unused';
    const fileEvent = filesByPath.get(filePath) || { timestamp: 0, user: '' };

    linkedPages.forEach((doc) => {
      linkedEntries.push(toLinkedContentEntry(filePath, doc, fileEvent, status, org, repo));
    });

    if (linkedPages.length === 0) {
      linkedEntries.push(toLinkedContentEntry(filePath, '', fileEvent, status, org, repo));
    }
  });

  const externalUrls = usageMap.externalMedia ? [...usageMap.externalMedia.keys()] : [];
  externalUrls.forEach((url) => {
    const data = usageMap.externalMedia.get(url) || { pages: [], latestTimestamp: 0 };
    const { pages: linkedPages, latestTimestamp } = data;

    linkedPages.forEach((doc) => {
      const entry = toExternalMediaEntry(url, doc, latestTimestamp);
      if (entry) linkedEntries.push(entry);
    });
  });

  return { added: linkedEntries, linkedEntries };
}
