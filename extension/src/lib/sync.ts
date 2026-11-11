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
  /** Which video reported it (a page can have several, e.g. a muted background clip). */
  source?: string;
  /** On-screen area in px², and whether the video is silent. */
  area?: number;
  muted?: boolean;
}

/**
 * Keeps only the clock of the video the audio comes from: playing and audible, then the largest.
 * Mixing two videos' clocks scrambles the alignment.
 */
export function pickClock(samples: TimeSample[]): { samples: TimeSample[]; sources: number } {
  const groups = new Map<string, TimeSample[]>();
  for (const s of samples) {
    const key = s.source ?? '';
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const score = (g: TimeSample[]) => {
    const audible = g.some((s) => s.playing && !s.muted) ? 1 : 0;
    const area = Math.max(...g.map((s) => s.area ?? 0));
    return [audible, area, g.length];
  };
  const best = [...groups.values()].sort((a, b) => {
    const [x, y] = [score(a), score(b)];
    return y[0]! - x[0]! || y[1]! - x[1]! || y[2]! - x[2]!;
  })[0];
  return { samples: best ?? [], sources: groups.size };
}

export interface SyncResult {
  /** Offset to apply (positive = subtitles later), or null when no clear match. */
  offset: number | null;
  /** Best shift found even when not confident enough to apply (diagnostics). */
  bestGuess: number | null;
  confidence: number;
  /** Confidence required for the signal used. */
  needed?: number;
  speechSeconds: number;
}

const BIN = 0.05; // seconds per bin
const MAX_SAMPLE_GAP_MS = 1000;
export const SEARCH_RANGE = 60; // ± seconds (TV and streaming cuts can differ by tens of seconds)
export const MIN_CONFIDENCE = 4;
/** Caption-start matching scores higher on noise (wrong episode reached 5.3; right one 9.4). */
export const MIN_CONFIDENCE_GAPLESS = 7;
const MIN_SPEECH_SECONDS = 8;
/** Above this share of time covered by cues, subtitles are treated as gapless (TV captions). */
const GAPLESS_COVERAGE = 0.7;

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

  const steps = Math.round(SEARCH_RANGE / BIN);
  const n = mask.bins.length + 2 * steps;
  const firstT = mask.start - SEARCH_RANGE;

  // Signal 1 (gappy subtitle files): speech overlaps cue intervals.
  const coverage = new Float32Array(n);
  // Signal 2 (back-to-back TV captions, where intervals cover ~90% of the time): speech starts
  // line up with cue starts. Each start is a ±0.25 s triangle.
  const starts = new Float32Array(n);
  const spread = Math.round(0.25 / BIN);
  for (const c of cues) {
    const from = Math.max(0, Math.ceil((c.start - firstT) / BIN));
    const to = Math.min(n, Math.ceil((c.end - firstT) / BIN));
    for (let k = from; k < to; k++) coverage[k] = 1;
    const k0 = Math.round((c.start - firstT) / BIN);
    for (let d = -spread; d <= spread; d++) {
      const k = k0 + d;
      if (k >= 0 && k < n) starts[k] = Math.max(starts[k]!, 1 - Math.abs(d) / (spread + 1));
    }
  }
  // Speech onsets: how much speech rose over the previous 0.3 s.
  const lookback = Math.round(0.3 / BIN);
  const onset = new Float32Array(mask.bins.length);
  for (const i of valid) {
    let prev = 0;
    let k = 0;
    for (let j = Math.max(0, i - lookback); j < i; j++) {
      if (!Number.isNaN(mask.bins[j]!)) {
        prev += mask.bins[j]!;
        k++;
      }
    }
    onset[i] = Math.max(0, mask.bins[i]! - (k ? prev / k : 0));
  }

  const mean = valid.reduce((sum, i) => sum + mask.bins[i]!, 0) / valid.length;
  const onsetMean = valid.reduce((sum, i) => sum + onset[i]!, 0) / valid.length;
  const overlapScores: number[] = [];
  const startScores: number[] = [];
  for (let s = -steps; s <= steps; s++) {
    let overlap = 0;
    let start = 0;
    // speech at video time v pairs with the cue at v - offset
    for (const i of valid) {
      const k = i + steps - s;
      overlap += (mask.bins[i]! - mean) * coverage[k]!;
      start += (onset[i]! - onsetMean) * starts[k]!;
    }
    overlapScores.push(overlap);
    startScores.push(start);
  }
  // Back-to-back captions leave intervals with no timing information; use their starts instead.
  const covered = coverage.reduce((a, b) => a + b, 0) / n;
  const gapless = covered > GAPLESS_COVERAGE;
  const scores = gapless ? startScores : overlapScores;
  const needed = gapless ? MIN_CONFIDENCE_GAPLESS : MIN_CONFIDENCE;
  const best = scores.reduce((b, v, k) => (v > scores[b]! ? k : b), 0);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const sd = Math.sqrt(scores.reduce((a, v) => a + (v - avg) ** 2, 0) / scores.length) || 1;
  const confidence = (scores[best]! - avg) / sd;
  const offset = Math.round((best - steps) * BIN * 10) / 10 || 0;
  return { offset: confidence >= needed ? offset : null, bestGuess: offset, confidence, needed, speechSeconds };
}

export function computeSync(
  frames: EnergyFrame[],
  samples: TimeSample[],
  cues: readonly Cue[],
  mode: SyncMode = 'energy',
): SyncResult {
  return bestOffset(speechMask(toVideoTime(frames, pickClock(samples).samples), mode), cues);
}
