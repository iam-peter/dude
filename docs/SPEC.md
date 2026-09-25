# Tab-session history extension — Functional Specification

Status: **draft 1, 2026-09-25**. Working title: *dude*. Derived from the 61 answers in
[spec-answers.md](spec-answers.md), collected with [spec-questions.html](spec-questions.html).
Each requirement carries the id of the question it came from (e.g. *(B2)*), so every
decision can be traced back.

---

## 1. Problem

Two things go wrong with the built-in browser history:

1. **You remember how a page looked, not what it was called.** History is a list of
   titles and URLs. It has no pictures, so you can't recognise a page by sight.
2. **History doesn't know where you came from.** Say you remember page *B* by name and
   want the page *A* that linked to it. You find *B* in history and open it, but pressing
   Back doesn't take you to *A*. The reopened tab has no back stack, or the wrong one.
   Also, the browser's back stack is linear: if you go back and then follow another link,
   the branch you left is thrown away.

## 2. Product in one paragraph

A WebExtension for Firefox and Chrome (A1) that provides **its own history**, next to the
browser's native one. The native history and its UI are never modified, overridden or
enriched (F1). Every tab's browsing is recorded as its own **navigation graph** (B1).
Following a link adds a child node. Going back and then following a different link starts
a **branch**. A tab opened from a link in another tab is its own graph, **cross-linked**
to the page that spawned it (B9). Each visit gets a **screenshot** (D1) and its readable
**page text** (C7). The user can search the recording by title, URL, text or visually
(F8), see any hit **in context** with its ancestors (F9), reopen any node (G1), and
**play back** a session, a tab family or a whole day as an animated timeline (C2, C4).

## 3. Goals and non-goals

Goals

- G1: Every top-level navigation in every normal tab is recorded with enough structure to
  rebuild the per-tab tree, including branches the native back stack drops.
- G2: Cross-tab provenance. A tab opened from a link knows its source visit.
- G3: A visual record of each visit (screenshot), searchable and browsable.
- G4: One click answers "which page linked here?"
- G5: Playback of recorded sessions in the order things happened.
- G6: One code base for Firefox and Chrome (A1). Other Chromium browsers (Edge, Brave,
  Vivaldi) should work but aren't tested (A2).

Non-goals (v1)

- Touching the browser's native history in any way: no `chrome_url_overrides`, no writing
  into or deleting from native history, no Ctrl+H rebinding (F1, F2).
- Rewriting a live tab's native back/forward stack. Browsers don't allow it, see §9.
- Faithfully re-running POST results or logged-in pages. The screenshot is the record
  (B14).
- Sync between machines (E4), encryption at rest (E6), telemetry (H2), languages other
  than English (F10).
- Firefox for Android. The core is kept portable so it can follow later (A3, §11).

## 4. Platform facts and limits

Everything in §2 fits in a WebExtension. The limits that shape the design:

