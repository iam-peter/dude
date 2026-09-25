// Chromium driver for the S1/S2 scripts (Playwright + Chrome for Testing).
// S1_CHROMIUM overrides the browser binary (branded Google Chrome ignores --load-extension).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const EXT = path.resolve('.output/chrome-mv3');

function findChromium() {
  if (process.env.S1_CHROMIUM) return process.env.S1_CHROMIUM;
  const cache = path.join(os.homedir(), '.cache/ms-playwright');
  const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort() : [];
  const exe = dirs.map((d) => path.join(cache, d, 'chrome-linux64/chrome')).filter(fs.existsSync).at(-1);
  return exe; // undefined → Playwright's own pinned build
}

/** Launch Chromium with the chrome-mv3 build; returns the scenario driver (see runner.mjs). */
export async function launchChromium({ headed = process.argv.includes('--headed') } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-s1-chromium-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: findChromium(),
    headless: !headed,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  const control = ctx.pages()[0] ?? (await ctx.newPage());
  await control.goto(`chrome-extension://${extId}/s1.html`);
  const send = (msg) => control.evaluate((m) => chrome.runtime.sendMessage(m), msg);

  const nextPage = () => ctx.waitForEvent('page', { timeout: 5000 });
  const loaded = async (p) => {
    await p.waitForLoadState('load').catch(() => undefined);
    return p;
  };
  // Map a Playwright page to its extension tab id via URL among active tabs.
  const tabIdOf = async (p) => {
    await p.bringToFront();
    const tabs = await send({ cmd: 'tabs' });
    const t = tabs.find((x) => x.active && x.url === p.url()) ?? tabs.find((x) => x.url === p.url());
    if (!t) throw new Error(`no tab for ${p.url()}`);
    return t.id;
  };

  const driver = {
    name: 'playwright-chromium',
    browser: 'chromium',
    send,
    newTab: () => ctx.newPage(),
    goto: (p, url) => p.goto(url, { waitUntil: 'load' }),
    click: async (p, sel) => {
      await p.click(sel);
      await loaded(p);
    },
    clickOpeningTab: async (p, sel) => (await Promise.all([nextPage().then(loaded), p.click(sel)]))[0],
    middle: async (p, sel) => (await Promise.all([nextPage().then(loaded), p.click(sel, { button: 'middle' })]))[0],
    back: (p) => p.goBack({ waitUntil: 'load' }),
    forward: (p) => p.goForward({ waitUntil: 'load' }),
    reload: (p) => p.reload({ waitUntil: 'load' }),
    duplicate: async (p) => {
      const id = await tabIdOf(p);
      return (await Promise.all([nextPage().then(loaded), send({ cmd: 'duplicate', tabId: id })]))[0];
    },
    close: (p) => p.close(),
    restore: async () => (await Promise.all([nextPage().then(loaded), send({ cmd: 'restoreLast' })]))[0],
    activate: (p) => p.bringToFront(),
  };

  const close = async () => {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
  };
  return { driver, ctx, extId, close, version: ctx.browser()?.version() ?? '' };
}
