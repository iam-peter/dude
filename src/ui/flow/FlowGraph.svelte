<!--
  The sessions page graph (SPEC §8.3, S3): ELK lays out every link, so Back/Forward and
  same-page lines go around the cards, and Svelte Flow draws it. Cards can be dragged;
  their positions are kept per session and view until "Tidy up" lays the graph out again.
-->
<script lang="ts">
  import { SvelteFlow, Controls, MiniMap, Background, Panel, MarkerType, type Node, type Edge } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import type { Row, View, ViewMode } from '@/core/views';
  import { layoutGraph, type GraphLayout } from '../graph-layout';
  import Legend from '../Legend.svelte';
  import FlowCard, { type CardData } from './FlowCard.svelte';
  import FlowEdge, { type LinkData } from './FlowEdge.svelte';
  import FlowFocus from './FlowFocus.svelte';
  import { nextCard, type Dir } from './nav';
  import { clock, later, PAUSE_LABEL_MS } from './time';

  interface Props {
    view: View;
    mode: ViewMode;
    sessionId: string;
    thumb: (row: Row) => string | undefined;
    spawned?: (row: Row) => number;
    selected?: string;
    height?: number;
    /** Tree views: fold straight runs (views.ts foldRuns), switched here. */
    folding?: boolean;
    onFolding?: (on: boolean) => void;
    onUnfold?: (row: Row) => void;
    onSelect: (row: Row) => void;
    onOpen: (row: Row) => void;
  }
  let { view, mode, sessionId, thumb, spawned, selected, height, folding, onFolding, onUnfold, onSelect, onOpen }: Props = $props();
  // Double-click and Enter open a page, or open up a fold.
  const activate = (r: Row) => (r.fold ? onUnfold?.(r) : onOpen(r));

  const W = 184;
  const H = 138;
  const nodeTypes = { card: FlowCard };
  const edgeTypes = { link: FlowEdge };
  const COLORS: Record<string, string> = { tree: '#8a8a8a', net: '#8a8a8a', back: '#2f7de1', forward: '#1f9d63' };

  type Pos = { x: number; y: number };
  const posKey = $derived(`dude.flow.pos.${sessionId}.${mode}`);
  let moved = $state<Record<string, Pos>>({});
  $effect(() => {
    moved = JSON.parse(localStorage.getItem(posKey) ?? '{}');
  });

  let base = $state<GraphLayout | null>(null);
  $effect(() => {
    let cancelled = false;
    layoutGraph(view, { nodeW: W, nodeH: H, layout: mode === 'network' ? ['net'] : ['tree', 'same', 'back', 'forward'] }).then((l) => {
      if (!cancelled) base = l;
    });
    return () => {
      cancelled = true;
    };
  });

  // Cards being dragged: their lines follow them right away, not only after the drop.
  let dragging = $state<ReadonlySet<string>>(new Set());
  const loose = (id: string) => !!moved[id] || dragging.has(id);

  let nodes = $state.raw<Node<CardData>[]>([]);
  let edges = $state.raw<Edge<LinkData>[]>([]);
  $effect(() => {
    if (!base) return;
    nodes = base.nodes.map((n) => {
      const r = view.rows[n.row];
      return {
        id: r.key,
        type: 'card',
        position: moved[r.key] ?? { x: n.x, y: n.y },
        width: W,
        height: H,
        selectable: false,
        data: { row: r, img: thumb(r), kids: spawned?.(r) ?? 0, selected: selected === r.key, time: mode === 'network' ? undefined : clock(r.at), onSelect, onOpen: activate },
      };
    });
  });
  // Separate from the cards, so starting a drag doesn't rebuild the card being dragged.
  $effect(() => {
    if (!base) return;
    edges = base.edges.map((e, i) => {
      const from = view.rows[e.from];
      const to = view.rows[e.to];
      const variant = mode === 'network' ? (e.to < e.from ? 'back' : undefined) : e.kind === 'tree' && (to.edge === 'jump' || to.edge === 'unknown') ? to.edge : undefined;
      const color = variant === 'back' ? COLORS.back : COLORS[e.kind];
      return {
        id: `${e.kind}:${i}`,
        source: from.key,
        target: to.key,
        type: 'link',
        selectable: false,
        markerEnd: e.kind === 'same' ? undefined : { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        data: {
          kind: e.kind,
          n: e.n,
          variant,
          d: e.d,
          labelX: e.labelX,
          labelY: e.labelY,
          routed: !loose(from.key) && !loose(to.key),
          gap: e.kind === 'tree' && (to.pause ?? 0) >= PAUSE_LABEL_MS ? later(to.pause!) : undefined,
        },
      };
    });
  });

  function keep(dragged: Node[]) {
    dragging = new Set();
    const next = { ...moved };
    for (const n of dragged) next[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
    moved = next;
    localStorage.setItem(posKey, JSON.stringify(next));
  }
  // Re-mounting the flow after "Tidy up" fits the fresh layout into view.
  let generation = $state(0);
  function tidy() {
    moved = {};
    dragging = new Set();
    localStorage.removeItem(posKey);
    generation++;
  }
  const anyMoved = $derived(Object.keys(moved).length > 0);
  // The minimap covers the bottom-right corner, where the current page usually is.
  let showMap = $state(localStorage.getItem('dude.flow.map') === '1');
  $effect(() => localStorage.setItem('dude.flow.map', showMap ? '1' : '0'));

  // Arrow keys move the selection between cards (nav.ts), Enter opens the page.
  const DIRS: Record<string, Dir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  let focusTarget = $state<{ x: number; y: number; seq: number }>();
  function key(e: KeyboardEvent) {
    if (!base) return;
    const current = view.rows.find((r) => r.key === selected) ?? view.rows.find((r) => r.cursor);
    if (!current) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      activate(current);
      return;
    }
    const dir = DIRS[e.key];
    if (!dir) return;
    e.preventDefault();
    const cards = nodes.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));
    const links = base.edges.map((l) => ({ from: view.rows[l.from].key, to: view.rows[l.to].key }));
    const next = nextCard(cards, links, current.key, dir, W, H);
    const row = next && view.rows.find((r) => r.key === next);
    const card = next && cards.find((c) => c.id === next);
    if (!row || !card) return;
    onSelect(row);
    focusTarget = { x: card.x + W / 2, y: card.y + H / 2, seq: (focusTarget?.seq ?? 0) + 1 };
  }

  // Start readable around the current page (about two steps either side) rather than
  // squeezing a long session into view; the ⛶ button still shows everything.
  const start = $derived.by(() => {
    if (!base) return undefined;
    const cur = base.nodes.find((n) => view.rows[n.row]?.cursor) ?? base.nodes.at(-1);
    if (!cur) return undefined;
    const reach = 2.5 * (W + 110);
    return base.nodes.filter((n) => Math.abs(n.x - cur.x) <= reach).map((n) => ({ id: view.rows[n.row].key }));
  });
