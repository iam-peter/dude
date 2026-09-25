<!--
  Details of one page (SPEC §8.4): screenshots, facts about the visit, related tabs,
  the stored page text, and actions. In network mode a row stands for several visits of
  the same page; the latest is shown, the others are listed.
-->
<script lang="ts">
  import type { Visit } from '@/core/model';
  import type { SessionSummary } from '@/background/protocol';
  import { shortUrl } from '@/core/describe';
  import { getText } from '@/storage/db';
  import { gunzip } from '@/background/imaging';
  import { shotUrl } from './shots';

  interface Props {
    visits: Visit[]; // oldest first
    children: SessionSummary[]; // tabs opened from these visits
    onOpen: (url: string) => void;
    onShowSession: (id: string) => void;
  }
  let { visits, children, onOpen, onShowSession }: Props = $props();

  const v = $derived(visits.at(-1)!);
  const shots = $derived(visits.flatMap((x) => x.screenshots));
  let shown = $state<string | undefined>();
  let big = $state<string | undefined>();
  let text = $state<string | null>(null);
  let copied = $state(false);

  $effect(() => {
    // new selection: show the latest screenshot, hide the text
    shown = shots.at(-1)?.id;
    text = null;
  });
  $effect(() => {
    const id = shown;
    big = undefined;
    if (id) shotUrl(id, 'preview').then((u) => id === shown && (big = u));
  });

  let strip = $state<Record<string, string>>({});
  $effect(() => {
    for (const s of shots) if (!strip[s.id]) shotUrl(s.id).then((u) => u && (strip = { ...strip, [s.id]: u }));
  });

  async function showText() {
    if (text !== null) {
      text = null;
      return;
    }
    const rec = v.text ? await getText(v.text.id) : undefined;
    text = rec ? await gunzip(rec.gz) : '(no text stored)';
  }

  async function copy() {
    await navigator.clipboard.writeText(v.url);
    copied = true;
    setTimeout(() => (copied = false), 1200);
  }

  const time = (t: number) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const how: Record<string, string> = {
    link: 'followed a link',
    typed: 'typed the address',
    generated: 'searched from the address bar',
    bookmark: 'opened a bookmark',
    form: 'submitted a form',
    spa: 'in-page navigation',
    reload: 'reload',
    existing: 'already open when recording started',
    unknown: 'from before recording started',
  };
</script>

<section class="details">
  <div class="shot">
    {#if big}<img src={big} alt="Screenshot of {v.title ?? v.url}" />{:else}<div class="noshot">{shots.length ? 'loading…' : 'No screenshot of this page'}</div>{/if}
    {#if shots.length > 1}
      <div class="strip">
        {#each shots as s (s.id)}
          <button class:on={s.id === shown} onclick={() => (shown = s.id)} title={time(s.at)}>
            {#if strip[s.id]}<img src={strip[s.id]} alt="" />{/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="facts">
    <h2>{v.title || shortUrl(v.url)}</h2>
    <a class="url" href={v.url} onclick={(e) => { e.preventDefault(); onOpen(v.url); }}>{v.url}</a>
    <dl>
      <dt>When</dt>
      <dd>{time(v.firstAt)}{#if v.lastAt - v.firstAt > 60_000} – {time(v.lastAt)}{/if}{#if v.dwellMs > 1000} · looked at {Math.round(v.dwellMs / 1000)} s{/if}</dd>
      <dt>How</dt>
      <dd>{how[v.transition] ?? v.transition}{#if v.inheritedFrom} (copied from the tab this one was duplicated from){/if}</dd>
      {#if v.anchorText}<dt>Link text</dt><dd>“{v.anchorText}”</dd>{/if}
      {#if v.searchQuery}<dt>Search</dt><dd>“{v.searchQuery}”</dd>{/if}
      {#if v.redirectChain.length || v.redirected}<dt>Redirects</dt><dd>{v.redirectChain.length ? v.redirectChain.map(shortUrl).join(' → ') + ' →' : 'server redirect'}</dd>{/if}
      {#if v.method === 'post'}<dt>Form</dt><dd>result of a POST form — reopening may not show the same page; the screenshot is the record</dd>{/if}
      {#if v.reloadCount}<dt>Reloads</dt><dd>{v.reloadCount}</dd>{/if}
      {#if v.fragments.length}<dt>Anchors</dt><dd>{v.fragments.map((f) => f.hash).join(' ')}</dd>{/if}
      {#if visits.length > 1}<dt>Visits</dt><dd>{visits.length}: {visits.map((x) => new Date(x.firstAt).toLocaleTimeString([], { timeStyle: 'short' })).join(', ')}</dd>{/if}
    </dl>
    {#if children.length}
      <h3>Opened from here</h3>
      {#each children as c (c.id)}
        <button class="link" onclick={() => onShowSession(c.id)}>{c.kind === 'duplicate' ? '⧉' : '↗'} {c.title ?? '…'}</button>
      {/each}
    {/if}
    <div class="actions">
      <button class="primary" onclick={() => onOpen(v.url)}>Open in new tab</button>
      <button onclick={copy}>{copied ? 'Copied' : 'Copy URL'}</button>
      {#if v.text}<button onclick={showText}>{text === null ? 'Show page text' : 'Hide text'}</button>{/if}
    </div>
    {#if text !== null}<pre class="text">{text}</pre>{/if}
  </div>
</section>

<style>
  .details {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    gap: 16px;
    align-items: start;
  }
  @media (max-width: 900px) {
    .details {
      grid-template-columns: 1fr;
    }
  }
  .shot > img {
    max-height: 62vh;
    object-fit: contain;
    object-position: top left;
  }
  .shot img {
    width: 100%;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    display: block;
  }
  .noshot {
    aspect-ratio: 16 / 9;
    display: grid;
    place-items: center;
    border-radius: 8px;
    background: color-mix(in srgb, CanvasText 6%, Canvas);
    opacity: 0.8;
  }
  .strip {
    display: flex;
    gap: 6px;
    margin-top: 6px;
    overflow-x: auto;
  }
  .strip button {
    all: unset;
    cursor: pointer;
    width: 96px;
    height: 54px;
    border-radius: 5px;
    overflow: hidden;
    flex: none;
    outline: 2px solid transparent;
    background: color-mix(in srgb, CanvasText 8%, Canvas);
  }
  .strip button.on {
    outline-color: #e8912d;
  }
  .strip img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top;
    border: 0;
    border-radius: 0;
  }
  h2 {
    font-size: 16px;
    margin: 0 0 4px;
  }
  h3 {
    font-size: 12px;
    margin: 12px 0 4px;
    opacity: 0.7;
  }
  .url {
    font-size: 12px;
    word-break: break-all;
    color: #2f7de1;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 3px 10px;
    margin: 10px 0 0;
    font-size: 12.5px;
  }
  dt {
    opacity: 0.6;
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .link {
    all: unset;
    cursor: pointer;
    color: #2f7de1;
    display: block;
    font-size: 12.5px;
  }
  .link:hover {
    text-decoration: underline;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 14px;
  }
  .actions button {
    padding: 5px 10px;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
    font: inherit;
    font-size: 12.5px;
  }
  .actions button.primary {
    background: #2f7de1;
    border-color: #2f7de1;
    color: white;
  }
  .text {
    white-space: pre-wrap;
    font: 12px/1.45 system-ui, sans-serif;
    max-height: 320px;
    overflow: auto;
    padding: 8px;
    border-radius: 6px;
    background: color-mix(in srgb, CanvasText 5%, Canvas);
  }
</style>
