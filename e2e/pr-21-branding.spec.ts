/**
 * Branding: the extension is called JimakuKasane 字幕重ね everywhere you see it and ships its icons.
 * Test IDs: docs/TEST_PLAN.md P0-B1..P0-B3.
 *
 * Run: npm run test:e2e -- e2e/pr-21-branding.spec.ts
 */
import { SITE, expect, loadFile, openPopup, tabIdOf, test } from './fixtures/extension';

test.describe('branding', () => {
  // P0-B1
  test('manifest name, description and icons', async ({ context }) => {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const m = await sw.evaluate(() => {
      const c = (globalThis as unknown as { chrome: { runtime: { getManifest(): Record<string, unknown> } } }).chrome;
      return c.runtime.getManifest() as { name: string; description: string; icons?: Record<string, string> };
    });
    expect(m.name).toBe('JimakuKasane 字幕重ね');
    expect(m.description).toMatch(/Japanese subtitles/);
    expect(Object.keys(m.icons ?? {}).sort()).toEqual(['128', '16', '32', '48']);
  });

  // P0-B2
  test('icons load and are the right size', async ({ context, extensionId }) => {
    const page = await context.newPage();
    for (const size of [16, 32, 48, 128]) {
      await page.goto(`chrome-extension://${extensionId}/icon/${size}.png`);
      const dims = await page.evaluate(() => {
        const img = document.querySelector('img')!;
        return [img.naturalWidth, img.naturalHeight];
      });
      expect(dims).toEqual([size, size]);
    }
  });

  // P0-B3
  test('popup heading and toolbar tooltip use the new name', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await expect(popup.getByRole('heading', { name: 'JimakuKasane 字幕重ね' })).toBeVisible();
    await expect(popup).toHaveTitle('JimakuKasane 字幕重ね');
    await loadFile(popup, 'sample.srt');
    const tabId = await tabIdOf(context, page);
    const sw = context.serviceWorkers()[0]!;
    const title = () =>
      sw.evaluate(async (tabId) => {
        const c = (globalThis as unknown as { chrome: { action: { getTitle(d: object): Promise<string> } } }).chrome;
        return c.action.getTitle({ tabId });
      }, tabId);
    await expect.poll(title).toMatch(/^JimakuKasane: Japanese subtitles loaded/);
  });
});
