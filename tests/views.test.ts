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

import { foldRuns } from '@/core/views';

// Build a session from a parent map; visits open a minute apart, 60 s dwell each.
function chain(spec: Record<string, string | undefined>, opts: { cursor: string; urls?: Record<string, string>; dwell?: Record<string, number>; moves?: { from: string; to: string; dir: 'back' | 'forward' }[] }): SessionData {
  const ids = Object.keys(spec);
  const visits: Record<string, unknown> = {};
  ids.forEach((id, k) => {
    visits[id] = {
      id, url: opts.urls?.[id] ?? `https://x.example/${id}`, normUrl: `x.example/${id}`, parentId: spec[id],
      children: ids.filter((c) => spec[c] === id), firstAt: k * MIN, lastAt: k * MIN, dwellMs: opts.dwell?.[id] ?? 60_000, edge: 'link', screenshots: [],
    };
  });
  const root = ids.find((id) => !spec[id]);
  return { session: { id: 's', rootId: root, cursorId: opts.cursor, moves: opts.moves ?? [], visitIds: ids }, visits } as unknown as SessionData;
}
const keys = (v: { rows: { key: string }[] }) => v.rows.map((r) => r.key);

describe('foldRuns', () => {
  const straight = { A: undefined, B: 'A', C: 'B', D: 'C', E: 'D', F: 'E' };

  test('a straight run folds between the pages before and after it', () => {
    const d = chain(straight, { cursor: 'F' });
    const v = foldRuns(buildView(d, 'tree'), d.visits);
    expect(keys(v)).toEqual(['A', 'fold:B', 'F']);
    expect(v.rows[1].fold).toEqual({ count: 4, hosts: ['x.example'], interstitial: false });
    expect(v.rows[1].visitIds).toEqual(['B', 'C', 'D', 'E']);
    expect(v.links.map((l) => `${l.from}>${l.to}`)).toEqual(['0>1', '1>2']);
  });

  test('short runs, branch points, the current page and kept pages stay', () => {
    const d = chain({ A: undefined, B: 'A', C: 'B', D: 'C', X: 'B', Y: 'X' }, { cursor: 'D' });
    expect(keys(foldRuns(buildView(d, 'tree'), d.visits))).toEqual(['A', 'B', 'C', 'D', 'X', 'Y']); // B branches
    const e = chain(straight, { cursor: 'C' });
    expect(keys(foldRuns(buildView(e, 'tree'), e.visits))).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    const f = chain(straight, { cursor: 'F' });
    expect(keys(foldRuns(buildView(f, 'tree'), f.visits, { keep: (r) => r.key === 'D' }))).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  test('an expanded fold stays open', () => {
    const d = chain(straight, { cursor: 'F' });
    expect(keys(foldRuns(buildView(d, 'tree'), d.visits, { expanded: new Set(['fold:B']) }))).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  test('a quick consent bounce folds on its own', () => {
    const urls = { B: 'https://consent.youtube.com/m?continue=x' };
    const quick = chain({ A: undefined, B: 'A', C: 'B' }, { cursor: 'C', urls, dwell: { B: 900 } });
    const v = foldRuns(buildView(quick, 'tree'), quick.visits);
    expect(keys(v)).toEqual(['A', 'fold:B', 'C']);
    expect(v.rows[1].title).toBe('via consent.youtube.com');
    const slow = chain({ A: undefined, B: 'A', C: 'B' }, { cursor: 'C', urls, dwell: { B: 60_000 } });
    expect(keys(foldRuns(buildView(slow, 'tree'), slow.visits))).toEqual(['A', 'B', 'C']);
  });

  test('moves into a fold attach to it, moves inside it disappear', () => {
    const moves = [
      { from: 'F', to: 'D', dir: 'back' as const },
      { from: 'D', to: 'C', dir: 'back' as const },
    ];
    const d = chain(straight, { cursor: 'F', moves });
    const v = foldRuns(buildView(d, 'moves'), d.visits);
    const m = v.links.filter((l) => l.kind === 'back');
    expect(m.map((l) => `${v.rows[l.from].key}>${v.rows[l.to].key}#${l.n}`)).toEqual(['F>fold:B#1']);
  });
});
