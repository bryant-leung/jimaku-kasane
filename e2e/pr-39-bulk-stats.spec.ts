/**
 * Notebook bulk actions (select cards or rows, then mark learned, delete or export just those) and a
 * stats line (words per level, new this week, learned this week).
 * Test IDs: docs/archive/TEST_PLAN-2026-11.md P2-K1..P2-K5.
 *
 * Run: npm run test:e2e -- e2e/pr-39-bulk-stats.spec.ts
 */
import { readFileSync } from 'node:fs';
import { test as unit } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import initSqlJs from 'sql.js';
import type { NotebookEntry } from '../extension/src/lib/notebook';
import { mergeCards, notebookStats } from '../extension/src/lib/notebook-view';
import { SITE, expect, openPopup, setJimakuKey, test } from './fixtures/extension';

const DAY = 24 * 3600 * 1000;
const eu = (n: number) => ({ episode: `eu${n}`, title: `Hibike! Euphonium - Episode ${n}`, fileName: `eu0${n}.srt` });
const base = { source: 'auto' as const, time: 30, start: 0, length: 2, line: 'x' };
const rows = (now: number): Omit<NotebookEntry, 'id' | 'shot'>[] => [
  { ...base, ...eu(3), word: '漠然', level: 'N1', at: now - 30 * DAY },
  { ...base, ...eu(4), word: '漠然', level: 'N1', at: now - DAY },
  { ...base, ...eu(4), word: '弄ぶ', level: 'rare', at: now - DAY },
  { ...base, ...eu(4), word: '曖昧', level: 'N2', at: now - 2 * DAY },
  { ...base, ...eu(4), word: '～ざるを得ない', level: 'N2', at: now - 3 * DAY, kind: 'grammar' },
];

unit.describe('stats', () => {
  // P2-K1
  unit('P2-K1 words per level, new and learned this week', () => {
    const now = 1_800_000_000_000;
    const st = notebookStats(mergeCards(rows(now).map((r, id) => ({ ...r, id }))), { 曖昧: now - DAY, 弄ぶ: now - 10 * DAY }, now);
    expect(st.byLevel).toEqual([['N1', 1], ['rare', 1], ['N2', 1], ['N2 grammar', 1]]);
    expect(st.loggedThisWeek).toBe(3); // 漠然 was first met 30 days ago
    expect(st.learnedThisWeek).toBe(1);
  });
});

async function openNotebook(context: BrowserContext, extensionId: string) {
  await setJimakuKey(context, 'unused');
  await context.serviceWorkers()[0]!.evaluate(async (rows) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('jimaku-kasane-notebook', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('entries', { keyPath: 'id', autoIncrement: true }).createIndex('episode', 'episode');
        r.result.createObjectStore('shots', { autoIncrement: true });
      };
      r.onsuccess = () => resolve(r.result);
    });
    const tx = db.transaction('entries', 'readwrite');
    for (const row of rows) tx.objectStore('entries').add(row);
    await new Promise((resolve) => (tx.oncomplete = resolve));
    db.close();
  }, rows(Date.now()));
  const page = await context.newPage();
  await page.goto(`${SITE}/talk`);
  const popup = await openPopup(context, extensionId, page);
  const [nb] = await Promise.all([context.waitForEvent('page'), popup.getByRole('button', { name: 'Open notebook' }).click()]);
  await expect(nb.getByRole('article')).toHaveCount(4);
  return nb;
}

test.describe('notebook page', () => {
  // P2-K2
  test('P2-K2 the stats line', async ({ context, extensionId }) => {
    const nb = await openNotebook(context, extensionId);
    await expect(nb.getByLabel('Stats')).toHaveText('N1 1 · rare 1 · N2 1 · N2 grammar 1 — 3 new this week · 0 learned this week');
  });

  // P2-K3
  test('P2-K3 select two words and mark them learned together', async ({ context, extensionId }) => {
    const nb = await openNotebook(context, extensionId);
    await nb.getByLabel('Select 弄ぶ').check();
    await nb.getByLabel('Select 曖昧').check();
    const bar = nb.getByRole('toolbar', { name: 'Selected words' });
    await expect(bar).toContainText('2 selected');
    await bar.getByRole('button', { name: 'Mark learned' }).click();
    await expect(nb.getByRole('article')).toHaveCount(2); // hidden (Hide learned)
    await expect(nb.getByLabel('Stats')).toContainText('2 learned this week');
    await expect(bar).toContainText('0 selected');
  });

  // P2-K4
  test('P2-K4 select all shown, delete asks once with the totals, then removes them', async ({ context, extensionId }) => {
    const nb = await openNotebook(context, extensionId);
    const bar = nb.getByRole('toolbar', { name: 'Selected words' });
    await bar.getByRole('button', { name: 'Select all shown' }).click();
    await expect(bar).toContainText('4 selected');
    await bar.getByRole('button', { name: 'Delete' }).click();
    await bar.getByRole('button', { name: 'Delete 4 words (5 sightings)?' }).click();
    await expect(nb.getByRole('article')).toHaveCount(0);
    await expect(nb.getByText('Nothing here yet.', { exact: false })).toBeVisible();
  });

  // P2-K5
  test('P2-K5 export only the selected words (also from the list view)', async ({ context, extensionId }) => {
    const nb = await openNotebook(context, extensionId);
    await nb.getByLabel('View').selectOption('list');
    await nb.getByLabel('Select 漠然').check();
    await nb.getByLabel('Select 曖昧').check();
    const [download] = await Promise.all([
      nb.waitForEvent('download'),
      nb.getByRole('toolbar', { name: 'Selected words' }).getByRole('button', { name: 'Export selected' }).click(),
    ]);
    const bytes = readFileSync((await download.path())!);
    const v = new DataView(bytes.buffer, bytes.byteOffset);
    const nameLen = v.getUint16(26, true);
    const db = new (await initSqlJs()).Database(bytes.subarray(30 + nameLen, 30 + nameLen + v.getUint32(18, true)));
    expect(db.exec('SELECT sfld FROM notes')[0]!.values.flat().sort()).toEqual(['曖昧', '漠然'].sort());
  });
});
