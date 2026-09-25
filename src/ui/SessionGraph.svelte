<!--
  Wide graph for the sessions app (SPEC §8.2, F5, F6): the session left to right, one card
  per node with its latest screenshot. Tree edges (or network edges) shape the layout;
  same-page links and back/forward moves are drawn below the cards.
-->
<script lang="ts">
  import type { Row, View, ViewMode } from '@/core/views';
  import PanZoom from './PanZoom.svelte';
  import { layoutGraph, type GraphLayout } from './graph-layout';

  interface Props {
    view: View;
    mode: ViewMode;
    /** Thumbnail object URL for a row, if it has a screenshot. */
    thumb: (row: Row) => string | undefined;
    /** Number of tabs opened from a row. */
    spawned?: (row: Row) => number;
    selected?: string;
    onSelect: (row: Row) => void;
    onOpen: (row: Row) => void;
  }
  let { view, mode, thumb, spawned, selected, onSelect, onOpen }: Props = $props();

  const W = 184;
  const IMG_H = 104;
  const H = IMG_H + 34;

  let layout = $state<GraphLayout | null>(null);
  $effect(() => {
    let cancelled = false;
    layoutGraph(view, { nodeW: W, nodeH: H, layout: mode === 'network' ? ['net'] : ['tree'] }).then((l) => {
      if (!cancelled) layout = l;
    });
    return () => {
      cancelled = true;
    };
  });

  const focus = $derived.by(() => {
    const n = layout?.nodes.find((x) => view.rows[x.row]?.cursor);
    return n ? { x: n.x, y: n.y, w: W, h: H } : undefined;
  });

  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  function host(url: string) {
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  }
</script>

