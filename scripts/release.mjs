// Build a release of dude (A4: personal use).
//   npm run release              check, build and zip both browsers; Chrome folder → dist/chrome
//   npm run release -- --sign    …and sign the Firefox build as an unlisted AMO add-on → dist/firefox
//
// Signing reads the AMO API credentials from WEB_EXT_API_KEY and WEB_EXT_API_SECRET
// (https://addons.mozilla.org/developers/addon/api/key/). They never go into the repository.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const sign = process.argv.includes('--sign');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const env = { ...process.env, DUDE_TEST_HOOKS: '' }; // never a test build
const run = (cmd) => execSync(cmd, { env, stdio: 'inherit' });

if (sign && !(process.env.WEB_EXT_API_KEY && process.env.WEB_EXT_API_SECRET)) {
  console.error('Signing needs WEB_EXT_API_KEY and WEB_EXT_API_SECRET (AMO → Tools → Manage API Keys).');
  process.exit(1);
}

console.log(`\n== dude ${pkg.version}: release check`);
run('node scripts/check-release.mjs');

console.log('\n== build and zip');
run('npx wxt zip');
run('npx wxt zip -b firefox');

// Chrome: "Load unpacked" wants a folder that stays put between builds.
const chromeDir = path.resolve('dist/chrome');
fs.rmSync(chromeDir, { recursive: true, force: true });
fs.cpSync('.output/chrome-mv3', chromeDir, { recursive: true });

const firefoxZip = `.output/${pkg.name}-${pkg.version}-firefox.zip`;
const sourcesZip = `.output/${pkg.name}-${pkg.version}-sources.zip`;

if (sign) {
  console.log('\n== sign for Firefox (unlisted)');
  fs.mkdirSync('dist/firefox', { recursive: true });
  run(`npx web-ext sign --channel unlisted --source-dir .output/firefox-mv3 --upload-source-code ${sourcesZip} --artifacts-dir dist/firefox`);
}

console.log(`
== done: dude ${pkg.version}
Chrome   chrome://extensions → Developer mode → Load unpacked → ${chromeDir}
         (after a new release: the reload button on dude's card)
Firefox  ${sign ? `about:addons → ⚙ → Install Add-on From File → dist/firefox/*.xpi` : `unsigned: ${firefoxZip} (run with --sign to get an installable .xpi)`}
`);
