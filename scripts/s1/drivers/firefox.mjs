// Firefox driver for the S1/S2 scripts (geckodriver / WebDriver).
// S1_FIREFOX / S1_GECKODRIVER override the binaries.
import fs from 'node:fs';
import path from 'node:path';
import { Browser, Builder, Button, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { SITE } from '../../../src/spike/scenarios.ts';
import { sleep } from '../runner.mjs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
// Test builds only (npm run zip:firefox:test): the drivers need the test hooks.
const XPI = path.resolve(`.output-test/${pkg.name}-${pkg.version}-firefox.zip`);
const GECKO_ID = '{53952834-ba6a-4072-9c32-c836b5a38a3c}';
const EXT_UUID = 'd0de5100-0000-4000-8000-000000000001'; // pinned so the control page URL is known

/** Launch Firefox with the firefox-mv3 zip; returns the scenario driver (see runner.mjs). */
export async function launchFirefox({ headed = process.argv.includes('--headed') } = {}) {
  const opts = new firefox.Options()
    .setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: EXT_UUID }))
    .setPreference('browser.tabs.warnOnClose', false)
    .setPreference('browser.sessionstore.max_tabs_undo', 25);
  if (!headed) opts.addArguments('-headless');
  if (process.env.S1_FIREFOX) opts.setBinary(process.env.S1_FIREFOX);

  const service = new firefox.ServiceBuilder(process.env.S1_GECKODRIVER ?? '/snap/bin/geckodriver');
  const wd = await new Builder().forBrowser(Browser.FIREFOX).setFirefoxOptions(opts).setFirefoxService(service).build();

  await wd.installAddon(XPI, true);
  await sleep(1000);
  const control = await wd.getWindowHandle();
  // WebDriver may not navigate to moz-extension:// — talk through the content-script relay.
  await wd.get(`${SITE}/s1-control`);
  await sleep(300);

  let current = control;
  const focus = async (h) => {
    if (h !== current) await wd.switchTo().window(h);
    current = h;
  };
  const send = async (msg) => {
    const back = current;
    await focus(control);
    const res = await wd.executeAsyncScript(
      'const [msg, done] = arguments; const id = Math.random();' +
        'addEventListener("message", function on(e) {' +
        '  if (e.data && e.data.dudeS1Reply === id) { removeEventListener("message", on); done(e.data.res); }' +
        '});' +
        'postMessage({ dudeS1: true, id, msg }, location.origin);',
      msg,
    );
    if (back !== control) await focus(back).catch(() => undefined);
    return res;
  };

  const waitLoaded = () =>
    wd.wait(async () => (await wd.executeScript('return document.readyState')) === 'complete', 5000).catch(() => undefined);
  const handles = () => wd.getAllWindowHandles();
  const newHandle = async (before, fn) => {
    await fn();
    let h;
    await wd.wait(async () => {
      h = (await handles()).find((x) => !before.includes(x));
      return !!h;
    }, 5000);
    return h;
  };
  // Firefox tab id of a handle: activate it, then ask the extension for the active tab.
  const tabIdOf = async (h) => {
    await focus(h);
    const url = await wd.getCurrentUrl();
    const tabs = await send({ cmd: 'tabs' });
    const t = tabs.find((x) => x.url === url && x.active) ?? tabs.find((x) => x.url === url);
    if (!t) throw new Error(`no tab for ${url}`);
    return t.id;
  };
  const el = (sel) => wd.wait(until.elementLocated(By.css(sel)), 5000);

  const driver = {
    name: 'geckodriver-firefox',
    browser: 'firefox',
    send,
    newTab: async () => {
      await wd.switchTo().newWindow('tab');
      current = await wd.getWindowHandle();
      return current;
    },
    goto: async (h, url) => {
      await focus(h);
      await wd.get(url);
    },
    click: async (h, sel) => {
      await focus(h);
      await (await el(sel)).click();
      await sleep(100);
      await waitLoaded();
    },
    clickOpeningTab: async (h, sel) => {
      await focus(h);
      const target = await el(sel);
      const nh = await newHandle(await handles(), () => target.click());
      await focus(nh);
      await waitLoaded();
      return nh;
    },
    middle: async (h, sel) => {
      await focus(h);
      const target = await el(sel);
      return newHandle(await handles(), () =>
        wd.actions().move({ origin: target }).press(Button.MIDDLE).release(Button.MIDDLE).perform(),
      );
    },
    back: async (h) => {
      await focus(h);
      await wd.navigate().back();
    },
    forward: async (h) => {
      await focus(h);
      await wd.navigate().forward();
    },
    reload: async (h) => {
      await focus(h);
      await wd.navigate().refresh();
    },
    duplicate: async (h) => {
      const id = await tabIdOf(h);
      const nh = await newHandle(await handles(), () => send({ cmd: 'duplicate', tabId: id }));
      await focus(nh);
      await waitLoaded();
      return nh;
    },
    close: async (h) => {
      if (!(await handles()).includes(h)) return;
      await focus(h);
      await wd.close();
      current = undefined;
      await focus(control);
    },
    restore: async () => {
      const nh = await newHandle(await handles(), () => send({ cmd: 'restoreLast' }));
      await focus(nh);
      await waitLoaded();
      return nh;
    },
    activate: (h) => focus(h),
  };

  const caps = await wd.getCapabilities();
  return { driver, wd, extUuid: EXT_UUID, close: () => wd.quit(), version: caps.get('browserVersion') };
}
