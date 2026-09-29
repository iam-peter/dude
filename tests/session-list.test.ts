// Session list grouping and nesting (src/ui/session-list.ts).
import { describe, expect, test } from 'vitest';
import { groupCards } from '@/ui/session-list';
import type { SessionCard } from '@/background/protocol';

const H = 3_600_000;
const NOW = new Date('2026-09-29T18:00:00').getTime();
const card = (id: string, lastAt: number, extra: Partial<SessionCard> = {}): SessionCard => ({ id, open: false, createdAt: lastAt - 60_000, lastAt, visitCount: 1, thumbs: [], ...extra });
const from = (sessionId: string) => ({ spawnedFrom: { sessionId, kind: 'link' as const } });
const flat = (g: ReturnType<typeof groupCards>) => g.map((x) => `${x.label}: ${x.items.map((i) => '·'.repeat(i.depth) + i.card.id).join(' ')}`);

describe('groupCards', () => {
  test('tabs opened from another tab sit below it; a family moves up with its newest tab', () => {
    const cards = [card('child', NOW - 1 * H, from('parent')), card('other', NOW - 2 * H), card('parent', NOW - 3 * H), card('grandchild', NOW - 4 * H, from('child'))];
    expect(flat(groupCards(cards, 'day', NOW))).toEqual(['Today: parent ·child ··grandchild other']);
  });

  test('a parent in another group leaves the child at the top level', () => {
    const cards = [card('child', NOW - 1 * H, from('parent')), card('parent', NOW - 30 * H)];
    expect(flat(groupCards(cards, 'day', NOW))).toEqual(['Today: child', 'Yesterday: parent']);
  });

  test('by site', () => {
    const cards = [card('a', NOW - 1 * H, { host: 'heise.de' }), card('b', NOW - 2 * H, { host: 'github.com' }), card('c', NOW - 3 * H, { host: 'heise.de', ...from('a') })];
    expect(flat(groupCards(cards, 'site', NOW))).toEqual(['heise.de: a ·c', 'github.com: b']);
  });
});
