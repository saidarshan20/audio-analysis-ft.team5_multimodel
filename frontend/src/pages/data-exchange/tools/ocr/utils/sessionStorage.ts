import { saveBackendSession, getBackendSessions, getBackendSession, deleteBackendSession } from './ocrApi';

export interface OcrSession {
  id: string;
  name: string;
  timestamp: number;
  allResults: any[];
  sessionFiles?: File[];
  chatHistories: Record<string, any>;
  expandedSources: Record<string, any>;
  aiInsightsCache?: Record<string, any>;
  datasetState?: any;
  is_backend?: boolean; // Flag to indicate if it's from backend
}

const DB_NAME = 'Data2Insightai_OCR_DB';
const DB_VERSION = 1;
const STORE_NAME = 'ocr_sessions';

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event: Event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event: Event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
};

export const saveSession = async (session: OcrSession): Promise<void> => {
  // 1. Save to local IndexedDB
  const db = await initDB();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(session);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  // 2. Save to backend as a file
  try {
    const backendSafeSession: OcrSession = {
      ...session,
      sessionFiles: undefined,
    };
    await saveBackendSession(backendSafeSession);
  } catch (error) {
    console.warn('Failed to sync session to backend:', error);
    // We still resolve because local save succeeded
  }
};

export const loadSession = async (id: string, fromBackend: boolean = false): Promise<OcrSession | undefined> => {
  if (fromBackend) {
    try {
      const session = await getBackendSession(id);
      return { ...session, is_backend: true };
    } catch (error) {
      console.error('Failed to load session from backend:', error);
    }
  }

  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const getAllSessions = async (): Promise<OcrSession[]> => {
  // 1. Get local sessions
  const db = await initDB();
  const localItems = await new Promise<OcrSession[]>((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });

  // 2. Get backend sessions
  let backendItems: OcrSession[] = [];
  try {
    const response = await getBackendSessions();
    backendItems = (response.sessions || []).map((s: any) => ({
      ...s,
      is_backend: true,
      allResults: [], // Results are loaded on-demand
    }));
  } catch (error) {
    console.warn('Failed to fetch backend sessions:', error);
  }

  // Combine and de-duplicate (prefer backend if exists)
  const combined = [...localItems];
  backendItems.forEach(b => {
    const exists = combined.find(l => l.id === b.id);
    if (!exists) {
      combined.push(b);
    } else {
      exists.is_backend = true; // Mark as also on backend
    }
  });

  // Sort in descending order of timestamp (newest first)
  combined.sort((a, b) => b.timestamp - a.timestamp);
  return combined;
};

export const deleteSession = async (id: string, isFromBackend: boolean = false): Promise<void> => {
  if (isFromBackend) {
    try {
      await deleteBackendSession(id);
    } catch (error) {
      console.error('Failed to delete session from backend:', error);
    }
  }

  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};
