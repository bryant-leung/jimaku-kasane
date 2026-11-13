import type { Cue } from './cue';

/** A finished Whisper line: `text` after the LLM correction step, `raw` straight from Whisper. */
export interface HypLine {
  start: number;
  end: number;
  text: string;
  raw: string;
}

export interface CompareStats {
  lines: number;
  /** Reference characters in the parts Whisper heard. */
  refChars: number;
  /** Character error rate of the corrected text, 0–1 (can exceed 1 with many insertions). */
  cer: number;
  /** Same, before correction: shows whether the correction step helps. */
  cerRaw: number;
  /** Median |Whisper start − subtitle start|, seconds; null with no matched pairs. */
  timingMedian: number | null;
  timingPairs: number;
}

// Speaker names and sound notes in brackets, then everything that isn't a letter or number.
const BRACKETS = /[（(［[〔【〈《][^）)］\]〕】〉》]*[）)］\]〕】〉》]/g;
const NOT_WORD = /[^\p{L}\p{N}]/gu;

/** Text as compared: NFKC, no brackets, spaces, punctuation or symbols (keeps ー, which is \p{L}m). */
export function normalizeJa(text: string): string {
  return text.normalize('NFKC').replace(BRACKETS, '').replace(NOT_WORD, '');
}

/** Levenshtein distance over code points. */
export function editDistance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  if (x.length === 0) return y.length;
  if (y.length === 0) return x.length;
  let prev = new Uint32Array(y.length + 1).map((_, j) => j);
  let cur = new Uint32Array(y.length + 1);
  for (let i = 1; i <= x.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const sub = prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1);
      cur[j] = Math.min(sub, prev[j]! + 1, cur[j - 1]! + 1);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[y.length]!;
}

/** Lines more than this apart start a new stretch (you paused, skipped, or started comparing later). */
const STRETCH_GAP_S = 30;
/** Subtitle lines this close to a stretch's edges still belong to it. */
const EDGE_S = 2;
/** Pairs further apart than this are different lines, not a timing error. */
const MAX_TIMING_S = 3;

/**
 * Whisper's lines vs the real subtitles (`ref`, already shifted by the file's offset).
 * Scored per stretch of continuous listening, so parts you skipped don't count as misses.
 */
export function compareLines(hyp: readonly HypLine[], ref: readonly Cue[]): CompareStats {
  const lines = [...hyp].sort((a, b) => a.start - b.start);
  const stretches: HypLine[][] = [];
  for (const l of lines) {
    const last = stretches.at(-1);
    if (last && l.start - last.at(-1)!.end < STRETCH_GAP_S) last.push(l);
    else stretches.push([l]);
  }
  let refChars = 0;
  let errors = 0;
  let errorsRaw = 0;
  for (const s of stretches) {
    const from = s[0]!.start - EDGE_S;
    const to = s.at(-1)!.end + EDGE_S;
    const mid = (c: Cue) => (c.start + c.end) / 2;
    const refText = normalizeJa(ref.filter((c) => mid(c) >= from && mid(c) <= to).map((c) => c.text).join(''));
    refChars += [...refText].length;
    errors += editDistance(normalizeJa(s.map((l) => l.text).join('')), refText);
    errorsRaw += editDistance(normalizeJa(s.map((l) => l.raw).join('')), refText);
  }
  // Timing: each Whisper line against the subtitle line that overlaps it most.
  const gaps: number[] = [];
  for (const l of lines) {
    let best: Cue | null = null;
    let bestOverlap = 0;
    for (const c of ref) {
      const overlap = Math.min(l.end, c.end) - Math.max(l.start, c.start);
      if (overlap > bestOverlap) [best, bestOverlap] = [c, overlap];
    }
    if (best && Math.abs(l.start - best.start) <= MAX_TIMING_S) gaps.push(Math.abs(l.start - best.start));
  }
  gaps.sort((a, b) => a - b);
  const median =
    gaps.length === 0
      ? null
      : gaps.length % 2
        ? gaps[(gaps.length - 1) / 2]!
        : (gaps[gaps.length / 2 - 1]! + gaps[gaps.length / 2]!) / 2;
  return {
    lines: lines.length,
    refChars,
    cer: refChars ? errors / refChars : 0,
    cerRaw: refChars ? errorsRaw / refChars : 0,
    timingMedian: median,
    timingPairs: gaps.length,
  };
}

/** One line for the popup. */
export function describeStats(s: CompareStats): string {
  if (s.lines === 0) return 'Comparing: waiting for Whisper\'s first line…';
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const timing = s.timingMedian === null ? '' : ` · timing off by ${s.timingMedian.toFixed(2)}s (median)`;
  return (
    `Whisper vs this file: ${s.lines} lines, ${s.refChars} chars · ` +
    `error rate ${pct(s.cer)} (before name correction ${pct(s.cerRaw)})${timing}`
  );
}
