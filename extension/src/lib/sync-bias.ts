/**
 * Your usual correction to auto-sync, learned from manual changes after a sync (e.g. +0.3 s when
 * you like the Japanese line to follow the English hardsubs rather than the voice).
 *
 * Only small changes are a preference: a bigger one means auto-sync was wrong on that file, and
 * learning it would push every later sync off by the same amount. Kept per file (your last change
 * on it), and applied per show: the median of that show's files, else of all files.
 */
export const BIAS_LOG_KEY = 'syncBiasLog';
/** Manual changes up to this (after a sync) are taste; larger ones are fixes. */
export const MAX_PREFERENCE_S = 0.5;
export const BIAS_LOG_MAX = 20;

export interface BiasEntry {
  show?: number;
  /** Your offset minus the one auto-sync found, seconds. */
  d: number;
  at: number;
}
/** By subtitle file key. */
export type BiasLog = Record<string, BiasEntry>;

export function recordCorrection(log: BiasLog, fileKey: string, show: number | undefined, d: number, now: number): BiasLog {
  const next = { ...log };
  if (Math.abs(d) > MAX_PREFERENCE_S + 1e-9) delete next[fileKey];
  else next[fileKey] = { ...(show !== undefined ? { show } : {}), d, at: now };
  const newest = Object.entries(next).sort((a, b) => b[1].at - a[1].at).slice(0, BIAS_LOG_MAX);
  return Object.fromEntries(newest);
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** The correction to add to the next sync for `show`; `legacy` is the old single global value. */
export function biasFor(log: BiasLog | undefined, show: number | undefined, legacy?: number): number {
  const all = Object.values(log ?? {});
  const mine = show === undefined ? [] : all.filter((e) => e.show === show);
  const pick = mine.length ? mine : all;
  if (pick.length) return Math.round(median(pick.map((e) => e.d)) * 10) / 10 || 0;
  return legacy !== undefined && Math.abs(legacy) <= MAX_PREFERENCE_S + 1e-9 ? legacy : 0;
}
