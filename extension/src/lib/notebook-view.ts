/**
 * How the notebook page shows entries: one card per word (its sightings across episodes merged),
 * sorted and searched. Pure functions, so they can be tested without a browser.
 */
import { showName, type NotebookEntry } from './notebook';
import { toHiragana } from './words';

export interface WordCard {
  /** Word (or grammar pattern) + kind: one card per pair. */
  key: string;
  word: string;
  kind?: 'grammar';
  reading?: string;
  meaning?: string;
  level: string;
  /** Every sighting, newest first. */
  seen: NotebookEntry[];
  /** Distinct episodes it came up in. */
  episodes: number;
  first: number;
  last: number;
}

export type SortBy = 'seen' | 'hardest' | 'newest' | 'reading' | 'episode';

export const cardKey = (e: Pick<NotebookEntry, 'word' | 'kind'>) => `${e.kind ?? 'word'}|${e.word}`;

/** Merges sightings of the same word into cards. */
export function mergeCards(entries: readonly NotebookEntry[]): WordCard[] {
  const by = new Map<string, NotebookEntry[]>();
  for (const e of entries) by.set(cardKey(e), [...(by.get(cardKey(e)) ?? []), e]);
  return [...by.entries()].map(([key, seen]) => {
    seen.sort((a, b) => b.at - a.at);
    const top = seen.find((e) => e.meaning) ?? seen[0]!;
    return {
      key,
      word: top.word,
      ...(top.kind ? { kind: top.kind } : {}),
      ...(top.reading ? { reading: top.reading } : {}),
      ...(top.meaning ? { meaning: top.meaning } : {}),
      level: top.level,
      seen,
      episodes: new Set(seen.map((e) => e.episode)).size,
      first: seen.at(-1)!.at,
      last: seen[0]!.at,
    };
  });
}

/** Hardest first: N1, rare, N2, then easier lists; names and unknowns last. */
const RANK: Record<string, number> = { N1: 0, rare: 1, N2: 2, N3: 3, N4: 4, N5: 5, common: 6 };
export const difficulty = (level: string) => RANK[level] ?? 7;

/** Kana order key: hiragana reading (or the word), without the ～ of grammar patterns. */
const readingKey = (c: WordCard) => toHiragana((c.reading ?? c.word).replace(/^[～〜~]/, ''));

export function sortCards(cards: readonly WordCard[], by: SortBy): WordCard[] {
  const out = [...cards];
  const seen = (a: WordCard, b: WordCard) => b.episodes - a.episodes || b.seen.length - a.seen.length || b.last - a.last;
  switch (by) {
    case 'seen':
      return out.sort(seen);
    case 'hardest':
      return out.sort((a, b) => difficulty(a.level) - difficulty(b.level) || seen(a, b));
    case 'newest':
      return out.sort((a, b) => b.last - a.last);
    case 'reading':
      return out.sort((a, b) => readingKey(a).localeCompare(readingKey(b), 'ja'));
    case 'episode': {
      // In the order you met them: episode (by when you watched it), then time in the episode.
      const firstSeen = (c: WordCard) => c.seen.at(-1)!;
      return out.sort((a, b) => firstSeen(a).at - firstSeen(b).at || firstSeen(a).time - firstSeen(b).time);
    }
  }
}

/** Search text: hiragana and katakana match each other; English is case-insensitive. */
export const normalize = (s: string) => toHiragana(s.normalize('NFKC')).toLowerCase();

export function matchesQuery(c: WordCard, query: string): boolean {
  const q = normalize(query.trim());
  if (!q) return true;
  return [c.word, c.reading, c.meaning, ...c.seen.map((e) => e.line)].some((s) => s && normalize(s).includes(q));
}

/** Cards grouped by show: a word met in two shows appears in each, with that show's sightings. */
export function byShow(entries: readonly NotebookEntry[]): Map<string, WordCard[]> {
  const shows = new Map<string, NotebookEntry[]>();
  for (const e of entries) shows.set(showName(e), [...(shows.get(showName(e)) ?? []), e]);
  return new Map([...shows].map(([name, es]) => [name, mergeCards(es)]));
}
