// Observations: what the recorder saw, trimmed to the fields the projector needs.
// They form the append-only log (SPEC §5). Interpretation — back/forward, redirect
// folding, restore vs duplicate, push vs replace — happens only in the projector, so a
// projector fix can be applied to old data by replaying the log.
//
// `fromBrowserEvent` is shared by the live recorder and the S1 fixture adapter, so tests
// run the same conversion as production.

export type Observation =
  | { type: 'tab.created'; t: number; tabId: number; windowId: number; index: number; openerTabId?: number; url?: string; tabValue?: string; copiedFrom?: string }
  | { type: 'tab.identity'; t: number; tabId: number; value: string; copiedFrom?: string }
  | { type: 'tab.removed'; t: number; tabId: number; windowId: number; isWindowClosing: boolean }
  | { type: 'tab.activated'; t: number; tabId: number; windowId: number; previousTabId?: number }
  | { type: 'tab.attached'; t: number; tabId: number; windowId: number; index: number }
  | { type: 'tab.updated'; t: number; tabId: number; url?: string; title?: string; favIconUrl?: string }
  | { type: 'window.focus'; t: number; windowId: number }
  | { type: 'nav.target'; t: number; tabId: number; sourceTabId: number; url: string }
  | { type: 'nav.committed'; t: number; tabId: number; url: string; transitionType: string; qualifiers: string[] }
  | { type: 'nav.history'; t: number; tabId: number; url: string; qualifiers: string[] }
  | { type: 'nav.fragment'; t: number; tabId: number; url: string; qualifiers: string[] }
  | { type: 'nav.completed'; t: number; tabId: number; url: string }
  | { type: 'page.click'; t: number; tabId: number; href: string; text: string; button: number; newTab: boolean }
  | { type: 'page.submit'; t: number; tabId: number; action: string; method: string }
  | { type: 'page.history'; t: number; tabId: number; kind: 'push' | 'replace'; url: string; lengthBefore: number; lengthAfter: number }
  | { type: 'recorder.wake'; t: number; tabs: WakeTab[] };

export interface WakeTab {
  tabId: number;
  windowId: number;
  index: number;
  url?: string;
  title?: string;
  tabValue?: string;
}

export type ObservationType = Observation['type'];

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Convert one browser event payload into observations. `src` names the event the way the
 * S1 raw log does ("webNavigation.onCommitted", "tabs.onUpdated", "content.click", …);
 * `d` is the payload in the shape the S1 recorder stored it.
 */
export function fromBrowserEvent(src: string, d: any, t: number): Observation[] {
  switch (src) {
    case 'webNavigation.onCommitted':
      if (d.frameId !== 0) return [];
      return [{ type: 'nav.committed', t, tabId: d.tabId, url: d.url, transitionType: d.transitionType ?? 'link', qualifiers: d.transitionQualifiers ?? [] }];
    case 'webNavigation.onHistoryStateUpdated':
      if (d.frameId !== 0) return [];
      return [{ type: 'nav.history', t, tabId: d.tabId, url: d.url, qualifiers: d.transitionQualifiers ?? [] }];
    case 'webNavigation.onReferenceFragmentUpdated':
      if (d.frameId !== 0) return [];
      return [{ type: 'nav.fragment', t, tabId: d.tabId, url: d.url, qualifiers: d.transitionQualifiers ?? [] }];
    case 'webNavigation.onCompleted':
      if (d.frameId !== 0) return [];
      return [{ type: 'nav.completed', t, tabId: d.tabId, url: d.url }];
    case 'webNavigation.onCreatedNavigationTarget':
      return [{ type: 'nav.target', t, tabId: d.tabId, sourceTabId: d.sourceTabId, url: d.url }];
    case 'tabs.onCreated':
      return [{ type: 'tab.created', t, tabId: d.id, windowId: d.windowId, index: d.index, openerTabId: d.openerTabId, url: d.pendingUrl ?? d.url }];
    case 'tabs.onUpdated': {
      const c = d.changeInfo ?? {};
      if (c.title === undefined && c.favIconUrl === undefined) return [];
      return [{ type: 'tab.updated', t, tabId: d.tabId, url: d.tab?.url, title: c.title, favIconUrl: c.favIconUrl }];
    }
    case 'tabs.onRemoved':
      return [{ type: 'tab.removed', t, tabId: d.tabId, windowId: d.windowId, isWindowClosing: !!d.isWindowClosing }];
    case 'tabs.onActivated':
      return [{ type: 'tab.activated', t, tabId: d.tabId, windowId: d.windowId, previousTabId: d.previousTabId }];
    case 'tabs.onAttached':
      return [{ type: 'tab.attached', t, tabId: d.tabId, windowId: d.newWindowId, index: d.newPosition }];
    case 'windows.onFocusChanged':
      return [{ type: 'window.focus', t, windowId: d.windowId }];
    case 'content.click': {
      const tabId = d.from?.tabId;
      if (tabId === undefined || d.from?.frameId) return [];
      const newTab = d.button === 1 || d.ctrl || d.meta || d.shift || d.target === '_blank';
      return [{ type: 'page.click', t, tabId, href: d.href, text: d.text ?? '', button: d.button ?? 0, newTab }];
    }
    case 'content.submit': {
      const tabId = d.from?.tabId;
      if (tabId === undefined || d.from?.frameId) return [];
      return [{ type: 'page.submit', t, tabId, action: d.action, method: String(d.method ?? 'get').toLowerCase() }];
    }
    case 'content.history': {
      const tabId = d.from?.tabId;
      if (tabId === undefined || d.from?.frameId) return [];
      return [{ type: 'page.history', t, tabId, kind: d.kind, url: d.url, lengthBefore: d.lengthBefore, lengthAfter: d.lengthAfter }];
    }
    default:
      return [];
  }
}
