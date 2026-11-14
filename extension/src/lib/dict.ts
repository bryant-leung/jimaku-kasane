import { deinflect, fitsClass } from './deinflect';
import type { WordGroup, WordKind } from './words';

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
  /** 1 = usually written in kana (する rather than 為る). */
  u?: 1;
  /** Example sentences (Tatoeba): [Japanese, English]. */
  x?: [string, string][];
  /** Subject fields of its meanings (JMdict codes: music, sports, food…). */
  t?: string[];
}

export interface WordMatch {
  /** Characters of the text the word covers. */
  length: number;
  /** Dictionary form found (食べる for 食べなかった). */
  term: string;
  entries: DictEntry[];
  /** Set when the word is a name (久美子): its kind and reading. */
  name?: { label: string; reading: string };
  /** Other lines of the loaded subtitle file with the same word (start in file time, seconds). */
  episode?: { text: string; start: number }[];
}

export interface Token {
  start: number;
  length: number;
  /** Easiest JLPT level among its entries (5 = N5), 0 = none. */
  level: number;
  common: boolean;
  /** From the word splitter: names, particles and symbols are never underlined. */
  kind?: WordKind;
  /** Hardest JLPT level among the word's kanji (5 = all N5 kanji; 0 = a kanji on no list). */
  kanjiLevel?: number;
  /** Not worth underlining whatever its list says: a pronoun, interjection, one character or a loanword. */
  plain?: boolean;
}

export const FORM_BUCKETS = 1024;
export const ENTRY_BUCKETS = 512;
const MAX_WORD = 12;

export type BucketLoader = (kind: 'forms' | 'entries' | 'kanji' | 'fields', bucket: number) => Promise<Record<string, unknown>>;

