// The projector: a deterministic reducer from observations to sessions and visits
// (SPEC §5, §6). Same log in → same state out, so the projection can always be rebuilt.
// It mutates `st` in place (the background owns one state) and returns the ids of the
// sessions it touched. Rule references "S1 #n" point at docs/S1-FINDINGS.md.

import type { Observation } from './observations';
import type { EdgeKind, Session, State, TabState, Visit } from './model';
import { isRecordable, normUrl, pathOrQueryChanged, searchQuery, withoutHash } from './url';
import { EXCLUDED_URL } from './privacy';

const CLIENT_REDIRECT_MS = 1500; // S1 #5, #6, #22
const RESTORE_WINDOW_MS = 1500; // S1 #15, #17
const SPA_DEBOUNCE_MS = 500; // B5
const PROBE_MATCH_MS = 1000; // S1 #30
const CLICK_MATCH_MS = 5000; // SPEC §6.2
const UNFOCUS_DEBOUNCE_MS = 300; // S1 #27
const ADOPT_MS = 5000;
export const MAX_SHOTS = 5; // D5

const JUMP_TRANSITIONS = new Set(['typed', 'generated', 'auto_bookmark', 'keyword', 'keyword_generated', 'start_page', 'auto_toplevel']);

export function apply(st: State, o: Observation): Set<string> {
  const changed = new Set<string>();
  tickDwell(st, o.t);
  const ctx: Ctx = { st, changed, t: o.t };

  switch (o.type) {
    case 'tab.created':
      onTabCreated(ctx, o);
      break;
    case 'tab.identity':
      identify(ctx, ensureTab(ctx, o.tabId), o.value, o.copiedFrom);
      break;
    case 'tab.removed':
      onTabRemoved(ctx, o.tabId);
      break;
    case 'tab.activated':
      st.focus.activeByWindow[o.windowId] = o.tabId;
      break;
    case 'tab.attached': {
      const s = sessionOfTab(ctx, o.tabId);
      s.windowId = o.windowId;
      s.lifecycle.push({ kind: 'moved-window', at: o.t, windowId: o.windowId });
      changed.add(s.id);
      break;
    }
    case 'tab.updated':
      onTabUpdated(ctx, o);
      break;
    case 'window.focus':
      if (o.windowId === -1) {
        st.focus.unfocusedAt ??= o.t;
      } else {
        st.focus.windowId = o.windowId;
        st.focus.unfocusedAt = undefined;
      }
      break;
    case 'nav.target':
      onTarget(ctx, o.tabId, o.sourceTabId);
      break;
    case 'nav.committed':
      onCommitted(ctx, o);
      break;
    case 'nav.history':
      onHistoryState(ctx, o);
      break;
    case 'nav.fragment':
      onFragment(ctx, o);
      break;
    case 'nav.completed': {
      const tab = st.tabs[o.tabId];
      if (tab) tab.lastCompletedAt = o.t;
      break;
    }
    case 'page.click': {
      const tab = ensureTab(ctx, o.tabId);
      tab.click = { href: o.href, text: o.text, t: o.t, newTab: o.newTab };
      break;
    }
    case 'page.submit': {
      const tab = ensureTab(ctx, o.tabId);
      tab.submit = { method: o.method, t: o.t };
      break;
    }
    case 'page.history':
      onProbe(ctx, o);
      break;
    case 'recorder.wake':
      onWake(ctx, o);
      break;
    case 'page.capture':
    case 'page.text':
      onMedia(ctx, o);
      break;
    case 'nav.intent': {
      // Counts like a click on a link to `url`: the next commit is a navigation, not a redirect.
      const tab = ensureTab(ctx, o.tabId);
      tab.click = { href: o.url, text: '', t: o.t, newTab: false };
      break;
    }
    case 'tab.reopened':
      onReopened(ctx, o);
      break;
    case 'recorder.pause':
      onPause(ctx, o);
      break;
    case 'history.import':
      onHistoryImport(ctx, o);
      break;
  }

  resumeDwell(st, o.t);
  return changed;
}

interface Ctx {
  st: State;
  changed: Set<string>;
  t: number;
}

// ---------------------------------------------------------------- sessions and tabs

function newSession(ctx: Ctx, tabId: number, windowId: number): Session {
  const s: Session = {
    id: `s${++ctx.st.nextId}`,
    tabId,
    lastTabId: tabId,
    windowId,
    createdAt: ctx.t,
    lifecycle: [],
    bindings: [{ tabId, from: ctx.t }],
    moves: [],
    visitIds: [],
  };
  ctx.st.sessions[s.id] = s;
  ctx.st.tabs[tabId] = { sessionId: s.id, boundAt: ctx.t, probes: [] };
  ctx.changed.add(s.id);
  return s;
}

