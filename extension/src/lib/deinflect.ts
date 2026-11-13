/**
 * Turns an inflected Japanese word back into dictionary forms (食べなかった → 食べる), so a clicked
 * word can be found in JMdict. Rule-based like Yomitan's: each rule swaps a suffix and says which
 * word class the result is; rules chain (食べられなかった → 食べられない → 食べられる → 食べる).
 */

/** Word classes. `te` is the て-form (an intermediate, never a dictionary entry). */
export type WordClass = 'v1' | 'v5' | 'vk' | 'vs' | 'adj-i' | 'te';

interface Rule {
  from: string;
  to: string;
  /** Classes the inflected word may have for this rule to apply ([] = only the text as written). */
  in: WordClass[];
  out: WordClass;
}

export interface Deinflection {
  term: string;
  /** null = the text as written (any entry may match). */
  cls: WordClass | null;
  /** Steps taken, e.g. ['negative', 'past'] — not shown yet; useful for debugging. */
  depth: number;
}

const rules: Rule[] = [];
const add = (from: string, to: string, out: WordClass, ...inn: WordClass[]) => rules.push({ from, to, in: inn, out });

// Endings that come after a verb stem, and the class of the word they make.
const MASU = ['ます', 'ました', 'ません', 'ませんでした', 'ましょう', 'まして', 'ませんか'];

// Ichidan (食べる): stem + suffix.
for (const [suffix, ...inn] of [
  ['ない', 'adj-i'],
  ['た'],
  ['て', 'te'],
  ['たら'],
  ['たり'],
  ['れば'],
  ['よう'],
  ['ろ'],
  ['よ'],
  ['られる', 'v1'],
  ['れる', 'v1'], // ら抜き potential (食べれる)
  ['させる', 'v1'],
  ['させられる', 'v1'],
  ['たい', 'adj-i'],
  ['ず'],
  ['ずに'],
  ['ないで'],
  ['なきゃ'],
  ['なくちゃ'],
  ['ちゃう', 'v5'],
  ['ちゃった'],
  ...MASU.map((m) => [m]),
] as [string, ...WordClass[]][]) {
  add(suffix, 'る', 'v1', ...inn);
}

// Godan rows: dictionary ending → stems (a, i, e, o) and て/た forms.
const GODAN: [string, string, string, string, string, string, string][] = [
  ['う', 'わ', 'い', 'え', 'お', 'って', 'った'],
  ['く', 'か', 'き', 'け', 'こ', 'いて', 'いた'],
  ['ぐ', 'が', 'ぎ', 'げ', 'ご', 'いで', 'いだ'],
  ['す', 'さ', 'し', 'せ', 'そ', 'して', 'した'],
  ['つ', 'た', 'ち', 'て', 'と', 'って', 'った'],
  ['ぬ', 'な', 'に', 'ね', 'の', 'んで', 'んだ'],
  ['ぶ', 'ば', 'び', 'べ', 'ぼ', 'んで', 'んだ'],
  ['む', 'ま', 'み', 'め', 'も', 'んで', 'んだ'],
  ['る', 'ら', 'り', 'れ', 'ろ', 'って', 'った'],
];
for (const [u, a, i, e, o, te, ta] of GODAN) {
  add(`${a}ない`, u, 'v5', 'adj-i');
  add(`${a}ず`, u, 'v5');
  add(`${a}ずに`, u, 'v5');
  add(`${a}ないで`, u, 'v5');
  add(`${a}なきゃ`, u, 'v5');
  add(`${a}なくちゃ`, u, 'v5');
  add(`${a}れる`, u, 'v5', 'v1'); // passive
  add(`${a}せる`, u, 'v5', 'v1'); // causative
  add(`${a}せられる`, u, 'v5', 'v1');
  for (const m of MASU) add(`${i}${m}`, u, 'v5');
  add(`${i}たい`, u, 'v5', 'adj-i');
  add(`${e}る`, u, 'v5', 'v1'); // potential
  add(`${e}ば`, u, 'v5');
  add(e, u, 'v5'); // imperative
  add(`${o}う`, u, 'v5'); // volitional
  add(te, u, 'v5', 'te');
  add(ta, u, 'v5');
  add(`${ta}ら`, u, 'v5');
  add(`${ta}り`, u, 'v5');
  const voiced = te.endsWith('で');
  add(voiced ? `${te.slice(0, -1)}じゃう` : `${te.slice(0, -1)}ちゃう`, u, 'v5', 'v5');
  add(voiced ? `${te.slice(0, -1)}じゃった` : `${te.slice(0, -1)}ちゃった`, u, 'v5');
}
// 行く: 行って / 行った.
add('って', 'く', 'v5', 'te');
add('った', 'く', 'v5');

