const DB_NAME = 'media-library-cache';
const DB_VERSION = 1;
const STORES = {
  MEDIALOG: 'medialog-entries',
  AUDITLOG: 'auditlog-entries',
  METADATA: 'metadata',
};

const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const CACHE_STALE_MS = 5 * 60 * 1000;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORES.MEDIALOG)) {
        const medialogStore = db.createObjectStore(STORES.MEDIALOG, { keyPath: 'id', autoIncrement: true });
        medialogStore.createIndex('timestamp', 'timestamp', { unique: false });
        medialogStore.createIndex('path', 'path', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.AUDITLOG)) {
        const auditlogStore = db.createObjectStore(STORES.AUDITLOG, { keyPath: 'id', autoIncrement: true });
        auditlogStore.createIndex('timestamp', 'timestamp', { unique: false });
        auditlogStore.createIndex('path', 'path', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.METADATA)) {
        db.createObjectStore(STORES.METADATA, { keyPath: 'key' });
      }
    };
  });
}

function getCacheKey(org, site) {
  return `${org}/${site}`;
}

export async function getMetadata(org, site) {
  const db = await openDB();
  const key = getCacheKey(org, site);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.METADATA], 'readonly');
    const store = transaction.objectStore(STORES.METADATA);
    const request = store.get(key);

    request.onsuccess = () => resolve(request.result?.value || null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveMetadata(org, site, metadata) {
  const db = await openDB();
  const key = getCacheKey(org, site);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.METADATA], 'readwrite');
    const store = transaction.objectStore(STORES.METADATA);
    const request = store.put({ key, value: metadata });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getMedialogEntries(org, site) {
  const db = await openDB();
  const key = getCacheKey(org, site);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.MEDIALOG], 'readonly');
    const store = transaction.objectStore(STORES.MEDIALOG);
    const index = store.index('timestamp');
    const request = index.openCursor(null, 'prev');

    const entries = [];
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        if (cursor.value.cacheKey === key) {
          entries.push(cursor.value.entry);
        }
        cursor.continue();
      } else {
        resolve(entries);
      }
    };

    request.onerror = () => reject(request.error);
  });
}

export async function getAuditlogEntries(org, site) {
  const db = await openDB();
  const key = getCacheKey(org, site);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.AUDITLOG], 'readonly');
    const store = transaction.objectStore(STORES.AUDITLOG);
    const index = store.index('timestamp');
    const request = index.openCursor(null, 'prev');

    const entries = [];
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        if (cursor.value.cacheKey === key) {
          entries.push(cursor.value.entry);
        }
        cursor.continue();
      } else {
        resolve(entries);
      }
    };

    request.onerror = () => reject(request.error);
  });
}

export async function saveMedialogEntries(org, site, entries) {
  const db = await openDB();
  const key = getCacheKey(org, site);
  const cutoffTime = Date.now() - MAX_AGE_MS;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.MEDIALOG], 'readwrite');
    const store = transaction.objectStore(STORES.MEDIALOG);

    store.clear();

    const filteredEntries = entries.filter((entry) => entry.timestamp > cutoffTime);

    filteredEntries.forEach((entry) => {
      store.add({
        cacheKey: key,
        timestamp: entry.timestamp,
        path: entry.path,
        entry,
      });
    });

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function saveAuditlogEntries(org, site, entries) {
  const db = await openDB();
  const key = getCacheKey(org, site);
  const cutoffTime = Date.now() - MAX_AGE_MS;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.AUDITLOG], 'readwrite');
    const store = transaction.objectStore(STORES.AUDITLOG);

    store.clear();

    const filteredEntries = entries.filter((entry) => entry.timestamp > cutoffTime);

    filteredEntries.forEach((entry) => {
      store.add({
        cacheKey: key,
        timestamp: entry.timestamp,
        path: entry.path,
        entry,
      });
    });

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export function isCacheStale(metadata) {
  if (!metadata || !metadata.lastFetchTime) return true;
  const age = Date.now() - metadata.lastFetchTime;
  return age > CACHE_STALE_MS;
}

export function timestampToDuration(timestamp) {
  if (!timestamp) return '90d';

  const ageMs = Date.now() - timestamp;
  const days = Math.ceil(ageMs / (24 * 60 * 60 * 1000));

  if (days < 1) {
    const hours = Math.ceil(ageMs / (60 * 60 * 1000));
    return hours > 0 ? `${hours}h` : '1h';
  }

  return `${Math.min(days, 365)}d`;
}

export async function clearCache(org, site) {
  const db = await openDB();
  const key = getCacheKey(org, site);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.MEDIALOG, STORES.AUDITLOG, STORES.METADATA], 'readwrite');

    transaction.objectStore(STORES.METADATA).delete(key);

    const medialogStore = transaction.objectStore(STORES.MEDIALOG);
    const medialogIndex = medialogStore.index('timestamp');
    const medialogRequest = medialogIndex.openCursor();
    medialogRequest.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        if (cursor.value.cacheKey === key) {
          cursor.delete();
        }
        cursor.continue();
      }
    };

    const auditlogStore = transaction.objectStore(STORES.AUDITLOG);
    const auditlogIndex = auditlogStore.index('timestamp');
    const auditlogRequest = auditlogIndex.openCursor();
    auditlogRequest.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        if (cursor.value.cacheKey === key) {
          cursor.delete();
        }
        cursor.continue();
      }
    };

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
