<!--
  Spike S3: the sessions page graph rendered with Svelte Flow instead of SessionGraph.
  ELK still does the layout, now for every link (routeAll), so Back/Forward and
  same-page links go around the cards. Cards can be dragged; their positions are kept per
  session and view until "Tidy up" lays the graph out again.
-->
<script lang="ts">
  import { SvelteFlow, Controls, MiniMap, Background, Panel, MarkerType, type Node, type Edge } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import type { Row, View, ViewMode } from '@/core/views';
  import { layoutGraph, type GraphLayout } from '../graph-layout';
  import Legend from '../Legend.svelte';
  import FlowCard, { type CardData } from './FlowCard.svelte';
  import FlowEdge, { type LinkData } from './FlowEdge.svelte';

  interface Props {
    view: View;
    mode: ViewMode;
    sessionId: string;
    thumb: (row: Row) => string | undefined;
    spawned?: (row: Row) => number;
    selected?: string;
    height?: number;
    onSelect: (row: Row) => void;
    onOpen: (row: Row) => void;
  }
  let { view, mode, sessionId, thumb, spawned, selected, height, onSelect, onOpen }: Props = $props();

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
    layoutGraph(view, { nodeW: W, nodeH: H, layout: mode === 'network' ? ['net'] : ['tree'], routeAll: true }).then((l) => {
      if (!cancelled) base = l;
    });
    return () => {
      cancelled = true;
    };
  });

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
        data: { row: r, img: thumb(r), kids: spawned?.(r) ?? 0, selected: selected === r.key, onSelect, onOpen },
      };
    });
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
        data: { kind: e.kind, n: e.n, variant, d: e.d, labelX: e.labelX, labelY: e.labelY, routed: !moved[from.key] && !moved[to.key] },
      };
    });
  });

  function keep(dragged: Node[]) {
    const next = { ...moved };
    for (const n of dragged) next[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
    moved = next;
    localStorage.setItem(posKey, JSON.stringify(next));
  }
  // Re-mounting the flow after "Tidy up" fits the fresh layout into view.
  let generation = $state(0);
  function tidy() {
    moved = {};
    localStorage.removeItem(posKey);
    generation++;
  }
  const anyMoved = $derived(Object.keys(moved).length > 0);
</script>

<div class="flow" style:height="{height ?? Math.max(300, Math.round(window.innerHeight * 0.5))}px">
  {#if base}
    {#key generation}
      <SvelteFlow
        bind:nodes
        bind:edges
        {nodeTypes}
        {edgeTypes}
        colorMode="system"
        fitView
        fitViewOptions={{ maxZoom: 1, minZoom: 0.3, padding: 0.08 }}
        minZoom={0.1}
        maxZoom={2.5}
        nodesConnectable={false}
        onnodeclick={({ node }) => onSelect((node.data as CardData).row)}
        onnodedragstop={({ nodes: dragged }) => keep(dragged)}
      >
        <Background gap={24} size={1} />
        <Controls showLock={false} />
        <MiniMap width={150} height={84} pannable zoomable nodeColor={(n) => ((n.data as CardData).row.cursor ? '#2f7de1' : '#9a9a9a')} />
        <Panel position="top-right">
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
  .tidy {
    font: 12px system-ui, sans-serif;
    padding: 3px 10px;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
  }
  .tidy:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .legend {
    margin: 6px 2px 0;
  }
</style>