/** Tab state for an id, creating a session for tabs that predate the recorder. */
function ensureTab(ctx: Ctx, tabId: number): TabState {
  if (!ctx.st.tabs[tabId]) newSession(ctx, tabId, -1);
  return ctx.st.tabs[tabId];
}

function sessionOfTab(ctx: Ctx, tabId: number): Session {
  return ctx.st.sessions[ensureTab(ctx, tabId).sessionId];
}

function onTabCreated(ctx: Ctx, o: Extract<Observation, { type: 'tab.created' }>) {
  if (ctx.st.tabs[o.tabId]) return; // already adopted from a wake snapshot
  const s = newSession(ctx, o.tabId, o.windowId);
  ctx.st.tabs[o.tabId].openerTabId = o.openerTabId;
  const pending = ctx.st.pendingTargets[o.tabId];
  if (pending) {
    spawn(ctx, s, pending.sourceTabId);
    delete ctx.st.pendingTargets[o.tabId];
  }
  if (o.tabValue) identify(ctx, ctx.st.tabs[o.tabId], o.tabValue, o.copiedFrom);
}

/** Link opened in a new tab (B9). Chromium sends this after tabs.onCreated, Firefox sometimes before (S1 #12). */
function onTarget(ctx: Ctx, tabId: number, sourceTabId: number) {
  const tab = ctx.st.tabs[tabId];
  if (!tab) {
    ctx.st.pendingTargets[tabId] = { sourceTabId, t: ctx.t };
    return;
  }
  const s = ctx.st.sessions[tab.sessionId];
  if (!s.spawnedFrom && s.visitIds.length === 0) spawn(ctx, s, sourceTabId);
}

function spawn(ctx: Ctx, s: Session, sourceTabId: number) {
  const src = ctx.st.tabs[sourceTabId];
  if (!src) return;
  const from = ctx.st.sessions[src.sessionId];
  s.spawnedFrom = { sessionId: from.id, visitId: from.cursorId, kind: 'link' };
  // The click that opened the tab happened in the source tab (C1 anchor text).
  if (src.click?.newTab && ctx.t - src.click.t <= CLICK_MATCH_MS) {
    ctx.st.tabs[s.tabId!].click = { ...src.click, newTab: false };
  }
  ctx.changed.add(s.id);
  ctx.changed.add(from.id);
}

function onTabRemoved(ctx: Ctx, tabId: number) {
  const tab = ctx.st.tabs[tabId];
  if (!tab) return;
  const s = ctx.st.sessions[tab.sessionId];
  close(ctx, s, 'closed');
  delete ctx.st.tabs[tabId];
}

function close(ctx: Ctx, s: Session, kind: 'closed' | 'gone-at-wake') {
  const b = s.bindings.at(-1);
  if (b && b.to === undefined) b.to = ctx.t;
  s.closedAt = ctx.t;
  s.tabId = undefined;
  s.lifecycle.push({ kind, at: ctx.t, windowId: s.windowId });
  ctx.changed.add(s.id);
}

/**
 * Firefox stable tab value (B11, B13, S1 #15–17, #25). A value held by another *open*
 * tab means duplicate: fork. A value of a closed session means restore: continue it.
 */
function identify(ctx: Ctx, tab: TabState, value: string, copiedFrom?: string) {
  if (tab.seenValue === value) return;
  tab.seenValue = value;
  const { st } = ctx;
  const p = st.sessions[tab.sessionId];
  if (p.tabValue === value) return;

  const known = st.byValue[copiedFrom ?? value];
  const s = known ? st.sessions[known] : undefined;
  if (!s || s.id === p.id) {
    p.tabValue = value;
    st.byValue[value] = p.id;
    ctx.changed.add(p.id);
    return;
  }

  const sourceOpen = s.tabId !== undefined && s.tabId !== p.tabId && st.tabs[s.tabId]?.sessionId === s.id;
  if (copiedFrom || sourceOpen) {
    fork(ctx, p, s);
    if (copiedFrom) {
      p.tabValue = value;
      st.byValue[value] = p.id;
    }
  } else {
    restoreInto(ctx, p, s, 'restored-closed-tab');
  }
}

