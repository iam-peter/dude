<!--
  Playback (SPEC §10, C2–C4): an animated replay of the log, never driving real tabs.
  One lane per tab; the layout is computed once for the whole replay, and each frame shows
  the pages visited so far, each lane's current page and the tab in focus. The current
  step's screenshot is shown large, with a filmstrip of the steps before it.
-->
<script lang="ts">
  import { buildView } from '@/core/views';
  import { delayAfter, frameAt, type Step, type Timeline } from '@/core/timeline';
  import { shortUrl } from '@/core/describe';
  import type { Visit } from '@/core/model';
  import PanZoom from './PanZoom.svelte';
  import { layoutGraph } from './graph-layout';
  import { shotUrl, shotUrls } from './shots';

  interface Props {
    tl: Timeline;
    steps: Step[];
    lanes: string[];
  }
  let { tl, steps, lanes }: Props = $props();

  const W = 150;
  const IMG_H = 84;
  const H = IMG_H + 22;
  const LANE_HEAD = 22;
  const LANE_GAP = 18;

  // ---------------------------------------------------------------- layout (once)
  interface Placed {
    x: number;
    y: number;
    lane: number;
  }
  let layout = $state<{ nodes: Map<string, Placed>; edges: { from: string; to: string; d: string }[]; lanes: { y: number; h: number; w: number; title: string }[]; w: number; h: number } | null>(null);

  $effect(() => {
    const st = tl.st;
    let cancelled = false;
    (async () => {
      const nodes = new Map<string, Placed>();
      const edges: { from: string; to: string; d: string }[] = [];
      const laneBoxes: { y: number; h: number; w: number; title: string }[] = [];
      let y = 0;
      let w = 0;
      for (const [li, sid] of lanes.entries()) {
        const s = st.sessions[sid];
        const view = buildView({ session: s, visits: st.visits }, 'tree');
        const l = await layoutGraph(view, { nodeW: W, nodeH: H, layout: ['tree'] });
        for (const n of l.nodes) nodes.set(view.rows[n.row].key, { x: n.x, y: y + LANE_HEAD + n.y, lane: li });
        for (const e of l.edges) {
          edges.push({ from: view.rows[e.from].key, to: view.rows[e.to].key, d: `translate(0 ${y + LANE_HEAD})|${e.d}` });
        }
        const root = s.rootId ? st.visits[s.rootId] : undefined;
        laneBoxes.push({ y, h: LANE_HEAD + l.height, w: l.width, title: root?.title ?? (root ? shortUrl(root.url) : sid) });
        y += LANE_HEAD + l.height + LANE_GAP;
        w = Math.max(w, l.width);
      }
      // "opened from" links between lanes: from the source page to the new tab's first page
      for (const sid of lanes) {
        const s = st.sessions[sid];
        const from = s.spawnedFrom?.visitId && nodes.get(s.spawnedFrom.visitId);
        const to = s.rootId && nodes.get(s.rootId);
        if (!from || !to) continue;
        const x1 = from.x + W / 2;
        const y1 = from.y + H;
        const x2 = to.x;
        const y2 = to.y + H / 2;
        edges.push({ from: s.spawnedFrom!.visitId!, to: s.rootId!, d: `|M ${x1} ${y1} C ${x1} ${y1 + 40}, ${x2 - 40} ${y2}, ${x2} ${y2}` });
      }
      if (!cancelled) layout = { nodes, edges, lanes: laneBoxes, w, h: Math.max(0, y - LANE_GAP) };
    })();
    return () => {
      cancelled = true;
    };
  });

  // ---------------------------------------------------------------- state
  let k = $state(0);
  let playing = $state(false);
  let speed = $state(1);
  const frame = $derived(frameAt(steps, k));
  const step = $derived(steps[k]);
  const prevCursor = $derived(k > 0 && step ? frameAt(steps, k - 1).cursors.get(step.sessionId) : undefined);
  const visit = $derived<Visit | undefined>(step?.visitId ? tl.st.visits[step.visitId] : undefined);

  $effect(() => {
    if (!playing) return;
    if (k >= steps.length - 1) {
      playing = false;
      return;
    }
    const timer = setTimeout(() => (k = Math.min(steps.length - 1, k + 1)), delayAfter(steps, k, speed));
    return () => clearTimeout(timer);
  });

  // The screenshot for a step: the first one for a new page (how it looked then), else the
  // latest taken by that moment.
  function shotFor(s: Step | undefined): string | undefined {
    const v = s?.visitId ? tl.st.visits[s.visitId] : undefined;
    if (!v?.screenshots.length) return undefined;
    if (s!.kind === 'visit') return v.screenshots[0].id;
    return (v.screenshots.filter((x) => x.at <= s!.t + 3000).at(-1) ?? v.screenshots[0]).id;
  }

  let thumbs = $state<Record<string, string>>({});
  $effect(() => {
    const ids = [...new Set(steps.map(shotFor).filter((x): x is string => !!x))];
    shotUrls(ids).then((u) => (thumbs = u));
  });
  let big = $state<string | undefined>();
  $effect(() => {
    const id = shotFor(step);
    big = id ? thumbs[id] : undefined; // thumbnail first, preview when it's there
    if (id) shotUrl(id, 'preview').then((u) => shotFor(step) === id && (big = u));
  });

  const focusBox = $derived.by(() => {
    const n = step?.visitId && layout?.nodes.get(step.visitId);
    return n ? { x: n.x, y: n.y, w: W, h: H } : undefined;
  });

  function edgePath(d: string) {
    const [tr, path] = d.split('|');
    return { transform: tr || undefined, d: path };
  }
  function movePath(from: string, to: string) {
    const a = layout?.nodes.get(from);
    const b = layout?.nodes.get(to);
    if (!a || !b) return undefined;
    const x1 = a.x + W / 2;
    const x2 = b.x + W / 2;
    const y1 = a.y + H;
    const y2 = b.y + H;
    const dip = 26 + Math.abs(x2 - x1) / 8;
    return `M ${x1} ${y1} C ${x1} ${y1 + dip}, ${x2} ${y2 + dip}, ${x2} ${y2}`;
  }

  function onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest('input, select')) return;
    if (e.key === ' ') {
      e.preventDefault();
      toggle();
    } else if (e.key === 'ArrowRight') k = Math.min(steps.length - 1, k + 1);
    else if (e.key === 'ArrowLeft') k = Math.max(0, k - 1);
  }
  function toggle() {
    if (!playing && k >= steps.length - 1) k = 0;
    playing = !playing;
  }

  const what: Record<string, string> = { visit: 'opened', move: 'went', cursor: 'now at', focus: 'switched to tab at' };
  const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
