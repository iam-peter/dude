import { describe, expect, test } from 'vitest';
import { buildTimeline, delayAfter, frameAt, scoped } from '@/core/timeline';
import { shortUrl } from '@/core/describe';
import { observationsOf } from './s1-fixtures';

const story = (browser: string, scenario: string) => {
  const tl = buildTimeline(observationsOf(browser, scenario));
  return tl.steps.map((s) => `${s.kind}${s.dir ? ':' + s.dir : ''} ${s.visitId ? shortUrl(tl.st.visits[s.visitId].url) : ''}`.trim());
};

describe('playback timeline (SPEC §10)', () => {
  test('branch: pages appear in order, back moves are their own steps', () => {
    expect(story('chromium', 'branch')).toEqual(['visit /a', 'visit /b', 'visit /c', 'move:back /b', 'visit /d', 'move:back /b', 'move:back /a']);
  });

  test('a folded redirect is one page, not two', () => {
    // /rjs commits first and is folded into /c afterwards; playback shows the final page.
    expect(story('chromium', 'redirect-js')).toEqual(['visit /a', 'visit /c', 'move:back /a']);
  });

  test('restore: the provisional session never shows up; the restored tab continues its own lane', () => {
    const tl = buildTimeline(observationsOf('firefox', 'close-restore'));
    expect(new Set(tl.steps.map((s) => s.sessionId))).toEqual(new Set(['s1']));
  });

  test('family scope: the source tab and the tabs opened from it are lanes in order', () => {
    const tl = buildTimeline(observationsOf('chromium', 'target-blank'));
    const src = tl.steps[0].sessionId;
    const { lanes, steps } = scoped(tl, 'family', src);
    expect(lanes.length).toBe(3);
    expect(lanes[0]).toBe(src);
    expect(steps.every((s) => lanes.includes(s.sessionId))).toBe(true);
  });

  test('frame: what is visible after a step', () => {
    const tl = buildTimeline(observationsOf('chromium', 'branch'));
    const { steps } = scoped(tl, 'session', tl.steps[0].sessionId);
    const f = frameAt(steps, 3); // a, b, c, back to b
    expect([...f.visible].map((v) => shortUrl(tl.st.visits[v].url))).toEqual(['/a', '/b', '/c']);
    expect(shortUrl(tl.st.visits[f.cursors.get(steps[0].sessionId)!].url)).toBe('/b');
  });

  test('delays: real gaps, idle compressed to 2 s, divided by speed', () => {
    const steps = [0, 50, 700, 60_000].map((t) => ({ t, kind: 'visit' as const, sessionId: 's' }));
    expect([0, 1, 2].map((k) => delayAfter(steps, k, 1))).toEqual([120, 650, 2000]);
    expect(delayAfter(steps, 2, 4)).toBe(500);
  });
});
