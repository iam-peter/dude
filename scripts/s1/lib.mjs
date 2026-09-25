// Helpers shared by the S1 split and summary tools.

/** Tab id a raw record is about, or undefined for window/runtime-level records. */
export function tabIdOf(r) {
  const d = r.data ?? {};
  switch (r.src) {
    case 'tabs.onCreated':
      return d.id;
    case 'tabs.onReplaced':
      return d.addedTabId;
    case 'marker':
    case 'content.click':
    case 'content.submit':
    case 'content.history':
      return d.from?.tabId;
    default:
      return d.tabId;
  }
}

/**
 * Cut a raw log into scenarios by marker pairs. Records of the tab that sent the markers
 * (the control page) are dropped, as are records outside any start/end pair.
 */
export function splitByMarkers(records) {
  const out = [];
  let cur = null;
  for (const r of records) {
    if (r.src === 'marker') {
      if (r.data.kind === 'start') {
        cur = { scenario: r.data.scenario, note: r.data.note, controlTabId: r.data.from?.tabId, start: r, records: [] };
      } else if (cur && r.data.scenario === cur.scenario) {
        cur.end = r;
        cur.status = r.data.note;
        out.push(cur);
        cur = null;
      }
      continue;
    }
    if (!cur) continue;
    if (cur.controlTabId !== undefined && tabIdOf(r) === cur.controlTabId) continue;
    cur.records.push(r);
  }
  return out;
}

const short = (url) => {
  if (!url) return '';
  try {
    const u = new URL(url);
    const host = u.host === 'localhost:8765' ? '' : u.host === '127.0.0.1:8765' ? '[127]' : u.host;
    return host + u.pathname + u.search + u.hash;
  } catch {
    return url;
  }
};

/** One compact, diff-friendly line per record; undefined for records not worth showing. */
export function describe(r, t0, { verbose = false } = {}) {
  const d = r.data ?? {};
  const dt = `+${String(r.t - t0).padStart(5)}ms`;
  const tab = tabIdOf(r);
  const who = tab === undefined ? '       ' : `tab ${String(tab).padEnd(3)}`;
  const src = r.src.replace('webNavigation.', 'wn.').replace('tabs.', 'tabs.');
  let what = '';
  switch (r.src) {
    case 'webNavigation.onCommitted':
      what = `${d.transitionType} [${(d.transitionQualifiers ?? []).join(',')}] ${short(d.url)}`;
      break;
    case 'webNavigation.onBeforeNavigate':
    case 'webNavigation.onDOMContentLoaded':
    case 'webNavigation.onCompleted':
    case 'webNavigation.onHistoryStateUpdated':
    case 'webNavigation.onReferenceFragmentUpdated':
      what = short(d.url);
      if (d.transitionType) what += ` ${d.transitionType} [${(d.transitionQualifiers ?? []).join(',')}]`;
      break;
    case 'webNavigation.onErrorOccurred':
      what = `${short(d.url)} ${d.error}`;
      break;
    case 'webNavigation.onCreatedNavigationTarget':
      what = `from tab ${d.sourceTabId} frame ${d.sourceFrameId} → ${short(d.url)}`;
      break;
    case 'tabs.onCreated':
      what = `opener=${d.openerTabId ?? '-'} win=${d.windowId} idx=${d.index} active=${d.active} ${short(d.pendingUrl ?? d.url)}`;
      break;
    case 'tabs.onUpdated': {
      const c = d.changeInfo ?? {};
      const keys = Object.keys(c).filter((k) => verbose || k !== 'favIconUrl');
      if (!keys.length) return undefined;
      what = keys.map((k) => `${k}=${k === 'url' ? short(c[k]) : JSON.stringify(c[k])}`).join(' ');
      break;
    }
    case 'tabs.onActivated':
      what = `win=${d.windowId} prev=${d.previousTabId ?? '-'}`;
      break;
    case 'tabs.onRemoved':
      what = `win=${d.windowId} closing=${d.isWindowClosing}`;
      break;
    case 'content.click':
      what = `${d.type} btn=${d.button} "${d.text}" → ${short(d.href)}${d.target ? ` target=${d.target}` : ''}`;
      break;
    case 'content.submit':
      what = `${d.method} → ${short(d.action)}`;
      break;
    case 'content.history':
      what = `${d.kind.padEnd(7)} ${short(d.from)} → ${short(d.url)}  length ${d.lengthBefore}→${d.lengthAfter}`;
      break;
    case 'tabValue':
      what = `${d.phase.padEnd(9)} ${d.error ?? (d.value ? String(d.value).slice(0, 8) : '(none)')}${d.fresh ? ' ← assigned' : ''}`;
      break;
    case 'snapshot':
      what = d.tabs.map((t) => `${t.tabId}:${short(t.url)}${t.tabValue?.value ? `#${String(t.tabValue.value).slice(0, 6)}` : ''}`).join(' ');
      break;
    default:
      what = JSON.stringify(d).slice(0, 140);
  }
  if (!verbose && r.src.startsWith('webNavigation.') && d.frameId !== undefined && d.frameId !== 0) return undefined;
  return `${dt}  ${who}  ${src.padEnd(26)} ${what}`;
}
