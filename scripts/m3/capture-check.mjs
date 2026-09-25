// M3: browse slowly enough for screenshots and page text, then print what was stored.
//   node scripts/m3/capture-check.mjs chromium|firefox
import { SITE } from '../../src/spike/scenarios.ts';
import { sleep } from '../s1/runner.mjs';

const browser = process.argv[2] ?? 'chromium';
const { driver: d, close, version } =
  browser === 'firefox' ? await (await import('../s1/drivers/firefox.mjs')).launchFirefox() : await (await import('../s1/drivers/chromium.mjs')).launchChromium();
const since = Date.now();
try {
  const t = await d.newTab();
  await d.goto(t, `${SITE}/busy`);
  await sleep(2500);
  await d.goto(t, `${SITE}/a`);
  await sleep(2500);
  await d.click(t, '#to-b');
  await sleep(2500);
  await d.goto(t, `${SITE}/color?c=ff0000`);
  await sleep(2500);
  await d.middle(t, '#to-blue'); // background tab: Firefox captures it, Chromium can't
  await sleep(3000);
  await d.goto(t, `${SITE}/form`);
  await sleep(2500);
  console.log(`${browser} ${version}`);
  console.log(await d.send({ cmd: 'dude.describeSince', since, media: true }));
  console.log('maintenance:', JSON.stringify(await d.send({ cmd: 'dude.maintenance' })));
} finally {
  await close();
}
