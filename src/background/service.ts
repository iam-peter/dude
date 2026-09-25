// Owns the projection in the background: loads checkpoint + log on wake, appends each
// observation before applying it (the background can be killed at any time, SPEC §11),
// checkpoints now and then, and tells open UIs what changed.

import { createState, STATE_VERSION, type State } from '@/core/model';
import type { Observation } from '@/core/observations';
import { apply, visitFor } from '@/core/projector';
import { describeAll, describeSince } from '@/core/describe';
import { mediaPlan, type MediaPlan } from '@/core/media';
import type { SearchDoc } from '@/search';
import { append, clearBlobs, deleteMeta, getMeta, logSize, putMeta, replaceLog, replay, rewriteLog } from '@/storage/db';
import { deletion, type DeleteWhat } from '@/core/delete';
import type { SessionCard, SessionPayload, SessionSummary } from './protocol';

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
    if (cp?.state?.version === STATE_VERSION) {
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
      const from = s.spawnedFrom?.visitId ? this.st.visits[s.spawnedFrom.visitId] : undefined;
      return structuredClone({
        session: s,
        visits,
        parent: s.spawnedFrom ? this.summary(s.spawnedFrom.sessionId) : undefined,
        spawnVisit: from ? { title: from.title, url: from.url } : undefined,
        children,
      });
    });
  }

  /** Sessions with at least one visit, most recently active first (sessions app list). */
  sessions(q: { before?: number; limit?: number; open?: boolean }): Promise<SessionCard[]> {
    return this.after(() => {
      const cards: SessionCard[] = [];
      for (const s of Object.values(this.st.sessions)) {
        if (!s.visitIds.length) continue;
        if (q.open && s.closedAt !== undefined) continue; // before the limit, so idle open tabs aren't cut off
        const visits = s.visitIds.map((id) => this.st.visits[id]).filter(Boolean);
        const lastAt = Math.max(...visits.map((v) => v.lastAt));
        if (q.before !== undefined && lastAt >= q.before) continue;
        const cur = s.cursorId ? this.st.visits[s.cursorId] : visits.at(-1);
        const from = s.spawnedFrom?.visitId ? this.st.visits[s.spawnedFrom.visitId] : undefined;
        const parent = s.spawnedFrom ? this.summary(s.spawnedFrom.sessionId) : undefined;
        cards.push({
          id: s.id,
          open: s.closedAt === undefined,
          createdAt: s.createdAt,
          lastAt,
          title: cur?.title ?? cur?.url,
          visitCount: visits.filter((v) => !v.inheritedFrom).length,
          imported: s.imported,
          thumbs: visits.flatMap((v) => (v.screenshots.length ? [v.screenshots.at(-1)!.id] : [])).slice(0, 6),
          spawnedFrom: s.spawnedFrom ? { sessionId: s.spawnedFrom.sessionId, kind: s.spawnedFrom.kind, title: from?.title ?? from?.url ?? parent?.title } : undefined,
        });
      }
      cards.sort((a, b) => b.lastAt - a.lastAt);
      return cards.slice(0, q.limit ?? 200);
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

  /** The visit a tab shows for `url` right now, if any (capture dedupe, text dedupe). */
  pageOf(tabId: number, url: string): Promise<{ lastShot?: { hash: string; at: number }; shots: number; textHash?: string } | undefined> {
    return this.after(() => {
      const tab = this.st.tabs[tabId];
      const s = tab && this.st.sessions[tab.sessionId];
      const v = s && visitFor(this.st, s, url);
      if (!v) return undefined;
      return { lastShot: v.screenshots.at(-1), shots: v.screenshots.length, textHash: v.text?.hash };
    });
  }

  /**
   * Blob bookkeeping for maintenance: every referenced id, and the screenshots whose
   * previews can go — visits looked at for less than `minDwellMs` that are no longer
   * current, and anything older than `maxAgeMs` (S2 #7, E2).
   */
  /** One document per visit for the search index (F8). */
  searchDocs(): Promise<SearchDoc[]> {
    return this.after(() =>
      Object.values(this.st.visits).map((v) => {
        // A tab's first page continues the breadcrumb in the tab it was opened from.
        const s = this.st.sessions[v.sessionId];
        const viaTab = !v.parentId && s?.rootId === v.id && !!s.spawnedFrom?.visitId;
        return {
        id: v.id,
        sessionId: v.sessionId,
        parentId: viaTab ? s.spawnedFrom!.visitId : v.parentId,
        viaTab,
        url: v.url,
        host: hostOf(v.url),
        title: v.title,
        query: v.searchQuery,
        anchor: v.anchorText,
        firstAt: v.firstAt,
        lastAt: v.lastAt,
        textId: v.text?.id,
        shotId: v.screenshots.at(-1)?.id,
        favIconUrl: v.favIconUrl,
        inherited: !!v.inheritedFrom,
        };
      }),
    );
  }

  /** Stable reference of a visit for `tab.reopened` (G3). */
  visitRef(visitId: string): Promise<{ url: string; firstAt: number } | undefined> {
    return this.after(() => {
      const v = this.st.visits[visitId];
      return v && { url: v.url, firstAt: v.firstAt };
    });
  }

  /** URLs from the root to a visit, for "open with path" (G2). POST results are skipped. */
  pathTo(visitId: string): Promise<string[]> {
    return this.after(() => {
      const urls: string[] = [];
      for (let id: string | undefined = visitId; id; id = this.st.visits[id]?.parentId) {
        const v = this.st.visits[id];
        if (v && v.method !== 'post') urls.unshift(v.url);
      }
      return urls;
    });
  }

  /** Graph parent of the page a tab shows (semantic back, G4). */
  parentOf(tabId: number): Promise<{ url: string; title?: string } | undefined> {
    return this.after(() => {
      const tab = this.st.tabs[tabId];
      const s = tab && this.st.sessions[tab.sessionId];
      const cur = s?.cursorId ? this.st.visits[s.cursorId] : undefined;
      const p = cur?.parentId ? this.st.visits[cur.parentId] : undefined;
      if (p) return { url: p.url, title: p.title };
      // At the root: the page the tab was opened from, if any.
      const from = s?.spawnedFrom?.visitId ? this.st.visits[s.spawnedFrom.visitId] : undefined;
      return from && { url: from.url, title: from.title };
    });
  }

  /** Metadata-only search for the omnibox: every word in title, URL, search terms or link text. */
  quickSearch(q: string, limit = 6): Promise<{ url: string; title?: string; visitId: string }[]> {
    return this.after(() => {
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      const seen = new Set<string>();
      return Object.values(this.st.visits)
        .filter((v) => !v.inheritedFrom)
        .sort((a, b) => b.lastAt - a.lastAt)
        .filter((v) => {
          const hay = [v.title, v.url, v.searchQuery, v.anchorText].join(' ').toLowerCase();
          if (!words.every((w) => hay.includes(w)) || seen.has(v.normUrl)) return false;
          seen.add(v.normUrl);
          return true;
        })
        .slice(0, limit)
        .map((v) => ({ url: v.url, title: v.title, visitId: v.id }));
    });
  }

  media(now: number, minDwellMs: number, maxAgeMs: number): Promise<MediaPlan> {
    return this.after(() => mediaPlan(this.st, now, minDwellMs, maxAgeMs));
  }

  /** Sessions touched since `since`, ids normalised (E2E checks). */
  describeSince(since: number, media = false): Promise<string> {
    return this.after(() => describeSince(this.st, since, { media }));
  }

  /** Throw the projection away and replay the whole log (after a projector fix, delete, import). */
  rebuild(): Promise<void> {
    return this.after(() => this.rebuildNow());
  }

  private async rebuildNow() {
    const old = Object.keys(this.st.sessions);
    this.st = createState();
    this.seq = await replay(0, (_, o) => apply(this.st, o));
    // Always rewrite: after a delete the last seq may be unchanged, but the old checkpoint
    // still holds what was deleted.
    await this.checkpoint(true);
    for (const id of [...old, ...Object.keys(this.st.sessions)]) this.changed.add(id);
    this.scheduleBroadcast();
  }

  /** How many logged observations mention `needle` (privacy checks after exclude/delete). */
  grepLog(needle: string): Promise<number> {
    return this.after(async () => {
      let n = 0;
      await replay(0, (_, o) => {
        if (JSON.stringify(o).includes(needle)) n++;
      });
      return n;
    });
  }

  /** Delete everything: log, checkpoint, images, texts, search index. */
  deleteAll(): Promise<void> {
    return this.after(async () => {
      await replaceLog([]);
      await clearBlobs();
      await this.rebuildNow();
    });
  }

  /** Import (E5): the given log replaces the current one (blobs are written by the page). */
  importLog(obs: Observation[]): Promise<number> {
    return this.after(async () => {
      await replaceLog(obs);
      await deleteMeta('searchIndex');
      await this.rebuildNow();
      return obs.length;
    });
  }

  /** Real delete (SPEC §12): rewrite the log, rebuild, forget the search index. */
  delete(what: DeleteWhat): Promise<{ deleted: number; changed: number }> {
    return this.after(async () => {
      const res = await rewriteLog(deletion(this.st, what));
      await this.rebuildNow();
      await deleteMeta('searchIndex');
      return res;
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

  private async checkpoint(force = false) {
    if (!force && this.seq === this.checkpointSeq) return;
    const seq = this.seq;
    await putMeta(CHECKPOINT_KEY, { seq, state: this.st } satisfies Checkpoint);
    this.checkpointSeq = seq;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

