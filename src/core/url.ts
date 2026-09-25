// URL helpers for the projector (SPEC §5.1, §6.2).

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_eid|mc_cid|_hsenc|_hsmid|igshid|yclid|ref_src)$/i;

/** Only real web pages become visits; browser and extension pages are skipped. */
export function isRecordable(url: string | undefined): url is string {
  return !!url && /^(https?|file):/i.test(url);
}

/** "Same page" key: no fragment, no tracking parameters (SPEC §5.1). */
export function normUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}

/** URL without fragment, for comparing history entries. */
export function withoutHash(url: string): string {
  const i = url.indexOf('#');
  return i < 0 ? url : url.slice(0, i);
}

/** Path + query changed? (the fallback SPA rule when no history probe report exists) */
export function pathOrQueryChanged(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin !== y.origin || x.pathname !== y.pathname || x.search !== y.search;
  } catch {
    return withoutHash(a) !== withoutHash(b);
  }
}

// host pattern → query parameter (C1)
const SEARCH_ENGINES: [RegExp, string][] = [
  [/(^|\.)google\.[a-z.]+$/, 'q'],
  [/(^|\.)bing\.com$/, 'q'],
  [/(^|\.)duckduckgo\.com$/, 'q'],
  [/(^|\.)startpage\.com$/, 'query'],
  [/(^|\.)ecosia\.org$/, 'q'],
  [/(^|\.)kagi\.com$/, 'q'],
  [/(^|\.)youtube\.com$/, 'search_query'],
  [/(^|\.)wikipedia\.org$/, 'search'],
];

export function searchQuery(url: string): string | undefined {
  try {
    const u = new URL(url);
    for (const [host, param] of SEARCH_ENGINES) {
      if (host.test(u.hostname)) {
        const q = u.searchParams.get(param)?.trim();
        if (q) return q;
      }
    }
  } catch {
    /* not a URL */
  }
  return undefined;
}
