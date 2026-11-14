/**
 * Difficulty score: how rare a word is in real Japanese (wordfreq frequencies, summed per dictionary
 * form) decides what's hard, with the JLPT level as a 20 % nudge. 捏造 is harder than 携帯 even
 * though the lists call 携帯 N1. The card and the notebook show the score instead of "common".
 * Test IDs: docs/archive/TEST_PLAN-2026-11.md P2-D1..P2-D4.
 *
 * Run: npm run test:e2e -- e2e/pr-46-difficulty-score.spec.ts
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { test as unit } from '@playwright/test';
import { Dictionary, difficultyScore } from '../extension/src/lib/dict';
import { loadTokenizer, type Morph } from '../extension/src/lib/tokenizer';
import { groupWords } from '../extension/src/lib/words';
import { SITE, expect, loadFile, openPopup, overlayIn, test } from './fixtures/extension';

const KUROMOJI = path.join(path.dirname(createRequire(import.meta.url).resolve('kuromoji/package.json')), 'dict');

unit.describe('score', () => {
  let morph: Morph;
  const dict = new Dictionary(async (kind, b) => JSON.parse(gunzipSync(readFileSync(`extension/public/dict/${kind}/${b}.json.gz`)).toString()));
  unit.beforeAll(async () => {
    morph = await loadTokenizer(async (f) => {
      const b = gunzipSync(readFileSync(path.join(KUROMOJI, f)));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    });
  });
  const score = async (w: string) => (await dict.tokensFor(groupWords(morph.tokenize(w))))[0]!.score!;

  // P2-D1
  unit('P2-D1 the score formula: frequency decides, JLPT nudges', () => {
    expect(difficultyScore(6, 0)).toBe(0);
    expect(difficultyScore(2, 0)).toBe(100);
    expect(difficultyScore(4, 0)).toBe(50);
    expect(difficultyScore(4, 1)).toBe(55); // N1 nudges up
    expect(difficultyScore(undefined, 2)).toBe(60); // no frequency: the list
    expect(difficultyScore(undefined, 0)).toBeUndefined();
  });

  // P2-D2
  unit('P2-D2 real words: 捏造 harder than 携帯; frequencies are per dictionary form', async () => {
    expect(await score('捏造')).toBeGreaterThan((await score('携帯')) + 10);
    for (const w of ['反応', '美術', '頑張る', 'さすが']) expect(await score(w), w).toBeLessThan(50); // listed N1/N2 or "common", but everyday
    for (const w of ['偽装', '増殖', '尾行', '急遽', '捏造']) expect(await score(w), w).toBeGreaterThanOrEqual(50);
    expect(await dict.zipf('頑張る')).toBeGreaterThan(5); // 頑張っ, 頑張り… counted together
  });
});

test.describe('shown with the word', () => {
  // P2-D3
  test('P2-D3 the card shows the JLPT level and the difficulty score, not "common"', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, { name: 'ep.srt', mimeType: 'application/x-subrip', buffer: Buffer.from('1\n00:00:00,000 --> 00:01:00,000\n記録を捏造して携帯で送った\n') });
    await page.bringToFront();
    await expect(overlayIn(page).locator('.w').first()).toBeVisible({ timeout: 15_000 });
    await overlayIn(page).locator('.w', { hasText: '捏造' }).click();
    const card = page.getByRole('dialog', { name: 'Dictionary' });
    await expect(card).toContainText(/(medium|hard) 5\d/);
    await expect(card).not.toContainText('common');
    await page.keyboard.press('Escape');
    await overlayIn(page).locator('.w', { hasText: '携帯' }).click();
    await expect(card).toContainText(/easy 3\d/);
  });

  // P2-D4
  test('P2-D4 notebook entries keep the score and show it; hardest first sorts by it', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, { name: 'ep.srt', mimeType: 'application/x-subrip', buffer: Buffer.from('1\n00:00:00,000 --> 00:00:20,000\n捏造と尾行と漠然\n') });
    await page.bringToFront();
    await expect(popup.getByText('Notebook: 3 words')).toBeVisible({ timeout: 20_000 });
    const [nb] = await Promise.all([context.waitForEvent('page'), popup.getByRole('button', { name: 'Open notebook' }).click()]);
    await nb.getByLabel('Group').selectOption('none');
    await nb.getByLabel('Sort').selectOption('hardest');
    await expect(nb.locator('article .word')).toHaveText([/^漠然/, /^尾行/, /^捏造/]);
    await expect(nb.getByRole('article', { name: '捏造' })).toContainText(/(medium|hard) 5\d/);
  });
});