/** Duplicate tab: new session whose tree starts with copies of the source's path (B13). */
function fork(ctx: Ctx, p: Session, src: Session) {
  const lastUrl = p.cursorId ? ctx.st.visits[p.cursorId].url : undefined;
  discardVisits(ctx, p);
  p.spawnedFrom = { sessionId: src.id, visitId: src.cursorId, kind: 'duplicate' };
  const path: Visit[] = [];
  for (let id = src.cursorId; id; id = ctx.st.visits[id].parentId) path.unshift(ctx.st.visits[id]);
  let parent: string | undefined;
  for (const v of path) {
    const copy = addVisit(ctx, p, parent, {
      url: v.url,
      title: v.title,
      favIconUrl: v.favIconUrl,
      transition: v.transition,
      edge: v.edge,
      createdBy: 'inherit',
    });
    copy.inheritedFrom = v.id;
    copy.redirectChain = [...v.redirectChain];
    parent = copy.id;
  }
  p.cursorId = parent;
  if (lastUrl) moveTo(ctx, p, lastUrl, false);
  ctx.st.tabs[p.tabId!].restoringUntil = ctx.t + RESTORE_WINDOW_MS;
  ctx.changed.add(src.id);
}

/** Restored tab continues its old session; the provisional one is dropped (B11, B12). */
type RestoreKind = 'restored-closed-tab' | 'restored-startup';
type Match = { matchedBy: 'tabValue' } | { matchedBy: 'heuristic'; confidence: 'high' | 'medium' };
const BY_VALUE: Match = { matchedBy: 'tabValue' };

function restoreInto(ctx: Ctx, p: Session, s: Session, kind: RestoreKind, match: Match = BY_VALUE) {
  const lastUrl = p.cursorId ? ctx.st.visits[p.cursorId].url : undefined;
  const tabId = p.tabId!;
  discardVisits(ctx, p);
  delete ctx.st.sessions[p.id];
  ctx.changed.add(p.id);
  bind(ctx, s, tabId, kind, match);
  if (lastUrl) moveTo(ctx, s, lastUrl, false);
}

function bind(ctx: Ctx, s: Session, tabId: number, kind: RestoreKind, match: Match = BY_VALUE) {
  // After a restart the session may still be bound to its pre-restart tab id.
  if (s.tabId !== undefined && s.tabId !== tabId && ctx.st.tabs[s.tabId]?.sessionId === s.id) delete ctx.st.tabs[s.tabId];
  const tab = ctx.st.tabs[tabId] ?? { sessionId: s.id, boundAt: ctx.t, probes: [] };
  tab.sessionId = s.id;
  tab.seenValue = s.tabValue;
  tab.restoringUntil = ctx.t + RESTORE_WINDOW_MS;
  ctx.st.tabs[tabId] = tab;
  const last = s.bindings.at(-1);
  if (last && last.to === undefined) last.to = ctx.t;
  s.bindings.push({ tabId, from: ctx.t });
  s.tabId = tabId;
  s.lastTabId = tabId;
  s.closedAt = undefined;
  s.lifecycle.push({ kind, at: ctx.t, ...match });
  ctx.changed.add(s.id);
}

function discardVisits(ctx: Ctx, s: Session) {
  for (const id of s.visitIds) delete ctx.st.visits[id];
  s.visitIds = [];
  s.rootId = undefined;
  s.cursorId = undefined;
  s.moves = [];
}

/**
 * Chrome has no tab values. A brand-new tab whose first page commits as `reload` is
 * replaying history: a duplicate if its opener shows that page (S1 #14), otherwise a
 * restored tab, matched to the most recently closed session showing it (S1 #16, R2).
 */
function identifyByReplay(ctx: Ctx, tab: TabState, url: string) {
  const { st } = ctx;
  const p = st.sessions[tab.sessionId];
  if (p.tabValue || p.visitIds.length || p.spawnedFrom) return;

  const opener = tab.openerTabId !== undefined ? st.tabs[tab.openerTabId] : undefined;
  const src = opener ? st.sessions[opener.sessionId] : undefined;
  if (src?.cursorId && sameEntry(st.visits[src.cursorId], url)) {
    fork(ctx, p, src);
    return;
  }

  const cands = Object.values(st.sessions)
    .filter((c) => c.closedAt !== undefined && !c.tabValue && c.cursorId && sameEntry(st.visits[c.cursorId], url))
    .sort((a, b) => b.closedAt! - a.closedAt!);
  const m = cands[0];
  if (!m) return;
  const kind = m.lifecycle.at(-1)?.kind === 'gone-at-wake' ? 'restored-startup' : 'restored-closed-tab';
  restoreInto(ctx, p, m, kind, { matchedBy: 'heuristic', confidence: cands.length === 1 ? 'high' : 'medium' });
}

