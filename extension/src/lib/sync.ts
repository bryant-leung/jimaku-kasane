import type { Cue } from './cue';

/**
 * One audio measurement at a wall-clock moment (ms since epoch): speech-band loudness in dB
 * (`energy` mode) or voice probability 0–1 from the VAD model (`vad` mode).
 */
export interface EnergyFrame {
  at: number;
  db: number;
}

/** `vad`: voice probabilities (robust to music). `energy`: loudness fallback. */
export type SyncMode = 'vad' | 'energy';

/** The video's currentTime observed at a wall-clock moment. */
export interface TimeSample {
  at: number;
  t: number;
  playing: boolean;
  rate: number;
}

export interface SyncResult {
  /** Offset to apply (positive = subtitles later), or null when no clear match. */
  offset: number | null;
  /** Best shift found even when not confident enough to apply (diagnostics). */
  bestGuess: number | null;
  confidence: number;
  speechSeconds: number;
}

const BIN = 0.05; // seconds per bin
const MAX_SAMPLE_GAP_MS = 1000;
export const SEARCH_RANGE = 60; // ± seconds (TV and streaming cuts can differ by tens of seconds)
export const MIN_CONFIDENCE = 4;
const MIN_SPEECH_SECONDS = 8;

/** Maps audio frames onto video time using the latest time sample; drops paused or stale stretches. */
export function toVideoTime(frames: EnergyFrame[], samples: TimeSample[]): { t: number; db: number }[] {
  const sorted = [...samples].sort((a, b) => a.at - b.at);
  const out: { t: number; db: number }[] = [];
  let i = -1;
  for (const f of [...frames].sort((a, b) => a.at - b.at)) {
    while (i + 1 < sorted.length && sorted[i + 1]!.at <= f.at) i++;
    const s = sorted[i];
    if (!s || !s.playing || f.at - s.at > MAX_SAMPLE_GAP_MS) continue;
    out.push({ t: s.t + ((f.at - s.at) / 1000) * s.rate, db: f.db });
  }
  return out;
}

const LOCAL_WINDOW_S = 3;

/**
 * Speech activity per 50 ms bin of video time: loudness above the local average (3 s window),
 * clamped at 0. Subtracting the local average cancels steady background music, which would
 * otherwise make every bin look like speech.
 */
export function speechMask(
  points: { t: number; db: number }[],
  mode: SyncMode = 'energy',
): { start: number; bins: Float32Array; speechAbove: number } {
  if (points.length === 0) return { start: 0, bins: new Float32Array(), speechAbove: 0 };
  let start = Infinity;
  let end = -Infinity;
  for (const p of points) {
    start = Math.min(start, p.t);
    end = Math.max(end, p.t);
  }
  const n = Math.floor((end - start) / BIN) + 1;
  const sum = new Float64Array(n);
  const count = new Float64Array(n);
  for (const p of points) {
    const i = Math.floor((p.t - start) / BIN);
    sum[i]! += p.db;
    count[i]! += 1;
  }
  const level = Array.from(sum, (v, i) => (count[i] ? v / count[i]! : Number.NaN));
  // The VAD already separates voice from music: use its probability as is.
  if (mode === 'vad') return { start, bins: Float32Array.from(level), speechAbove: 0.5 };
  const half = Math.round(LOCAL_WINDOW_S / BIN / 2);
  const bins = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(level[i]!)) {
      bins[i] = Number.NaN;
      continue;
    }
    let total = 0;
    let k = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      if (!Number.isNaN(level[j]!)) {
        total += level[j]!;
        k++;
      }
    }
    bins[i] = Math.max(0, level[i]! - total / k);
  }
  return { start, bins, speechAbove: 3 };
}

/**
 * Finds the shift that best lines cue intervals up with detected speech.
 * A cue at time T shows at video time T + offset.
 */
export function bestOffset(
  mask: { start: number; bins: Float32Array; speechAbove: number },
  cues: readonly Cue[],
): SyncResult {
  const valid = [...mask.bins.keys()].filter((i) => !Number.isNaN(mask.bins[i]!));
  // Bins clearly above their surroundings count as speech for the "heard enough" check.
  const speechSeconds = valid.filter((i) => mask.bins[i]! > mask.speechAbove).length * BIN;
  const none = { offset: null, bestGuess: null, confidence: 0, speechSeconds };
  if (valid.length === 0 || speechSeconds < MIN_SPEECH_SECONDS) return none;

  const mean = valid.reduce((n, i) => n + mask.bins[i]!, 0) / valid.length;
  const steps = Math.round(SEARCH_RANGE / BIN);
  const inCue = (t: number) => cues.some((c) => c.start <= t && t < c.end);
  // Cue coverage on a grid wide enough for every shift.
  const firstT = mask.start - SEARCH_RANGE;
  const grid = Float32Array.from({ length: mask.bins.length + 2 * steps }, (_, k) => (inCue(firstT + k * BIN) ? 1 : 0));

  const scores: number[] = [];
  for (let s = -steps; s <= steps; s++) {
    let score = 0;
    // speech at video time v pairs with the cue at v - offset
    for (const i of valid) score += (mask.bins[i]! - mean) * grid[i + steps - s]!;
    scores.push(score);
  }
  const best = scores.reduce((b, v, k) => (v > scores[b]! ? k : b), 0);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const sd = Math.sqrt(scores.reduce((a, v) => a + (v - avg) ** 2, 0) / scores.length) || 1;
  const confidence = (scores[best]! - avg) / sd;
  const offset = Math.round((best - steps) * BIN * 10) / 10 || 0;
  return { offset: confidence >= MIN_CONFIDENCE ? offset : null, bestGuess: offset, confidence, speechSeconds };
}

export function computeSync(
  frames: EnergyFrame[],
  samples: TimeSample[],
  cues: readonly Cue[],
  mode: SyncMode = 'energy',
): SyncResult {
  return bestOffset(speechMask(toVideoTime(frames, samples), mode), cues);
}
