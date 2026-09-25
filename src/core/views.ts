// Derived renderings of one session (SPEC §5.2): Tree, Tree + moves, Network. All three
// come from the same projection; switching never changes stored data.

import type { EdgeKind, Session, Visit } from './model';

export type ViewMode = 'tree' | 'moves' | 'network';

export interface Row {
  key: string;
  /** Visits shown by this row: one in tree modes, all visits of a normUrl in network mode. */
  visitIds: string[];
  depth: number;
  url: string;
  title?: string;
  favIconUrl?: string;
  edge: EdgeKind;
  cursor: boolean;
  /** On the path root → cursor (the tab's current back stack as far as we know). */
  onPath: boolean;
  inherited: boolean;
  visits: number;
}

export interface Link {
  from: number; // row index
  to: number;
  kind: 'tree' | 'same' | 'back' | 'forward' | 'net';
  /** Order of a move (1 = first) or number of traversals in network mode. */
  n?: number;
}

export interface View {
  rows: Row[];
  links: Link[];
}

export interface SessionData {
  session: Session;
  visits: Record<string, Visit>;
}

export function buildView({ session: s, visits }: SessionData, mode: ViewMode): View {
  return mode === 'network' ? network(s, visits) : tree(s, visits, mode === 'moves');
}

function pathToCursor(s: Session, visits: Record<string, Visit>): Set<string> {
  const path = new Set<string>();
  for (let id = s.cursorId; id; id = visits[id]?.parentId) path.add(id);
  return path;
}

/** Depth-first, children in creation order: a branch stays together below its fork. */
function tree(s: Session, visits: Record<string, Visit>, withMoves: boolean): View {
  const rows: Row[] = [];
  const index = new Map<string, number>();
  const links: Link[] = [];
  const path = pathToCursor(s, visits);

  const walk = (id: string, depth: number, parentRow?: number) => {
    const v = visits[id];
    if (!v) return;
    const i = rows.length;
    index.set(id, i);
    rows.push({
      key: id,
      visitIds: [id],
      depth,
      url: v.url,
      title: v.title,
      favIconUrl: v.favIconUrl,
      edge: v.edge,
      cursor: id === s.cursorId,
      onPath: path.has(id),
      inherited: !!v.inheritedFrom,
      visits: 1,
    });
    if (parentRow !== undefined) links.push({ from: parentRow, to: i, kind: 'tree' });
    for (const c of v.children) walk(c, depth + 1, i);
  };
  if (s.rootId) walk(s.rootId, 0);

  // Faint "same page" connectors between consecutive rows sharing a normUrl (B2).
  const lastByNorm = new Map<string, number>();
  rows.forEach((r, i) => {
    const norm = visits[r.key].normUrl;
    const prev = lastByNorm.get(norm);
    if (prev !== undefined) links.push({ from: prev, to: i, kind: 'same' });
    lastByNorm.set(norm, i);
  });

  if (withMoves) {
    s.moves.forEach((m, k) => {
      const from = m.from ? index.get(m.from) : undefined;
      const to = index.get(m.to);
      if (from !== undefined && to !== undefined && from !== to) links.push({ from, to, kind: m.dir, n: k + 1 });
    });
  }
  return { rows, links };
}

/** One node per distinct normUrl; tree edges and moves collapse onto them, so cycles show (B2). */
function network(s: Session, visits: Record<string, Visit>): View {
  const byNorm = new Map<string, number>();
  const rows: Row[] = [];
  const path = pathToCursor(s, visits);
  const ordered = s.visitIds.map((id) => visits[id]).filter(Boolean).sort((a, b) => a.firstAt - b.firstAt);
  for (const v of ordered) {
    let i = byNorm.get(v.normUrl);
    if (i === undefined) {
      i = rows.length;
      byNorm.set(v.normUrl, i);
      rows.push({ key: v.normUrl, visitIds: [], depth: 0, url: v.url, title: v.title, favIconUrl: v.favIconUrl, edge: v.edge, cursor: false, onPath: false, inherited: !!v.inheritedFrom, visits: 0 });
    }
    const r = rows[i];
    r.visitIds.push(v.id);
    r.visits++;
    r.title ??= v.title;
    r.favIconUrl ??= v.favIconUrl;
    if (v.id === s.cursorId) r.cursor = true;
    if (path.has(v.id)) r.onPath = true;
  }
  const weights = new Map<string, Link>();
  const add = (fromVisit: string | undefined, toVisit: string) => {
    const a = fromVisit ? visits[fromVisit] : undefined;
    const b = visits[toVisit];
    if (!a || !b) return;
    const from = byNorm.get(a.normUrl)!;
    const to = byNorm.get(b.normUrl)!;
    if (from === to) return;
    const key = `${from}>${to}`;
    const l = weights.get(key) ?? { from, to, kind: 'net' as const, n: 0 };
    l.n = (l.n ?? 0) + 1;
    weights.set(key, l);
  };
  for (const v of ordered) if (v.parentId) add(v.parentId, v.id);
  for (const m of s.moves) add(m.from, m.to);
  return { rows, links: [...weights.values()] };
}
