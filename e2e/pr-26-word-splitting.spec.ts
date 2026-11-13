/**
 * Real word splitting (kuromoji, IPADIC): names stay whole (久美子, not 美), verbs keep their
 * endings, kana words get their dictionary form and level, and particles are looked up as particles.
 * Uses the real kuromoji and JMdict files (`npm run build`).
 * Test IDs: docs/TEST_PLAN.md P2-K1..P2-K7.
 *
 * Run: npm run test:e2e -- e2e/pr-26-word-splitting.spec.ts
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
const gz = (file: string) => {
  const b = gunzipSync(readFileSync(file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

unit.describe('word splitting', () => {
  let morph: Morph;
  const dict = new Dictionary(async (kind, b) => JSON.parse(gunzipSync(readFileSync(`extension/public/dict/${kind}/${b}.json.gz`)).toString()));
  unit.beforeAll(async () => {
    morph = await loadTokenizer(async (f) => gz(path.join(KUROMOJI, f)));
  });
  const words = (s: string) => groupWords(morph.tokenize(s));
  const surfaces = (s: string) => words(s).filter((w) => w.kind !== 'symbol').map((w) => w.surface);

  // P2-K1
  unit('names stay whole and are marked as names, never underlined', async () => {
    const w = words('麗奈と久美子は先輩です');
    const kumiko = w.find((x) => x.surface === '久美子')!;
    expect(kumiko).toMatchObject({ kind: 'name', label: 'Name', reading: 'くみこ' });
    expect(w.find((x) => x.surface === '麗奈')?.kind).toBe('name');
    expect(surfaces('麗奈と久美子は先輩です')).not.toContain('美');
    const m = await dict.lookupWord(kumiko);
    expect(m.name).toEqual({ label: 'Name', reading: 'くみこ' });
    const line = '麗奈と久美子は先輩です';
    const marked = (await dict.tokensFor(w)).filter((t) => isMarked(t, line, 5)).map((t) => line.slice(t.start, t.start + t.length));
    expect(marked).toEqual(['先輩']); // at N5 only the N4 word; names never
  });

  // P2-K2
  unit('verbs and adjectives keep their endings', () => {
    expect(surfaces('漠然とした気持ちを弄んでいる')).toEqual(['漠然と', 'した', '気持ち', 'を', '弄んでいる']);
    expect(surfaces('勉強しなかった')).toEqual(['勉強しなかった']);
    expect(surfaces('あきらめないで')).toEqual(['あきらめないで']);
  });

  // P2-K3
  unit('kana words get the same entry and level as the kanji spelling', async () => {
    const [kana] = words('あきらめないで');
    const [kanji] = words('諦めないで');
    const a = await dict.lookupWord(kana!);
    const b = await dict.lookupWord(kanji!);
    expect(a.entries[0]?.k[0]).toBe('諦める');
    expect(a.entries[0]?.id).toBe(b.entries[0]?.id);
    const [t] = await dict.tokensFor(words('ことごとく'));
    expect(t!.level).toBe(1);
    expect(isMarked(t!, 'ことごとく', 2)).toBe(true); // kana N1 word: underlined for an N2 learner
  });

  // P2-K4
  unit('particles and inflected verbs are looked up as what they are', async () => {
    const look = async (line: string, surface: string) =>
      (await dict.lookupWord(words(line).find((x) => x.surface === surface)!)).entries[0]!;
    expect((await look('久美子は先輩です', 'は')).p).toContain('prt'); // not 歯 (tooth)
    expect((await look('そうだね', 'ね')).p).toContain('prt'); // not 根 (root)
    expect((await look('漠然とした気持ち', 'した')).r[0]).toBe('する'); // not 下 (below)
    expect((await look('漠然とした気持ち', 'した')).u).toBe(1); // shown as する, not 為る
  });

  // P2-K5
  unit("a piece of an unknown surname isn't underlined", async () => {
    const line = '黄前久美子';
    const tokens = await dict.tokensFor(words(line));
    expect(tokens.filter((t) => isMarked(t, line, 5)).map((t) => line.slice(t.start, t.start + t.length))).toEqual([]);
  });
});

const srt = (line: string) => `1\n00:00:00,000 --> 00:01:00,000\n${line}\n`;

test.describe('word splitting in the overlay', () => {
  async function showLine(page: import('@playwright/test').Page, context: Parameters<typeof openPopup>[0], extensionId: string, line: string) {
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, { name: 'line.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srt(line)) });
    await page.bringToFront();
    await expect(overlayIn(page).locator('.w').first()).toBeVisible({ timeout: 15_000 });
  }

  // P2-K6
  test('clicking a name shows it as a name with its reading', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await showLine(page, context, extensionId, '麗奈と久美子は先輩です');
    await expect(overlayIn(page).locator('.w', { hasText: '久美子' })).toHaveText('久美子');
    await overlayIn(page).locator('.w', { hasText: '久美子' }).click();
    const card = page.getByRole('dialog', { name: 'Dictionary' });
    await expect(card).toContainText('久美子');
    await expect(card).toContainText('くみこ');
    await expect(card).toContainText('Name');
  });

  // P2-K7
  test('a kana-written N1 word is underlined and shows its usual spelling', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await showLine(page, context, extensionId, 'ことごとく失敗した');
    await expect(overlayIn(page).locator('.w.mark')).toHaveText(['ことごとく']);
    await overlayIn(page).locator('.w', { hasText: 'ことごとく' }).click();
    const card = page.getByRole('dialog', { name: 'Dictionary' });
    await expect(card).toContainText('悉く');
    await expect(card).toContainText('N1');
  });
});
