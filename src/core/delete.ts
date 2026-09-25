// Real delete (SPEC §12): a visit, a session, a domain or a time range. The log is the
// source of truth, so deleting rewrites it — page content goes, the tab structure stays
// (with URLs and titles stripped) — and the projection is rebuilt from what is left.

import type { State } from './model';
import type { Observation } from './observations';
import { withoutHash } from './url';

export type DeleteWhat =
  | { kind: 'visit'; visitId: string }
  | { kind: 'session'; sessionId: string }
  | { kind: 'domain'; host: string }
  | { kind: 'range'; from: number; to: number };

/** null: drop the observation; an observation: keep that (possibly stripped) version. */
export type Rewrite = (o: Observation) => Observation | null;

const STRUCTURE = new Set<Observation['type']>(['tab.identity', 'tab.removed', 'tab.activated', 'tab.attached', 'window.focus', 'recorder.pause']);

function urlOf(o: Observation): string | undefined {
  switch (o.type) {
    case 'page.click':
      return o.href;
    case 'page.submit':
      return o.action;
    case 'tab.reopened':
      return o.visitUrl;
    default:
      return 'url' in o ? (o as { url?: string }).url : undefined;
  }
}

const tabOf = (o: Observation) => ('tabId' in o ? (o as { tabId?: number }).tabId : undefined);

type ImportedItem = Extract<Observation, { type: 'history.import' }>['items'][number];

/**
 * Build the log rewrite for one deletion. `hit(url, tabId, t)` decides whether something
 * at that URL, in that tab, at that time, is covered by the deletion; `itemHit` does the
 * same for imported Chrome history, which has no tabs.
 */
function rewriteFor(hit: (url: string | undefined, tabId: number | undefined, t: number) => boolean, itemHit: (it: ImportedItem) => boolean = () => false): Rewrite {
  return (o) => {
    if (STRUCTURE.has(o.type)) return o;
    if (o.type === 'history.import') {
      const items = o.items.filter((it) => !itemHit(it));
      if (items.length === o.items.length) return o;
      return items.length ? { ...o, items } : null;
    }
    if (o.type === 'recorder.wake') {
      const tabs = o.tabs.map((w) => (hit(w.url, w.tabId, o.t) ? { ...w, url: undefined, title: undefined } : w));
      return { ...o, tabs };
    }
    if (o.type === 'tab.created') return hit(o.url, o.tabId, o.t) ? { ...o, url: undefined } : o;
    if (o.type === 'nav.target') return hit(o.url, o.sourceTabId, o.t) || hit(o.url, o.tabId, o.t) ? { ...o, url: '' } : o;
    return hit(urlOf(o), tabOf(o), o.t) ? null : o;
  };
}

const hostMatches = (url: string | undefined, host: string) => {
  if (!url) return false;
  try {
    const h = new URL(url).hostname.toLowerCase();
    const d = host.trim().toLowerCase();
    return h === d || h.endsWith('.' + d);
  } catch {
    return false;
  }
};

export function deletion(st: State, what: DeleteWhat): Rewrite {
  switch (what.kind) {
    case 'domain':
      return rewriteFor(
        (url) => hostMatches(url, what.host),
        (it) => hostMatches(it.url, what.host),
      );
    case 'range':
      return rewriteFor(
        (_url, _tab, t) => t >= what.from && t < what.to,
        (it) => it.at >= what.from && it.at < what.to,
      );
    case 'session': {
      const s = st.sessions[what.sessionId];
      if (!s) return (o) => o;
      const mine = importedIn(st, (visitId) => st.visits[visitId]?.sessionId === s.id);
      const inSession = (tabId: number | undefined, t: number) =>
        tabId !== undefined && s.bindings.some((b) => b.tabId === tabId && t >= b.from - 1 && (b.to === undefined || t <= b.to));
      const urls = new Set(s.visitIds.map((id) => withoutHash(st.visits[id]?.url ?? '')));
      return (o) => {
        // Tabs reopened from this session's pages lose that link.
        if (o.type === 'tab.reopened' && urls.has(withoutHash(o.visitUrl))) return null;
        return rewriteFor(
          (_url, tabId, t) => inSession(tabId, t),
          (it) => mine.has(it.id),
        )(o);
      };
    }
    case 'visit': {
      const v = st.visits[what.visitId];
      const s = v && st.sessions[v.sessionId];
      if (!v || !s) return (o) => o;
      const urls = new Set([v.url, ...v.aliases, ...v.redirectChain].map(withoutHash));
      const tabs = s.bindings.map((b) => b.tabId);
      // The click (or intent) that led to the page comes before its first commit — up to the
      // 5 s the projector allows between the two.
      const mine = importedIn(st, (visitId) => visitId === v.id);
      return rewriteFor(
        (url, tabId, t) => !!url && urls.has(withoutHash(url)) && tabId !== undefined && tabs.includes(tabId) && t >= v.firstAt - 5000 && t <= v.lastAt + 60_000,
        (it) => mine.has(it.id),
      );
    }
  }
}

/** Chrome visit ids of imported history whose visits pass `keep`. */
function importedIn(st: State, keep: (visitId: string) => boolean): Set<string> {
  return new Set(Object.entries(st.imported ?? {}).flatMap(([chromeId, visitId]) => (keep(visitId) ? [chromeId] : [])));
}

