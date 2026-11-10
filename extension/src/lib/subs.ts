import type { Cue } from './cue';

/** Subtitles loaded for one tab. */
export interface SubsState {
  fileName: string;
  /** Identifies the subtitle release; the offset is stored per key. */
  fileKey: string;
  cues: Cue[];
}

export type ExtRequest =
  | { type: 'load-subs'; tabId: number; fileName: string; cues: Cue[] }
  | { type: 'get-subs'; tabId?: number };

export type LoadResult = { ok: true; count: number; fileKey: string } | { ok: false; error: string };

export interface SubsUpdated {
  type: 'subs-updated';
  state: SubsState;
}

export function fileKeyFor(fileName: string, cues: readonly Cue[]): string {
  const first = cues[0]?.start ?? 0;
  const last = cues.at(-1)?.end ?? 0;
  return `${fileName}|${cues.length}|${first}|${last}`;
}

/** Storage key for the offset of one subtitle release (storage.local). */
export const offsetKey = (fileKey: string) => `offset:${fileKey}`;

/** Rounds to 0.1 s so repeated ±0.1 steps don't drift (0.1 + 0.2 ≠ 0.3). */
export const roundOffset = (s: number) => Math.round(s * 10) / 10 || 0;

/** `+0.1s`, `-1.5s`. Positive offset = subtitles shown later. */
export const formatOffset = (s: number) => `${s < 0 ? '-' : '+'}${Math.abs(s).toFixed(1)}s`;
