# dude

A Firefox/Chrome WebExtension that records every tab as its own navigation tree, with
branches, cross-tab provenance, screenshots and playback: an own history next to the
browser's. See [docs/SPEC.md](docs/SPEC.md).

Current state: **M2**. Every tab is recorded as its own tree and shown live in the Firefox
sidebar or the Chrome side panel, in three views (Tree, Tree + moves, Network). No
screenshots yet. The S1
spike findings behind the recording rules are in [docs/S1-FINDINGS.md](docs/S1-FINDINGS.md).

## Using it

```bash
npm run dev:firefox
```

- Click the **dude** toolbar button to open the sidebar (Firefox) or side panel (Chrome:
  `npm run dev` opens Chrome for Testing). It shows the tree of the active
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
(Chromium, headless; needs the test site and a `npm run build`):

```bash
scripts/node22.sh node scripts/m1/screens.mjs /tmp/dude-screens
```

The sidebar page also works as a normal tab: `sidepanel.html?tab=<id>&mode=network`
(or `?session=<id>`).

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

## S1: recording raw navigation events

The raw recorder is off by default since M1, because it logs everything unfiltered. The
automation drivers switch it on; for manual runs use the **raw recording** checkbox on the
S1 page (sidebar footer → S1 recorder). `--projection` on either driver also prints what
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

Load the extension:

```bash
npm run dev:firefox
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