// て-form + auxiliary (ている, てる, てしまう…) → て-form.
for (const te of ['て', 'で']) {
  add(`${te}いる`, te, 'te', 'v1');
  add(`${te}る`, te, 'te', 'v1');
  add(`${te}しまう`, te, 'te', 'v5');
  add(`${te}おく`, te, 'te', 'v5');
  add(`${te}とく`, te, 'te', 'v5');
  add(`${te}くる`, te, 'te', 'vk');
  add(`${te}いく`, te, 'te', 'v5');
  add(`${te}ください`, te, 'te');
  add(`${te}くれる`, te, 'te', 'v1');
  add(`${te}もらう`, te, 'te', 'v5');
  add(`${te}あげる`, te, 'te', 'v1');
}

// する and 来る.
for (const [suffix, ...inn] of [
  ['しない', 'adj-i'],
  ['した'],
  ['して', 'te'],
  ['したら'],
  ['したり'],
  ['しよう'],
  ['すれば'],
  ['しろ'],
  ['せよ'],
  ['される', 'v1'],
  ['させる', 'v1'],
  ['できる', 'v1'],
  ['したい', 'adj-i'],
  ['せず'],
  ['せずに'],
  ['しないで'],
  ['しちゃう', 'v5'],
  ['しちゃった'],
  ...MASU.map((m) => [`し${m}`]),
] as [string, ...WordClass[]][]) {
  add(suffix, 'する', 'vs', ...inn);
}
for (const [kana, kanji] of [
  ['こない', '来ない'],
  ['きた', '来た'],
  ['きて', '来て'],
  ['きたら', '来たら'],
  ['こよう', '来よう'],
  ['くれば', '来れば'],
  ['こい', '来い'],
  ['こられる', '来られる'],
  ['こさせる', '来させる'],
  ['きたい', '来たい'],
  ...MASU.map((m) => [`き${m}`, `来${m}`]),
] as [string, string][]) {
  const inn: WordClass[] = kana.endsWith('ない') || kana.endsWith('たい') ? ['adj-i'] : kana.endsWith('て') ? ['te'] : kana.endsWith('る') ? ['v1'] : [];
  add(kana, 'くる', 'vk', ...inn);
  add(kanji, '来る', 'vk', ...inn);
}

// い-adjectives (高い).
for (const [suffix, ...inn] of [
  ['く'],
  ['かった'],
  ['かったら'],
  ['くない', 'adj-i'],
  ['くて'],
  ['ければ'],
  ['さ'],
  ['そう'],
  ['すぎる', 'v1'],
  ['くなる', 'v5'],
  ['くなかった'],
] as [string, ...WordClass[]][]) {
  add(suffix, 'い', 'adj-i', ...inn);
}

const MAX_DEPTH = 4;

/** Every way `text` could be an inflection of a dictionary word, the text itself first. */
export function deinflect(text: string): Deinflection[] {
  const out: Deinflection[] = [{ term: text, cls: null, depth: 0 }];
  const seen = new Set([`${text}|`]);
  for (let i = 0; i < out.length; i++) {
    const cur = out[i]!;
    if (cur.depth >= MAX_DEPTH) continue;
    for (const r of rules) {
      if (!cur.term.endsWith(r.from)) continue;
      if (cur.cls !== null && !r.in.includes(cur.cls)) continue;
      const term = cur.term.slice(0, cur.term.length - r.from.length) + r.to;
      if (term.length === 0 || term === r.to && r.to.length === 1) continue; // needs a stem
      const key = `${term}|${r.out}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ term, cls: r.out, depth: cur.depth + 1 });
    }
  }
  return out;
}

/** Does a JMdict entry with these parts of speech fit a deinflected word class? */
export function fitsClass(pos: readonly string[], cls: WordClass | null): boolean {
  if (cls === null) return true;
  switch (cls) {
    case 'v1':
      return pos.some((p) => p === 'v1' || p === 'v1-s');
    case 'v5':
      return pos.some((p) => p.startsWith('v5'));
    case 'vk':
      return pos.includes('vk');
    case 'vs':
      return pos.some((p) => p === 'vs-i' || p === 'vs-s' || p === 'vz');
    case 'adj-i':
      return pos.some((p) => p === 'adj-i' || p === 'adj-ix');
    case 'te':
      return false;
  }
}
