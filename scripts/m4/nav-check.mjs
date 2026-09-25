// M4: open with path, semantic back and "reopened from", end to end.
//   node scripts/m4/nav-check.mjs chromium|firefox
import { SITE } from '../../src/spike/scenarios.ts';
import { sleep } from '../s1/runner.mjs';

const browser = process.argv[2] ?? 'chromium';
const { driver: d, close, version } =
  browser === 'firefox' ? await (await import('../s1/drivers/firefox.mjs')).launchFirefox() : await (await import('../s1/drivers/chromium.mjs')).launchChromium();
const since = Date.now();
const tabIdOf = async (suffix) => (await d.send({ cmd: 'tabs' })).find((t) => t.url?.endsWith(suffix))?.id;
try {
  const t = await d.newTab();
  await d.goto(t, `${SITE}/a`);
  await d.click(t, '#to-b');
  await d.click(t, '#to-c');
  await sleep(800);
  const tabId = await tabIdOf('/c');
  const s = await d.send({ cmd: 'dude.session', tabId });
  const c = s.visits[s.session.cursorId];
  const b = s.visits[c.parentId];

  const job = await d.send({ cmd: 'dude.openPath', visitId: c.id });
  await sleep(4000);
  console.log(`${browser} ${version}\nopen with path: ${job.total} steps`);

  await d.send({ cmd: 'dude.semanticBack', tabId }); // original tab: C → its parent B, as a navigation
  await sleep(1500);
  await d.send({ cmd: 'dude.open', url: b.url, visitId: b.id });
  await sleep(1500);

  console.log(await d.send({ cmd: 'dude.describeSince', since }));
  console.log('omnibox "page b":', JSON.stringify((await d.send({ cmd: 'dude.quickSearch', q: 'page b' })).map((h) => h.title)));
} finally {
  await close();
}
