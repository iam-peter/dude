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
 * Open the live tree next to the page (SPEC §8.1): Firefox's sidebar or Chromium's side
 * panel. Must run in a user-gesture handler (a popup button click qualifies).
 */
export async function openPanel(windowId?: number): Promise<void> {
  const sidebar = (browser as unknown as { sidebarAction?: { open(): Promise<void> } }).sidebarAction;
  if (sidebar) return sidebar.open();
  const panel = (browser as unknown as { sidePanel?: { open(o: { windowId: number }): Promise<void> } }).sidePanel;
  if (panel && windowId !== undefined) return panel.open({ windowId });
}
