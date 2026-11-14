/**
 * Notebook screenshots come from the video's own picture when the page allows it: they work while
 * the tab is in the background, and never show the player's control bar or the site around it.
 * (A cross-origin video without CORS can't be read: then the tab screenshot from PR 41 is used.)
 * Test IDs: docs/archive/TEST_PLAN-2026-11.md P2-V1..P2-V3.
 *
 * Run: npm run test:e2e -- e2e/pr-43-video-frames.spec.ts
 */
import type { BrowserContext, Page } from '@playwright/test';
import { SITE, expect, loadFile, openPopup, overlayIn, tabIdOf, test } from './fixtures/extension';

const LINE = '漠然とした気持ち';

async function play(page: Page, context: BrowserContext, extensionId: string) {
  await page.goto(`${SITE}/canvas-video`);
  const popup = await openPopup(context, extensionId, page);
  await loadFile(popup, { name: 'ep.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(`1\n00:00:00,500 --> 00:00:30,000\n${LINE}\n`) });
  return popup;
}

/** The logged entry's screenshot: size and share of magenta (the page around the video). */
async function shot(context: BrowserContext) {
  const sw = context.serviceWorkers()[0]!;
  return sw.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => (indexedDB.open('jimaku-kasane-notebook').onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result)));
    if (!db.objectStoreNames.contains('entries')) return null;
    const rows = await new Promise<{ word: string; shot?: number }[]>((resolve) => (db.transaction('entries').objectStore('entries').getAll().onsuccess = (e) => resolve((e.target as IDBRequest).result)));
    const row = rows.find((r) => r.word === '漠然');
    if (!row) return null;
    if (row.shot === undefined) return { shot: false };
    const blob = await new Promise<Blob>((resolve) => (db.transaction('shots').objectStore('shots').get(row.shot!).onsuccess = (e) => resolve((e.target as IDBRequest).result)));
    db.close();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let magenta = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i]! > 200 && px[i + 1]! < 60 && px[i + 2]! > 200) magenta++;
    return { shot: true, width: bmp.width, height: bmp.height, magenta: magenta / (px.length / 4) };
  });
}

test.describe('screenshots from the video', () => {
  // P2-V1
  test('P2-V1 the screenshot is the video picture itself (its own size, nothing around it)', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await play(page, context, extensionId);
    await page.bringToFront();
    await expect(overlayIn(page)).toHaveText(LINE);
    await expect.poll(() => shot(context), { timeout: 15_000 }).toMatchObject({ shot: true, width: 320, height: 180, magenta: 0 });
  });

  // P2-V2
  test('P2-V2 works while another tab is in front (a tab screenshot would fail then)', async ({ context, extensionId }) => {
    const page = await context.newPage();
    const popup = await play(page, context, extensionId);
    const tabId = await tabIdOf(context, page); // (brings it to the front to find it)
    await expect(overlayIn(page)).toHaveText(LINE);
    await popup.bringToFront(); // you switched to another tab
    const active = () =>
      context.serviceWorkers()[0]!.evaluate(
        (id) => (globalThis as unknown as { chrome: { tabs: { get(i: number): Promise<{ active: boolean }> } } }).chrome.tabs.get(id).then((t) => t.active),
        tabId,
      );
    await expect.poll(active).toBe(false);
    // This test browser never reports a page as hidden, so "inactive tab" stands in for "switched away".
    await expect.poll(() => shot(context), { timeout: 15_000 }).toMatchObject({ shot: true, width: 320 });
  });

  // P2-V3
  test('P2-V3 the pointer over the video does not matter: the picture has no control bar', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await play(page, context, extensionId);
    await page.bringToFront();
    for (let i = 0; i < 12; i++) {
      await page.mouse.move(400 + (i % 4) * 30, 250);
      await page.waitForTimeout(200);
    }
    await expect.poll(() => shot(context), { timeout: 15_000 }).toMatchObject({ shot: true, width: 320 });
  });
});
