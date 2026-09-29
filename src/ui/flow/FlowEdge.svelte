<!--
  A graph link as a Svelte Flow edge (spike S3). While both ends sit where ELK put them it
  draws ELK's route, which goes around the cards; once a card has been dragged it falls
  back to a plain curve between the current positions, until "Tidy up" lays out again.
-->
<script lang="ts" module>
  import type { Link } from '@/core/views';

  export interface LinkData extends Record<string, unknown> {
    kind: Link['kind'];
    n: number;
    /** Links to a page shown earlier (network) or reached without a link (tree). */
    variant?: 'back' | 'jump' | 'unknown';
    /** ELK's path, valid while `routed`. */
    d: string;
    labelX: number;
    labelY: number;
    routed: boolean;
    /** "2 h later": a long pause before the page this link leads to. */
    gap?: string;
  }
</script>

<script lang="ts">
  import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/svelte';

  let { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data: raw }: EdgeProps = $props();
  const data = $derived(raw as LinkData); // FlowGraph always sets it

  const curve = $derived(getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }));
  const path = $derived(data.routed ? data.d : curve[0]);
  const labelX = $derived(data.routed ? data.labelX : curve[1]);
  const labelY = $derived(data.routed ? data.labelY - 5 : curve[2]);
  // Moves carry their order; the network its counts.
  const label = $derived(data.gap ?? (data.kind === 'back' || data.kind === 'forward' ? String(data.n) : data.n > 1 ? String(data.n) : undefined));
</script>

<BaseEdge
  {id}
  {path}
  {markerEnd}
  {label}
  {labelX}
  {labelY}
  class="link {data.kind} {data.variant ?? ''}"
  style="stroke-width: {data.kind === 'net' || data.kind === 'tree' ? 1.3 + Math.log2(data.n) : 1.4}px"
/>

<style>
  :global(.svelte-flow__edge-path.link) {
    fill: none;
    stroke: color-mix(in srgb, CanvasText 45%, transparent);
  }
  /* Dash patterns and colours as in Legend.svelte. */
  :global(.svelte-flow__edge-path.link.jump) {
    stroke-dasharray: 5 3;
  }
  :global(.svelte-flow__edge-path.link.unknown) {
    stroke-dasharray: 1 3;
  }
  :global(.svelte-flow__edge-path.link.same) {
    stroke: color-mix(in srgb, CanvasText 30%, transparent);
    stroke-dasharray: 2 3;
  }
  :global(.svelte-flow__edge-path.link.back) {
    stroke: #2f7de1;
  }
  :global(.svelte-flow__edge-path.link.net.back) {
    stroke-dasharray: 5 3;
  }
  :global(.svelte-flow__edge-path.link.forward) {
    stroke: #1f9d63;
  }
</style>
