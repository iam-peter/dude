// Screenshots and page text (SPEC §7, D1–D6, S2).
//
// When: after a page finished loading plus a settle delay, after SPA navigations, and when
// a tab becomes active while its visit has no (or only a stale) screenshot. Firefox also
// captures background tabs with captureTab (S2 #1); Chromium only the visible tab, spaced
// ≥ 550 ms apart with one retry (S2 #3). Sensitive pages and pages with a visible password
// field are never captured. Near-identical captures are skipped (dHash).

import { isRecordable } from '@/core/url';
import { hamming, SAME_PICTURE, textHash } from '@/core/imagehash';
import { putShot, putText } from '@/storage/db';
import { decode, dHash, gzip, preview, thumbnail } from './imaging';
import type { LiveSettings } from './settings';
import type { Service } from './service';

const SETTLE_MS = 1000; // D1
const SPA_SETTLE_MS = 1500;
const ACTIVATE_MS = 300;
const STALE_MS = 10 * 60_000;
const CHROME_SPACING_MS = 550; // S2 #3
const MAX_TEXT = 50_000; // C7

interface CaptureApis {
  captureVisibleTab(windowId?: number, options?: { format?: string }): Promise<string>;
  captureTab?(tabId: number, options?: { format?: string }): Promise<string>;
}

/** One capture or text attempt and what came of it (diagnostics in the settings page). */
export interface CaptureAttempt {
  t: number;
  url: string;
  what: 'screenshot' | 'text';
  outcome: string;
  ok: boolean;
}
const LOG_SIZE = 40;
const RETRIES = 3;

