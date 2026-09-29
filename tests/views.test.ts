// Derived views (src/core/views.ts): visit times and pauses on the rows.
import { describe, expect, test } from 'vitest';
import { buildView, type SessionData } from '@/core/views';

const MIN = 60_000;
// A → B → C, then back to B and on to D two hours later.
function session(): SessionData {
  const v = (id: string, at: number, parentId?: string, children: string[] = []) => ({
    id, url: `https://x.example/${id}`, normUrl: `x.example/${id}`, parentId, children, firstAt: at, lastAt: at, edge: 'link', screenshots: [],
  });
  const visits = {
    A: v('A', 0, undefined, ['B']),
    B: v('B', 1 * MIN, 'A', ['C', 'D']),
    C: v('C', 3 * MIN, 'B'),
    D: v('D', 3 * MIN + 120 * MIN, 'B'),
  };
  return { session: { id: 's1', rootId: 'A', cursorId: 'D', moves: [], visitIds: Object.keys(visits) }, visits } as unknown as SessionData;
}

describe('row times', () => {
  test('tree rows carry their time and the pause since the page opened before', () => {
    const rows = Object.fromEntries(buildView(session(), 'tree').rows.map((r) => [r.key, r]));
    expect(rows.A.at).toBe(0);
    expect(rows.A.pause).toBeUndefined();
    expect(rows.B.pause).toBe(1 * MIN);
    expect(rows.C.pause).toBe(2 * MIN);
    expect(rows.D.pause).toBe(120 * MIN); // measured from C, the page opened before D
  });
  test('network rows have a time but no pause', () => {
    const rows = buildView(session(), 'network').rows;
    expect(rows.every((r) => typeof r.at === 'number' && r.pause === undefined)).toBe(true);
  });
});