/** Snapshot after a (re)start: adopt unknown tabs, rebind restored ones, close vanished ones (B12, S1 #28). */
function onWake(ctx: Ctx, o: Extract<Observation, { type: 'recorder.wake' }>) {
  const { st } = ctx;
  const alive = new Set(o.tabs.map((w) => w.tabId));
  // Sessions whose tab is gone: after a browser restart these are the candidates for
  // Chrome's URL-based matching (R2); Firefox matches by tab value above all.
  const vanished = Object.values(st.sessions).filter((s) => s.tabId !== undefined && !alive.has(s.tabId));
  const used = new Set<string>();
  const urlCount = new Map<string, number>();
  for (const w of o.tabs) if (w.url) urlCount.set(withoutHash(w.url), (urlCount.get(withoutHash(w.url)) ?? 0) + 1);

  for (const w of o.tabs) {
    const tab = st.tabs[w.tabId];
    const cur = tab && st.sessions[tab.sessionId];
    const known = w.tabValue ? st.sessions[st.byValue[w.tabValue]] : undefined;
    // Same tab as before (no value, same value, or a first value for a known tab).
    if (cur && (!w.tabValue || cur.tabValue === w.tabValue || (!known && !cur.tabValue))) {
      cur.windowId = w.windowId;
      if (w.tabValue && !cur.tabValue) {
        cur.tabValue = w.tabValue;
        tab.seenValue = w.tabValue;
        st.byValue[w.tabValue] = cur.id;
      }
      continue;
    }
    if (known) {
      if (cur) close(ctx, cur, 'gone-at-wake'); // tab id reused after restart
      delete st.tabs[w.tabId];
      bind(ctx, known, w.tabId, 'restored-startup');
      known.windowId = w.windowId;
      if (w.url) moveTo(ctx, known, w.url, false);
      continue;
    }
    if (cur) {
      // Tab id reused after a restart by a tab we have never seen.
      close(ctx, cur, 'gone-at-wake');
      delete st.tabs[w.tabId];
    }
    if (!w.tabValue && isRecordable(w.url)) {
      const url = w.url;
      const cands = vanished.filter((v) => !used.has(v.id) && !v.tabValue && v.cursorId && sameEntry(st.visits[v.cursorId], url));
      if (cands.length) {
        const m = cands[0]; // oldest session first: keeps restored tabs in their original order
        used.add(m.id);
        delete st.tabs[m.tabId!];
        const confidence = cands.length === 1 && urlCount.get(withoutHash(url)) === 1 ? 'high' : 'medium';
        bind(ctx, m, w.tabId, 'restored-startup', { matchedBy: 'heuristic', confidence });
        m.windowId = w.windowId;
        continue;
      }
    }
    const s = newSession(ctx, w.tabId, w.windowId);
    if (w.tabValue) {
      s.tabValue = w.tabValue;
      st.tabs[w.tabId].seenValue = w.tabValue;
      st.byValue[w.tabValue] = s.id;
    }
    if (isRecordable(w.url)) {
      const v = addVisit(ctx, s, undefined, { url: w.url, title: w.title, transition: 'existing', edge: 'unknown', createdBy: 'wake' });
      s.cursorId = v.id;
    }
  }
  for (const s of vanished) {
    if (used.has(s.id) || s.tabId === undefined || alive.has(s.tabId)) continue;
    delete st.tabs[s.tabId];
    close(ctx, s, 'gone-at-wake');
  }
}

function onTabUpdated(ctx: Ctx, o: Extract<Observation, { type: 'tab.updated' }>) {
  const tab = ctx.st.tabs[o.tabId];
  if (!tab) return;
  const s = ctx.st.sessions[tab.sessionId];
  const v = s.cursorId ? ctx.st.visits[s.cursorId] : undefined;
  if (!v) return;
  if (o.url && !sameEntry(v, o.url)) return;
  if (o.title !== undefined) v.title = o.title;
  if (o.favIconUrl !== undefined) v.favIconUrl = o.favIconUrl;
  ctx.changed.add(s.id);
}

// ---------------------------------------------------------------- navigation