export function installCapture(service: Service, settings: LiveSettings) {
  const attempts: CaptureAttempt[] = [];
  const note = (url: string | undefined, what: CaptureAttempt['what'], outcome: string, ok = false) => {
    attempts.unshift({ t: Date.now(), url: url ?? '', what, outcome, ok });
    attempts.length = Math.min(attempts.length, LOG_SIZE);
  };
  const tries = new Map<number, number>();
  const api = browser.tabs as unknown as CaptureApis;
  const canCaptureBackground = typeof api.captureTab === 'function';
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let queue: Promise<unknown> = Promise.resolve();
  let lastCaptureAt = 0;

  const schedule = (tabId: number, delay: number, retry = false) => {
    if (!retry) tries.delete(tabId);
    clearTimeout(timers.get(tabId));
    timers.set(
      tabId,
      setTimeout(() => {
        timers.delete(tabId);
        queue = queue.then(() => capture(tabId)).catch((e) => console.warn('dude: capture failed', e));
      }, delay),
    );
  };

  browser.webNavigation.onCompleted.addListener((d) => {
    if (d.frameId === 0 && (d as { documentLifecycle?: string }).documentLifecycle !== 'prerender') schedule(d.tabId, SETTLE_MS);
  });
  // Also when the tab says it finished loading: covers prerendered pages being shown, which
  // fire no navigation events, and any missed onCompleted. Dedupe drops doubles.
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete') schedule(tabId, SETTLE_MS);
  });
  browser.webNavigation.onHistoryStateUpdated.addListener((d) => {
    if (d.frameId === 0 && !(d.transitionQualifiers ?? []).includes('forward_back')) schedule(d.tabId, SPA_SETTLE_MS);
  });
  browser.tabs.onActivated.addListener(async ({ tabId }) => {
    const tab = await browser.tabs.get(tabId).catch(() => undefined);
    if (!tab?.url || !isRecordable(tab.url)) return;
    const page = await service.pageOf(tabId, tab.url);
    if (!page?.lastShot || Date.now() - page.lastShot.at > STALE_MS) schedule(tabId, ACTIVATE_MS);
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    clearTimeout(timers.get(tabId));
    timers.delete(tabId);
    tries.delete(tabId);
  });

  /** Ask the page whether a password field is visible (D6); no answer means no probe there. */
  async function hasVisiblePassword(tabId: number): Promise<boolean> {
    const answer = browser.tabs.sendMessage(tabId, { cmd: 'probe.sensitive' }, { frameId: 0 }).catch(() => undefined) as Promise<{ password?: boolean } | undefined>;
    const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), 400));
    return !!(await Promise.race([answer, timeout]))?.password;
  }

  async function grab(tab: Browser.tabs.Tab): Promise<string> {
    if (canCaptureBackground) return api.captureTab!(tab.id!, { format: 'png' });
    const wait = lastCaptureAt + CHROME_SPACING_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await api.captureVisibleTab(tab.windowId, { format: 'png' });
    } catch (e) {
      if (!String(e).includes('MAX_CAPTURE')) throw e;
      await new Promise((r) => setTimeout(r, CHROME_SPACING_MS + 100));
      return api.captureVisibleTab(tab.windowId, { format: 'png' });
    } finally {
      lastCaptureAt = Date.now();
    }
  }

  async function capture(tabId: number) {
    try {
      await captureNow(tabId);
    } catch (e) {
      note(undefined, 'screenshot', `error: ${String(e).slice(0, 160)}`);
      throw e;
    }
  }

  /** Try again a little later (page still loading, or not yet in the log). */
  function retry(tabId: number, url: string, why: string) {
    const n = (tries.get(tabId) ?? 0) + 1;
    tries.set(tabId, n);
    if (n <= RETRIES) schedule(tabId, 1500 * n, true);
    note(url, 'screenshot', n <= RETRIES ? `${why}, trying again` : `${why}, gave up`);
  }

  async function captureNow(tabId: number) {
    const tab = await browser.tabs.get(tabId).catch(() => undefined);
    if (!tab?.url || tab.incognito || !isRecordable(tab.url)) return;
    if (tab.discarded) return note(tab.url, 'screenshot', 'tab discarded');
    await settings.ready;
    if (settings.isExcluded(tab.url)) return note(tab.url, 'screenshot', 'excluded site');
    if (settings.isPaused(tabId)) return note(tab.url, 'screenshot', 'recording paused');
    if (tab.status !== 'complete') return retry(tabId, tab.url, 'page still loading');
    if (!canCaptureBackground) {
      if (!tab.active) return note(tab.url, 'screenshot', 'background tab (Chrome captures only the visible tab)');
      const win = await browser.windows.get(tab.windowId!).catch(() => undefined);
      if (!win || win.state === 'minimized') return note(tab.url, 'screenshot', 'window minimised');
    }
    if (await hasVisiblePassword(tabId)) return note(tab.url, 'screenshot', 'password field visible');

    const page = await service.pageOf(tabId, tab.url);
    if (!page) return retry(tabId, tab.url, 'page not in the log (yet)');
    const t = Date.now();
    const dataUrl = await grab(tab);
    // The tab may have navigated while we waited for the capture.
    const now = await browser.tabs.get(tabId).catch(() => undefined);
    if (now?.url !== tab.url) return note(tab.url, 'screenshot', 'tab navigated away meanwhile');

    const bitmap = await decode(dataUrl);
    const hash = dHash(bitmap);
    if (page.lastShot && hamming(hash, page.lastShot.hash) <= SAME_PICTURE) return note(tab.url, 'screenshot', 'same picture as before', true);
    const [thumb, big] = await Promise.all([thumbnail(bitmap), preview(bitmap)]);
    const id = crypto.randomUUID();
    await putShot({ id, t, hash, w: bitmap.width, h: bitmap.height, thumb, preview: big });
    bitmap.close();
    service.enqueue(() => [{ type: 'page.capture', t, tabId, url: tab.url!, shotId: id, hash }]);
    note(tab.url, 'screenshot', 'saved', true);
  }

  // Page text from text.content.ts (§7.2).
  browser.runtime.onMessage.addListener((msg: { cmd?: string; url?: string; title?: string; text?: string }, sender) => {
    if (msg?.cmd !== 'page.text') return undefined;
    if (!sender.tab?.id || sender.tab.incognito || sender.frameId) {
      if (!sender.tab?.incognito) note(msg.url, 'text', 'sent from outside a tab (prerendered page?)');
      return undefined;
    }
    const tabId = sender.tab.id;
    const { url, title } = msg;
    const text = (msg.text ?? '').slice(0, MAX_TEXT);
    if (!url || !isRecordable(url) || settings.isExcluded(url) || settings.isPaused(tabId) || text.length < 50) return undefined;
    const t = Date.now();
    queue = queue
      .then(async () => {
        const hash = textHash(text);
        const page = await service.pageOf(tabId, url);
        if (!page) return note(url, 'text', 'page not in the log');
        if (page.textHash === hash) return note(url, 'text', 'same text as before', true);
        const id = crypto.randomUUID();
        await putText({ id, t, url, title, chars: text.length, gz: await gzip(text) });
        service.enqueue(() => [{ type: 'page.text', t, tabId, url, textId: id, hash }]);
        note(url, 'text', `saved (${text.length} characters)`, true);
      })
      .catch((e) => console.warn('dude: text failed', e));
    return undefined;
  });

  return { attempts: () => attempts.slice() };
}
