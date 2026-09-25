<!--
  Search results (F8, F9): each hit with its screenshot, a text snippet, where the match
  was, and the breadcrumb of pages that led to it — the direct answer to "which page
  linked here?".
-->
<script lang="ts">
  import type { Hit, SearchDoc } from '@/search';
  import { snippet } from '@/search';
  import { shortUrl } from '@/core/describe';
  import { pageText } from './search-client';

  interface Props {
    hits: Hit[];
    ancestors: (id: string) => SearchDoc[];
    thumbs: Record<string, string>;
    onShow: (doc: SearchDoc) => void;
    onOpen: (doc: SearchDoc) => void;
  }
  let { hits, ancestors, thumbs, onShow, onOpen }: Props = $props();

  const LIMIT = 60;
  const shown = $derived(hits.slice(0, LIMIT));

  let snippets = $state<Record<string, string>>({});
  $effect(() => {
    for (const h of shown.slice(0, 25)) {
      const id = h.doc.id;
      if (!h.doc.textId || !h.fields.includes('text') || snippets[id] !== undefined) continue;
      pageText(h.doc.textId).then((t) => {
        const s = t ? snippet(t, h.terms) : undefined;
        snippets = { ...snippets, [id]: s ?? '' };
      });
    }
  });

  const where: Record<string, string> = { title: 'title', url: 'address', query: 'search terms', anchor: 'link text', text: 'page text' };
  const when = (t: number) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
</script>

<ol class="results">
  {#each shown as h (h.doc.id)}
    {@const crumbs = ancestors(h.doc.id)}
    <li>
      <button class="main" onclick={() => onShow(h.doc)} title="Show in its session graph">
        {#if h.doc.shotId && thumbs[h.doc.shotId]}<img src={thumbs[h.doc.shotId]} alt="" />{:else}<span class="ph"></span>{/if}
        <span class="text">
          <span class="title">{h.doc.title || shortUrl(h.doc.url)}</span>
          <span class="meta">{h.doc.host} · {when(h.doc.lastAt)} · in {h.fields.map((f) => where[f] ?? f).join(', ')}</span>
          {#if snippets[h.doc.id]}<span class="snippet">{snippets[h.doc.id]}</span>{/if}
        </span>
      </button>
      {#if crumbs.length}
        <div class="crumbs" aria-label="Pages that led here">
          <span class="lbl">from</span>
          {#if crumbs.length > 4}<span class="more">… {crumbs.length - 4} more →</span>{/if}
          {#each crumbs.slice(-4) as c, i (c.id)}
            {@const next = crumbs.slice(-4)[i + 1] ?? h.doc}
            <button class="crumb" title={`${c.title ?? ''}\n${c.url}\nClick to show it in the graph`} onclick={() => onShow(c)}>
              {#if c.shotId && thumbs[c.shotId]}<img src={thumbs[c.shotId]} alt="" />{/if}
              <span>{c.title || c.host}</span>
            </button>
            {#if next.viaTab}<span class="arrow tab" title="opened in a new tab">↗ new tab</span>{:else}<span class="arrow">→</span>{/if}
          {/each}
          <span class="here">this page</span>
        </div>
      {/if}
      <div class="actions">
        {#if crumbs.length}<button onclick={() => onOpen(crumbs.at(-1)!)} title={crumbs.at(-1)!.url}>Open parent</button>{/if}
        <button onclick={() => onOpen(h.doc)}>Open</button>
        <button onclick={() => onShow(h.doc)}>Show in graph</button>
      </div>
    </li>
  {:else}
    <li class="none">No matches.</li>
  {/each}
  {#if hits.length > LIMIT}<li class="none">{hits.length - LIMIT} more — narrow the search.</li>{/if}
</ol>

<style>
  .results {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  li {
    border-radius: 8px;
    padding: 6px;
    background: color-mix(in srgb, CanvasText 3%, Canvas);
    border: 1px solid color-mix(in srgb, CanvasText 8%, transparent);
  }
  .none {
    background: none;
    border: none;
    opacity: 0.7;
  }
  .main {
    all: unset;
    cursor: pointer;
    display: flex;
    gap: 8px;
    width: 100%;
    box-sizing: border-box;
  }
  .main:focus-visible {
    outline: 2px solid #2f7de1;
  }
  .main img,
  .ph {
    width: 88px;
    height: 50px;
    object-fit: cover;
    object-position: top;
    border-radius: 4px;
    flex: none;
    background: color-mix(in srgb, CanvasText 10%, transparent);
  }
  .text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .title {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-size: 11px;
    opacity: 0.6;
  }
  .snippet {
    font-size: 11.5px;
    opacity: 0.85;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .crumbs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 3px;
    margin-top: 6px;
    font-size: 11px;
  }
  .lbl,
  .more,
  .arrow,
  .here {
    opacity: 0.6;
  }
  .arrow.tab {
    color: #2f7de1;
    opacity: 1;
  }
  .crumb {
    all: unset;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 130px;
    padding: 1px 4px 1px 1px;
    border-radius: 4px;
    background: color-mix(in srgb, #2f7de1 10%, Canvas);
  }
  .crumb:hover {
    background: color-mix(in srgb, #2f7de1 22%, Canvas);
  }
  .crumb img {
    width: 32px;
    height: 18px;
    object-fit: cover;
    object-position: top;
    border-radius: 3px;
  }
  .crumb span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .actions {
    display: flex;
    gap: 4px;
    margin-top: 6px;
  }
  .actions button {
    font: inherit;
    font-size: 11.5px;
    padding: 2px 8px;
    border-radius: 5px;
    border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
  }
</style>
