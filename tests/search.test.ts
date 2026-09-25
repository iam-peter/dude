import { describe, expect, test } from 'vitest';
import { SearchIndex, snippet, type SearchDoc } from '@/search';

const doc = (id: string, p: Partial<SearchDoc> = {}): SearchDoc => ({
  id,
  sessionId: 's1',
  url: `https://example.com/${id}`,
  host: 'example.com',
  firstAt: 1000,
  lastAt: 1000,
  inherited: false,
  ...p,
});

const texts: Record<string, string> = {
  t1: 'The quick brown fox jumps over the lazy dog near the riverbank.',
  t2: 'Recipes for sourdough bread with a long cold fermentation.',
};

function index() {
  const loads: string[] = [];
  const ix = new SearchIndex(async (id) => {
    loads.push(id);
    return texts[id];
  });
  return { ix, loads };
}

describe('search index (F8)', () => {
  const docs = [
    doc('a', { title: 'Fox facts', textId: 't1' }),
    doc('b', { title: 'Baking', textId: 't2', parentId: 'a' }),
    doc('c', { title: 'Search results', query: 'sourdough starter', url: 'https://www.google.com/search?q=sourdough+starter', host: 'www.google.com', parentId: 'b' }),
    doc('d', { title: 'Copy of Baking', textId: 't2', inherited: true }),
  ];

  test('finds words in page text, titles, search terms', async () => {
    const { ix } = index();
    await ix.sync(docs);
    expect(ix.search('riverbank').map((h) => h.doc.id)).toEqual(['a']);
    expect(ix.search('fermentation').map((h) => h.doc.id)).toEqual(['b']);
    expect(ix.search('starter').map((h) => h.doc.id)).toEqual(['c']);
    expect(ix.search('sourdough').map((h) => h.doc.id)[0]).toBe('c'); // search terms outrank body text
  });

  test('prefix match on the last word, fuzzy for longer words', async () => {
    const { ix } = index();
    await ix.sync(docs);
    expect(ix.search('ferment').map((h) => h.doc.id)).toEqual(['b']);
    expect(ix.search('fermentaton').map((h) => h.doc.id)).toEqual(['b']);
  });

  test('one- and two-letter words are not prefix-matched', async () => {
    const { ix } = index();
    await ix.sync([doc('p', { title: 'Page b' }), doc('q', { title: 'Page busy' })]);
    expect(ix.search('page b').map((h) => h.doc.id)).toEqual(['p']);
  });

  test('breadcrumbs continue into the tab a page was opened from', async () => {
    const { ix } = index();
    await ix.sync([doc('x', { title: 'List' }), doc('y', { title: 'Item', sessionId: 's9', parentId: 'x', viaTab: true })]);
    expect(ix.ancestors('y').map((d) => d.id)).toEqual(['x']);
  });

  test('inherited copies are not indexed twice but serve breadcrumbs', async () => {
    const { ix } = index();
    await ix.sync(docs);
    expect(ix.search('baking').map((h) => h.doc.id)).toEqual(['b']);
    expect(ix.ancestors('c').map((d) => d.id)).toEqual(['a', 'b']);
  });

  test('filters: date, host, sessions', async () => {
    const { ix } = index();
    await ix.sync([...docs.slice(0, 2), doc('e', { title: 'Fox den', lastAt: 5000, sessionId: 's2', host: 'wild.org' })]);
    expect(ix.search('fox', { since: 2000 }).map((h) => h.doc.id)).toEqual(['e']);
    expect(ix.search('fox', { host: 'wild' }).map((h) => h.doc.id)).toEqual(['e']);
    expect(ix.search('fox', { sessionIds: new Set(['s1']) }).map((h) => h.doc.id)).toEqual(['a']);
  });

  test('incremental sync: cached index is reused, only changed docs are re-indexed', async () => {
    const first = index();
    await first.ix.sync(docs);
    const cached = first.ix.snapshot();

    const second = index();
    second.ix.restore(cached);
    const changed = [doc('a', { title: 'Fox facts', textId: 't1' }), doc('b', { title: 'Bread baking', textId: 't2', parentId: 'a' })];
    const n = await second.ix.sync(changed);
    expect(n).toBe(1); // only b's title changed; c is gone
    expect(second.loads).toEqual(['t2']);
    expect(second.ix.search('bread baking').map((h) => h.doc.id)).toEqual(['b']);
    expect(second.ix.search('starter')).toEqual([]);
    expect(second.ix.search('riverbank').map((h) => h.doc.id)).toEqual(['a']);
  });

  test('snippet around the first matching term', () => {
    expect(snippet(texts.t1, ['lazy'], 30)).toContain('lazy dog');
    expect(snippet(texts.t1, ['zebra'])).toBeUndefined();
  });
});
