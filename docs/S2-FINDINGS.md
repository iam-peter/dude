# S2 — Screenshot capture: findings

Status: **done, 2026-09-25.** Chromium 151 (Chrome for Testing, headless) and Firefox 156
(headless and headed). Driver: `scripts/s2/capture.mjs <browser> [--headed]`. The probe,
`src/spike/s2-capture.ts`, runs in the background. Raw reports are in `fixtures/s2/`.

Method: the test site serves solid-colour pages (`/color?c=…`), so a capture's average
centre colour shows which page was actually captured, or whether it came back blank.
`/busy` has text, coloured boxes and a 400×220 noise region (incompressible, a worst case)
for realistic encode sizes.

## Findings

1. **Firefox `tabs.captureTab` captures background tabs**, including a tab that was
   opened in the background and **never shown** (the blue page came back blue), and a tab
   in a **minimised window** (headed run). It takes 6–11 ms per capture, and the size is
   the tab's viewport. → D2 "Firefox: captureTab if it works in background" holds
   without restriction.
2. **Chromium has no `captureTab`.** `captureVisibleTab` captures only the active tab of a
   window, in 17–51 ms. → Background tabs never shown in Chromium get the favicon
   placeholder (D2), as planned.
3. **Chromium's rate limit is strict.** Two back-to-back captures pass; the third fails
   immediately with `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`, and a burst of 8 fails
   entirely. Captures **550 ms apart all succeeded.** → The capture queue spaces Chromium
   captures ≥ 550 ms apart and retries once after a quota error. Firefox needs no spacing
   (8 back-to-back captures: all fine).
4. **WebP encoding works in the background in both browsers**, including Chromium's
   service worker (`OffscreenCanvas.convertToBlob({ type: 'image/webp' })` returns
   `image/webp`; `createImageBitmap` is available). → **No offscreen document is needed**
   in Chromium (SPEC §7.1 and §11 assumed one).
   Note: `convertToBlob` throws on a canvas that never had a rendering context; the first
   S2 environment probe mis-reported WebP as unavailable because of that.
5. **Encode cost and size (busy page, quality 0.8):**

   | | 320 px thumbnail | 1280 px preview |
   |---|---|---|
   | Chromium (source 1280×720) | 5 ms, 9.4 KB | 50 ms, 106 KB |
   | Firefox headless (1110×682) | 6 ms, 11 KB | 59 ms, 106 KB |
   | Firefox headed (881×954, tall window) | 9 ms, 21 KB | 102 ms, 179 KB |

   The PNG data URLs the capture APIs return are 450–550 KB; they must never be stored.
6. **Previews were upscaled** when the viewport was narrower than 1280 px (881 → 1280 in
   the headed run), which wastes space and adds nothing. → Preview width is
   `min(1280, source width)`. On HiDPI screens the source comes in device pixels and is
   downscaled as usual.
7. **Storage budget (E2, E3):** at about 15 KB per thumbnail plus 100–180 KB per preview, 200
   visits a day are 25–40 MB a day. 90 days of previews then reach 2.3–3.5 GB, *more than
   the 2 GB cap*. Options for M3 (decide there):
   - Preview quality 0.7, or 1024 px, which roughly halves the size.
   - Keep previews only for visits with dwell over a few seconds; all visits keep
     thumbnails.
   - Keep the preview only for the last screenshot of a visit (D5 allows up to N).

## Not covered

- Chromium **headed** was not measured; headless `captureVisibleTab` behaved as documented.
- Captures of pages mid-load or during animations: M3 captures after the settle delay (D1).
