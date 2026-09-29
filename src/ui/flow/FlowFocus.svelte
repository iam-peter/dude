<!--
  Inside SvelteFlow (it needs the flow's context): moves the view to `target` whenever it
  changes, keeping the zoom — for keyboard navigation between cards.
-->
<script lang="ts">
  import { useSvelteFlow } from '@xyflow/svelte';

  let { target }: { target?: { x: number; y: number; seq: number } } = $props();
  const flow = useSvelteFlow();
  $effect(() => {
    if (target) flow.setCenter(target.x, target.y, { zoom: flow.getZoom(), duration: 200 });
  });
</script>
