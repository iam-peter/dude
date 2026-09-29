// Left-to-right layout of a derived View with ELK's layered algorithm (F5, F7).
// Nodes keep first-visit order ("model order"), so time runs left to right and edges that
// close a cycle are the ones ELK reverses. ELK lays out and routes the `layout` link kinds,
// so their lines go around the nodes; other links are left out of the result.

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
}

// ELK is ~1.4 MB; load it only when a graph is first shown.
let elk: Promise<Elk> | undefined;
const getElk = () => (elk ??= import('elkjs/lib/elk.bundled.js').then((m) => new m.default()));

const OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  // Orthogonal: every link gets its own lane and its own point on a card's side, where
  // splines bundled several into one spot (spike S3, docs/S3-FINDINGS.md).
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
  'elk.layered.spacing.nodeNodeBetweenLayers': '110',
  'elk.spacing.nodeNode': '50',
  'elk.spacing.edgeNode': '28',
  'elk.spacing.edgeEdge': '14',
  'elk.layered.spacing.edgeNodeBetweenLayers': '28',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
  'elk.padding': '[top=12,left=12,bottom=12,right=12]',
};

interface Pt {
  x: number;
  y: number;
}

/** Orthogonal route with rounded corners. */
function roundedPath(pts: Pt[], radius = 10): string {
  const p = (q: Pt) => `${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
  let d = `M ${p(pts[0])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    const r = Math.min(radius, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
    const towards = (from: Pt, to: Pt) => {
      const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
      return { x: from.x + ((to.x - from.x) * r) / len, y: from.y + ((to.y - from.y) * r) / len };
    };
    d += ` L ${p(towards(b, a))} Q ${p(b)}, ${p(towards(b, c))}`;
  }
  return `${d} L ${p(pts[pts.length - 1])}`;
}

/** Point halfway along a polyline. */
function polyMid(pts: Pt[]): Pt {
  const seg = pts.slice(1).map((q, i) => Math.hypot(q.x - pts[i].x, q.y - pts[i].y));
  let left = seg.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i]) {
      const t = seg[i] ? left / seg[i] : 0;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
    }
    left -= seg[i];
  }
  return pts[pts.length - 1];
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
    const pts = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint];
    const mid = polyMid(pts);
    edges.push({ from: link.from, to: link.to, kind: link.kind, n: link.n ?? 1, d: roundedPath(pts), labelX: mid.x, labelY: mid.y });
  });

  return { width: graph.width ?? 0, height: graph.height ?? 0, nodeW, nodeH, nodes, edges };
}


