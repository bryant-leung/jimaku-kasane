import type { CompareStats, HypLine } from './compare';
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
  /** AniList season of an auto-loaded file; the show's last offset is stored under it. */
  anilistId?: number;
  /** Lines transcribed live by the local Whisper server, added as they arrive. */
  live?: boolean;
}

export type AutoState = 'searching' | 'loaded' | 'not-found' | 'no-key' | 'error';

/** Automatic lookup status for a tab (storage.session `auto:<tabId>`). */
export interface AutoStatus {
  key: string;
  state: AutoState;
  message: string;
  /** When it was set (ms); a "not found" goes stale so new uploads get picked up. */
  at?: number;
}

/** Re-check Jimaku for an episode it didn't have after this long. */
export const NOT_FOUND_RETRY_MS = 30 * 60 * 1000;

export type ExtRequest =
  | { type: 'load-subs'; tabId: number; fileName: string; cues: Cue[] }
  | { type: 'get-subs'; tabId?: number }
  | { type: 'page-episode'; info: EpisodeInfo | null; title: string }
  | { type: 'video-found' }
  | { type: 'retry-auto'; tabId: number }
  | { type: 'sync-start'; tabId: number; streamId: string }
  | { type: 'prep-stop'; tabId: number }
  /** Popup: score Whisper against the loaded subtitle file while you watch (or stop). */
  | { type: 'compare-start'; tabId: number }
  | { type: 'compare-stop'; tabId: number }
  /** Your tab: you jumped to `t` (e.g. skipped the opening); the prepare-ahead copy follows. */
  | { type: 'viewer-seeked'; t: number };

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

/**
 * Last offset used for a show (storage.local). Releases from the same TV station sit the same
 * distance from the stream, so the next episode starts from it.
 */
export const showOffsetKey = (anilistId: number) => `showOffset:anilist:${anilistId}`;

/** Storage writes for a new offset: the file's, plus the show's when it was auto-loaded. */
export function offsetWrites(
  state: Pick<SubsState, 'fileKey' | 'anilistId' | 'live'>,
  offset: number,
): Record<string, number> {
  // Transcribed lines have their own timing: their offset says nothing about the show's subtitle files.
  const remember = state.anilistId !== undefined && !state.live;
  return {
    [offsetKey(state.fileKey)]: offset,
    ...(remember ? { [showOffsetKey(state.anilistId!)]: offset } : {}),
  };
}

/** Rounds to 0.1 s so repeated ±0.1 steps don't drift (0.1 + 0.2 ≠ 0.3). */
export const roundOffset = (s: number) => Math.round(s * 10) / 10 || 0;

/** `+0.1s`, `-1.5s`. Positive offset = subtitles shown later. */
export const formatOffset = (s: number) => `${s < 0 ? '-' : '+'}${Math.abs(s).toFixed(1)}s`;

export const autoKey = (tabId: number) => `auto:${tabId}`;
export const JIMAKU_KEY = 'jimakuKey';

/** On/off switches (storage.local): everything, or per site (hostname of the page, not the player). */
export const ENABLED_KEY = 'enabled';
/** Transcribe a minimized copy running ahead (default) instead of your tab live. */
export const PREPARE_AHEAD_KEY = 'prepareAhead';
export const DISABLED_SITES_KEY = 'disabledSites';

/** The page's hostname, also from inside a cross-origin player iframe. */
export function topHostname(): string {
  if (window === window.top) return location.hostname;
  const origins = location.ancestorOrigins;
  const top = origins?.[origins.length - 1];
  return top ? new URL(top).hostname : location.hostname;
}

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

/**
 * Automatic sync without a click: the frame playing the video reads its audio with
 * `video.captureStream()` and streams 16 kHz frames, tagged with video time, to the offscreen page.
 */
