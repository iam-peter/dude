// S1b spike: webNavigation.onHistoryStateUpdated can't tell pushState from replaceState
// (S1-FINDINGS #7), so wrap both in the page's own world and report every call.
// Runs at document_start, before page scripts can grab the originals. There are no
// extension APIs here; the report goes to the isolated probe (probe.content.ts) as a
// DOM event with a string payload, which both browsers let cross the world boundary.
//
// Page scripts can dispatch the same event, so the real recorder must treat these
// reports as hints and cross-check them against onHistoryStateUpdated.
import { HISTORY_EVENT } from '@/spike/history-event';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    const proto = History.prototype;
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = proto[method];
      Object.defineProperty(proto, method, {
        configurable: true,
        writable: true,
        value: function (this: History, ...args: Parameters<History['pushState']>) {
          const from = location.href;
          const lengthBefore = this.length;
          const result = original.apply(this, args);
          window.dispatchEvent(
            new CustomEvent(HISTORY_EVENT, {
              detail: JSON.stringify({
                kind: method === 'pushState' ? 'push' : 'replace',
                from,
                url: location.href,
                lengthBefore,
                lengthAfter: this.length,
                t: Date.now(),
              }),
            }),
          );
          return result;
        },
      });
    }
  },
});
