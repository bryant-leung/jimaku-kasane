/**
 * Example sentences on the dictionary card: up to 2 Tatoeba sentences with English (bundled with
 * JMdict), and up to 3 other lines of the loaded episode with the same word (click one to jump there).
 * Test IDs: docs/TEST_PLAN.md P2-X1..P2-X4.
 *
 * Run: npm run test:e2e -- e2e/pr-27-example-sentences.spec.ts
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { test as unit } from '@playwright/test';
import type { Page } from '@playwright/test';
import { Dictionary } from '../extension/src/lib/dict';
import { SITE, expect, loadFile, openPopup, overlayIn, test } from './fixtures/extension';

// The line on screen first, then other lines (inside the 41 s clip): two with 諦める, one without.
const SRT = [
  '1\n00:00:00,000 --> 00:00:15,000\n諦めないで\n',
  '2\n00:00:20,000 --> 00:00:23,000\nもう諦めた\n',
  '3\n00:00:26,000 --> 00:00:28,000\n今日はいい天気\n',
  '4\n00:00:35,000 --> 00:00:38,000\n絶対に諦めるな\n',
].join('\n');

async function openCard(page: Page, context: Parameters<typeof openPopup>[0], extensionId: string) {
  await page.goto(`${SITE}/talk`);
  const popup = await openPopup(context, extensionId, page);
  await loadFile(popup, { name: 'ep.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(SRT) });
  await page.bringToFront();
  const word = overlayIn(page).locator('.w', { hasText: '諦めないで' });
  await expect(word).toBeVisible({ timeout: 15_000 });
  await word.click();
  return page.getByRole('dialog', { name: 'Dictionary' });
}

unit.describe('example sentences in the dictionary', () => {
  // P2-X1
  unit('dictionary entries carry Tatoeba sentences with English', async () => {
    const dict = new Dictionary(async (kind, b) => JSON.parse(gunzipSync(readFileSync(`extension/public/dict/${kind}/${b}.json.gz`)).toString()));
    const m = await dict.lookupAt('諦める', 0);
    const x = m?.entries[0]?.x ?? [];
    expect(x.length).toBeGreaterThan(0);
    expect(x.length).toBeLessThanOrEqual(2);
    for (const [ja, en] of x) {
      expect(ja).toMatch(/[ぁ-んァ-ン一-龯]/);
      expect(en).toMatch(/[a-z]/i);
    }
  });
});

test.describe('example sentences on the card', () => {
  // P2-X2
  test('the card shows example sentences with English', async ({ context, extensionId }) => {
    const page = await context.newPage();
    const card = await openCard(page, context, extensionId);
    const ex = card.getByLabel('Example sentences');
    await expect(ex).toContainText('Examples');
    await expect(ex.locator('.ja').first()).toContainText(/諦|あきら/);
    await expect(ex.locator('.en').first()).toHaveText(/[a-z]/i);
  });

  // P2-X3
  test('the card lists other lines of this episode with the same word', async ({ context, extensionId }) => {
    const page = await context.newPage();
    const card = await openCard(page, context, extensionId);
    const ep = card.getByLabel('In this episode');
    await expect(ep.getByRole('button')).toHaveText(['0:20もう諦めた', '0:35絶対に諦めるな']);
  });

  // P2-X4
  test('clicking an episode line jumps the video there', async ({ context, extensionId }) => {
    const page = await context.newPage();
    const card = await openCard(page, context, extensionId);
    await card.getByLabel('In this episode').getByRole('button', { name: /もう諦めた/ }).click();
    await expect(card).toBeHidden();
    await expect.poll(() => page.evaluate(() => Math.round(document.querySelector('video')!.currentTime))).toBe(20);
  });
});
