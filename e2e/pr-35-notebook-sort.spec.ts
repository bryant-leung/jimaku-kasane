/**
 * Notebook: one card per word (sightings across episodes merged, "seen in N episodes", a strip to
 * flip between them), a sort menu (most seen, hardest, newest, reading, episode order), grouping by
 * show or none, and search where hiragana and katakana match. Export gives one note per word.
 * Test IDs: docs/TEST_PLAN.md P2-S1..P2-S7.
 *
 * Run: npm run test:e2e -- e2e/pr-35-notebook-sort.spec.ts
 */
import { readFileSync } from 'node:fs';
import { test as unit } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import initSqlJs from 'sql.js';
import type { NotebookEntry } from '../extension/src/lib/notebook';
import { matchesQuery, mergeCards, sortCards } from '../extension/src/lib/notebook-view';
import { SITE, expect, openPopup, setJimakuKey, test } from './fixtures/extension';

const eu = (n: number) => ({ episode: `eu${n}`, title: `Hibike! Euphonium - Episode ${n}`, fileName: `eu0${n}.srt` });
const ch = { episode: 'ch1', title: 'Chitose-kun - Episode 1', fileName: 'ch01.srt' };
const base = { source: 'auto' as const, time: 30, start: 0, length: 2 };
const ROWS: Omit<NotebookEntry, 'id' | 'shot'>[] = [
  { ...base, ...eu(3), word: '漠然', reading: 'ばくぜん', meaning: 'vague', level: 'N1', line: '漠然とした気持ち', at: 3 },
  { ...base, ...eu(4), word: '漠然', reading: 'ばくぜん', meaning: 'vague', level: 'N1', line: '漠然と考えていた', at: 5, time: 90 },
  { ...base, ...ch, word: '諦める', reading: 'あきらめる', meaning: 'to give up', level: 'N2', line: '諦めるな', length: 3, at: 4 },
  { ...base, ...eu(3), word: '弄ぶ', reading: 'もてあそぶ', meaning: 'to play with', level: 'rare', line: '弄ぶな', at: 2 },
  { ...base, ...ch, word: '曖昧', reading: 'あいまい', meaning: 'vague; ambiguous', level: 'N2', line: '曖昧な返事', at: 1 },
];

unit.describe('cards and order', () => {
  const cards = mergeCards(ROWS.map((r, id) => ({ ...r, id })));
  const order = (by: Parameters<typeof sortCards>[1]) => sortCards(cards, by).map((c) => c.word);

  // P2-S1
  unit('P2-S1 sightings merge into one card; each sort order; kana-insensitive search', () => {
    const vague = cards.find((c) => c.word === '漠然')!;
    expect(vague.episodes).toBe(2);
    expect(vague.seen.map((s) => s.episode)).toEqual(['eu4', 'eu3']); // newest first
    expect(order('seen')).toEqual(['漠然', '諦める', '弄ぶ', '曖昧']);
    expect(order('hardest')).toEqual(['漠然', '弄ぶ', '諦める', '曖昧']);
    expect(order('newest')).toEqual(['漠然', '諦める', '弄ぶ', '曖昧']);
    expect(order('reading')).toEqual(['曖昧', '諦める', '漠然', '弄ぶ']);
    expect(order('episode')).toEqual(['曖昧', '弄ぶ', '漠然', '諦める']);
    const give = cards.find((c) => c.word === '諦める')!;
    expect(matchesQuery(give, 'アキラメ')).toBe(true); // katakana finds the hiragana reading
    expect(matchesQuery(give, 'GIVE UP')).toBe(true);
    expect(matchesQuery(give, 'vague')).toBe(false);
  });
});

async function seed(context: BrowserContext) {
  await setJimakuKey(context, 'unused');
  const sw = context.serviceWorkers()[0]!;
  await sw.evaluate(async (rows) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('jimaku-kasane-notebook', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('entries', { keyPath: 'id', autoIncrement: true }).createIndex('episode', 'episode');
        r.result.createObjectStore('shots', { autoIncrement: true });
      };
      r.onsuccess = () => resolve(r.result);
    });
    const canvas = new OffscreenCanvas(64, 36);
    canvas.getContext('2d')!.fillRect(0, 0, 64, 36);
    const jpeg = await canvas.convertToBlob({ type: 'image/jpeg' });
    for (const row of rows) {
      const tx = db.transaction(['entries', 'shots'], 'readwrite');
      const id = await new Promise<IDBValidKey>((resolve) => (tx.objectStore('shots').add(jpeg).onsuccess = (e) => resolve((e.target as IDBRequest).result)));
      tx.objectStore('entries').add({ ...row, shot: id });
      await new Promise((resolve) => (tx.oncomplete = resolve));
    }
    db.close();
  }, ROWS);
}

