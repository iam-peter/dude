<script lang="ts">
  import { SCENARIOS, SITE } from '@/spike/scenarios';

  const send = <T = unknown,>(msg: object) => browser.runtime.sendMessage(msg) as Promise<T>;

  let total = $state(0);
  let running = $state<string | null>(null);
  let done = $state<Record<string, number>>({});
  let showAuto = $state(false);
  let rawOn = $state(false);
  send<boolean>({ cmd: 's1.enabled' }).then((v) => (rawOn = v));
  const setRaw = (on: boolean) => send<boolean>({ cmd: 's1.enable', on }).then((v) => (rawOn = v));

  const visible = $derived(SCENARIOS.filter((s) => showAuto || !s.auto));

  // "Open /a" → "Open http://localhost:8765/a". Quoted link labels ("push /spa/p1") stay as they are.
  function segments(step: string): { text: string; url?: boolean }[] {
    return step.split(/("[^"]*")/).flatMap((part) =>
      part.startsWith('"')
        ? [{ text: part }]
        : part.split(/((?<=^|\s)\/[\w/?=#.-]*)/).map((t) => (t.startsWith('/') ? { text: SITE + t, url: true } : { text: t })),
    );
  }

  async function refresh() {
    total = await send<number>({ cmd: 'count' });
  }
  // Done counts and the running scenario come from the stored markers, so they survive a
  // page reload and a browser restart (the "restart" scenario spans one).
  async function loadMarkers() {
    const markers = await send<{ kind: string; scenario: string }[]>({ cmd: 'markers' });
    const counts: Record<string, number> = {};
    let open: string | null = null;
    for (const m of markers) {
      if (m.kind === 'start') open = m.scenario;
      else if (m.kind === 'end' && m.scenario === open) {
        counts[m.scenario] = (counts[m.scenario] ?? 0) + 1;
        open = null;
      }
    }
    done = counts;
    running = open;
  }

  $effect(() => {
    loadMarkers();
    refresh();
    const t = setInterval(refresh, 1000);
    return () => clearInterval(t);
  });

  async function start(id: string) {
    if (running) await end();
    await send({ cmd: 'marker', kind: 'start', scenario: id, note: 'manual' });
    running = id;
  }
  async function end() {
    if (!running) return;
    await send({ cmd: 'marker', kind: 'end', scenario: running, note: 'manual' });
    done = { ...done, [running]: (done[running] ?? 0) + 1 };
    running = null;
  }

  async function exportLog() {
    const records = await send<unknown[]>({ cmd: 'dump' });
    const target = import.meta.env.BROWSER;
    const blob = new Blob(
      [JSON.stringify({ exportedAt: new Date().toISOString(), browser: target, ua: navigator.userAgent, records }, null, 1)],
      { type: 'application/json' },
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `s1-${target}-manual-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function clearLog() {
    if (!confirm('Delete all recorded events?')) return;
    await send({ cmd: 'clear' });
    done = {};
    refresh();
  }
</script>

<main>
  <header>
    <h1>S1 — raw event recorder</h1>
    <p>
      With <b>raw recording</b> on, every navigation, tab, window and session event is recorded verbatim —
      everything the browser does, not only the test site. Switch it off when you're done. For a scenario: press
      <b>Start</b>, do the steps in a <em>new</em> tab (keep this one open), press <b>End</b>. Test site:
      <a href={SITE} target="_blank">{SITE}</a> (run <code>npm run s1:site</code>).
    </p>
    <div class="bar">
      <label class:rec={rawOn}><input type="checkbox" checked={rawOn} onchange={(e) => setRaw(e.currentTarget.checked)} /> raw recording</label>
      <span class="count">{total} events</span>
      {#if running}<span class="rec">● recording “{running}”</span><button onclick={end}>End</button>{/if}
      <button onclick={exportLog}>Export JSON</button>
      <button onclick={() => send({ cmd: 'snapshot' }).then(refresh)}>Snapshot tabs</button>
      <button onclick={clearLog}>Clear</button>
      <label><input type="checkbox" bind:checked={showAuto} /> also show automated scenarios</label>
    </div>
  </header>

  {#each visible as s (s.id)}
    <section class:active={running === s.id}>
      <div class="head">
        <b>{s.title}</b>
        <code>{s.id}</code>
        <span class="covers">{s.covers.join(' · ')}</span>
        {#if done[s.id]}<span class="done">✓ {done[s.id]}×</span>{/if}
        {#if running === s.id}
          <button class="primary" onclick={end}>End</button>
        {:else}
          <button onclick={() => start(s.id)}>Start</button>
        {/if}
      </div>
      <ol>
        {#each s.manual as step}
          <li>{#each segments(step) as seg}{#if seg.url}<code>{seg.text}</code>{:else}{seg.text}{/if}{/each}</li>
        {/each}
      </ol>
    </section>
  {/each}
</main>

<style>
  :global(body) {
    margin: 0;
    font: 14px/1.5 system-ui, sans-serif;
    color-scheme: light dark;
  }
  main {
    max-width: 52rem;
    margin: 0 auto;
    padding: 1rem 1.5rem 4rem;
  }
  header {
    position: sticky;
    top: 0;
    background: Canvas;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
  }
  h1 {
    font-size: 1.3rem;
    margin: 0.5rem 0;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }
  .count {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .rec {
    color: #d33;
    font-weight: 600;
  }
  section {
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    border-radius: 8px;
    margin-top: 0.8rem;
    padding: 0.5rem 0.8rem;
  }
  section.active {
    border-color: #d33;
    box-shadow: 0 0 0 1px #d33;
  }
  .head {
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
  }
  .head button {
    margin-left: auto;
  }
  .covers {
    opacity: 0.6;
    font-size: 12px;
  }
  .done {
    color: #2a8;
    font-weight: 600;
  }
  ol {
    margin: 0.3rem 0 0;
  }
  button.primary {
    background: #d33;
    color: white;
    border: 0;
    border-radius: 4px;
    padding: 0.2rem 0.8rem;
  }
</style>
