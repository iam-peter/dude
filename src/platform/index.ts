// Browser differences in one place (SPEC §11 "platform/"). Everything else uses plain
// `browser.*` APIs that both Firefox and Chromium provide.

/** Firefox `sessions.getTabValue`/`setTabValue`; Chromium has no equivalent (S1 #17). */
export interface TabValues {
  get(tabId: number): Promise<string | undefined>;
  set(tabId: number, value: string): Promise<void>;
}

const TAB_VALUE_KEY = 'dude.tab';

export function tabValues(): TabValues | undefined {
  const s = browser.sessions as unknown as
    | { getTabValue?(id: number, key: string): Promise<unknown>; setTabValue?(id: number, key: string, v: unknown): Promise<void> }
    | undefined;
  if (!s?.getTabValue || !s.setTabValue) return undefined;
  const { getTabValue, setTabValue } = s;
  return {
    async get(tabId) {
      const v = await getTabValue.call(s, tabId, TAB_VALUE_KEY).catch(() => undefined);
      return typeof v === 'string' ? v : undefined;
    },
    async set(tabId, value) {
      await setTabValue.call(s, tabId, TAB_VALUE_KEY, value).catch(() => undefined);
    },
  };
}

/**
 * Toolbar button → live tree of the current tab (SPEC §8.1). Firefox toggles its sidebar;
 * Chromium opens the side panel by itself once told to, which also keeps the user gesture.
 */
export function openPanelFromToolbar(): void {
  const sidebar = (browser as unknown as { sidebarAction?: { toggle(): Promise<void> } }).sidebarAction;
  if (sidebar) {
    browser.action.onClicked.addListener(() => {
      sidebar.toggle();
    });
    return;
  }
  const panel = (browser as unknown as { sidePanel?: { setPanelBehavior(o: { openPanelOnActionClick: boolean }): Promise<void> } }).sidePanel;
  panel?.setPanelBehavior({ openPanelOnActionClick: true }).catch((e) => console.error('dude: side panel', e));
}