</script>

<p class="hint">click a page for details · double-click or Enter opens it · arrow keys move between pages · drag cards to arrange them</p>
<!-- role="application": the graph handles its own arrow keys; Svelte's check doesn't count it as interactive. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div class="flow" role="application" aria-label="Session graph" tabindex="0" onkeydown={key} style:height="{height ?? Math.max(300, Math.round(window.innerHeight * 0.5))}px">
  {#if base}
    {#key generation}
      <SvelteFlow
        bind:nodes
        bind:edges
        {nodeTypes}
        {edgeTypes}
        colorMode="system"
        fitView
        fitViewOptions={{ nodes: start, maxZoom: 0.9, minZoom: 0.45, padding: 0.1 }}
        minZoom={0.1}
        maxZoom={2.5}
        nodesConnectable={false}
        onnodeclick={({ node }) => onSelect((node.data as CardData).row)}
        onnodedragstart={({ nodes: dragged }) => (dragging = new Set(dragged.map((n) => n.id)))}
        onnodedragstop={({ nodes: dragged }) => keep(dragged)}
      >
        <FlowFocus target={focusTarget} />
        <Background gap={24} size={1} />
        <Controls showLock={false} />
        {#if showMap}<MiniMap width={150} height={84} pannable zoomable nodeColor={(n) => ((n.data as CardData).row.cursor ? '#2f7de1' : '#9a9a9a')} />{/if}
        <Panel position="top-right">
          {#if mode !== 'network' && onFolding}
            <button class="tidy" aria-pressed={folding} class:on={folding} onclick={() => onFolding(!folding)} title="Fold straight runs of pages and consent or login bounces into one card; double-click a fold to open it">Fold</button>
          {/if}
          <button class="tidy" aria-pressed={showMap} class:on={showMap} onclick={() => (showMap = !showMap)} title="Show an overview map of the whole graph">Map</button>
          <button class="tidy" onclick={tidy} disabled={!anyMoved} title="Lay the graph out again, forgetting the cards you moved">Tidy up</button>
        </Panel>
      </SvelteFlow>
    {/key}
  {/if}
</div>
<div class="legend"><Legend {view} {mode} spawned={view.rows.some((r) => (spawned?.(r) ?? 0) > 0)} /></div>

<style>
  .flow {
    border-radius: 8px;
    overflow: hidden;
    background: color-mix(in srgb, CanvasText 3%, Canvas);
    --xy-background-color: transparent;
  }
  .flow:focus-visible {
    outline: 2px solid #2f7de1;
    outline-offset: 2px;
  }
  .hint {
    margin: 0 2px 4px;
    font-size: 11px;
    opacity: 0.55;
  }
  .tidy {
    font: 12px system-ui, sans-serif;
    padding: 3px 10px;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
  }
  .tidy.on {
    background: color-mix(in srgb, #2f7de1 16%, Canvas);
    border-color: #2f7de1;
  }
  .tidy:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .legend {
    margin: 6px 2px 0;
  }
</style>
