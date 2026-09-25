<script lang="ts">
  // Sidebar (SPEC §8.1): live tree of the current tab. Follows the active tab of its own
  // window; "opened from" / "opened here" links let you look at related tab sessions.
  import GraphView from '@/ui/GraphView.svelte';
  import NetworkView from '@/ui/NetworkView.svelte';
  import { buildView, type Row, type ViewMode } from '@/core/views';
  import { request, type ChangedMessage, type SessionPayload, type SessionSummary } from '@/background/protocol';
  import { shortUrl } from '@/core/describe';

  const MODES: { id: ViewMode; label: string; title: string }[] = [
    { id: 'tree', label: 'Tree', title: 'One node per visit; faint arcs join visits of the same page' },
    { id: 'moves', label: '+ Moves', title: 'Tree plus your back (blue) and forward (green) moves' },
    { id: 'network', label: 'Network', title: 'One node per page; repeated visits and returns show as cycles' },
  ];

  // ?tab=<id> / ?session=<id> / ?mode=<view> open the panel on a fixed tab or session,
  // e.g. as a normal tab for debugging and screenshots.
  const params = new URLSearchParams(location.search);
  const fixedTab = params.has('tab') ? Number(params.get('tab')) : undefined;

  let windowId = $state<number | undefined>();
  let tabId = $state<number | undefined>(fixedTab);
  let pinned = $state<string | null>(params.get('session'));
  let data = $state<SessionPayload | null>(null);
  let loaded = $state(false);
  let mode = $state<ViewMode>((params.get('mode') ?? localStorage.getItem('dude.mode') ?? 'tree') as ViewMode);
  let debug = $state<{ text: string; seq: number; logSize: number; sessions: number; visits: number } | null>(null);

  $effect(() => localStorage.setItem('dude.mode', mode));

  const view = $derived(data ? buildView(data, mode) : null);

  let pending = false;
  async function load() {
    if (pending) return;
    pending = true;
    try {
      data = await request<SessionPayload | null>(pinned ? { cmd: 'dude.session', sessionId: pinned } : { cmd: 'dude.session', tabId });
      loaded = true;
      if (debug) refreshDebug();
    } finally {
      pending = false;
    }
  }

  async function refreshDebug() {
    debug = await request({ cmd: 'dude.debug' });
  }

  $effect(() => {
    (async () => {
      const w = await browser.windows.getCurrent();
      windowId = w.id;
      if (fixedTab === undefined) {
        const [active] = await browser.tabs.query({ active: true, windowId });
        tabId = active?.id;
      }
      load();
    })();

    const onActivated = (info: { tabId: number; windowId: number }) => {
      if (info.windowId !== windowId || fixedTab !== undefined) return;
      tabId = info.tabId;
      pinned = null;
      load();
    };
    const onMessage = (m: ChangedMessage) => {
      if (m?.type !== 'dude.changed') return;
      // A restore can merge the tab into another session, so follow any change when unpinned.
      if (!pinned || m.sessionIds.includes(pinned)) load();
    };
    browser.tabs.onActivated.addListener(onActivated);
    browser.runtime.onMessage.addListener(onMessage);
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.runtime.onMessage.removeListener(onMessage);
    };
  });

  function show(s: SessionSummary | undefined) {
    if (!s) return;
    pinned = s.id;
    load();
  }
  function followTab() {
    pinned = null;
    load();
  }

  const open = (row: Row) => request({ cmd: 'dude.open', url: row.url });

  function tooltip(row: Row): string {
    if (!data) return row.url;
    const lines = [row.title ?? '', shortUrl(row.url)];
    for (const id of row.visitIds.slice(0, 1)) {
      const v = data.visits[id];
      if (!v) continue;
      if (v.searchQuery) lines.push(`search: ${v.searchQuery}`);
      if (v.anchorText) lines.push(`link: “${v.anchorText}”`);
      if (v.redirectChain.length) lines.push(`via: ${v.redirectChain.map(shortUrl).join(' → ')}`);
      if (v.method === 'post') lines.push('form POST — reopening may not show the same page');
      if (v.reloadCount) lines.push(`reloaded ${v.reloadCount}×`);
      if (v.dwellMs > 1000) lines.push(`viewed ${Math.round(v.dwellMs / 1000)} s`);
      lines.push(`${new Date(v.firstAt).toLocaleString()}  (${v.transition})`);
    }
    if (row.visits > 1) lines.push(`${row.visits} visits`);
    lines.push('Click to open in a new tab');
    return lines.filter(Boolean).join('\n');
  }

  function badge(row: Row) {
    if (!data || mode === 'network') return undefined;
    const kids = data.children.filter((c) => c.spawnedFromVisitId === row.key);
    if (!kids.length) return undefined;
    return {
      text: `↗${kids.length}`,
      title: `Opened from here in ${kids.length === 1 ? 'a new tab' : `${kids.length} new tabs`}:\n${kids.map((k) => k.title).join('\n')}`,
      onClick: () => show(kids[0]),
    };
  }

  const title = $derived.by(() => {
    if (!data) return '';
    const s = data.session;
    const cur = s.cursorId ? data.visits[s.cursorId] : undefined;
    return cur?.title ?? cur?.url ?? 'This tab';
  });