function onCommitted(ctx: Ctx, o: Extract<Observation, { type: 'nav.committed' }>) {
  const { st, t } = ctx;
  const tab = ensureTab(ctx, o.tabId);
  const prevCommitAt = tab.lastCommitAt;
  tab.lastCommitAt = t;
  if (!isRecordable(o.url)) return; // about:blank, extension and browser pages (S1 #19)

  const fb = o.qualifiers.includes('forward_back');
  if (o.transitionType === 'reload' && !fb) identifyByReplay(ctx, tab, o.url);
  const s = st.sessions[tab.sessionId];
  const cursor = s.cursorId ? st.visits[s.cursorId] : undefined;

  // Replays in a restored or duplicated tab set the cursor, they don't navigate (S1 #15–17).
  if (tab.restoringUntil !== undefined && t <= tab.restoringUntil) {
    if (moveTo(ctx, s, o.url, false)) return;
  }
  tab.restoringUntil = undefined;

  // Back/forward: decided by the qualifier only, never by the type (S1 #1, #2).
  if (fb) {
    if (moveTo(ctx, s, o.url, true)) return;
    // Entry from before recording started: put it above the root, or below the cursor.
    unknownEntry(ctx, s, o.url, cursor);
    return;
  }

  if (o.transitionType === 'reload') {
    if (cursor && sameEntry(cursor, o.url)) {
      cursor.reloadCount++;
      cursor.lastAt = t;
      ctx.changed.add(s.id);
      return;
    }
    if (moveTo(ctx, s, o.url, false)) return;
  }

  // Client redirect: explicit (Chromium, meta refresh) or inferred — a link commit with no
  // user gesture or submit since the previous commit, shortly after that commit or its load
  // (S1 #5, #6, #22; Google and YouTube reload before their first load has finished).
  const acted = (x?: { t: number }) => !!x && prevCommitAt !== undefined && x.t >= prevCommitAt;
  const since = Math.max(prevCommitAt ?? -Infinity, tab.lastCompletedAt ?? -Infinity);
  const inferred =
    o.transitionType === 'link' && !acted(tab.click) && !acted(tab.submit) && t - since <= CLIENT_REDIRECT_MS;
  if ((o.qualifiers.includes('client_redirect') || inferred) && cursor && foldable(cursor, tab)) {
    cursor.redirectChain.push(cursor.url);
    setUrl(cursor, o.url);
    cursor.title = undefined;
    cursor.lastAt = t;
    ctx.changed.add(s.id);
    return;
  }

  // A tab adopted at startup, then the commit of the page it was already showing (the
  // recorder started while the page loaded): that's the same entry, not a new one.
  if (cursor && cursor.createdBy === 'wake' && cursor.children.length === 0 && sameEntry(cursor, o.url) && t - cursor.firstAt <= ADOPT_MS) {
    cursor.createdBy = 'commit';
    cursor.transition = transitionName(o.transitionType);
    cursor.lastAt = t;
    ctx.changed.add(s.id);
    return;
  }

  const edge: EdgeKind = tab.gap ? 'unknown' : s.visitIds.length === 0 && s.spawnedFrom ? 'spawn' : JUMP_TRANSITIONS.has(o.transitionType) ? 'jump' : o.transitionType === 'form_submit' ? 'form' : 'link';
  tab.gap = undefined;
  const v = addVisit(ctx, s, cursor?.id, { url: o.url, transition: transitionName(o.transitionType), edge, createdBy: 'commit' });
  if (o.qualifiers.includes('server_redirect')) v.redirected = true;
  if (tab.click && acted(tab.click) && t - tab.click.t <= CLICK_MATCH_MS) v.anchorText = tab.click.text || undefined;
  else if (s.visitIds.length === 1 && tab.click && t - tab.click.t <= CLICK_MATCH_MS) v.anchorText = tab.click.text || undefined;
  if (o.transitionType === 'form_submit' && tab.submit?.method === 'post' && t - tab.submit.t <= CLICK_MATCH_MS) v.method = 'post';
  tab.click = undefined;
  tab.submit = undefined;
  s.cursorId = v.id;
}

function transitionName(type: string): string {
  switch (type) {
    case 'auto_bookmark':
      return 'bookmark';
    case 'form_submit':
      return 'form';
    default:
      return type;
  }
}

/** A visit can absorb a redirect when it's this tab's own fresh, childless entry. */
function foldable(v: Visit, tab: TabState): boolean {
  return v.createdBy === 'commit' && v.children.length === 0 && v.firstAt >= tab.boundAt;
}

function unknownEntry(ctx: Ctx, s: Session, url: string, cursor?: Visit) {
  if (!cursor) {
    const v = addVisit(ctx, s, undefined, { url, transition: 'unknown', edge: 'unknown', createdBy: 'unknown-back' });
    s.cursorId = v.id;
    return;
  }
  if (cursor.id === s.rootId) {
    const v = addVisit(ctx, s, undefined, { url, transition: 'unknown', edge: 'unknown', createdBy: 'unknown-back' });
    const old = cursor;
    old.parentId = v.id;
    v.children.push(old.id);
    s.rootId = v.id;
    s.moves.push({ at: ctx.t, from: old.id, to: v.id, dir: 'back' });
    s.cursorId = v.id;
    return;
  }
  const v = addVisit(ctx, s, cursor.id, { url, transition: 'unknown', edge: 'unknown', createdBy: 'unknown-back' });
  s.cursorId = v.id;
}

