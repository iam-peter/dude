// Keyboard navigation between the cards of a laid-out graph: which card an arrow key
// leads to. Right and Left follow the links first (to where you went next / came from),
// Up and Down go to the nearest card in roughly the same column.

export interface NavNode {
  id: string;
  x: number;
  y: number;
}
export interface NavLink {
  from: string;
  to: string;
}
export type Dir = 'left' | 'right' | 'up' | 'down';

export function nextCard(nodes: NavNode[], links: NavLink[], from: string, dir: Dir, w: number, h: number): string | undefined {
  const at = new Map(nodes.map((n) => [n.id, n]));
  const a = at.get(from);
  if (!a) return undefined;
  const cy = (n: NavNode) => n.y + h / 2;
  const closestY = (ids: string[]) =>
    ids
      .map((id) => at.get(id))
      .filter((n): n is NavNode => !!n && n.id !== from)
      .sort((p, q) => Math.abs(cy(p) - cy(a)) - Math.abs(cy(q) - cy(a)))[0]?.id;

  if (dir === 'right' || dir === 'left') {
    const linked = dir === 'right' ? links.filter((l) => l.from === from).map((l) => l.to) : links.filter((l) => l.to === from).map((l) => l.from);
    // only links that actually point that way (back links go the other way)
    const ahead = linked.filter((id) => {
      const n = at.get(id);
      return n && (dir === 'right' ? n.x > a.x : n.x < a.x);
    });
    const byLink = closestY(ahead);
    if (byLink) return byLink;
    const side = nodes.filter((n) => (dir === 'right' ? n.x > a.x + w / 2 : n.x < a.x - w / 2));
    return side.sort((p, q) => Math.abs(p.x - a.x) + Math.abs(cy(p) - cy(a)) / 2 - (Math.abs(q.x - a.x) + Math.abs(cy(q) - cy(a)) / 2))[0]?.id;
  }
  const column = nodes.filter((n) => n.id !== from && Math.abs(n.x - a.x) < w && (dir === 'down' ? n.y > a.y + h / 2 : n.y < a.y - h / 2));
  return column.sort((p, q) => Math.abs(p.y - a.y) + Math.abs(p.x - a.x) - (Math.abs(q.y - a.y) + Math.abs(q.x - a.x)))[0]?.id;
}
