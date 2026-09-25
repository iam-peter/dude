// Feed S1 fixtures (fixtures/s1/<browser>/<scenario>.json) to the projector.
// The conversion is production's fromBrowserEvent; only the S1-specific records
// (tabValue probes, wake snapshots) are mapped here.
import fs from 'node:fs';
import path from 'node:path';
import { fromBrowserEvent, type Observation } from '@/core/observations';
import { apply } from '@/core/projector';
import { createState, type State } from '@/core/model';

const ROOT = path.resolve(__dirname, '../fixtures/s1');

interface RawRecord {
  t: number;
  src: string;
  data: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export function fixtureExists(browser: string, scenario: string): boolean {
  return fs.existsSync(path.join(ROOT, browser, `${scenario}.json`));
}

export function observationsOf(browser: string, scenario: string): Observation[] {
  const f = JSON.parse(fs.readFileSync(path.join(ROOT, browser, `${scenario}.json`), 'utf8'));
  return f.records.flatMap((r: RawRecord): Observation[] => {
    if (r.src === 'tabValue') {
      return r.data.value ? [{ type: 'tab.identity', t: r.t, tabId: r.data.tabId, value: r.data.value }] : [];
    }
    if (r.src === 'snapshot') {
      if (r.data.reason !== 'wake') return [];
      const tabs = r.data.tabs.map((x: any) => ({ tabId: x.tabId, windowId: x.windowId, index: x.index, url: x.url, title: x.title, tabValue: x.tabValue?.value })); // eslint-disable-line @typescript-eslint/no-explicit-any
      return [{ type: 'recorder.wake', t: r.t, tabs }];
    }
    return fromBrowserEvent(r.src, r.data, r.t);
  });
}

export function project(browser: string, scenario: string): State {
  const st = createState();
  for (const o of observationsOf(browser, scenario)) apply(st, o);
  return st;
}
