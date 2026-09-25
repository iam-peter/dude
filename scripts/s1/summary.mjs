// Print S1 fixtures (or raw logs) as a compact timeline.
//   node scripts/s1/summary.mjs fixtures/s1/chromium/branch.json [--verbose]
//   node scripts/s1/summary.mjs fixtures/s1/raw/chromium-auto-*.json      (all scenarios)
import fs from 'node:fs';
import { describe, splitByMarkers } from './lib.mjs';

const verbose = process.argv.includes('--verbose');
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));

for (const file of files) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const parts = json.scenario
    ? [{ scenario: json.scenario, status: json.status, records: json.records }]
    : splitByMarkers(json.records);
  for (const p of parts) {
    console.log(`\n=== ${json.browser ?? ''} ${p.scenario} (${p.status ?? ''})`);
    const t0 = p.records[0]?.t ?? 0;
    for (const r of p.records) {
      const line = describe(r, t0, { verbose });
      if (line) console.log(line);
    }
  }
}
