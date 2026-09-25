// Projector against the recorded S1 fixtures (H3). Each expectation was reviewed against
// the raw timeline (npm run s1:summary) and docs/S1-FINDINGS.md; see describe.ts for the
// notation.
import { describe, expect, test } from 'vitest';
import { describeAll } from '@/core/describe';
import { project } from './s1-fixtures';

const tree = (browser: string, scenario: string) => describeAll(project(browser, scenario));
const t = (s: TemplateStringsArray) => s.raw.join('').replace(/^\n/, '').replace(/\n\s*$/, '');

describe('firefox', () => {
  test('address-bar-search', () => {
    expect(tree('firefox', 'address-bar-search')).toBe(t`
s1 open
  /a
    www.google.com/search?client=ubuntu-sn&channel=fs&q=dude+spike+test&sei=9iG2aur5EsWMxc8PruDjqAE (jump) via[www.google.com/search?client=ubuntu-sn&channel=fs&q=dude+spike+test] *
      consent.youtube.com/m?continue=https%3A%2F%2Fwww.youtube.com%2F%40DudeTested%2Fvideos%3Fcbrd%3D1&gl=DE&m=0&pc=yt&cm=2&hl=en&src=1 ⤳
        www.youtube.com/@DudeTested/videos?cbrd=1&themeRefresh=1 (form) ⤳ via[www.youtube.com/@DudeTested/videos?cbrd=1]
          www.youtube.com/@DudeTested/videos (spa)
`);
  });
  test('back-forward', () => {
    expect(tree('firefox', 'back-forward')).toBe(t`
s1 open
  /a
    /b *
      /c
`);
  });
  test('bookmark', () => {
    expect(tree('firefox', 'bookmark')).toBe(t`
s1 open
  /a
    /c (jump) *
`);
  });
  test('branch', () => {
    expect(tree('firefox', 'branch')).toBe(t`
s1 open
  /a *
    /b
      /c
      /d
`);
  });
  test('close-restore', () => {
    expect(tree('firefox', 'close-restore')).toBe(t`
s1 open  [restored-closed-tab]
  /a *
    /b
`);
  });
  test('cross-origin', () => {
    expect(tree('firefox', 'cross-origin')).toBe(t`
s1 open
  /a *
    [127]/a
      [127]/b
`);
  });
  test('ctrl-shift-t', () => {
    expect(tree('firefox', 'ctrl-shift-t')).toBe(t`
s1 open  [restored-closed-tab]
  /a *
    /b
`);
  });
  test('duplicate', () => {
    expect(tree('firefox', 'duplicate')).toBe(t`
s1 open
  /a
    /b *
s4 open  from s1@/b (duplicate)
  /a {inh} *
    /b {inh}
`);
  });
  test('form', () => {
    expect(tree('firefox', 'form')).toBe(t`
s1 open
  /form
    /post-result (form) POST
      /form
        /search?q=dude (form) *
`);
  });
  test('fragment', () => {
    expect(tree('firefox', 'fragment')).toBe(t`
s1 open
  /a #1 *
`);
  });
  test('link-chain', () => {
    expect(tree('firefox', 'link-chain')).toBe(t`
s1 open
  /a
    /b
      /c *
`);
  });
  test('middle-click', () => {
    expect(tree('firefox', 'middle-click')).toBe(t`
s1 open
  /a *
s3 open  from s1@/a (link)
  /b (spawn) *
`);
  });
  test('move-window', () => {
    expect(tree('firefox', 'move-window')).toBe(t`
s1 open  [moved-window, moved-window]
  /a (jump)
    /b *
`);
  });
  test('redirect-js', () => {
    expect(tree('firefox', 'redirect-js')).toBe(t`
s1 open
  /a *
    /c via[/rjs]
`);
  });
  test('redirect-meta', () => {
    expect(tree('firefox', 'redirect-meta')).toBe(t`
s1 open
  /a *
    /d via[/rmeta]
`);
  });
  test('redirect-server', () => {
    expect(tree('firefox', 'redirect-server')).toBe(t`
s1 open
  /a *
    /b ⤳
`);
  });
  test('reload', () => {
    expect(tree('firefox', 'reload')).toBe(t`
s1 open
  /a
    /b ↻1 *
`);
  });
  test('restart', () => {
    expect(tree('firefox', 'restart')).toBe(t`
s1 open  [restored-startup]
  /a (unknown) *
    /b
s3 open  [restored-startup]
  /c (jump) *
s5 open
  / (unknown) ↻1 *
s7 open
`);
  });
  test('revisit', () => {
    expect(tree('firefox', 'revisit')).toBe(t`
s1 open
  /a
    /b
      /a *
        /b
`);
  });
  test('spa', () => {
    expect(tree('firefox', 'spa')).toBe(t`
s1 open
  /spa *
    /spa/p1 (spa)
      /spa/p3 (spa) #1
`);
  });
  test('spa-replace', () => {
    expect(tree('firefox', 'spa-replace')).toBe(t`
s1 open
  /spa *
    /spa/p1 (spa)
      /spa/p3 (spa)
`);
  });
  test('tab-switching', () => {
    expect(tree('firefox', 'tab-switching')).toBe(t`
s1 open
  /a (jump) *
s3 open
  /b (jump) *
s5 open
`);
  });
  test('target-blank', () => {
    expect(tree('firefox', 'target-blank')).toBe(t`
s1 open
  /newtab *
s3 open  from s1@/newtab (link)
  /b (spawn) *
s5 open  from s1@/newtab (link)
  /c (spawn) *
`);
  });
  test('typed-in-tab', () => {
    // WebDriver reports its typed navigation as `link` without a click, so it looks like a
    // client redirect. Real typed URLs are `typed` in Firefox (S1 #20) and are not folded.
    expect(tree('firefox', 'typed-in-tab')).toBe(t`
s1 open
  /a
    /c via[/b] *
`);
  });
  test('window-open', () => {
    expect(tree('firefox', 'window-open')).toBe(t`
s1 open
  /newtab *
s3 open  from s1@/newtab (link)
  /d (spawn) *
`);
  });
});

