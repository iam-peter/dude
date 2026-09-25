// S2: measure screenshot capture in one browser and print a JSON report
// (fixtures/s2/<browser>.json). Needs the test site and a build (chromium: npm run build,
// firefox: npm run zip:firefox).
//   node scripts/s2/capture.mjs chromium|firefox [--headed]
import fs from 'node:fs';
import path from 'node:path';
import { SITE } from '../../src/spike/scenarios.ts';
import { sleep } from '../s1/runner.mjs';

const browser = process.argv[2];
const { driver: d, close, version, wd } =
  browser === 'firefox'
    ? await (await import('../s1/drivers/firefox.mjs')).launchFirefox()
    : await (await import('../s1/drivers/chromium.mjs')).launchChromium();

try {
  const red = await d.newTab();
  await d.goto(red, `${SITE}/color?c=ff0000`);
  await sleep(500);
  await d.middle(red, '#to-blue'); // background tab, never shown (D2)
  await sleep(1500);
  const tabs = await d.send({ cmd: 'tabs' });
  const A = tabs.find((t) => t.url?.endsWith('c=ff0000'));
  const B = tabs.find((t) => t.url?.endsWith('c=0000ff'));
  const report = { browser, version, at: new Date().toISOString(), tabs: { red: A?.id, blueBackground: B?.id } };

  report.env = await d.send({ cmd: 's2.env' });
  report.visible = await d.send({ cmd: 's2.capture', how: 'visible', windowId: A.windowId, n: 3 });
  if (report.env.captureTab) {
    report.tabPreviouslyShown = await d.send({ cmd: 's2.capture', how: 'tab', tabId: A.id, n: 3 });
    report.tabNeverShown = await d.send({ cmd: 's2.capture', how: 'tab', tabId: B.id, n: 3 });
  }
  // Rate limit: back-to-back captures (Chrome documents ~2/s).
  report.burst = await d.send({ cmd: 's2.capture', how: 'visible', windowId: A.windowId, n: 8 });
  // Realistic content for WebP sizes/timings (D4): show the busy page in the red tab.
  await d.goto(red, `${SITE}/busy`);
  await sleep(1200); // also lets Chrome's capture quota recover
  const busy = (await d.send({ cmd: 'tabs' })).find((t) => t.url?.endsWith('/busy'));
  report.encode = await d.send({ cmd: 's2.encode', how: report.env.captureTab ? 'tab' : 'visible', tabId: busy.id, windowId: busy.windowId });
  await sleep(600);
  report.spaced = [];
  for (let i = 0; i < 4; i++) {
    report.spaced.push(...(await d.send({ cmd: 's2.capture', how: 'visible', windowId: A.windowId, n: 1 })));
    await sleep(550);
  }

  // Minimised window (Firefox, headed only: headless windows can't be minimised).
  if (report.env.captureTab && process.argv.includes('--headed') && wd) {
    await wd.manage().window().minimize();
    await sleep(1000);
    report.tabInMinimisedWindow = await d.send({ cmd: 's2.capture', how: 'tab', tabId: B.id, n: 2 });
  }

  const dir = path.resolve('fixtures/s2');
  fs.mkdirSync(dir, { recursive: true });
  const suffix = process.argv.includes('--headed') ? '-headed' : '';
  fs.writeFileSync(path.join(dir, `${browser}${suffix}.json`), JSON.stringify(report, null, 1) + '\n');
  console.log(JSON.stringify(report, null, 1));
} finally {
  await close();
}
