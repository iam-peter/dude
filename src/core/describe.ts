// Compact text rendering of the projection, for tests and debugging.
//
//   s3 tab 5 open  from s1@/newtab (link)
//     /b "Page B"
//       /c *
//
// Markers: * cursor · (jump|form|spa|spawn|unknown) edge · POST · ↻n reloads ·
// via[/rjs] redirect hops · ⤳ server redirect · {inh} inherited copy · #n fragments ·
// +n same-URL pushes. Lifecycle: ~ heuristic match (Chrome), ~? with medium confidence.

import type { State, Visit } from './model';

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1):8765/;

export function shortUrl(url: string): string {
  if (LOCAL.test(url)) return (url.includes('127.0.0.1') ? '[127]' : '') + url.replace(LOCAL, '');
  return url.replace(/^https?:\/\//, '');
}

export function describeSession(st: State, sessionId: string, { titles = false } = {}): string {
  const s = st.sessions[sessionId];
  if (!s) return `${sessionId} (gone)`;
  let head = `${s.id} ${s.closedAt === undefined ? 'open' : 'closed'}`;
  if (s.spawnedFrom) {
    const v = s.spawnedFrom.visitId ? st.visits[s.spawnedFrom.visitId] : undefined;
    head += `  from ${s.spawnedFrom.sessionId}@${v ? shortUrl(v.url) : '?'} (${s.spawnedFrom.kind})`;
  }
  // Heuristic matches (Chrome) are marked ~ (high confidence) or ~? (medium).
  const kinds = s.lifecycle
    .filter((l) => l.kind !== 'closed')
    .map((l) => l.kind + (l.matchedBy === 'heuristic' ? (l.confidence === 'high' ? '~' : '~?') : ''));
  if (kinds.length) head += `  [${kinds.join(', ')}]`;
  const lines = [head];
  const walk = (id: string, depth: number) => {
    const v = st.visits[id];
    lines.push('  '.repeat(depth + 1) + describeVisit(v, id === s.cursorId, titles));
    for (const c of v.children) walk(c, depth + 1);
  };
  if (s.rootId) walk(s.rootId, 0);
  return lines.join('\n');
}

function describeVisit(v: Visit, cursor: boolean, titles: boolean): string {
  const parts = [shortUrl(v.url)];
  if (titles && v.title) parts.push(JSON.stringify(v.title));
  if (v.edge !== 'link') parts.push(`(${v.edge})`);
  if (v.method === 'post') parts.push('POST');
  if (v.redirected) parts.push('⤳');
  if (v.redirectChain.length) parts.push(`via[${v.redirectChain.map(shortUrl).join(' ')}]`);
  if (v.reloadCount) parts.push(`↻${v.reloadCount}`);
  if (v.fragments.length) parts.push(`#${v.fragments.length}`);
  if (v.samePushes) parts.push(`+${v.samePushes}`);
  if (v.inheritedFrom) parts.push('{inh}');
  if (cursor) parts.push('*');
  return parts.join(' ');
}

/** All sessions in creation order. */
export function describeAll(st: State, opts?: { titles?: boolean }): string {
  return Object.keys(st.sessions)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    .map((id) => describeSession(st, id, opts))
    .join('\n');
}

/**
 * Sessions created or re-bound at or after `since`, with session ids renumbered in order of
 * appearance (s1, s2, …) so the text is stable across runs (E2E expectations).
 */
export function describeSince(st: State, since: number): string {
  const ids = Object.keys(st.sessions)
    .filter((id) => {
      const s = st.sessions[id];
      return s.visitIds.length > 0 && (s.createdAt >= since || s.lifecycle.some((l) => l.kind !== 'closed' && l.at >= since));
    })
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  return normalizeIds(ids.map((id) => describeSession(st, id)).join('\n'));
}

export function normalizeIds(text: string): string {
  const map = new Map<string, string>();
  return text.replace(/\bs\d+\b/g, (id) => {
    if (!map.has(id)) map.set(id, `s${map.size + 1}`);
    return map.get(id)!;
  });
}