{#if layout}
  <PanZoom contentW={layout.width} contentH={layout.height} {focus} readable={0.6} maxHeight={Math.max(260, window.innerHeight * 0.5)} hint="click a page for details · double-click to open · drag to pan · wheel to zoom">
    <svg width={layout.width} height={layout.height} overflow="visible">
      <defs>
        {#each ['tree', 'back', 'forward', 'net'] as k}
          <marker id="sg-{k}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" class="fill-{k}" />
          </marker>
        {/each}
        <clipPath id="sg-img"><rect width={W} height={IMG_H} rx="8" /></clipPath>
      </defs>

      {#each layout.edges as e (e.kind + e.from + '>' + e.to)}
        {@const child = view.rows[e.to]}
        <path d={e.d} class="edge {e.kind}" class:jump={child?.edge === 'jump'} class:back={e.to < e.from} style:stroke-width={1.3 + Math.log2(e.n)} marker-end="url(#sg-{e.kind})" />
        {#if e.n > 1}<text class="weight" x={e.labelX} y={e.labelY - 5}>{e.n}</text>{/if}
      {/each}
      {#each layout.overlay as e, i (e.kind + i)}
        <path d={e.d} class="overlay {e.kind}" marker-end={e.kind === 'same' ? undefined : `url(#sg-${e.kind})`} />
        {#if e.kind !== 'same'}<text class="move-n {e.kind}" x={e.labelX} y={e.labelY}>{e.n}</text>{/if}
      {/each}

      {#each layout.nodes as n (n.row)}
        {@const r = view.rows[n.row]}
        {@const img = thumb(r)}
        {@const kids = spawned?.(r) ?? 0}
        <g
          class="card"
          class:cursor={r.cursor}
          class:path={r.onPath}
          class:inherited={r.inherited}
          class:selected={selected === r.key}
          transform="translate({n.x} {n.y})"
          role="button"
          tabindex="0"
          onclick={() => onSelect(r)}
          ondblclick={() => onOpen(r)}
          onkeydown={(e) => {
            if (e.key === 'Enter') onOpen(r);
            else if (e.key === ' ') onSelect(r);
          }}
        >
          <title>{r.title ?? ''}&#10;{r.url}</title>
          <rect class="frame" width={W} height={H} rx="8" />
          {#if img}
            <image href={img} width={W} height={IMG_H} preserveAspectRatio="xMidYMin slice" clip-path="url(#sg-img)" />
          {:else}
            <rect class="noimg" width={W} height={IMG_H} rx="8" />
            {#if r.favIconUrl}<image href={r.favIconUrl} x={W / 2 - 12} y={IMG_H / 2 - 12} width="24" height="24" />{/if}
          {/if}
          <text class="title" x="8" y={IMG_H + 15}>{clip(r.title || r.url, 26)}</text>
          <text class="host" x="8" y={IMG_H + 28}>{clip(host(r.url), 32)}</text>
          {#if kids}
            <g transform="translate({W - 34} {IMG_H + 9})">
              <title>{kids === 1 ? 'A tab was opened from here' : `${kids} tabs were opened from here`}</title>
              <rect width="28" height="16" rx="8" class="spawn" />
              <text class="spawn-t" x="14" y="12">↗{kids}</text>
            </g>
          {/if}
          {#if r.visits > 1}
            <g transform="translate({W - 6} 6)">
              <circle r="10" class="badge" />
              <text class="badge-t" y="3.5">×{r.visits}</text>
            </g>
          {/if}
        </g>
      {/each}
    </svg>
  </PanZoom>
{/if}

<style>
  .edge {
    fill: none;
    stroke: color-mix(in srgb, CanvasText 40%, transparent);
  }
  .edge.jump {
    stroke-dasharray: 6 4;
  }
  .edge.net.back {
    stroke: color-mix(in srgb, #2f7de1 75%, transparent);
    stroke-dasharray: 5 3;
  }
  .overlay {
    fill: none;
    stroke-width: 1.4;
  }
  .overlay.same {
    stroke: color-mix(in srgb, CanvasText 25%, transparent);
    stroke-dasharray: 2 3;
  }
  .overlay.back {
    stroke: #2f7de1;
  }
  .overlay.forward {
    stroke: #1f9d63;
  }
  .move-n {
    font-size: 10px;
    text-anchor: middle;
  }
  .move-n.back {
    fill: #2f7de1;
  }
  .move-n.forward {
    fill: #1f9d63;
  }
  .fill-tree,
  .fill-net {
    fill: color-mix(in srgb, CanvasText 55%, transparent);
  }
  .fill-back {
    fill: #2f7de1;
  }
  .fill-forward {
    fill: #1f9d63;
  }
  .weight {
    font-size: 10px;
    fill: CanvasText;
    opacity: 0.7;
    text-anchor: middle;
  }
  .card {
    cursor: pointer;
  }
  .frame {
    fill: Canvas;
    stroke: color-mix(in srgb, CanvasText 22%, transparent);
  }
  .card.path .frame {
    stroke: CanvasText;
  }
  .card:not(.path) {
    opacity: 0.85;
  }
  .card.inherited .frame {
    stroke-dasharray: 4 3;
  }
  .card.cursor .frame {
    stroke: #2f7de1;
    stroke-width: 2;
    fill: color-mix(in srgb, #2f7de1 10%, Canvas);
  }
  .card.selected .frame {
    stroke: #e8912d;
    stroke-width: 3;
  }
  .card:focus-visible {
    outline: none;
  }
  .card:focus-visible .frame {
    stroke: #e8912d;
    stroke-width: 3;
  }
  .noimg {
    fill: color-mix(in srgb, CanvasText 8%, Canvas);
  }
  .title {
    font-size: 12px;
    fill: CanvasText;
  }
  .card.cursor .title {
    font-weight: 600;
  }
  .host {
    font-size: 10px;
    fill: CanvasText;
    opacity: 0.55;
  }
  .spawn {
    fill: color-mix(in srgb, #2f7de1 18%, Canvas);
  }
  .spawn-t {
    font-size: 10px;
    fill: CanvasText;
    text-anchor: middle;
  }
  .badge {
    fill: #2f7de1;
  }
  .badge-t {
    font-size: 9px;
    fill: white;
    text-anchor: middle;
    font-weight: 600;
  }
</style>
