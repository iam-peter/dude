// The sessions app's search index: documents from the background, page text straight from
// IndexedDB, the index itself cached in IndexedDB between visits (F8).

import { request } from '@/background/protocol';
import { gunzip } from '@/background/imaging';
import { SearchIndex, type Cached, type SearchDoc } from '@/search';
import { getMeta, getText, putMeta } from '@/storage/db';

const CACHE_KEY = 'searchIndex';

export async function pageText(textId: string): Promise<string | undefined> {
  const rec = await getText(textId);
  return rec ? gunzip(rec.gz) : undefined;
}

let shared: Promise<SearchIndex> | undefined;
let syncing: Promise<unknown> = Promise.resolve();

/** The index, restored from cache and synced once; `resync` brings it up to date later. */
export function searchIndex(onProgress?: (done: number, total: number) => void): Promise<SearchIndex> {
  shared ??= (async () => {
    const ix = new SearchIndex(pageText);
    ix.restore(await getMeta<Cached>(CACHE_KEY).catch(() => undefined));
    await resyncInto(ix, onProgress);
    return ix;
  })();
  return shared;
}

async function resyncInto(ix: SearchIndex, onProgress?: (done: number, total: number) => void) {
  const docs = await request<SearchDoc[]>({ cmd: 'dude.searchDocs' });
  const changed = await ix.sync(docs, onProgress);
  if (changed) await putMeta(CACHE_KEY, ix.snapshot()).catch(() => undefined);
}

export function resync(): Promise<unknown> {
  if (!shared) return Promise.resolve();
  syncing = syncing.then(async () => resyncInto(await shared!)).catch(() => undefined);
  return syncing;
}
