// Screenshot the sidebar in all three views after a scripted browsing sequence
// (Chromium, headless). The sidebar page opens as a normal 380 px wide tab, pinned to the
// browsing tab via ?tab=.
//   node scripts/m1/screens.mjs <out-dir>        (needs npm run s1:site and a chrome-mv3 build)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const out = path.resolve(process.argv[2] ?? 'screens');
fs.mkdirSync(out, { recursive: true });
const EXT = path.resolve('.output/chrome-mv3');
const cache = path.join(os.homedir(), '.cache/ms-playwright');
const exe = fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().map((d) => path.join(cache, d, 'chrome-linux64/chrome')).filter(fs.existsSync).at(-1);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-screens-'));
const ctx = await chromium.launchPersistentContext(profile, { executablePath: exe, headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
const SITE = 'http://localhost:8765';
const pause = (ms = 400) => new Promise((r) => setTimeout(r, ms));
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const id = new URL(sw.url()).host;
  const p = await ctx.newPage();
  const go = async (sel) => { await p.click(sel); await p.waitForLoadState('load'); await pause(); };
  await p.goto(`${SITE}/a`); await pause();
  await go('#to-b');
  await go('#to-a');          // revisit A: a cycle in the network view
  await go('#to-c');
  await p.goBack(); await pause();
  await p.goBack(); await pause(); // back on B
  await go('#to-d');          // branch from B
  await p.click('#to-b', { button: 'middle' }); await pause(800); // spawned tab
  await go('#to-spa');
  await go('#push-p1');
  await go('#push-p2q');
  await p.goBack(); await pause();
  await go('#to-a');
  await pause(800);

  const panel = await ctx.newPage();
  await panel.setViewportSize({ width: 380, height: 900 });
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  const tabs = await panel.evaluate(() => chrome.tabs.query({}));
  const tab = tabs.find((t) => t.url === `${SITE}/a` && t.index === p.index?.()) ?? tabs.filter((t) => t.url?.startsWith(SITE)).find((t) => t.url === `${SITE}/a`);
  for (const mode of ['tree', 'moves', 'network']) {
    await panel.goto(`chrome-extension://${id}/sidepanel.html?tab=${tab.id}&mode=${mode}`);
    await pause(mode === 'network' ? 1500 : 600);
    const file = path.join(out, `sidebar-${mode}.png`);
    await panel.screenshot({ path: file, fullPage: true });
    console.log(file);
  }
  const debug = await panel.evaluate(() => chrome.runtime.sendMessage({ cmd: 'dude.debug' }));
  console.log(debug.text);
} finally {
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
