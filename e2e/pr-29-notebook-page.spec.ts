/**
 * Notebook page: every logged word with its line and screenshot, grouped by show → episode,
 * with search, level / show filters, Learned (hides it and stops logging it) and Delete.
 * Test IDs: docs/TEST_PLAN.md P2-B1..P2-B7.
 *
 * Run: npm run test:e2e -- e2e/pr-29-notebook-page.spec.ts
 */
import { test as unit } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { filterEntries, showName, type NotebookEntry } from '../extension/src/lib/notebook';
import { SITE, expect, loadFile, openPopup, overlayIn, setJimakuKey, test } from './fixtures/extension';

const base = { start: 0, length: 2, at: 1, source: 'auto' as const, time: 65 };
const SEED: Omit<NotebookEntry, 'id' | 'shot'>[] = [
  { ...base, word: '漠然', reading: 'ばくぜん', meaning: 'vague; obscure', level: 'N1', line: '漠然とした気持ち', episode: 'eu3', title: 'Hibike! Euphonium - Episode 3 - AnimePahe', fileName: 'eu03.srt', at: 3 },
  { ...base, word: '弄ぶ', reading: 'もてあそぶ', meaning: 'to play with', level: 'rare', line: '気持ちを弄んでいる', start: 5, length: 5, episode: 'eu3', title: 'Hibike! Euphonium - Episode 3 - AnimePahe', fileName: 'eu03.srt', at: 2, time: 130 },
  { ...base, word: '諦める', reading: 'あきらめる', meaning: 'to give up', level: 'N2', line: 'あきらめないで', length: 7, episode: 'ch1', title: 'Chitose-kun - Episode 1', fileName: 'ch01.srt', at: 1, source: 'click' },
];

/** Puts entries (each with a small JPEG) straight into the notebook database. */
async function seed(context: BrowserContext, rows = SEED) {
  await setJimakuKey(context, 'unused'); // service worker up
  const sw = context.serviceWorkers()[0]!;
  await sw.evaluate(async (rows) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('jimaku-kasane-notebook', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('entries', { keyPath: 'id', autoIncrement: true }).createIndex('episode', 'episode');
        r.result.createObjectStore('shots', { autoIncrement: true });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
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
  }, rows);
}

async function counts(context: BrowserContext) {
  const sw = context.serviceWorkers()[0]!;
  return sw.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => (indexedDB.open('jimaku-kasane-notebook').onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result)));
    const n = (s: string) => new Promise<number>((resolve) => (db.transaction(s).objectStore(s).count().onsuccess = (e) => resolve((e.target as IDBRequest<number>).result)));
    const out = { entries: await n('entries'), shots: await n('shots') };
    db.close();
    return out;
  });
}

