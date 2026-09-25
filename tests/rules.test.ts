// Projector rules that the S1 fixtures don't exercise, mostly event orders the live
// recorder produces (identity before the first commit) or rare timings.
import { describe, expect, test } from 'vitest';
import { createState, type State } from '@/core/model';
import type { Observation } from '@/core/observations';
import { apply } from '@/core/projector';
import { describeAll } from '@/core/describe';
import { mediaPlan } from '@/core/media';
import { anonymize } from '@/core/privacy';

const U = (p: string) => `http://localhost:8765${p}`;
type O = Observation;

function run(obs: O[]): State {
  const st = createState();
  for (const o of obs) apply(st, o);
  return st;
}
const tree = (obs: O[]) => describeAll(run(obs));

const created = (t: number, tabId: number, extra: Partial<Extract<O, { type: 'tab.created' }>> = {}): O => ({ type: 'tab.created', t, tabId, windowId: 1, index: 0, ...extra });
const commit = (t: number, tabId: number, path: string, transitionType = 'link', qualifiers: string[] = []): O => ({ type: 'nav.committed', t, tabId, url: U(path), transitionType, qualifiers });
const completed = (t: number, tabId: number, path: string): O => ({ type: 'nav.completed', t, tabId, url: U(path) });
const click = (t: number, tabId: number, path: string, text = 'x'): O => ({ type: 'page.click', t, tabId, href: path ? U(path) : '', text, button: 0, newTab: false });
const hsu = (t: number, tabId: number, path: string, qualifiers: string[] = []): O => ({ type: 'nav.history', t, tabId, url: U(path), qualifiers });
const probe = (t: number, tabId: number, kind: 'push' | 'replace', path: string): O => ({ type: 'page.history', t, tabId, kind, url: U(path), lengthBefore: 1, lengthAfter: kind === 'push' ? 2 : 1 });
const identity = (t: number, tabId: number, value: string, copiedFrom?: string): O => ({ type: 'tab.identity', t, tabId, value, copiedFrom });

describe('SPA probe ordering (S1 #30–33)', () => {
  const base = [created(0, 1), commit(10, 1, '/spa', 'typed'), completed(20, 1, '/spa')];

  // replaceState rewrites the current entry: same node, new URL.
  test('probe before the history update', () => {
    expect(tree([...base, probe(1000, 1, 'replace', '/spa/x'), hsu(1002, 1, '/spa/x')])).toBe('s1 open\n  /spa/x (jump) *');
  });

  test('late replace report undoes the fallback push', () => {
    expect(tree([...base, hsu(1000, 1, '/spa/x'), probe(1004, 1, 'replace', '/spa/x')])).toBe('s1 open\n  /spa/x (jump) *');
  });

  test('late push report for a same-URL update records the stacked entry', () => {
    const st = run([...base, hsu(1000, 1, '/spa'), probe(1003, 1, 'push', '/spa')]);
    expect(describeAll(st)).toBe('s1 open\n  /spa (jump) +1 *');
  });

  test('pushes with a click in between stay separate, however fast', () => {
    const obs = [...base, click(990, 1, '/s/1'), probe(1000, 1, 'push', '/s/1'), hsu(1001, 1, '/s/1'), click(1290, 1, '/s/2'), probe(1300, 1, 'push', '/s/2'), hsu(1301, 1, '/s/2')];
    expect(tree(obs)).toBe('s1 open\n  /spa (jump)\n    /s/1 (spa)\n      /s/2 (spa) *');
  });

  test('rapid pushes collapse into one node (B5 debounce)', () => {
    const obs = [...base, probe(1000, 1, 'push', '/s?q=a'), hsu(1001, 1, '/s?q=a'), probe(1200, 1, 'push', '/s?q=ab'), hsu(1201, 1, '/s?q=ab')];
    expect(tree(obs)).toBe('s1 open\n  /spa (jump)\n    /s?q=ab (spa) *');
  });
});

describe('client redirect inference (S1 #5, #22)', () => {
  test('a gesture without a link prevents folding', () => {
    const obs = [created(0, 1), commit(10, 1, '/a', 'typed'), completed(50, 1, '/a'), click(300, 1, ''), commit(400, 1, '/b')];
    expect(tree(obs)).toBe('s1 open\n  /a (jump)\n    /b *');
  });

  test('a late link commit is a navigation, not a redirect', () => {
    const obs = [created(0, 1), commit(10, 1, '/a', 'typed'), completed(50, 1, '/a'), commit(5000, 1, '/b')];
    expect(tree(obs)).toBe('s1 open\n  /a (jump)\n    /b *');
  });
});

