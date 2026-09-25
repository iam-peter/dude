// S1: run the automated scenarios in Firefox via geckodriver (WebDriver) and write the raw
// log to fixtures/s1/raw/. Needs the test site (npm run s1:site) and a firefox-mv3 zip
// (npm run zip:firefox).
//   node scripts/s1/auto-firefox.mjs [--only id,id] [--headed] [--e2e | --e2e-update] [--projection]
import path from 'node:path';
import { launchFirefox } from './drivers/firefox.mjs';
import { parseOnly, runScenarios, writeRaw } from './runner.mjs';

const { driver, extUuid, close, version } = await launchFirefox();
try {
  console.log(`Firefox ${version} — extension ${extUuid}`);
  const { results, records } = await runScenarios(driver, { only: parseOnly() });
  const file = writeRaw('firefox', driver.name, records, results);
  console.log(`\n${records.length} raw events → ${path.relative(process.cwd(), file)}`);
} finally {
  await close();
}
