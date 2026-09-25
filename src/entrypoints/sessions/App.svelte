<script lang="ts">
  // Sessions app (SPEC §8.2): all recorded tab sessions by day, search (F8, F9) and the
  // thumbnail wall; for the selected session its graph with screenshots and the details
  // of the selected page.
  import { request, type ChangedMessage, type SessionCard, type SessionPayload } from '@/background/protocol';
  import { buildView, type Row, type ViewMode } from '@/core/views';
  import SessionGraph from '@/ui/SessionGraph.svelte';
  import VisitDetails from '@/ui/VisitDetails.svelte';
  import SearchResults from '@/ui/SearchResults.svelte';
  import ThumbWall from '@/ui/ThumbWall.svelte';
  import { shotUrls } from '@/ui/shots';
  import { resync, searchIndex } from '@/ui/search-client';
  import type { Hit, SearchDoc, SearchIndex } from '@/search';
  import type { Visit } from '@/core/model';
  import type { OpenPathProgress } from '@/background/navigate';

  const MODES: { id: ViewMode; label: string }[] = [
    { id: 'tree', label: 'Tree' },
    { id: 'moves', label: '+ Moves' },
    { id: 'network', label: 'Network' },
  ];

  const params = new URLSearchParams(location.search);
  let cards = $state<SessionCard[]>([]);
  let selectedId = $state<string | null>(params.get('session'));
  let data = $state<SessionPayload | null>(null);
  let mode = $state<ViewMode>((params.get('mode') ?? localStorage.getItem('dude.sessions.mode') ?? 'tree') as ViewMode);
  let selectedKey = $state<string | undefined>();
  let thumbs = $state<Record<string, string>>({});

  // Search and wall
  let q = $state(params.get('q') ?? '');
  let range = $state<'any' | 'day' | 'week' | 'month'>('any');
  let host = $state('');
  let familyOnly = $state(false);
  let panel = $state<'sessions' | 'wall'>(params.get('panel') === 'wall' ? 'wall' : 'sessions');
  let ix = $state<SearchIndex | null>(null);
  let indexing = $state<{ done: number; total: number } | null>(null);
  let hits = $state<Hit[]>([]);
  let pendingVisit: string | undefined;
  let job = $state<OpenPathProgress | null>(null);

  $effect(() => localStorage.setItem('dude.sessions.mode', mode));

  const view = $derived(data ? buildView(data, mode) : null);
  const selectedRow = $derived(view?.rows.find((r) => r.key === selectedKey) ?? view?.rows.find((r) => r.cursor) ?? view?.rows.at(-1));
  const selectedVisits = $derived(selectedRow && data ? selectedRow.visitIds.map((id) => data!.visits[id]).filter(Boolean).sort((a, b) => a.firstAt - b.firstAt) : []);

  async function loadList() {
    cards = await request<SessionCard[]>({ cmd: 'dude.sessions', limit: 300 });
    if (!selectedId && cards.length) select(cards[0].id);
    loadThumbs(cards.flatMap((c) => c.thumbs));
  }

  async function loadSession() {
    if (!selectedId) return;
    data = await request<SessionPayload | null>({ cmd: 'dude.session', sessionId: selectedId });
    if (data) loadThumbs(Object.values(data.visits).flatMap((v) => v.screenshots.map((s) => s.id)));
    if (data && pendingVisit) {
      const id = pendingVisit;
      pendingVisit = undefined;
      selectedKey = buildView(data, mode).rows.find((r) => r.visitIds.includes(id))?.key;
    }
  }

  async function loadThumbs(ids: string[]) {
    const missing = ids.filter((id) => !thumbs[id]);
    if (missing.length) thumbs = { ...thumbs, ...(await shotUrls(missing)) };
  }

  function select(id: string) {
    selectedId = id;
    selectedKey = undefined;
    history.replaceState(null, '', `?session=${id}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
    loadSession();
  }

  /** From a search hit or a wall tile: its session, with that page selected. */
  function showDoc(d: SearchDoc) {
    panel = 'sessions';
    pendingVisit = d.id;
    if (d.sessionId === selectedId && data) {
      pendingVisit = undefined;
      selectedKey = buildView(data, mode).rows.find((r) => r.visitIds.includes(d.id))?.key;
    } else select(d.sessionId);
  }

  async function ensureIndex() {
    if (ix) return ix;
    indexing = { done: 0, total: 0 };
    const index = await searchIndex((done, total) => (indexing = { done, total }));
    indexing = null;
    ix = index;
    return index;
  }

  // Sessions linked by "opened from" (both directions) — the tab family filter.
  const family = $derived.by(() => {
    if (!selectedId) return undefined;
    const ids = new Set([selectedId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of cards) {
        const p = c.spawnedFrom?.sessionId;
        if (!p) continue;
        if (ids.has(p) !== ids.has(c.id)) {
          ids.add(p);
          ids.add(c.id);
          grew = true;
        }
      }
    }
    return ids;
  });
  const since = $derived(range === 'any' ? undefined : Date.now() - { day: 864e5, week: 7 * 864e5, month: 30 * 864e5 }[range]);

  $effect(() => {
    const query = q;
    const filters = { since, host, sessionIds: familyOnly ? family : undefined };
    if (!query.trim()) {
      hits = [];
      return;
    }
    ensureIndex().then((index) => {
      if (query !== q) return;
      hits = index.search(query, filters);
      loadThumbs(hits.slice(0, 60).flatMap((h) => [h.doc.shotId, ...index.ancestors(h.doc.id).map((a) => a.shotId)]).filter((x): x is string => !!x));
    });
  });

  const wallDocs = $derived.by(() => {
    if (!ix || panel !== 'wall') return [];
    const h = host.trim().toLowerCase();
    return [...ix.docs.values()]
      .filter((d) => d.shotId && !d.inherited && (since === undefined || d.lastAt >= since) && (!h || d.host.toLowerCase().includes(h)) && (!familyOnly || !family || family.has(d.sessionId)))
      .sort((a, b) => b.lastAt - a.lastAt);
  });
  $effect(() => {
    if (panel === 'wall') ensureIndex();
  });

  async function openPath(v: Visit) {
    const r = await request<{ job: string; total: number }>({ cmd: 'dude.openPath', visitId: v.id });
    job = { type: 'dude.openPath', job: r.job, step: 0, total: r.total, done: false };
  }
  const cancelPath = () => job && request({ cmd: 'dude.openPath.cancel', job: job.job });

  $effect(() => {
    loadList();
    loadSession();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onMessage = (m: ChangedMessage | OpenPathProgress) => {
      if (m?.type === 'dude.openPath') {
        if (job && m.job === job.job) {
          job = m;
          if (m.done) setTimeout(() => job?.job === m.job && (job = null), 2500);
        }
        return;
      }
      if (m?.type !== 'dude.changed') return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        loadList();
        if (selectedId && m.sessionIds.includes(selectedId)) loadSession();
        if (ix) resync().then(() => ix && q && (hits = ix.search(q, { since, host, sessionIds: familyOnly ? family : undefined })));
      }, 300);
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  });

  // Rows show the latest screenshot of their (latest) visit.
  function thumbOf(row: Row): string | undefined {
    if (!data) return undefined;
    for (let i = row.visitIds.length - 1; i >= 0; i--) {
      const shot = data.visits[row.visitIds[i]]?.screenshots.at(-1);
      if (shot && thumbs[shot.id]) return thumbs[shot.id];
    }
    return undefined;
  }

  const open = (url: string, visitId?: string) => request({ cmd: 'dude.open', url, visitId });

  /** Tabs opened from the visits of a row (↗ badge). */
  const spawnedFrom = (row: Row) => (data ? data.children.filter((c) => c.spawnedFromVisitId && row.visitIds.includes(c.spawnedFromVisitId)).length : 0);

  // Group cards by day of last activity.
  const days = $derived.by(() => {
    const out: { label: string; cards: SessionCard[] }[] = [];
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 864e5).toDateString();
    for (const c of cards) {
      const d = new Date(c.lastAt).toDateString();
      const label = d === today ? 'Today' : d === yesterday ? 'Yesterday' : new Date(c.lastAt).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
      if (out.at(-1)?.label !== label) out.push({ label, cards: [] });
      out.at(-1)!.cards.push(c);
    }
    return out;
  });
  const hm = (t: number) => new Date(t).toLocaleTimeString([], { timeStyle: 'short' });
  const selectedCard = $derived(cards.find((c) => c.id === selectedId));
</script>

<div class="app">
  <aside>
    <header><h1>dude</h1><span class="sub">tab sessions</span></header>
    <input class="search" type="search" placeholder="Search titles, addresses, page text…" bind:value={q} aria-label="Search" />
    <div class="filters">
      <select bind:value={range} aria-label="Time range">
        <option value="any">any time</option>
        <option value="day">last 24 h</option>
        <option value="week">last 7 days</option>
        <option value="month">last 30 days</option>
      </select>
      <input type="text" placeholder="domain" bind:value={host} aria-label="Domain" />
      <label title="Only the selected session and the tabs linked to it by 'opened from'"><input type="checkbox" bind:checked={familyOnly} disabled={!selectedId} /> this tab family</label>
    </div>
    <div class="panels" role="tablist">
      <button role="tab" aria-selected={panel === 'sessions'} class:on={panel === 'sessions'} onclick={() => (panel = 'sessions')}>Sessions</button>
      <button role="tab" aria-selected={panel === 'wall'} class:on={panel === 'wall'} onclick={() => (panel = 'wall')}>Wall</button>
    </div>
    {#if indexing}<p class="empty">Indexing page text… {indexing.total ? `${indexing.done}/${indexing.total}` : ''}</p>{/if}
    {#if q.trim()}
      {#if ix}<SearchResults {hits} ancestors={(id) => ix!.ancestors(id)} {thumbs} onShow={showDoc} onOpen={(d) => open(d.url, d.id)} />{/if}
    {:else}
    {#each days as day (day.label)}
      <h2>{day.label}</h2>
      {#each day.cards as c (c.id)}
        <button class="card" class:on={c.id === selectedId} onclick={() => select(c.id)}>
          <span class="top">
            <span class="title">{c.title ?? '…'}</span>
            <span class="time">{hm(c.createdAt)}{c.lastAt - c.createdAt > 60_000 ? `–${hm(c.lastAt)}` : ''}</span>
          </span>
          {#if c.spawnedFrom}<span class="from">{c.spawnedFrom.kind === 'duplicate' ? '⧉ duplicate of' : '↳ from'} {c.spawnedFrom.title ?? '…'}</span>{/if}
          <span class="strip">
            {#each c.thumbs as id (id)}{#if thumbs[id]}<img src={thumbs[id]} alt="" />{/if}{/each}
          </span>
          <span class="meta">{c.visitCount} page{c.visitCount === 1 ? '' : 's'}{c.open ? ' · open' : ''}</span>
        </button>
      {/each}
    {:else}
      <p class="empty">Nothing recorded yet. Browse a little and come back.</p>
    {/each}
    {/if}
  </aside>

  <main>
    {#if job}
      <div class="toast" role="status">
        {#if job.cancelled}Open with path cancelled.
        {:else if job.done}Opened {job.total} page{job.total === 1 ? '' : 's'} — the new tab's Back button now walks back through them.
        {:else}Opening page {job.step} of {job.total}… <button class="link" onclick={cancelPath}>Cancel</button>{/if}
      </div>
    {/if}
    {#if panel === 'wall'}
      {#if ix}<ThumbWall docs={wallDocs} onShow={showDoc} />{:else}<p class="empty">Loading…</p>{/if}
    {:else if data && view}
      <header class="head">
        <div>
          <h1>{selectedCard?.title ?? 'Session'}</h1>
          <p class="sub">
            {new Date(data.session.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
            · {data.session.closedAt === undefined ? 'tab open' : 'tab closed'}
            {#if data.parent}· <button class="link" onclick={() => select(data!.parent!.id)}>{data.session.spawnedFrom?.kind === 'duplicate' ? 'duplicated from' : 'opened from'} {data.spawnVisit?.title ?? data.parent.title ?? '…'}</button>{/if}
            {#if data.children.length}· {data.children.length} tab{data.children.length === 1 ? '' : 's'} opened from here{/if}
          </p>
        </div>
        <div class="modes" role="tablist">
          {#each MODES as m}
            <button role="tab" aria-selected={mode === m.id} class:on={mode === m.id} onclick={() => (mode = m.id)}>{m.label}</button>
          {/each}
        </div>
      </header>
      {#key data.session.id + mode}
        <SessionGraph {view} {mode} thumb={thumbOf} spawned={spawnedFrom} selected={selectedRow?.key} onSelect={(r) => (selectedKey = r.key)} onOpen={(r) => open(r.url, r.visitIds.at(-1))} />
      {/key}
      {#if selectedVisits.length}
        <VisitDetails
          visits={selectedVisits}
          children={data.children.filter((c) => selectedVisits.some((v) => v.id === c.spawnedFromVisitId))}
          onOpen={(v) => open(v.url, v.id)}
          onOpenPath={openPath}
          onShowSession={select}
        />
      {/if}
    {:else if selectedId}
      <p class="empty">Loading…</p>
    {/if}
  </main>
</div>

<style>
  :global(body) {
    margin: 0;
    font: 13px/1.4 system-ui, sans-serif;
    color-scheme: light dark;
    background: Canvas;
    color: CanvasText;
  }
  .app {
    display: grid;
    grid-template-columns: 320px minmax(0, 1fr);
    height: 100vh;
  }
  aside {
    overflow-y: auto;
    border-right: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    padding: 12px 10px 24px;
    background: color-mix(in srgb, CanvasText 2%, Canvas);
  }
  aside header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 0 4px 6px;
  }
  aside h1 {
    font-size: 18px;
    margin: 0;
  }
  .sub {
    opacity: 0.6;
    font-size: 12px;
    margin: 2px 0 0;
  }
  aside h2 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.6;
    margin: 14px 4px 4px;
  }
  .card {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
    padding: 7px 8px;
    border-radius: 8px;
    margin-bottom: 2px;
  }
  .card:hover {
    background: color-mix(in srgb, CanvasText 6%, transparent);
  }
  .card.on {
    background: color-mix(in srgb, #2f7de1 14%, transparent);
  }
  .card:focus-visible {
    outline: 2px solid #2f7de1;
  }
  .top {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .card .title {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .time,
  .meta,
  .from {
    font-size: 11px;
    opacity: 0.6;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .strip {
    display: flex;
    gap: 3px;
    overflow: hidden;
  }
  .strip img {
    width: 46px;
    height: 26px;
    object-fit: cover;
    object-position: top;
    border-radius: 3px;
    flex: none;
    border: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
  }
  main {
    overflow-y: auto;
    padding: 14px 18px 32px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }
  .head h1 {
    font-size: 17px;
    margin: 0;
  }
  .modes {
    display: flex;
    gap: 2px;
    background: color-mix(in srgb, CanvasText 8%, transparent);
    border-radius: 7px;
    padding: 2px;
    flex: none;
  }
  .modes button {
    all: unset;
    cursor: pointer;
    padding: 3px 10px;
    border-radius: 5px;
    font-size: 12px;
  }
  .modes button.on {
    background: Canvas;
    box-shadow: 0 0 0 1px color-mix(in srgb, CanvasText 15%, transparent);
  }
  .link {
    all: unset;
    cursor: pointer;
    color: #2f7de1;
  }
  .link:hover {
    text-decoration: underline;
  }
  .empty {
    opacity: 0.7;
    padding: 8px 4px;
  }
  .search {
    width: 100%;
    box-sizing: border-box;
    padding: 7px 9px;
    border-radius: 7px;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    background: Canvas;
    color: CanvasText;
    font: inherit;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    margin: 6px 0;
    font-size: 11.5px;
  }
  .filters select,
  .filters input[type='text'] {
    font: inherit;
    padding: 2px 5px;
    border-radius: 5px;
    border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
    background: Canvas;
    color: CanvasText;
  }
  .filters input[type='text'] {
    width: 90px;
  }
  .panels {
    display: flex;
    gap: 2px;
    background: color-mix(in srgb, CanvasText 8%, transparent);
    border-radius: 7px;
    padding: 2px;
    margin: 4px 0 6px;
  }
  .panels button {
    all: unset;
    cursor: pointer;
    flex: 1;
    text-align: center;
    padding: 3px 10px;
    border-radius: 5px;
    font-size: 12px;
  }
  .panels button.on {
    background: Canvas;
    box-shadow: 0 0 0 1px color-mix(in srgb, CanvasText 15%, transparent);
  }
  .toast {
    position: sticky;
    top: 0;
    z-index: 2;
    padding: 8px 12px;
    border-radius: 8px;
    background: color-mix(in srgb, #2f7de1 16%, Canvas);
    border: 1px solid color-mix(in srgb, #2f7de1 40%, transparent);
  }
</style>
