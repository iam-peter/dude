// Pages that are never captured and whose text is never stored (D6). A built-in list for
// banking, payment and password managers, plus the user's own host list (settings, M6).
// Pages with a visible password field are skipped separately, by the content probe.

const BUILTIN_HOSTS: RegExp[] = [
  // anything that calls itself a bank or online banking
  /(^|[.-])(online-?)?bank(ing)?([.-]|$)/i,
  /(^|\.)(sparkasse|volksbank|raiffeisen|commerzbank|deutsche-bank|comdirect|consorsbank|dkb|ing|n26|revolut|wise|monzo|chase|wellsfargo|barclays|hsbc|santander)\.[a-z.]+$/i,
  // payment
  /(^|\.)(paypal|stripe|klarna|adyen|mollie|braintreegateway|checkout)\.[a-z.]+$/i,
  // password managers and vaults
  /(^|\.)(1password|bitwarden|lastpass|dashlane|keepersecurity|nordpass|roboform)\.[a-z.]+$/i,
  /^pass\.proton\.me$/i,
  // crypto exchanges and wallets
  /(^|\.)(coinbase|binance|kraken|bitpanda|metamask)\.[a-z.]+$/i,
];

const BUILTIN_PATHS = /\/(checkout|payment|pay)(\/|$)/i;

/** User globs: "example.com" matches it and its subdomains, "*.example.com" only subdomains. */
function matchesGlob(host: string, glob: string): boolean {
  const g = glob.trim().toLowerCase();
  if (!g) return false;
  if (g.startsWith('*.')) return host.endsWith(g.slice(1));
  return host === g || host.endsWith('.' + g);
}

export function isSensitive(url: string, userHosts: readonly string[] = []): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  if (BUILTIN_HOSTS.some((re) => re.test(host))) return true;
  if (BUILTIN_PATHS.test(u.pathname)) return true;
  return userHosts.some((g) => matchesGlob(host, g));
}