describe('Firefox identity as the live recorder emits it (identity before the first commit)', () => {
  const source = [created(0, 1), identity(5, 1, 'A'), commit(10, 1, '/a', 'typed'), click(900, 1, '/b'), commit(1000, 1, '/b')];

  test('duplicate: recorder saw the copied value and assigned a fresh one', () => {
    const obs = [...source, created(2000, 2), identity(2010, 2, 'B', 'A'), commit(2011, 2, '/b'), commit(2030, 2, '/b', 'link', ['forward_back']), commit(4000, 2, '/a', 'link', ['forward_back'])];
    const st = run(obs);
    expect(describeAll(st)).toBe(
      ['s1 open', '  /a (jump)', '    /b *', 's4 open  from s1@/b (duplicate)', '  /a (jump) {inh} *', '    /b {inh}'].join('\n'),
    );
    expect(st.byValue.B).toBe('s4'); // sessions and visits share one id counter
    expect(st.byValue.A).toBe('s1');
  });

  test('restore after close: value arrives with tab.created', () => {
    const obs = [...source, { type: 'tab.removed', t: 1500, tabId: 1, windowId: 1, isWindowClosing: false } as O, created(3000, 7, { tabValue: 'A' }), commit(3010, 7, '/b'), commit(3030, 7, '/b', 'link', ['forward_back']), commit(5000, 7, '/a', 'link', ['forward_back'])];
    const st = run(obs);
    expect(describeAll(st)).toBe('s1 open  [restored-closed-tab]\n  /a (jump) *\n    /b');
    expect(st.sessions.s1.tabId).toBe(7);
    expect(st.tabs[1]).toBeUndefined();
  });

  test('restart: wake snapshot rebinds by value, closes vanished tabs', () => {
    const obs = [...source, { type: 'recorder.wake', t: 9000, tabs: [{ tabId: 4, windowId: 2, index: 0, url: U('/b'), tabValue: 'A' }] } as O];
    const st = run(obs);
    expect(st.sessions.s1.tabId).toBe(4);
    expect(st.sessions.s1.lifecycle.map((l) => l.kind)).toEqual(['restored-startup']);
    expect(st.tabs[1]).toBeUndefined();
  });
});

describe('wake reconciliation', () => {
  test('a known tab gets its first value at wake', () => {
    const st = run([created(0, 1), commit(10, 1, '/a', 'typed'), { type: 'recorder.wake', t: 100, tabs: [{ tabId: 1, windowId: 1, index: 0, url: U('/a'), tabValue: 'N' }] } as O]);
    expect(st.sessions.s1.tabValue).toBe('N');
    expect(st.byValue.N).toBe('s1');
  });

  test('the commit of the page an adopted tab was already showing is the same entry', () => {
    const st = run([{ type: 'recorder.wake', t: 0, tabs: [{ tabId: 1, windowId: 1, index: 0, url: U('/a') }] } as O, commit(200, 1, '/a', 'typed'), click(900, 1, '/b'), commit(1000, 1, '/b')]);
    expect(describeAll(st)).toBe('s1 open\n  /a (unknown)\n    /b *');
    expect(st.visits.v2.transition).toBe('typed');
  });

  test('a reused tab id with an unknown value is a new tab', () => {
    const st = run([created(0, 3, { tabValue: 'OLD' }), commit(10, 3, '/a', 'typed'), { type: 'recorder.wake', t: 100, tabs: [{ tabId: 3, windowId: 1, index: 0, url: U('/x'), tabValue: 'NEW' }] } as O]);
    expect(st.sessions.s1.closedAt).toBe(100);
    expect(st.sessions[st.byValue.NEW].tabId).toBe(3);
  });
});

describe('Chrome identity without tab values (S1 #14, #16, R2)', () => {
  const browse = [created(0, 1), commit(10, 1, '/a', 'typed'), click(900, 1, '/b'), commit(1000, 1, '/b')];

  test('restart: new tab ids are matched to vanished sessions by URL', () => {
    const wake: O = { type: 'recorder.wake', t: 9000, tabs: [{ tabId: 50, windowId: 9, index: 0, url: U('/b') }, { tabId: 51, windowId: 9, index: 1, url: U('/x') }] };
    const st = run([...browse, wake, commit(9100, 50, '/b', 'reload'), commit(9500, 50, '/a', 'link', ['forward_back'])]);
    expect(describeAll(st)).toBe(['s1 open  [restored-startup~]', '  /a (jump) *', '    /b', 's4 open', '  /x (unknown) *'].join('\n'));
    expect(st.sessions.s1.tabId).toBe(50);
  });

  test('ambiguous URL: most recently closed session wins, medium confidence', () => {
    const two = [...browse, created(1100, 2), commit(1110, 2, '/b', 'typed'), { type: 'tab.removed', t: 2000, tabId: 1, windowId: 1, isWindowClosing: false } as O, { type: 'tab.removed', t: 3000, tabId: 2, windowId: 1, isWindowClosing: false } as O];
    const st = run([...two, created(4000, 3), commit(4010, 3, '/b', 'reload')]);
    const restored = st.sessions[st.tabs[3].sessionId];
    expect(restored.id).toBe('s4'); // closed last
    expect(restored.lifecycle.at(-1)).toMatchObject({ kind: 'restored-closed-tab', matchedBy: 'heuristic', confidence: 'medium' });
  });

  test('a reload in a tab that already has history is just a reload', () => {
    expect(tree([...browse, commit(2000, 1, '/b', 'reload')])).toBe('s1 open\n  /a (jump)\n    /b ↻1 *');
  });
});

