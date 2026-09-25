// S1 spike: record every navigation/tab/window/session event verbatim (docs/SPEC.md §4, §14).
// Nothing is interpreted here — the point is to see what each browser actually reports.
// Off by default since M1: enable it from the S1 page (or the automation drivers do),
// because it logs everything the browser does, unfiltered.
import { append, all, clear, count } from './raw-log';

const WEB_NAVIGATION_EVENTS = [
  'onBeforeNavigate',
  'onCommitted',
  'onDOMContentLoaded',
  'onCompleted',
  'onErrorOccurred',
  'onCreatedNavigationTarget',
  'onHistoryStateUpdated',
  'onReferenceFragmentUpdated',
  'onTabReplaced',
] as const;

const TAB_VALUE_KEY = 'dudeTabId';

const ENABLED_KEY = 's1.raw';

export function installS1Recorder() {
  const wake = crypto.randomUUID().slice(0, 8);
  let i = 0;
  const target = import.meta.env.BROWSER;
  let enabled = false;
  const ready = browser.storage.local.get(ENABLED_KEY).then((r) => {
    enabled = r[ENABLED_KEY] === true;
  });

  // structuredClone drops nothing we need and detaches the record from live API objects.
  // Records wait for the flag, and keep their firing order.
  const rec = (src: string, data: unknown) => {
    const r = { t: Date.now(), wake, i: i++, browser: target, src, data: structuredClone(data) };
    return ready.then(() =>
      enabled ? append(r).catch((e) => console.error('dude/s1: append failed', src, e)) : undefined,
    );
  };

  // Listeners must be registered synchronously at startup (MV3 wakes the background per event).
  const wn = browser.webNavigation as unknown as Record<string, { addListener(fn: (d: unknown) => void): void }>;
  for (const name of WEB_NAVIGATION_EVENTS) {
    wn[name]?.addListener((d) => rec(`webNavigation.${name}`, d));
  }

  browser.tabs.onCreated.addListener((tab) => {
    rec('tabs.onCreated', tab);
    probeTabValue(tab.id, 'created');
  });
  // When does Firefox copy the tab value onto a restored/duplicated tab? Read it at each
  // stage; only assign a fresh one once the first load completed without one.
  browser.webNavigation.onCommitted.addListener((d) => d.frameId === 0 && probeTabValue(d.tabId, 'committed'));
  browser.webNavigation.onCompleted.addListener((d) => d.frameId === 0 && probeTabValue(d.tabId, 'completed', true));
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => rec('tabs.onUpdated', { tabId, changeInfo, tab }));
  browser.tabs.onActivated.addListener((info) => rec('tabs.onActivated', info));
  browser.tabs.onRemoved.addListener((tabId, info) => rec('tabs.onRemoved', { tabId, ...info }));
  browser.tabs.onAttached.addListener((tabId, info) => rec('tabs.onAttached', { tabId, ...info }));
  browser.tabs.onDetached.addListener((tabId, info) => rec('tabs.onDetached', { tabId, ...info }));
  browser.tabs.onMoved.addListener((tabId, info) => rec('tabs.onMoved', { tabId, ...info }));
  browser.tabs.onReplaced.addListener((addedTabId, removedTabId) =>
    rec('tabs.onReplaced', { addedTabId, removedTabId }),
  );

  browser.windows.onCreated.addListener((w) => rec('windows.onCreated', w));
  browser.windows.onRemoved.addListener((windowId) => rec('windows.onRemoved', { windowId }));
  browser.windows.onFocusChanged.addListener((windowId) => rec('windows.onFocusChanged', { windowId }));

  browser.sessions.onChanged.addListener(() => rec('sessions.onChanged', {}));
  browser.runtime.onStartup.addListener(() => rec('runtime.onStartup', {}));
  browser.runtime.onInstalled.addListener((d) => rec('runtime.onInstalled', d));

  browser.runtime.onMessage.addListener((msg: Msg, sender, sendResponse) => {
    if (!S1_COMMANDS.has(msg?.cmd)) return undefined; // not ours (M1 messages)
    handle(msg, sender).then(sendResponse, (e) => sendResponse({ error: String(e) }));
    return true;
  });

  async function handle(msg: Msg, sender: Browser.runtime.MessageSender): Promise<unknown> {
    const from = { tabId: sender.tab?.id, frameId: sender.frameId, url: sender.url };
    switch (msg.cmd) {
      case 's1.enable':
        enabled = msg.on;
        await browser.storage.local.set({ [ENABLED_KEY]: msg.on });
        if (msg.on) await snapshot('enabled');
        return enabled;
      case 's1.enabled':
        await ready;
        return enabled;
      case 'probe':
        return rec(`content.${msg.kind}`, { ...msg.data, from });
      case 'marker':
        return rec('marker', { kind: msg.kind, scenario: msg.scenario, note: msg.note, from });
      case 'count':
        return count();
      case 'markers':
        return (await all()).filter((r) => r.src === 'marker').map((r) => ({ t: r.t, ...(r.data as object) }));
      case 'dump':
        return all();
      case 'clear':
        return clear();
      case 'snapshot':
        return snapshot('request');
      case 'tabs':
        return browser.tabs.query({});
      case 'duplicate':
        return browser.tabs.duplicate(msg.tabId);
      case 'restoreLast':
        return browser.sessions.restore();
      case 'activate':
        return browser.tabs.update(msg.tabId, { active: true });
    }
  }

  // Firefox: give every tab a stable id that survives restart and closed-tab restore (B11, B12).
  // Chrome has no tab values; the snapshot still records what reconciliation would have to match on.
  const sessions = browser.sessions as unknown as {
    getTabValue?(id: number, key: string): Promise<unknown>;
    setTabValue?(id: number, key: string, v: unknown): Promise<void>;
  };

  async function tagTab(tabId: number | undefined, assign = true) {
    if (tabId === undefined || !sessions.setTabValue || !sessions.getTabValue) return undefined;
    const existing = await sessions.getTabValue(tabId, TAB_VALUE_KEY);
    if (existing || !assign) return { value: existing, fresh: false };
    const value = crypto.randomUUID();
    await sessions.setTabValue(tabId, TAB_VALUE_KEY, value);
    return { value, fresh: true };
  }

  function probeTabValue(tabId: number | undefined, phase: string, assign = false) {
    if (!sessions.getTabValue) return;
    tagTab(tabId, assign).then(
      (v) => rec('tabValue', { tabId, phase, ...v }),
      (e) => rec('tabValue', { tabId, phase, error: String(e) }),
    );
  }

  async function snapshot(reason: string) {
    const tabs = await browser.tabs.query({});
    const tagged = await Promise.all(
      tabs.map(async (t) => ({
        tabId: t.id,
        windowId: t.windowId,
        index: t.index,
        url: t.url,
        title: t.title,
        openerTabId: t.openerTabId,
        tabValue: await tagTab(t.id).catch((e) => ({ error: String(e) })),
      })),
    );
    const perms = await browser.permissions.getAll();
    return rec('snapshot', { reason, tabs: tagged, permissions: perms });
  }

  rec('wake', { ua: navigator.userAgent });
  ready.then(() => {
    if (enabled) snapshot('wake');
  });
}

const S1_COMMANDS = new Set(['s1.enable', 's1.enabled', 'probe', 'marker', 'count', 'markers', 'dump', 'clear', 'snapshot', 'tabs', 'duplicate', 'restoreLast', 'activate']);

type Msg =
  | { cmd: 's1.enable'; on: boolean }
  | { cmd: 's1.enabled' }
  | { cmd: 'probe'; kind: 'click' | 'submit' | 'history'; data: Record<string, unknown> }
  | { cmd: 'marker'; kind: 'start' | 'end'; scenario: string; note?: string }
  | { cmd: 'count' | 'markers' | 'dump' | 'clear' | 'snapshot' | 'tabs' | 'restoreLast' }
  | { cmd: 'duplicate' | 'activate'; tabId: number };
