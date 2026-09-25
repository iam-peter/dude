// M6: exclusions, pause and delete end to end, plus (Chromium) export → import through
// the real settings page.
//   node scripts/m6/check.mjs chromium|firefox
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SITE, OTHER_ORIGIN } from '../../src/spike/scenarios.ts';
import { sleep } from '../s1/runner.mjs';

const browser = process.argv[2] ?? 'chromium';
const launched = browser === 'firefox' ? await (await import('../s1/drivers/firefox.mjs')).launchFirefox() : await (await import('../s1/drivers/chromium.mjs')).launchChromium();
const { driver: d, close, version } = launched;
const tabIdOf = async (suffix) => (await d.send({ cmd: 'tabs' })).find((t) => t.url?.endsWith(suffix))?.id;
const since = Date.now();
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

try {
  console.log(`${browser} ${version}`);
  // 1. exclusion: the other origin (127.0.0.1) is on the user's deny list
  await d.send({ cmd: 'dude.setDenyHosts', hosts: ['127.0.0.1'] });
  await sleep(300);
  const t = await d.newTab();
  await d.goto(t, `${SITE}/a`);
  await d.click(t, '#to-other'); // → 127.0.0.1/a, excluded
  await d.click(t, '#to-b'); // → 127.0.0.1/b, excluded
  await d.goto(t, `${SITE}/c`);
  await sleep(1500);
  check((await d.send({ cmd: 'dude.grepLog', needle: '127.0.0.1' })) === 0, 'excluded site: no trace of 127.0.0.1 in the log');
  let text = await d.send({ cmd: 'dude.describeSince', since });
  check(text.includes('(excluded page)'), 'excluded pages are placeholders in the tree');

  // 2. per-tab pause
  const tabId = await tabIdOf('/c');
  await d.send({ cmd: 'dude.pause', paused: true, tabId });
  await d.click(t, '#to-d'); // not recorded
  await d.send({ cmd: 'dude.pause', paused: false, tabId });
  await d.click(t, '#to-b'); // recorded, via an unknown edge
  await sleep(800);
  text = await d.send({ cmd: 'dude.describeSince', since });
  check(!text.includes('/d'), 'paused tab: /d was not recorded');
  check(/\/b \(unknown\)/.test(text), 'after resume the next page hangs under an unknown edge');
  console.log(text);

  // 3. delete one page
  const s = await d.send({ cmd: 'dude.session', tabId });
  const c = Object.values(s.visits).find((v) => v.url.endsWith('/c'));
  await d.send({ cmd: 'dude.delete', what: { kind: 'visit', visitId: c.id } });
  text = await d.send({ cmd: 'dude.describeSince', since });
  check(!text.includes('/c'), 'deleted page is gone from the tree');
  check((await d.send({ cmd: 'dude.grepLog', needle: `${SITE}/c` })) === 0, 'deleted page is gone from the log');

  // 4. export → delete everything → import (Chromium: through the settings page)
  if (browser === 'chromium') {
    const before = await d.send({ cmd: 'dude.describeSince', since: 0 });
    const page = await launched.ctx.newPage();
    await page.goto(`chrome-extension://${launched.extId}/options.html`);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export everything' }).click()]);
    const file = path.join(os.tmpdir(), `dude-export-${Date.now()}.zip`);
    await dl.saveAs(file);
    check(fs.statSync(file).size > 1000, `export written (${fs.statSync(file).size} bytes)`);
    await d.send({ cmd: 'dude.deleteAll' });
    await sleep(500);
    // Tabs still open are recorded again from a clean start; /a is not open any more.
    check((await d.send({ cmd: 'dude.grepLog', needle: `${SITE}/a` })) === 0, 'delete everything: pages no longer open are gone from the log');
    page.on('dialog', (dlg) => dlg.accept());
    await page.locator('input[type=file]').setInputFiles(file);
    await page.getByText(/Imported \d+ observations/).waitFor({ timeout: 15000 });
    const after = await d.send({ cmd: 'dude.describeSince', since: 0 });
    check(after.includes('/a') && after.includes('(excluded page)'), 'import restored the recorded sessions');
    check(after.split('\n').filter((l) => l.includes('/a')).length >= before.split('\n').filter((l) => l.includes('/a')).length, 'import brought back at least as much as before the delete');
    fs.rmSync(file);
  }
} finally {
  await close();
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