/** SPA navigations, classified by the history probe (S1 #30–33, SPEC §6.1). */
function onHistoryState(ctx: Ctx, o: Extract<Observation, { type: 'nav.history' }>) {
  const { st, t } = ctx;
  if (!isRecordable(o.url)) return;
  const tab = ensureTab(ctx, o.tabId);
  const s = st.sessions[tab.sessionId];

  if (o.qualifiers.includes('forward_back')) {
    moveTo(ctx, s, o.url, true);
    return;
  }

  const i = tab.probes.findIndex((p) => p.url === o.url && Math.abs(p.t - t) <= PROBE_MATCH_MS);
  if (i >= 0) {
    const [probe] = tab.probes.splice(i, 1);
    applyHistoryCall(ctx, s, tab, probe.kind, o.url);
    return;
  }

  // No probe report (yet): fall back to "path or query changed = push", and remember the
  // decision so a late probe report can correct it.
  const cursor = s.cursorId ? st.visits[s.cursorId] : undefined;
  if (cursor && !pathOrQueryChanged(cursor.url, o.url)) {
    tab.hsuPending = { url: o.url, t, result: 'ignored' };
    return;
  }
  const v = spaPush(ctx, s, tab, o.url);
  tab.hsuPending = { url: o.url, t, result: 'pushed', visitId: v?.id };
}

function onProbe(ctx: Ctx, o: Extract<Observation, { type: 'page.history' }>) {
  const tab = ensureTab(ctx, o.tabId);
  const s = ctx.st.sessions[tab.sessionId];
  const pending = tab.hsuPending;
  if (pending && pending.url === o.url && Math.abs(pending.t - o.t) <= PROBE_MATCH_MS) {
    tab.hsuPending = undefined;
    if (o.kind === 'replace' && pending.result === 'pushed' && pending.visitId) {
      const v = ctx.st.visits[pending.visitId];
      if (v && v.children.length === 0 && s.cursorId === v.id && v.parentId) {
        removeVisit(ctx, s, v);
        applyHistoryCall(ctx, s, tab, 'replace', o.url);
      }
    } else if (o.kind === 'push' && pending.result === 'ignored') {
      applyHistoryCall(ctx, s, tab, 'push', o.url);
    }
    return;
  }
  tab.probes = [...tab.probes.filter((p) => o.t - p.t <= PROBE_MATCH_MS), { kind: o.kind, url: o.url, t: o.t }];
}

function applyHistoryCall(ctx: Ctx, s: Session, tab: TabState, kind: 'push' | 'replace', url: string) {
  const cursor = s.cursorId ? ctx.st.visits[s.cursorId] : undefined;
  if (kind === 'push') {
    if (cursor && withoutHash(cursor.url) === withoutHash(url)) {
      cursor.samePushes++; // a real history entry with the same URL: no node (S1 #32)
      ctx.changed.add(s.id);
    } else {
      spaPush(ctx, s, tab, url);
    }
    return;
  }
  if (!cursor) {
    spaPush(ctx, s, tab, url);
    return;
  }
  if (withoutHash(cursor.url) === withoutHash(url)) return;
  if (cursor.samePushes > 0) {
    // The stacked same-URL entry is the one being replaced: it becomes a node of its own.
    cursor.samePushes--;
    spaPush(ctx, s, tab, url, true);
    return;
  }
  setUrl(cursor, url);
  cursor.lastAt = ctx.t;
  ctx.changed.add(s.id);
}

function spaPush(ctx: Ctx, s: Session, tab: TabState, url: string, noDebounce = false): Visit | undefined {
  const cursor = s.cursorId ? ctx.st.visits[s.cursorId] : undefined;
  if (
    !noDebounce &&
    cursor &&
    cursor.createdBy === 'spa' &&
    cursor.children.length === 0 &&
    cursor.samePushes === 0 &&
    ctx.t - cursor.firstAt < SPA_DEBOUNCE_MS &&
    !(tab.click && tab.click.t >= cursor.firstAt) // a click in between means a deliberate new entry
  ) {
    setUrl(cursor, url); // rapid pushes (typing into a search box) collapse into one node (B5)
    cursor.lastAt = ctx.t;
    ctx.changed.add(s.id);
    return cursor;
  }
  const v = addVisit(ctx, s, cursor?.id, { url, transition: 'spa', edge: 'spa', createdBy: 'spa' });
  if (tab.click && ctx.t - tab.click.t <= CLICK_MATCH_MS && tab.click.href === url) v.anchorText = tab.click.text || undefined;
  s.cursorId = v.id;
  return v;
}

