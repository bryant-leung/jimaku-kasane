/**
 * Underlines and notebook logging only for words that are actually challenging: never pronouns
 * (あたし, 俺), interjections (ごめん), one-character words (部) or katakana loanwords (フレージング);
 * JLPT-listed words built only from N5 kanji (青春, 練習) are skipped; words on no list count only
 * if they contain a kanji harder than your level (弄ぶ yes, 金賞 / 入部 no).
 * Since PR 46 the line is drawn by real-use frequency (difficulty score), not the JLPT lists alone.
 * Test IDs: docs/archive/TEST_PLAN-2026-11.md P2-Q1..P2-Q5.
 *
 * Run: npm run test:e2e -- e2e/pr-33-harder-words.spec.ts
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { test as unit } from '@playwright/test';
import { Dictionary, isMarked } from '../extension/src/lib/dict';
import { loadTokenizer, type Morph } from '../extension/src/lib/tokenizer';
import { groupWords } from '../extension/src/lib/words';
import { SITE, expect, loadFile, openPopup, overlayIn, test } from './fixtures/extension';

const KUROMOJI = path.join(path.dirname(createRequire(import.meta.url).resolve('kuromoji/package.json')), 'dict');

unit.describe('what counts as challenging', () => {
  let morph: Morph;
  const dict = new Dictionary(async (kind, b) => JSON.parse(gunzipSync(readFileSync(`extension/public/dict/${kind}/${b}.json.gz`)).toString()));
  unit.beforeAll(async () => {
    morph = await loadTokenizer(async (f) => {
      const b = gunzipSync(readFileSync(path.join(KUROMOJI, f)));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    });
  });
  const marked = async (s: string, above: number) =>
    (await dict.tokensFor(groupWords(morph.tokenize(s)))).filter((t) => isMarked(t, s, above)).map((t) => s.slice(t.start, t.start + t.length));

  // P2-Q1
  unit('P2-Q1 easy words from a real episode are not underlined or logged', async () => {
    for (const s of ['私はあたしが決める', '俺もごめん今行く', '青春のフレージング', '全国大会で金賞を取る', '吹奏楽部に入部した', '先輩の演奏、すごかった', '練習しないと上手くならない']) {
      expect(await marked(s, 3), s).toEqual([]); // not even when logging harder than N3
    }
  });

  // P2-Q2
  unit('P2-Q2 genuinely hard words still are', async () => {
    // Since PR 46 by real-use frequency: 携わる, 拒む, 措置, 該当 are common in news, so not at N2.
    const hard = ['漠然', '弄ぶ', '嘲笑', '緻密', '臆病', '煩わしい'];
    for (const w of hard) expect(await marked(w, 2), w).toEqual([w]); // N1 / beyond the lists: underlined for an N2 learner
    for (const w of ['曖昧', '圧巻', '顕著', '妥協', '携わる', '拒む']) expect(await marked(w, 3), w).toEqual([w]); // logged at the N3 setting
  });

  // P2-Q5
  unit('P2-Q5 N3 words that are rare in real use are logged at the N3 setting; everyday N3 words are not', async () => {
    for (const w of ['悪戯', '叱る']) expect(await marked(w, 3), w).toEqual([w]);
    for (const w of ['掴む', '喋る', '僅か', '覚悟', '途端', '練習']) expect(await marked(w, 3), w).toEqual([]);
    expect(await marked('悪戯', 2)).toEqual([]); // not underlined for an N2 learner
  });

  // P2-Q3
  unit('P2-Q3 the kanji levels come from the word lists (not from kana-written words)', async () => {
    const levels = JSON.parse(gunzipSync(readFileSync('extension/public/dict/kanji/0.json.gz')).toString()) as Record<string, number>;
    expect(Object.keys(levels).length).toBeGreaterThan(1500);
    expect(levels['青']).toBe(5);
    expect(levels['煩']).toBe(1); // 煩い (N5) is usually written うるさい: doesn't count
    expect(levels['弄']).toBeUndefined();
  });
});

test.describe('in the overlay', () => {
  // P2-Q4
  test('P2-Q4 a line with easy and hard words underlines only the hard one', async ({ context, extensionId }) => {
    const line = 'あたしは青春を漠然と過ごした';
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, { name: 'ep.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(`1\n00:00:00,000 --> 00:01:00,000\n${line}\n`) });
    await page.bringToFront();
    await expect(overlayIn(page).locator('.w').first()).toBeVisible({ timeout: 15_000 });
    await expect(overlayIn(page).locator('.w.mark')).toHaveText(['漠然と']);
  });
});
