// Browser events → observations (SPEC §11 "recorder"). Listeners are registered
// synchronously at startup, as MV3 requires. The timestamp is taken when the event fires,
// and enrichment that needs async browser calls runs inside the service's ordered queue.
//
// Firefox tab identity (B11–B13, S1 #15–17, #25, #28): every tab carries a random value in
// sessions tab storage. Firefox copies it onto restored *and* duplicated tabs; a copy that
// another open tab still holds is a duplicate, so that tab gets a fresh value and the
// observation says which value it was copied from.

import { fromBrowserEvent, type Observation, type WakeTab } from '@/core/observations';
import { anonymize } from '@/core/privacy';
import { tabValues } from '@/platform';
import type { LiveSettings } from './settings';
import type { Service } from './service';

/** What a pause stops (C5): navigation and page content. Tab structure keeps being logged. */
const PAUSABLE = new Set<Observation['type']>([
  'nav.committed',
  'nav.history',
  'nav.fragment',
  'nav.completed',
  'nav.intent',
  'page.click',
  'page.submit',
  'page.history',
  'page.capture',
  'page.text',
  'tab.updated',
  'tab.reopened',
]);

/** Everything the recorder logs passes through here: pause first, then exclusions (D6). */
export function screen(obs: Observation[], settings: LiveSettings): Observation[] {
  return obs.flatMap((o) => {
    const tabId = 'tabId' in o ? o.tabId : undefined;
    if (PAUSABLE.has(o.type) && settings.isPaused(tabId)) return [];
    const a = anonymize(o, settings.isExcluded);
    return a ? [a] : [];
  });
}

