<!--
  Legend for the graphs (SessionGraph, GraphView, NetworkView): only the kinds of lines and
  marks that the current view actually shows. Swatches use the same dash patterns and colours
  as the graphs.
-->
<script lang="ts">
  import type { View, ViewMode } from '@/core/views';

  interface Props {
    view: View;
    mode: ViewMode;
    /** Some page shows the ↗ badge for tabs opened from it (sessions page cards). */
    spawned?: boolean;
    /** Collapsed behind a "What the lines mean" toggle (narrow sidebar). */
    collapsible?: boolean;
  }
  let { view, mode, spawned = false, collapsible = false }: Props = $props();

  type Swatch = { line: string; dash?: string; arrow?: boolean } | { mark: string };
  interface Item {
    swatch: Swatch;
    label: string;
  }

  const items = $derived.by((): Item[] => {
    const out: Item[] = [];
    const net = mode === 'network';
    const tree = view.links.filter((l) => l.kind === 'tree');
    const edgeOf = (to: number) => view.rows[to]?.edge;
    if (net) {
      if (view.links.some((l) => l.to > l.from)) out.push({ swatch: { line: 'var(--lg-tree)', arrow: true }, label: 'went to' });
      if (view.links.some((l) => l.to < l.from)) out.push({ swatch: { line: 'var(--lg-back)', dash: '5 3', arrow: true }, label: 'went back to a page seen earlier' });
      if (view.links.some((l) => (l.n ?? 1) > 1)) out.push({ swatch: { mark: '2' }, label: 'times taken; thicker = more' });
    } else {
      if (tree.some((l) => !['jump', 'unknown'].includes(edgeOf(l.to) ?? ''))) out.push({ swatch: { line: 'var(--lg-tree)' }, label: 'followed a link or form' });
      if (tree.some((l) => edgeOf(l.to) === 'jump')) out.push({ swatch: { line: 'var(--lg-tree)', dash: '5 3' }, label: 'typed address, bookmark or search (no link)' });
      if (tree.some((l) => edgeOf(l.to) === 'unknown')) out.push({ swatch: { line: 'var(--lg-tree)', dash: '1 3' }, label: 'not recorded how (e.g. while dude was off)' });
      if (view.links.some((l) => l.kind === 'same')) out.push({ swatch: { line: 'var(--lg-same)', dash: '2 3' }, label: 'same page again' });
      if (view.links.some((l) => l.kind === 'back')) out.push({ swatch: { line: 'var(--lg-back)', arrow: true }, label: 'Back, numbered in order' });
      if (view.links.some((l) => l.kind === 'forward')) out.push({ swatch: { line: 'var(--lg-forward)', arrow: true }, label: 'Forward' });
    }
    if (view.rows.some((r) => r.visits > 1)) out.push({ swatch: { mark: '×2' }, label: 'visited more than once' });
    if (view.rows.some((r) => r.inherited)) out.push({ swatch: { mark: 'inherited' }, label: 'copied from the tab this one was duplicated from' });
    if (spawned) out.push({ swatch: { mark: '↗1' }, label: 'tabs opened from this page' });
    return out;
  });
</script>

{#snippet list()}
  <ul class="legend">
    {#each items as it (it.label)}
      <li>
        {#if 'line' in it.swatch}
          <svg width="30" height="10" aria-hidden="true">
            <line x1="1" y1="5" x2={it.swatch.arrow ? 23 : 29} y2="5" stroke={it.swatch.line} stroke-width="1.6" stroke-dasharray={it.swatch.dash} />
            {#if it.swatch.arrow}<path d="M22,1.5 L29,5 L22,8.5 z" fill={it.swatch.line} />{/if}
          </svg>
        {:else if it.swatch.mark === 'inherited'}
          <svg width="30" height="10" aria-hidden="true"><rect x="8" y="1" width="14" height="8" rx="2" fill="none" stroke="var(--lg-tree)" stroke-dasharray="3 2" /></svg>
        {:else}
          <span class="mark">{it.swatch.mark}</span>
        {/if}
        <span>{it.label}</span>
      </li>
    {/each}
  </ul>
{/snippet}

{#if items.length}
  {#if collapsible}
    <details class="wrap">
      <summary>What the lines mean</summary>
      {@render list()}
    </details>
  {:else}
    <div class="wrap">{@render list()}</div>
  {/if}
{/if}

<style>
  .wrap {
    --lg-tree: color-mix(in srgb, CanvasText 55%, transparent);
    --lg-same: color-mix(in srgb, CanvasText 35%, transparent);
    --lg-back: #2f7de1;
    --lg-forward: #1f9d63;
    font-size: 11px;
    color: color-mix(in srgb, CanvasText 75%, transparent);
  }
  summary {
    cursor: pointer;
    opacity: 0.8;
  }
  .legend {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .mark {
    min-width: 30px;
    text-align: center;
    font-size: 10px;
    font-weight: 600;
  }
</style>
