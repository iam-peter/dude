# dude

A Firefox/Chrome WebExtension that records every tab as its own navigation tree, with
branches, cross-tab provenance, screenshots and playback: an own history next to the
browser's. See [docs/SPEC.md](docs/SPEC.md).

Current state: **M6**, all roadmap milestones built. Every tab is recorded as its own tree with screenshots and page
text. It's shown live in the Firefox sidebar or the Chrome side panel, and in full in the
sessions app, which also searches everything recorded. The S1
spike findings behind the recording rules are in [docs/S1-FINDINGS.md](docs/S1-FINDINGS.md).

## Installing (release build)

Builds a release for personal use (A4). The release check runs first, so no test hooks
can get in.

```bash
npm run release
```

- **Chrome:** open `chrome://extensions`, turn on *Developer mode*, choose *Load unpacked*
  and pick `dist/chrome`. That folder stays put, so after the next release press the
  reload button on dude's card.
- **Firefox** needs a signed `.xpi`, signed as an *unlisted* add-on: AMO signs it, but it
  isn't published. Create API credentials once at
  <https://addons.mozilla.org/developers/addon/api/key/>, then run the following. It asks
  for the JWT issuer and, with hidden input, the secret, so neither ends up in your shell
  history or in any file in this repo. `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` in the
  environment work too.

  ```bash
  npm run release -- --sign
  ```

  Install `dist/firefox/*.xpi` via `about:addons` → ⚙ → *Install Add-on From File*. Every
  signed upload needs a new version in `package.json`.

  **Updates:** releases are published on the `updates` branch of
  <https://github.com/iam-peter/dude>. Its `updates.json` is the manifest's `update_url`,
  so an installed copy updates itself: Firefox checks about once a day, or right away
  with `about:addons` → ⚙ → *Check for Updates*.

  **Publishing** runs on GitHub Actions (`.github/workflows/release.yml`): bump the version
  in `package.json`, commit and push to `main`, and the workflow tests, signs and
  publishes it. It can also be started by hand from the *Actions* tab. It needs the AMO
  credentials once as repository secrets (*Settings → Secrets and variables → Actions*):
  `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`. The same works locally, asking for the
  credentials:

  ```bash
  npm run release -- --publish
  ```

  Either way, it signs as above, adds the xpi and its entry in `updates.json` to the `updates`
  branch and tags the commit `v<version>`. It stops before signing if the tree has
  uncommitted changes or the tag exists. If the push fails, run it again: the signed xpi
  is reused as long as it was built from the same commit. For a first install, download
  `https://raw.githubusercontent.com/iam-peter/dude/updates/dude-<version>.xpi`, then
  install it from file.

The installed extension keeps its data in your normal browser profile, separate from the
dev profile in `.profiles/` that `npm run dev:firefox` uses.

The icon is `assets/icon.svg` (plus a simplified `assets/icon-16.svg` for the toolbar
size); `npm run icons` renders them to `public/icon/`.

## Using it

```bash
npm run dev:firefox
```

- The **dude** toolbar button opens a popup with the path that led to the current page
  ("you came here from …"). From there, **Show tree** opens the sidebar (Firefox) or side
  panel (Chrome; `npm run dev` opens Chrome for Testing), and **All sessions** opens the
  sessions app.
- **Sessions app** (`sessions.html`): every tab session by day with thumbnails. For the
  selected session it shows a left-to-right graph with screenshot cards and the three
  views; click a page for its details (screenshots, how you got there, link text, search
  terms, redirects, stored page text), double-click to open it.
- **Search** (sessions app, or type `h <words>` in the address bar): titles, addresses,
  page text, search terms and link texts, filterable by time, domain and tab family. Each
  hit shows the pages that led to it, across tabs too. **Wall** shows every screenshot,
  newest first.
- **Open with path** (details panel) reopens a page in a new tab by walking through the
  pages that led to it, so the tab's Back button works.
- **Semantic back**: Alt+Shift+Up, or the ↑ link in the sidebar, goes to the page you came
  from, even when Back would go somewhere else. Right-click a page → **Show where I came
  from** opens the sidebar with that page highlighted.
- **Playback** (session header → *Play back…*): replays this tab, this tab with the tabs
  opened from it, or the whole day, step by step with screenshots. Space plays and
  pauses, ← and → step. Idle time is shortened to at most 2 s per step; speed runs from
  0.5× to 8×.
- **Settings** (popup → Settings, or `about:addons`): pause recording, your own excluded
  sites (recorded only as anonymous placeholders), the screenshot size cap and preview
  age, export/import as a zip, Chrome history import, and deleting by site, by time
  range, or everything. Single pages and sessions can be deleted in the sessions app.
  The popup also pauses single tabs.
- **Screenshots** are taken about 1 s after a page loads (Firefox also captures
  background tabs), never on banking, payment or password-manager sites, and never while
  a password field is visible. Previews of pages you only glanced at are pruned; thumbnails
  stay. It shows the tree of the active
  tab: following a link adds a child, Back then another link starts a branch, and tabs
  opened from a link are linked both ways ("opened from …", ↗ badges).
- **Tree / + Moves / Network** switch between the three renderings of the same data
  (SPEC §5.2). Hover a row for details; click it to open the page in a new tab.
