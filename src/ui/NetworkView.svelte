<!--
  Network view for the sidebar (SPEC §5.2): one node per page, left to right (graph-layout.ts),
  inside PanZoom.
-->
<script lang="ts">
  import type { Row, View } from '@/core/views';
  import PanZoom from './PanZoom.svelte';
  import { layoutGraph, type GraphLayout } from './graph-layout';

  interface Props {
    view: View;
    onOpen: (row: Row) => void;
    tooltip: (row: Row) => string;
  }
  let { view, onOpen, tooltip }: Props = $props();

  const NODE_W = 168;
  const NODE_H = 38;

  let layout = $state<GraphLayout | null>(null);
  $effect(() => {
    let cancelled = false;
    layoutGraph(view, { nodeW: NODE_W, nodeH: NODE_H, layout: ['net'] }).then((l) => {
      if (!cancelled) layout = l;
    });
    return () => {
      cancelled = true;
    };
  });

  const focus = $derived.by(() => {
    const n = layout?.nodes.find((x) => view.rows[x.row]?.cursor);
    return n ? { x: n.x, y: n.y, w: NODE_W, h: NODE_H } : undefined;
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
  <PanZoom contentW={layout.width} contentH={layout.height} {focus}>
    <svg width={layout.width} height={layout.height} overflow="visible">
    <defs>
      <marker id="net-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L8,4 L0,8 z" class="arrow" />
      </marker>
    </defs>
    {#each layout.edges as e (e.from + '>' + e.to)}
      <path d={e.d} class="edge" class:back={e.to < e.from} style:stroke-width={1.2 + Math.log2(e.n)} marker-end="url(#net-arrow)" />
      {#if e.n > 1}<text class="weight" x={e.labelX} y={e.labelY - 4}>{e.n}</text>{/if}
    {/each}
    {#each layout.nodes as n (n.row)}
      {@const r = view.rows[n.row]}
      <g class="node" class:cursor={r.cursor} class:path={r.onPath} transform="translate({n.x} {n.y})" role="button" tabindex="0" onclick={() => onOpen(r)} onkeydown={(e) => e.key === 'Enter' && onOpen(r)}>
        <title>{tooltip(r)}</title>
        <rect width={NODE_W} height={NODE_H} rx="7" />
        {#if r.favIconUrl}<image href={r.favIconUrl} x="8" y="11" width="16" height="16" />{:else}<rect class="nofav" x="8" y="11" width="16" height="16" rx="4" />{/if}
        <text class="title" x="31" y="16">{clip(r.title || r.url, 20)}</text>
        <text class="host" x="31" y="30">{clip(host(r.url), 26)}</text>
        {#if r.visits > 1}
          <g transform="translate({NODE_W - 4} 4)">
            <circle r="9" class="badge" />
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
  .edge.back {
    stroke: color-mix(in srgb, #2f7de1 75%, transparent);
    stroke-dasharray: 5 3;
  }
  .arrow {
    fill: color-mix(in srgb, CanvasText 55%, transparent);
  }
  .weight {
    font-size: 10px;
    fill: CanvasText;
    opacity: 0.7;
    text-anchor: middle;
  }
  .node {
    cursor: pointer;
  }
  .node > rect:first-of-type {
    fill: Canvas;
    stroke: color-mix(in srgb, CanvasText 25%, transparent);
  }
  .node.path > rect:first-of-type {
    stroke: CanvasText;
  }
  .node.cursor > rect:first-of-type {
    stroke: #2f7de1;
    stroke-width: 2;
    fill: color-mix(in srgb, #2f7de1 12%, Canvas);
  }
  .node:hover > rect:first-of-type {
    fill: color-mix(in srgb, CanvasText 6%, Canvas);
  }
  .node:focus-visible {
    outline: none;
  }
  .node:focus-visible > rect:first-of-type {
    stroke: #2f7de1;
    stroke-width: 2;
  }
  .nofav {
    fill: color-mix(in srgb, CanvasText 15%, transparent);
  }
  .title {
    font-size: 12px;
    fill: CanvasText;
  }
  .node.cursor .title {
    font-weight: 600;
  }
  .host {
    font-size: 10px;
    fill: CanvasText;
    opacity: 0.55;
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
