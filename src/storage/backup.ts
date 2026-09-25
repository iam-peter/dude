// Export / import (E5): a zip with the observation log as JSON plus every screenshot and
// page text. Packing is pure (tested); the IndexedDB side is `readAll` / `writeBlobs`.
//
//   dude/log.json              { format, version, exportedAt, observations }
//   dude/shots.json            [{ id, t, hash, w, h, preview }]
//   dude/shots/<id>.thumb.webp, dude/shots/<id>.preview.webp
//   dude/texts.json            [{ id, t, url, title, chars }]
//   dude/texts/<id>.txt.gz

import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { Observation } from '@/core/observations';
import { eachShot, eachText, putShot, putText, replay, clearBlobs, type PageText, type Shot } from './db';

export const FORMAT = 'dude-export';
export const VERSION = 1;

export interface ShotData {
  id: string;
  t: number;
  hash: string;
  w: number;
  h: number;
  thumb: Uint8Array;
  preview?: Uint8Array;
}

export interface TextData {
  id: string;
  t: number;
  url: string;
  title?: string;
  chars: number;
  gz: Uint8Array;
}

export interface Backup {
  exportedAt: string;
  observations: Observation[];
  shots: ShotData[];
  texts: TextData[];
}

export function pack(b: Backup): Uint8Array {
  const files: Zippable = {};
  files['dude/log.json'] = strToU8(JSON.stringify({ format: FORMAT, version: VERSION, exportedAt: b.exportedAt, observations: b.observations }));
  files['dude/shots.json'] = strToU8(JSON.stringify(b.shots.map(({ thumb: _t, preview, ...m }) => ({ ...m, preview: !!preview }))));
  files['dude/texts.json'] = strToU8(JSON.stringify(b.texts.map(({ gz: _g, ...m }) => m)));
  // Images and gzip are compressed already.
  for (const s of b.shots) {
    files[`dude/shots/${s.id}.thumb.webp`] = [s.thumb, { level: 0 }];
    if (s.preview) files[`dude/shots/${s.id}.preview.webp`] = [s.preview, { level: 0 }];
  }
  for (const x of b.texts) files[`dude/texts/${x.id}.txt.gz`] = [x.gz, { level: 0 }];
  return zipSync(files, { level: 6 });
}

export function unpack(zip: Uint8Array): Backup {
  const f = unzipSync(zip);
  const log = f['dude/log.json'];
  if (!log) throw new Error('not a dude export (no dude/log.json)');
  const head = JSON.parse(strFromU8(log));
  if (head.format !== FORMAT) throw new Error('not a dude export');
  if (head.version > VERSION) throw new Error(`export version ${head.version} is newer than this dude (${VERSION})`);
  const shotMeta: (Omit<ShotData, 'thumb' | 'preview'> & { preview: boolean })[] = JSON.parse(strFromU8(f['dude/shots.json'] ?? strToU8('[]')));
  const textMeta: Omit<TextData, 'gz'>[] = JSON.parse(strFromU8(f['dude/texts.json'] ?? strToU8('[]')));
  const shots = shotMeta.flatMap(({ preview, ...m }) => {
    const thumb = f[`dude/shots/${m.id}.thumb.webp`];
    return thumb ? [{ ...m, thumb, preview: preview ? f[`dude/shots/${m.id}.preview.webp`] : undefined }] : [];
  });
  const texts = textMeta.flatMap((m) => (f[`dude/texts/${m.id}.txt.gz`] ? [{ ...m, gz: f[`dude/texts/${m.id}.txt.gz`] }] : []));
  return { exportedAt: head.exportedAt, observations: head.observations, shots, texts };
}

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
// fflate's arrays may sit on any ArrayBufferLike; Blob wants plain ArrayBuffer views.
const blob = (u: Uint8Array, type: string) => new Blob([u as unknown as BlobPart], { type });

/** Everything in the database, for `pack`. */
export async function readAll(): Promise<Backup> {
  const observations: Observation[] = [];
  await replay(0, (_, o) => observations.push(o));
  const shotRecs: Shot[] = [];
  await eachShot((s) => shotRecs.push(s));
  const textRecs: PageText[] = [];
  await eachText((x) => textRecs.push(x));
  const shots = await Promise.all(
    shotRecs.map(async (s) => ({ id: s.id, t: s.t, hash: s.hash, w: s.w, h: s.h, thumb: await bytes(s.thumb), preview: s.preview ? await bytes(s.preview) : undefined })),
  );
  const texts = await Promise.all(textRecs.map(async (x) => ({ id: x.id, t: x.t, url: x.url, title: x.title, chars: x.chars, gz: await bytes(x.gz) })));
  return { exportedAt: new Date().toISOString(), observations, shots, texts };
}

/** Replace all screenshots and texts with the backup's (the log goes through the background). */
export async function writeBlobs(b: Backup): Promise<void> {
  await clearBlobs();
  for (const s of b.shots) {
    await putShot({ id: s.id, t: s.t, hash: s.hash, w: s.w, h: s.h, thumb: blob(s.thumb, 'image/webp'), preview: s.preview && blob(s.preview, 'image/webp') });
  }
  for (const x of b.texts) await putText({ id: x.id, t: x.t, url: x.url, title: x.title, chars: x.chars, gz: blob(x.gz, 'application/gzip') });
}
