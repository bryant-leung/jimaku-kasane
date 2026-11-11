import type { Cue } from './cue';
import type { EpisodeInfo } from './episode';
import type { SyncResult, TimeSample } from './sync';

/** Subtitles loaded for one tab. */
export interface SubsState {
  fileName: string;
  /** Identifies the subtitle release; the offset is stored per key. */
  fileKey: string;
  cues: Cue[];
  /** Set when loaded automatically for this episode. */
  episodeKey?: string;
}

export type AutoState = 'searching' | 'loaded' | 'not-found' | 'no-key' | 'error';

/** Automatic lookup status for a tab (storage.session `auto:<tabId>`). */
export interface AutoStatus {
  key: string;
  state: AutoState;
  message: string;
}

export type ExtRequest =
  | { type: 'load-subs'; tabId: number; fileName: string; cues: Cue[] }
  | { type: 'get-subs'; tabId?: number }
  | { type: 'page-episode'; info: EpisodeInfo | null; title: string }
  | { type: 'video-found' }
  | { type: 'retry-auto'; tabId: number }
  | { type: 'sync-start'; tabId: number; streamId: string };

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

export const autoKey = (tabId: number) => `auto:${tabId}`;
export const JIMAKU_KEY = 'jimakuKey';

/** Audio auto-sync messages between popup, background, offscreen page and content scripts. */
export type SyncMessage =
  | { type: 'sync-capture'; tabId: number; streamId: string; cues: Cue[] }
  | { type: 'sync-time-start'; tabId: number; seconds: number }
  | { type: 'sync-time-stop' }
  | { type: 'sync-time'; tabId: number; sample: TimeSample }
  | {
      type: 'sync-result';
      tabId: number;
      result: SyncResult;
      error?: string;
      mode?: 'vad' | 'energy';
      /** Diagnostics: videos that reported a clock, audio frames analysed, clock samples used. */
      clocks?: number;
      frames?: number;
      samples?: number;
    };

export type SyncState = 'listening' | 'done' | 'failed';
export interface SyncStatus {
  state: SyncState;
  message: string;
}
export const syncKey = (tabId: number) => `sync:${tabId}`;
