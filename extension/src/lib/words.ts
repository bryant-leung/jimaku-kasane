/**
 * Splits a subtitle line into words with kuromoji (IPADIC), the way a reader sees them: a verb or
 * adjective keeps its endings (弄んでいる, 勉強しなかった), names stay whole (久美子 is a name, not
 * 久 + 美 + 子), and kana words get their dictionary form (あきらめない → あきらめる → 諦める).
 */

/** The fields of a kuromoji IPADIC token used here. */
export interface MorphToken {
  surface_form: string;
  pos: string;
  pos_detail_1: string;
  pos_detail_2: string;
  basic_form: string;
  reading?: string;
  /** 1-based character position in the text. */
  word_position: number;
}

export type WordKind = 'word' | 'name' | 'particle' | 'symbol';

export interface WordGroup {
  start: number;
  length: number;
  surface: string;
  /** Dictionary form of the first part (弄ぶ for 弄んでいる); '' when unknown. */
  base: string;
  /** Reading in hiragana (whole group). */
  reading: string;
  kind: WordKind;
  /** kuromoji part of speech of the first part (動詞, 名詞, 助詞…). */
  pos: string;
  /** For names: Name, Place, Organisation or Proper noun. */
  label?: string;
}

const PROPER: Record<string, string> = { 人名: 'Name', 地域: 'Place', 組織: 'Organisation' };

/** Katakana → hiragana (ヴ and long marks kept). */
export const toHiragana = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

const isPredicate = (t: MorphToken) => t.pos === '動詞' || t.pos === '形容詞' || t.pos === '助動詞';

/** Does `t` continue the word that ended with `prev` (head = the word's first token)? */
function attaches(prev: MorphToken, head: MorphToken, t: MorphToken): boolean {
  if (head.pos === '名詞' && head.pos_detail_1 === '固有名詞') return false;
  // Endings on verbs and adjectives: 食べ|なかっ|た, 弄ん|で|いる, 食べ|たく|ない.
  if (isPredicate(prev) && t.pos === '助動詞') return true;
  if (isPredicate(prev) && (t.pos === '動詞' || t.pos === '形容詞') && (t.pos_detail_1 === '非自立' || t.pos_detail_1 === '接尾')) return true;
  if (isPredicate(prev) && t.pos === '助詞' && t.pos_detail_1 === '接続助詞' && (t.surface_form === 'て' || t.surface_form === 'で')) {
    return true;
  }
  if (prev.pos === '助詞' && prev.pos_detail_1 === '接続助詞' && t.pos === '動詞' && t.pos_detail_1 === '非自立') return true;
  // 勉強|する: a suru noun and its する.
  if (prev === head && head.pos === '名詞' && head.pos_detail_1 === 'サ変接続' && t.pos === '動詞' && t.basic_form === 'する') return true;
  return false;
}

function kindOf(t: MorphToken): { kind: WordKind; label?: string } {
  if (t.pos === '記号') return { kind: 'symbol' };
  if (t.pos === '名詞' && t.pos_detail_1 === '固有名詞') return { kind: 'name', label: PROPER[t.pos_detail_2] ?? 'Proper noun' };
  if (t.pos === '助詞' || t.pos === '助動詞') return { kind: 'particle' };
  return { kind: 'word' };
}

export function groupWords(tokens: readonly MorphToken[]): WordGroup[] {
  const groups: (WordGroup & { head: MorphToken; last: MorphToken })[] = [];
  for (const t of tokens) {
    const start = t.word_position - 1;
    const reading = toHiragana(t.reading && t.reading !== '*' ? t.reading : t.surface_form);
    const g = groups.at(-1);
    if (g && g.start + g.length === start && g.kind !== 'symbol' && attaches(g.last, g.head, t)) {
      g.length += t.surface_form.length;
      g.surface += t.surface_form;
      g.reading += reading;
      g.last = t;
      continue;
    }
    if (/^\s+$/.test(t.surface_form)) continue;
    groups.push({
      start,
      length: t.surface_form.length,
      surface: t.surface_form,
      base: t.basic_form && t.basic_form !== '*' ? t.basic_form : '',
      reading,
      pos: t.pos,
      ...kindOf(t),
      head: t,
      last: t,
    });
  }
  return groups.map(({ head: _h, last: _l, ...g }) => g);
}