</script>

<main>
  <header>
    <div class="modes" role="tablist">
      {#each MODES as m}
        <button role="tab" aria-selected={mode === m.id} class:on={mode === m.id} title={m.title} onclick={() => (mode = m.id)}>{m.label}</button>
      {/each}
    </div>
    {#if pinned}
      <button class="link" onclick={followTab}>← back to the current tab</button>
    {/if}
    {#if data}
      <h1 title={title}>{title}</h1>
      {#if data.parent}
        <button class="link" onclick={() => show(data!.parent)} title="Show the tab this one was opened from">
          {data.session.spawnedFrom?.kind === 'duplicate' ? 'duplicated from' : 'opened from'}: {data.spawnVisit?.title ?? data.parent.title ?? '…'}
        </button>
      {/if}
      {#if data.session.closedAt !== undefined}<p class="note">This tab is closed.</p>{/if}
    {/if}
  </header>

  {#if view && view.rows.length}
    {#if mode === 'network'}
      {#key data?.session.id}
        <NetworkView {view} onOpen={open} {tooltip} />
      {/key}
    {:else}
      <GraphView {view} {mode} onOpen={open} {tooltip} {badge} />
    {/if}
    {#if data && data.children.length}
      <section class="children">
        <h2>Opened from this tab</h2>
        {#each data.children as c (c.id)}
          <button class="link" onclick={() => show(c)}>{c.kind === 'duplicate' ? '⧉' : '↗'} {c.title ?? '…'}{c.open ? '' : ' (closed)'}</button>
        {/each}
      </section>
    {/if}
  {:else if loaded}
    <p class="empty">Nothing recorded for this tab yet. Browser and extension pages (about:, moz-extension:) aren't recorded.</p>
  {/if}

  <footer>
    <button class="link" onclick={() => (debug ? (debug = null) : refreshDebug())}>{debug ? 'hide' : 'debug'}</button>
    <a href={browser.runtime.getURL('/sessions.html') + (data ? `?session=${data.session.id}` : '')} target="_blank">All sessions</a>
    <a href={browser.runtime.getURL('/s1.html')} target="_blank">S1 recorder</a>
  </footer>
  {#if debug}
    <section class="debug">
      <p>log {debug.logSize} · seq {debug.seq} · {debug.sessions} sessions · {debug.visits} visits
        <button class="link" onclick={() => request({ cmd: 'dude.rebuild' }).then(refreshDebug)}>rebuild from log</button>
      </p>
      <pre>{debug.text}</pre>
    </section>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    font: 13px/1.4 system-ui, sans-serif;
    color-scheme: light dark;
    background: Canvas;
    color: CanvasText;
  }
  main {
    padding: 8px 6px 24px 4px;
  }
  header {
    padding: 0 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .modes {
    display: flex;
    gap: 2px;
    background: color-mix(in srgb, CanvasText 8%, transparent);
    border-radius: 7px;
    padding: 2px;
    align-self: flex-start;
  }
  .modes button {
    all: unset;
    cursor: pointer;
    padding: 2px 9px;
    border-radius: 5px;
    font-size: 12px;
  }
  .modes button.on {
    background: Canvas;
    box-shadow: 0 0 0 1px color-mix(in srgb, CanvasText 15%, transparent);
  }
  h1 {
    font-size: 13px;
    font-weight: 600;
    margin: 4px 0 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  h2 {
    font-size: 12px;
    margin: 12px 0 4px;
    opacity: 0.7;
  }
  .link {
    all: unset;
    cursor: pointer;
    color: #2f7de1;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
  }
  .link:hover {
    text-decoration: underline;
  }
  .note,
  .empty {
    opacity: 0.7;
    margin: 4px 0;
    padding: 0 6px;
  }
  .children {
    padding: 0 6px;
  }
  footer {
    display: flex;
    gap: 12px;
    padding: 16px 6px 0;
    font-size: 11px;
    opacity: 0.6;
  }
  footer a {
    color: inherit;
  }
  .debug {
    padding: 0 6px;
    font-size: 11px;
  }
  .debug pre {
    white-space: pre;
    overflow-x: auto;
    font-size: 10.5px;
    line-height: 1.35;
  }
</style>
