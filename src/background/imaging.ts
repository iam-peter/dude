// Decode, hash and encode captures in the background (S2 #4: OffscreenCanvas + WebP work
// in Firefox's event page and in Chrome's service worker alike).

import { dHashFromGray } from '@/core/imagehash';

export const THUMB_W = 320;
export const PREVIEW_W = 1024; // S2 #7: 1024 px at q 0.7 keeps 90 days of previews near the 2 GB cap
const THUMB_Q = 0.75;
const PREVIEW_Q = 0.7;

export async function decode(dataUrl: string): Promise<ImageBitmap> {
  return createImageBitmap(await (await fetch(dataUrl)).blob());
}

/** WebP at `width` px wide, never upscaled (S2 #6). */
async function encodeWebp(src: ImageBitmap, width: number, quality: number): Promise<Blob> {
  const w = Math.min(width, src.width);
  const h = Math.max(1, Math.round((src.height * w) / src.width));
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  return c.convertToBlob({ type: 'image/webp', quality });
}

export const thumbnail = (src: ImageBitmap) => encodeWebp(src, THUMB_W, THUMB_Q);
export const preview = (src: ImageBitmap) => encodeWebp(src, PREVIEW_W, PREVIEW_Q);

export function dHash(src: ImageBitmap): string {
  const c = new OffscreenCanvas(9, 8);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(src, 0, 0, 9, 8);
  const d = g.getImageData(0, 0, 9, 8).data;
  const gray = new Array<number>(72);
  for (let i = 0; i < 72; i++) gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return dHashFromGray(gray);
}

export async function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

export async function gunzip(blob: Blob): Promise<string> {
  return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
}
