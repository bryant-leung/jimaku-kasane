/**
 * N2/N1 grammar patterns, written for this project, matched on kuromoji's dictionary forms so
 * conjugated forms count (得なかった, いかなかった). Each `core` is the pattern as text; an optional
 * `prefix|` gives the word before it so the parser splits it as in a real line ('行か|ざるを得ない').
 * Every pattern's `example` must match it (tested).
 */
import type { Morph } from './tokenizer';
import type { MorphToken } from './words';

export interface GrammarPoint {
  pattern: string;
  level: 1 | 2;
  meaning: string;
  cores: string[];
  example: string;
  /** For the few the parser splits unpredictably (勝/てっ/こ/ない): matched on the text instead. */
  re?: RegExp;
}

const g = (pattern: string, level: 1 | 2, meaning: string, cores: string[], example: string, re?: RegExp): GrammarPoint => ({
  pattern,
  level,
  meaning,
  cores,
  example,
  ...(re ? { re } : {}),
});

export const GRAMMAR: GrammarPoint[] = [
  // --- N2 ---
  g('～わけにはいかない', 2, "can't (for social or moral reasons)", ['わけにはいかない', 'わけにもいかない', 'わけにはいかん'], '今さらやめるわけにはいかない'),
  g('～ざるを得ない', 2, 'have no choice but to', ['行か|ざるを得ない', '行か|ざるをえない', 'せ|ざるを得ない', 'せ|ざるをえない'], '雨なので中止せざるを得なかった'),
  g('～に越したことはない', 2, "it's best to; nothing beats", ['に越したことはない', 'にこしたことはない'], '早く行くに越したことはない'),
  g('～にもかかわらず', 2, 'despite; even though', ['にもかかわらず', 'にも関わらず', 'にも拘らず'], '雨にもかかわらず試合は続いた'),
  g('～にかかわらず', 2, 'regardless of', ['にかかわらず', 'に関わらず'], '年齢にかかわらず誰でも参加できる'),
  g('～に違いない', 2, 'must be; no doubt', ['に違いない', 'にちがいない'], 'あれは久美子に違いない'),
  g('～に過ぎない', 2, 'merely; nothing more than', ['に過ぎない', 'にすぎない'], 'それは言い訳に過ぎない'),
  g('～に決まっている', 2, "surely; it's bound to be", ['に決まっている', 'に決まってる'], 'そんなの嘘に決まってる'),
  g('～わけがない', 2, "there's no way that", ['わけがない', 'わけはない'], 'そんなことあるわけがない'),
  g('～わけではない', 2, "it's not (necessarily) that", ['わけではない', 'わけじゃない', 'わけでもない'], '嫌いなわけじゃない'),
  g('～ばかりか', 2, 'not only … but also', ['ばかりか'], '彼は遅刻したばかりか宿題も忘れた'),
  g('～どころか', 2, 'far from; let alone', ['どころか'], '休むどころか、もっと練習した'),
  g('～どころではない', 2, 'no time for; out of the question', ['どころではない', 'どころじゃない', 'それどころじゃない', 'それどころではない'], '今はそれどころじゃない'),
  g('～に限らず', 2, 'not only; not limited to', ['に限らず', 'にかぎらず'], '子供に限らず大人も楽しめる'),
  g('～に限って', 2, 'of all (people, times); only when', ['に限って', 'にかぎって'], '急いでいる時に限って電車が遅れる'),
  g('～に沿って', 2, 'along; in line with', ['に沿って', 'に沿った', 'にそって'], '計画に沿って進める'),
  g('～に応じて', 2, 'according to; in response to', ['に応じて', 'に応じた'], 'レベルに応じて練習を変える'),
  g('～に基づいて', 2, 'based on', ['に基づいて', 'に基づく', 'にもとづいて'], '事実に基づいて話す'),
  g('～をめぐって', 2, 'concerning; over (a dispute)', ['をめぐって', 'を巡って', 'をめぐる'], 'ソロをめぐって二人が争った'),
  g('～を通じて', 2, 'through; throughout', ['を通じて', 'を通して'], '一年を通じて練習する'),
  g('～をきっかけに', 2, 'taking (it) as the start', ['をきっかけに', 'がきっかけで'], '演奏会をきっかけに仲良くなった'),
  g('～を問わず', 2, 'regardless of', ['を問わず', 'をとわず'], '経験を問わず歓迎します'),
  g('～に際して', 2, 'on the occasion of', ['入学|に際して', '入学|に際し'], '入学に際して説明会がある'),
  g('～につれて', 2, 'as (one thing changes, so does another)', ['練習する|につれて', '時間が経つ|につれ'], '練習するにつれて上手になった'),
  g('～に伴って', 2, 'along with; as', ['に伴って', 'に伴い', 'にともなって'], '人口の増加に伴って問題が増えた'),
  g('～に反して', 2, 'contrary to', ['に反して', 'に反し'], '予想に反して勝った'),
  g('～に加えて', 2, 'in addition to', ['に加えて', 'に加え'], '雨に加えて風も強い'),
  g('～にかけては', 2, 'when it comes to', ['にかけては', 'にかけても'], 'トランペットにかけては誰にも負けない'),
  g('～に関して', 2, 'regarding; about', ['に関して', 'に関する', 'に関しては'], 'この件に関して質問がある'),
  g('～からには', 2, 'now that; since (so must)', ['からには'], 'やるからには全国を目指す'),
  g('～以上は', 2, 'since; as long as', ['以上は'], '約束した以上は守る'),
  g('～かねない', 2, 'might well (something bad)', ['し|かねない'], 'このままだと失敗しかねない'),
  g('～かねる', 2, "can't (bring oneself to); hard to", ['し|かねる', 'し|かねます'], 'その質問にはお答えしかねます'),
  g('～っこない', 2, 'no way; not a chance', [], 'そんなの勝てっこない', /(?<=\S)っこない/),
  g('～がたい', 2, 'hard to (accept, believe)', ['信じ|がたい'], 'その話は信じがたい'),
  g('～ずにはいられない', 2, "can't help but", ['笑わ|ずにはいられない', '笑わ|ずにはいられません'], '泣かずにはいられなかった'),
  g('～てたまらない', 2, 'unbearably; dying to', ['会いたく|てたまらない', '会いたく|てたまらん', '心配|でたまらない'], '会いたくてたまらない'),
  g('～てならない', 2, "can't help feeling", ['思え|てならない'], '彼が嘘をついている気がしてならない'),
  g('～てしょうがない', 2, 'terribly; so much', ['会いたく|てしょうがない', '会いたく|て仕方がない', '会いたく|て仕方ない', '会いたく|てしかたがない', '心配|でしょうがない'], '眠くてしょうがない'),
  g('～ないことには', 2, 'unless', ['ないことには'], '練習しないことには上手にならない'),
  g('～とは限らない', 2, 'not necessarily', ['とは限らない', 'とはかぎらない', 'とは限らん'], '高いものがいいとは限らない'),
  g('～ことになっている', 2, "it's arranged that; the rule is", ['集まる|ことになっている', '集まる|ことになってる'], '明日は八時に集まることになっている'),
  g('～ものか', 2, "as if I would; certainly not", [], '負けるもんか', /(?:もの|もん)か(?=[！!。…\s」]|$)/),
  g('～がち', 2, 'tend to; apt to', ['忘れ|がち'], '最近は休みがちだ'),
  g('～おそれがある', 2, 'there is a risk that', ['おそれがある', '恐れがある', 'おそれもある'], '台風が来るおそれがある'),
  g('～つつある', 2, 'is in the process of', ['つつある'], '状況は変わりつつある'),
  g('～つつも', 2, 'although; while', ['知り|つつも'], '悪いと知りつつも、やってしまった'),
  g('～次第', 2, 'as soon as; depending on', ['次第', 'しだい'], '準備ができ次第、出発する'),
  g('～たとたん', 2, 'the moment (that)', ['開け|たとたん', '開け|た途端'], 'ドアを開けたとたん、猫が出てきた'),
  g('～かと思ったら', 2, 'just when (I thought)', ['かと思ったら', 'かと思うと', 'かと思えば'], '晴れたかと思ったら、また雨だ'),
  g('～ばかりに', 2, 'simply because (bad result)', ['ばかりに'], '一言多かったばかりに怒られた'),
  g('～わりに', 2, 'considering; for', ['練習した|わりに', '練習した|わりには', '安い|割に', '安い|割には'], '練習したわりに下手だ'),
  g('～反面', 2, 'on the other hand; while', ['反面'], '楽しい反面、大変だ'),
  g('～にしては', 2, "for (it's surprising)", ['にしては'], '初心者にしては上手だ'),
  g('～にしても', 2, 'even if; even so', ['にしても', 'にせよ'], '冗談にしてもひどい'),
  g('～としても', 2, 'even if', ['としても'], '負けたとしても後悔しない'),
  g('～たところで', 2, 'even if (it is no use)', ['謝っ|たところで'], '今さら謝ったところで遅い'),
  g('～ものなら', 2, 'if (one) could; if one dares', ['ものなら', 'もんなら'], '戻れるものなら戻りたい'),
  g('～てこそ', 2, 'only by; only when', ['てこそ'], '練習してこそ上手になる'),
  g('～からこそ', 2, 'precisely because', ['からこそ'], '好きだからこそ厳しくする'),
  g('～ほかない', 2, 'have no choice but', ['ほかない', 'ほかはない', 'よりほかない'], 'こうなったら諦めるほかない'),
  g('～ようがない', 2, 'there is no way to', [], '連絡のしようがない', /(?<=[しいきりちみびにえけせてねべめれ])よう(?:が|も)(?:ない|ねえ)/),
  g('～をもとに', 2, 'based on', ['をもとに', 'を元に', 'をもとにして'], '実話をもとに作られた'),
  g('～を中心に', 2, 'centred on', ['を中心に', 'を中心として'], '一年生を中心に練習する'),
  g('～に先立って', 2, 'prior to', ['に先立って', 'に先立ち'], '本番に先立って練習がある'),
  g('～とともに', 2, 'together with; as', ['とともに', 'と共に'], '仲間とともに戦う'),
  g('～において', 2, 'in; at (formal)', ['において', 'における', 'においては'], '大会において優勝した'),
  g('～ことなく', 2, 'without (ever)', ['ことなく'], '休むことなく練習した'),
  g('～てからでないと', 2, 'not until; unless first', ['てからでないと', 'てからじゃないと'], '確認してからでないと答えられない'),
  g('～ないうちに', 2, 'before (it happens)', ['ないうちに'], '雨が降らないうちに帰ろう'),
  g('～までもない', 2, 'needless to; no need to', ['言うまでもない', '言うまでもなく', '説明する|までもない', '説明する|までもなく'], '言うまでもない'),
  g('～ものがある', 2, 'there is something (striking)', ['ものがある'], '彼の演奏には心に響くものがある'),
  g('～というより', 2, 'rather than', ['というより', 'っていうより'], '上手というより天才だ'),
  g('～といえば', 2, 'speaking of', ['といえば', 'と言えば', 'といったら'], '夏といえば花火だ'),
  g('～はともかく', 2, 'setting aside', ['はともかく', 'はともかくとして'], '結果はともかく、よく頑張った'),
  g('～はもちろん', 2, 'not to mention', ['はもちろん', 'はもとより'], '練習はもちろん本番も大切だ'),
  g('～もかまわず', 2, 'without regard for', ['もかまわず', 'も構わず'], '人目もかまわず泣いた'),
  g('～をこめて', 2, 'with (feeling)', ['をこめて', 'を込めて'], '心を込めて演奏する'),
  g('～に代わって', 2, 'on behalf of; instead of', ['に代わって', 'に代わり', 'にかわって'], '先生に代わって説明する'),
  g('～上で', 2, 'after (doing); when', ['考え|た上で', '考え|たうえで'], 'よく考えた上で決める'),
  g('～あげく', 2, 'in the end (after much)', ['あげく', '挙げ句', '挙句'], '迷ったあげく、やめた'),
  g('～末に', 2, 'after a long (effort)', ['悩ん|だ末', '話し合い|の末'], '悩んだ末に決めた'),
  // --- N1 ---
  g('～にほかならない', 1, 'nothing but; none other than', ['にほかならない', 'に他ならない'], 'これは努力の結果にほかならない'),
  g('～ずにはおかない', 1, 'will certainly; cannot fail to', ['ずにはおかない', 'ずにはおかぬ'], 'その演奏は聴く人を感動させずにはおかない'),
  g('～ずにはすまない', 1, 'must; will have to', ['ずにはすまない', 'ずには済まない', 'ないではすまない'], '謝らずにはすまない'),
  g('～をよそに', 1, 'ignoring; in spite of', ['をよそに'], '親の心配をよそに遊んでいる'),
  g('～をものともせず', 1, 'in defiance of', ['をものともせず'], '雨をものともせず練習した'),
  g('～をおいて', 1, 'other than; except for', ['をおいて'], '彼女をおいて適任者はいない'),
  g('～を禁じ得ない', 1, "can't help feeling", ['を禁じ得ない', 'を禁じえない'], '同情を禁じ得ない'),
  g('～を余儀なくされる', 1, 'be forced to', ['を余儀なく', 'をよぎなく'], '中止を余儀なくされた'),
  g('～にかたくない', 1, 'not hard to (imagine)', ['にかたくない', 'に難くない'], '想像にかたくない'),
  g('～に足る', 1, 'worthy of; enough to', ['に足る'], '信頼に足る人物だ'),
  g('～に即して', 1, 'in accordance with', ['に即して', 'に即した', 'にそくして'], '事実に即して判断する'),
  g('～にひきかえ', 1, 'in contrast to', ['にひきかえ', 'に引き換え'], '兄にひきかえ弟は真面目だ'),
  g('～にもまして', 1, 'even more than', ['にもまして'], '以前にもまして練習している'),
  g('～ならでは', 1, 'unique to; only (X) could', [], 'この町ならではの景色だ', /ならでは/),
  g('～ならまだしも', 1, 'if it were …, maybe, but', ['ならまだしも'], '一回ならまだしも三回も遅刻した'),
  g('～とあって', 1, 'because (special circumstance)', ['とあって'], '休日とあって混んでいる'),
  g('～とあれば', 1, "if it's (for)", ['とあれば'], '君のためとあれば何でもする'),
  g('～といえども', 1, 'even though; even', ['といえども'], '子供といえども容赦しない'),
  g('～と相まって', 1, 'combined with', ['相まって', 'あいまって'], '才能と努力が相まって成功した'),
  g('～ともなると', 1, 'when it comes to (a higher level)', ['ともなると', 'ともなれば'], '全国大会ともなると緊張する'),
  g('～たりとも', 1, 'not even (one)', ['たりとも'], '一秒たりとも無駄にできない'),
  g('～すら', 1, 'even', ['すら', 'ですら'], '名前すら知らない'),
  g('～極まりない', 1, 'extremely', ['極まりない', 'きわまりない', '極まる'], '失礼極まりない'),
  g('～の極み', 1, 'the height of', ['の極み'], '光栄の極みです'),
  g('～の至り', 1, 'the utmost', ['の至り'], '若気の至りだった'),
  g('～んばかりに', 1, 'as if about to', ['言わ|んばかり'], '泣き出さんばかりの顔だった'),
  g('～が早いか', 1, 'no sooner than', ['が早いか'], 'ベルが鳴るが早いか教室を出た'),
  g('～や否や', 1, 'as soon as', ['や否や', 'やいなや'], '家に着くや否や寝てしまった'),
  g('～そばから', 1, 'as soon as (again and again)', ['そばから'], '覚えるそばから忘れる'),
  g('～ばそれまでだ', 1, "if …, that's the end of it", ['ばそれまで', 'たらそれまで'], '負ければそれまでだ'),
  g('～べからず', 1, 'must not', ['べからず', 'べからざる'], '関係者以外立ち入るべからず'),
  g('～べく', 1, 'in order to', ['べく'], '全国に行くべく練習を重ねた'),
  g('～まじき', 1, 'should not; unbecoming of', ['まじき'], '教師にあるまじき行為だ'),
  g('～ずくめ', 1, 'entirely; full of', ['こと|ずくめ', 'こと|づくめ'], '今日はいいことずくめだ'),
  g('～きらいがある', 1, 'has a tendency to (bad)', ['きらいがある'], '彼は物事を大げさに言うきらいがある'),
  g('～始末だ', 1, 'ended up (badly)', ['始末だ', 'しまつだ', '始末で'], '最後には泣き出す始末だ'),
  g('～に至っては', 1, 'as for; when it comes to (extreme)', ['に至っては', 'に至るまで', 'に至った'], '細かい点に至るまで確認した'),
  g('～をもって', 1, 'by means of; as of', ['本日|をもって', '本日|を以て'], '本日をもって閉店します'),
  g('～ではあるまいし', 1, "it's not as if", ['ではあるまいし', 'じゃあるまいし'], '子供じゃあるまいし、自分でやれ'),
  g('～てやまない', 1, 'never cease to (hope)', ['てやまない', 'てやみません'], '成功を願ってやまない'),
  g('～ずじまい', 1, 'ended up never', [], '結局言えずじまいだった', /ず(?:じまい|終い)/),
  g('～が最後', 1, 'once (it happens, that is it)', ['が最後', 'たら最後'], '彼に話したが最後、みんなに知られる'),
  g('～とばかりに', 1, 'as if to say', ['とばかりに', 'とばかり'], '今だとばかりに走り出した'),
  g('～いかんでは', 1, 'depending on', ['いかんでは', 'いかんによっては', 'いかんによらず', 'いかんにかかわらず'], '結果いかんでは中止もある'),
];

