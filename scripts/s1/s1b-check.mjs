// S1b: pair every top-frame onHistoryStateUpdated with the main-world probe's report
// (content.history) of the pushState/replaceState call behind it.
//   node scripts/s1/s1b-check.mjs fixtures/s1/*/spa*.json
// A pair = same tab, same URL, closest in time within MATCH_MS. forward_back updates come
// from popstate, not from a call, so they must have no probe record.
import fs from 'node:fs';
import { tabIdOf } from './lib.mjs';

const MATCH_MS = 1000;
const short = (u) => (u ?? '').replace(/^https?:\/\/(localhost|127\.0\.0\.1):8765/, '');

let problems = 0;
for (const file of process.argv.slice(2)) {
  const f = JSON.parse(fs.readFileSync(file, 'utf8'));
  const hsu = f.records.filter((r) => r.src === 'webNavigation.onHistoryStateUpdated' && r.data.frameId === 0);
  const probes = f.records.filter((r) => r.src === 'content.history').map((r) => ({ r, used: false }));
  if (!hsu.length && !probes.length) continue;

  console.log(`\n=== ${f.browser} ${f.scenario}`);
  const t0 = f.records[0].t;
  for (const h of hsu) {
    const back = (h.data.transitionQualifiers ?? []).includes('forward_back');
    const cands = probes.filter(
      (p) => !p.used && tabIdOf(p.r) === h.data.tabId && p.r.data.url === h.data.url && Math.abs(p.r.t - h.t) <= MATCH_MS,
    );
    const p = cands.sort((a, b) => Math.abs(a.r.t - h.t) - Math.abs(b.r.t - h.t))[0];
    if (p) p.used = true;
    const verdict = back ? (p ? 'UNEXPECTED probe on back/forward' : 'back/forward, no call (ok)') : p ? 'ok' : 'NO PROBE';
    if (verdict !== 'ok' && !verdict.endsWith('(ok)')) problems++;
    const what = p
      ? `${p.r.data.kind.padEnd(7)} length ${p.r.data.lengthBefore}→${p.r.data.lengthAfter}  Δt ${String(p.r.t - h.t).padStart(4)}ms`
      : ''.padEnd(34);
    console.log(
      `  +${String(h.t - t0).padStart(5)}ms  hsu ${short(h.data.url).padEnd(16)} [${(h.data.transitionQualifiers ?? []).join(',')}]`.padEnd(52),
      what,
      ` ${verdict}`,
    );
  }
  for (const p of probes.filter((x) => !x.used)) {
    problems++;
    console.log(`  +${String(p.r.t - t0).padStart(5)}ms  probe ${p.r.data.kind} ${short(p.r.data.url)} has NO onHistoryStateUpdated`);
  }
}
console.log(problems ? `\n${problems} unmatched` : '\nall history-state updates matched');
process.exitCode = problems ? 1 : 0;
