<!--
  Network view (SPEC §5.2): one node per page, laid out left to right by ELK
  (network-layout.ts). Drag to pan, wheel to zoom, "fit" to see everything.
-->
<script lang="ts">
  import type { Row, View } from '@/core/views';
  import { layoutNetwork, NODE_H, NODE_W, type NetworkLayout } from './network-layout';

  interface Props {
    view: View;
    onOpen: (row: Row) => void;
    tooltip: (row: Row) => string;
  }
  let { view, onOpen, tooltip }: Props = $props();

  let layout = $state<NetworkLayout | null>(null);
  let width = $state(300);
  let scale = $state(1);
  let tx = $state(0);
  let ty = $state(0);
  let placed = false;
  let el: HTMLDivElement;

  $effect(() => {
    const v = view;
    let cancelled = false;
    layoutNetwork(v).then((l) => {
      if (cancelled) return;
      layout = l;
      if (!placed) readable();
      else if (!cursorVisible()) showCursor();
    });
    return () => {
      cancelled = true;
    };
  });

  const MIN = 0.3;
  const MAX = 2;
  const READABLE = 0.8; // below this the node titles get hard to read in a sidebar
  const height = $derived(layout ? Math.min(Math.max(100, layout.height * scale + 16), window.innerHeight * 0.7) : 100);

  /** Everything in view, however small (the "fit" button). */
  function fit() {
    if (!layout) return;
    scale = Math.max(MIN, Math.min(1, (width - 16) / layout.width));
    tx = 8;
    ty = 8;
  }

  /** Start readable: fit if the graph is narrow enough, else pan to the current page. */
  function readable() {
    if (!layout) return;
    scale = Math.max(READABLE, Math.min(1, (width - 16) / layout.width));
    ty = 8;
    tx = 8;
    if (!cursorVisible()) showCursor();
    placed = true;
  }

  function cursorNode() {
    return layout?.nodes.find((n) => view.rows[n.row]?.cursor);
  }
  function cursorVisible() {
    const n = cursorNode();
    if (!n) return true;
    const x0 = tx + n.x * scale;
    return x0 >= 0 && x0 + NODE_W * scale <= width;
  }
  /** Put the current page at about two thirds of the width (time runs left to right). */
  function showCursor() {
    const n = cursorNode();
    if (!n) return;
    tx = Math.min(8, width * 0.66 - (n.x + NODE_W / 2) * scale);
  }

  function zoomAt(factor: number, cx: number, cy: number) {
    const next = Math.max(MIN, Math.min(MAX, scale * factor));
    tx = cx - ((cx - tx) * next) / scale;
    ty = cy - ((cy - ty) * next) / scale;
    scale = next;
  }

  // Wheel must be non-passive to keep the sidebar from scrolling while zooming.
  $effect(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  let drag: { x: number; y: number; tx: number; ty: number; moved: boolean } | null = null;
  function down(e: PointerEvent) {
    drag = { x: e.clientX, y: e.clientY, tx, ty, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    tx = drag.tx + dx;
    ty = drag.ty + dy;
  }
  function up() {
    setTimeout(() => (drag = null)); // let the click handler see `moved`
  }
  function click(row: Row) {
    if (drag?.moved) return;
    onOpen(row);
  }

  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  function host(url: string) {
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  }
</script>

<div class="wrap" bind:clientWidth={width}>
  <div class="tools">
    <span class="hint">drag to pan · wheel to zoom</span>
    <button title="Zoom out" onclick={() => zoomAt(1 / 1.25, width / 2, height / 2)}>−</button>
    <button title="Fit to width" onclick={fit}>fit</button>
    <button title="Zoom in" onclick={() => zoomAt(1.25, width / 2, height / 2)}>+</button>
  </div>
  <div
    class="canvas"
    bind:this={el}
    style:height="{height}px"
    role="presentation"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
  >
    {#if layout}
      <svg width="100%" height="100%">
        <defs>
          <marker id="net-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" class="arrow" />
          </marker>
        </defs>
        <g transform="translate({tx} {ty}) scale({scale})">
          {#each layout.edges as e (e.from + '>' + e.to)}
            <path d={e.d} class="edge" class:back={e.to < e.from} style:stroke-width={1.2 + Math.log2(e.n)} marker-end="url(#net-arrow)" />
            {#if e.n > 1}<text class="weight" x={e.labelX} y={e.labelY - 4}>{e.n}</text>{/if}
          {/each}
          {#each layout.nodes as n (n.row)}
            {@const r = view.rows[n.row]}
            <g
              class="node"
              class:cursor={r.cursor}
              class:path={r.onPath}
              transform="translate({n.x} {n.y})"
              role="button"
              tabindex="0"
              onclick={() => click(r)}
              onkeydown={(e) => e.key === 'Enter' && onOpen(r)}
            >
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
        </g>
      </svg>
    {/if}
  </div>
</div>

<style>
  .wrap {
    --accent: #2f7de1;
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 2px;
    margin: 0 2px 4px;
  }
  .hint {
    flex: 1;
    font-size: 11px;
    opacity: 0.55;
  }
  .tools button {
    all: unset;
    cursor: pointer;
    font-size: 11px;
    padding: 1px 7px;
    border-radius: 5px;
    background: color-mix(in srgb, CanvasText 10%, Canvas);
  }
  .canvas {
    overflow: hidden;
    border-radius: 8px;
    background: color-mix(in srgb, CanvasText 3%, Canvas);
    cursor: grab;
    touch-action: none;
  }
  .canvas:active {
    cursor: grabbing;
  }
  .edge {
    fill: none;
    stroke: color-mix(in srgb, CanvasText 40%, transparent);
  }
  .edge.back {
    stroke: color-mix(in srgb, var(--accent) 75%, transparent);
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
    stroke-width: 1;
  }
  .node.path > rect:first-of-type {
    stroke: CanvasText;
  }
  .node.cursor > rect:first-of-type {
    stroke: var(--accent);
    stroke-width: 2;
    fill: color-mix(in srgb, var(--accent) 12%, Canvas);
  }
  .node:hover > rect:first-of-type {
    fill: color-mix(in srgb, CanvasText 6%, Canvas);
  }
  .node:focus-visible {
    outline: none;
  }
  .node:focus-visible > rect:first-of-type {
    stroke: var(--accent);
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
    fill: var(--accent);
  }
  .badge-t {
    font-size: 9px;
    fill: white;
    text-anchor: middle;
    font-weight: 600;
  }
</style>
