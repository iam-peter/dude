<!--
  A page card as a Svelte Flow node (spike S3): the same look as SessionGraph's cards.
  A click selects through FlowGraph's onnodeclick (Svelte Flow tells it from a drag), a
  double-click opens through `data`; the handles are only anchors, nothing connects by hand.
-->
<script lang="ts" module>
  import type { Row } from '@/core/views';

  export interface CardData extends Record<string, unknown> {
    row: Row;
    img?: string;
    kids: number;
    selected: boolean;
    onSelect: (row: Row) => void;
    onOpen: (row: Row) => void;
  }
</script>

<script lang="ts">
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';

  let { data }: NodeProps & { data: CardData } = $props();

  const r = $derived(data.row);
  function host(url: string) {
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  }
</script>

<Handle type="target" position={Position.Left} isConnectable={false} />
<div
  class="card"
  class:cursor={r.cursor}
  class:path={r.onPath}
  class:inherited={r.inherited}
  class:selected={data.selected}
  title="{r.title ?? ''}&#10;{r.url}"
  role="button"
  tabindex="-1"
  ondblclick={() => data.onOpen(r)}
  onkeydown={(e) => e.key === 'Enter' && data.onOpen(r)}
>
  <div class="shot">
    {#if data.img}<img src={data.img} alt="" draggable="false" />{:else if r.favIconUrl}<img class="fav" src={r.favIconUrl} alt="" draggable="false" />{/if}
    {#if r.visits > 1}<span class="badge">×{r.visits}</span>{/if}
  </div>
  <div class="text">
    <span class="title">{r.title || r.url}</span>
    <span class="host">{host(r.url)}</span>
  </div>
  {#if data.kids}<span class="spawn" title={data.kids === 1 ? 'A tab was opened from here' : `${data.kids} tabs were opened from here`}>↗{data.kids}</span>{/if}
</div>
<Handle type="source" position={Position.Right} isConnectable={false} />

<style>
  .card {
    position: relative;
    box-sizing: border-box;
    width: 184px;
    height: 138px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, CanvasText 22%, transparent);
    background: Canvas;
    color: CanvasText;
    overflow: hidden;
    cursor: pointer;
    font: 11px/1.3 system-ui, sans-serif;
  }
  .card:not(.path) {
    opacity: 0.85;
  }
  .card.path {
    border-color: CanvasText;
  }
  .card.inherited {
    border-style: dashed;
  }
  .card.cursor {
    border: 2px solid #2f7de1;
    background: color-mix(in srgb, #2f7de1 10%, Canvas);
  }
  .card.selected {
    outline: 3px solid #e8912d;
    outline-offset: -1px;
  }
  .shot {
    position: relative;
    height: 104px;
    background: color-mix(in srgb, CanvasText 6%, Canvas);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .shot img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top;
  }
  .shot img.fav {
    width: 24px;
    height: 24px;
  }
  .badge {
    position: absolute;
    top: 4px;
    right: 4px;
    min-width: 20px;
    padding: 0 4px;
    border-radius: 10px;
    background: #2f7de1;
    color: white;
    font-size: 9px;
    font-weight: 700;
    line-height: 18px;
    text-align: center;
  }
  .text {
    display: flex;
    flex-direction: column;
    padding: 3px 8px;
    min-width: 0;
  }
  .title {
    font-weight: 600;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding-right: 30px;
  }
  .host {
    opacity: 0.6;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .spawn {
    position: absolute;
    right: 6px;
    bottom: 18px;
    padding: 0 6px;
    border-radius: 8px;
    font-size: 10px;
    background: color-mix(in srgb, #2f7de1 18%, Canvas);
  }
  :global(.svelte-flow__handle) {
    opacity: 0;
    pointer-events: none;
  }
</style>
