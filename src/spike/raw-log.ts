// S1 raw event log: every observed browser event, unmodified, in IndexedDB.
// Writes go through one promise chain so records keep the order the listeners fired in,
// and each append resolves only once the transaction committed (MV3 background can die
// right after a handler returns).

export interface RawRecord {
  seq?: number; // autoIncrement key
  t: number; // Date.now() when the listener fired
  wake: string; // id of the background instance (changes when the SW/event page restarts)
  i: number; // listener order within one wake
  browser: string;
  src: string; // e.g. "webNavigation.onCommitted"
  data: unknown;
}

const DB_NAME = 'dude-s1';
const STORE = 'raw';

let dbp: Promise<IDBDatabase> | null = null;
let chain: Promise<unknown> = Promise.resolve();

function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'seq', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(req.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

function serialize<T>(chainStep: () => Promise<T>): Promise<T> {
  const p = chain.then(chainStep, chainStep);
  chain = p.catch(() => undefined);
  return p;
}

export function append(rec: RawRecord): Promise<IDBValidKey> {
  return serialize(() => tx('readwrite', (s) => s.add(rec)));
}

export function all(): Promise<RawRecord[]> {
  return serialize(() => tx('readonly', (s) => s.getAll() as IDBRequest<RawRecord[]>));
}

export function count(): Promise<number> {
  return serialize(() => tx('readonly', (s) => s.count()));
}

export function clear(): Promise<undefined> {
  return serialize(() => tx('readwrite', (s) => s.clear() as IDBRequest<undefined>));
}
