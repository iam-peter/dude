<script lang="ts">
  // Toolbar popup (SPEC §8.1): how you got to the current page — its ancestor path, newest
  // at the bottom — plus the way into the sidebar tree and the sessions app.
  import { request, type SessionPayload } from '@/background/protocol';
  import type { Visit } from '@/core/model';
  import { shortUrl } from '@/core/describe';
  import { openPanel } from '@/platform';
  import { shotUrls } from '@/ui/shots';

  let windowId: number | undefined;
  let data = $state<SessionPayload | null>(null);
  let loaded = $state(false);
  let thumbs = $state<Record<string, string>>({});

  const path = $derived.by(() => {
    if (!data) return [] as Visit[];
    const out: Visit[] = [];
    for (let id = data.session.cursorId; id; id = data.visits[id]?.parentId) if (data.visits[id]) out.unshift(data.visits[id]);
    return out;
  });

  $effect(() => {
    (async () => {
      // ?tab=<id> shows another tab's path (debugging, screenshots)
      const fixed = new URLSearchParams(location.search).get('tab');
      const [tab] = fixed ? [await browser.tabs.get(Number(fixed))] : await browser.tabs.query({ active: true, currentWindow: true });
      windowId = tab?.windowId;
      data = tab?.id !== undefined ? await request<SessionPayload | null>({ cmd: 'dude.session', tabId: tab.id }) : null;
      loaded = true;
      const ids = path.map((v) => v.screenshots.at(-1)?.id).filter((x): x is string => !!x);
      thumbs = await shotUrls(ids);
    })();
  });

  // openPanel needs the click's user gesture, so call it before anything awaits.
  function showTree() {
    openPanel(windowId).catch(() => undefined);
    window.close();
  }
  function showSessions() {
    const url = browser.runtime.getURL('/sessions.html') + (data ? `?session=${data.session.id}` : '');
    browser.tabs.create({ url });
    window.close();
  }
  const meta = (v: Visit, i: number) =>
    [shortUrl(v.url), v.searchQuery && `search “${v.searchQuery}”`, i > 0 && v.anchorText && `via “${v.anchorText}”`].filter(Boolean).join(' · ');

  function open(v: Visit) {
    request({ cmd: 'dude.open', url: v.url, visitId: v.id });
    window.close();
  }
</script>

<main>
  {#if path.length > 1}
    <h1>You came here from</h1>
    <ol>
      {#each path as v, i (v.id)}
        {@const shot = v.screenshots.at(-1)}
        <li class:current={i === path.length - 1}>
          <button onclick={() => open(v)} title={`${v.url}\nOpen in a new tab`}>
            {#if shot && thumbs[shot.id]}<img src={thumbs[shot.id]} alt="" />{:else}<span class="ph">{#if v.favIconUrl}<img class="fav" src={v.favIconUrl} alt="" />{/if}</span>{/if}
            <span class="text">
              <span class="title">{v.title || shortUrl(v.url)}</span>
              <span class="meta">{meta(v, i)}</span>
            </span>
          </button>
        </li>
      {/each}
    </ol>
  {:else if loaded}
    <p class="empty">{path.length === 1 ? 'This is where this tab started.' : 'This tab isn’t recorded (browser or extension page).'}</p>
  {/if}
  {#if data?.parent}
    <p class="from">Tab opened from: {data.parent.title ?? '…'}</p>
  {/if}
  <footer>
    <button class="primary" onclick={showTree}>Show tree</button>
    <button onclick={showSessions}>All sessions</button>
  </footer>
</main>

<style>
  :global(body) {
    margin: 0;
    font: 13px/1.35 system-ui, sans-serif;
    color-scheme: light dark;
    background: Canvas;
    color: CanvasText;
  }
  main {
    width: 360px;
    padding: 10px;
  }
  h1 {
    font-size: 12px;
    font-weight: 600;
    margin: 0 0 6px;
    opacity: 0.7;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 420px;
    overflow-y: auto;
  }
  li button {
    all: unset;
    cursor: pointer;
    display: flex;
    gap: 8px;
    align-items: center;
    width: 100%;
    box-sizing: border-box;
    padding: 4px;
    border-radius: 6px;
  }
  li button:hover {
    background: color-mix(in srgb, CanvasText 8%, transparent);
  }
  li.current button {
    background: color-mix(in srgb, #2f7de1 14%, transparent);
  }
  li:not(:last-child) {
    position: relative;
  }
  img,
  .ph {
    width: 72px;
    height: 41px;
    object-fit: cover;
    object-position: top;
    border-radius: 4px;
    flex: none;
    background: color-mix(in srgb, CanvasText 10%, transparent);
    display: grid;
    place-items: center;
  }
  img.fav {
    width: 16px;
    height: 16px;
    background: none;
  }
  .text {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .title,
  .meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .current .title {
    font-weight: 600;
  }
  .meta {
    font-size: 11px;
    opacity: 0.6;
  }
  .empty,
  .from {
    opacity: 0.7;
    margin: 4px 0;
  }
  footer {
    display: flex;
    gap: 6px;
    margin-top: 10px;
  }
  footer button {
    flex: 1;
    padding: 5px 8px;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
    font: inherit;
  }
  footer button.primary {
    background: #2f7de1;
    border-color: #2f7de1;
    color: white;
  }
</style>
