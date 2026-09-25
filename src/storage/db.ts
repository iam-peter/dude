// IndexedDB storage (E1): the append-only observation log and a projection checkpoint.
// The log is the source of truth (SPEC §5); the checkpoint only shortens replay.

import type { Observation } from '@/core/observations';

const DB_NAME = 'dude';
const LOG = 'log';
const META = 'meta';

let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(LOG, { autoIncrement: true });
      req.result.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function done(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** Append one observation; resolves with its sequence number once committed. */
export async function append(o: Observation): Promise<number> {
  const t = (await db()).transaction(LOG, 'readwrite');
  const req = t.objectStore(LOG).add(o);
  await done(t);
  return req.result as number;
}

/** Visit every observation with seq > after, in order. */
export async function replay(after: number, fn: (seq: number, o: Observation) => void): Promise<number> {
  const t = (await db()).transaction(LOG, 'readonly');
  let last = after;
  await new Promise<void>((resolve, reject) => {
    const req = t.objectStore(LOG).openCursor(IDBKeyRange.lowerBound(after, true));
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      last = c.key as number;
      fn(last, c.value as Observation);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
  return last;
}

export async function logSize(): Promise<number> {
  const t = (await db()).transaction(LOG, 'readonly');
  const req = t.objectStore(LOG).count();
  await done(t);
  return req.result;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const t = (await db()).transaction(META, 'readonly');
  const req = t.objectStore(META).get(key);
  await done(t);
  return req.result as T | undefined;
}

export async function putMeta(key: string, value: unknown): Promise<void> {
  const t = (await db()).transaction(META, 'readwrite');
  t.objectStore(META).put(value, key);
  await done(t);
}

export async function deleteMeta(key: string): Promise<void> {
  const t = (await db()).transaction(META, 'readwrite');
  t.objectStore(META).delete(key);
  await done(t);
}
