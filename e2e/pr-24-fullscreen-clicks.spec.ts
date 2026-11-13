/**
 * Word clicks in fullscreen: Chrome makes everything outside the fullscreen element inert, so the
 * overlay moves inside it while fullscreen and back out after.
 * Test IDs: docs/TEST_PLAN.md P2-F1..P2-F4.
 *
 * Run: npm run test:e2e -- e2e/pr-24-fullscreen-clicks.spec.ts
 */
import type { FrameLocator, Page } from '@playwright/test';
import { PLAYER, SITE, expect, loadFile, openPopup, overlayIn, test } from './fixtures/extension';

const LINE = '漠然とした気持ち';
const srt = `1\n00:00:00,000 --> 00:01:00,000\n${LINE}\n`;
const word = (t: Page | FrameLocator) => overlayIn(t).locator('.w', { hasText: '漠然' });

async function load(page: Page, context: Parameters<typeof openPopup>[0], extensionId: string, path: string) {
  await page.goto(`${SITE}${path}`);
  const popup = await openPopup(context, extensionId, page);
  await loadFile(popup, { name: 'line.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srt) });
  await page.bringToFront();
}

test.describe('word clicks in fullscreen', () => {
  // P2-F1
  test('clicking a word in a fullscreen player opens its card', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await load(page, context, extensionId, '/fullscreen');
    await page.getByRole('button', { name: 'Fullscreen' }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('box');
    await expect(word(page)).toBeVisible({ timeout: 10_000 });
    await word(page).click();
    await expect(page.getByRole('dialog', { name: 'Dictionary' })).toContainText('ばくぜん');
  });

  // P2-F2
  test('after leaving fullscreen the overlay moves back and words still click', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await load(page, context, extensionId, '/fullscreen');
    await page.getByRole('button', { name: 'Fullscreen' }).click();
    await expect.poll(() => page.evaluate(() => !!document.querySelector('#box [data-jpsub-overlay]'))).toBe(true);
    await page.evaluate(() => document.exitFullscreen());
    await expect.poll(() => page.evaluate(() => document.querySelector('[data-jpsub-overlay]')?.parentElement?.tagName)).toBe('HTML');
    await expect(word(page)).toBeVisible({ timeout: 10_000 });
    await word(page).click();
    await expect(page.getByRole('dialog', { name: 'Dictionary' })).toBeVisible();
  });

  // P2-F3
  test('fullscreen player inside a cross-origin iframe: words click', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await load(page, context, extensionId, '/fs-embed');
    const player = page.frameLocator(`iframe[src^="${PLAYER}"]`);
    await player.getByRole('button', { name: 'Fullscreen' }).click();
    await expect(word(player)).toBeVisible({ timeout: 10_000 });
    await word(player).click();
    await expect(player.getByRole('dialog', { name: 'Dictionary' })).toContainText('ばくぜん');
  });

  // P2-F4
  test('a fullscreen <video> itself still shows the line', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await load(page, context, extensionId, '/fullscreen-video');
    await page.getByRole('button', { name: 'Fullscreen' }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName)).toBe('VIDEO');
    await expect(overlayIn(page)).toHaveText(LINE);
    await expect(overlayIn(page)).toBeVisible();
  });
});
