import { deinflect, fitsClass } from './deinflect';

/** Compact JMdict entry as built by scripts/build-dict.mjs. */
export interface DictEntry {
  id: number;
  /** Kanji spellings, readings. */
  k: string[];
  r: string[];
  /** Parts of speech (JMdict codes). */
  p: string[];
  /** Senses: [parts of speech, glosses]. */
  s: [string, string][];
  /** JLPT level 1–5 (5 = N5), 0 = not on the lists. */
  l: number;
  /** 1 = common word (JMdict priority). */
  c: 0 | 1;
}

export interface WordMatch {
  /** Characters of the text the word covers. */
  length: number;
  /** Dictionary form found (食べる for 食べなかった). */
  term: string;
  entries: DictEntry[];
}

export interface Token {
  start: number;
  length: number;
  /** Easiest JLPT level among its entries (5 = N5), 0 = none. */
  level: number;
  common: boolean;
}

export const FORM_BUCKETS = 1024;
export const ENTRY_BUCKETS = 512;
const MAX_WORD = 12;

export type BucketLoader = (kind: 'forms' | 'entries', bucket: number) => Promise<Record<string, unknown>>;

const KANJI = /[㐀-鿿豈-﫿々]/;
const KATAKANA = /^[゠-ヿー]+$/;
/** Characters a word never spans. */
const BREAK = /[\s、。！？!?「」『』（）()…・〜～♪,.:;'"―—-]/;

export class Dictionary {
  private readonly forms = new Map<number, Promise<Record<string, number[]>>>();
  private readonly entries = new Map<number, Promise<Record<string, Omit<DictEntry, 'id'>>>>();

  constructor(private readonly load: BucketLoader) {}

  private async idsFor(form: string): Promise<number[]> {
    const b = form.codePointAt(0)! % FORM_BUCKETS;
    if (!this.forms.has(b)) this.forms.set(b, this.load('forms', b) as Promise<Record<string, number[]>>);
    return (await this.forms.get(b)!)[form] ?? [];
  }

  private async entry(id: number): Promise<DictEntry | null> {
    const b = id % ENTRY_BUCKETS;
    if (!this.entries.has(b)) this.entries.set(b, this.load('entries', b) as Promise<Record<string, Omit<DictEntry, 'id'>>>);
    const e = (await this.entries.get(b)!)[id];
    return e ? { id, ...e } : null;
  }

  /**
   * Entries for `text` as written or as an inflection of a dictionary form. Every reading of the
   * inflection counts (行って: 行く and 行う); the likeliest comes first.
   */
  private async find(text: string): Promise<{ term: string; entries: DictEntry[] } | null> {
    let best: { term: string; entries: DictEntry[] } | null = null;
    const all: DictEntry[] = [];
    for (const d of deinflect(text)) {
      const found: DictEntry[] = [];
      for (const id of await this.idsFor(d.term)) {
        const e = await this.entry(id);
        if (e && fitsClass(e.p, d.cls)) found.push(e);
      }
      // 勉強する / 勉強しない → the noun 勉強 (a "suru noun": its entry lists vs).
      if (!found.length && (d.cls === 'vs' || d.cls === null) && d.term.endsWith('する') && d.term.length > 2) {
        for (const id of await this.idsFor(d.term.slice(0, -2))) {
          const e = await this.entry(id);
          if (e?.p.includes('vs')) found.push(e);
        }
      }
      if (!found.length) continue;
      for (const e of found) if (!all.some((a) => a.id === e.id)) all.push(e);
      const top = rank(found, d.term)[0]!;
      if (!best || score(top, d.term) > score(best.entries[0]!, best.term)) best = { term: d.term, entries: [top] };
    }
    if (!best) return null;
    return { term: best.term, entries: [best.entries[0]!, ...rank(all, text).filter((e) => e.id !== best.entries[0]!.id)] };
  }

  /** The longest dictionary word starting at `start` in `text`. */
  async lookupAt(text: string, start: number): Promise<WordMatch | null> {
    let end = start;
    while (end < text.length && end - start < MAX_WORD && !BREAK.test(text[end]!)) end++;
    for (let len = end - start; len >= 1; len--) {
      const hit = await this.find(text.slice(start, start + len));
      if (!hit) continue;
      // 今日は is a greeting, but usually 今日 + は: drop a trailing particle when the rest is a common word.
      if (len > 1 && PARTICLES.includes(text[start + len - 1]!)) {
        const shorter = await this.find(text.slice(start, start + len - 1));
        if (shorter?.entries.some((e) => e.c)) return { length: len - 1, ...shorter };
      }
      return { length: len, ...hit };
    }
    return null;
  }

  /** Splits a line into dictionary words, longest match first, left to right. */
  async segment(text: string): Promise<Token[]> {
    const tokens: Token[] = [];
    let i = 0;
    while (i < text.length) {
      const m = BREAK.test(text[i]!) ? null : await this.lookupAt(text, i);
      if (!m) {
        i++;
        continue;
      }
      tokens.push({
        start: i,
        length: m.length,
        level: Math.max(...m.entries.map((e) => e.l)),
        common: m.entries.some((e) => e.c === 1),
      });
      i += m.length;
    }
    return tokens;
  }
}

const PARTICLES = ['は', 'が', 'を', 'の', 'に', 'へ', 'と', 'も', 'で'];

/** Common words first, then easier JLPT words, then spelled exactly like `term` (main spelling best). */
function score(e: DictEntry, term: string): number {
  const spelled = e.k.includes(term) || e.r.includes(term) ? 2 : 0;
  const usual = e.k[0] === term || (e.k.length === 0 && e.r[0] === term) ? 1 : 0; // its main spelling
  return (e.c ? 20 : 0) + e.l * 3 + spelled + usual;
}
function rank(entries: DictEntry[], term: string): DictEntry[] {
  return [...entries].sort((a, b) => score(b, term) - score(a, term));
}

/**
 * Should this word be underlined for someone comfortable up to N`above` (0 = never)?
 * Marked: words on a harder JLPT list, and uncommon words on no list. Only words with kanji or
 * long katakana: kana-only matches are often particles glued together.
 */
export function isMarked(token: Token, text: string, above: number): boolean {
  if (above === 0) return false;
  const word = text.slice(token.start, token.start + token.length);
  if (!KANJI.test(word) && !(KATAKANA.test(word) && word.length >= 3)) return false;
  if (token.level > 0) return token.level < above;
  return !token.common;
}

/** "N1", "N3"… or a description for words on no list. */
export function levelLabel(entry: DictEntry): string {
  if (entry.l) return `N${entry.l}`;
  return entry.c ? 'common' : 'rare';
}
