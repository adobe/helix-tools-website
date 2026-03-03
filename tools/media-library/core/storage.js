/**
 * Storage for media library - per-org-site IndexedDB + localStorage metadata
 * Architecture: Each org/site gets its own IndexedDB database
 * Stores: transformed mediaData (not raw logs)
 */

const DB_PREFIX = 'media-library-cache';
const DB_VERSION = 1;
const MEDIA_STORE = 'media';

function getDBName(org, site) {
  return `${DB_PREFIX}-${org}-${site}`;
}

function openDB(org, site) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(getDBName(org, site), DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        const mediaStore = db.createObjectStore(MEDIA_STORE, { keyPath: 'id' });
        mediaStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

function getCacheKey(org, site) {
  return `${org}/${site}`;
}

const META_PREFIX = 'media-library-meta:';

function getMetaKey(org, site) {
  return META_PREFIX + getCacheKey(org, site);
}

export function getMetadata(org, site) {
  try {
    const raw = localStorage.getItem(getMetaKey(org, site));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return null;
  }
}

export function saveMetadata(org, site, metadata) {
  try {
    localStorage.setItem(getMetaKey(org, site), JSON.stringify(metadata));
  } catch {
    // Ignore localStorage errors (quota exceeded, etc.)
  }
}

/**
 * Get transformed mediaData from cache
 */
export async function getMediaData(org, site) {
  try {
    const db = await openDB(org, site);
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([MEDIA_STORE], 'readonly');
      const store = transaction.objectStore(MEDIA_STORE);
      const request = store.get('mediaData');

      request.onsuccess = () => {
        const { result } = request;
        resolve(result?.data || []);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    return [];
  }
}

/**
 * Save transformed mediaData to cache.
 * @returns {Promise<Array>} The data that was saved (use this for display)
 */
export async function saveMediaData(org, site, mediaData) {
  const db = await openDB(org, site);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([MEDIA_STORE], 'readwrite');
    const store = transaction.objectStore(MEDIA_STORE);

    store.put({
      id: 'mediaData',
      data: mediaData,
      timestamp: Date.now(),
      count: mediaData.length,
    });

    transaction.oncomplete = () => resolve(mediaData);
    transaction.onerror = () => reject(transaction.error);
  });
}

/** Default since for full fetch when no prior index exists */
export const DEFAULT_FULL_SINCE = '730d';

/**
 * Check if incremental fetch is eligible: metadata exists and lastFetchTime is numeric.
 * @param {object} metadata - Index metadata
 * @returns {boolean}
 */
export function isIncrementalEligible(metadata) {
  if (!metadata) return false;
  const t = metadata.lastFetchTime;
  return typeof t === 'number' && !Number.isNaN(t) && t > 0;
}

/**
 * Get exact from/to ISO strings for incremental fetch.
 * @param {number} lastFetchTime - Epoch ms
 * @returns {{ from: string, to: string }}
 */
export function getIncrementalTimeBounds(lastFetchTime) {
  const from = new Date(lastFetchTime).toISOString();
  const to = new Date().toISOString();
  return { from, to };
}

const LOCK_PREFIX = 'media-library-index-lock:';
const LOCK_TTL_MS = 5 * 60 * 1000; // 5 min

export function createIndexLock(org, site) {
  const key = LOCK_PREFIX + getCacheKey(org, site);
  const payload = { started: Date.now() };
  try {
    localStorage.setItem(key, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function checkIndexLock(org, site) {
  const key = LOCK_PREFIX + getCacheKey(org, site);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const { started } = JSON.parse(raw);
    if (Date.now() - started > LOCK_TTL_MS) {
      localStorage.removeItem(key);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function removeIndexLock(org, site) {
  try {
    localStorage.removeItem(LOCK_PREFIX + getCacheKey(org, site));
  } catch {
    /* ignore */
  }
}

export async function clearCache(org, site) {
  try {
    localStorage.removeItem(getMetaKey(org, site));
    removeIndexLock(org, site);
  } catch {
    // Ignore localStorage errors
  }

  try {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(getDBName(org, site));
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Database deletion blocked'));
    });
  } catch {
    // Ignore IndexedDB errors
  }
}
