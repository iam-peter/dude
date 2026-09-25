<!--
  Visual browse (SPEC §8.2 item 3, F8): every screenshot, newest first — for "I know how
  it looked". Grows in pages as you scroll.
-->
<script lang="ts">
  import type { SearchDoc } from '@/search';
  import { shotUrls } from './shots';

  interface Props {
    docs: SearchDoc[]; // already filtered, newest first, all with a shotId
    onShow: (doc: SearchDoc) => void;
  }
  let { docs, onShow }: Props = $props();

  const PAGE = 120;
  let limit = $state(PAGE);
  let urls = $state<Record<string, string>>({});
  const shown = $derived(docs.slice(0, limit));

  $effect(() => {
    const missing = shown.map((d) => d.shotId!).filter((id) => !urls[id]);
    if (missing.length) shotUrls(missing).then((u) => (urls = { ...urls, ...u }));
  });

  let sentinel: HTMLElement;
  $effect(() => {
    const io = new IntersectionObserver((e) => {
      if (e.some((x) => x.isIntersecting) && limit < docs.length) limit += PAGE;
    });
    io.observe(sentinel);
    return () => io.disconnect();
  });

  const day = (t: number) => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });
</script>

<div class="wall">
  {#each shown as d (d.id)}
    <button class="tile" onclick={() => onShow(d)} title={`${d.title ?? ''}\n${d.url}\n${new Date(d.lastAt).toLocaleString()}`}>
      {#if urls[d.shotId!]}<img src={urls[d.shotId!]} alt={d.title ?? d.url} loading="lazy" />{:else}<span class="ph"></span>{/if}
      <span class="cap"><span class="t">{d.title || d.host}</span><span class="d">{day(d.lastAt)}</span></span>
    </button>
  {:else}
    <p class="none">No screenshots match.</p>
  {/each}
  <span bind:this={sentinel} class="sentinel"></span>
</div>

<style>
  .wall {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 10px;
  }
  .tile {
    all: unset;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    background: Canvas;
  }
  .tile:hover,
  .tile:focus-visible {
    border-color: #2f7de1;
    outline: 1px solid #2f7de1;
  }
  img,
  .ph {
    width: 100%;
    aspect-ratio: 16 / 10;
    object-fit: cover;
    object-position: top left;
    background: color-mix(in srgb, CanvasText 8%, Canvas);
    display: block;
  }
  .cap {
    display: flex;
    gap: 6px;
    padding: 4px 6px;
    font-size: 11.5px;
  }
  .t {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .d {
    opacity: 0.6;
    flex: none;
  }
  .none {
    opacity: 0.7;
  }
  .sentinel {
    grid-column: 1 / -1;
    height: 1px;
  }
</style>
