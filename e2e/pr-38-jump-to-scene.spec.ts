/**
 * Jump to scene: the notebook card's button opens the episode page and the video seeks to 2 s before
 * the line, also when the player is in a cross-origin iframe; it happens once (a reload plays normally).
 * Waits are 8 s: playback alone can't reach 18 s from the start, so passing means it seeked.
 * Test IDs: docs/archive/TEST_PLAN-2026-11.md P2-J1..P2-J3.
 *
 * Run: npm run test:e2e -- e2e/pr-38-jump-to-scene.spec.ts
 */
import type { BrowserContext, Page } from '@playwright/test';
import type { NotebookEntry } from '../extension/src/lib/notebook';
import { PLAYER, SITE, expect, openPopup, setJimakuKey, test } from './fixtures/extension';

const entry = (url: string): Omit<NotebookEntry, 'id' | 'shot'> => ({
  word: '漠然', reading: 'ばくぜん', meaning: 'vague', level: 'N1', line: '漠然とした気持ち', start: 0, length: 2,
  episode: 'eu3', title: 'Hibike! Euphonium - Episode 3', fileName: 'eu03.srt', url, time: 20, at: 1, source: 'auto',
});

async function seed(context: BrowserContext, row: Omit<NotebookEntry, 'id' | 'shot'>) {
  await setJimakuKey(context, 'unused');
  await context.serviceWorkers()[0]!.evaluate(async (row) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('jimaku-kasane-notebook', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('entries', { keyPath: 'id', autoIncrement: true }).createIndex('episode', 'episode');
        r.result.createObjectStore('shots', { autoIncrement: true });
      };
      r.onsuccess = () => resolve(r.result);
    });
    const tx = db.transaction('entries', 'readwrite');
    tx.objectStore('entries').add(row);
    await new Promise((resolve) => (tx.oncomplete = resolve));
    db.close();
  }, row);
}

/** Opens the notebook and clicks Jump to scene; returns the episode tab it opened. */
async function jump(context: BrowserContext, extensionId: string, url: string): Promise<Page> {
  await seed(context, entry(url));
  const page = await context.newPage();
  await page.goto(`${SITE}/player`);
  const popup = await openPopup(context, extensionId, page);
  const [nb] = await Promise.all([context.waitForEvent('page'), popup.getByRole('button', { name: 'Open notebook' }).click()]);
  const [episode] = await Promise.all([
    context.waitForEvent('page'), // opens blank, then navigates
    nb.getByRole('article', { name: '漠然' }).getByRole('button', { name: 'Jump to scene' }).click(),
  ]);
  await episode.waitForURL(url);
  return episode;
}

test.describe('jump to scene', () => {
  // P2-J1
  test('P2-J1 opens the episode and seeks to just before the line', async ({ context, extensionId }) => {
    const episode = await jump(context, extensionId, `${SITE}/talk`);
    await expect.poll(() => episode.evaluate(() => document.querySelector('video')?.currentTime ?? -1), { timeout: 8_000 }).toBeGreaterThanOrEqual(17.9);
    expect(await episode.evaluate(() => document.querySelector('video')!.currentTime)).toBeLessThan(25);
  });

  // P2-J2
  test('P2-J2 works when the player is in a cross-origin iframe', async ({ context, extensionId }) => {
    const episode = await jump(context, extensionId, `${SITE}/embed-talk`);
    await expect.poll(() => episode.frames().find((f) => f.url().startsWith(PLAYER))?.evaluate(() => document.querySelector('video')?.currentTime ?? -1) ?? -1, {
      timeout: 8_000,
    }).toBeGreaterThanOrEqual(17.9);
  });

  // P2-J3
  test('P2-J3 the jump happens once: reloading the page plays from the start', async ({ context, extensionId }) => {
    const episode = await jump(context, extensionId, `${SITE}/talk`);
    await expect.poll(() => episode.evaluate(() => document.querySelector('video')?.currentTime ?? -1), { timeout: 8_000 }).toBeGreaterThanOrEqual(17.9);
    await episode.reload();
    await episode.waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 1);
    expect(await episode.evaluate(() => document.querySelector('video')!.currentTime)).toBeLessThan(10);
  });
});