async function openNotebook(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${SITE}/talk`);
  const popup = await openPopup(context, extensionId, page);
  const [nb] = await Promise.all([context.waitForEvent('page'), popup.getByRole('button', { name: 'Open notebook' }).click()]);
  await nb.waitForLoadState();
  await expect(nb.getByRole('heading', { name: 'Notebook', level: 1 })).toBeVisible();
  return nb;
}

unit.describe('notebook helpers', () => {
  // P2-B1
  unit('show names from page titles; filters', () => {
    expect(showName({ title: 'Hibike! Euphonium - Episode 3 - AnimePahe', fileName: 'x.srt' })).toBe('Hibike! Euphonium');
    expect(showName({ title: 'Yozakura-san Chi no Daisakusen Ep 44', fileName: 'x.srt' })).toBe('Yozakura-san Chi no Daisakusen');
    expect(showName({ fileName: 'Chitose_01.srt' })).toBe('Chitose');
    const rows = SEED.map((r, id) => ({ ...r, id }));
    const f = { query: '', level: '', show: '', hideLearned: true };
    expect(filterEntries(rows, f, ['弄ぶ']).map((r) => r.word)).toEqual(['漠然', '諦める']);
    expect(filterEntries(rows, { ...f, query: 'give up' }, []).map((r) => r.word)).toEqual(['諦める']);
    expect(filterEntries(rows, { ...f, level: 'N1' }, []).map((r) => r.word)).toEqual(['漠然']);
    expect(filterEntries(rows, { ...f, show: 'Chitose-kun' }, []).map((r) => r.word)).toEqual(['諦める']);
  });
});

test.describe('notebook page', () => {
  // P2-B2
  test('the popup opens the notebook: words by show and episode, with line and screenshot', async ({ context, extensionId }) => {
    await seed(context);
    const nb = await openNotebook(context, extensionId);
    await expect(nb.getByText('3 words in 2 shows · 0 learned · showing 3')).toBeVisible();
    const eu = nb.getByRole('region', { name: 'Hibike! Euphonium' });
    await expect(eu.getByRole('heading', { level: 3 })).toHaveText('Hibike! Euphonium - Episode 3 - AnimePahe');
    await expect(eu.getByRole('article')).toHaveCount(2);
    const word = eu.getByRole('article', { name: '漠然' });
    await expect(word).toContainText('ばくぜん');
    await expect(word).toContainText('N1');
    await expect(word).toContainText('vague; obscure');
    await expect(word.locator('mark')).toHaveText('漠然');
    await expect(word).toContainText('1:05');
    await expect(word.getByRole('img')).toHaveJSProperty('complete', true);
    await expect(nb.getByRole('region', { name: 'Chitose-kun' }).getByRole('article', { name: '諦める' })).toContainText('you looked it up');
  });

  // P2-B3
  test('search, level and show filters narrow the list', async ({ context, extensionId }) => {
    await seed(context);
    const nb = await openNotebook(context, extensionId);
    await nb.getByRole('searchbox', { name: 'Search' }).fill('play with');
    await expect(nb.getByRole('article')).toHaveCount(1);
    await expect(nb.getByRole('article', { name: '弄ぶ' })).toBeVisible();
    await nb.getByRole('searchbox', { name: 'Search' }).fill('');
    await nb.getByLabel('Level').selectOption('N2');
    await expect(nb.getByRole('article')).toHaveCount(1);
    await expect(nb.getByRole('article', { name: '諦める' })).toBeVisible();
    await nb.getByLabel('Level').selectOption('');
    await nb.getByLabel('Show').selectOption('Hibike! Euphonium');
    await expect(nb.getByRole('article')).toHaveCount(2);
  });

  // P2-B4
  test('Learned hides a word and stops it being logged; it can be undone', async ({ context, extensionId }) => {
    await seed(context);
    const nb = await openNotebook(context, extensionId);
    await nb.getByRole('article', { name: '漠然' }).getByRole('button', { name: 'Learned' }).click();
    await expect(nb.getByRole('article', { name: '漠然' })).toHaveCount(0);
    await expect(nb.getByText('3 words in 2 shows · 1 learned · showing 2')).toBeVisible();
    const sw = context.serviceWorkers()[0]!;
    expect(await sw.evaluate(() => (globalThis as unknown as { chrome: { storage: { local: { get(k: string): Promise<Record<string, string[]>> } } } }).chrome.storage.local.get('notebookLearned').then((s) => s.notebookLearned))).toEqual(['漠然']);
    await nb.getByLabel('Hide learned').uncheck();
    await nb.getByRole('article', { name: '漠然' }).getByRole('button', { name: 'Not learned' }).click();
    await expect(nb.getByRole('article', { name: '漠然' }).getByRole('button', { name: 'Learned' })).toBeVisible();
  });

  // P2-B5
  test('Delete removes the word and its unused screenshot', async ({ context, extensionId }) => {
    await seed(context);
    const nb = await openNotebook(context, extensionId);
    expect(await counts(context)).toEqual({ entries: 3, shots: 3 });
    await nb.getByRole('article', { name: '弄ぶ' }).getByRole('button', { name: 'Delete' }).click();
    await expect(nb.getByRole('article', { name: '弄ぶ' })).toHaveCount(0);
    await expect.poll(() => counts(context)).toEqual({ entries: 2, shots: 2 });
  });

  // P2-B6
  test('clicking a screenshot enlarges it; a click closes it', async ({ context, extensionId }) => {
    await seed(context);
    const nb = await openNotebook(context, extensionId);
    await nb.getByRole('button', { name: 'Enlarge screenshot of 漠然' }).click();
    const viewer = nb.getByRole('dialog', { name: 'Screenshot' });
    await expect(viewer).toBeVisible();
    await viewer.click();
    await expect(viewer).toBeHidden();
  });

  // P2-B7
  test('words logged while you watch appear in the notebook', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    const line = '漠然とした気持ちを弄んでいる';
    await loadFile(popup, { name: 'ep.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(`1\n00:00:00,000 --> 00:00:20,000\n${line}\n`) });
    await page.bringToFront();
    await expect(overlayIn(page)).toHaveText(line);
    await expect(popup.getByText('Notebook: 2 words')).toBeVisible({ timeout: 15_000 });
    const nb = await openNotebook(context, extensionId);
    await expect(nb.getByRole('article', { name: '漠然' }).getByRole('img')).toBeVisible();
    await expect(nb.getByRole('article', { name: '弄ぶ' })).toContainText('弄んでいる');
  });
});
