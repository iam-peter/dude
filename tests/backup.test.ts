import { describe, expect, test } from 'vitest';
import { strToU8 } from 'fflate';
import { pack, unpack, type Backup } from '@/storage/backup';

describe('export / import (E5)', () => {
  const b: Backup = {
    exportedAt: '2026-09-25T00:00:00.000Z',
    observations: [{ type: 'nav.committed', t: 1, tabId: 1, url: 'https://example.com/', transitionType: 'typed', qualifiers: [] }],
    shots: [
      { id: 's1', t: 5, hash: 'ab', w: 800, h: 600, thumb: new Uint8Array([1, 2, 3]), preview: new Uint8Array([4, 5]) },
      { id: 's2', t: 6, hash: 'cd', w: 800, h: 600, thumb: new Uint8Array([6]) },
    ],
    texts: [{ id: 't1', t: 7, url: 'https://example.com/', title: 'Example', chars: 5, gz: new Uint8Array([9, 9]) }],
  };

  test('round trip keeps the log, the screenshots (with and without preview) and the texts', () => {
    const back = unpack(pack(b));
    expect(back.observations).toEqual(b.observations);
    expect(back.shots.map((s) => [s.id, [...s.thumb], s.preview && [...s.preview]])).toEqual([
      ['s1', [1, 2, 3], [4, 5]],
      ['s2', [6], undefined],
    ]);
    expect(back.texts[0]).toMatchObject({ id: 't1', title: 'Example', chars: 5 });
    expect([...back.texts[0].gz]).toEqual([9, 9]);
  });

  test('refuses anything that is not a dude export', async () => {
    const { zipSync } = await import('fflate');
    expect(() => unpack(zipSync({ 'hello.txt': strToU8('hi') }))).toThrow(/not a dude export/);
  });
});
