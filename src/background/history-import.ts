// Import Chrome's native history (E7) as read-only sessions: every visit of the last
// `days` days with its referringVisitId, logged as `history.import` observations so the
// import survives rebuilds. Chrome only; Firefox's referrer data is unreliable (spec §12).

import type { ImportedVisit, Observation } from '@/core/observations';
import { isRecordable } from '@/core/url';
import type { LiveSettings } from './settings';
import type { Service } from './service';

const CHUNK = 500;

interface HistoryApi {
  search(q: { text: string; startTime: number; maxResults: number }): Promise<{ url?: string; title?: string }[]>;
  getVisits(q: { url: string }): Promise<{ visitId: string; referringVisitId: string; visitTime?: number; transition: string }[]>;
}

export async function importChromeHistory(service: Service, settings: LiveSettings, days: number): Promise<{ pages: number; visits: number }> {
  const history = (browser as unknown as { history?: HistoryApi }).history;
  if (!history) throw new Error('history permission not granted');
  await settings.ready;
  const start = Date.now() - days * 864e5;
  const pages = await history.search({ text: '', startTime: start, maxResults: 100_000 });
  const items: ImportedVisit[] = [];
  for (const p of pages) {
    // Deny-listed sites are skipped outright (D6).
    if (!p.url || !isRecordable(p.url) || settings.isExcluded(p.url)) continue;
    for (const v of await history.getVisits({ url: p.url })) {
      if (!v.visitTime || v.visitTime < start) continue;
      items.push({ id: v.visitId, ref: v.referringVisitId && v.referringVisitId !== '0' ? v.referringVisitId : undefined, at: v.visitTime, url: p.url, title: p.title, transition: v.transition });
    }
  }
  items.sort((a, b) => a.at - b.at);
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    service.enqueue((): Observation[] => [{ type: 'history.import', t: Date.now(), items: chunk }]);
  }
  return { pages: pages.length, visits: items.length };
}
