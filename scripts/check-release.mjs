// Release guard: build both browsers without test hooks and fail if any test-only code or
// page made it into the output (the automation relay could otherwise let a local web page
// drive the extension).
//   npm run check:release
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const MARKERS = [
  's1-control', // automation relay
  'dudeS1',
  's2.capture', // S2 capture probe
  's1.enable', // S1 raw recorder
  'dude.grepLog', // test-only commands
  'dude.setDenyHosts',
  'dude.describeSince',
  'localhost:8765', // the test site, and with it the scenario catalog
];
const env = { ...process.env, DUDE_TEST_HOOKS: '' };
let problems = 0;

for (const [target, cmd] of [['chrome-mv3', 'npx wxt build'], ['firefox-mv3', 'npx wxt build -b firefox']]) {
  execSync(cmd, { env, stdio: 'ignore' });
  const dir = path.resolve('.output', target);
  const files = fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => /\.(js|html|json)$/.test(f));
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of MARKERS) {
      if (text.includes(m)) {
        console.log(`FAIL ${target}/${f} contains “${m}”`);
        problems++;
      }
    }
  }
  if (fs.existsSync(path.join(dir, 's1.html'))) {
    console.log(`FAIL ${target}: s1.html is in the build`);
    problems++;
  }
  console.log(`${problems ? '…' : 'ok  '} ${target}: ${files.length} files checked`);
}
console.log(problems ? `\n${problems} problem(s): test hooks in a release build` : '\nrelease builds are free of test hooks');
process.exitCode = problems ? 1 : 0;
