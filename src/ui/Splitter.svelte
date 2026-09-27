<!--
  Horizontal splitter: drag (or arrow keys) to set the height of the element above it;
  double-click (or Home) goes back to its automatic height.
-->
<script lang="ts">
  interface Props {
    /** Current height; undefined while automatic. */
    value: number | undefined;
    /** The element's height right now, to start a drag from while automatic. */
    measure: () => number;
    min?: number;
    max?: number;
    label?: string;
    onChange: (height: number | undefined) => void;
  }
  let { value, measure, min = 120, max = window.innerHeight - 120, label = 'Resize', onChange }: Props = $props();

  const clamp = (h: number) => Math.round(Math.max(min, Math.min(max, h)));
  let drag: { y: number; h: number } | null = null;

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    drag = { y: e.clientY, h: value ?? measure() };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault(); // no text selection while dragging
  }
  function move(e: PointerEvent) {
    if (drag) onChange(clamp(drag.h + e.clientY - drag.y));
  }
  function key(e: KeyboardEvent) {
    const step = e.shiftKey ? 80 : 20;
    if (e.key === 'ArrowUp') onChange(clamp((value ?? measure()) - step));
    else if (e.key === 'ArrowDown') onChange(clamp((value ?? measure()) + step));
    else if (e.key === 'Home') onChange(undefined);
    else return;
    e.preventDefault();
  }
</script>

<!-- A focusable separator with a value is an interactive widget in ARIA; Svelte's check treats every separator as static. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="splitter"
  class:set={value !== undefined}
  role="separator"
  aria-orientation="horizontal"
  aria-label={label}
  aria-valuenow={value ?? measure()}
  aria-valuemin={min}
  aria-valuemax={max}
  tabindex="0"
  title="{label}: drag · double-click for automatic"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={() => (drag = null)}
  onpointercancel={() => (drag = null)}
  ondblclick={() => onChange(undefined)}
  onkeydown={key}
>
  <span class="grip"></span>
</div>

<style>
  .splitter {
    flex: none;
    height: 10px;
    margin: -4px 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: row-resize;
    touch-action: none;
    border-radius: 5px;
  }
  .grip {
    width: 44px;
    height: 4px;
    border-radius: 2px;
    background: color-mix(in srgb, CanvasText 18%, transparent);
  }
  .splitter:hover .grip,
  .splitter:focus-visible .grip {
    background: #2f7de1;
  }
  .splitter:focus-visible {
    outline: none;
    background: color-mix(in srgb, #2f7de1 10%, transparent);
  }
</style>
