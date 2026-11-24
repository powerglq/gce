type NotebookImageRecord = {
  id: string;
  blob: Blob;
  name?: string;
  size?: number;
  type?: string;
  createdAt?: number;
};

const DB_NAME = 'gce_db';
const DB_VERSION = 1;
const STORE_NOTEBOOK_IMAGES = 'notebook_images';

let __dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (__dbPromise) return __dbPromise;
  __dbPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NOTEBOOK_IMAGES)) {
          db.createObjectStore(STORE_NOTEBOOK_IMAGES, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('indexeddb_open_failed'));
    } catch (e) {
      reject(e);
    }
  });
  return __dbPromise;
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('indexeddb_request_failed'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    try {
      const tx = db.transaction([STORE_NOTEBOOK_IMAGES], mode);
      const store = tx.objectStore(STORE_NOTEBOOK_IMAGES);
      let result: T;
      let settled = false;

      const fail = (e: unknown) => {
        if (settled) return;
        settled = true;
        try { tx.abort(); } catch {}
        reject(e);
      };

      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      tx.onabort = () => fail(tx.error || new Error('indexeddb_tx_aborted'));
      tx.onerror = () => fail(tx.error || new Error('indexeddb_tx_failed'));

      run(store)
        .then((res) => {
          result = res;
          // 注意：不要在这里 resolve，必须等待 tx.oncomplete，确保事务已提交。
        })
        .catch((e) => fail(e));
    } catch (e) {
      reject(e);
    }
  });
}

export async function putNotebookImage(record: NotebookImageRecord): Promise<void> {
  await withStore('readwrite', async (store) => {
    await reqToPromise(store.put(record));
  });
}

export async function getNotebookImageBlob(id: string): Promise<Blob | null> {
  if (!id) return null;
  return await withStore('readonly', async (store) => {
    const rec = (await reqToPromise(store.get(id))) as NotebookImageRecord | undefined;
    const blob = rec?.blob;
    return blob instanceof Blob ? blob : null;
  });
}

export async function deleteNotebookImage(id: string): Promise<void> {
  if (!id) return;
  await withStore('readwrite', async (store) => {
    await reqToPromise(store.delete(id));
  });
}
