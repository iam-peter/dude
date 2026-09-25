# S1 — Raw navigation events: findings

Status: **Firefox done, 2026-09-25** (automated and manual). Chromium: automated only; its
manual scenarios and a restart with a permanently installed build are still open (see the end).
Browsers: Chromium 151 (Chrome for Testing, Playwright) and Firefox 156 (geckodriver
0.37), both running the MV3 build. Fixtures: `fixtures/s1/<browser>/<scenario>.json`,
18 scenarios per browser. Read them with `npm run s1:summary -- <fixture>`.

The recorder stores every `webNavigation`, `tabs`, `windows`, `sessions` and `runtime`
event unmodified. A content-script probe adds link clicks and form submits
(`content.click`, `content.submit`). In Firefox, `tabValue` records show when the stable
tab id is readable.

## Findings

Each finding lists what it means for the projector or the spec. "Both" means Chromium and
Firefox behave the same.

### Back/forward (§6.3, R1)

1. **`forward_back` is reported reliably in both browsers.** That includes real
   navigations (`onCommitted`), SPA history entries (`onHistoryStateUpdated`) and
   fragment entries (`onReferenceFragmentUpdated`). R1 is largely defused; manual Backs
   in Firefox confirm it (finding 21). The URL heuristic in §6.3 stays as a safety net.
2. **A back/forward commit carries the *original* entry's `transitionType`.** Going
   back to a page that was typed reports `typed [forward_back]` in Chromium. So the
   projector must decide "is this back/forward?" from the qualifier only, never from the
   type.

### Redirects (B4)

3. `server_redirect`: both, on the commit of the final URL. The 302 hop never commits.
4. Meta refresh: both report `client_redirect` on the target commit.
5. **JS `location.replace`: Chromium reports `client_redirect`, Firefox reports
   nothing.** Firefox shows a plain `link []` with no preceding click.
6. With client redirects, **the redirecting page commits first as its own entry**
   (`/rjs`, `/rmeta`: `link []`). In both browsers that entry is then replaced: Back goes
   straight to `/a`.
   → The projector folds after the fact. When a commit is a client redirect, the previous
   visit in that tab becomes a hop in the new visit's `redirectChain`. In Firefox, "client
   redirect" is inferred: a commit with no `content.click`/`content.submit` and no
   `forward_back`, within about 1.5 s of the previous commit's `onCompleted` in the same
   tab.

### SPA and fragments (B5, B6)

7. `pushState` and `replaceState` both arrive as `onHistoryStateUpdated` with
   `link []`, **and nothing tells them apart.** Under B5, a `replaceState` would create a
   node for an entry that doesn't exist in the back stack.
   → Resolved by S1b (findings 30–33): a `world: 'MAIN'` probe reports which call it was.
8. Fragment changes: both report `onReferenceFragmentUpdated`, including Back out of a
   fragment (with `forward_back`). This fits B6.

### Reload, forms (B7, B14)

9. Reload: `reload []` in both. This fits B7.
10. Forms: `form_submit` for **both POST and GET**. The event carries no HTTP method.
    → B14 (flag POST) depends on the `content.submit` probe (`method`), or on
    `webRequest` later.

### New tabs and provenance (B9, §5.3)

11. `onCreatedNavigationTarget` fires in both browsers for `target=_blank`,
    `rel=noopener`, `window.open` and middle-click. Even with `noopener`, `sourceTabId`
    and `openerTabId` are set. Spawn edges are reliable.
12. **The event order differs.** Chromium sends `tabs.onCreated` first and then
    `onCreatedNavigationTarget`. Firefox middle-click sends
    `onCreatedNavigationTarget` *before* `tabs.onCreated`.
    → The projector has to accept either order (a small pending-tab buffer keyed by
    tabId).
13. Chromium background tabs from middle-click are created with the URL already set
    (`pendingUrl`). Firefox creates them as `about:blank` first.

