<!-- Answers exported from spec-questions.html on 2026-09-25. Source of truth for the
     decision ids cited in SPEC.md. -->

# dude spec answers

## A. Scope, platforms & stack

- **A1** Which browsers for v1?
  → Firefox and Chrome equally, one code base
- **A2** Other Chromium browsers (Edge, Brave, Vivaldi)?
  → Best effort: should work, not tested
- **A3** Firefox for Android?
  → Later, keep the core portable
- **A4** Distribution?
  → Personal use: AMO unlisted (self-signed XPI) and Chrome 'load unpacked'
- **A5** License?
  → MIT
- **A6** Build tooling?
  → TypeScript + WXT (Vite-based, builds Firefox and Chrome MV3 from one source)
- **A7** UI framework for the history app and sidebar?
  → Svelte (small bundles, fast)
- **A8** Manifest version?
  → MV3 in both browsers

## B. Session & graph model (the core)

- **B1** What is one session, i.e. one graph?
  → One tab's lifetime (open → close)
- **B2** The same URL is reached again in the same tab by a new link (not Back). What happens?
  → New node (the session stays a tree); both nodes linked with a faint 'same page' connector
  → OTHER: I would also like to see the cycles to understand which works best
- **B3** Back/Forward in a tab: how is it recorded?
  → Moves the cursor to the existing node, logged as an event (playback shows it), no new node or edge
  → OTHER: Would like to see both
- **B4** Redirect chains (A → 302 → B → JS redirect → C)?
  → One node for the final page; hops kept as metadata
- **B5** Single-page-app navigations (pushState: YouTube, GitHub, search result paging)?
  → New node when path or query changes (debounced ~500 ms)
- **B6** Pure #fragment changes (in-page anchors)?
  → Sub-event on the current node, no new node
- **B7** Reload?
  → Same node, reload counter +1
- **B8** Typed URL, bookmark or address-bar search inside an existing tab?
  → Child of the current node, drawn as a dashed 'jump' edge
- **B9** Link opened in a new tab (middle-click, target=_blank)?
  → New session with its own graph, cross-linked to the source node; a 'family' view shows them together
- **B10** Tab moved to another window / detached?
  → Same session continues
- **B11** Closed tab restored (Ctrl+Shift+T / 'Undo close tab')?
  → The same session continues
  → OTHER: store in meta data
- **B12** After a browser restart with session restore?
  → Continue the old sessions (reliable in Firefox; best-effort URL+index match in Chrome, else new linked session)
  → OTHER: store in meta data
- **B13** Duplicate tab?
  → New session forked at the current node (points back to it)
- **B14** Pages that were the result of a form POST?
  → Normal node, flagged POST; 'reopen' warns, the screenshot is the record
- **B15** iframes / subframe navigations?
  → Top-level frame only

## C. Recording & playback

- **C1** Besides navigations, what should be recorded?
  → Tab open / close / move / activate (timeline and dwell time)
  → Window focus changes
  → Text of the link that was clicked (anchor text): helps 'which page linked here'
  → Search terms extracted from search-engine URLs
- **C2** What does 'play back' mean?
  → Animated replay in the extension: graph builds up step by step, screenshot per step, timeline scrubber
- **C3** Playback timing?
  → Real order, idle gaps compressed (e.g. max 2 s per step), speed control
- **C4** Playback scope?
  → A single tab session
  → A tab family (source tab + spawned tabs, interleaved)
  → A whole day / time range across all tabs
- **C5** When is recording active?
  → Always on, with a global pause, per-tab pause and per-site exclusion rules
- **C6** Private / incognito windows?
  → Never recorded
- **C7** Store the page's text for full-text search?
  → Yes: readable main text (Readability-style), max ~50 KB/visit, compressed

## D. Screenshots

- **D1** When to capture?
  → After load + ~1 s settle, and on tab activation if the node has none or a stale one
- **D2** Tabs opened in the background and closed without ever being viewed?
  → Firefox: captureTab if it works in background; Chrome: favicon placeholder
- **D3** Capture area?
  → Visible viewport
- **D4** Resolution / format?
  → Thumbnail ~320 px + preview ~1280 px, both WebP
- **D5** Page changes after load (feeds, SPAs, dialogs)?
  → Keep up to N distinct screenshots per visit (perceptual-hash dedupe)
- **D6** Sensitive pages?
  → Built-in deny list (banking, payment, password managers)
  → User-editable deny list (domain globs)
  → Skip capture while a password field is visible
  → Excluded visits still leave an anonymous placeholder node (tree keeps its shape)

## E. Storage & retention

- **E1** Where is data stored?
  → Local IndexedDB only (unlimitedStorage)
- **E2** Retention?
  → Graph + text forever; screenshot previews 90 days, then thumbnail only; global size cap
- **E3** Default size cap?
  → 2 GB
- **E4** Sync between machines?
  → No
- **E5** Export / import?
  → Zip: event log as JSON + screenshot blobs
- **E6** Encryption at rest?
  → No: rely on the OS / browser profile
- **E7** Backfill from existing native history on install?
  → Chrome: import as read-only 'imported' sessions using referringVisitId; Firefox: skip

## F. History takeover & UI

- **F1** What does 'take over the history function' mean exactly?
  → No override; the extension's own page sits next to native history
  → OTHER: I thought you've mentioned something like that in your other response. I don't want to enrich/touch the history view of the browser
- **F2** Keyboard shortcut to open the history app (Ctrl+H stays native in Firefox)?
  → No shortcut, toolbar button only
- **F3** Which UI surfaces?
  → Full-page history app
  → Sidebar / side panel with the live graph of the current tab
  → Toolbar popup: 'you came here from …' ancestor path
  → Page context menu: 'Show where I came from'
  → Omnibox keyword (e.g. type 'h ' + search)
- **F4** Default view when opening the history app?
  → Session list grouped by day; cards with thumbnail strip; click → graph
- **F5** Graph layout?
  → Left-to-right tree, order of first visit on the x-axis, branches stacked vertically
- **F6** Node appearance?
  → Thumbnail card with favicon + title
- **F7** Graph rendering library?
  → ELK.js for layout + own SVG/Canvas renderer
  → OTHER: all the options are good. Iwould like to able to explore this later, if a premade solution works better.
- **F8** Search capabilities?
  → Title + URL
  → Full page text
  → Filters: date range, domain, tab family
  → Visual browse: thumbnail wall
- **F9** How does a search hit show 'which page linked here'?
  → Breadcrumb of ancestors with thumbnails on every hit, plus 'Open parent' / 'Show in graph'
- **F10** Theme & language?
  → Follow browser light/dark; English only

## G. Re-opening pages & navigation

- **G1** Clicking a node in the history app?
  → Open in a new tab
- **G2** 'Open with path': rebuild a real back stack by loading the ancestor chain in a new tab?
  → Offer it as an explicit action (GET pages only, POST ancestors skipped)
- **G3** A tab reopened from the history app belongs to…
  → A new session, linked to the original node ('reopened from')
- **G4** 'Semantic back' command (go to the graph parent, even if the native Back would go elsewhere)?
  → Yes: shortcut + sidebar button

## H. Privacy, permissions & quality

- **H1** Host permission <all_urls> (needed for screenshots and text)?
  → Required at install, clearly explained
- **H2** Telemetry / network access?
  → None at all, the extension never makes network requests
- **H3** Test strategy?
  → Unit tests of the projector on recorded event fixtures + Playwright (Chromium) and web-ext (Firefox) E2E scenarios
- **H4** First milestone?
  → Recorder + projector + sidebar tree (no screenshots) in Firefox, to validate the model