async function openNotebook(context: BrowserContext, extensionId: string) {
  await seed(context);
  const page = await context.newPage();
  await page.goto(`${SITE}/talk`);
  const popup = await openPopup(context, extensionId, page);
  const [nb] = await Promise.all([context.waitForEvent('page'), popup.getByRole('button', { name: 'Open notebook' }).click()]);
  await expect(nb.getByText('4 words (5 sightings) in 2 shows · 0 learned · showing 4')).toBeVisible();
  return nb;
}

test.describe('notebook page', () => {
  // P2-S2
  test('P2-S2 a word met in two episodes is one card; the strip flips between sightings', async ({ context, extensionId }) => {
    const nb = await openNotebook(context, extensionId);
    const vague = nb.getByRole('article', { name: '漠然' });
    await expect(vague).toHaveCount(1);
    await expect(vague).toContainText('Seen in 2 episodes');
    const strip = vague.getByLabel('Sightings').getByRole('button');
    await expect(strip).toHaveCount(2);
    await expect(vague.locator('.line')).toHaveText('漠然と考えていた'); // newest first
    await strip.nth(1).click();
    await expect(nb.getByRole('article', { name: '漠然' }).locator('.line')).toHaveText('漠然とした気持ち');
    await expect(nb.getByRole('article', { name: '漠然' })).toContainText('Hibike! Euphonium - Episode 3 · 0:30');
  });

  // P2-S3
  test('P2-S3 the sort menu orders the cards', async ({ context, extensionId }) => {
    const nb = await openNotebook(context, extensionId);
    await nb.getByLabel('Group').selectOption('none');
    const words = nb.locator('article .word');
    await expect(nb.getByRole('heading', { level: 2 })).toHaveCount(0);
    await expect(words).toHaveText([/^漠然/, /^諦める/, /^弄ぶ/, /^曖昧/]); // most seen (default)
    await nb.getByLabel('Sort').selectOption('hardest');
    await expect(words).toHaveText([/^漠然/, /^弄ぶ/, /^諦める/, /^曖昧/]);
    await nb.getByLabel('Sort').selectOption('reading');
    await expect(words).toHaveText([/^曖昧/, /^諦める/, /^漠然/, /^弄ぶ/]);
  });

  // P2-S4
  test('P2-S4 grouped by show, the order applies inside each show', async ({ context, extensionId }) => {
    const nb = await openNotebook(context, extensionId);
    await nb.getByLabel('Sort').selectOption('reading');
    await expect(nb.getByRole('heading', { level: 2 })).toHaveText(['Hibike! Euphonium', 'Chitose-kun']); // newest show first
    await expect(nb.getByRole('region', { name: 'Hibike! Euphonium' }).locator('article .word')).toHaveText([/^漠然/, /^弄ぶ/]);
    await expect(nb.getByRole('region', { name: 'Chitose-kun' }).locator('article .word')).toHaveText([/^曖昧/, /^諦める/]);
  });

  // P2-S5
  test('P2-S5 search: katakana finds hiragana readings', async ({ context, extensionId }) => {
    const nb = await openNotebook(context, extensionId);
    await nb.getByRole('searchbox', { name: 'Search' }).fill('アイマイ');
    await expect(nb.getByRole('article')).toHaveCount(1);
    await expect(nb.getByRole('article', { name: '曖昧' })).toBeVisible();
  });

  // P2-S6
  test('P2-S6 deleting a card with several sightings asks once more, then removes them all', async ({ context, extensionId }) => {
    const nb = await openNotebook(context, extensionId);
    const del = nb.getByRole('article', { name: '漠然' }).getByRole('button', { name: 'Delete' });
    await del.click();
    await expect(nb.getByRole('article', { name: '漠然' }).getByRole('button', { name: 'Delete all 2?' })).toBeVisible();
    await nb.getByRole('article', { name: '漠然' }).getByRole('button', { name: 'Delete all 2?' }).click();
    await expect(nb.getByRole('article', { name: '漠然' })).toHaveCount(0);
    await expect(nb.getByText('3 words (3 sightings) in 2 shows · 0 learned · showing 3')).toBeVisible();
  });

  // P2-S7
  test('P2-S7 export gives one Anki note per word', async ({ context, extensionId }) => {
    const nb = await openNotebook(context, extensionId);
    const [download] = await Promise.all([nb.waitForEvent('download'), nb.getByRole('button', { name: 'Export for Anki (.apkg)' }).click()]);
    const bytes = readFileSync((await download.path())!);
    // collection.anki2 is the first stored file in the zip.
    const v = new DataView(bytes.buffer, bytes.byteOffset);
    const nameLen = v.getUint16(26, true);
    const size = v.getUint32(18, true);
    const db = new (await initSqlJs()).Database(bytes.subarray(30 + nameLen, 30 + nameLen + size));
    expect(db.exec('SELECT sfld FROM notes ORDER BY sfld')[0]!.values.flat().sort()).toEqual(['弄ぶ', '曖昧', '漠然', '諦める'].sort());
  });
});
