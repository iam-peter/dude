// Periodic blob upkeep (E2, E3, S2 #7): drop previews of visits looked at for under 3 s
// and previews older than the configured age (thumbnails stay), delete blobs no visit
// references, and keep screenshots under the size cap. Writes a storage report for the
// settings page.

import { capPlan } from '@/core/media';
import { deleteShots, deleteTexts, eachShot, eachText, logSize, putMeta, putShot, type Shot } from '@/storage/db';
import type { LiveSettings } from './settings';
import type { Service } from './service';

const ALARM = 'dude.maintenance';
const MIN_DWELL_MS = 3000;
const ORPHAN_GRACE_MS = 10 * 60_000; // a blob is written just before its log entry
export const REPORT_KEY = 'storageReport';

export interface StorageReport {
  at: number;
  shots: number;
  thumbBytes: number;
  previewBytes: number;
  texts: number;
  textBytes: number;
  observations: number;
  capBytes: number;
  usage?: number;
  quota?: number;
  previewsPruned: number;
  shotsDeleted: number;
  textsDeleted: number;
  cappedPreviews: number;
  cappedShots: number;
}

export function installMaintenance(service: Service, settings: LiveSettings) {
  browser.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 10 });
  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === ALARM) run(service, settings).catch((e) => console.warn('dude: maintenance failed', e));
  });
}

/** `graceMs: 0` right after a delete, so the deleted pages' blobs go at once. */
export async function run(service: Service, settings: LiveSettings, graceMs = ORPHAN_GRACE_MS): Promise<StorageReport> {
  await settings.ready;
  const now = Date.now();
  const { capMB, previewDays } = settings.settings;
  const refs = await service.media(now, MIN_DWELL_MS, previewDays * 864e5);
  const orphanShots: string[] = [];
  const prune: Shot[] = [];
  await eachShot((s) => {
    if (!refs.shots.has(s.id)) {
      if (now - s.t > graceMs) orphanShots.push(s.id);
    } else if (s.preview && refs.prunePreviews.has(s.id)) {
      prune.push(s);
    }
  });
  for (const s of prune) await putShot({ ...s, preview: undefined });
  await deleteShots(orphanShots);

  const orphanTexts: string[] = [];
  await eachText((x) => {
    if (!refs.texts.has(x.id) && now - x.t > graceMs) orphanTexts.push(x.id);
  });
  await deleteTexts(orphanTexts);

  // Size cap over what is left.
  const sizes: { id: string; t: number; thumb: number; preview: number }[] = [];
  const byId = new Map<string, Shot>();
  await eachShot((s) => {
    sizes.push({ id: s.id, t: s.t, thumb: s.thumb.size, preview: s.preview?.size ?? 0 });
    byId.set(s.id, s);
  });
  const capBytes = capMB * 1024 * 1024;
  const cap = capPlan(sizes, capBytes);
  for (const id of cap.dropPreviews) if (!cap.dropShots.includes(id)) await putShot({ ...byId.get(id)!, preview: undefined });
  await deleteShots(cap.dropShots);

  let textBytes = 0;
  let texts = 0;
  await eachText((x) => {
    texts++;
    textBytes += x.gz.size;
  });
  const kept = sizes.filter((s) => !cap.dropShots.includes(s.id));
  const est = await navigator.storage?.estimate?.().catch(() => undefined);
  const report: StorageReport = {
    at: now,
    shots: kept.length,
    thumbBytes: kept.reduce((n, s) => n + s.thumb, 0),
    previewBytes: kept.reduce((n, s) => n + (cap.dropPreviews.includes(s.id) ? 0 : s.preview), 0),
    texts,
    textBytes,
    observations: await logSize(),
    capBytes,
    usage: est?.usage,
    quota: est?.quota,
    previewsPruned: prune.length,
    shotsDeleted: orphanShots.length,
    textsDeleted: orphanTexts.length,
    cappedPreviews: cap.dropPreviews.length,
    cappedShots: cap.dropShots.length,
  };
  await putMeta(REPORT_KEY, report);
  return report;
}
