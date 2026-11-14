/**
 * Picks the most useful words of an episode before it plays, so a dense show (A Certain Magical
 * Index) gives its best N words instead of flooding the notebook, while a light one (Euphonium)
 * still gives all of its few. Used when the whole subtitle file is known (not live transcription).
 */

import { isMarked, levelLabel, type Dictionary, type WordMatch } from './dict';
import type { Morph } from './tokenizer';
import { groupWords, nounRun, type WordGroup } from './words';

/** Setting: words logged per episode, most useful first (0 = all). */
export const PER_EPISODE_KEY = 'notebookPerEpisode';
export const DEFAULT_PER_EPISODE = 40;

export interface Candidate {
  /** Dictionary form as logged (諦める). */
  word: string;
  /** N1, N2, N3 (niche), rare. */
  level: string;
  /** JMdict "common": everyday Japanese, not a specialist or obscure term. */
  common: boolean;
  /** Lines of this episode it appears in. */
  count: number;
}

const LEVEL_WEIGHT: Record<string, number> = { N1: 3, rare: 2.5, N2: 2, N3: 1.5 };

/** Harder, everyday and recurring words first. */
export const usefulness = (c: Candidate) =>
  (LEVEL_WEIGHT[c.level] ?? 1) + (c.common ? 1.5 : 0) + Math.log2(Math.max(1, c.count));

export function planEpisode(candidates: readonly Candidate[], size: number): Set<string> {
  const ranked = [...candidates].sort((a, b) => usefulness(b) - usefulness(a) || b.count - a.count || a.word.localeCompare(b.word));
  return new Set((size > 0 ? ranked.slice(0, size) : ranked).map((c) => c.word));
}

/** Adds one sighting of a word to the candidates. */
export function addCandidate(into: Map<string, Candidate>, word: string, level: string, common: boolean): void {
  const c = into.get(word);
  if (c) c.count++;
  else into.set(word, { word, level, common, count: 1 });
}

/** The word as logged: names as written; others by their usual spelling (する, not 為る). */
export function wordOf(g: WordGroup, m: WordMatch): string {
  const e = m.entries[0];
  if (g.kind === 'name' || !e) return g.surface;
  return (e.u ? e.r[0] : e.k[0]) ?? e.r[0] ?? g.surface;
}

/**
 * Every word of an episode's lines harder than N`logAbove`, with how often it comes up. Leaves out
 * words not in the dictionary as a whole, and words mostly seen inside a run of nouns the
 * dictionary doesn't know (幻想 in 幻想殺し, 目録 in 禁書目録): terms made up for the show.
 */
export async function episodeCandidates(dict: Dictionary, morph: Morph, lines: readonly string[], logAbove: number): Promise<Candidate[]> {
  const candidates = new Map<string, Candidate>();
  const jargon = new Map<string, number>();
  const known = new Map<string, boolean>();
  for (const text of lines) {
    const groups = groupWords(morph.tokenize(text));
    for (const t of await dict.tokensFor(groups)) {
      if (!isMarked(t, text, logAbove)) continue;
      const i = groups.findIndex((x) => x.start === t.start);
      const g = groups[i]!;
      const m = await dict.lookupWord(g);
      const e = m.entries[0];
      if (m.partial || !e) continue;
      const word = wordOf(g, m);
      addCandidate(candidates, word, levelLabel(e), e.c === 1);
      const run = nounRun(groups, i);
      if (run) {
        const whole = groups.slice(run[0], run[1] + 1).map((x) => x.surface).join('');
        if (!known.has(whole)) known.set(whole, (await dict.lookupAt(whole, 0))?.length === whole.length);
        if (!known.get(whole)) jargon.set(word, (jargon.get(word) ?? 0) + 1);
      }
    }
  }
  return [...candidates.values()].filter((c) => (jargon.get(c.word) ?? 0) * 2 < c.count);
}

