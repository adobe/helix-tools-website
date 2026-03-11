const DB_PREFIX = 'media-insights';
const DB_VERSION = 1;
const MEDIA_STORE = 'media';

function normalizePath(path) {
  if (!path || typeof path !== 'string') return '';
  const trimmed = path.trim().replace(/\/+$/, '');
  if (trimmed.startsWith('/')) return trimmed;
  return trimmed ? `/${trimmed}` : '';
}

function pathToSafeSegment(path) {
  const p = normalizePath(path);
  if (!p) return 'root';
  return p.replace(/-/g, '--').replace(/\//g, '-');
}

function getDBName(org, site, path = '') {
  const safePath = pathToSafeSegment(path);
  return `${DB_PREFIX}-${org}-${site}-${safePath}`;
}

function openDB(org, site, path = '') {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(getDBName(org, site, path), DB_VERSION);

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

function getCacheKey(org, site, path = '') {
  const p = normalizePath(path);
  return p ? `${org}/${site}${p}` : `${org}/${site}`;
}

const META_PREFIX = 'insights-meta:';

function getMetaKey(org, site, path = '') {
  return META_PREFIX + getCacheKey(org, site, path);
}

export function getMetadata(org, site, path = '') {
  try {
    const raw = localStorage.getItem(getMetaKey(org, site, path));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return null;
  }
}

export function saveMetadata(org, site, metadata, path = '') {
  try {
    localStorage.setItem(getMetaKey(org, site, path), JSON.stringify(metadata));
  } catch {
    // Ignore localStorage errors (quota exceeded, etc.)
  }
}

export async function getMediaData(org, site, path = '') {
  try {
    const db = await openDB(org, site, path);
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

export async function saveMediaData(org, site, mediaData, path = '') {
  const db = await openDB(org, site, path);

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

export function isIncrementalEligible(metadata) {
  if (!metadata) return false;
  const t = metadata.lastFetchTime;
  return typeof t === 'number' && !Number.isNaN(t) && t > 0;
}

const INITIAL_FROM = '2020-01-01T00:00:00.000Z';

export function initialTimeParams() {
  return { from: INITIAL_FROM, to: new Date().toISOString() };
}

export function incrementalTimeParams(lastFetchTime) {
  const from = new Date(lastFetchTime).toISOString();
  const to = new Date().toISOString();
  return { from, to };
}

const LOCK_PREFIX = 'insights-lock:';
const LOCK_TTL_MS = 5 * 60 * 1000; // 5 min

export function createIndexLock(org, site, path = '') {
  const key = LOCK_PREFIX + getCacheKey(org, site, path);
  const payload = { started: Date.now() };
  try {
    localStorage.setItem(key, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function checkIndexLock(org, site, path = '') {
  const key = LOCK_PREFIX + getCacheKey(org, site, path);
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

export function removeIndexLock(org, site, path = '') {
  try {
    localStorage.removeItem(LOCK_PREFIX + getCacheKey(org, site, path));
  } catch {
    /* ignore */
  }
}

export async function clearCache(org, site, path = '') {
  try {
    localStorage.removeItem(getMetaKey(org, site, path));
    removeIndexLock(org, site, path);
  } catch {
    // Ignore localStorage errors
  }

  try {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(getDBName(org, site, path));
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Database deletion blocked'));
    });
  } catch {
    // Ignore IndexedDB errors
  }
}
