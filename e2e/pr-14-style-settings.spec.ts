/**
 * Style settings for the Japanese line: text size, height above the bottom, dark box.
 * Test IDs: docs/archive/TEST_PLAN-2026-11.md P2-07, P2-08 (redefined), P2-Y1..P2-Y3.
 *
 * Run: npm run test:e2e -- e2e/pr-14-style-settings.spec.ts
 */
import type { BrowserContext, Page } from '@playwright/test';
import { SITE, expect, loadFile, openPopup, overlayIn, test } from './fixtures/extension';

const SRT = `1\n00:00:00,000 --> 00:01:00,000\nテスト字幕\n`;

async function setup(context: BrowserContext, extensionId: string) {
  const page = await context.newPage();
  await page.goto(`${SITE}/talk`);
  const popup = await openPopup(context, extensionId, page);
  await loadFile(popup, { name: 'line.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(SRT) });
  await expect(overlayIn(page)).toHaveText('テスト字幕');
  await popup.getByText('Settings').click();
  return { page, popup };
}
const fontPx = (page: Page) => () => overlayIn(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
const bottom = (page: Page) => () => overlayIn(page).evaluate((el) => el.getBoundingClientRect().bottom);

test.describe('style settings', () => {
  // P2-07
  test('text size changes the line size and is remembered after a reload', async ({ context, extensionId }) => {
    const { page, popup } = await setup(context, extensionId);
    const normal = await fontPx(page)();
    await popup.getByLabel('Text size').selectOption('Larger');
    await expect.poll(fontPx(page)).toBeGreaterThanOrEqual(Math.round(normal * 1.4));
    const larger = await fontPx(page)();
    await page.reload();
    await expect(overlayIn(page)).toHaveText('テスト字幕');
    await expect.poll(fontPx(page)).toBe(larger);
  });

  // P2-08
  test('height lifts the line by a share of the video height', async ({ context, extensionId }) => {
    const { page, popup } = await setup(context, extensionId);
    const before = await bottom(page)();
    const videoHeight = await page.evaluate(() => document.querySelector('video')!.getBoundingClientRect().height);
    await popup.getByLabel('Height').selectOption('Much higher'); // 20 %
    await expect.poll(async () => before - (await bottom(page)())).toBeGreaterThan(videoHeight * 0.2 - 3);
    expect(before - (await bottom(page)())).toBeLessThan(videoHeight * 0.2 + 3);
  });

  // P2-Y1
  test('dark box puts a background behind the text', async ({ context, extensionId }) => {
    const { page, popup } = await setup(context, extensionId);
    const bg = () => overlayIn(page).locator('div').first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await bg()).toBe('rgba(0, 0, 0, 0)');
    await popup.getByLabel('Dark box behind the text').check();
    await expect.poll(bg).toBe('rgba(0, 0, 0, 0.6)');
  });

  // P2-Y2
  test('defaults: normal size, under the English subs, no box', async ({ context, extensionId }) => {
    const { popup } = await setup(context, extensionId);
    await expect(popup.getByLabel('Text size')).toHaveValue('100');
    await expect(popup.getByLabel('Height')).toHaveValue('0');
    await expect(popup.getByLabel('Dark box behind the text')).not.toBeChecked();
  });

  // P2-Y3
  test('the popup shows the saved style when reopened', async ({ context, extensionId }) => {
    const { page, popup } = await setup(context, extensionId);
    await popup.getByLabel('Text size').selectOption('Large');
    await popup.getByLabel('Height').selectOption('Higher');
    await popup.getByLabel('Dark box behind the text').check();
    await popup.close();
    const again = await openPopup(context, extensionId, page);
    await expect(again.getByLabel('Text size')).toHaveValue('125');
    await expect(again.getByLabel('Height')).toHaveValue('10');
    await expect(again.getByLabel('Dark box behind the text')).toBeChecked();
  });
});
