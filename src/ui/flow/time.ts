// Time labels for the graph cards and the pauses between them.

/** Pauses shorter than this aren't labelled; a normal reading stretch. */
export const PAUSE_LABEL_MS = 30 * 60_000;

export const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** "45 min later", "2 h later", "3 days later". */
export function later(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min later`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h later`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} later`;
}
