// Screenshots and page text (SPEC §7, D1–D6, S2).
//
// When: after a page finished loading plus a settle delay, after SPA navigations, and when
// a tab becomes active while its visit has no (or only a stale) screenshot. Firefox also
// captures background tabs with captureTab (S2 #1); Chromium only the visible tab, spaced
// ≥ 550 ms apart with one retry (S2 #3). Sensitive pages and pages with a visible password
// field are never captured. Near-identical captures are skipped (dHash).

import { isRecordable } from '@/core/url';
import { isSensitive } from '@/core/sensitive';
import { hamming, SAME_PICTURE, textHash } from '@/core/imagehash';
import { putShot, putText } from '@/storage/db';
import { decode, dHash, gzip, preview, thumbnail } from './imaging';
import type { Service } from './service';

const SETTLE_MS = 1000; // D1
const SPA_SETTLE_MS = 1500;
const ACTIVATE_MS = 300;
const STALE_MS = 10 * 60_000;
const CHROME_SPACING_MS = 550; // S2 #3
const MAX_TEXT = 50_000; // C7
export const DENY_KEY = 'dude.denyHosts'; // user list (D6); edited in settings (M6)

interface CaptureApis {
  captureVisibleTab(windowId?: number, options?: { format?: string }): Promise<string>;
  captureTab?(tabId: number, options?: { format?: string }): Promise<string>;
}

export function installCapture(service: Service) {
  const api = browser.tabs as unknown as CaptureApis;
  const canCaptureBackground = typeof api.captureTab === 'function';
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let queue: Promise<unknown> = Promise.resolve();
  let lastCaptureAt = 0;

  let denyHosts: string[] = [];
  const loadDeny = () =>
    browser.storage.local.get(DENY_KEY).then((r) => {
      denyHosts = Array.isArray(r[DENY_KEY]) ? (r[DENY_KEY] as string[]) : [];
    });
  loadDeny();
  browser.storage.onChanged.addListener((changes) => {
    if (DENY_KEY in changes) loadDeny();
  });

  const schedule = (tabId: number, delay: number) => {
    clearTimeout(timers.get(tabId));
    timers.set(
      tabId,
      setTimeout(() => {
        timers.delete(tabId);
        queue = queue.then(() => capture(tabId)).catch((e) => console.warn('dude: capture failed', e));
      }, delay),
    );
  };

  browser.webNavigation.onCompleted.addListener((d) => d.frameId === 0 && schedule(d.tabId, SETTLE_MS));
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
    const tab = await browser.tabs.get(tabId).catch(() => undefined);
    if (!tab?.url || tab.incognito || tab.discarded || tab.status !== 'complete' || !isRecordable(tab.url)) return;
    if (isSensitive(tab.url, denyHosts)) return;
    if (!canCaptureBackground) {
      if (!tab.active) return; // Chromium: background tabs get the favicon placeholder (D2)
      const win = await browser.windows.get(tab.windowId!).catch(() => undefined);
      if (!win || win.state === 'minimized') return;
    }
    if (await hasVisiblePassword(tabId)) return;

    const page = await service.pageOf(tabId, tab.url);
    if (!page) return; // not (yet) a recorded visit
    const t = Date.now();
    const dataUrl = await grab(tab);
    // The tab may have navigated while we waited for the capture.
    const now = await browser.tabs.get(tabId).catch(() => undefined);
    if (now?.url !== tab.url) return;

    const bitmap = await decode(dataUrl);
    const hash = dHash(bitmap);
    if (page.lastShot && hamming(hash, page.lastShot.hash) <= SAME_PICTURE) return;
    const [thumb, big] = await Promise.all([thumbnail(bitmap), preview(bitmap)]);
    const id = crypto.randomUUID();
    await putShot({ id, t, hash, w: bitmap.width, h: bitmap.height, thumb, preview: big });
    bitmap.close();
    service.enqueue(() => [{ type: 'page.capture', t, tabId, url: tab.url!, shotId: id, hash }]);
  }

  // Page text from text.content.ts (§7.2).
  browser.runtime.onMessage.addListener((msg: { cmd?: string; url?: string; title?: string; text?: string }, sender) => {
    if (msg?.cmd !== 'page.text' || !sender.tab?.id || sender.tab.incognito || sender.frameId) return undefined;
    const tabId = sender.tab.id;
    const { url, title } = msg;
    const text = (msg.text ?? '').slice(0, MAX_TEXT);
    if (!url || !isRecordable(url) || isSensitive(url, denyHosts) || text.length < 50) return undefined;
    const t = Date.now();
    queue = queue
      .then(async () => {
        const hash = textHash(text);
        const page = await service.pageOf(tabId, url);
        if (!page || page.textHash === hash) return;
        const id = crypto.randomUUID();
        await putText({ id, t, url, title, chars: text.length, gz: await gzip(text) });
        service.enqueue(() => [{ type: 'page.text', t, tabId, url, textId: id, hash }]);
      })
      .catch((e) => console.warn('dude: text failed', e));
    return undefined;
  });
}
