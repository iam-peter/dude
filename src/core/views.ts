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
  /** First visit of the row. */
  at: number;
  /** Tree modes: time since the page opened before this one in the tab (none for the first). */
  pause?: number;
  /** A folded run of pages (foldRuns): how many, and their sites in order. */
  fold?: { count: number; hosts: string[]; interstitial: boolean };
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
      at: v.firstAt,
    });
    if (parentRow !== undefined) links.push({ from: parentRow, to: i, kind: 'tree' });
    for (const c of v.children) walk(c, depth + 1, i);
  };
  if (s.rootId) walk(s.rootId, 0);

  // Pauses: time between one page opening and the next, in the order they were opened.
  const byTime = [...rows].sort((a, b) => a.at - b.at);
  byTime.forEach((r, k) => k > 0 && (r.pause = r.at - byTime[k - 1].at));

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
      rows.push({ key: v.normUrl, visitIds: [], depth: 0, url: v.url, title: v.title, favIconUrl: v.favIconUrl, edge: v.edge, cursor: false, onPath: false, inherited: !!v.inheritedFrom, visits: 0, at: v.firstAt });
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

/** Fold runs of at least this many pages that each have one page before and one after. */
export const FOLD_MIN = 3;
/** Consent, login and SSO bounces: folded even alone when passed quickly (R7, S1 #24). */
const INTERSTITIAL = /^(consent\.|accounts\.google\.|login\.|signin\.|auth\.|sso\.|idp\.)|\/(consent|login|signin|oauth2?|authorize|sso)(\/|\?|$)/i;
const INTERSTITIAL_MAX_DWELL = 15_000;

const hostOf = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
};

export function isInterstitial(v: Pick<Visit, 'url' | 'dwellMs'>): boolean {
  if (v.dwellMs > INTERSTITIAL_MAX_DWELL) return false;
  try {
    const u = new URL(v.url);
    return INTERSTITIAL.test(u.host) || INTERSTITIAL.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Tree views only: replace straight runs of pages (each with one page before and one
 * after, at least FOLD_MIN in a row) and quick consent/login bounces by one row. The pages
 * before and after a run stay visible. Rows `keep` says yes to (the current page, pages
 * tabs were opened from) and folds listed in `expanded` are never folded. Links into a
 * fold attach to it; links inside it are dropped.
 */
export function foldRuns(view: View, visits: Record<string, Visit>, opts: { expanded?: ReadonlySet<string>; keep?: (row: Row) => boolean } = {}): View {
  const { rows, links } = view;
  const parent = new Map<number, number>();
  const kids = new Map<number, number[]>();
  for (const l of links) {
    if (l.kind !== 'tree') continue;
    parent.set(l.to, l.from);
    kids.set(l.from, [...(kids.get(l.from) ?? []), l.to]);
  }
  const foldable = (i: number) => parent.has(i) && kids.get(i)?.length === 1 && !rows[i].cursor && !opts.keep?.(rows[i]);
  const bounce = (i: number) => rows[i].visitIds.every((id) => visits[id] && isInterstitial(visits[id]));

  // segments of foldable rows, each starting below a row that isn't foldable
  const segments: number[][] = [];
  rows.forEach((_, i) => {
    if (!foldable(i) || foldable(parent.get(i)!)) return;
    const seg = [i];
    for (let c = kids.get(i)![0]; foldable(c); c = kids.get(c)![0]) seg.push(c);
    segments.push(seg);
  });

  const into = new Map<number, number>(); // old row → folded row (new index)
  const fold = new Map<number, number[]>(); // first old row of a fold → its rows
  for (const seg of segments) {
    const key = `fold:${rows[seg[0]].key}`;
    if (opts.expanded?.has(key)) continue;
    if (seg.length >= FOLD_MIN || seg.every(bounce)) fold.set(seg[0], seg);
  }
  if (!fold.size) return view;

  const out: Row[] = [];
  const index = new Map<number, number>();
  rows.forEach((r, i) => {
    const seg = fold.get(i);
    if (seg) {
      const first = rows[seg[0]];
      const hosts = [...new Set(seg.map((k) => hostOf(rows[k].url)))];
      const interstitial = seg.every(bounce);
      out.push({
        ...first,
        key: `fold:${first.key}`,
        visitIds: seg.flatMap((k) => rows[k].visitIds),
        title: interstitial ? `via ${hosts.join(', ')}` : `${seg.length} pages`,
        cursor: false,
        onPath: seg.some((k) => rows[k].onPath),
        inherited: seg.every((k) => rows[k].inherited),
        visits: seg.reduce((n, k) => n + rows[k].visits, 0),
        fold: { count: seg.length, hosts, interstitial },
      });
      for (const k of seg) into.set(k, out.length - 1);
      return;
    }
    if (into.has(i)) return;
    index.set(i, out.length);
    out.push(r);
  });
  const at = (i: number) => index.get(i) ?? into.get(i)!;
  const seen = new Set<string>();
  const outLinks: Link[] = [];
  for (const l of links) {
    const from = at(l.from);
    const to = at(l.to);
    if (from === to) continue;
    // moves keep every occurrence (they carry their order); tree and same-page links once
    const key = `${l.kind}:${from}>${to}`;
    if (l.kind !== 'back' && l.kind !== 'forward') {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    outLinks.push({ ...l, from, to });
  }
  return { rows: out, links: outLinks };
}