describe('chromium', () => {
  test('back-forward', () => {
    expect(tree('chromium', 'back-forward')).toBe(t`
s1 open
  /a (jump)
    /b *
      /c
`);
  });
  test('branch', () => {
    expect(tree('chromium', 'branch')).toBe(t`
s1 open
  /a (jump) *
    /b
      /c
      /d
`);
  });
  // No tab values in Chrome: restore is recognised by the `reload` replay and the URL (S1 #16).
  test('close-restore', () => {
    expect(tree('chromium', 'close-restore')).toBe(t`
s1 open  [restored-closed-tab~]
  /a (jump) *
    /b
`);
  });
  test('cross-origin', () => {
    expect(tree('chromium', 'cross-origin')).toBe(t`
s1 open
  /a (jump) *
    [127]/a
      [127]/b
`);
  });
  // Duplicate: opener shows the replayed page (S1 #14).
  test('duplicate', () => {
    expect(tree('chromium', 'duplicate')).toBe(t`
s1 open
  /a (jump)
    /b *
s4 open  from s1@/b (duplicate)
  /a (jump) {inh} *
    /b {inh}
`);
  });
  test('form', () => {
    expect(tree('chromium', 'form')).toBe(t`
s1 open
  /form (jump)
    /post-result (form) POST
      /form
        /search?q=dude (form) *
`);
  });
  test('fragment', () => {
    expect(tree('chromium', 'fragment')).toBe(t`
s1 open
  /a (jump) #1 *
`);
  });
  test('link-chain', () => {
    expect(tree('chromium', 'link-chain')).toBe(t`
s1 open
  /a (jump)
    /b
      /c *
`);
  });
  test('middle-click', () => {
    expect(tree('chromium', 'middle-click')).toBe(t`
s1 open
  /a (jump) *
s3 open  from s1@/a (link)
  /b (spawn) *
`);
  });
  test('redirect-js', () => {
    expect(tree('chromium', 'redirect-js')).toBe(t`
s1 open
  /a (jump) *
    /c via[/rjs]
`);
  });
  test('redirect-meta', () => {
    expect(tree('chromium', 'redirect-meta')).toBe(t`
s1 open
  /a (jump) *
    /d via[/rmeta]
`);
  });
  test('redirect-server', () => {
    expect(tree('chromium', 'redirect-server')).toBe(t`
s1 open
  /a (jump) *
    /b ⤳
`);
  });
  test('reload', () => {
    expect(tree('chromium', 'reload')).toBe(t`
s1 open
  /a (jump)
    /b ↻1 *
`);
  });
  test('revisit', () => {
    expect(tree('chromium', 'revisit')).toBe(t`
s1 open
  /a (jump)
    /b
      /a *
        /b
`);
  });
  test('spa', () => {
    expect(tree('chromium', 'spa')).toBe(t`
s1 open
  /spa (jump) *
    /spa/p1 (spa)
      /spa/p3 (spa) #1
`);
  });
  test('spa-replace', () => {
    expect(tree('chromium', 'spa-replace')).toBe(t`
s1 open
  /spa (jump) *
    /spa/p1 (spa)
      /spa/p3 (spa)
`);
  });
  test('target-blank', () => {
    expect(tree('chromium', 'target-blank')).toBe(t`
s1 open
  /newtab (jump) *
s3 open  from s1@/newtab (link)
  /b (spawn) *
s5 open  from s1@/newtab (link)
  /c (spawn) *
`);
  });
  test('typed-in-tab', () => {
    expect(tree('chromium', 'typed-in-tab')).toBe(t`
s1 open
  /a (jump)
    /b *
      /c (jump)
`);
  });
  test('window-open', () => {
    expect(tree('chromium', 'window-open')).toBe(t`
s1 open
  /newtab (jump) *
s3 open  from s1@/newtab (link)
  /d (spawn) *
`);
  });
});
