/** A single subtitle line, times in seconds. */
export interface Cue {
  start: number;
  end: number;
  text: string;
  /** 0–1 for machine-transcribed lines (Whisper); absent for real subtitle files. */
  confidence?: number;
  /** Draft of a line still being spoken; replaced when the line is finished. */
  partial?: boolean;
}

/** Cues showing at time `t` (seconds), in start order. Expects `cues` sorted by start. */
export function activeCues(cues: readonly Cue[], t: number): Cue[] {
  const out: Cue[] = [];
  for (const c of cues) {
    if (c.start > t) break;
    if (t < c.end) out.push(c);
  }
  return out;
}

/** Pressing replay this soon after a line starts goes to the line before it (like a music player's ⏮). */
const REPLAY_PREVIOUS_WITHIN_S = 1;
/** Start a little before the line so its first syllable isn't clipped. */
const REPLAY_LEAD_S = 0.15;

/**
 * Video time to jump to for "replay the current line": the start of the latest line that has
 * started (shifted by `offset`), or the one before it if that line only just started.
 * `cues` sorted by start; drafts ignored. Null when no line has started yet.
 */
export function replayTarget(cues: readonly Cue[], videoTime: number, offset: number): number | null {
  const t = videoTime - offset;
  const started = cues.filter((c) => !c.partial && c.start <= t + 0.05);
  let line = started.at(-1);
  if (line && t - line.start < REPLAY_PREVIOUS_WITHIN_S && started.length > 1) line = started.at(-2);
  return line ? Math.max(0, line.start + offset - REPLAY_LEAD_S) : null;
}
