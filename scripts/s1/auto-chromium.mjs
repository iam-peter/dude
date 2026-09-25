// S1: run the automated scenarios in Chromium via Playwright and write the raw log to
// fixtures/s1/raw/. Needs the test site (npm run s1:site) and a chrome-mv3 build.
//   node scripts/s1/auto-chromium.mjs [--only id,id] [--headed] [--e2e | --e2e-update] [--projection]
import path from 'node:path';
import { launchChromium } from './drivers/chromium.mjs';
import { parseOnly, runScenarios, sleep, writeRaw } from './runner.mjs';

const { driver, extId, close, version } = await launchChromium();
try {
  console.log(`Chromium ${version} — extension ${extId}`);
  const { results, records } = await runScenarios(driver, { only: parseOnly() });
  await sleep(200);
  const file = writeRaw('chromium', driver.name, records, results);
  console.log(`\n${records.length} raw events → ${path.relative(process.cwd(), file)}`);
} finally {
  await close();
}
