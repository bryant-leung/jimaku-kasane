/**
 * Notebook topics: group words by subject (JMdict fields: music, baseball, food…; untagged under
 * "General") and by the anime's genres (AniList, cached). Older entries are looked up.
 * Test IDs: docs/archive/TEST_PLAN-2026-11.md P2-T1..P2-T4.
 *
 * Run: npm run test:e2e -- e2e/pr-37-notebook-topics.spec.ts
 */
import { test as unit } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import type { NotebookEntry } from '../extension/src/lib/notebook';
import { groupCards } from '../extension/src/lib/notebook-view';
import { SITE, expect, loadFile, openPopup, overlayIn, setJimakuKey, test } from './fixtures/extension';

const eu = { episode: 'eu1', title: 'Hibike! Euphonium - Episode 1', fileName: 'eu01.srt', anilistId: 20912 };
const ace = { episode: 'ace1', title: 'Ace of Diamond - Episode 1', fileName: 'ace01.srt', anilistId: 18689 };
const base = { source: 'auto' as const, time: 30, start: 0, length: 2, line: 'x', level: 'rare' };
// Saved without topics (as before PR 37): the page looks them up.
const ROWS: Omit<NotebookEntry, 'id' | 'shot'>[] = [
  { ...base, ...eu, word: '音程', at: 1 },
  { ...base, ...eu, word: '和音', at: 2 },
  { ...base, ...eu, word: '漠然', level: 'N1', at: 3 },
  { ...base, ...ace, word: '打者', at: 4 },
  { ...base, ...ace, word: '投手', at: 5 },
  { ...base, ...ace, word: '寿司', at: 6 },
];

unit.describe('topic and genre groups', () => {
  // P2-T1
  unit('P2-T1 a word under each of its topics, untagged last; a show under each genre', () => {
    const rows = ROWS.map((r, id) => ({ ...r, id }));
    const topics: Record<string, string[]> = { 音程: ['Music'], 和音: ['Music'], 打者: ['Baseball'], 投手: ['Baseball', 'Sports'], 寿司: ['Food'] };
    const groups = groupCards(rows, 'topic', 'seen', undefined, { topicsOf: (c) => topics[c.word] ?? [] });
    expect(groups.map(([k, cs]) => `${k}:${cs.length}`)).toEqual(['Baseball:2', 'Music:2', 'Food:1', 'Sports:1', 'General:1']);
    const genres: Record<number, string[]> = { 20912: ['Drama', 'Music'], 18689: ['Sports'] };
    const byGenre = groupCards(rows, 'genre', 'seen', undefined, {
      genresOf: (c) => [...new Set(c.seen.flatMap((e) => genres[e.anilistId!] ?? []))],
    });
    expect(byGenre.map(([k, cs]) => `${k}:${cs.length}`)).toEqual(['Drama:3', 'Music:3', 'Sports:3']);
  });
});

async function seed(context: BrowserContext) {
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
  }, ROWS);
}

async function openNotebook(context: BrowserContext, extensionId: string) {
  await seed(context);
  const page = await context.newPage();
  await page.goto(`${SITE}/talk`);
  const popup = await openPopup(context, extensionId, page);
  const [nb] = await Promise.all([context.waitForEvent('page'), popup.getByRole('button', { name: 'Open notebook' }).click()]);
  await expect(nb.getByRole('article')).toHaveCount(6);
  return nb;
}

test.describe('notebook page', () => {
  // P2-T2
  test('P2-T2 group by topic: music and baseball words together, untagged under General', async ({ context, extensionId }) => {
    const nb = await openNotebook(context, extensionId);
    await nb.getByLabel('Group').selectOption('topic');
    await expect(nb.getByRole('heading', { level: 2 })).toHaveText(['Baseball (2)', 'Music (2)', 'Food, cooking (1)', 'General (1)'], { timeout: 10_000 });
    await expect(nb.getByRole('region', { name: 'Music' }).locator('article .word')).toHaveText([/^和音/, /^音程/]);
  });

  // P2-T3
  test('P2-T3 group by anime genre (AniList), asked once and cached', async ({ context, extensionId }) => {
    let asked = 0;
    await context.route('https://graphql.anilist.co/**', async (route) => {
      asked++;
      await route.fulfill({
        json: { data: { Page: { media: [{ id: 20912, genres: ['Drama', 'Music'] }, { id: 18689, genres: ['Sports'] }] } } },
      });
    });
    const nb = await openNotebook(context, extensionId);
    await nb.getByLabel('Group').selectOption('genre');
    await expect(nb.getByRole('heading', { level: 2 })).toHaveText(['Drama (3)', 'Music (3)', 'Sports (3)']);
    expect(asked).toBe(1);
    await nb.reload();
    await nb.getByLabel('Group').selectOption('genre');
    await expect(nb.getByRole('heading', { level: 2 })).toHaveText(['Drama (3)', 'Music (3)', 'Sports (3)']);
    expect(asked).toBe(1); // from the cache
  });
});

test.describe('logging', () => {
  // P2-T4
  test('P2-T4 new entries keep their topics', async ({ context, extensionId }) => {
    const line = '和音が綺麗だ';
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, { name: 'ep.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(`1\n00:00:00,000 --> 00:00:20,000\n${line}\n`) });
    await page.bringToFront();
    await overlayIn(page).locator('.w', { hasText: '和音' }).click(); // looked-up words are logged
    const sw = context.serviceWorkers()[0]!;
    const topics = () =>
      sw.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => (indexedDB.open('jimaku-kasane-notebook').onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result)));
        if (!db.objectStoreNames.contains('entries')) return null;
        const rows = await new Promise<{ word: string; topics?: string[] }[]>((resolve) => (db.transaction('entries').objectStore('entries').getAll().onsuccess = (e) => resolve((e.target as IDBRequest).result)));
        db.close();
        return rows.find((r) => r.word === '和音')?.topics ?? null;
      });
    await expect.poll(topics, { timeout: 15_000 }).toEqual(['music']);
  });
});
