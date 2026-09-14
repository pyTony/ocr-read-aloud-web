// IndexedDB persistence for uploaded PDF document and rendered page images
const DB_NAME = 'ocr_reader_storage';
const DB_VERSION = 1;
const STORE_PDF = 'pdf_store';
const STORE_PAGES = 'page_images';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PDF)) {
        db.createObjectStore(STORE_PDF, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_PAGES)) {
        db.createObjectStore(STORE_PAGES, { keyPath: 'pageNum' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function savePdfToIndexedDb(fileBuffer: ArrayBuffer, fileName: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_PDF, 'readwrite');
    const store = tx.objectStore(STORE_PDF);
    store.put({ key: 'active_pdf', buffer: fileBuffer, name: fileName, timestamp: Date.now() });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Failed to save PDF to IndexedDB:', err);
  }
}

export async function loadPdfFromIndexedDb(): Promise<{ buffer: ArrayBuffer; name: string } | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_PDF, 'readonly');
    const store = tx.objectStore(STORE_PDF);
    const request = store.get('active_pdf');
    return new Promise((resolve) => {
      request.onsuccess = () => {
        if (request.result && request.result.buffer) {
          resolve({ buffer: request.result.buffer, name: request.result.name });
        } else {
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function savePageImageToIndexedDb(pageNum: number, dataUrl: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_PAGES, 'readwrite');
    const store = tx.objectStore(STORE_PAGES);
    store.put({ pageNum, dataUrl });
  } catch (err) {
    console.warn(`Failed to save page image ${pageNum} to IndexedDB:`, err);
  }
}

export async function getPageImageFromIndexedDb(pageNum: number): Promise<string | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_PAGES, 'readonly');
    const store = tx.objectStore(STORE_PAGES);
    const request = store.get(pageNum);
    return new Promise((resolve) => {
      request.onsuccess = () => {
        resolve(request.result?.dataUrl || null);
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function clearIndexedDbStorage(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction([STORE_PDF, STORE_PAGES], 'readwrite');
    tx.objectStore(STORE_PDF).clear();
    tx.objectStore(STORE_PAGES).clear();
  } catch (err) {
    console.warn('Failed to clear IndexedDB:', err);
  }
}
