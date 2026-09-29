// The session list on the sessions page: cards grouped by day or by site, and within a
// group the tabs opened from another tab indented below it.

import type { SessionCard } from '@/background/protocol';

export type GroupBy = 'day' | 'site';
export interface ListItem {
  card: SessionCard;
  /** 0 for a tab of its own; 1, 2, … below the tab it was opened from (capped). */
  depth: number;
}
export interface Group {
  label: string;
  items: ListItem[];
}

const MAX_DEPTH = 4;

export function dayLabel(t: number, now = Date.now()): string {
  const d = new Date(t).toDateString();
  if (d === new Date(now).toDateString()) return 'Today';
  if (d === new Date(now - 864e5).toDateString()) return 'Yesterday';
  return new Date(t).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

/** `cards` newest first (by last activity), as the background sends them. */
export function groupCards(cards: SessionCard[], by: GroupBy, now = Date.now()): Group[] {
  const groups = new Map<string, SessionCard[]>();
  for (const c of cards) {
    const label = by === 'day' ? dayLabel(c.lastAt, now) : (c.host ?? 'other');
    groups.set(label, [...(groups.get(label) ?? []), c]);
  }
  // groups come in the order of their newest session, since `cards` is newest first
  return [...groups].map(([label, list]) => ({ label, items: nest(list) }));
}

/** Children below their parent when both are in the group; families ordered by their newest activity. */
function nest(list: SessionCard[]): ListItem[] {
  const inGroup = new Map(list.map((c) => [c.id, c]));
  const kids = new Map<string, SessionCard[]>();
  const roots: SessionCard[] = [];
  for (const c of list) {
    const p = c.spawnedFrom?.sessionId;
    if (p && inGroup.has(p) && p !== c.id) kids.set(p, [...(kids.get(p) ?? []), c]);
    else roots.push(c);
  }
  const newest = new Map<string, number>();
  const familyNewest = (c: SessionCard, seen = new Set<string>()): number => {
    if (newest.has(c.id)) return newest.get(c.id)!;
    seen.add(c.id);
    const t = Math.max(c.lastAt, ...(kids.get(c.id) ?? []).filter((k) => !seen.has(k.id)).map((k) => familyNewest(k, seen)));
    newest.set(c.id, t);
    return t;
  };
  const out: ListItem[] = [];
  const placed = new Set<string>();
  const walk = (c: SessionCard, depth: number) => {
    if (placed.has(c.id)) return;
    placed.add(c.id);
    out.push({ card: c, depth: Math.min(depth, MAX_DEPTH) });
    for (const k of (kids.get(c.id) ?? []).sort((a, b) => a.createdAt - b.createdAt)) walk(k, depth + 1);
  };
  for (const r of roots.sort((a, b) => familyNewest(b) - familyNewest(a))) walk(r, 0);
  // a cycle of "opened from" (shouldn't happen) would leave cards out: keep them anyway
  for (const c of list) if (!placed.has(c.id)) walk(c, 0);
  return out;
}