function onFragment(ctx: Ctx, o: Extract<Observation, { type: 'nav.fragment' }>) {
  if (o.qualifiers.includes('forward_back')) return; // in-page back: same visit (B6)
  const s = sessionOfTab(ctx, o.tabId);
  const v = s.cursorId ? ctx.st.visits[s.cursorId] : undefined;
  if (!v) return;
  const hash = o.url.includes('#') ? o.url.slice(o.url.indexOf('#')) : '';
  if (hash) v.fragments.push({ hash, at: o.t });
  ctx.changed.add(s.id);
}

/**
 * Imported Chrome history (E7): a visit whose referrer was imported hangs under it; any
 * other starts a read-only session of its own. Reloads aren't pages. Importing twice
 * skips what is already there.
 */
function onHistoryImport(ctx: Ctx, o: Extract<Observation, { type: 'history.import' }>) {
  const { st } = ctx;
  st.imported ??= {};
  for (const it of [...o.items].sort((a, b) => a.at - b.at)) {
    if (st.imported[it.id] || it.transition === 'reload' || !isRecordable(it.url)) continue;
    const parent = it.ref ? st.visits[st.imported[it.ref]] : undefined;
    let s = parent ? st.sessions[parent.sessionId] : undefined;
    if (!s) {
      s = { id: `s${++st.nextId}`, lastTabId: -1, windowId: -1, createdAt: it.at, closedAt: it.at, imported: true, lifecycle: [], bindings: [], moves: [], visitIds: [] };
      st.sessions[s.id] = s;
    }
    const edge: EdgeKind = !parent ? 'unknown' : JUMP_TRANSITIONS.has(it.transition) ? 'jump' : it.transition === 'form_submit' ? 'form' : 'link';
    const v = addVisit(ctx, s, parent?.id, { url: it.url, title: it.title, transition: transitionName(it.transition), edge, createdBy: 'import' });
    v.firstAt = v.lastAt = it.at;
    s.cursorId = v.id;
    s.closedAt = Math.max(s.closedAt ?? 0, it.at);
    st.imported[it.id] = v.id;
  }
}

/** Pause (C5): on resume the tab's next page shows as reached by an unknown way. */
function onPause(ctx: Ctx, o: Extract<Observation, { type: 'recorder.pause' }>) {
  const tabs = o.tabId === undefined ? Object.values(ctx.st.tabs) : [ensureTab(ctx, o.tabId)];
  if (o.tabId === undefined) ctx.st.paused = o.paused;
  if (!o.paused) for (const t of tabs) t.gap = true;
}

/** Tab opened by dude from a recorded visit (G3): "reopened from" provenance. */
function onReopened(ctx: Ctx, o: Extract<Observation, { type: 'tab.reopened' }>) {
  const tab = ensureTab(ctx, o.tabId);
  const s = ctx.st.sessions[tab.sessionId];
  if (s.spawnedFrom) return;
  const v = Object.values(ctx.st.visits).find((x) => x.firstAt === o.visitFirstAt && x.url === o.visitUrl && x.sessionId !== s.id);
  if (!v) return;
  s.spawnedFrom = { sessionId: v.sessionId, visitId: v.id, kind: 'reopen' };
  // The tab may already have committed its first page before this arrived.
  const root = s.rootId ? ctx.st.visits[s.rootId] : undefined;
  if (root && s.visitIds.length === 1) root.edge = 'spawn';
  ctx.changed.add(s.id);
  ctx.changed.add(v.sessionId);
}

// ---------------------------------------------------------------- screenshots and text

/** Attach to the tab's visit for that URL: the cursor if it matches, else the nearest one. */
function onMedia(ctx: Ctx, o: Extract<Observation, { type: 'page.capture' | 'page.text' }>) {
  const tab = ctx.st.tabs[o.tabId];
  if (!tab) return;
  const s = ctx.st.sessions[tab.sessionId];
  const v = visitFor(ctx.st, s, o.url);
  if (!v) return;
  if (o.type === 'page.text') {
    v.text = { id: o.textId, hash: o.hash, at: o.t };
  } else {
    const shot = { id: o.shotId, hash: o.hash, at: o.t };
    // Keep the first ones and always the latest (how the page looked when you left it).
    if (v.screenshots.length >= MAX_SHOTS) v.screenshots[MAX_SHOTS - 1] = shot;
    else v.screenshots.push(shot);
  }
  ctx.changed.add(s.id);
}