</script>

<svelte:window onkeydown={onKey} />

<section class="playback">
  <div class="controls">
    <button onclick={() => ((k = 0), (playing = false))} title="To the start" aria-label="To the start">⏮</button>
    <button onclick={() => (k = Math.max(0, k - 1))} title="Previous step (←)" aria-label="Previous step">◀</button>
    <button class="play" onclick={toggle} title="Play / pause (space)">{playing ? '❚❚ Pause' : '▶ Play'}</button>
    <button onclick={() => (k = Math.min(steps.length - 1, k + 1))} title="Next step (→)" aria-label="Next step">▶</button>
    <input type="range" min="0" max={Math.max(0, steps.length - 1)} bind:value={k} aria-label="Step" />
    <select bind:value={speed} aria-label="Speed">
      {#each [0.5, 1, 2, 4, 8] as s}<option value={s}>{s}×</option>{/each}
    </select>
    <span class="pos">{steps.length ? `${k + 1} / ${steps.length}${step ? ` · ${clock(step.t)}` : ''}` : 'nothing to play'}</span>
  </div>

  <div class="stage">
    <div class="graph">
      {#if layout}
        <PanZoom contentW={layout.w} contentH={layout.h} focus={focusBox} readable={0.55} maxHeight={Math.max(300, window.innerHeight * 0.62)}>
          <svg width={layout.w} height={layout.h} overflow="visible">
            <defs>
              <clipPath id="pb-img"><rect width={W} height={IMG_H} rx="6" /></clipPath>
              <marker id="pb-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" class="arrow" /></marker>
            </defs>
            {#each layout.lanes as lane, i}
              <g class="lane" class:focus={frame.focus === lanes[i]}>
                <rect x="-6" y={lane.y} width={Math.max(layout.w, lane.w) + 12} height={lane.h} rx="8" />
                <text x="4" y={lane.y + 15}>{clip(lane.title, 60)}</text>
              </g>
            {/each}
            {#each layout.edges as e (e.from + '>' + e.to)}
              {@const p = edgePath(e.d)}
              {#if frame.visible.has(e.from) && frame.visible.has(e.to)}
                <path d={p.d} transform={p.transform} class="edge" marker-end="url(#pb-arrow)" />
              {/if}
            {/each}
            {#if step?.kind === 'move' && prevCursor && step.visitId}
              {@const d = movePath(prevCursor, step.visitId)}
              {#if d}<path {d} class="move {step.dir}" marker-end="url(#pb-arrow)" />{/if}
            {/if}
            {#each [...layout.nodes] as [id, n] (id)}
              {@const v = tl.st.visits[id]}
              {@const sid = shotFor({ t: step?.t ?? 0, kind: 'visit', sessionId: '', visitId: id })}
              <g class="node" class:shown={frame.visible.has(id)} class:cursor={frame.cursors.get(v?.sessionId) === id} class:current={step?.visitId === id} transform="translate({n.x} {n.y})">
                <title>{v?.title ?? ''}&#10;{v?.url ?? ''}</title>
                <rect class="frame" width={W} height={H} rx="6" />
                {#if sid && thumbs[sid]}<image href={thumbs[sid]} width={W} height={IMG_H} preserveAspectRatio="xMidYMin slice" clip-path="url(#pb-img)" />{:else}<rect class="noimg" width={W} height={IMG_H} rx="6" />{/if}
                <text x="6" y={IMG_H + 15}>{clip(v?.title || (v ? shortUrl(v.url) : ''), 22)}</text>
              </g>
            {/each}
          </svg>
        </PanZoom>
      {/if}
    </div>

    <aside class="now">
      {#if step && visit}
        <p class="caption">
          <span class="when">{clock(step.t)}</span>
          {what[step.kind]}{#if step.kind === 'move'} {step.dir}{/if}{#if step.kind === 'move'} to{/if}
          <b>{visit.title || shortUrl(visit.url)}</b>
        </p>
        <p class="url">{[shortUrl(visit.url), visit.searchQuery && `search “${visit.searchQuery}”`, step.kind === 'visit' && visit.anchorText && `via “${visit.anchorText}”`].filter(Boolean).join(' · ')}</p>
        {#if big}<img class="big" src={big} alt="Screenshot of {visit.title ?? visit.url}" />{:else}<div class="noshot">no screenshot</div>{/if}
        <div class="strip">
          {#each steps.slice(Math.max(0, k - 6), k + 1) as s, i (i + '-' + s.t + s.kind)}
            {@const id = shotFor(s)}
            <button class:on={s === step} onclick={() => (k = steps.indexOf(s))} title={`${what[s.kind]} ${s.visitId ? (tl.st.visits[s.visitId]?.title ?? '') : ''}`}>
              {#if id && thumbs[id]}<img src={thumbs[id]} alt="" />{/if}
            </button>
          {/each}
        </div>
      {/if}
    </aside>
  </div>
</section>

<style>
  .playback {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .controls button,
  .controls select {
    font: inherit;
    padding: 3px 9px;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
  }
  .controls .play {
    background: #2f7de1;
    border-color: #2f7de1;
    color: white;
    min-width: 84px;
  }
  .controls input[type='range'] {
    flex: 1;
    min-width: 160px;
  }
  .pos {
    font-variant-numeric: tabular-nums;
    font-size: 12px;
    opacity: 0.75;
  }
  .stage {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(260px, 1.3fr);
    gap: 14px;
    align-items: start;
  }
  @media (max-width: 1000px) {
    .stage {
      grid-template-columns: 1fr;
    }
  }
  .lane rect {
    fill: color-mix(in srgb, CanvasText 3%, transparent);
    stroke: color-mix(in srgb, CanvasText 8%, transparent);
    transition: fill 0.3s;
  }
  .lane.focus rect {
    fill: color-mix(in srgb, #2f7de1 9%, transparent);
    stroke: color-mix(in srgb, #2f7de1 35%, transparent);
  }
  .lane text {
    font-size: 11px;
    fill: CanvasText;
    opacity: 0.65;
  }
  .edge {
    fill: none;
    stroke: color-mix(in srgb, CanvasText 40%, transparent);
    stroke-width: 1.3;
  }
  .arrow {
    fill: color-mix(in srgb, CanvasText 55%, transparent);
  }
  .move {
    fill: none;
    stroke-width: 2.2;
  }
  .move.back {
    stroke: #2f7de1;
  }
  .move.forward {
    stroke: #1f9d63;
  }
  .node {
    opacity: 0;
    transition: opacity 0.35s;
  }
  .node.shown {
    opacity: 0.8;
  }
  .node.cursor {
    opacity: 1;
  }
  .frame {
    fill: Canvas;
    stroke: color-mix(in srgb, CanvasText 25%, transparent);
  }
  .node.cursor .frame {
    stroke: #2f7de1;
    stroke-width: 2;
  }
  .node.current .frame {
    stroke: #e8912d;
    stroke-width: 3;
  }
  .noimg {
    fill: color-mix(in srgb, CanvasText 8%, Canvas);
  }
  .node text {
    font-size: 11px;
    fill: CanvasText;
  }
  .now {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .caption {
    margin: 0;
    font-size: 14px;
  }
  .when {
    font-variant-numeric: tabular-nums;
    opacity: 0.6;
    margin-right: 6px;
  }
  .url {
    margin: 0;
    font-size: 12px;
    opacity: 0.7;
    overflow-wrap: anywhere;
  }
  .big {
    width: 100%;
    max-height: 48vh;
    object-fit: contain;
    object-position: top left;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
  }
  .noshot {
    aspect-ratio: 16 / 9;
    display: grid;
    place-items: center;
    border-radius: 8px;
    background: color-mix(in srgb, CanvasText 6%, Canvas);
    opacity: 0.8;
  }
  .strip {
    display: flex;
    gap: 4px;
    overflow-x: auto;
  }
  .strip button {
    all: unset;
    cursor: pointer;
    width: 64px;
    height: 36px;
    flex: none;
    border-radius: 4px;
    overflow: hidden;
    background: color-mix(in srgb, CanvasText 8%, Canvas);
    outline: 2px solid transparent;
  }
  .strip button.on {
    outline-color: #e8912d;
  }
  .strip img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top left;
  }
</style>
