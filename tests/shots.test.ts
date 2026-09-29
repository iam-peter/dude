// ShotScope (src/ui/shots.ts): every object URL it hands out is revoked again once no
// longer needed, so extension pages don't keep every screenshot they showed in memory.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/storage/db', () => ({
  getShot: vi.fn(async (id: string) => ({ thumb: new Blob([`t${id}`]), preview: new Blob([`p${id}`]) })),
}));
import { ShotScope } from '@/ui/shots';

describe('ShotScope', () => {
  let live: Set<string>;
  beforeEach(() => {
    live = new Set();
    let n = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const u = `blob:${++n}`;
      live.add(u);
      return u;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => void live.delete(u));
  });
  afterEach(() => vi.restoreAllMocks());
  const settle = () => new Promise((r) => setTimeout(r, 0));

  test('one URL per shot and kind, released by keepOnly', async () => {
    const s = new ShotScope();
    const a = await s.url('a');
    expect(await s.url('a')).toBe(a);
    await s.urls(['b', 'c']);
    await s.url('a', 'preview');
    expect(live.size).toBe(4);
    s.keepOnly(['a']); // thumbs only: the preview stays
    await settle();
    expect(live.size).toBe(2);
    expect(s.size).toBe(2);
  });

  test('dispose releases everything', async () => {
    const s = new ShotScope();
    await s.urls(['a', 'b']);
    await s.url('a', 'preview');
    s.dispose();
    await settle();
    expect(live.size).toBe(0);
  });

  test('a shot released while loading never gets a URL', async () => {
    const s = new ShotScope();
    const p = s.url('a');
    s.keepOnly([]);
    expect(await p).toBeUndefined();
    const q = s.url('b');
    s.dispose();
    expect(await q).toBeUndefined();
    expect(live.size).toBe(0);
  });
});
