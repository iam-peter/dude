// Exclusions before anything reaches the log (D6, SPEC §6.4): a visit to a deny-listed
// page becomes an anonymous placeholder — its place in the tree and its time, but no URL,
// title, link text, screenshot or page text.

import type { Observation } from './observations';

/** The URL every excluded page is recorded as. */
export const EXCLUDED_URL = 'about:dude-excluded';

export const isExcludedUrl = (url: string | undefined) => url === EXCLUDED_URL;

/**
 * Strip what an observation says about excluded pages. Returns null when nothing is left
 * worth logging (a title update, a screenshot or the text of an excluded page).
 */
export function anonymize(o: Observation, excluded: (url: string) => boolean): Observation | null {
  const x = (url: string | undefined) => !!url && url !== EXCLUDED_URL && excluded(url);
  switch (o.type) {
    case 'nav.committed':
    case 'nav.history':
    case 'nav.fragment':
    case 'nav.completed':
    case 'nav.target':
    case 'nav.intent':
      return x(o.url) ? { ...o, url: EXCLUDED_URL } : o;
    case 'tab.created':
      return x(o.url) ? { ...o, url: EXCLUDED_URL } : o;
    case 'tab.updated':
      return x(o.url) ? null : o;
    case 'page.click':
      return x(o.href) ? { ...o, href: EXCLUDED_URL, text: '' } : o;
    case 'page.submit':
      return x(o.action) ? { ...o, action: EXCLUDED_URL } : o;
    case 'page.history':
      return x(o.url) ? { ...o, url: EXCLUDED_URL } : o;
    case 'page.capture':
    case 'page.text':
      return x(o.url) ? null : o;
    case 'tab.reopened':
      return x(o.visitUrl) ? null : o;
    case 'recorder.wake':
      return { ...o, tabs: o.tabs.map((w) => (x(w.url) ? { ...w, url: EXCLUDED_URL, title: undefined } : w)) };
    default:
      return o;
  }
}
