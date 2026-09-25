// Render assets/icon.svg (and the 16 px variant) to public/icon/<size>.png with the cached
// Chrome for Testing, transparent background.
//   node scripts/icons.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const cache = path.join(os.homedir(), '.cache/ms-playwright');
const exe = fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().map((d) => path.join(cache, d, 'chrome-linux64/chrome')).filter(fs.existsSync).at(-1);
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
fs.mkdirSync('public/icon', { recursive: true });
for (const size of [16, 32, 48, 96, 128]) {
  const svg = fs.readFileSync(size === 16 ? 'assets/icon-16.svg' : 'assets/icon.svg', 'utf8');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `public/icon/${size}.png`, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(`public/icon/${size}.png`);
}
await browser.close();
