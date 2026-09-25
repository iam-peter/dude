// User settings and recording state, kept live from extension storage (M6).

import { isSensitive } from '@/core/sensitive';

export const KEYS = {
  denyHosts: 'dude.denyHosts', // user's own deny list (D6), one host glob per entry
  settings: 'dude.settings',
  paused: 'dude.paused', // global pause (C5)
  pausedTabs: 'dude.pausedTabs', // per-tab pause, storage.session (tab ids don't outlive the browser)
} as const;

export interface Settings {
  /** Global size cap for screenshots (E3). */
  capMB: number;
  /** Previews older than this are dropped; thumbnails stay (E2). */
  previewDays: number;
}

export const DEFAULTS: Settings = { capMB: 2048, previewDays: 90 };

export class LiveSettings {
  denyHosts: string[] = [];
  settings: Settings = { ...DEFAULTS };
  paused = false;
  pausedTabs = new Set<number>();
  readonly ready: Promise<void>;

  constructor() {
    this.ready = this.load();
    browser.storage.onChanged.addListener(() => {
      this.load();
    });
  }

  private async load() {
    const r = await browser.storage.local.get([KEYS.denyHosts, KEYS.settings, KEYS.paused]);
    this.denyHosts = Array.isArray(r[KEYS.denyHosts]) ? (r[KEYS.denyHosts] as string[]) : [];
    this.settings = { ...DEFAULTS, ...((r[KEYS.settings] as Partial<Settings>) ?? {}) };
    this.paused = r[KEYS.paused] === true;
    const session = (browser.storage as unknown as { session?: typeof browser.storage.local }).session;
    const t = session ? await session.get(KEYS.pausedTabs) : {};
    this.pausedTabs = new Set(Array.isArray(t[KEYS.pausedTabs]) ? (t[KEYS.pausedTabs] as number[]) : []);
  }

  /** Recorded only as an anonymous placeholder (D6). */
  isExcluded = (url: string) => isSensitive(url, this.denyHosts);

  isPaused = (tabId?: number) => this.paused || (tabId !== undefined && this.pausedTabs.has(tabId));

  async setPaused(paused: boolean, tabId?: number) {
    if (tabId === undefined) {
      this.paused = paused;
      await browser.storage.local.set({ [KEYS.paused]: paused });
      return;
    }
    if (paused) this.pausedTabs.add(tabId);
    else this.pausedTabs.delete(tabId);
    const session = (browser.storage as unknown as { session?: typeof browser.storage.local }).session;
    await session?.set({ [KEYS.pausedTabs]: [...this.pausedTabs] });
  }
}
