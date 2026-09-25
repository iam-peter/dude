// IndexedDB storage (E1): the append-only observation log and a projection checkpoint.
// The log is the source of truth (SPEC §5); the checkpoint only shortens replay.

import type { Observation } from '@/core/observations';

const DB_NAME = 'dude';
const LOG = 'log';
const META = 'meta';
const SHOTS = 'shots';
const TEXTS = 'texts';

/** One screenshot (SPEC §7.1): a thumbnail always, a preview until pruned (S2 #7). */
export interface Shot {
  id: string;
  t: number;
  hash: string;
  w: number;
  h: number;
  thumb: Blob;
  preview?: Blob;
}

/** Readable page text (§7.2), gzip-compressed. */
export interface PageText {
  id: string;
  t: number;
  url: string;
  title?: string;
  chars: number;
  gz: Blob;
}

let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(LOG)) d.createObjectStore(LOG, { autoIncrement: true });
      if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
      if (!d.objectStoreNames.contains(SHOTS)) d.createObjectStore(SHOTS, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(TEXTS)) d.createObjectStore(TEXTS, { keyPath: 'id' });
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

// ---------------------------------------------------------------- blobs

async function put(store: string, value: unknown): Promise<void> {
  const t = (await db()).transaction(store, 'readwrite');
  t.objectStore(store).put(value);
  await done(t);
}

async function get<T>(store: string, key: string): Promise<T | undefined> {
  const t = (await db()).transaction(store, 'readonly');
  const req = t.objectStore(store).get(key);
  await done(t);
  return req.result as T | undefined;
}

async function remove(store: string, keys: string[]): Promise<void> {
  if (!keys.length) return;
  const t = (await db()).transaction(store, 'readwrite');
  for (const k of keys) t.objectStore(store).delete(k);
  await done(t);
}

/** Visit every record of a store without loading them all at once. */
async function each<T>(store: string, fn: (value: T) => void): Promise<void> {
  const t = (await db()).transaction(store, 'readonly');
  await new Promise<void>((resolve, reject) => {
    const req = t.objectStore(store).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      fn(c.value as T);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export const putShot = (s: Shot) => put(SHOTS, s);
export const getShot = (id: string) => get<Shot>(SHOTS, id);
export const deleteShots = (ids: string[]) => remove(SHOTS, ids);
export const eachShot = (fn: (s: Shot) => void) => each<Shot>(SHOTS, fn);

export const putText = (x: PageText) => put(TEXTS, x);
export const getText = (id: string) => get<PageText>(TEXTS, id);
export const deleteTexts = (ids: string[]) => remove(TEXTS, ids);
export const eachText = (fn: (x: PageText) => void) => each<PageText>(TEXTS, fn);

