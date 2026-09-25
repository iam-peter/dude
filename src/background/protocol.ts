// Messages between the background and the extension UIs.

import type { Session, Visit } from '@/core/model';

export interface SessionSummary {
  id: string;
  open: boolean;
  tabId?: number;
  title?: string;
  spawnedFromVisitId?: string;
  kind?: 'link' | 'duplicate' | 'reopen';
}

/** One card in the sessions app list (SPEC §8.2). */
export interface SessionCard {
  id: string;
  open: boolean;
  createdAt: number;
  lastAt: number;
  title?: string;
  visitCount: number;
  /** Latest screenshot of the first few visits that have one, in visit order. */
  thumbs: string[];
  spawnedFrom?: { sessionId: string; kind: 'link' | 'duplicate' | 'reopen'; title?: string };
}

export interface SessionPayload {
  session: Session;
  visits: Record<string, Visit>;
  parent?: SessionSummary;
  /** The page in the parent session this tab was opened (or duplicated) from. */
  spawnVisit?: { title?: string; url: string };
  children: SessionSummary[];
}

export type Request =
  | { cmd: 'dude.session'; tabId?: number; sessionId?: string }
  | { cmd: 'dude.sessions'; before?: number; limit?: number }
  | { cmd: 'dude.open'; url: string; visitId?: string }
  | { cmd: 'dude.openPath'; visitId: string }
  | { cmd: 'dude.openPath.cancel'; job: string }
  | { cmd: 'dude.semanticBack'; tabId: number }
  | { cmd: 'dude.pendingFocus'; tabId?: number }
  | { cmd: 'dude.searchDocs' }
  | { cmd: 'dude.quickSearch'; q: string }
  | { cmd: 'dude.debug' }
  | { cmd: 'dude.describeSince'; since: number; media?: boolean }
  | { cmd: 'dude.rebuild' }
  | { cmd: 'dude.maintenance' };

/** Broadcast from the background whenever sessions changed. */
export interface ChangedMessage {
  type: 'dude.changed';
  sessionIds: string[];
}

export function request<T>(msg: Request): Promise<T> {
  return browser.runtime.sendMessage(msg) as Promise<T>;
}
