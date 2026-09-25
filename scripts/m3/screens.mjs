// M3: screenshots of the popup and the sessions app after browsing slowly enough for
// captures (Chromium, headless).
//   node scripts/m3/screens.mjs <out-dir>        (needs the test site and npm run build)
import fs from 'node:fs';
import path from 'node:path';
import { SITE } from '../../src/spike/scenarios.ts';
import { launchChromium } from '../s1/drivers/chromium.mjs';

const out = path.resolve(process.argv[2] ?? 'screens');
fs.mkdirSync(out, { recursive: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const { ctx, extId, close } = await launchChromium();
try {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1280, height: 720 });
  const go = async (sel, ms = 2200) => {
    await p.click(sel);
    await p.waitForLoadState('load');
    await pause(ms);
  };
  await p.goto(`${SITE}/busy`);
  await pause(2200);
  await p.goto(`${SITE}/a`);
  await pause(2200);
  await go('#to-b');
  await go('#to-c');
  await p.goBack();
  await pause(1500);
  await go('#to-d'); // branch from B
  await go('#to-newtab');
  await p.click('#blank'); // opens B in a new tab
  await pause(2500);
  await p.bringToFront();
  await go('#to-a'); // revisit A
  await p.goto(`${SITE}/color?c=2f7de1`);
  await pause(2200);

  const tabs = await p.evaluate(() => 0).then(() => ctx.pages()[0].evaluate(() => chrome.tabs.query({})));
  const tab = tabs.find((t) => t.url?.includes('color?c=2f7de1'));
  const session = (await ctx.pages()[0].evaluate((id) => chrome.runtime.sendMessage({ cmd: 'dude.session', tabId: id }), tab.id))?.session.id;

  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 380, height: 560 });
  await popup.goto(`chrome-extension://${extId}/popup.html?tab=${tab.id}`);
  await pause(800);
  await popup.screenshot({ path: path.join(out, 'popup.png') });

  const app = await ctx.newPage();
  await app.setViewportSize({ width: 1440, height: 900 });
  for (const mode of ['tree', 'moves', 'network']) {
    await app.goto(`chrome-extension://${extId}/sessions.html?session=${session}&mode=${mode}`);
    await pause(1500);
    await app.screenshot({ path: path.join(out, `sessions-${mode}.png`) });
  }
  // M4: search results with breadcrumbs, and the thumbnail wall.
  for (const [name, query] of [['search-text', 'lorem ipsum'], ['search-title', 'page b']]) {
    await app.goto(`chrome-extension://${extId}/sessions.html?session=${session}&q=${encodeURIComponent(query)}`);
    await pause(2500);
    await app.screenshot({ path: path.join(out, `sessions-${name}.png`) });
  }
  await app.goto(`chrome-extension://${extId}/sessions.html?session=${session}&panel=wall`);
  await pause(2000);
  await app.screenshot({ path: path.join(out, 'sessions-wall.png') });
  // M5: playback, stepped forward with the arrow keys.
  for (const [scope, n] of [['family', 8], ['day', 20]]) {
    await app.goto(`chrome-extension://${extId}/sessions.html?session=${session}&play=${scope}`);
    await pause(2500);
    for (let i = 0; i < n; i++) await app.keyboard.press('ArrowRight');
    await pause(1200);
    await app.screenshot({ path: path.join(out, `playback-${scope}.png`) });
  }
  console.log(fs.readdirSync(out).filter((f) => f.startsWith('popup') || f.startsWith('sessions')).join('\n'));
} finally {
  await close();
}
