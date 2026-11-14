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

export type GroupBy = 'show' | 'episode' | 'level' | 'type' | 'pos' | 'none';

/** Part-of-speech group from JMdict codes (the first code decides: 勉強 n/vs is a noun). */
export function posGroup(codes: readonly string[] | undefined): string {
  const c = codes?.[0];
  if (!c) return 'Other';
  if (c.startsWith('v')) return 'Verbs';
  if (c.startsWith('adj-i')) return 'い-adjectives';
  if (c === 'adj-na') return 'な-adjectives';
  if (c.startsWith('adj')) return 'Other adjectives';
  if (c.startsWith('adv')) return 'Adverbs';
  if (c === 'exp') return 'Expressions';
  if (c === 'int') return 'Interjections';
  if (c === 'n' || c.startsWith('n-') || c === 'pn') return 'Nouns';
  return 'Other';
}

const POS_ORDER = ['Verbs', 'い-adjectives', 'な-adjectives', 'Other adjectives', 'Adverbs', 'Nouns', 'Expressions', 'Interjections', 'Other'];
const NAME_LEVELS = new Set(['Name', 'Place', 'Organisation', 'Proper noun']);
const typeOf = (c: WordCard) => (c.kind === 'grammar' ? 'Grammar' : NAME_LEVELS.has(c.level) ? 'Names' : 'Words');
const levelOf = (c: WordCard) => (c.kind === 'grammar' ? `${c.level} grammar` : c.level);

/**
 * Cards grouped for the page, groups in a sensible order and cards in `sort` order inside.
 * `posOf(card)` gives a word's part-of-speech codes (looked up for entries saved without them).
 */
export function groupCards(
  entries: readonly NotebookEntry[],
  by: GroupBy,
  sort: SortBy,
  posOf: (c: WordCard) => readonly string[] | undefined = (c) => c.seen.find((e) => e.pos)?.pos,
): [string, WordCard[]][] {
  const newest = (cards: WordCard[]) => Math.max(...cards.map((c) => c.last));
  if (by === 'none') return [['', sortCards(mergeCards(entries), sort)]];
  if (by === 'show' || by === 'episode') {
    const keyOf = (e: NotebookEntry) => (by === 'show' ? showName(e) : (e.title ?? e.fileName));
    const groups = new Map<string, NotebookEntry[]>();
    for (const e of entries) groups.set(keyOf(e), [...(groups.get(keyOf(e)) ?? []), e]);
    return [...groups]
      .map(([k, es]): [string, WordCard[]] => [k, sortCards(mergeCards(es), sort)])
      .sort(([, a], [, b]) => newest(b) - newest(a));
  }
  const cards = mergeCards(entries);
  const label = (c: WordCard) => (by === 'level' ? levelOf(c) : by === 'type' ? typeOf(c) : c.kind === 'grammar' ? 'Grammar' : posGroup(posOf(c)));
  const groups = new Map<string, WordCard[]>();
  for (const c of cards) groups.set(label(c), [...(groups.get(label(c)) ?? []), c]);
  const rank = (k: string) =>
    by === 'level'
      ? difficulty(k.replace(' grammar', '')) + (k.endsWith('grammar') ? 0.5 : 0)
      : by === 'type'
        ? ['Words', 'Grammar', 'Names'].indexOf(k)
        : [...POS_ORDER, 'Grammar'].indexOf(k);
  return [...groups].sort(([a], [b]) => rank(a) - rank(b)).map(([k, cs]) => [k, sortCards(cs, sort)]);
}