### Duplicate and restore (B11, B13, R2)

14. **Chromium duplicate:** the new tab has `openerTabId` = source, and its commits are
    typed `reload`. The full back history comes along (`reload [forward_back] /a`).
15. **Firefox duplicate:** no `openerTabId`. The first commits are `link []` and then,
    about 20 ms later, `link [forward_back]` for the same URL. That is session-history
    restoration, not a user navigation. **The tab value is copied from the source tab.**
16. **Chromium restore** (`sessions.restore`, which is what Ctrl+Shift+T calls): a new
    tab id, no opener, commits typed `reload`, back history intact.
17. **Firefox restore:** the tab value is already readable at `tabs.onCreated`. Commits
    have the same double pattern as a duplicate.
    → **Identity rule (Firefox):** if a tab's value belongs to a session whose tab is
    **still open**, the tab is a *duplicate*: fork it and assign a fresh value. If that
    session is **closed**, it's a *restore*: continue the session (B11). Chromium can't
    use tab values, so matching goes through the `reload` commit pattern and the URLs,
    together with `sessions.getRecentlyClosed` (R2).
    → **Restoration commits** (the first commits of a duplicated or restored tab, and the
    Firefox double commit) must not create nodes. They set the cursor.

### Noise to filter

18. Firefox emits `onErrorOccurred` with `Error code 2152398850`
    (`NS_BINDING_ABORTED`, 0x804B0002) after successful commits: the initial
    `about:blank`, cross-origin process switches, and Back. It isn't a failure; ignore it
    when the same URL committed.
19. The initial `about:blank` of a new tab commits as `start_page` in Chromium and as
    `link []` in Firefox. Ignore it.

### Automation artifacts (not real browser behaviour)

- Playwright `goto` gives `typed`. WebDriver `get` in Firefox gives **`link`**. A real
  address-bar entry in Firefox is `typed [from_address_bar]` (finding 20).
- Playwright-created tabs have the control page as `openerTabId`.
- The Firefox driver switches tabs through WebDriver, which adds `tabs.onActivated`
  events (`prev=1` is the control tab). Dwell times in these fixtures are meaningless.

### Manual scenarios, Firefox (findings 20–29)

Recorded by hand in Firefox 156 on 2026-09-25 (`driver: manual` in the fixtures).

20. **Typed URL:** `typed [from_address_bar]`. **Address-bar search:**
    `generated [from_address_bar]`. **Bookmark:** `auto_bookmark []`. B8's dashed "jump"
    edge has a clean signal for all three.
21. Every Back in the manual runs, pressed by hand, reported `forward_back`, as in
    automation (finding 1).
22. **Real sites reload themselves without a click.** Google re-commits the results page
    with `&sei=…` about 0.5 s after load; YouTube re-commits with `&themeRefresh=1`. Both
    are `link []` with no preceding `content.click`, so finding 6's client-redirect
    inference is needed on real sites, not only for `location.replace`.
23. **`onHistoryStateUpdated` also fires with an unchanged URL** (Google, twice).
    → Ignore it when the URL equals the cursor visit's URL.
24. **Consent interstitials sit in the back stack.** The YouTube link went through
    `consent.youtube.com` (`server_redirect`), and the consent click was `form_submit
    [server_redirect]` back to YouTube. Pressing Back then landed on the consent page
    before reaching Google.
    → Open design question: fold known interstitials (consent pages, login bounces) into
    `redirectChain` rather than showing them as nodes. Not covered by the spec yet.
25. **Ctrl+Shift+T on the last tab of a window:** closing reports `tabs.onRemoved`
    with `isWindowClosing = true` plus `windows.onRemoved`. Undo brings back a *new window*
    (new window id) holding a tab with a new tab id, and **the tab value is readable at
    `tabs.onCreated`**. It is replayed with the same double commit as finding 17, and its
    back history is intact.
