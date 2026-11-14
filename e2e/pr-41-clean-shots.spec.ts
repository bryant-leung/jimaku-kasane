/**
 * Notebook screenshots without the player's control bar: logging waits until the pointer hasn't
 * moved over the video for 3 s (players hide the bar then); if that never happens before the line
 * ends, the word is logged without a screenshot. Words you click reuse the line's clean frame
 * instead of a new shot (which would show the paused player's bar and the card).
 * Test IDs: docs/TEST_PLAN.md P2-H1..P2-H4.
 *
 * Run: npm run test:e2e -- e2e/pr-41-clean-shots.spec.ts
 */
import type { BrowserContext, Page } from '@playwright/test';
import { SITE, expect, loadFile, openPopup, overlayIn, test } from './fixtures/extension';

const srt = (line: string, end: string) => `1\n00:00:00,000 --> 00:00:${end},000\n${line}\n`;

async function play(page: Page, context: BrowserContext, extensionId: string, line: string, end = '20') {
  await page.goto(`${SITE}/talk`); // video at the top left, 640×360
  const popup = await openPopup(context, extensionId, page);
  await loadFile(popup, { name: 'ep.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srt(line, end)) });
  await page.bringToFront();
  await expect(overlayIn(page)).toHaveText(line);
}

async function rows(context: BrowserContext) {
  const sw = context.serviceWorkers()[0]!;
  return sw.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => (indexedDB.open('jimaku-kasane-notebook').onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result)));
    if (!db.objectStoreNames.contains('entries')) return [];
    const all = await new Promise<{ word: string; source: string; shot?: number }[]>((resolve) => (db.transaction('entries').objectStore('entries').getAll().onsuccess = (e) => resolve((e.target as IDBRequest).result)));
    db.close();
    return all.map((r) => ({ word: r.word, source: r.source, shot: r.shot !== undefined }));
  });
}

/** Moves the pointer around over the video until video time `until`. */
async function hover(page: Page, until: number) {
  for (let i = 0; (await page.evaluate(() => document.querySelector('video')!.currentTime)) < until; i++) {
    await page.mouse.move(200 + (i % 5) * 20, 150 + (i % 3) * 10);
    await page.waitForTimeout(200);
  }
}

test.describe('screenshots without the control bar', () => {
  // P2-H1
  test('P2-H1 pointer moving over the video the whole line: logged without a screenshot', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await play(page, context, extensionId, '漠然とした気持ち', '03');
    await hover(page, 3.2);
    await expect.poll(() => rows(context), { timeout: 10_000 }).toEqual([{ word: '漠然', source: 'auto', shot: false }]);
  });

  // P2-H2
  test('P2-H2 pointer stops: the screenshot is taken once the bar would have hidden', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await play(page, context, extensionId, '漠然とした気持ち', '10');
    await hover(page, 1.5); // then still
    expect(await rows(context)).toEqual([]); // waiting
    await expect.poll(() => rows(context), { timeout: 10_000 }).toEqual([{ word: '漠然', source: 'auto', shot: true }]);
    expect(await page.evaluate(() => document.querySelector('video')!.currentTime)).toBeGreaterThan(4); // ≥ 3 s after the last move
  });

  // P2-H3
  test('P2-H3 a clicked word gets the line\'s clean frame, not a new shot', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await play(page, context, extensionId, '今日はいい天気'); // nothing hard: only the clean frame is kept
    await page.waitForFunction(() => document.querySelector('video')!.currentTime > 2);
    await overlayIn(page).locator('.w', { hasText: '天気' }).click();
    await expect.poll(() => rows(context)).toEqual([{ word: '天気', source: 'click', shot: true }]);
  });

  // P2-H4
  test('P2-H4 clicked before any clean frame: logged without a screenshot', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await play(page, context, extensionId, '今日はいい天気');
    await overlayIn(page).locator('.w', { hasText: '天気' }).click(); // well before 1 s on screen
    await expect.poll(() => rows(context)).toEqual([{ word: '天気', source: 'click', shot: false }]);
  });
});