describe('screenshots and text (SPEC §7, D5)', () => {
  const shot = (t: number, tabId: number, path: string, id: string): O => ({ type: 'page.capture', t, tabId, url: U(path), shotId: id, hash: id });
  const nav = [created(0, 1), commit(10, 1, '/a', 'typed'), click(900, 1, '/b'), commit(1000, 1, '/b')];

  test('a capture lands on the visit of its URL, even after the tab moved on', () => {
    const st = run([...nav, shot(1100, 1, '/a', 'late')]);
    expect(st.visits.v2.screenshots.map((x) => x.id)).toEqual(['late']);
    expect(st.visits.v3.screenshots).toEqual([]);
  });

  test('at most five per visit: the first four stay, the last slot keeps the latest', () => {
    const shots = ['1', '2', '3', '4', '5', '6', '7'].map((id, i) => shot(1100 + i, 1, '/b', id));
    const st = run([...nav, ...shots]);
    expect(st.visits.v3.screenshots.map((x) => x.id)).toEqual(['1', '2', '3', '4', '7']);
  });

  test('page text replaces the previous text', () => {
    const text = (t: number, id: string): O => ({ type: 'page.text', t, tabId: 1, url: U('/b'), textId: id, hash: id });
    const st = run([...nav, text(1200, 'x'), text(1300, 'y')]);
    expect(st.visits.v3.text?.id).toBe('y');
  });
});

describe('navigations dude starts (§9, G2, G3)', () => {
  const intent = (t: number, tabId: number, path: string): O => ({ type: 'nav.intent', t, tabId, url: U(path), reason: 'open-path' });

  test('open with path: each step is a navigation, not a folded redirect', () => {
    const obs = [created(0, 1), commit(10, 1, '/a', 'typed'), completed(40, 1, '/a'), intent(60, 1, '/b'), commit(80, 1, '/b'), completed(100, 1, '/b'), intent(120, 1, '/c'), commit(140, 1, '/c')];
    expect(tree(obs)).toBe('s1 open\n  /a (jump)\n    /b\n      /c *');
  });

  test('without the intent the same timing would fold (the reason it exists)', () => {
    const obs = [created(0, 1), commit(10, 1, '/a', 'typed'), completed(40, 1, '/a'), commit(80, 1, '/b')];
    expect(tree(obs)).toBe('s1 open\n  /b (jump) via[/a] *');
  });

  test('a reopened tab is linked to the visit it came from, even if its first commit came first', () => {
    const src = [created(0, 1), commit(10, 1, '/a', 'typed'), click(900, 1, '/b'), commit(1000, 1, '/b')];
    const obs = [...src, created(5000, 2), commit(5010, 2, '/b', 'link'), { type: 'tab.reopened', t: 5020, tabId: 2, visitUrl: U('/b'), visitFirstAt: 1000 } as O];
    expect(tree(obs)).toBe(['s1 open', '  /a (jump)', '    /b *', 's4 open  from s1@/b (reopen)', '  /b (spawn) *'].join('\n'));
  });
});

describe('exclusions and pause (D6, C5, §6.4)', () => {
  const bank = (url: string) => url.includes('bank.example');
  const through = (obs: O[]) => obs.map((o) => anonymize(o, bank)).filter((o): o is O => !!o);

  test('a deny-listed page is an anonymous placeholder that keeps the tree shape', () => {
    const obs: O[] = [
      created(0, 1), commit(10, 1, '/a', 'typed'),
      { type: 'page.click', t: 900, tabId: 1, href: 'https://bank.example/login', text: 'My account', button: 0, newTab: false },
      { type: 'nav.committed', t: 1000, tabId: 1, url: 'https://bank.example/login', transitionType: 'link', qualifiers: [] },
      { type: 'tab.updated', t: 1100, tabId: 1, url: 'https://bank.example/login', title: 'Your balance' },
      { type: 'page.capture', t: 1200, tabId: 1, url: 'https://bank.example/login', shotId: 'x', hash: 'x' },
      click(1900, 1, '/b'), commit(2000, 1, '/b'),
    ];
    const kept = through(obs);
    expect(JSON.stringify(kept)).not.toContain('bank.example');
    expect(JSON.stringify(kept)).not.toContain('balance');
    const st = run(kept);
    expect(describeAll(st)).toBe('s1 open\n  /a (jump)\n    (excluded page)\n      /b *');
    expect(st.visits.v3.excluded).toBe(true);
    expect(st.visits.v3.title).toBeUndefined();
  });

  test('after a resume the next page hangs under an unknown edge', () => {
    const obs: O[] = [created(0, 1), commit(10, 1, '/a', 'typed'), { type: 'recorder.pause', t: 100, paused: true }, { type: 'recorder.pause', t: 5000, paused: false }, click(5900, 1, '/x'), commit(6000, 1, '/x')];
    expect(tree(obs)).toBe('s1 open\n  /a (jump)\n    /x (unknown) *');
  });
});

