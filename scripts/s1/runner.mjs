// Browser-independent S1 scenario runner. A driver adapter provides tab-level operations;
// the runner brackets each scenario with start/end markers in the extension's raw log.
import fs from 'node:fs';
import path from 'node:path';
import { SCENARIOS } from '../../src/spike/scenarios.ts';

const SETTLE_MS = Number(process.env.S1_SETTLE_MS ?? 500);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * driver: {
 *   name, send(msg), newTab(), goto(t, url), click(t, sel), clickOpeningTab(t, sel),
 *   middle(t, sel), back(t), forward(t), reload(t), duplicate(t), close(t),
 *   restore(), activate(t)
 * }  — t is the driver's own tab handle.
 */
export async function runScenarios(driver, { only } = {}) {
  const selected = SCENARIOS.filter((s) => s.auto && (!only?.length || only.includes(s.id)));
  const results = [];
  await driver.send({ cmd: 's1.enable', on: true }); // raw recording is opt-in since M1
  await driver.send({ cmd: 'clear' });
  await driver.send({ cmd: 'snapshot' });

  const e2e = e2eMode();
  let e2eFailures = 0;
  for (const s of selected) {
    process.stdout.write(`  ${s.id.padEnd(18)} `);
    const since = Date.now() - 20;
    await driver.send({ cmd: 'marker', kind: 'start', scenario: s.id, note: `auto:${driver.name}` });
    const tabs = [];
    let status = 'ok';
    try {
      let cur = await driver.newTab();
      tabs.push(cur);
      for (const step of s.steps) {
        cur = await exec(driver, step, cur, tabs);
        await sleep(SETTLE_MS);
      }
    } catch (e) {
      status = `error: ${e.message.split('\n')[0]}`;
    }
    await sleep(SETTLE_MS);
    await driver.send({ cmd: 'marker', kind: 'end', scenario: s.id, note: status });
    for (const t of tabs.reverse()) await driver.close(t).catch(() => undefined);
    await sleep(300);
    if (e2e && status === 'ok') {
      const verdict = await checkProjection(driver, s.id, since, e2e);
      if (verdict !== 'ok' && verdict !== 'updated') e2eFailures++;
      status = verdict === 'ok' || verdict === 'updated' ? `ok, projection ${verdict}` : verdict;
    }
    console.log(status);
    results.push({ id: s.id, status });
  }
  if (e2e === 'update') console.log(`\nE2E: expectations written to tests/e2e/${driver.browser}/ — review the diff`);
  else if (e2e) {
    console.log(e2eFailures ? `\nE2E: ${e2eFailures} scenario(s) differ from tests/e2e/${driver.browser}/` : `\nE2E: all projections match tests/e2e/${driver.browser}/`);
    if (e2eFailures) process.exitCode = 1;
  }
  await driver.send({ cmd: 'snapshot' });
  if (process.argv.includes('--projection')) {
    // M1: what the live recorder + projector made of the same run.
    await sleep(500);
    const d = await driver.send({ cmd: 'dude.debug' });
    console.log(`\n--- live projection (log ${d.logSize}, ${d.sessions} sessions, ${d.visits} visits)\n${d.text}\n---`);
  }
  return { results, records: await driver.send({ cmd: 'dump' }) };
}

async function exec(d, step, cur, tabs) {
  switch (step.op) {
    case 'goto':
      await d.goto(cur, step.url);
      return cur;
    case 'click':
      if (!step.newTab) {
        await d.click(cur, step.sel);
        return cur;
      }
      return track(tabs, await d.clickOpeningTab(cur, step.sel));
    case 'middle':
      track(tabs, await d.middle(cur, step.sel));
      return cur; // background tab: the current tab stays current
    case 'back':
      await d.back(cur);
      return cur;
    case 'forward':
      await d.forward(cur);
      return cur;
    case 'reload':
      await d.reload(cur);
      return cur;
    case 'wait':
      await sleep(step.ms);
      return cur;
    case 'duplicate':
      return track(tabs, await d.duplicate(cur));
    case 'close': {
      await d.close(cur);
      tabs.splice(tabs.indexOf(cur), 1);
      return tabs.at(-1);
    }
    case 'restore':
      return track(tabs, await d.restore());
    case 'switch': {
      const next = step.to === 'newest' ? tabs.at(-1) : tabs.at(tabs.indexOf(cur) - 1);
      await d.activate(next);
      return next;
    }
    default:
      throw new Error(`unknown op ${step.op}`);
  }
}

function track(tabs, t) {
  tabs.push(t);
  return t;
}

function e2eMode() {
  if (process.argv.includes('--e2e-update')) return 'update';
  if (process.argv.includes('--e2e')) return 'check';
  return undefined;
}

/** Compare the live projection of one scenario with tests/e2e/<browser>/<scenario>.txt. */
async function checkProjection(driver, scenario, since, mode) {
  const actual = (await driver.send({ cmd: 'dude.describeSince', since })).trim();
  const file = path.resolve('tests/e2e', driver.browser, `${scenario}.txt`);
  if (mode === 'update') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, actual + '\n');
    return 'updated';
  }
  if (!fs.existsSync(file)) return `NO EXPECTATION (run with --e2e-update)\n${indent(actual)}`;
  const expected = fs.readFileSync(file, 'utf8').trim();
  if (expected === actual) return 'ok';
  return `PROJECTION DIFFERS\n    expected:\n${indent(expected, 6)}\n    actual:\n${indent(actual, 6)}`;
}

const indent = (text, n = 4) => text.split('\n').map((l) => ' '.repeat(n) + l).join('\n');

export function writeRaw(browserName, driverName, records, results) {
  const dir = path.resolve('fixtures/s1/raw');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '').replace(/-/g, '');
  const file = path.join(dir, `${browserName}-auto-${stamp}.json`);
  const ua = records.find((r) => r.src === 'wake')?.data?.ua;
  fs.writeFileSync(
    file,
    JSON.stringify({ exportedAt: new Date().toISOString(), browser: browserName, driver: driverName, ua, results, records }, null, 1),
  );
  return file;
}

export function parseOnly() {
  const i = process.argv.indexOf('--only');
  return i > 0 ? process.argv[i + 1].split(',') : undefined;
}