26. **Move to another window** (drag out and back): `onDetached`/`onAttached` with the
    **same tab id and the same tab value**, plus `windows.onCreated`/`onRemoved` for the
    temporary window. B10 ("same session continues") needs no reconciliation.
27. **Tab switching:** `tabs.onActivated` carries `previousTabId` reliably.
    **`windows.onFocusChanged` passes through `-1`** (no window) on every window switch,
    and also whenever focus leaves the browser.
    → Dwell time must debounce `-1` for a few hundred ms before it counts as "browser
    unfocused".
28. **Real restart with session restore** (fixture `restart.json`, which merges two
    marker pairs so the startup snapshot is included): after the restart, **tab ids are
    new but tab values survived** (the B tab went from id 7 to id 3 and kept `1d728c4b`,
    and so did the C tab), and Back in the restored tab gave `forward_back`. B12 works in
    Firefox as specified.
29. **Caveat on 28:** in dev mode the extension is a temporary add-on that web-ext
    installs *after* Firefox has restored the session. So there are no `tabs.onCreated`
    events for the restored tabs, and the startup `snapshot` is the only evidence. A
    permanently installed build starts with the browser and should see the restore as
    events (`runtime.onStartup`, then `tabs.onCreated` with tab values). That is not
    verified yet.

### S1b: telling `pushState` from `replaceState` (findings 30–33)

`src/entrypoints/history-probe.content.ts` runs in the page's main world at
`document_start` and wraps `History.prototype.pushState`/`replaceState`. For each call it
dispatches a DOM event with `{kind, from, url, lengthBefore, lengthAfter}` as a JSON
string. The isolated probe forwards that as `content.history`. `npm run s1b:check` pairs
each top-frame `onHistoryStateUpdated` with its probe record. Scenarios: `spa` and the new
`spa-replace` (push, replace with the same URL, push with the same URL, replace, Back ×3).

30. **Every non-back history-state update matched exactly one probe record in both
    browsers, 1–7 ms apart**, same tab and same URL. The probe runs early enough, and
    the JSON-string payload crosses the world boundary in Firefox and Chromium alike.
31. **`history.length` confirms the call type:** push is +1, replace is ±0. This gives an
    independent cross-check, because a page could dispatch a fake probe event.
32. **Same-URL calls fire `onHistoryStateUpdated` too.** `replaceState` with the same URL
    changes nothing in the back stack. `pushState` with the same URL *adds* an entry: Back
    then lands on the same URL again, as `forward_back`. This is the likely explanation
    for finding 23 (Google), which was recorded before the probe existed; an optional
    manual Google search would confirm it.
33. Back/forward history updates (`forward_back`) come from `popstate` and correctly have
    **no** probe record. So "history update without a probe record and without
    `forward_back`" is itself a signal: either a navigation API the probe doesn't wrap, or
    a page the probe couldn't reach.
    → Projector rules, now in SPEC §6.1:
    - **push to a new URL:** new visit (B5).
    - **replace:** update the cursor visit's URL/title; no node.
    - **push to the same URL:** sub-event, no node; a later `forward_back` to the same URL
      moves no cursor.
    - **no probe record:** fall back to the old rule (a path/query change counts as push).

Dev-setup lessons from this run: web-ext's `user.js` forces `browser.startup.page = 0`,
and the recorder page lost its ✓ state on reload. Both are fixed (`web-ext.config.ts`;
state is now derived from the stored markers).

## Still open

| What | Why |
|---|---|
| Chromium manual scenarios (the same seven, via `npm run dev`) | `typed`/`generated`/`auto_bookmark` in Chromium, and whether a real restart restores tabs that can be matched by the `reload` commit pattern and URL (R2) |
| Restart with a permanently installed build, in both browsers | Finding 29: which events a real installation sees during session restore |
| Optional: one manual Google search in dev Firefox with the probe loaded | Confirms finding 32 explains finding 23 |
