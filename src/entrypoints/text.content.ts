// Readable page text for full-text search (C7, SPEC §7.2): Readability's article text, or
// the body text when that finds no article. Sent once per URL, after the page settled;
// SPA navigations (reported by the history probe) trigger a new extraction.
import { Readability } from '@mozilla/readability';
import { HISTORY_EVENT } from '@/spike/history-event';

const SETTLE_MS = 1500;
const SPA_SETTLE_MS = 2000;
const MAX_CHARS = 50_000;

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*', 'file:///*'],
  runAt: 'document_idle',
  main() {
    let sentFor = '';
    let timer: ReturnType<typeof setTimeout> | undefined;

    const passwordVisible = () =>
      [...document.querySelectorAll<HTMLInputElement>('input[type=password]')].some((i) => i.getClientRects().length > 0);

    function extract() {
      const url = location.href.split('#')[0];
      if (url === sentFor || passwordVisible()) return;
      let text = '';
      try {
        // Readability modifies the document it gets, so give it a copy.
        text = new Readability(document.cloneNode(true) as Document).parse()?.textContent ?? '';
      } catch {
        /* not an article */
      }
      if (text.trim().length < 200) text = document.body?.innerText ?? '';
      text = text.replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, MAX_CHARS);
      if (text.length < 50) return;
      sentFor = url;
      browser.runtime.sendMessage({ cmd: 'page.text', url: location.href, title: document.title, text }).catch(() => undefined);
    }

    const later = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(extract, ms);
    };
    later(SETTLE_MS);
    window.addEventListener(HISTORY_EVENT, () => later(SPA_SETTLE_MS));
    window.addEventListener('popstate', () => later(SPA_SETTLE_MS));
  },
});