export function visitFor(st: State, s: Session, url: string): Visit | undefined {
  const cursor = s.cursorId ? st.visits[s.cursorId] : undefined;
  if (cursor && sameEntry(cursor, url)) return cursor;
  for (let i = s.visitIds.length - 1; i >= 0; i--) {
    const v = st.visits[s.visitIds[i]];
    if (v && sameEntry(v, url)) return v;
  }
  return undefined;
}

// ---------------------------------------------------------------- tree helpers

function addVisit(
  ctx: Ctx,
  s: Session,
  parentId: string | undefined,
  p: { url: string; title?: string; favIconUrl?: string; transition: string; edge: EdgeKind; createdBy: Visit['createdBy'] },
): Visit {
  const v: Visit = {
    id: `v${++ctx.st.nextId}`,
    sessionId: s.id,
    parentId,
    children: [],
    url: p.url,
    normUrl: normUrl(p.url),
    aliases: [],
    title: p.title,
    favIconUrl: p.favIconUrl,
    firstAt: ctx.t,
    lastAt: ctx.t,
    dwellMs: 0,
    reloadCount: 0,
    transition: p.transition,
    edge: p.edge,
    redirectChain: [],
    fragments: [],
    searchQuery: searchQuery(p.url),
    excluded: p.url === EXCLUDED_URL || undefined,
    screenshots: [],
    samePushes: 0,
    createdBy: p.createdBy,
  };
  ctx.st.visits[v.id] = v;
  s.visitIds.push(v.id);
  if (parentId) ctx.st.visits[parentId].children.push(v.id);
  else s.rootId ??= v.id;
  ctx.changed.add(s.id);
  return v;
}

function removeVisit(ctx: Ctx, s: Session, v: Visit) {
  if (v.parentId) {
    const parent = ctx.st.visits[v.parentId];
    parent.children = parent.children.filter((c) => c !== v.id);
    if (s.cursorId === v.id) s.cursorId = parent.id;
  }
  s.visitIds = s.visitIds.filter((id) => id !== v.id);
  delete ctx.st.visits[v.id];
  ctx.changed.add(s.id);
}

function setUrl(v: Visit, url: string) {
  if (v.url !== url) v.aliases.push(v.url);
  v.url = url;
  v.normUrl = normUrl(url);
  v.searchQuery = searchQuery(url) ?? v.searchQuery;
}

function sameEntry(v: Visit, url: string): boolean {
  const u = withoutHash(url);
  return withoutHash(v.url) === u || v.aliases.some((a) => withoutHash(a) === u);
}

/**
 * Move the cursor to the visit for `url` nearest to the cursor in the tree (breadth-first
 * over parent and children). Records a back/forward move when `asMove`.
 */
function moveTo(ctx: Ctx, s: Session, url: string, asMove: boolean): boolean {
  const { st } = ctx;
  const start = s.cursorId ?? s.rootId;
  if (!start) return false;
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length) {
    const id = queue.shift()!;
    const v = st.visits[id];
    if (sameEntry(v, url)) {
      if (asMove && id !== s.cursorId) {
        s.moves.push({ at: ctx.t, from: s.cursorId, to: id, dir: isAncestor(st, id, s.cursorId) ? 'back' : 'forward' });
      }
      s.cursorId = id;
      v.lastAt = ctx.t;
      ctx.changed.add(s.id);
      return true;
    }
    for (const n of [v.parentId, ...v.children]) {
      if (n && !seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return false;
}

function isAncestor(st: State, ancestor: string, of?: string): boolean {
  for (let id = of ? st.visits[of]?.parentId : undefined; id; id = st.visits[id].parentId) if (id === ancestor) return true;
  return false;
}

// ---------------------------------------------------------------- dwell time (C1)

function currentVisit(st: State): string | undefined {
  if (st.focus.windowId === -1) return undefined;
  const tabId = st.focus.activeByWindow[st.focus.windowId];
  const tab = tabId === undefined ? undefined : st.tabs[tabId];
  return tab ? st.sessions[tab.sessionId]?.cursorId : undefined;
}

function tickDwell(st: State, t: number) {
  const d = st.dwellFrom;
  if (!d) return;
  // Focus passes through -1 on every window switch; only a longer gap counts as unfocused (S1 #27).
  const u = st.focus.unfocusedAt;
  const end = u !== undefined && t - u >= UNFOCUS_DEBOUNCE_MS ? u : t;
  const v = st.visits[d.visitId];
  if (v && end > d.t) v.dwellMs += end - d.t;
  st.dwellFrom = undefined;
}

function resumeDwell(st: State, t: number) {
  const u = st.focus.unfocusedAt;
  if (u !== undefined && t - u >= UNFOCUS_DEBOUNCE_MS) return;
  const id = currentVisit(st);
  if (id) st.dwellFrom = { visitId: id, t };
}
