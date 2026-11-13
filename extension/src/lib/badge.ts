import type { AutoStatus, SubsState } from './subs';

export interface Badge {
  text: string;
  color: string;
  /** Toolbar tooltip. */
  title: string;
}

const NAME = 'JimakuKasane';
const GREEN = '#2e7d32';
const PURPLE = '#6a1b9a';
const GREY = '#616161';
const RED = '#c62828';

/** What the toolbar icon shows for a tab: JP file · AI transcription · … working · ! needs you. */
export function badgeFor(input: {
  enabled: boolean;
  subs?: SubsState;
  auto?: AutoStatus;
  preparing?: boolean;
}): Badge {
  const { enabled, subs, auto, preparing } = input;
  if (!enabled) return { text: '', color: GREY, title: `${NAME}: off` };
  if (subs && !subs.live) return { text: 'JP', color: GREEN, title: `${NAME}: Japanese subtitles loaded (${subs.fileName})` };
  if (subs?.live) {
    if (preparing && subs.cues.length === 0) {
      return { text: '…', color: GREY, title: `${NAME}: preparing Japanese lines with Whisper` };
    }
    return { text: 'AI', color: PURPLE, title: `${NAME}: Japanese lines transcribed by Whisper (may contain mistakes)` };
  }
  if (auto?.state === 'searching') return { text: '…', color: GREY, title: `${NAME}: looking for Japanese subtitles` };
  if (auto && ['not-found', 'no-key', 'error'].includes(auto.state)) {
    return { text: '!', color: RED, title: `${NAME}: ${auto.message}` };
  }
  return { text: '', color: GREY, title: NAME };
}
