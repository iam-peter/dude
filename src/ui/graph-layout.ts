// Left-to-right layout of a derived View with ELK's layered algorithm (F5, F7).
// Nodes keep first-visit order ("model order"), so time runs left to right and edges that
// close a cycle are the ones ELK reverses. Only the `layout` link kinds shape the graph;
// the others (same-page links, back/forward moves) are drawn on top as curves.

import type { ELK as Elk, ElkNode } from 'elkjs/lib/elk-api';
import type { Link, View } from '@/core/views';

export interface PlacedNode {
  row: number;
  x: number;
  y: number;
}

export interface PlacedEdge {
  from: number;
  to: number;
  kind: Link['kind'];
  n: number;
  d: string; // SVG path
  labelX: number;
  labelY: number;
}

export interface GraphLayout {
  width: number;
  height: number;
  nodeW: number;
  nodeH: number;
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  overlay: PlacedEdge[];
}

// ELK is ~1.4 MB; load it only when a graph is first shown.
let elk: Promise<Elk> | undefined;
const getElk = () => (elk ??= import('elkjs/lib/elk.bundled.js').then((m) => new m.default()));

const OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'SPLINES',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
  'elk.layered.spacing.nodeNodeBetweenLayers': '48',
  'elk.spacing.nodeNode': '18',
  'elk.spacing.edgeNode': '14',
  'elk.padding': '[top=12,left=12,bottom=12,right=12]',
};

interface Pt {
  x: number;
  y: number;
}

export async function layoutGraph(view: View, opts: { nodeW: number; nodeH: number; layout: Link['kind'][] }): Promise<GraphLayout> {
  const { nodeW, nodeH } = opts;
  const shaping = view.links.map((l, i) => ({ l, i })).filter(({ l }) => opts.layout.includes(l.kind));
  const input: ElkNode = {
    id: 'root',
    layoutOptions: OPTIONS,
    children: view.rows.map((_, i) => ({ id: `n${i}`, width: nodeW, height: nodeH })),
    edges: shaping.map(({ l, i }) => ({ id: `e${i}`, sources: [`n${l.from}`], targets: [`n${l.to}`] })),
  };
  const graph = await (await getElk()).layout(input);

  const nodes = (graph.children ?? []).map((c) => ({ row: Number(c.id.slice(1)), x: c.x ?? 0, y: c.y ?? 0 }));
  const edges: PlacedEdge[] = [];
  (graph.edges ?? []).forEach((e) => {
    const link = view.links[Number(e.id.slice(1))];
    const sec = e.sections?.[0];
    if (!link || !sec) return;
    const pts: Pt[] = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint];
    const mid = pts[Math.floor(pts.length / 2)];
    edges.push({ from: link.from, to: link.to, kind: link.kind, n: link.n ?? 1, d: pathOf(sec.startPoint, sec.bendPoints ?? [], sec.endPoint), labelX: mid.x, labelY: mid.y });
  });

  // Overlay links: a curve from the bottom of one node to the bottom of the other.
  const at = new Map(nodes.map((n) => [n.row, n]));
  const overlay: PlacedEdge[] = view.links
    .filter((l) => !opts.layout.includes(l.kind))
    .flatMap((l) => {
      const a = at.get(l.from);
      const b = at.get(l.to);
      if (!a || !b) return [];
      const x1 = a.x + nodeW / 2;
      const y1 = a.y + nodeH;
      const x2 = b.x + nodeW / 2;
      const y2 = b.y + nodeH;
      const dip = 18 + Math.min(60, Math.abs(x2 - x1) / 6);
      const d = `M ${x1} ${y1} C ${x1} ${y1 + dip}, ${x2} ${y2 + dip}, ${x2} ${y2}`;
      return [{ from: l.from, to: l.to, kind: l.kind, n: l.n ?? 1, d, labelX: (x1 + x2) / 2, labelY: Math.max(y1, y2) + dip * 0.75 }];
    });
  const overlayDepth = overlay.length ? 70 : 0;
  return { width: graph.width ?? 0, height: (graph.height ?? 0) + overlayDepth, nodeW, nodeH, nodes, edges, overlay };
}

/** ELK spline bend points are cubic Bézier control points; fall back to a polyline. */
function pathOf(start: Pt, bends: Pt[], end: Pt): string {
  const p = (q: Pt) => `${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
  const rest = [...bends, end];
  if (rest.length % 3 === 0) {
    let d = `M ${p(start)}`;
    for (let i = 0; i < rest.length; i += 3) d += ` C ${p(rest[i])}, ${p(rest[i + 1])}, ${p(rest[i + 2])}`;
    return d;
  }
  return `M ${p(start)} ${rest.map((q) => `L ${p(q)}`).join(' ')}`;
}
