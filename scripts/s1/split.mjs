// Split raw S1 logs (automated or exported from the recorder page) into one fixture per
// scenario: fixtures/s1/<browser>/<scenario>.json. Later runs overwrite earlier ones.
//   node scripts/s1/split.mjs fixtures/s1/raw/*.json ~/Downloads/s1-firefox-manual-*.json
import fs from 'node:fs';
import path from 'node:path';
import { splitByMarkers } from './lib.mjs';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: split.mjs <raw.json>...');
  process.exit(1);
}

for (const file of files) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const browser = raw.browser ?? raw.records[0]?.browser ?? 'unknown';
  const dir = path.resolve('fixtures/s1', browser);
  fs.mkdirSync(dir, { recursive: true });
  const seen = {};
  for (const s of splitByMarkers(raw.records)) {
    seen[s.scenario] = (seen[s.scenario] ?? 0) + 1;
    const name = seen[s.scenario] > 1 ? `${s.scenario}-${seen[s.scenario]}` : s.scenario;
    const fixture = {
      scenario: s.scenario,
      browser,
      ua: raw.ua,
      driver: raw.driver ?? s.note,
      status: s.status,
      source: path.basename(file),
      recordedAt: new Date(s.start.t).toISOString(),
      records: s.records,
    };
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(fixture, null, 1) + '\n');
    console.log(`${browser}/${name}.json  ${s.records.length} records  ${s.status}`);
  }
}