export interface GrammarMatch {
  point: GrammarPoint;
  /** Characters of the line the pattern covers. */
  start: number;
  length: number;
}

/** A part of a pattern: written in dictionary form, a verb, adjective or auxiliary may conjugate
 * (得ない → 得なかった); written conjugated (しろ, なら, べく) it must match exactly. */
type Want = { base: string; surface: string; free: boolean };
const key = (t: MorphToken) => (t.basic_form && t.basic_form !== '*' ? t.basic_form : t.surface_form);
const CONJUGATES = new Set(['動詞', '形容詞', '助動詞']);
const want = (t: MorphToken): Want => ({ base: key(t), surface: t.surface_form, free: CONJUGATES.has(t.pos) && key(t) === t.surface_form });
const same = (t: MorphToken, w: Want) => t.surface_form === w.surface || (w.free && key(t) === w.base);

export class GrammarMatcher {
  readonly compiled: { point: GrammarPoint; seqs: Want[][] }[];

  constructor(private readonly morph: Morph, points: readonly GrammarPoint[] = GRAMMAR) {
    this.compiled = points.map((point) => ({
      point,
      seqs: point.cores.flatMap((core) => {
        const [prefix, rest] = core.includes('|') ? (core.split('|') as [string, string]) : ['', core];
        const toks = morph.tokenize(prefix + rest);
        // Starts exactly where the pattern starts (a token split across the boundary can't match).
        const from = toks.findIndex((t) => t.word_position - 1 >= prefix.length);
        if (from < 0 || toks[from]!.word_position - 1 !== prefix.length) return [];
        return [toks.slice(from).map(want)];
      }),
    }));
  }

  /** Patterns in `text`; a pattern inside a longer one at the same place is dropped. */
  match(text: string, tokens: readonly MorphToken[] = this.morph.tokenize(text)): GrammarMatch[] {
    const found: GrammarMatch[] = [];
    for (const { point, seqs } of this.compiled) {
      const hit = point.re?.exec(text);
      if (hit) {
        found.push({ point, start: hit.index, length: hit[0].length });
        continue;
      }
      for (let i = 0; i < tokens.length; i++) {
        const seq = seqs.find((s) => s.length && s.every((w, j) => tokens[i + j] && same(tokens[i + j]!, w)));
        if (!seq) continue;
        const first = tokens[i]!;
        const last = tokens[i + seq.length - 1]!;
        const start = first.word_position - 1;
        found.push({ point, start, length: last.word_position - 1 + last.surface_form.length - start });
        break; // once per line
      }
    }
    return found.filter(
      (m) =>
        !found.some(
          (o) => o !== m && o.start <= m.start && m.start + m.length <= o.start + o.length && o.length > m.length,
        ),
    );
  }
}
