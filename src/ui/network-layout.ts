// Left-to-right layout of the Network view with ELK's layered algorithm (F5, F7).
// Nodes keep first-visit order ("model order"), so time runs left to right and edges that
// close a cycle — returning to an earlier page — are the ones ELK reverses.

import type { ELK as Elk, ElkNode } from 'elkjs/lib/elk-api';
import type { View } from '@/core/views';

export const NODE_W = 168;
export const NODE_H = 38;

export interface PlacedNode {
  row: number;
  x: number;
  y: number;
}

export interface PlacedEdge {
  from: number;
  to: number;
  n: number;
  d: string; // SVG path
  labelX: number;
  labelY: number;
}

export interface NetworkLayout {
  width: number;
  height: number;
  nodes: PlacedNode[];
  edges: PlacedEdge[];
}

// ELK is ~1.4 MB; load it only when the Network view is first shown.
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

export async function layoutNetwork(view: View): Promise<NetworkLayout> {
  const input: ElkNode = {
    id: 'root',
    layoutOptions: OPTIONS,
    children: view.rows.map((_, i) => ({ id: `n${i}`, width: NODE_W, height: NODE_H })),
    edges: view.links.map((l, i) => ({ id: `e${i}`, sources: [`n${l.from}`], targets: [`n${l.to}`] })),
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
    edges.push({ from: link.from, to: link.to, n: link.n ?? 1, d: pathOf(sec.startPoint, sec.bendPoints ?? [], sec.endPoint), labelX: mid.x, labelY: mid.y });
  });
  return { width: graph.width ?? 0, height: graph.height ?? 0, nodes, edges };
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
