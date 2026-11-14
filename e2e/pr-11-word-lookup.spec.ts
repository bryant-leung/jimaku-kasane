/**
 * Word lookup: click a Japanese word for its dictionary entry (JMdict, offline, bundled); words
 * harder than your level are underlined (default: N1, rare and niche N2 words, for an N2 learner).
 * Uses the real dictionary built by `npm run dict` (part of `npm run build`).
 * Test IDs: docs/archive/TEST_PLAN-2026-11.md P2-W1..P2-W6.
 *
 * Run: npm run test:e2e -- e2e/pr-11-word-lookup.spec.ts
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import { deinflect } from '../extension/src/lib/deinflect';
import { Dictionary, isMarked } from '../extension/src/lib/dict';
import { SITE, expect, loadFile, openPopup, overlayIn, test } from './fixtures/extension';

const srt = (line: string) => `1\n00:00:00,000 --> 00:01:00,000\n${line}\n`;
const LINE = '漠然とした気持ちを弄んでいる'; // 漠然 N1, 弄ぶ rare (inflected), the rest easy
const marked = (page: Page) => overlayIn(page).locator('.w.mark');
const paused = (page: Page) => () => page.evaluate(() => document.querySelector('video')!.paused);

async function showLine(page: Page, context: Parameters<typeof openPopup>[0], extensionId: string, line: string) {
  await page.goto(`${SITE}/talk`);
  const popup = await openPopup(context, extensionId, page);
  await loadFile(popup, { name: 'line.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srt(line)) });
  await page.bringToFront();
  await expect(overlayIn(page)).toHaveText(line);
  await expect(overlayIn(page).locator('.w').first()).toBeVisible({ timeout: 10_000 }); // split into words
  return popup;
}

test.describe('word lookup', () => {
  // P2-W1
  test('underlines words above N2 by default: N1 and rare ones only', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await showLine(page, context, extensionId, LINE);
    await expect(marked(page)).toHaveText(['漠然と', '弄んでいる']); // 漠然と: one adverb since PR 26
    await expect(overlayIn(page).locator('.w', { hasText: '気持ち' })).not.toHaveClass(/mark/);
  });

  // P2-W2
  test('clicking a word pauses the video and shows its meaning; Esc closes and resumes', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await showLine(page, context, extensionId, LINE);
    expect(await paused(page)()).toBe(false);
    await overlayIn(page).locator('.w', { hasText: '漠然' }).click();
    const card = page.getByRole('dialog', { name: 'Dictionary' });
    await expect(card).toContainText('漠然');
    await expect(card).toContainText('ばくぜん');
    await expect(card).toContainText('N1');
    await expect(card).toContainText(/vague/i);
    expect(await paused(page)()).toBe(true);
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await expect.poll(paused(page)).toBe(false);
  });

  // P2-W3
  test('finds the dictionary form of an inflected word', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await showLine(page, context, extensionId, LINE);
    await overlayIn(page).locator('.w', { hasText: '弄んでいる' }).click();
    const card = page.getByRole('dialog', { name: 'Dictionary' });
    await expect(card).toContainText('弄ぶ');
    await expect(card).toContainText('もてあそぶ');
    await expect(card).toContainText(/play with|toy with|trifle/i);
    // ✕ closes it too, and the video carries on.
    await card.getByRole('button', { name: 'Close' }).click();
    await expect(card).toBeHidden();
    await expect.poll(paused(page)).toBe(false);
  });

  // P2-W4
  test('the underline level follows the setting', async ({ context, extensionId }) => {
    const page = await context.newPage();
    const popup = await showLine(page, context, extensionId, LINE);
    await popup.getByText('Settings').click();
    const level = popup.getByLabel('Underline words harder than');
    await expect(level).toHaveValue('2');
    await level.selectOption('1'); // N1 holder: only very rare words (both are, by frequency since PR 46)
    await expect(marked(page)).toHaveText(['漠然と', '弄んでいる']);
    await level.selectOption('0'); // off
    await expect(marked(page)).toHaveCount(0);
    await level.selectOption('3'); // N3: N2 and up
    await expect(marked(page)).toHaveText(['漠然と', '弄んでいる']); // 漠然と: one adverb since PR 26
  });

  // P2-W5
  test('clicking elsewhere closes the card; pressing play closes it too', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await showLine(page, context, extensionId, LINE);
    const card = page.getByRole('dialog', { name: 'Dictionary' });
    await overlayIn(page).locator('.w', { hasText: '気持ち' }).click();
    await expect(card).toContainText('きもち');
    await page.locator('h1').click();
    await expect(card).toBeHidden();
    await expect.poll(paused(page)).toBe(false);
    await overlayIn(page).locator('.w', { hasText: '気持ち' }).click();
    await expect(card).toBeVisible();
    await page.evaluate(() => void document.querySelector('video')!.play());
    await expect(card).toBeHidden();
  });

  // P2-W6
  test('dictionary logic: inflections, word splitting and marking (real dictionary files)', async () => {
    const dict = new Dictionary(async (kind, b) =>
      JSON.parse(gunzipSync(readFileSync(`extension/public/dict/${kind}/${b}.json.gz`)).toString()),
    );
    const base = async (word: string) => (await dict.lookupAt(word, 0))?.term;
    expect(await base('食べなかった')).toBe('食べる');
    expect(await base('食べられなかった')).toBe('食べる');
    expect(await base('読んでいた')).toBe('読む');
    expect(await base('行って')).toBe('行く');
    expect(await base('高くない')).toBe('高い');
    expect(await base('来ました')).toBe('来る');
    expect(await base('話さなきゃ')).toBe('話す');
    expect((await dict.lookupAt('勉強しない', 0))?.entries[0]?.k[0]).toBe('勉強'); // suru noun
    // 今日は = 今日 + は here, not the greeting.
    const line = '今日は本当に大変だった';
    const words = (await dict.segment(line)).map((t) => line.slice(t.start, t.start + t.length));
    expect(words.slice(0, 2)).toEqual(['今日', 'は']);
    // Marking: harder JLPT levels and rare words, never kana-only words.
    expect(isMarked({ start: 0, length: 2, level: 1, common: true }, '漠然', 2)).toBe(true);
    expect(isMarked({ start: 0, length: 2, level: 2, common: true }, '功績', 2)).toBe(false);
    expect(isMarked({ start: 0, length: 2, level: 2, common: true }, '功績', 3)).toBe(true);
    expect(isMarked({ start: 0, length: 2, level: 0, common: false }, '弄ぶ', 1)).toBe(true);
    expect(isMarked({ start: 0, length: 3, level: 0, common: false }, 'なのか', 2)).toBe(false);
    expect(deinflect('食べた').some((d) => d.term === '食べる' && d.cls === 'v1')).toBe(true);
  });
});
