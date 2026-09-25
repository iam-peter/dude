// Messages between the background and the extension UIs.

import type { Session, Visit } from '@/core/model';

export interface SessionSummary {
  id: string;
  open: boolean;
  tabId?: number;
  title?: string;
  spawnedFromVisitId?: string;
  kind?: 'link' | 'duplicate';
}

export interface SessionPayload {
  session: Session;
  visits: Record<string, Visit>;
  parent?: SessionSummary;
  children: SessionSummary[];
}

export type Request =
  | { cmd: 'dude.session'; tabId?: number; sessionId?: string }
  | { cmd: 'dude.open'; url: string }
  | { cmd: 'dude.debug' }
  | { cmd: 'dude.describeSince'; since: number }
  | { cmd: 'dude.rebuild' };

/** Broadcast from the background whenever sessions changed. */
export interface ChangedMessage {
  type: 'dude.changed';
  sessionIds: string[];
}

export function request<T>(msg: Request): Promise<T> {
  return browser.runtime.sendMessage(msg) as Promise<T>;
}
