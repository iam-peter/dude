// Periodic blob upkeep (E2, S2 #7): drop previews of visits looked at for under 3 s and
// previews older than 90 days (thumbnails stay), and delete blobs no visit references.
// The global size cap and user-facing retention settings come with M6.

import { deleteShots, deleteTexts, eachShot, eachText, putShot, type Shot } from '@/storage/db';
import type { Service } from './service';

const ALARM = 'dude.maintenance';
const MIN_DWELL_MS = 3000;
const PREVIEW_MAX_AGE_MS = 90 * 24 * 3600_000;
const ORPHAN_GRACE_MS = 10 * 60_000; // a blob is written just before its log entry

export function installMaintenance(service: Service) {
  browser.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 10 });
  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === ALARM) run(service).catch((e) => console.warn('dude: maintenance failed', e));
  });
}

export async function run(service: Service) {
  const now = Date.now();
  const refs = await service.media(now, MIN_DWELL_MS, PREVIEW_MAX_AGE_MS);
  const orphanShots: string[] = [];
  const prune: Shot[] = [];
  await eachShot((s) => {
    if (!refs.shots.has(s.id)) {
      if (now - s.t > ORPHAN_GRACE_MS) orphanShots.push(s.id);
    } else if (s.preview && refs.prunePreviews.has(s.id)) {
      prune.push(s);
    }
  });
  for (const s of prune) await putShot({ ...s, preview: undefined });
  await deleteShots(orphanShots);

  const orphanTexts: string[] = [];
  await eachText((x) => {
    if (!refs.texts.has(x.id) && now - x.t > ORPHAN_GRACE_MS) orphanTexts.push(x.id);
  });
  await deleteTexts(orphanTexts);
  return { previewsPruned: prune.length, shotsDeleted: orphanShots.length, textsDeleted: orphanTexts.length };
}