export interface AudioFrame {
  /** Video time at the frame's centre, seconds. */
  t: number;
  /** 512 samples, 16-bit. */
  pcm: number[];
}
export type AutoSyncMessage =
  /** `prior`: the show's remembered offset, if any; narrows the search. */
  | { type: 'auto-sync-begin'; tabId: number; fileKey: string; cues: Cue[]; prior?: number }
  | { type: 'auto-listen-start'; tabId: number; fileKey: string }
  | { type: 'auto-listen-stop'; tabId: number }
  /**
   * `source` identifies the video (a page may have a muted copy, e.g. an ambient glow). `from`: the
   * background copy ("prep", transcription only) or your own tab ("viewer").
   */
  | {
      type: 'auto-audio';
      tabId: number;
      fileKey: string;
      source: string;
      from: 'prep' | 'viewer';
      frames: AudioFrame[];
    }
  | { type: 'auto-sync-result'; tabId: number; fileKey: string; result: SyncResult; error?: string }
  /** Background → offscreen: more lines for a running sync (prepared lines keep arriving). */
  | { type: 'auto-sync-cues'; tabId: number; fileKey: string; cues: Cue[] }
  /** Offscreen → background: live progress for the popup. */
  | {
      type: 'auto-sync-progress';
      tabId: number;
      fileKey: string;
      heard: number;
      speech: number;
      bestGuess?: number | null;
      confidence?: number;
      needed?: number;
    }
  /** Content → background: the video's audio can't be read (e.g. cross-origin media). */
  | { type: 'auto-audio-error'; tabId: number; fileKey: string; error: string }
  /** Background → offscreen: transcribe this tab's speech with the local server. */
  | {
      type: 'live-begin';
      tabId: number;
      fileKey: string;
      anilistId?: number;
      title: string;
      drafts?: boolean;
      /** Whose audio to transcribe: your tab (default) or the prepare-ahead copy. */
      from?: 'viewer' | 'prep';
    }
  | { type: 'live-end'; tabId: number }
  /** Offscreen → background: one speech segment to transcribe (the background calls the server). */
  | {
      type: 'live-segment';
      tabId: number;
      fileKey: string;
      start: number;
      audio: string;
      anilistId?: number;
      title: string;
      /** Segment id; drafts and the finished line share it. */
      segId: number;
      partial: boolean;
    }
  /** Background → content: newly transcribed lines. */
  /** `prepared`: from the background copy running ahead, so already correctly timed. */
  | { type: 'subs-append'; fileKey: string; cues: Cue[]; segId?: number; prepared?: boolean }
  /** Background → the minimized copy: play muted and fast, send audio as the viewer's tab. */
  | { type: 'prep-start'; viewerTabId: number; fileKey: string }
  /** The minimized copy reached the end. */
  | { type: 'prep-done'; viewerTabId: number }
  /** The minimized copy reports whether it is really playing (some players need their own button). */
  | { type: 'prep-status'; viewerTabId: number; playing: boolean; t: number }
  /** Popup → background: stop preparing ahead, fall back to live. */
  | { type: 'prep-stop'; tabId: number }
  /** Background → the copy: you jumped to `t`; prepare from there. */
  | { type: 'prep-seek'; t: number }
  /** Background → content: draft of the line being spoken (not stored). */
  | { type: 'subs-partial'; fileKey: string; cues: Cue[]; segId: number };

/** The local transcription server (server/README.md). */
export const SERVER_URL = 'http://127.0.0.1:8765';

/** Offset found automatically for a subtitle file (storage.local); present = don't listen again. */
export const syncedKey = (fileKey: string) => `synced:${fileKey}`;

/**
 * Your usual correction to auto-sync (storage.local), e.g. +0.3 s when you like the Japanese line
 * to follow the English hardsubs rather than the voice. Learned from manual changes after a sync.
 */
export const SYNC_BIAS_KEY = 'syncBias';

export type SyncState = 'listening' | 'done' | 'failed';
export interface SyncStatus {
  state: SyncState;
  message: string;
  /** Set by the automatic (no-click) sync; the manual button stays usable meanwhile. */
  auto?: boolean;
}
export const syncKey = (tabId: number) => `sync:${tabId}`;

/** Compare mode (storage.session): Whisper's lines for the loaded file and the running score. */
export interface CompareState {
  fileKey: string;
  lines: HypLine[];
  stats: CompareStats | null;
  /** Set when it couldn't start (e.g. server not running). */
  error?: string;
}
export const compareKey = (tabId: number) => `compare:${tabId}`;
/** Finished scores per subtitle file (storage.local), for the evaluation report. */
export interface CompareReport {
  fileName: string;
  anilistId?: number;
  at: string;
  stats: CompareStats;
}
export const COMPARE_REPORTS_KEY = 'compareReports';
