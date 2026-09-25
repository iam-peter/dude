// Projection model (SPEC §5.1). Plain JSON-serializable objects so the whole state can be
// checkpointed and restored.

export type EdgeKind = 'link' | 'form' | 'jump' | 'spa' | 'spawn' | 'unknown';

export interface Visit {
  id: string;
  sessionId: string;
  parentId?: string;
  children: string[];
  url: string;
  normUrl: string;
  /** Earlier URLs of the same history entry (replaceState, client redirects, debounced pushes). */
  aliases: string[];
  title?: string;
  favIconUrl?: string;
  firstAt: number;
  lastAt: number;
  dwellMs: number;
  reloadCount: number;
  /** How the navigation started: link, typed, generated (address-bar search), bookmark, form, spa, … */
  transition: string;
  /** Edge from the parent (drawn dashed for `jump`, B8). */
  edge: EdgeKind;
  method?: 'post';
  redirected?: boolean;
  redirectChain: string[];
  fragments: { hash: string; at: number }[];
  anchorText?: string;
  searchQuery?: string;
  /** Duplicated tabs start with copies of the source's path (B13); this points at the original. */
  inheritedFrom?: string;
  /** Screenshot ids, oldest first; at most MAX_SHOTS (D5). */
  screenshots: { id: string; hash: string; at: number }[];
  /** Latest readable text of the page (C7). */
  text?: { id: string; hash: string; at: number };
  /** Same-URL pushState entries stacked on this visit (S1 #32). */
  samePushes: number;
  createdBy: 'commit' | 'spa' | 'inherit' | 'wake' | 'unknown-back';
}

export interface Move {
  at: number;
  from?: string;
  to: string;
  dir: 'back' | 'forward';
}

export interface LifecycleEntry {
  kind: 'closed' | 'restored-closed-tab' | 'restored-startup' | 'moved-window' | 'gone-at-wake';
  at: number;
  windowId?: number;
  /** Firefox: stable tab value. Chrome: URL + event pattern (S1 #14, #16, R2). */
  matchedBy?: 'tabValue' | 'heuristic';
  /** For heuristic matches: 'high' when the URL was unambiguous. */
  confidence?: 'high' | 'medium';
}

export interface Session {
  id: string;
  /** Browser tab id while the tab is open; volatile across restarts. */
  tabId?: number;
  lastTabId: number;
  windowId: number;
  tabValue?: string;
  createdAt: number;
  closedAt?: number;
  rootId?: string;
  cursorId?: string;
  spawnedFrom?: { sessionId: string; visitId?: string; kind: 'link' | 'duplicate' };
  lifecycle: LifecycleEntry[];
  moves: Move[];
  visitIds: string[];
}

/** Per-tab working memory of the projector (not part of the product model). */
export interface TabState {
  sessionId: string;
  boundAt: number;
  seenValue?: string;
  lastCommitAt?: number;
  lastCompletedAt?: number;
  click?: { href: string; text: string; t: number; newTab: boolean };
  submit?: { method: string; t: number };
  probes: { kind: 'push' | 'replace'; url: string; t: number }[];
  hsuPending?: { url: string; t: number; result: 'pushed' | 'ignored'; visitId?: string };
  restoringUntil?: number;
  openerTabId?: number;
}

/** Bump when the shape changes: older checkpoints are then ignored and the log replayed. */
export const STATE_VERSION = 2;

export interface State {
  version: typeof STATE_VERSION;
  nextId: number;
  sessions: Record<string, Session>;
  visits: Record<string, Visit>;
  tabs: Record<number, TabState>;
  byValue: Record<string, string>;
  pendingTargets: Record<number, { sourceTabId: number; t: number }>;
  focus: { windowId: number; unfocusedAt?: number; activeByWindow: Record<number, number> };
  dwellFrom?: { visitId: string; t: number };
}

export function createState(): State {
  return {
    version: STATE_VERSION,
    nextId: 0,
    sessions: {},
    visits: {},
    tabs: {},
    byValue: {},
    pendingTargets: {},
    focus: { windowId: -1, activeByWindow: {} },
  };
}
