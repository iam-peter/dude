// S1 spike: report what the user did on the page, so the recorded navigation that follows
// can be attributed (link text for C1, "was there a click?" for back/forward detection §6.3).
import { SITE as S1_CONTROL_ORIGIN } from '@/spike/scenarios';
import { HISTORY_EVENT } from '@/spike/history-event';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  main() {
    const send = (kind: 'click' | 'submit' | 'history', data: Record<string, unknown>) =>
      browser.runtime.sendMessage({ cmd: 'probe', kind, data }).catch(() => undefined);

    // Any trusted gesture without a link still counts as "the user did something", so a
    // navigation right after it isn't mistaken for a client redirect (SPEC §6.1).
    const gesture = (e: Event) => {
      if (!e.isTrusted) return;
      send('click', { type: e.type, href: '', text: '', button: (e as MouseEvent).button ?? 0, trusted: true, pageUrl: location.href, t: Date.now() });
    };
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Enter' || e.key === ' ') gesture(e);
      },
      true,
    );

    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a) return gesture(e);
      send('click', {
        type: e.type,
        href: a.href,
        text: a.innerText.trim().slice(0, 200),
        target: a.target,
        rel: a.rel,
        button: e.button,
        ctrl: e.ctrlKey,
        meta: e.metaKey,
        shift: e.shiftKey,
        alt: e.altKey,
        trusted: e.isTrusted,
        pageUrl: location.href,
        t: Date.now(),
      });
    };
    window.addEventListener('click', onClick, true);
    window.addEventListener('auxclick', onClick, true);

    // Automation relay: WebDriver can't open moz-extension:// pages, so the Firefox driver
    // talks to the background through this one test-site page instead.
    if (location.origin === S1_CONTROL_ORIGIN && location.pathname === '/s1-control') {
      window.addEventListener('message', (e) => {
        if (e.source !== window || !e.data?.dudeS1) return;
        const reply = (res: unknown) => window.postMessage({ dudeS1Reply: e.data.id, res }, location.origin);
        browser.runtime.sendMessage(e.data.msg).then(reply, (err) => reply({ error: String(err) }));
      });
    }

    // Forwarded from the main-world wrapper around pushState/replaceState (S1b).
    window.addEventListener(HISTORY_EVENT, (e) => {
      const detail = (e as CustomEvent<unknown>).detail;
      if (typeof detail !== 'string') return;
      try {
        send('history', JSON.parse(detail));
      } catch {
        /* not ours */
      }
    });

    // Capture guard (D6): never screenshot a page while a password field is visible.
    browser.runtime.onMessage.addListener((msg: { cmd?: string }, _sender, sendResponse) => {
      if (msg?.cmd !== 'probe.sensitive') return undefined;
      const visible = [...document.querySelectorAll<HTMLInputElement>('input[type=password]')].some((i) => i.getClientRects().length > 0 && getComputedStyle(i).visibility !== 'hidden');
      sendResponse({ password: visible });
      return undefined;
    });

    window.addEventListener(
      'submit',
      (e) => {
        const f = e.target as HTMLFormElement;
        send('submit', { action: f.action, method: f.method, pageUrl: location.href, t: Date.now() });
      },
      true,
    );
  },
});
