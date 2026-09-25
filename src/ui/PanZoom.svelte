<!--
  Pan and zoom around graph content (which renders its own <svg>): drag to pan, wheel to zoom, − fit + buttons. Starts at
  a readable scale and keeps `focus` (the current page) in view. A drag never counts as a
  click on the content underneath.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    contentW: number;
    contentH: number;
    /** Box to keep in view at start and when it moves out of view (content coordinates). */
    focus?: { x: number; y: number; w: number; h: number };
    readable?: number;
    maxHeight?: number;
    hint?: string;
    children: Snippet;
  }
  let { contentW, contentH, focus, readable = 0.8, maxHeight = 0.7 * window.innerHeight, hint = 'drag to pan · wheel to zoom', children }: Props = $props();

  const MIN = 0.2;
  const MAX = 2.5;
  let width = $state(300);
  let scale = $state(1);
  let tx = $state(8);
  let ty = $state(8);
  let placed = false;
  let el: HTMLDivElement;

  const height = $derived(Math.min(Math.max(100, contentH * scale + 16), maxHeight));

  function fit() {
    scale = Math.max(MIN, Math.min(1, (width - 16) / Math.max(1, contentW), (height - 16) / Math.max(1, contentH)));
    tx = 8;
    ty = 8;
  }
  function focusVisible() {
    if (!focus) return true;
    const x0 = tx + focus.x * scale;
    return x0 >= 0 && x0 + focus.w * scale <= width;
  }
  function showFocus() {
    if (!focus) return;
    tx = Math.min(8, width * 0.66 - (focus.x + focus.w / 2) * scale);
    const y0 = ty + focus.y * scale;
    if (y0 < 0 || y0 + focus.h * scale > height) ty = Math.min(8, height / 2 - (focus.y + focus.h / 2) * scale);
  }

  $effect(() => {
    // re-run when the content or the focus changes
    void contentW;
    void focus;
    if (!placed && width > 0 && contentW > 0) {
      scale = Math.max(readable, Math.min(1, (width - 16) / contentW));
      tx = 8;
      ty = 8;
      if (!focusVisible()) showFocus();
      placed = true;
    } else if (placed && !focusVisible()) {
      showFocus();
    }
  });

  function zoomAt(factor: number, cx: number, cy: number) {
    const next = Math.max(MIN, Math.min(MAX, scale * factor));
    tx = cx - ((cx - tx) * next) / scale;
    ty = cy - ((cy - ty) * next) / scale;
    scale = next;
  }

  // Non-passive, so zooming doesn't also scroll the page.
  $effect(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  let drag: { x: number; y: number; tx: number; ty: number; moved: boolean } | null = null;
  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, tx, ty, moved: false };
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      drag.moved = true;
      el.setPointerCapture(e.pointerId);
    }
    if (drag.moved) {
      tx = drag.tx + dx;
      ty = drag.ty + dy;
    }
  }
  function up() {
    const moved = drag?.moved;
    drag = null;
    if (moved) {
      // swallow the click that ends a drag
      const stop = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      el.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => el.removeEventListener('click', stop, { capture: true }), 0);
    }
  }
</script>

<div class="wrap" bind:clientWidth={width}>
  <div class="tools">
    <span class="hint">{hint}</span>
    <button title="Zoom out" onclick={() => zoomAt(1 / 1.25, width / 2, height / 2)}>−</button>
    <button title="Show everything" onclick={fit}>fit</button>
    <button title="Zoom in" onclick={() => zoomAt(1.25, width / 2, height / 2)}>+</button>
  </div>
  <div class="canvas" bind:this={el} style:height="{height}px" role="presentation" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
    <!-- The content brings its own <svg>: SVG elements must be created by the component that owns them. -->
    <div class="content" style:transform="translate({tx}px, {ty}px) scale({scale})">
      {@render children()}
    </div>
  </div>
</div>

<style>
  .tools {
    display: flex;
    align-items: center;
    gap: 2px;
    margin: 0 2px 4px;
  }
  .hint {
    flex: 1;
    font-size: 11px;
    opacity: 0.55;
  }
  .tools button {
    all: unset;
    cursor: pointer;
    font-size: 11px;
    padding: 1px 7px;
    border-radius: 5px;
    background: color-mix(in srgb, CanvasText 10%, Canvas);
  }
  .canvas {
    position: relative;
    overflow: hidden;
    border-radius: 8px;
    background: color-mix(in srgb, CanvasText 3%, Canvas);
    cursor: grab;
    touch-action: none;
  }
  .canvas:active {
    cursor: grabbing;
  }
  .content {
    transform-origin: 0 0;
    width: max-content;
  }
</style>
