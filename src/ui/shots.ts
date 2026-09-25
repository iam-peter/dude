// Screenshot blobs → object URLs for extension pages. Pages read the IndexedDB directly
// (same extension origin), so images never travel through runtime messages.

import { getShot } from '@/storage/db';

const cache = new Map<string, Promise<string | undefined>>();

/** Object URL of a shot's thumbnail, or of its preview (falling back to the thumbnail). */
export function shotUrl(id: string, kind: 'thumb' | 'preview' = 'thumb'): Promise<string | undefined> {
  const key = `${kind}:${id}`;
  let p = cache.get(key);
  if (!p) {
    p = getShot(id).then((s) => {
      const blob = kind === 'preview' ? (s?.preview ?? s?.thumb) : s?.thumb;
      return blob ? URL.createObjectURL(blob) : undefined;
    });
    cache.set(key, p);
  }
  return p;
}

/** Resolve many at once into a plain record (for Svelte state). */
export async function shotUrls(ids: string[], kind: 'thumb' | 'preview' = 'thumb'): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    ids.map(async (id) => {
      const u = await shotUrl(id, kind);
      if (u) out[id] = u;
    }),
  );
  return out;
}
