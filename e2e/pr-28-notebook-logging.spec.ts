/**
 * Study notebook, automatic logging: words harder than your level (default: harder than N3) are
 * logged while you watch, once per episode, with their line and a screenshot of the frame; words
 * you click are logged too. Stored in IndexedDB.
 * Test IDs: docs/TEST_PLAN.md P2-N1..P2-N6.
 *
 * Run: npm run test:e2e -- e2e/pr-28-notebook-logging.spec.ts
 */
import { test as unit } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { MAX_PER_EPISODE, pickNew } from '../extension/src/lib/notebook';
import { SITE, expect, loadFile, openPopup, overlayIn, setJimakuKey, test } from './fixtures/extension';

const LINE = '漠然とした気持ちを弄んでいる'; // 漠然 N1, 弄ぶ rare, the rest N4–N5
const srt = `1\n00:00:00,000 --> 00:00:20,000\n${LINE}\n`;

interface Row { word: string; level: string; line: string; source: string; shot?: number; time: number; episode: string }

/** Notebook rows (and each screenshot's type and size) read in the service worker. */
async function notebook(context: BrowserContext): Promise<(Row & { shotType?: string; shotSize?: number })[]> {
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return sw.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('jimaku-kasane-notebook');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    if (!db.objectStoreNames.contains('entries')) return [];
    const get = <T,>(store: string, key?: number) =>
      new Promise<T>((resolve) => {
        const r = key === undefined ? db.transaction(store).objectStore(store).getAll() : db.transaction(store).objectStore(store).get(key);
        r.onsuccess = () => resolve(r.result as T);
      });
    const rows = await get<Row[]>('entries');
    const out = [];
    for (const row of rows) {
      const blob = row.shot === undefined ? undefined : await get<Blob>('shots', row.shot);
      out.push({ ...row, shotType: blob?.type, shotSize: blob?.size });
    }
    db.close();
    return out;
  });
}

async function setLocal(context: BrowserContext, v: object) {
  await setJimakuKey(context, 'unused'); // service worker up
  const sw = context.serviceWorkers()[0]!;
  await sw.evaluate((val) => (globalThis as unknown as { chrome: { storage: { local: { set(v: object): Promise<void> } } } }).chrome.storage.local.set(val), v);
}

async function play(page: Page, context: BrowserContext, extensionId: string) {
  await page.goto(`${SITE}/talk`);
  const popup = await openPopup(context, extensionId, page);
  await loadFile(popup, { name: 'ep.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srt) });
  await page.bringToFront();
  await expect(overlayIn(page)).toHaveText(LINE);
  return popup;
}

unit.describe('what gets logged', () => {
  // P2-N1
  unit('once per episode, not learned words, at most 80', () => {
    expect(pickNew(['漠然', '弄ぶ', '漠然'], [], [])).toEqual(['漠然', '弄ぶ']);
    expect(pickNew(['漠然', '弄ぶ'], ['漠然'], [])).toEqual(['弄ぶ']);
    expect(pickNew(['漠然', '弄ぶ'], [], ['弄ぶ'])).toEqual(['漠然']);
    const full = Array.from({ length: MAX_PER_EPISODE - 1 }, (_, i) => `w${i}`);
    expect(pickNew(['a', 'b'], full, [])).toEqual(['a']);
  });
});

test.describe('logging while you watch', () => {
  // P2-N2
  test('hard words in a line on screen are logged with the line and a screenshot', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await play(page, context, extensionId);
    await expect.poll(async () => (await notebook(context)).map((r) => r.word).sort(), { timeout: 15_000 }).toEqual(['弄ぶ', '漠然']);
    const rows = await notebook(context);
    for (const r of rows) {
      expect(r).toMatchObject({ line: LINE, source: 'auto', time: 0 });
      expect(r.shotType).toBe('image/jpeg');
      expect(r.shotSize).toBeGreaterThan(1000);
    }
    expect(rows[0]!.shot).toBe(rows[1]!.shot); // one screenshot for the line
    expect(rows.find((r) => r.word === '漠然')?.level).toBe('N1');
  });

  // P2-N3
  test('the popup shows the notebook size; the same line again adds nothing', async ({ context, extensionId }) => {
    const page = await context.newPage();
    const popup = await play(page, context, extensionId);
    await expect(popup.getByText('Notebook: 2 words')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => {
      const v = document.querySelector('video')!;
      v.currentTime = 0;
      void v.play();
    });
    await page.waitForFunction(() => document.querySelector('video')!.currentTime > 2.5);
    expect(await notebook(context)).toHaveLength(2);
  });

  // P2-N4
  test('with logging off, only words you click are logged', async ({ context, extensionId }) => {
    await setLocal(context, { notebookLogAbove: 0 });
    const page = await context.newPage();
    await play(page, context, extensionId);
    await page.waitForFunction(() => document.querySelector('video')!.currentTime > 2.5);
    expect(await notebook(context)).toHaveLength(0);
    await overlayIn(page).locator('.w', { hasText: '気持ち' }).click();
    await expect.poll(async () => (await notebook(context)).map((r) => [r.word, r.source])).toEqual([['気持ち', 'click']]);
  });

  // P2-N5
  test('words marked learned are not logged', async ({ context, extensionId }) => {
    await setLocal(context, { notebookLearned: ['漠然'] });
    const page = await context.newPage();
    await play(page, context, extensionId);
    await expect.poll(async () => (await notebook(context)).map((r) => r.word), { timeout: 15_000 }).toEqual(['弄ぶ']);
  });

  // P2-N6
  test('the log level setting is in Settings, default N3', async ({ context, extensionId }) => {
    const page = await context.newPage();
    const popup = await play(page, context, extensionId);
    await popup.getByText('Settings').click();
    const level = popup.getByLabel('Log to the notebook words harder than');
    await expect(level).toHaveValue('3');
    await level.selectOption('1'); // rare only: 漠然 (N1) is no longer logged in a new episode
    const sw = context.serviceWorkers()[0]!;
    await expect
      .poll(() => sw.evaluate(() => (globalThis as unknown as { chrome: { storage: { local: { get(k: string): Promise<Record<string, number>> } } } }).chrome.storage.local.get('notebookLogAbove').then((s) => s.notebookLogAbove)))
      .toBe(1);
  });
});
