<!--
  GraphView (F7): renders the Tree and Tree + moves views (src/core/views.ts) as rows plus
  an SVG overlay; the Network view has its own left-to-right layout (NetworkView.svelte).
  Narrow-panel layout: one row per node in visit order; tree connectors in a left gutter
  indented by depth; same-page links, back/forward moves and network edges as arcs in a
  right gutter. Swappable for a premade graph library later: it only needs rows, links
  and the two callbacks.
-->
<script lang="ts">
  import type { Link, Row, View, ViewMode } from '@/core/views';

  interface Props {
    view: View;
    mode: ViewMode;
    onOpen: (row: Row) => void;
    tooltip: (row: Row) => string;
    badge?: (row: Row) => { text: string; title: string; onClick: () => void } | undefined;
    /** Row to point out (context menu "Show where I came from"). */
    highlight?: string;
  }
  let { view, mode, onOpen, tooltip, badge, highlight }: Props = $props();

  let rowEls: Record<string, HTMLElement> = {};
  $effect(() => {
    if (highlight) rowEls[highlight]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  const ROW_H = 30;
  const PAD = 10;
  const GUTTER_R = 44;

  const maxDepth = $derived(Math.max(0, ...view.rows.map((r) => r.depth)));
  const indent = $derived(maxDepth === 0 ? 0 : Math.min(14, 140 / maxDepth));
  const dotX = (r: Row) => PAD + r.depth * indent;
  const y = (i: number) => i * ROW_H + ROW_H / 2;
  const height = $derived(Math.max(ROW_H, view.rows.length * ROW_H));

  let width = $state(300);
  const arcX = $derived(width - 6);

  function treePath(l: Link) {
    const p = view.rows[l.from];
    const c = view.rows[l.to];
    return `M ${dotX(p)} ${y(l.from)} V ${y(l.to)} H ${dotX(c)}`;
  }

  /** Arc in the right gutter, bulging left in proportion to the rows it spans. */
  function arcPath(l: Link) {
    const y1 = y(l.from);
    const y2 = y(l.to);
    const span = Math.abs(l.to - l.from);
    const bulge = Math.min(GUTTER_R - 8, 8 + span * 6);
    return `M ${arcX} ${y1} C ${arcX - bulge} ${y1}, ${arcX - bulge} ${y2}, ${arcX} ${y2}`;
  }

  const moves = $derived(view.links.filter((l) => l.kind === 'back' || l.kind === 'forward'));
  const lastMove = $derived(Math.max(0, ...moves.map((l) => l.n ?? 0)));

  function host(url: string) {
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  }
</script>

<div class="graph" style:height="{height}px" bind:clientWidth={width}>
  <svg width={width} height={height} aria-hidden="true">
    <defs>
      <marker id="arrow-back" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M0,0 L6,3 L0,6 z" class="back-fill" />
      </marker>
      <marker id="arrow-forward" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M0,0 L6,3 L0,6 z" class="forward-fill" />
      </marker>
    </defs>

    {#each view.links as l (l.kind + l.from + '-' + l.to + '-' + (l.n ?? ''))}
      {#if l.kind === 'tree'}
        <path d={treePath(l)} class="tree edge-{view.rows[l.to].edge}" class:path={view.rows[l.to].onPath} />
      {:else if l.kind === 'same'}
        <path d={arcPath(l)} class="same" />
      {:else if l.kind === 'back' || l.kind === 'forward'}
        <path
          d={arcPath(l)}
          class={l.kind}
          marker-end="url(#arrow-{l.kind})"
          style:opacity={0.25 + 0.75 * ((l.n ?? 0) / (lastMove || 1))}
        />
      {/if}
    {/each}

    {#each view.rows as r, i (r.key)}
      <circle cx={dotX(r)} cy={y(i)} r={r.cursor ? 5.5 : 4} class="dot" class:cursor={r.cursor} class:path={r.onPath} class:inherited={r.inherited} />
    {/each}
  </svg>

  {#each view.rows as r, i (r.key)}
    {@const b = badge?.(r)}
    <div
      bind:this={rowEls[r.key]}
      class="row"
      class:highlight={highlight === r.key}
      class:cursor={r.cursor}
      class:off={!r.onPath}
      class:inherited={r.inherited}
      style:top="{i * ROW_H}px"
      style:left="{dotX(r) + 10}px"
      style:right="{GUTTER_R}px"
    >
      <button class="open" title={tooltip(r)} onclick={() => onOpen(r)}>
        {#if r.favIconUrl}<img src={r.favIconUrl} alt="" width="16" height="16" />{:else}<span class="nofav"></span>{/if}
        <span class="title">{r.title || r.url}</span>
        {#if r.visits > 1}<span class="count">×{r.visits}</span>{/if}
        <span class="host">{host(r.url)}</span>
      </button>
      {#if b}<button class="badge" title={b.title} onclick={b.onClick}>{b.text}</button>{/if}
    </div>
  {/each}
</div>

<style>
  .graph {
    position: relative;
    --tree: color-mix(in srgb, CanvasText 35%, transparent);
    --accent: #2f7de1;
    --back: #2f7de1;
    --forward: #1f9d63;
  }
  svg {
    position: absolute;
    inset: 0;
    overflow: visible;
  }
  path {
    fill: none;
  }
  .tree {
    stroke: var(--tree);
    stroke-width: 1.2;
  }
  .tree.path {
    stroke: CanvasText;
    stroke-width: 1.6;
  }
  .tree.edge-jump {
    stroke-dasharray: 4 3;
  }
  .tree.edge-unknown {
    stroke-dasharray: 1 3;
  }
  .same {
    stroke: color-mix(in srgb, CanvasText 25%, transparent);
    stroke-dasharray: 2 3;
  }
  .back {
    stroke: var(--back);
    stroke-width: 1.4;
  }
  .forward {
    stroke: var(--forward);
    stroke-width: 1.4;
  }
  .back-fill {
    fill: var(--back);
  }
  .forward-fill {
    fill: var(--forward);
  }
  .dot {
    fill: Canvas;
    stroke: var(--tree);
    stroke-width: 1.5;
  }
  .dot.path {
    fill: CanvasText;
    stroke: CanvasText;
  }
  .dot.cursor {
    fill: var(--accent);
    stroke: var(--accent);
  }
  .dot.inherited {
    stroke-dasharray: 2 2;
  }
  .row {
    position: absolute;
    height: 30px;
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .open {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1;
    padding: 2px 6px;
    border-radius: 6px;
  }
  .open:hover {
    background: color-mix(in srgb, CanvasText 8%, transparent);
  }
  .open:focus-visible {
    outline: 2px solid var(--accent);
  }
  .row.cursor .open {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }
  .row.highlight .open {
    outline: 2px solid #e8912d;
    background: color-mix(in srgb, #e8912d 16%, transparent);
  }
  .row.off .open {
    opacity: 0.72;
  }
  .row.inherited .title {
    font-style: italic;
  }
  img,
  .nofav {
    width: 16px;
    height: 16px;
    flex: none;
  }
  .nofav {
    border-radius: 4px;
    background: color-mix(in srgb, CanvasText 15%, transparent);
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row.cursor .title {
    font-weight: 600;
  }
  .count {
    font-size: 11px;
    opacity: 0.7;
    flex: none;
  }
  .host {
    font-size: 11px;
    opacity: 0.55;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: none;
  }
  .badge {
    all: unset;
    cursor: pointer;
    font-size: 11px;
    padding: 1px 5px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    flex: none;
  }
  .badge:hover {
    background: color-mix(in srgb, var(--accent) 30%, transparent);
  }
</style>
