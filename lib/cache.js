// IndexedDB cache for video decisions
const DB_NAME = 'YouTubeFocusFilter';
const DB_VERSION = 1;
const STORE_NAME = 'decisions';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

let db = null;

async function openDB() {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'videoId' });
        store.createIndex('timestamp', 'timestamp');
      }
    };
  });
}

export async function getCachedDecision(videoId) {
  const database = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(videoId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const result = request.result;
      if (!result) {
        resolve(null);
        return;
      }

      // Check if cache is expired
      if (Date.now() - result.timestamp > CACHE_TTL) {
        resolve(null);
        return;
      }

      resolve(result);
    };
  });
}

export async function setCachedDecision(decision) {
  const database = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(decision);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function clearExpiredCache() {
  const database = await openDB();
  const expireTime = Date.now() - CACHE_TTL;

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    const range = IDBKeyRange.upperBound(expireTime);
    const request = index.openCursor(range);

    request.onerror = () => reject(request.error);
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
  });
}

export async function getStats() {
  const database = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const all = request.result;
      const todayStart = new Date().setHours(0, 0, 0, 0);

      const stats = {
        total: all.length,
        allowed: all.filter(d => d.decision === 'ALLOW').length,
        blocked: all.filter(d => d.decision === 'BLOCK').length,
        focused: all.filter(d => d.decision === 'FOCUS').length,
        today: {
          total: 0,
          blocked: 0,
          focused: 0
        }
      };

      all.forEach(d => {
        if (d.timestamp >= todayStart) {
          stats.today.total++;
          if (d.decision === 'BLOCK') {
            stats.today.blocked++;
          } else if (d.decision === 'FOCUS') {
            stats.today.focused++;
          }
        }
      });

      resolve(stats);
    };
  });
}

export async function clearAllCache() {
  const database = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}
