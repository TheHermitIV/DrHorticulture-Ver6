// IndexedDB keeps the original file usable after a page change, including large camera photos.
let database;

async function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('drhorticulture-scan', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function scanState(value) {
  try {
    database ??= openDatabase();
    const db = await database;
    const writing = value !== undefined;
    const transaction = db.transaction('workspace', writing ? 'readwrite' : 'readonly');
    const store = transaction.objectStore('workspace');
    const request = writing ? store.put(value, 'active') : store.get('active');
    return await new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch {
    return undefined;
  }
}
