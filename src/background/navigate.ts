// Navigations dude starts on the user's behalf (SPEC §9) and the ways into the history
// from the browser UI (§8.1): open with provenance (G1, G3), open with path (G2),
// semantic back (G4), the "Show where I came from" context menu and the `h` omnibox
// keyword.
//
// Every extension-driven navigation is announced to the log with `nav.intent` first:
// it carries no user gesture, and would otherwise be folded as a client redirect.

import type { Observation } from '@/core/observations';
import { openPanel } from '@/platform';
import type { Service } from './service';

const STEP_TIMEOUT_MS = 10_000;
const MENU_ID = 'dude.whereFrom';

export interface OpenPathProgress {
  type: 'dude.openPath';
  job: string;
  step: number;
  total: number;
  done: boolean;
  cancelled?: boolean;
}

export function installNavigation(service: Service) {
  const jobs = new Map<string, { cancelled: boolean }>();
  let pendingFocus: { tabId: number; t: number } | undefined;

  const log = (o: Observation) => service.enqueue(() => [o]);

  /** Open a recorded page in a new tab, linked to the visit it came from (G1, G3). */
  async function open(url: string, visitId?: string, active = true) {
    const tab = await browser.tabs.create({ url, active });
    const ref = visitId ? await service.visitRef(visitId) : undefined;
    if (tab.id !== undefined && ref) log({ type: 'tab.reopened', t: Date.now(), tabId: tab.id, visitUrl: ref.url, visitFirstAt: ref.firstAt });
    return tab;
  }

  function loaded(tabId: number): Promise<boolean> {
    return new Promise((resolve) => {
      const done = (ok: boolean) => {
        clearTimeout(timer);
        browser.webNavigation.onCompleted.removeListener(onDone);
        browser.tabs.onRemoved.removeListener(onGone);
        resolve(ok);
      };
      const onDone = (d: { tabId: number; frameId: number }) => d.tabId === tabId && d.frameId === 0 && done(true);
      const onGone = (id: number) => id === tabId && done(false);
      const timer = setTimeout(() => done(true), STEP_TIMEOUT_MS); // slow page: carry on anyway
      browser.webNavigation.onCompleted.addListener(onDone);
      browser.tabs.onRemoved.addListener(onGone);
    });
  }

  /**
   * Walk a new tab through the visit's ancestors so its real Back button works (G2).
   * GET pages only; progress is broadcast, and the job can be cancelled.
   */
  async function openPath(visitId: string): Promise<{ job: string; total: number }> {
    const urls = await service.pathTo(visitId);
    const job = crypto.randomUUID();
    const state = { cancelled: false };
    jobs.set(job, state);
    const progress = (step: number, done: boolean) =>
      browser.runtime.sendMessage({ type: 'dude.openPath', job, step, total: urls.length, done, cancelled: state.cancelled } satisfies OpenPathProgress).catch(() => undefined);

    (async () => {
      if (!urls.length) return;
      const tab = await open(urls[0], visitId);
      progress(1, urls.length === 1);
      for (let i = 1; i < urls.length && !state.cancelled; i++) {
        if (!(await loaded(tab.id!)) || state.cancelled) break;
        log({ type: 'nav.intent', t: Date.now(), tabId: tab.id!, url: urls[i], reason: 'open-path' });
        await browser.tabs.update(tab.id!, { url: urls[i] });
        progress(i + 1, i === urls.length - 1);
      }
      if (state.cancelled) progress(0, true);
      jobs.delete(job);
    })().catch((e) => console.warn('dude: open with path failed', e));
    return { job, total: urls.length };
  }

  /** Go to the graph parent of the tab's current page, whatever the native Back would do (G4). */
  async function semanticBack(tabId: number): Promise<boolean> {
    const parent = await service.parentOf(tabId);
    if (!parent) return false;
    log({ type: 'nav.intent', t: Date.now(), tabId, url: parent.url, reason: 'semantic-back' });
    await browser.tabs.update(tabId, { url: parent.url });
    return true;
  }

  browser.commands?.onCommand.addListener(async (command) => {
    if (command !== 'semantic-back') return;
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id !== undefined) semanticBack(tab.id);
  });

  // Context menu → sidebar with the parent page highlighted (F3).
  const menus = (browser as unknown as { menus?: typeof browser.contextMenus }).menus ?? browser.contextMenus;
  menus.removeAll().then(() => menus.create({ id: MENU_ID, title: 'Show where I came from', contexts: ['page'] }));
  menus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || tab?.id === undefined) return;
    openPanel(tab.windowId).catch(() => undefined); // first, while the click still counts as a gesture
    pendingFocus = { tabId: tab.id, t: Date.now() };
    browser.runtime.sendMessage({ type: 'dude.focusParent', tabId: tab.id }).catch(() => undefined);
  });

  // Omnibox: `h <words>` (F3).
  const firefox = import.meta.env.BROWSER === 'firefox';
  const xml = (s: string) => (firefox ? s : s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  browser.omnibox.setDefaultSuggestion({ description: 'Search dude sessions for “%s”' });
  browser.omnibox.onInputChanged.addListener(async (text, suggest) => {
    const hits = await service.quickSearch(text, 6);
    suggest(hits.map((h) => ({ content: h.url, description: xml(`${h.title ?? h.url} — ${h.url}`) })));
  });
  browser.omnibox.onInputEntered.addListener((text, disposition) => {
    const url = /^(https?|file):/.test(text) ? text : browser.runtime.getURL(`/sessions.html?q=${encodeURIComponent(text)}`);
    if (disposition === 'currentTab') browser.tabs.update({ url });
    else browser.tabs.create({ url, active: disposition === 'newForegroundTab' });
  });

  return {
    open,
    openPath,
    cancel: (job: string) => {
      const j = jobs.get(job);
      if (j) j.cancelled = true;
      return !!j;
    },
    semanticBack,
    /** The sidebar asks once on load whether it was opened to show a parent. */
    takePendingFocus: (tabId?: number) => {
      const p = pendingFocus;
      if (!p || Date.now() - p.t > 10_000 || (tabId !== undefined && p.tabId !== tabId)) return undefined;
      pendingFocus = undefined;
      return p.tabId;
    },
  };
}
