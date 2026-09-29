// Screenshot blobs → object URLs for extension pages. Pages read the IndexedDB directly
// (same extension origin), so images never travel through runtime messages.
//
// An object URL keeps its blob in memory until revoked. Each component owns a ShotScope,
// tells it which screenshots it still shows (`keepOnly`) and disposes of it on unmount,
// so a page left open while browsing many sessions doesn't collect every image it ever
// showed.

import { getShot } from '@/storage/db';

export type ShotKind = 'thumb' | 'preview';

export class ShotScope {
  #urls = new Map<string, Promise<string | undefined>>();
  #disposed = false;

  /** Object URL of a shot's thumbnail, or of its preview (falling back to the thumbnail). */
  url(id: string, kind: ShotKind = 'thumb'): Promise<string | undefined> {
    const key = `${kind}:${id}`;
    let p = this.#urls.get(key);
    if (!p) {
      p = getShot(id).then((s) => {
        const blob = kind === 'preview' ? (s?.preview ?? s?.thumb) : s?.thumb;
        // released (or the scope disposed) while reading: don't create a URL nobody frees
        if (!blob || this.#disposed || this.#urls.get(key) !== p) return undefined;
        return URL.createObjectURL(blob);
      });
      this.#urls.set(key, p);
    }
    return p;
  }

  /** Resolve many at once into a plain record (for Svelte state). */
  async urls(ids: string[], kind: ShotKind = 'thumb'): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    await Promise.all(
      ids.map(async (id) => {
        const u = await this.url(id, kind);
        if (u) out[id] = u;
      }),
    );
    return out;
  }

  /** Revoke the URLs of this kind for every shot not in `ids`. */
  keepOnly(ids: Iterable<string>, kind: ShotKind = 'thumb'): void {
    const keep = new Set([...ids].map((id) => `${kind}:${id}`));
    for (const [key, p] of this.#urls) {
      if (!key.startsWith(`${kind}:`) || keep.has(key)) continue;
      this.#urls.delete(key);
      p.then((u) => u && URL.revokeObjectURL(u));
    }
  }

  dispose(): void {
    this.#disposed = true;
    for (const p of this.#urls.values()) p.then((u) => u && URL.revokeObjectURL(u));
    this.#urls.clear();
  }

  /** Number of URLs held (tests). */
  get size(): number {
    return this.#urls.size;
  }
}
