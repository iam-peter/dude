# E2E projection expectations

`npm run e2e` drives the automated S1 scenarios in Chromium (Playwright) and Firefox
(geckodriver) with the real extension. After each scenario it compares the **live**
projection (recorder → log → projector) with `<browser>/<scenario>.txt`. The format is
`describe.ts`'s, with session ids renumbered per scenario.

Regenerate after an intended behaviour change, then review the diff before committing:

```bash
node scripts/s1/auto-chromium.mjs --e2e-update
```

```bash
node scripts/s1/auto-firefox.mjs --e2e-update
```

Known differences between the two browsers, all reviewed:

- **Root edges:** Chromium roots are `(jump)` because Playwright navigates as `typed`.
  WebDriver navigates as `link` in Firefox, so Firefox roots have no marker.
- **`firefox/typed-in-tab`:** the same WebDriver artifact makes the typed `/c` look like a
  client redirect of `/b` (`via[/b]`). A real typed URL is `typed` in Firefox (S1 #20) and
  isn't folded.
- **`close-restore`:** Firefox matches the restored tab by its tab value (no marker).
  Chromium matches by URL (`~`), with medium confidence (`~?`) when earlier scenarios left
  closed sessions on the same page. The most recently closed one wins, which is what
  Ctrl+Shift+T restores.
