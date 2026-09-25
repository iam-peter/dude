<script lang="ts">
  // Settings (SPEC §8.2 item 5, §12): permissions, recording, storage, export/import,
  // Chrome history import, delete.
  import { request } from '@/background/protocol';
  import { KEYS, DEFAULTS, type Settings } from '@/background/settings';
  import type { StorageReport } from '@/background/maintenance';
  import type { CaptureAttempt } from '@/background/capture';
  import { pack, readAll, unpack, writeBlobs } from '@/storage/backup';

  const firefox = import.meta.env.BROWSER === 'firefox';
  const testHooks = __DUDE_TEST_HOOKS__;
  const welcome = location.hash === '#welcome';

  let hostAccess = $state<boolean | null>(null);
  let paused = $state(false);
  let deny = $state('');
  let denySaved = $state(true);
  let settings = $state<Settings>({ ...DEFAULTS });
  let report = $state<StorageReport | null>(null);
  let attempts = $state<CaptureAttempt[]>([]);
  const loadAttempts = async () => (attempts = await request<CaptureAttempt[]>({ cmd: 'dude.captureLog' }));
  let busy = $state<string | null>(null);
  let note = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);

  $effect(() => {
    (async () => {
      hostAccess = await browser.permissions.contains({ origins: ['<all_urls>'] });
      const r = await browser.storage.local.get([KEYS.denyHosts, KEYS.settings, KEYS.paused]);
      deny = ((r[KEYS.denyHosts] as string[] | undefined) ?? []).join('\n');
      settings = { ...DEFAULTS, ...((r[KEYS.settings] as Partial<Settings>) ?? {}) };
      paused = r[KEYS.paused] === true;
      report = await request<StorageReport | undefined>({ cmd: 'dude.storageReport' }) ?? null;
      await loadAttempts();
    })();
  });

  async function run<T>(label: string, fn: () => Promise<T>, ok: (r: T) => string) {
    busy = label;
    note = null;
    try {
      note = { kind: 'ok', text: ok(await fn()) };
    } catch (e) {
      note = { kind: 'err', text: String(e) };
    } finally {
      busy = null;
    }
  }

  const grant = () => browser.permissions.request({ origins: ['<all_urls>'] }).then((g) => (hostAccess = g));
  const setPaused = (p: boolean) => request({ cmd: 'dude.pause', paused: p }).then(() => (paused = p));
  const saveDeny = () =>
    browser.storage.local.set({ [KEYS.denyHosts]: deny.split(/\s+/).map((x) => x.trim()).filter(Boolean) }).then(() => (denySaved = true));
  const saveSettings = () => browser.storage.local.set({ [KEYS.settings]: $state.snapshot(settings) });
  const tidy = () => run('tidy', () => request<StorageReport>({ cmd: 'dude.maintenance' }), (r) => ((report = r), `Tidied up: ${r.previewsPruned + r.cappedPreviews} previews and ${r.shotsDeleted + r.cappedShots} screenshots removed.`));

  const mb = (n?: number) => {
    if (n === undefined) return '–';
    const [v, unit] = n >= 1024 ** 3 ? [n / 1024 ** 3, 'GB'] : n >= 1024 ** 2 ? [n / 1024 ** 2, 'MB'] : [n / 1024, 'KB'];
    return `${v.toFixed(v < 10 ? 1 : 0)} ${unit}`;
  };

  function exportAll() {
    run('export', async () => {
      const zip = pack(await readAll());
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([zip as unknown as BlobPart], { type: 'application/zip' }));
      a.download = `dude-export-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      return zip.length;
    }, (n) => `Exported ${mb(n)}.`);
  }

  function importFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    (e.currentTarget as HTMLInputElement).value = '';
    if (!file) return;
    if (!confirm(`Import “${file.name}”? It replaces everything recorded now.`)) return;
    run('import', async () => {
      const b = unpack(new Uint8Array(await file.arrayBuffer()));
      await writeBlobs(b);
      await request({ cmd: 'dude.importLog', observations: b.observations });
      return b;
    }, (b) => `Imported ${b.observations.length} observations, ${b.shots.length} screenshots and ${b.texts.length} page texts from ${b.exportedAt.slice(0, 10)}.`);
  }

  let days = $state(90);
  function importHistory() {
    // The permission prompt needs this click, so request before anything else awaits.
    const granted = browser.permissions.request({ permissions: ['history'] });
    run('history', async () => {
      if (!(await granted)) throw new Error('Permission to read the browser history was not granted.');
      return request<{ pages: number; visits: number }>({ cmd: 'dude.importHistory', days });
    }, (r) => `Imported ${r.visits} visits of ${r.pages} pages as read-only sessions.`);
  }

  let delHost = $state('');
  let delRange = $state<'hour' | 'day' | 'week'>('hour');
  function deleteDomain() {
    const host = delHost.trim();
    if (!host || !confirm(`Delete everything recorded on ${host} (and its subdomains)? This can't be undone.`)) return;
    run('delete', () => request<{ deleted: number }>({ cmd: 'dude.delete', what: { kind: 'domain', host } }), (r) => `Deleted ${r.deleted} observations for ${host}.`);
  }
  function deleteRange() {
    const span = { hour: 3600e3, day: 864e5, week: 7 * 864e5 }[delRange];
    const label = { hour: 'the last hour', day: 'the last 24 hours', week: 'the last 7 days' }[delRange];
    if (!confirm(`Delete everything recorded in ${label}? This can't be undone.`)) return;
    run('delete', () => request<{ deleted: number }>({ cmd: 'dude.delete', what: { kind: 'range', from: Date.now() - span, to: Date.now() + 60_000 } }), (r) => `Deleted ${r.deleted} observations from ${label}.`);
  }
  function deleteAll() {
    if (prompt('This deletes every session, screenshot and page text. Type DELETE to confirm.') !== 'DELETE') return;
    run('delete', () => request({ cmd: 'dude.deleteAll' }), () => 'Everything deleted. Open tabs are recorded again from now on.');
  }
</script>

<main>
  <header>
    <h1>dude</h1>
    <a href={browser.runtime.getURL('/sessions.html')}>All sessions →</a>
  </header>

  {#if note}<p class="note {note.kind}" role="status">{note.text}</p>{/if}

  <section class:welcome>
    <h2>{welcome ? 'Welcome — what dude records' : 'What dude records'}</h2>
    <p>
      dude keeps its own history next to the browser's: every tab as a tree of the pages you visited, with branches when you
      go back and follow another link, links between tabs opened from each other, a screenshot and the readable text of each
      page. Everything stays in this browser profile; dude makes no network requests.
    </p>
    <ul class="perms">
      <li><b>Navigation and tabs</b> — to see which page led to which, in every tab.</li>
      <li><b>Access to all websites</b> — to take screenshots, store page text and notice which link you clicked.</li>
      <li><b>Sessions</b> — to recognise a tab again after it was closed and restored, or after a browser restart.</li>
      <li><b>Storage</b> (unlimited) — screenshots need room; the size cap below keeps them in check.</li>
      <li><b>Alarms, context menu</b> — tidying up in the background; “Show where I came from” on right-click.</li>
    </ul>
    {#if hostAccess === false}
      <p class="warn">
        Website access isn’t granted yet{firefox ? ' (Firefox asks separately for it)' : ''}: without it there are no screenshots,
        no page text and no link texts.
        <button onclick={grant}>Grant access to all websites</button>
      </p>
    {:else if hostAccess}
      <p class="ok">Website access: granted.</p>
    {/if}
  </section>

  <section>
    <h2>Recording</h2>
    <label class="row"><input type="checkbox" checked={paused} onchange={(e) => setPaused(e.currentTarget.checked)} /> Pause recording in all tabs</label>
    <p class="hint">Single tabs can be paused from the toolbar popup. After a pause, the next page shows as reached “by an unknown way”.</p>
    <h3>Excluded sites</h3>
    <p class="hint">
      Pages on these sites are recorded only as an anonymous placeholder — no address, title, screenshot or text. Banking,
      payment, password-manager and crypto sites, and checkout/payment pages, are always excluded. One site per line:
      <code>example.com</code> covers its subdomains, <code>*.example.com</code> only the subdomains.
    </p>
    <textarea rows="5" bind:value={deny} oninput={() => (denySaved = false)} placeholder="intranet.example.com"></textarea>
    <button onclick={saveDeny} disabled={denySaved}>Save</button>
  </section>

  <section>
    <h2>Storage</h2>
    {#if report}
      <table>
        <tbody>
          <tr><th>Screenshots</th><td>{report.shots} · {mb(report.thumbBytes)} thumbnails + {mb(report.previewBytes)} previews</td></tr>
          <tr><th>Page texts</th><td>{report.texts} · {mb(report.textBytes)}</td></tr>
          <tr><th>Log</th><td>{report.observations} observations</td></tr>
          <tr><th>In total</th><td>{mb(report.usage)}{report.quota ? ` of ${mb(report.quota)} the browser allows` : ''}</td></tr>
        </tbody>
      </table>
      {#if report.thumbBytes + report.previewBytes >= report.capBytes * 0.98}<p class="warn">Screenshots are at the size cap: the oldest are being removed.</p>{/if}
      <p class="hint">Last tidied {new Date(report.at).toLocaleString()}.</p>
    {/if}
    <label class="row">Screenshot size cap <input type="number" min="100" step="100" bind:value={settings.capMB} onchange={saveSettings} /> MB</label>
    <label class="row">Keep full-size previews for <input type="number" min="1" bind:value={settings.previewDays} onchange={saveSettings} /> days</label>
    <p class="hint">
      Thumbnails of every page are kept; previews of pages you looked at for under 3 s are dropped. Over the cap, previews
      go first, oldest first, then the oldest screenshots. Page text and the history itself are never removed automatically.
    </p>
    <button onclick={tidy} disabled={!!busy}>{busy === 'tidy' ? 'Tidying…' : 'Tidy up now'}</button>

    <h3>Recent screenshot and text attempts</h3>
    <p class="hint">Why a page did or didn't get a screenshot or its text, newest first (since the browser started).</p>
    {#if attempts.length}
      <table class="attempts">
        <tbody>
          {#each attempts.slice(0, 20) as a}
            <tr class:good={a.ok}>
              <td>{new Date(a.t).toLocaleTimeString()}</td>
              <td>{a.what}</td>
              <td class="u" title={a.url}>{a.url.replace(/^https?:\/\//, '').slice(0, 60)}</td>
              <td>{a.outcome}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="hint">None yet.</p>
    {/if}
    <button onclick={loadAttempts}>Refresh</button>
  </section>

  <section>
    <h2>Export and import</h2>
    <p class="hint">A zip with the whole history, every screenshot and page text. Importing replaces what is recorded now.</p>
    <button onclick={exportAll} disabled={!!busy}>{busy === 'export' ? 'Exporting…' : 'Export everything'}</button>
    <label class="file"><input type="file" accept=".zip,application/zip" onchange={importFile} disabled={!!busy} /> {busy === 'import' ? 'Importing…' : 'Import from a file…'}</label>
  </section>

  {#if !firefox}
    <section>
      <h2>Import Chrome’s history</h2>
      <p class="hint">
        Turns Chrome’s own history into read-only sessions, using which page led to which. There are no screenshots or page
        texts for these. Asks for permission to read the history once.
      </p>
      <label class="row">Last <input type="number" min="1" max="365" bind:value={days} /> days</label>
      <button onclick={importHistory} disabled={!!busy}>{busy === 'history' ? 'Importing…' : 'Import history'}</button>
    </section>
  {/if}

  <section class="danger">
    <h2>Delete</h2>
    <p class="hint">Deleting removes the pages from dude’s history itself — not just from view — with their screenshots and texts.</p>
    <div class="row">
      <input type="text" placeholder="example.com" bind:value={delHost} />
      <button onclick={deleteDomain} disabled={!!busy || !delHost.trim()}>Delete this site</button>
    </div>
    <div class="row">
      <select bind:value={delRange}>
        <option value="hour">the last hour</option>
        <option value="day">the last 24 hours</option>
        <option value="week">the last 7 days</option>
      </select>
      <button onclick={deleteRange} disabled={!!busy}>Delete this time range</button>
    </div>
    <div class="row"><button class="bad" onclick={deleteAll} disabled={!!busy}>Delete everything…</button></div>
    <p class="hint">Single pages and sessions can be deleted from the sessions app.{#if testHooks} The S1 recorder’s raw spike log (test builds) is separate: clear it on the S1 page.{/if}</p>
  </section>
</main>

<style>
  :global(body) {
    margin: 0;
    font: 14px/1.5 system-ui, sans-serif;
    color-scheme: light dark;
    background: Canvas;
    color: CanvasText;
  }
  main {
    max-width: 760px;
    margin: 0 auto;
    padding: 20px 24px 60px;
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  h1 {
    margin: 0;
    font-size: 24px;
  }
  h2 {
    font-size: 16px;
    margin: 0 0 8px;
  }
  h3 {
    font-size: 14px;
    margin: 14px 0 4px;
  }
  section {
    border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    border-radius: 10px;
    padding: 14px 16px;
    margin-top: 14px;
  }
  section.welcome {
    border-color: #2f7de1;
    background: color-mix(in srgb, #2f7de1 6%, Canvas);
  }
  section.danger {
    border-color: color-mix(in srgb, #d33 50%, transparent);
  }
  .hint {
    font-size: 12.5px;
    opacity: 0.75;
    margin: 4px 0 8px;
  }
  .perms {
    margin: 6px 0;
    padding-left: 18px;
    font-size: 13px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 6px 0;
  }
  textarea,
  input[type='text'],
  input[type='number'],
  select {
    font: inherit;
    padding: 4px 7px;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    background: Canvas;
    color: CanvasText;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    font-family: ui-monospace, monospace;
    font-size: 12.5px;
  }
  input[type='number'] {
    width: 80px;
  }
  button,
  .file {
    font: inherit;
    padding: 5px 12px;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    background: Canvas;
    color: CanvasText;
    cursor: pointer;
    display: inline-block;
  }
  .file input {
    display: none;
  }
  button.bad {
    border-color: #d33;
    color: #d33;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  table {
    border-collapse: collapse;
    font-size: 13px;
    margin-bottom: 6px;
  }
  th {
    text-align: left;
    font-weight: normal;
    opacity: 0.7;
    padding: 2px 12px 2px 0;
  }
  table.attempts {
    font-size: 12px;
    width: 100%;
  }
  table.attempts td {
    padding: 1px 8px 1px 0;
    vertical-align: top;
  }
  table.attempts tr:not(.good) td:last-child {
    color: #c0392b;
  }
  table.attempts td.u {
    opacity: 0.75;
    word-break: break-all;
  }
  .note {
    padding: 8px 12px;
    border-radius: 8px;
  }
  .note.ok,
  .ok {
    color: #1f9d63;
  }
  .note.ok {
    background: color-mix(in srgb, #1f9d63 10%, Canvas);
  }
  .note.err,
  .warn {
    color: #c0392b;
  }
  .note.err {
    background: color-mix(in srgb, #c0392b 10%, Canvas);
  }
  code {
    font-size: 12px;
  }
</style>
