import { parseEpisodeTitle } from './episode';
import type { SubsState } from './subs';

/** One episode you watched with Japanese subtitles (storage.local, newest first). */
export interface HistoryEntry {
  /** Episode (or file, for manual loads): the same one again replaces the old entry. */
  key: string;
  /** "Show ep 44", or the file name. */
  title: string;
  source: 'jimaku' | 'whisper' | 'file' | 'page';
  fileName: string;
  /** Offset is looked up by this when shown (it changes while you watch). */
  fileKey: string;
  url?: string;
  at: string;
}

export const HISTORY_KEY = 'history';
export const HISTORY_MAX = 30;

export function historyEntry(state: SubsState, pageTitle: string | undefined, url: string | undefined, now = new Date()): HistoryEntry {
  const info = pageTitle ? parseEpisodeTitle(pageTitle) : null;
  return {
    key: state.episodeKey ?? `file:${state.fileKey}`,
    title: info ? `${info.title} ep ${info.episode}` : state.fileName,
    source: state.pageTrack ? 'page' : state.live ? 'whisper' : state.episodeKey ? 'jimaku' : 'file',
    fileName: state.fileName,
    fileKey: state.fileKey,
    url,
    at: now.toISOString(),
  };
}

/** Adds `entry` at the top; an older entry for the same episode is dropped. */
export function addToHistory(list: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [entry, ...list.filter((e) => e.key !== entry.key)].slice(0, HISTORY_MAX);
}
