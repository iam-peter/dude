// Owns the projection in the background: loads checkpoint + log on wake, appends each
// observation before applying it (the background can be killed at any time, SPEC §11),
// checkpoints now and then, and tells open UIs what changed.

import { createState, type State } from '@/core/model';
import type { Observation } from '@/core/observations';
import { apply } from '@/core/projector';
import { describeAll, describeSince } from '@/core/describe';
import { append, getMeta, logSize, putMeta, replay } from '@/storage/db';
import type { SessionPayload, SessionSummary } from './protocol';

const CHECKPOINT_KEY = 'checkpoint';
const CHECKPOINT_EVERY = 200;
const CHECKPOINT_IDLE_MS = 3000;
const BROADCAST_MS = 100;

interface Checkpoint {
  seq: number;
  state: State;
}

export type Producer = () => Observation[] | Promise<Observation[]>;

export class Service {
  private st: State = createState();
  private seq = 0;
  private checkpointSeq = 0;
  private chain: Promise<unknown>;
  private changed = new Set<string>();
  private broadcastTimer?: ReturnType<typeof setTimeout>;
  private checkpointTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.chain = this.load();
  }

  private async load() {
    const cp = await getMeta<Checkpoint>(CHECKPOINT_KEY).catch(() => undefined);
    if (cp?.state?.version === 1) {
      this.st = cp.state;
      this.seq = this.checkpointSeq = cp.seq;
    }
    this.seq = await replay(this.seq, (_, o) => apply(this.st, o));
  }

  /**
   * Queue observations. Producers run strictly in call order, so async enrichment (tab
   * values) can't reorder the log.
   */
  enqueue(producer: Producer): void {
    this.chain = this.chain
      .then(async () => {
        for (const o of await producer()) {
          this.seq = await append(o);
          for (const id of apply(this.st, o)) this.changed.add(id);
        }
        this.scheduleBroadcast();
        this.scheduleCheckpoint();
      })
      .catch((e) => console.error('dude: observation failed', e));
  }

  /** Run after everything queued so far. */
  private after<T>(fn: () => T | Promise<T>): Promise<T> {
    const p = this.chain.then(fn);
    this.chain = p.catch(() => undefined);
    return p;
  }

  session(q: { tabId?: number; sessionId?: string }): Promise<SessionPayload | null> {
    return this.after(() => {
      const id = q.sessionId ?? (q.tabId !== undefined ? this.st.tabs[q.tabId]?.sessionId : undefined);
      const s = id ? this.st.sessions[id] : undefined;
      if (!s) return null;
      const visits = Object.fromEntries(s.visitIds.map((v) => [v, this.st.visits[v]]));
      const children = Object.values(this.st.sessions)
        .filter((x) => x.spawnedFrom?.sessionId === s.id && x.visitIds.length)
        .map((x) => this.summary(x.id)!);
      return structuredClone({ session: s, visits, parent: s.spawnedFrom ? this.summary(s.spawnedFrom.sessionId) : undefined, children });
    });
  }

  private summary(sessionId: string): SessionSummary | undefined {
    const s = this.st.sessions[sessionId];
    if (!s) return undefined;
    const root = s.rootId ? this.st.visits[s.rootId] : undefined;
    const cur = s.cursorId ? this.st.visits[s.cursorId] : undefined;
    return {
      id: s.id,
      open: s.closedAt === undefined,
      tabId: s.tabId,
      title: cur?.title ?? root?.title ?? cur?.url ?? root?.url,
      spawnedFromVisitId: s.spawnedFrom?.visitId,
      kind: s.spawnedFrom?.kind,
    };
  }

  debug(): Promise<{ text: string; seq: number; logSize: number; sessions: number; visits: number }> {
    return this.after(async () => ({
      text: describeAll(this.st, { titles: true }),
      seq: this.seq,
      logSize: await logSize(),
      sessions: Object.keys(this.st.sessions).length,
      visits: Object.keys(this.st.visits).length,
    }));
  }

  /** Sessions touched since `since`, ids normalised (E2E checks). */
  describeSince(since: number): Promise<string> {
    return this.after(() => describeSince(this.st, since));
  }

  /** Throw the projection away and replay the whole log (after a projector fix). */
  rebuild(): Promise<void> {
    return this.after(async () => {
      this.st = createState();
      this.seq = await replay(0, (_, o) => apply(this.st, o));
      await this.checkpoint();
      for (const id of Object.keys(this.st.sessions)) this.changed.add(id);
      this.scheduleBroadcast();
    });
  }

  private scheduleBroadcast() {
    if (!this.changed.size || this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = undefined;
      const sessionIds = [...this.changed];
      this.changed.clear();
      browser.runtime.sendMessage({ type: 'dude.changed', sessionIds }).catch(() => undefined); // no UI open
    }, BROADCAST_MS);
  }

  private scheduleCheckpoint() {
    if (this.seq - this.checkpointSeq >= CHECKPOINT_EVERY) {
      this.after(() => this.checkpoint());
      return;
    }
    clearTimeout(this.checkpointTimer);
    this.checkpointTimer = setTimeout(() => this.after(() => this.checkpoint()), CHECKPOINT_IDLE_MS);
  }

  private async checkpoint() {
    if (this.seq === this.checkpointSeq) return;
    const seq = this.seq;
    await putMeta(CHECKPOINT_KEY, { seq, state: this.st } satisfies Checkpoint);
    this.checkpointSeq = seq;
  }
}
