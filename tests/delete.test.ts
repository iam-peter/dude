// Real delete (SPEC §12): rewrite the log, rebuild, and check both the tree and that the
// deleted page left no trace in what remains of the log.
import { describe, expect, test } from 'vitest';
import { createState, type State } from '@/core/model';
import type { Observation } from '@/core/observations';
import { apply } from '@/core/projector';
import { describeAll, shortUrl } from '@/core/describe';
import { deletion, type DeleteWhat } from '@/core/delete';
import { observationsOf } from './s1-fixtures';

function run(obs: Observation[]): State {
  const st = createState();
  for (const o of obs) apply(st, o);
  return st;
}

function del(browser: string, scenario: string, pick: (st: State) => DeleteWhat) {
  const obs = observationsOf(browser, scenario);
  const before = run(obs);
  const rw = deletion(before, pick(before));
  const kept = obs.map(rw).filter((o): o is Observation => o !== null);
  return { kept, after: run(kept), before };
}

const visitAt = (st: State, path: string) => Object.values(st.visits).find((v) => shortUrl(v.url) === path)!;

describe('delete (SPEC §12)', () => {
  test('a visit: gone from the tree and from the log; its children move up', () => {
    const { kept, after } = del('chromium', 'branch', (st) => ({ kind: 'visit', visitId: visitAt(st, '/c').id }));
    expect(describeAll(after)).toBe(['s1 open', '  /a (jump) *', '    /b', '      /d'].join('\n'));
    expect(JSON.stringify(kept)).not.toContain('localhost:8765/c');
  });

  test('a domain: every page of it, across tabs, and its URLs in the log', () => {
    const { kept, after } = del('chromium', 'cross-origin', () => ({ kind: 'domain', host: '127.0.0.1' }));
    expect(describeAll(after)).toBe(['s1 open', '  /a (jump) *'].join('\n'));
    expect(JSON.stringify(kept)).not.toContain('127.0.0.1');
  });

  test('a session: the tab opened from a link disappears, the source stays', () => {
    const { after, before } = del('chromium', 'target-blank', (st) => ({ kind: 'session', sessionId: Object.values(st.sessions).find((s) => s.spawnedFrom && shortUrl(st.visits[s.rootId!].url) === '/b')!.id }));
    const pages = (st: State) => Object.values(st.sessions).filter((s) => s.visitIds.length).map((s) => shortUrl(st.visits[s.rootId!].url));
    expect(pages(before)).toEqual(['/newtab', '/b', '/c']);
    expect(pages(after)).toEqual(['/newtab', '/c']);
  });

  test('a session that was restored under a new tab id: both tab ids are covered', () => {
    const { after } = del('firefox', 'close-restore', (st) => ({ kind: 'session', sessionId: Object.keys(st.sessions)[0] }));
    expect(Object.values(after.sessions).filter((s) => s.visitIds.length)).toEqual([]);
  });

  test('a time range: pages visited in it go, pages before it stay', () => {
    const obs = observationsOf('chromium', 'link-chain');
    const st = run(obs);
    const b = visitAt(st, '/b');
    const rw = deletion(st, { kind: 'range', from: b.firstAt, to: Number.MAX_SAFE_INTEGER });
    const after = run(obs.map(rw).filter((o): o is Observation => o !== null));
    expect(describeAll(after)).toBe(['s1 open', '  /a (jump) *'].join('\n'));
  });

  test('imported history: deleting a session removes its items from the import', () => {
    const imp: Observation = {
      type: 'history.import',
      t: 1,
      items: [
        { id: '1', at: 100, url: 'https://x.example/a', transition: 'typed' },
        { id: '2', ref: '1', at: 200, url: 'https://x.example/b', transition: 'link' },
        { id: '3', at: 300, url: 'https://y.example/', transition: 'typed' },
      ],
    };
    const st = run([imp]);
    const x = Object.values(st.sessions).find((s) => st.visits[s.rootId!].url.includes('x.example'))!;
    const kept = [imp].map(deletion(st, { kind: 'session', sessionId: x.id })).filter((o): o is Observation => o !== null);
    expect(JSON.stringify(kept)).not.toContain('x.example');
    expect(describeAll(run(kept))).toBe('s1 closed\n  y.example/ (unknown) *');
  });
});

