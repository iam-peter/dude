<!--
  Splitter: drag (or arrow keys) to set the height of the element above it, or with
  `vertical` the width of the element to its right; double-click (or Home) goes back to
  the automatic or default size.
-->
<script lang="ts">
  interface Props {
    /** Current size; undefined while automatic. */
    value: number | undefined;
    /** The element's size right now, to start a drag from while automatic. */
    measure: () => number;
    /** Between two columns, sizing the right one. */
    vertical?: boolean;
    min?: number;
    max?: number;
    label?: string;
    onChange: (height: number | undefined) => void;
  }
  let { value, measure, vertical = false, min = 120, max = window.innerHeight - 120, label = 'Resize', onChange }: Props = $props();

  const clamp = (h: number) => Math.round(Math.max(min, Math.min(max, h)));
  // moving right or down grows the element above, but shrinks the one to the right
  const sign = $derived(vertical ? -1 : 1);
  const pos = (e: PointerEvent) => (vertical ? e.clientX : e.clientY);
  let drag: { at: number; size: number } | null = null;

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    drag = { at: pos(e), size: value ?? measure() };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault(); // no text selection while dragging
  }
  function move(e: PointerEvent) {
    if (drag) onChange(clamp(drag.size + sign * (pos(e) - drag.at)));
  }
  function key(e: KeyboardEvent) {
    const step = e.shiftKey ? 80 : 20;
    const [back, on] = vertical ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    if (e.key === back) onChange(clamp((value ?? measure()) - sign * step));
    else if (e.key === on) onChange(clamp((value ?? measure()) + sign * step));
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
  class:vertical
  role="separator"
  aria-orientation={vertical ? 'vertical' : 'horizontal'}
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
  .splitter.vertical {
    height: auto;
    width: 10px;
    margin: 0 -4px;
    cursor: col-resize;
  }
  .splitter.vertical .grip {
    width: 4px;
    height: 44px;
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
