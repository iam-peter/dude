// Screenshots for the README: a short research session on Wikipedia and MDN, then the
// popup, the sessions app, search, the wall and playback (Chromium, headless, 2×).
//   node scripts/readme/screens.mjs [out-dir]    (needs npm run build:test and network)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { launchChromium } from '../s1/drivers/chromium.mjs';

const out = path.resolve(process.argv[2] ?? 'docs/screenshots');
fs.mkdirSync(out, { recursive: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const WP = 'https://en.wikipedia.org';

const { ctx, extId, close } = await launchChromium({ contextOptions: { deviceScaleFactor: 2 } });
const ext = (p) => `chrome-extension://${extId}/${p}`;
const shot = async (page, name, opts = {}) => {
  await page.screenshot({ path: path.join(out, `${name}.png`), ...opts });
  console.log(`${name}.png`);
};
// Keep MDN's ad banner out of the pictures.
await ctx.route(/developer\.mozilla\.org\/pong\//, (r) => r.abort());
// Fit content height: a 1px-high viewport plus a full-page screenshot.
const fitShot = async (page, name, width) => {
  await page.setViewportSize({ width, height: 100 });
  await pause(300);
  await shot(page, name, { fullPage: true });
};
try {
  const control = ctx.pages()[0];
  const send = (msg) => control.evaluate((m) => chrome.runtime.sendMessage(m), msg);

  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1280, height: 800 });
  const settle = async (page, ms = 2500) => {
    await page.waitForLoadState('load').catch(() => undefined);
    await pause(ms);
  };
  // Follow an article link inside the page body.
  const follow = async (page, article) => {
    await page.click(`#mw-content-text a[href$="/wiki/${article}"] >> nth=0`);
    await settle(page);
  };
  const openInTab = async (page, article) => {
    const [tab] = await Promise.all([
      ctx.waitForEvent('page'),
      page.click(`#mw-content-text a[href$="/wiki/${article}"] >> nth=0`, { button: 'middle' }),
    ]);
    await tab.bringToFront(); // Chrome only captures the active tab
    await settle(tab);
    return tab;
  };

  // Search Wikipedia, then read along a chain of links with one detour back.
  await p.goto(`${WP}/w/index.php?search=${encodeURIComponent('hypertext')}`);
  await settle(p);
  await follow(p, 'Project_Xanadu');
  await follow(p, 'Ted_Nelson');
  await p.goBack();
  await settle(p, 1500);
  await p.goBack();
  await settle(p, 1500);
  await follow(p, 'Memex'); // branch from Hypertext
  await follow(p, 'Vannevar_Bush');
  const essay = await openInTab(p, 'As_We_May_Think');
  await follow(essay, 'The_Atlantic');
  await p.bringToFront();
  await follow(p, 'Differential_analyser');
  // A second site: the browser API this extension builds on.
  await p.goto('https://developer.mozilla.org/en-US/docs/Web/API/History_API');
  await settle(p);
  await p.click('main a[href$="/docs/Web/API/History/pushState"] >> nth=0');
  await settle(p);

  const tabs = await send({ cmd: 'tabs' });
  const tab = tabs.find((t) => t.url?.includes('pushState'));
  const session = (await send({ cmd: 'dude.session', tabId: tab.id }))?.session.id;
  await send({ cmd: 'dude.maintenance' });

  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 380, height: 560 });
  await popup.goto(ext(`popup.html?tab=${tab.id}`));
  await pause(1000);
  await fitShot(popup, 'popup', 380);

  const side = await ctx.newPage();
  await side.setViewportSize({ width: 400, height: 900 });
  await side.goto(ext(`sidepanel.html?tab=${tab.id}`));
  await side.addStyleTag({ content: 'a[href$="/s1.html"] { display: none }' }); // test builds only
  await pause(1500);
  await fitShot(side, 'sidepanel', 400);

  const app = await ctx.newPage();
  await app.setViewportSize({ width: 1440, height: 900 });
  for (const mode of ['tree', 'network']) {
    await app.goto(ext(`sessions.html?session=${session}&mode=${mode}`));
    await pause(2000);
    // Details of a Wikipedia page, with the whole graph in view.
    await app.click('.svelte-flow__node:has-text("Vannevar Bush")');
    await pause(800);
    await app.click('.svelte-flow__controls-fitview');
    await pause(1200);
    await shot(app, `sessions-${mode}`);
  }
  await app.goto(ext(`sessions.html?session=${session}&q=${encodeURIComponent('memex')}`));
  await pause(2500);
  await shot(app, 'search');
  await app.setViewportSize({ width: 1440, height: 400 });
  await app.goto(ext(`sessions.html?session=${session}&panel=wall`));
  await pause(2500);
  await shot(app, 'wall');
  await app.setViewportSize({ width: 1440, height: 480 });
  await app.goto(ext(`sessions.html?session=${session}&play=day`));
  await pause(2500);
  for (let i = 0; i < 9; i++) await app.keyboard.press('ArrowRight');
  await pause(1500);
  await shot(app, 'playback');
} finally {
  await close();
}

// 256 colours look the same here and halve the size; skipped without Python + Pillow.
const QUANTIZE = `
import sys
from PIL import Image
for f in sys.argv[1:]:
    Image.open(f).convert('RGB').quantize(256, Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(f, optimize=True)
`;
const pngs = fs.readdirSync(out).filter((f) => f.endsWith('.png')).map((f) => path.join(out, f));
try {
  execFileSync('python3', ['-c', QUANTIZE, ...pngs], { stdio: 'inherit' });
} catch {
  console.warn('python3 with Pillow not found: PNGs left unquantized');
}