export function installRecorder(service: Service, settings: LiveSettings) {
  // Every producer waits for the settings, then screens what it produced.
  const enqueue = (producer: () => Observation[] | Promise<Observation[]>) =>
    service.enqueue(async () => {
      await settings.ready;
      return screen(await producer(), settings);
    });
  const values = tabValues(); // undefined in Chromium: identity comes from URL heuristics there

  const valueByTab = new Map<number, string>();
  const identified = new Set<number>();
  const privateTabs = new Set<number>(); // C6: never recorded

  const now = () => Date.now();
  const read = async (tabId: number) => values?.get(tabId);
  const assign = async (tabId: number) => {
    const v = crypto.randomUUID();
    await values?.set(tabId, v);
    return v;
  };
  const heldByOther = (value: string, tabId: number) => [...valueByTab].some(([t, v]) => v === value && t !== tabId);

  /** Resolve a tab's identity: keep its value, or replace a copied one, or assign a first one. */
  async function resolve(tabId: number): Promise<{ value: string; copiedFrom?: string } | undefined> {
    if (!values) return undefined;
    const v = await read(tabId);
    let result: { value: string; copiedFrom?: string };
    if (v && heldByOther(v, tabId)) result = { value: await assign(tabId), copiedFrom: v };
    else if (v) result = { value: v };
    else result = { value: await assign(tabId) };
    valueByTab.set(tabId, result.value);
    identified.add(tabId);
    return result;
  }

  const record = (src: string, data: unknown, tabId?: number) => {
    if (tabId !== undefined && privateTabs.has(tabId)) return;
    const t = now();
    enqueue(() => fromBrowserEvent(src, data, t));
  };

  // Snapshot on every background start: adopts tabs that predate the recorder and lets the
  // projector rebind restored tabs after a browser restart (B12, S1 #28). Also after
  // "delete everything", so the open tabs are recorded again from a clean start.
  const snapshot = () => enqueue(async (): Promise<Observation[]> => {
    const t = now();
    const tabs = await browser.tabs.query({});
    const wake: WakeTab[] = [];
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      if (tab.incognito) {
        privateTabs.add(tab.id);
        continue;
      }
      const id = await resolve(tab.id);
      wake.push({ tabId: tab.id, windowId: tab.windowId ?? -1, index: tab.index, url: tab.url, title: tab.title, tabValue: id?.value });
    }
    return [{ type: 'recorder.wake', t, tabs: wake }];
  });
  snapshot();

  browser.tabs.onCreated.addListener((tab) => {
    if (tab.id === undefined) return;
    if (tab.incognito) {
      privateTabs.add(tab.id);
      return;
    }
    const t = now();
    const tabId = tab.id;
    enqueue(async () => {
      const obs = fromBrowserEvent('tabs.onCreated', tab, t) as Extract<Observation, { type: 'tab.created' }>[];
      // A restored tab has its value right away (S1 #17, #25); a duplicate only from its first commit.
      const v = values ? await read(tabId) : undefined;
      if (v) {
        const id = await resolve(tabId);
        for (const o of obs) Object.assign(o, { tabValue: id?.value, copiedFrom: id?.copiedFrom });
      }
      return obs;
    });
  });

  // Chrome prerendering: a page can load in the background (speculation rules, address-bar
  // predictions) and is only shown when the user clicks. Its navigation events carry
  // documentLifecycle "prerender", and activation fires none. Hold them until the tab
  // actually switches to that URL.
  const prerendered = new Map<number, { commit: Browser.webNavigation.WebNavigationTransitionCallbackDetails; completed?: unknown; t: number }>();
  const isPrerender = (d: unknown) => (d as { documentLifecycle?: string }).documentLifecycle === 'prerender';
  const bare = (u: string) => u.split('#')[0];

  browser.webNavigation.onCommitted.addListener((d) => {
    if (d.frameId !== 0 || privateTabs.has(d.tabId)) return;
    if (isPrerender(d)) {
      prerendered.set(d.tabId, { commit: d, t: now() });
      return;
    }
    const t = now();
    enqueue(async () => {
      const obs: Observation[] = [];
      if (values && !identified.has(d.tabId)) {
        const id = await resolve(d.tabId);
        if (id) obs.push({ type: 'tab.identity', t, tabId: d.tabId, value: id.value, copiedFrom: id.copiedFrom });
      }
      obs.push(...fromBrowserEvent('webNavigation.onCommitted', d, t));
      return obs;
    });
  });

  browser.webNavigation.onHistoryStateUpdated.addListener((d) => !isPrerender(d) && record('webNavigation.onHistoryStateUpdated', d, d.tabId));
  browser.webNavigation.onReferenceFragmentUpdated.addListener((d) => !isPrerender(d) && record('webNavigation.onReferenceFragmentUpdated', d, d.tabId));
  browser.webNavigation.onCompleted.addListener((d) => {
    if (d.frameId === 0 && isPrerender(d)) {
      const p = prerendered.get(d.tabId);
      if (p && bare(p.commit.url) === bare(d.url)) p.completed = d;
      return;
    }
    record('webNavigation.onCompleted', d, d.tabId);
  });

  // Activation of a prerendered page: the tab's URL changes to it without a new commit.
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    const p = prerendered.get(tabId);
    if (!p || !changeInfo.url) return;
    prerendered.delete(tabId);
    if (bare(changeInfo.url) !== bare(p.commit.url) || privateTabs.has(tabId)) return;
    const t = now();
    enqueue(async () => {
      const obs: Observation[] = [];
      if (values && !identified.has(tabId)) {
        const id = await resolve(tabId);
        if (id) obs.push({ type: 'tab.identity', t, tabId, value: id.value, copiedFrom: id.copiedFrom });
      }
      obs.push(...fromBrowserEvent('webNavigation.onCommitted', { ...p.commit, documentLifecycle: 'active' }, t));
      if (p.completed) obs.push(...fromBrowserEvent('webNavigation.onCompleted', p.completed, t));
      return obs;
    });
  });
  browser.webNavigation.onCreatedNavigationTarget.addListener((d) => record('webNavigation.onCreatedNavigationTarget', d, d.tabId));

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => record('tabs.onUpdated', { tabId, changeInfo, tab: { url: tab.url } }, tabId));
  browser.tabs.onActivated.addListener((info) => record('tabs.onActivated', info, info.tabId));
  browser.tabs.onAttached.addListener((tabId, info) => record('tabs.onAttached', { tabId, ...info }, tabId));
  browser.tabs.onRemoved.addListener((tabId, info) => {
    if (privateTabs.delete(tabId)) return;
    record('tabs.onRemoved', { tabId, ...info });
    valueByTab.delete(tabId);
    identified.delete(tabId);
  });
  browser.windows.onFocusChanged.addListener((windowId) => record('windows.onFocusChanged', { windowId }));

  // Page probes (probe.content.ts, history-probe.content.ts): clicks, submits, history calls.
  browser.runtime.onMessage.addListener((msg: { cmd?: string; kind?: string; data?: Record<string, unknown> }, sender) => {
    if (msg?.cmd !== 'probe' || !sender.tab?.id || sender.tab.incognito) return undefined;
    record(`content.${msg.kind}`, { ...msg.data, from: { tabId: sender.tab.id, frameId: sender.frameId } }, sender.tab.id);
    return undefined;
  });

  return {
    /** Forget which tabs were identified and take a fresh startup snapshot. */
    restart() {
      identified.clear();
      valueByTab.clear();
      snapshot();
    },
  };
}
