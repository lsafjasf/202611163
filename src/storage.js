const DB_NAME = "seal-atelier";
const DB_VERSION = 1;
const STORE_NAME = "workspaces";

function openDatabase() {
  if (!("indexedDB" in window)) return Promise.reject(new Error("浏览器不支持 IndexedDB。"));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开本地数据库。"));
  });
}

async function withStore(mode, callback) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let result;
    try {
      result = callback(store);
    } catch (error) {
      db.close();
      reject(error);
      return;
    }
    transaction.oncomplete = () => {
      db.close();
      resolve(result);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error("本地存储事务失败。"));
    };
  });
}

export async function putWorkspace(key, value) {
  try {
    await withStore("readwrite", (store) => store.put(value, key));
    return { backend: "indexeddb" };
  } catch (error) {
    const serialized = JSON.stringify(value);
    localStorage.setItem(`seal-atelier:${key}`, serialized);
    return { backend: "localstorage", warning: error.message };
  }
}

export async function getWorkspace(key) {
  try {
    const db = await openDatabase();
    const value = await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => db.close();
    });
    if (value !== null) return value;
  } catch (error) {
    // Fall through to localStorage recovery.
  }
  const stored = localStorage.getItem(`seal-atelier:${key}`);
  if (!stored) return null;
  return JSON.parse(stored);
}

export async function removeWorkspace(key) {
  try {
    await withStore("readwrite", (store) => store.delete(key));
  } catch (error) {
    // Ignore and still clear the fallback copy.
  }
  localStorage.removeItem(`seal-atelier:${key}`);
}