- **debug** (bottom of the sidebar) prints the whole projection as text. **rebuild from
  log** replays the stored observation log from scratch, which is useful after changing
  the projector.

Architecture: `src/background/recorder.ts` turns browser events into observations,
`src/storage/db.ts` appends them to an IndexedDB log, and the pure
`src/core/projector.ts` folds them into sessions and visits. `src/core/views.ts` derives the
three views, and `src/ui/GraphView.svelte` draws them.

Screenshots of the sidebar in all three views after a scripted browsing sequence
(Chromium, headless; needs the test site and a `npm run build:test`):

```bash
scripts/node22.sh node scripts/m1/screens.mjs /tmp/dude-screens
```

The sidebar page also works as a normal tab: `sidepanel.html?tab=<id>&mode=network`
(or `?session=<id>`). The same goes for `popup.html?tab=<id>` and
`sessions.html?session=<id>&mode=…`. Screenshots of the popup and the sessions app:

```bash
scripts/node22.sh node scripts/m3/screens.mjs /tmp/dude-screens
```

`scripts/m3/capture-check.mjs chromium|firefox` browses slowly and prints which pages got
screenshots (▣) and text (¶). `scripts/m4/nav-check.mjs chromium|firefox` checks open with
path, semantic back and "reopened from". `scripts/m6/check.mjs chromium|firefox` checks
exclusions, pause and delete (grepping the raw log for leftovers), and in Chromium export →
delete everything → import through the settings page.

Tests (the projector against every S1 fixture, plus rule tests):

```bash
npm test
```

End-to-end: drives all automated scenarios in Chromium and Firefox with the real extension,
and compares the live projection with [tests/e2e/](tests/e2e/README.md). It needs the test
site running:

```bash
npm run e2e
```

## Setup

WXT needs Node ≥ 22 (see `.nvmrc`). All npm scripts run through `scripts/node22.sh`,
which picks the first Node ≥ 22 among: the `node` on `PATH`, `/snap/bin/node`, and
`$NODE22_HOME/bin/node` (default `~/.local/opt/node-22`). So `npm run …` works from a plain
shell even when the system Node is older.

`web-ext.config.ts` is machine-local (gitignored). It keeps persistent dev profiles in
`.profiles/` (snap Firefox can't read web-ext's temporary profiles in `/tmp`) and points
`npm run dev` at Playwright's Chrome for Testing.

## Test builds

The automation drivers, the S1 recorder page and the S2 probe need **test hooks**: a relay
that lets the Firefox driver talk to the extension through the test site, the spike
recorders, and a few test-only commands. They are compiled in only with
`DUDE_TEST_HOOKS=1`, into `.output-test/`. Normal builds, dev mode and release zips in
`.output/` don't contain them, and the background accepts commands only from the
extension's own pages (`src/background/trust.ts`).

```bash
npm run build:test
```

```bash
npm run zip:firefox:test
```

(`dev:test` / `dev:firefox:test` for dev mode with the hooks.) The `s1:*` and `e2e:*`
scripts build test builds by themselves. Before shipping a zip, check that no test code
got in:

```bash
npm run check:release
```

## S1: recording raw navigation events

The raw recorder only exists in test builds, and is off by default there too, because it
logs everything unfiltered. The automation drivers switch it on; for manual runs start
`npm run dev:firefox:test` and use the **raw recording** checkbox on the S1 page (sidebar
footer → S1 recorder). `--projection` on either driver also prints what
the live M1 projector made of the run.

Start the test site (localhost:8765, with 127.0.0.1:8765 as the second origin):

```bash
npm run s1:site
```

Automated scenarios. Each writes `fixtures/s1/raw/<browser>-auto-*.json`; add `--headed`
to watch and `--only id,id` to pick scenarios:

```bash
npm run s1:chromium
```

```bash
npm run s1:firefox
```

Split raw logs into per-scenario fixtures (`fixtures/s1/<browser>/<scenario>.json`):

```bash
npm run s1:split -- fixtures/s1/raw/*.json
```

Read one as a timeline:

```bash
npm run s1:summary -- fixtures/s1/firefox/branch.json
```

Check that every SPA history update is paired with the history probe's push/replace
report (S1b):

```bash
npm run s1b:check -- fixtures/s1/*/spa*.json
```

### Manual scenarios

Load the extension with test hooks:

```bash
npm run dev:firefox:test
```

(or `npm run dev` for Chromium). Then open the S1 recorder page (sidebar footer → S1
recorder) and tick **raw recording**. For each scenario, press **Start**, do the steps in another tab, and press **End**.
Finally press **Export JSON** and split the downloaded file:

```bash
npm run s1:split -- ~/Downloads/s1-firefox-manual-*.json
```

Notes:

- Branded Google Chrome ignores `--load-extension`. The Chromium driver uses Playwright's
  Chrome for Testing from `~/.cache/ms-playwright`; set `S1_CHROMIUM` to override it.
- In Firefox MV3, host permissions may need granting in `about:addons`, otherwise the
  click probe doesn't run. The `snapshot` records show the granted permissions.
- The recorder records **everything** you browse while it's installed, into the
  extension's IndexedDB. Use **Clear** on the recorder page, or uninstall it, when done.
