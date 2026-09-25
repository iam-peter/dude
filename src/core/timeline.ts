// Playback timeline (SPEC §10, C2–C4): replay the observation log through a fresh
// projector and note, after each observation, what a viewer would have seen change —
// a page first visited, a back/forward move, the cursor jumping, focus moving to another
// tab. The replay's own final state is what playback renders, so it shows exactly what
// the log says, independent of the live projection.

import { createState, type State } from './model';
import type { Observation } from './observations';
import { apply } from './projector';

export type StepKind = 'visit' | 'move' | 'cursor' | 'focus';

export interface Step {
  t: number;
  kind: StepKind;
  sessionId: string;
  visitId?: string;
  dir?: 'back' | 'forward';
}

export interface Timeline {
  steps: Step[];
  st: State;
}

/** Session in focus: the active tab of the focused window, if it's being recorded. */
function focused(st: State): string | undefined {
  if (st.focus.windowId === -1) return undefined;
  const tabId = st.focus.activeByWindow[st.focus.windowId];
  return tabId === undefined ? undefined : st.tabs[tabId]?.sessionId;
}

export function buildTimeline(observations: Iterable<Observation>): Timeline {
  const st = createState();
  const steps: Step[] = [];
  const known = new Set<string>();
  const last = new Map<string, { cursor?: string; moves: number }>();
  let focus: string | undefined;

  for (const o of observations) {
    const changed = apply(st, o);
    for (const id of changed) {
      const s = st.sessions[id];
      if (!s) continue;
      const prev = last.get(id) ?? { moves: 0 };
      for (const v of s.visitIds) {
        if (known.has(v)) continue;
        known.add(v);
        steps.push({ t: st.visits[v]?.firstAt ?? o.t, kind: 'visit', sessionId: id, visitId: v });
      }
      if (s.moves.length > prev.moves) {
        for (const m of s.moves.slice(prev.moves)) steps.push({ t: m.at, kind: 'move', sessionId: id, visitId: m.to, dir: m.dir });
      } else if (s.cursorId && s.cursorId !== prev.cursor && steps.at(-1)?.visitId !== s.cursorId) {
        steps.push({ t: o.t, kind: 'cursor', sessionId: id, visitId: s.cursorId });
      }
      last.set(id, { cursor: s.cursorId, moves: s.moves.length });
    }
    const f = focused(st);
    if (f && f !== focus && (o.type === 'tab.activated' || o.type === 'window.focus')) {
      steps.push({ t: o.t, kind: 'focus', sessionId: f, visitId: st.sessions[f]?.cursorId });
    }
    focus = f;
  }
  // Steps pointing at sessions or visits that a later observation merged away (a restored
  // tab's provisional session, replayed commits) are not part of the story.
  const live = steps.filter((s) => st.sessions[s.sessionId] && (!s.visitId || st.visits[s.visitId]));
  // Imported history is logged long after it happened: order by when things happened.
  live.sort((a, b) => a.t - b.t);
  return { steps: live, st };
}

export type Scope = 'session' | 'family' | 'day';

/** Sessions linked to `sessionId` by "opened from", in both directions. */
export function familyOf(st: State, sessionId: string): Set<string> {
  const ids = new Set([sessionId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of Object.values(st.sessions)) {
      const p = s.spawnedFrom?.sessionId;
      if (p && ids.has(p) !== ids.has(s.id)) {
        ids.add(p);
        ids.add(s.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** The steps of one scope, and its lanes (sessions) in order of first appearance. */
export function scoped(tl: Timeline, scope: Scope, sessionId: string, day?: { start: number; end: number }): { steps: Step[]; lanes: string[] } {
  let steps: Step[];
  if (scope === 'session') steps = tl.steps.filter((s) => s.sessionId === sessionId && s.kind !== 'focus');
  else if (scope === 'family') {
    const fam = familyOf(tl.st, sessionId);
    steps = tl.steps.filter((s) => fam.has(s.sessionId));
  } else {
    steps = tl.steps.filter((s) => day && s.t >= day.start && s.t < day.end);
  }
  const lanes: string[] = [];
  for (const s of steps) if (!lanes.includes(s.sessionId) && tl.st.sessions[s.sessionId]?.visitIds.length) lanes.push(s.sessionId);
  return { steps: steps.filter((s) => lanes.includes(s.sessionId)), lanes };
}

/** What is on screen after step `k`: visible visits, each lane's cursor, the focused lane. */
export function frameAt(steps: Step[], k: number): { visible: Set<string>; cursors: Map<string, string>; focus?: string } {
  const visible = new Set<string>();
  const cursors = new Map<string, string>();
  let focus: string | undefined;
  for (let i = 0; i <= k && i < steps.length; i++) {
    const s = steps[i];
    if (s.visitId && s.kind === 'visit') visible.add(s.visitId);
    if (s.visitId) cursors.set(s.sessionId, s.visitId);
    focus = s.sessionId;
  }
  return { visible, cursors, focus };
}

/** Delay before step k+1: real gap, idle time compressed to at most 2 s (C3). */
export function delayAfter(steps: Step[], k: number, speed: number): number {
  const gap = k + 1 < steps.length ? steps[k + 1].t - steps[k].t : 0;
  return Math.max(120, Math.min(2000, gap)) / speed;
}
