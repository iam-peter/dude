// Full-text search over recorded visits (F8): title, URL, search terms, link text and the
// stored page text. The index lives with the UI page that searches; it is cached as JSON
// and re-synced incrementally, so each page text is decompressed and indexed only once.

import MiniSearch, { type SearchResult } from 'minisearch';

export interface SearchDoc {
  id: string; // visit id
  sessionId: string;
  parentId?: string;
  url: string;
  host: string;
  title?: string;
  query?: string; // search terms the visit was a search for
  anchor?: string; // text of the link that led here
  firstAt: number;
  lastAt: number;
  textId?: string;
  shotId?: string; // latest screenshot
  favIconUrl?: string;
  /** Copies in duplicated tabs (B13): kept for breadcrumbs, not indexed twice. */
  inherited: boolean;
  /** The root of a tab opened from another tab: `parentId` is the page in that other tab. */
  viaTab?: boolean;
}

export interface Filters {
  since?: number;
  host?: string;
  sessionIds?: Set<string>;
}

export interface Hit {
  doc: SearchDoc;
  score: number;
  terms: string[];
  /** Fields the query matched in (title, url, query, anchor, text). */
  fields: string[];
}

export interface Cached {
  version: number;
  json: string;
  sigs: Record<string, string>;
}

const VERSION = 1;

const tokenize = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function options() {
  return {
    idField: 'id',
    fields: ['title', 'url', 'query', 'anchor', 'text'],
    tokenize,
    searchOptions: {
      boost: { title: 3, query: 2.5, anchor: 2, url: 1.5, text: 1 },
      // Prefix-match only from three letters: "page b" must not match every word starting with b.
      prefix: (term: string) => term.length >= 3,
      fuzzy: (term: string) => (term.length >= 5 ? 0.15 : 0),
      combineWith: 'AND' as const,
    },
  };
}

const signature = (d: SearchDoc) => [d.title, d.url, d.query, d.anchor, d.textId].join('\u0000');

export class SearchIndex {
  private ms = new MiniSearch<Record<string, string>>(options());
  private sigs: Record<string, string> = {};
  readonly docs = new Map<string, SearchDoc>();

  constructor(private loadText: (textId: string) => Promise<string | undefined>) {}

  /** Start from a cached index; ignored if it was made by another version. */
  restore(cached: Cached | undefined) {
    if (!cached || cached.version !== VERSION) return;
    try {
      this.ms = MiniSearch.loadJSON(cached.json, options());
      this.sigs = { ...cached.sigs };
    } catch {
      this.ms = new MiniSearch(options());
      this.sigs = {};
    }
  }

  /** Bring the index up to date with `docs`; returns how many documents were (re)indexed. */
  async sync(docs: SearchDoc[], onProgress?: (done: number, total: number) => void): Promise<number> {
    this.docs.clear();
    for (const d of docs) this.docs.set(d.id, d);
    const wanted = docs.filter((d) => !d.inherited);
    const wantedIds = new Set(wanted.map((d) => d.id));
    for (const id of Object.keys(this.sigs)) {
      if (!wantedIds.has(id)) {
        if (this.ms.has(id)) this.ms.discard(id);
        delete this.sigs[id];
      }
    }
    const todo = wanted.filter((d) => this.sigs[d.id] !== signature(d));
    let done = 0;
    for (const d of todo) {
      const text = d.textId ? ((await this.loadText(d.textId).catch(() => undefined)) ?? '') : '';
      if (this.ms.has(d.id)) this.ms.discard(d.id);
      this.ms.add({ id: d.id, title: d.title ?? '', url: d.url, query: d.query ?? '', anchor: d.anchor ?? '', text });
      this.sigs[d.id] = signature(d);
      onProgress?.(++done, todo.length);
    }
    return todo.length;
  }

  search(q: string, f: Filters = {}): Hit[] {
    if (!q.trim()) return [];
    const host = f.host?.trim().toLowerCase();
    return this.ms
      .search(q, {
        filter: (r: SearchResult) => {
          const d = this.docs.get(r.id as string);
          if (!d) return false;
          if (f.since !== undefined && d.lastAt < f.since) return false;
          if (host && !d.host.toLowerCase().includes(host)) return false;
          if (f.sessionIds && !f.sessionIds.has(d.sessionId)) return false;
          return true;
        },
      })
      .map((r) => ({
        doc: this.docs.get(r.id as string)!,
        score: r.score,
        terms: r.terms,
        fields: [...new Set(Object.values(r.match).flat())],
      }));
  }

  /** Ancestors of a visit, root first (F9 breadcrumb), across "opened from" links between tabs. */
  ancestors(id: string): SearchDoc[] {
    const out: SearchDoc[] = [];
    const seen = new Set([id]);
    for (let p = this.docs.get(id)?.parentId; p && !seen.has(p); p = this.docs.get(p)?.parentId) {
      const d = this.docs.get(p);
      if (!d) break;
      seen.add(p);
      out.unshift(d);
    }
    return out;
  }

  snapshot(): Cached {
    return { version: VERSION, json: JSON.stringify(this.ms), sigs: { ...this.sigs } };
  }
}

/** A short excerpt of `text` around the first query term (result snippets). */
export function snippet(text: string, terms: string[], width = 160): string | undefined {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return undefined;
  const start = Math.max(0, at - width / 3);
  const s = text.slice(start, start + width).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + s + (start + width < text.length ? '…' : '');
}