describe('Chrome history import (E7)', () => {
  const imp = (t: number, items: [string, string | undefined, number, string, string][]): O => ({
    type: 'history.import',
    t,
    items: items.map(([id, ref, at, path, transition]) => ({ id, ref, at, url: U(path), title: path, transition })),
  });

  test('referrer chains become read-only sessions; reloads are not pages', () => {
    const st = run([imp(9_000_000, [['1', undefined, 100, '/a', 'typed'], ['2', '1', 200, '/b', 'link'], ['3', '2', 300, '/c', 'link'], ['4', '1', 400, '/d', 'link'], ['5', undefined, 500, '/a', 'reload'], ['6', undefined, 600, '/x', 'typed']])]);
    expect(describeAll(st)).toBe(['s1 closed', '  /a (unknown)', '    /b', '      /c', '    /d *', 's6 closed', '  /x (unknown) *'].join('\n'));
    expect(st.sessions.s1.imported).toBe(true);
    expect(st.visits.v3.firstAt).toBe(200);
  });

  test('importing again adds only what is new', () => {
    const first = imp(1, [['1', undefined, 100, '/a', 'typed']]);
    const again = imp(2, [['1', undefined, 100, '/a', 'typed'], ['2', '1', 200, '/b', 'link']]);
    expect(tree([first, again])).toBe('s1 closed\n  /a (unknown)\n    /b *');
  });
});

describe('preview retention (S2 #7, E2)', () => {
  const shot = (t: number, tabId: number, path: string, id: string): O => ({ type: 'page.capture', t, tabId, url: U(path), shotId: id, hash: id });
  const focus: O[] = [{ type: 'tab.activated', t: 0, tabId: 1, windowId: 1 }, { type: 'window.focus', t: 0, windowId: 1 }];
  // A glanced at for 1 s, B looked at for 10 s, C is the current page.
  const st = run([
    created(0, 1), ...focus,
    commit(0, 1, '/a', 'typed'), shot(500, 1, '/a', 'A'),
    click(900, 1, '/b'), commit(1000, 1, '/b'), shot(1500, 1, '/b', 'B'),
    click(10_900, 1, '/c'), commit(11_000, 1, '/c'), shot(11_500, 1, '/c', 'C'),
  ]);

  test('short glances lose their preview once settled; the current page keeps it', () => {
    const plan = mediaPlan(st, 120_000, 3000, 90 * 864e5);
    expect([...plan.prunePreviews]).toEqual(['A']);
    expect([...plan.shots].sort()).toEqual(['A', 'B', 'C']);
  });

  test('nothing is pruned in the first minute', () => {
    expect(mediaPlan(st, 30_000, 3000, 90 * 864e5).prunePreviews.size).toBe(0);
  });

  test('after 90 days every preview goes, thumbnails stay referenced', () => {
    const plan = mediaPlan(st, 91 * 864e5, 3000, 90 * 864e5);
    expect([...plan.prunePreviews].sort()).toEqual(['A', 'B', 'C']);
    expect(plan.shots.size).toBe(3);
  });
});

describe('dwell time (C1, S1 #27)', () => {
  const setup = [created(0, 1), commit(0, 1, '/a', 'typed'), { type: 'tab.activated', t: 0, tabId: 1, windowId: 1 } as O, { type: 'window.focus', t: 0, windowId: 1 } as O];

  test('a short pass through window -1 still counts', () => {
    const st = run([...setup, { type: 'window.focus', t: 1000, windowId: -1 } as O, { type: 'window.focus', t: 1100, windowId: 1 } as O, completed(2000, 1, '/a')]);
    expect(st.visits.v2.dwellMs).toBe(2000);
  });

  test('a long unfocus stops the clock', () => {
    const st = run([...setup, { type: 'window.focus', t: 1000, windowId: -1 } as O, { type: 'window.focus', t: 5000, windowId: 1 } as O, completed(6000, 1, '/a')]);
    expect(st.visits.v2.dwellMs).toBe(2000);
  });
});
