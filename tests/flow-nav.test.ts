// Arrow-key navigation between graph cards (src/ui/flow/nav.ts).
import { describe, expect, test } from 'vitest';
import { nextCard } from '@/ui/flow/nav';

// A → B, B → C (up) and B → D (down); D → A is a link back.
const W = 100;
const H = 60;
const nodes = [
  { id: 'A', x: 0, y: 100 },
  { id: 'B', x: 200, y: 100 },
  { id: 'C', x: 400, y: 0 },
  { id: 'D', x: 400, y: 200 },
  { id: 'E', x: 600, y: 210 },
];
const links = [
  { from: 'A', to: 'B' },
  { from: 'B', to: 'C' },
  { from: 'B', to: 'D' },
  { from: 'D', to: 'A' },
];
const go = (from: string, dir: 'left' | 'right' | 'up' | 'down') => nextCard(nodes, links, from, dir, W, H);

describe('nextCard', () => {
  test('right and left follow the links', () => {
    expect(go('A', 'right')).toBe('B');
    expect(go('C', 'left')).toBe('B');
    expect(go('D', 'left')).toBe('B'); // not A: D → A points back, B → D is where it came from
  });
  test('without a link, the nearest card on that side', () => {
    expect(go('D', 'right')).toBe('E');
    expect(go('E', 'left')).toBe('D');
    expect(go('E', 'right')).toBeUndefined();
  });
  test('up and down stay in the column', () => {
    expect(go('C', 'down')).toBe('D');
    expect(go('D', 'up')).toBe('C');
    expect(go('A', 'up')).toBeUndefined();
  });
});
