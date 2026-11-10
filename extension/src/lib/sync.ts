import type { Cue } from './cue';

/** Loudness of the speech band at a wall-clock moment (ms since epoch). */
export interface EnergyFrame {
  at: number;
  db: number;
}

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
  confidence: number;
  speechSeconds: number;
}

const BIN = 0.05; // seconds per bin
const MAX_SAMPLE_GAP_MS = 1000;
export const SEARCH_RANGE = 20; // ± seconds
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

/** 1 where the speech band is clearly above the noise floor, per 50 ms bin of video time. */
export function speechMask(points: { t: number; db: number }[]): { start: number; bins: Float32Array } {
  if (points.length === 0) return { start: 0, bins: new Float32Array() };
  const dbs = points.map((p) => p.db).sort((a, b) => a - b);
  const floor = dbs[Math.floor(dbs.length * 0.2)]!;
  const start = Math.min(...points.map((p) => p.t));
  const end = Math.max(...points.map((p) => p.t));
  const sum = new Float32Array(Math.floor((end - start) / BIN) + 1);
  const count = new Float32Array(sum.length);
  for (const p of points) {
    const i = Math.floor((p.t - start) / BIN);
    sum[i]! += p.db > floor + 8 ? 1 : 0;
    count[i]! += 1;
  }
  return { start, bins: sum.map((v, i) => (count[i] ? (v / count[i]! >= 0.5 ? 1 : 0) : Number.NaN)) };
}

/**
 * Finds the shift that best lines cue intervals up with detected speech.
 * A cue at time T shows at video time T + offset.
 */
export function bestOffset(mask: { start: number; bins: Float32Array }, cues: readonly Cue[]): SyncResult {
  const valid = [...mask.bins.keys()].filter((i) => !Number.isNaN(mask.bins[i]!));
  const speechSeconds = valid.reduce((n, i) => n + mask.bins[i]!, 0) * BIN;
  if (valid.length === 0 || speechSeconds < MIN_SPEECH_SECONDS) return { offset: null, confidence: 0, speechSeconds };

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
  return { offset: confidence >= MIN_CONFIDENCE ? offset : null, confidence, speechSeconds };
}

export function computeSync(frames: EnergyFrame[], samples: TimeSample[], cues: readonly Cue[]): SyncResult {
  return bestOffset(speechMask(toVideoTime(frames, samples)), cues);
}