const KANJI = /[㐀-鿿豈-﫿々]/;
const KATAKANA = /^[゠-ヿー]+$/;
const HIRAGANA_WORD = /^[ぁ-ゖー]{2,}$/;
/** Characters a word never spans. */
const BREAK = /[\s、。！？!?「」『』（）()…・〜～♪,.:;'"―—-]/;

export class Dictionary {
  private readonly forms = new Map<number, Promise<Record<string, number[]>>>();
  private readonly entries = new Map<number, Promise<Record<string, Omit<DictEntry, 'id'>>>>();

  private kanjiLevels: Promise<Record<string, number>> | null = null;

  constructor(private readonly load: BucketLoader) {}

  /** JMdict subject field names by code ("food" → "food, cooking"). */
  fieldNames(): Promise<Record<string, string>> {
    return this.load('fields', 0).then((f) => f as Record<string, string>).catch(() => ({}));
  }

  /** Each kanji's easiest JLPT level (built by build-dict); empty if the file is missing. */
  private levels(): Promise<Record<string, number>> {
    return (this.kanjiLevels ??= this.load('kanji', 0).then((k) => k as Record<string, number>).catch(() => ({})));
  }

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

  /**
   * Entries for a word found by the word splitter: as written (deinflected), then its dictionary
   * form, then without a trailing と/に (漠然と → 漠然), then the longest word it starts with.
   */
  async lookupWord(g: WordGroup): Promise<WordMatch> {
    // Inflected verbs and adjectives: the dictionary form first (した is する, not 下).
    const inflects = g.pos === '動詞' || g.pos === '形容詞' || g.pos === '助動詞';
    const trimmed = /[とに]$/.test(g.surface) ? g.surface.slice(0, -1) : '';
    const tries = inflects ? [g.base, g.surface, trimmed] : [g.surface, g.base, trimmed];
    let hit: { term: string; entries: DictEntry[] } | null = null;
    for (const t of tries) if (t && !hit) hit = await this.find(t);
    if (!hit && g.kind !== 'name') {
      const m = await this.lookupAt(g.surface, 0);
      if (m) hit = { term: m.term, entries: m.entries };
    }
    // Entries of the same part of speech first: は the particle, not 歯 (tooth).
    if (hit) {
      const fits = (e: DictEntry) => (POS_CODES[g.pos] ?? []).some((c) => e.p.some((p) => p.startsWith(c)));
      hit = { ...hit, entries: [...hit.entries.filter(fits), ...hit.entries.filter((e) => !fits(e))] };
    }
    const name = g.kind === 'name' ? { label: g.label ?? 'Name', reading: g.reading } : undefined;
    return { length: g.length, term: hit?.term ?? g.surface, entries: hit?.entries ?? [], ...(name ? { name } : {}) };
  }

  /** Tokens for the overlay from the word splitter's groups. */
  async tokensFor(groups: readonly WordGroup[]): Promise<Token[]> {
    const out: Token[] = [];
    for (const g of groups) {
      if (g.kind === 'symbol') continue;
      const m = await this.lookupWord(g);
      // Level from the entries that fit the part of speech, when any do.
      const fitting = m.entries.filter((e) => (POS_CODES[g.pos] ?? []).some((c) => e.p.some((p) => p.startsWith(c))));
      const pool = fitting.length ? fitting : m.entries;
      const levels = await this.levels();
      const kanji = [...g.surface].filter((c) => KANJI.test(c) && c !== '々');
      const top = pool[0];
      out.push({
        start: g.start,
        length: g.length,
        level: pool.length ? Math.max(...pool.map((e) => e.l)) : 0,
        common: pool.some((e) => e.c === 1),
        kind: g.kind,
        ...(kanji.length && Object.keys(levels).length ? { kanjiLevel: Math.min(...kanji.map((c) => levels[c] ?? 0)) } : {}),
        ...((top && top.p.some((p) => p === 'pn' || p === 'int')) || g.surface.length === 1 || KATAKANA.test(g.surface)
          ? { plain: true }
          : {}),
      });
    }
    return out;
  }

  /** Splits a line into dictionary words, longest match first, left to right (fallback splitter). */
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

/** kuromoji (IPADIC) part of speech → JMdict part-of-speech code prefixes. */
const POS_CODES: Record<string, string[]> = {
  名詞: ['n', 'pn', 'adj-na', 'vs'],
  動詞: ['v'],
  形容詞: ['adj-i'],
  副詞: ['adv'],
  助詞: ['prt', 'conj'],
  助動詞: ['aux', 'cop'],
  感動詞: ['int'],
  連体詞: ['adj-pn', 'adj-f'],
  接続詞: ['conj'],
  接頭詞: ['pref'],
};

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
 * Marked: words on a harder JLPT list (unless built only from N5 kanji), words one level easier
 * written with a harder kanji (掴む, 喋る at N3 when logging harder than N3), and words on no list
 * that contain a kanji harder than your level. Words with kanji or long katakana; kana-only words
 * only when the word splitter found them (otherwise they are often particles glued together).
 * Never: names, particles, pronouns (あたし, 俺), interjections (ごめん), one-character words and
 * katakana loanwords (フレージング).
 */
export function isMarked(token: Token, text: string, above: number): boolean {
  if (above === 0) return false;
  if (token.kind && token.kind !== 'word') return false;
  if (token.plain) return false;
  const word = text.slice(token.start, token.start + token.length);
  // Kana words: only from the word splitter (dictionary form known), and only when on a JLPT
  // list; "rare" kana matches are mostly interjections and slang.
  if (token.kind === 'word' && HIRAGANA_WORD.test(word)) return token.level > 0 && token.level < above;
  if (!KANJI.test(word) && !(KATAKANA.test(word) && word.length >= 3)) return false;
  // On a JLPT list: by its level, unless every kanji in it is an N5 kanji (青春, 練習: readable).
  if (token.level > 0) {
    if (token.level < above) return token.kanjiLevel !== 5;
    // One level easier but niche: written with a kanji harder than the word (掴む, 喋る, 僅か at N3).
    return token.level === above && token.kanjiLevel !== undefined && token.kanjiLevel < above;
  }
  // A lone rare kanji is usually a piece of a name the splitter didn't know (黄|前|久美子).
  if (token.kind === 'word' && word.length === 1) return false;
  // On no list: only if it has a kanji harder than your level (弄ぶ), not 金賞 or 入部.
  if (token.kanjiLevel !== undefined) return token.kanjiLevel < above;
  return !token.common;
}

/** "N1", "N3"… or a description for words on no list. */
export function levelLabel(entry: DictEntry): string {
  if (entry.l) return `N${entry.l}`;
  return entry.c ? 'common' : 'rare';
}
