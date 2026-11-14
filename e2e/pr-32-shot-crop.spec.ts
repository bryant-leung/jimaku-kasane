/**
 * Notebook screenshots show only the video (not the site around it) unless fullscreen, also when
 * the player is in an iframe; and words stay clickable in a fullscreen player whose box toggles
 * play on click (like Kwik's).
 * Test IDs: docs/TEST_PLAN.md P2-C1..P2-C4.
 *
 * Run: npm run test:e2e -- e2e/pr-32-shot-crop.spec.ts
 */
import { test as unit } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { cropBox } from '../extension/src/lib/notebook';
import { PLAYER, SITE, expect, loadFile, openPopup, overlayIn, test } from './fixtures/extension';

const LINE = '漠然とした気持ちを弄んでいる';
const SRT = `1\n00:00:00,000 --> 00:00:20,000\n${LINE}\n`;

unit.describe('crop maths', () => {
  // P2-C1
  unit('P2-C1 crops to the video; keeps the whole tab in fullscreen, off screen or when the video fills it', () => {
    expect(cropBox({ x: 320, y: 144, w: 640, h: 360, vw: 1280 }, 1280, 720)).toEqual({ sx: 320, sy: 144, sw: 640, sh: 360 });
    expect(cropBox({ x: 320, y: 144, w: 640, h: 360, vw: 1280 }, 2560, 1440)).toEqual({ sx: 640, sy: 288, sw: 1280, sh: 720 }); // 2x screen
    expect(cropBox({ x: -100, y: 500, w: 500, h: 800, vw: 1000 }, 1000, 1000)).toEqual({ sx: 0, sy: 500, sw: 400, sh: 500 }); // clipped
    expect(cropBox(null, 1280, 720)).toBeNull(); // fullscreen
    expect(cropBox(undefined, 1280, 720)).toBeNull();
    expect(cropBox({ x: 1500, y: 0, w: 640, h: 360, vw: 1280 }, 1280, 720)).toBeNull(); // off screen
    expect(cropBox({ x: 0, y: 0, w: 1280, h: 720, vw: 1280 }, 1280, 720)).toBeNull(); // fills the tab
  });
});

/** Share of bright magenta (the page around the video) in the first logged screenshot. */
async function magentaShare(context: BrowserContext): Promise<{ share: number; width: number } | null> {
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return sw.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => (indexedDB.open('jimaku-kasane-notebook').onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result)));
    if (!db.objectStoreNames.contains('shots')) return null;
    const blob = await new Promise<Blob | undefined>((resolve) => {
      const r = db.transaction('shots').objectStore('shots').openCursor();
      r.onsuccess = () => resolve(r.result?.value as Blob | undefined);
    });
    db.close();
    if (!blob) return null;
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i]! > 180 && px[i + 1]! < 90 && px[i + 2]! > 180) n++;
    return { share: n / (px.length / 4), width: bmp.width };
  });
}

async function load(page: Page, context: BrowserContext, extensionId: string, path: string) {
  await page.goto(`${SITE}${path}`);
  const popup = await openPopup(context, extensionId, page);
  await loadFile(popup, { name: 'ep.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(SRT) });
  await page.bringToFront();
}

test.describe('screenshots show only the video', () => {
  // P2-C2
  test('P2-C2 video on the page: the site around it is left out', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await load(page, context, extensionId, '/shot-page');
    await expect(overlayIn(page)).toHaveText(LINE);
    await expect.poll(() => magentaShare(context), { timeout: 15_000 }).not.toBeNull();
    const shot = (await magentaShare(context))!;
    expect(shot.share).toBeLessThan(0.02); // the page is about half magenta around the video
    expect(shot.width).toBeLessThanOrEqual(640);
  });

  // P2-C3
  test('P2-C3 player in a cross-origin iframe: still cropped to the video', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await load(page, context, extensionId, '/shot-embed');
    await expect(overlayIn(page.frameLocator(`iframe[src^="${PLAYER}"]`))).toHaveText(LINE);
    await expect.poll(() => magentaShare(context), { timeout: 15_000 }).not.toBeNull();
    expect((await magentaShare(context))!.share).toBeLessThan(0.02);
  });
});

test.describe('fullscreen clicks in a real-style player', () => {
  // P2-C4
  test('P2-C4 a word clicks in fullscreen even when the player box toggles play on click', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await load(page, context, extensionId, '/fs-plyr-embed');
    const player = page.frameLocator(`iframe[src^="${PLAYER}"]`);
    await player.getByRole('button', { name: 'Fullscreen' }).click();
    const word = overlayIn(player).locator('.w', { hasText: '漠然' });
    await expect(word).toBeVisible({ timeout: 15_000 });
    await word.click();
    const card = player.getByRole('dialog', { name: 'Dictionary' });
    await expect(card).toContainText('ばくぜん');
    const frame = page.frames().find((f) => f.url().startsWith(PLAYER))!;
    await expect.poll(() => frame.evaluate(() => document.querySelector('video')!.paused)).toBe(true); // the click didn't reach the box
    await expect(card).toBeVisible();
  });
});
