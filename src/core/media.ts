// Which blobs are still referenced, and which previews can go (E2, S2 #7). Pure, so the
// retention rule can be tested without a browser.
import type { State } from './model';

export interface MediaPlan {
  shots: Set<string>;
  texts: Set<string>;
  prunePreviews: Set<string>;
}

/**
 * Previews go for visits looked at for less than `minDwellMs` once they are no longer any
 * tab's current page (and a minute has passed), and for screenshots older than `maxAgeMs`.
 * Thumbnails always stay.
 */
export function mediaPlan(st: State, now: number, minDwellMs: number, maxAgeMs: number): MediaPlan {
  const current = new Set(Object.values(st.tabs).map((t) => st.sessions[t.sessionId]?.cursorId));
  const plan: MediaPlan = { shots: new Set(), texts: new Set(), prunePreviews: new Set() };
  for (const v of Object.values(st.visits)) {
    if (v.text) plan.texts.add(v.text.id);
    const settled = !current.has(v.id) && now - v.lastAt > 60_000;
    for (const sh of v.screenshots) {
      plan.shots.add(sh.id);
      if ((settled && v.dwellMs < minDwellMs) || now - sh.at > maxAgeMs) plan.prunePreviews.add(sh.id);
    }
  }
  return plan;
}

export interface ShotSize {
  id: string;
  t: number;
  thumb: number;
  preview: number;
}

/**
 * Size cap (E3): drop previews oldest first until the screenshots fit, then whole
 * screenshots (thumbnails) oldest first. Page text and the log are never dropped here.
 */
export function capPlan(shots: ShotSize[], capBytes: number): { dropPreviews: string[]; dropShots: string[]; bytes: number } {
  let bytes = shots.reduce((n, s) => n + s.thumb + s.preview, 0);
  const oldest = [...shots].sort((a, b) => a.t - b.t);
  const dropPreviews: string[] = [];
  const dropShots: string[] = [];
  for (const s of oldest) {
    if (bytes <= capBytes) break;
    if (s.preview) {
      dropPreviews.push(s.id);
      bytes -= s.preview;
    }
  }
  for (const s of oldest) {
    if (bytes <= capBytes) break;
    dropShots.push(s.id);
    bytes -= s.thumb + (dropPreviews.includes(s.id) ? 0 : s.preview);
  }
  return { dropPreviews, dropShots, bytes };
}