| Topic | Chrome (MV3) | Firefox (MV3) | Consequence |
|---|---|---|---|
| Navigation events | `webNavigation.onCommitted` with `transitionType` and `transitionQualifiers` (`forward_back`, `client_redirect`, `server_redirect`, `from_address_bar`) | Same API. S1: `forward_back` and `server_redirect` are reliable. `client_redirect` is missing for JS `location.replace` | The qualifier decides back/forward, never the type. Firefox JS redirects are inferred ([S1-FINDINGS](S1-FINDINGS.md) 1–6) |
| SPA navigations | `onHistoryStateUpdated`, `onReferenceFragmentUpdated` | Same | §6.2 |
| Tab provenance | `onCreatedNavigationTarget` (`sourceTabId`), `tabs.onCreated.openerTabId` | Same | Spawn edges (§5.3) |
| Stable tab identity across restart | None. Tab ids change, so match by (window index, tab index, URL) | `sessions.setTabValue/getTabValue` survives restart and closed-tab restore | Chrome restore is best-effort (B12) |
| Screenshots | `tabs.captureVisibleTab`: active tab of a window only; strict quota, a third capture within a second fails, 550 ms spacing is safe (S2 #3) | `tabs.captureTab(tabId)` also captures never-shown background tabs and tabs in minimised windows, 6–11 ms (S2 #1) | Chrome background tabs that are never viewed get no screenshot (D2) |
| Side UI | `sidePanel` | `sidebar_action` | Live graph of the current tab (§8.1) |
| Background lifetime | Service worker, killed after about 30 s idle | Event page (non-persistent) | No in-memory-only state. Events are persisted before a handler returns (§11) |
| Private windows | Allowed only if the user opts in | Same | Never recorded, even when allowed (C6) |

Stack (A4–A8): TypeScript, WXT, Svelte, Manifest V3 in both browsers, MIT license.
Distributed for personal use: an unlisted, self-signed XPI from AMO for Firefox, and
"load unpacked" in Chrome. `npm run release [-- --sign]` builds both; the Firefox
sources zip for AMO review excludes the recorded fixtures (they contain real browsing).
Firefox 140 is the minimum (`data_collection_permissions`).

## 5. Data model

The record is **event-sourced**. An append-only **event log** is the source of truth.
**Sessions**, **visits** and **edges** are projections of it, kept in IndexedDB so reads
are fast. Playback (§10) reads the log. Graph views read the projections. If the
projection code has a bug, the projections can be rebuilt from the log.

### 5.1 Entities

```
Session      one tab lifetime, open → close (B1)
  id, browser tab id (volatile), window id, createdAt, closedAt?
  rootVisitId, cursorVisitId          // cursor = where the tab currently is
  spawnedFrom?: { sessionId, visitId, kind: link|duplicate|reopen|restore }
  lifecycle: LifecycleEntry[]         // (B11, B12)

LifecycleEntry
  kind: closed|restored-closed-tab|restored-startup|moved-window
  at, windowId?, matchedBy?: tabValue|heuristic, confidence?

Visit        one node in a session tree
  id, sessionId, url, normUrl, title, faviconUrl
  firstAt, lastAt, dwellMs, reloadCount (B7)
  transition: link|typed|bookmark|form|generated|spa|...
  method: GET|POST                    // POST pages flagged (B14)
  redirectChain: string[]             // (B4)
  fragments: {hash, at}[]             // in-page anchors (B6)
  anchorText?                         // text of the clicked link (C1)
  searchQuery?                        // extracted from search-engine URLs (C1)
  screenshots: ScreenshotRef[]        // up to N distinct (D5)
  textRef?                            // readable text (C7)
  excluded: boolean                   // anonymous placeholder (D6)
  imported: boolean                   // backfilled from Chrome history (E7)

Edge         parent → child inside a session, or across sessions
  from, to, kind: link|jump|form|spa|spawn|duplicate|reopen

Event        the append-only log, one row per observed fact
  seq, at, sessionId?, type, payload
  types: tab.open|tab.close|tab.activate|tab.move|tab.restore|window.focus|
         nav.new|nav.back|nav.forward|nav.reload|nav.fragment|nav.redirect|
         link.click|capture|text
```

`normUrl` is the URL without its fragment and with known tracking parameters (`utm_*`,
`fbclid`, `gclid`, …) removed. It is the key for "same page" (§5.2).

### 5.2 Tree, cursor moves and network: three views of one data set (B2, B3)

The *stored* structure is always a **tree per session**:

- A new navigation hangs under the *current cursor node*, so branches come for free.
- Back/forward creates no node and no edge. It moves the cursor and logs
  `nav.back`/`nav.forward` (B3).
- A URL reached again by a new navigation becomes a new node. Both visits share a
  `normUrl` (B2).

The graph view (§8.2) can switch between three **derived** renderings, so they can be
compared in real use, as the answers to B2 and B3 asked:

| View | Nodes | Edges |
|---|---|---|
| **Tree** (default) | one per visit | parent → child; faint "same page" connector between visits with equal `normUrl` |
| **Tree + moves** | one per visit | tree edges, plus curved back/forward arcs from the log, numbered in time order |
| **Network** | one per distinct `normUrl` in the session | every tree edge and back/forward move collapsed onto merged nodes, so cycles become visible; edge weight = traversal count |

All three come from the same projection plus the log. Switching views never changes
stored data. Which view becomes the default is decided after real use.

### 5.3 Cross-tab provenance (B9, B13)

When a tab is created from a link (`onCreatedNavigationTarget`, or `openerTabId` plus a
matching first URL), the new session gets `spawnedFrom = {source session, source cursor
visit, kind: link}`. A duplicated tab gets `kind: duplicate` and a fork at the source
cursor (B13). A **tab family** is the set of sessions connected by spawn edges. Each
session keeps its own graph. The family view draws them side by side with spawn edges
between them. A tab opened with Ctrl+T has no parent.

## 6. Recording rules

### 6.1 Event → model mapping (top-level frame only, B15)

| Observed | Effect |
|---|---|
| `onCommitted`, link/form, not `forward_back` | New visit, child of cursor, cursor moves to it. The HTTP method comes from the `content.submit` probe; the event has none (S1 #10) |
| `onCommitted`, typed/bookmark/keyword/address-bar search | New visit, child of cursor, edge kind `jump`, drawn dashed (B8) |
| `onCommitted` with `forward_back` | Cursor moves to the matching visit (§6.3). No new node. Logs `nav.back`/`nav.forward` (B3) |
| `onCommitted`, `reload` | `reloadCount++` on cursor (B7) |
| `server_redirect`/`client_redirect` | Folded into one visit for the final page. Hops go into `redirectChain` (B4). A client redirect folds the *previous* visit, which committed on its own first. In Firefox, JS redirects are inferred: no click/submit, within about 1.5 s of the previous load (S1 #5, #6) |
| `onHistoryStateUpdated` | Classified by the main-world history probe (S1 #30–33). **push** to a new URL: new visit, debounced 500 ms (B5). **replace**: updates the cursor visit's URL/title, no node. **push** to the same URL: sub-event, no node. Without a probe record: a path/query change counts as push; the same URL is ignored (S1 #23) |
| `onReferenceFragmentUpdated` | Appended to `fragments` of the cursor, no node (B6) |
| `onCompleted` | Update title and favicon. Schedule capture (§7.1) and text extraction (§7.2) |
| `tabs.onUpdated` title/favicon | Update cursor visit |
| `tabs.onActivated`, `windows.onFocusChanged` | Log `tab.activate` / `window.focus`. Dwell time is derived from these (C1); a focus of `-1` (no window) counts only after a few hundred ms, because every window switch passes through it (S1 #27). May trigger capture |
| `tabs.onCreated` + `onCreatedNavigationTarget` | New session with `spawnedFrom` (B9) |
| `tabs.onRemoved` | `closedAt` set, lifecycle `closed` |
| `tabs.onAttached/Detached` | Same session continues. Lifecycle `moved-window` (B10) |
| Closed tab restored | Same session continues. `closedAt` cleared, lifecycle `restored-closed-tab` with how it was matched (B11) |
| Browser start with session restore | Sessions continue. Lifecycle `restored-startup`. Firefox matches via tab value. Chrome matches when URL *and* index agree; otherwise it starts a new session with `spawnedFrom.kind = restore` (B12) |
| Tab duplicated | New session forked at the source cursor (B13). Chrome: `openerTabId` = source. Firefox: the tab value is copied from a tab that is *still open* (S1 #14, #15) |
| Chrome: first commit of a new tab is `reload` | A replay, not a navigation (Chrome has no tab values). If the opener shows that page, it's a duplicate: fork (B13, S1 #14). Otherwise restore the most recently closed session showing it (B11, S1 #16). Recorded as `matchedBy: heuristic`, with confidence `high` when the URL was unambiguous, else `medium` (R2) |
| Chrome: startup snapshot after a restart | New tab ids are matched to the sessions whose tabs vanished, by URL, oldest session first; same confidence rule (B12, R2) |
| First commits of a restored/duplicated tab | Restoration, not navigation: no new node, only the cursor is set. Chrome reports `reload`; Firefox sends `link []` then `link [forward_back]` for the same URL (S1 #14–17) |
| `onErrorOccurred` `NS_BINDING_ABORTED` (Firefox) | Ignored when the same URL committed (S1 #18) |
| POST navigation | Normal visit, `method = POST` (B14) |

### 6.2 Clicked link text and search terms (C1)

- A content script listens for clicks on `<a>` elements in the capture phase, including
  middle-clicks and modifier-clicks. It sends `{href, text}` to the background, which
  logs it as `link.click`. The next commit in that tab, or the next navigation target it
  creates, with a matching URL within 5 s gets that text as `anchorText`.
- `searchQuery` is extracted from the URLs of a built-in list of engines (Google, Bing,
  DuckDuckGo, Startpage, Ecosia, Kagi, YouTube, Wikipedia search) and is searchable.

### 6.3 Detecting back/forward

The primary signal is the `forward_back` qualifier. S1 confirmed it in both browsers, also
for SPA and fragment entries. The commit keeps the *original* entry's transition type, so
the type must be ignored here. As a fallback, a navigation counts as back/forward when there was no preceding `link.click`
and its URL equals the cursor's parent or the child the cursor last left. The log records
which signal fired, so wrong guesses can be diagnosed.

### 6.4 When recording is active (C5, C6, D6)

- Always on. There is a global pause and a per-tab pause, both in the toolbar popup.
- Per-site exclusion rules (domain globs) come from a built-in deny list for banking,
  payment and password managers, plus a user-editable list.
- An excluded visit is stored as an **anonymous placeholder node**: no URL, title,
  screenshot or text, only its position and time, so the tree keeps its shape. The
  recorder anonymises before anything is logged (`src/core/privacy.ts`), so an excluded
  page's address never reaches the log.
- A pause stops navigation and page content from being logged; tab structure (created,
  closed, focus) goes on. After a resume the next page hangs under an "unknown" edge, so
  the gap is visible.
- Private windows are never recorded.

## 7. Screenshots and page text

### 7.1 Capture policy (D1–D6)

- **When:** after `onCompleted` plus a settle delay (about 1 s, longer after SPA
  navigations), and when a tab becomes active and its cursor visit has no screenshot or
  only a stale one.
- **What:** the visible viewport (D3).
- **Throttling:** one global capture queue. Chromium captures are spaced ≥ 550 ms apart,
  with one retry after a quota error; Firefox needs no spacing (S2 #3). The queue never
  steals focus or delays page load.
- **Background tabs:** Firefox captures them with `captureTab`, which S2 confirmed for
  never-shown tabs and minimised windows (S2 #1). Chrome shows a favicon placeholder
  until the tab is viewed (D2).
- **Encoding:** a thumbnail about 320 px wide (WebP, quality 0.75) and a preview
  `min(1024, source)` px wide (WebP, quality 0.7), encoded with `OffscreenCanvas`
  directly in the background; this works in Chrome's service worker too, so no offscreen
  document (D4, S2 #4, #6). The PNG data URL from the capture API is never stored.
- **Preview budget** (decided 2026-09-25, S2 #7): previews are kept only for visits looked
  at for at least 3 s, pruned once the visit is no longer current, and for at most 90 days.
  Every visit keeps its thumbnails. A maintenance alarm runs every 10 minutes and also
  deletes blobs no visit references.
- **Changes after load:** up to N distinct screenshots per visit (default N = 5), deduped
  by perceptual hash (dHash) (D5).
- **Sensitive pages:** no capture on deny-listed sites, and none while a password field
  is visible. A content-script probe reports this before each capture (D6).

### 7.2 Page text (C7)

A content script extracts the readable main text (Readability-style) after load. It is
capped at about 50 KB per visit, compressed, and full-text indexed. Deny-listed pages are
not extracted.

## 8. User interface

### 8.1 Surfaces (F2, F3)

- **Toolbar button with popup:** shows the ancestor path of the current page ("you came
  here from …") with thumbnails, link texts and search terms, plus **Show tree** (opens the
  sidebar / side panel) and **All sessions**. The pause toggles come with M6. This button
  is the only way into the history app besides the omnibox. There is no global shortcut
  to open it (F2).
- **History app:** a full extension page, `sessions.html`. It never replaces
  `chrome://history` or `about:history` (F1). Note: WXT turns an entrypoint *named*
  `history` into a `chrome_url_overrides.history` override, so the entrypoint must never
  be called that.
- **Sidebar / side panel:** live tree of the *current* tab with the cursor highlighted.
  Clicking a node opens it (§9). It also has the *Semantic back* button (G4).
- **Page context menu:** "Show where I came from" opens the sidebar focused on the parent.
- **Omnibox keyword `h`:** typing `h <terms>` shows matching visits as suggestions, and
  Enter opens the history app's search.

### 8.2 History app views

1. **Session list** (default, F4): newest first, grouped by day. Each card shows the
   root title, duration, visit count and a strip of thumbnails. Spawned sessions are
   indented under their family.
2. **Graph view** of one session or family: left-to-right, with order of first visit on
   the x-axis and branches stacked vertically (F5). Nodes are thumbnail cards with
   favicon and title (F6). The cursor and dead branches are styled distinctly. A view
   switch offers **Tree / Tree + moves / Network** (§5.2). Pan, zoom and minimap.
3. **Visual browse:** a thumbnail wall filtered by date, domain and tab family (F8).
4. **Search:** title, URL, full text, search terms and anchor text, with filters for date
   range, domain and tab family (F8). Every hit shows a **breadcrumb of its ancestors with
   thumbnails**, plus *Open parent* and *Show in graph* (F9). The breadcrumb continues
   across "opened from" links into the tab a page was opened from. The index (MiniSearch)
   lives in the sessions page, cached in IndexedDB and synced incrementally, so each page
   text is indexed once. The omnibox searches titles, URLs, search terms and link texts
   only, straight from the projection.
5. **Settings:** exclusion list, retention and size cap, export/import, Chrome history
   backfill.

Light/dark follows the browser. UI text is English only (F10).

### 8.3 Graph rendering (F7)

The first implementation uses **ELK.js** for layout and an own Svelte **SVG renderer**,
with Canvas used for large graphs. Layout and rendering sit behind a `GraphView`
interface (input: nodes, edges and view mode; output: events such as node click and
hover), so a premade solution (Cytoscape.js, Svelte Flow, D3 + d3-dag) can be tried and
swapped in later without touching the data layer. Spike S3 compares them once real
recorded data exists.

### 8.4 Visit details panel

Screenshots (as a filmstrip if there are several), URL, redirect chain, time range, dwell,
anchor text, search query, children and branches, and the spawning or spawned tabs.
Actions: open, open with path (§9), copy URL, delete visit, delete session.

## 9. Re-opening and semantic back

The native back stack of a tab can't be edited, so the extension provides:

- **Open** (G1): the node's URL in a new tab. The new session gets
  `spawnedFrom.kind = reopen` pointing at the original visit (G3). POST nodes show a
  warning first (B14).
- **Open with path** (G2): an explicit action. A new tab is navigated through the node's
  GET ancestors one URL at a time, which gives it a real native back stack. POST
  ancestors are skipped. Progress is shown, and the action can be cancelled.
- **Semantic back** (G4): navigates the current tab to its graph parent, even when the
  native Back button would go somewhere else. At a tab's first page, the parent is the page
  the tab was opened from. It is available as a sidebar button and as a command with a
  suggested shortcut of Alt+Shift+Up, which the user can rebind. It is logged as a
  navigation, not as `nav.back`.
- Navigations dude starts itself (open with path, semantic back) carry no user gesture,
  so each is announced to the log with a `nav.intent` observation first; otherwise the
  projector would fold them as client redirects (§6.1).

## 10. Playback (C2–C4)

An animated replay inside the extension. It never drives real tabs. The sessions app
reads the observation log, replays it through a fresh projector and records what a viewer
would have seen change after each observation: a page first visited, a back/forward move,
the cursor moving, focus switching to another tab (`src/core/timeline.ts`). Playback
renders that replay's own final state, so it shows what the log says, independent of the
live projection. The layout is computed once for the whole replay; each frame shows only
the pages visited so far, so pages appear in place.

- **Scope:** a single tab session, a tab family (interleaved), or a day/time range across
  all tabs (C4).
- The graph builds up step by step. The cursor moves on back/forward, and branches appear
  as they were created. In family and day scope, each tab is a swimlane, and tab
  switches and window focus changes move a highlight between lanes.
- The current step's screenshot is shown large, with a filmstrip below.
- **Timing** (C3): real order, with idle gaps compressed to at most 2 s per step.
  Controls: play/pause, step ±1, a scrubber, and speed (0.5×–8×).

## 11. Architecture

```
core/          (browser-agnostic, no extension APIs: portable to Android later, A3)
  events       normalised event types
  projector    pure reducer (state, event) → state
  views        tree / tree+moves / network derivations (§5.2)
  search       index + query
platform/      thin adapter over browser.* APIs; Firefox/Chrome differences live here
background/    (service worker / event page)
  recorder     webNavigation, tabs, windows listeners → events → log
  identity     tab ↔ session mapping, restart/restore reconciliation
  capture      throttled queue → encoder → blobs
  retention    alarms: prune and downscale, enforce size cap
content/       link-click capture, readable-text extraction, password-field probe;
               a MAIN-world history probe (pushState/replaceState, S1 #30)
ui/            Svelte: history app, sidebar, popup, shared components, GraphView
storage/       Dexie over IndexedDB: events, sessions, visits, edges, blobs, text index
```

- The **projector is a pure function**. It holds the logic that matters, and it is tested
  against the S1 fixtures (H3).
- Every handler persists its event before returning, because the background can be killed
  at any time.
- The extension makes **no network requests** (H2).
- **Who may command the background:** only the extension's own pages (popup, sidebar,
  sessions app, settings), checked by sender URL and extension id. Content scripts run
  inside web pages, so their messages are limited to reporting page data for their own
  tab. Spike and test tooling (the S1/S2 recorders, the automation relay, test-only
  commands) exists only in test builds (`DUDE_TEST_HOOKS=1`, output in `.output-test/`);
  `npm run check:release` fails if any of it reaches a normal build.

## 12. Storage, retention and privacy (E1–E7, H1)

- Everything stays local in IndexedDB, with `unlimitedStorage` (E1).
- **Retention** (E2, E3): graph, log and text are kept forever. Screenshot previews are
  kept for 90 days, then only the thumbnail. A global size cap (default 2 GB) is enforced
  oldest-first on blobs, and a warning is shown before it starts deleting anything other
  than screenshots.
- **Export/import** (E5): a zip of the event log as JSON plus the screenshot blobs.
  Import rebuilds the projections.
- **Delete:** a visit, a session, a domain, or a time range. Deleting removes the
  matching log events too; it is a real delete, not a hide (`src/core/delete.ts`). Page
  content observations are removed and structural ones kept, with URLs and titles
  stripped; then the projection is rebuilt, a fresh checkpoint written, the pages'
  screenshots and texts deleted, and the search index cache dropped. Sessions remember
  which tab ids they had when (`bindings`), so a restored tab's data goes too.
- **Backfill** (E7): Chrome only, on request in Settings. Native history is imported as
  read-only `imported` sessions, with trees built from `referringVisitId`. Firefox is
  skipped.
- **Permissions** (H1): `webNavigation`, `tabs`, `storage`, `unlimitedStorage`,
  `sessions`, `alarms`, `contextMenus`, `sidePanel` /
  `sidebar_action`, and host permission `<all_urls>`, required at install. A first-run
  page explains why each is needed. `history` (Chrome, read-only) is requested only when
  the user starts a backfill.

## 13. Quality (H3)

- **Unit tests:** the projector and the view derivations against recorded S1 fixtures,
  one fixture per scenario and browser.
- **E2E:** Playwright on Chromium with the extension loaded, and `web-ext run` for
  Firefox. Scripted scenarios (link, back, back-then-new-link, redirect, SPA, reload,
  POST, middle-click, duplicate, close and restore, restart) assert the resulting graph.
- **Performance budget:** under 5 ms of background work per navigation event, excluding
  capture. No capture while a page is loading. 60 fps panning a 500-node graph.

## 14. Roadmap

| Step | Content |
|---|---|
| **S1** | Spike: record raw navigation, tab and window events for the §13 scenarios in Firefox and Chrome, and commit them as fixtures. *Firefox done (automated + manual); Chromium manual runs and a restart with an installed build still open, see [S1-FINDINGS](S1-FINDINGS.md)* |
| **S1b** | Spike: a MAIN-world probe that tells `pushState` from `replaceState` (S1 #7). *Done: both browsers, S1 #30–33* |
| **M1** (H4) | Firefox only: recorder, projector, IndexedDB log, sidebar tree of the current tab with all three views (§5.2). No screenshots. Goal: validate the model on real browsing. *Built 2026-09-25; in real-browsing validation* |
| **M2** | Chrome parity: platform adapter, restart heuristics, side panel, E2E in both browsers. *Built 2026-09-25: `npm run e2e` checks the live projection of all 19 scenarios in both browsers. A real Chrome restart is only covered by rule tests so far (the manual S1 Chromium runs are still open)* |
| **S2** | Spike: Firefox `captureTab` on background tabs; capture cost in both browsers. *Done, see [S2-FINDINGS](S2-FINDINGS.md)* |
| **M3** | Screenshots and page text, history app (session list, graph view, details panel), toolbar popup. *Built 2026-09-25. Not yet: pause toggles (M6), deleting visits/sessions from the details panel (M6)* |
| **S3** | Spike: renderer comparison behind `GraphView` (F7) |
| **M4** | Search, visual browse, omnibox, context menu, open / open with path, semantic back. *Built 2026-09-25. Context menu, omnibox and Alt+Shift+Up confirmed by hand in Firefox* |
| **M5** | Playback (all three scopes). *Built 2026-09-25* |
| **M6** | Retention and size cap, export/import, Chrome backfill, exclusion settings UI. *Built 2026-09-25, with pause, real delete and the first-run page. Chrome history import and the permission prompts need a manual check* |

## 15. Risks

- **R1** Firefox `transitionQualifiers` gaps. S1: `forward_back` is reliable; only the JS
  `client_redirect` is missing, and it is inferred (§6.1). Still to confirm manually with the
  real Back button and gestures.
- **R2** Chrome tab identity after a browser restart is guesswork. A wrong match would
  splice two sessions together. Mitigation: a match needs URL *and* index agreement, and
  every match is recorded in `lifecycle` with its confidence.
- **R3** Screenshots of sensitive content. Mitigation: deny lists, the password-field
  probe, local-only storage, easy delete.
- **R4** Storage growth. Mitigation: WebP, dedupe, retention, size cap.
- **R5** MV3 background restarts losing in-flight state. Mitigation: persist first.
- **R7** Consent pages and login bounces become nodes and clutter the path to the page
  that linked somewhere (S1 #24). Open question: fold known interstitials into
  `redirectChain`.
- **R6** SPA-heavy sites generating node spam. Mitigation: 500 ms debounce. The Network
  view also shows repeated URLs compactly.
