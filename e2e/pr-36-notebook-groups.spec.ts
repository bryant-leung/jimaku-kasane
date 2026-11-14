/**
 * Notebook grouping (show, episode, level, type, part of speech, none) and a compact list view.
 * New entries keep their part of speech; older ones are looked up in the offline dictionary.
 * Test IDs: docs/TEST_PLAN.md P2-R1..P2-R6.
 *
 * Run: npm run test:e2e -- e2e/pr-36-notebook-groups.spec.ts
 */
import { test as unit } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import type { NotebookEntry } from '../extension/src/lib/notebook';
import { groupCards, posGroup } from '../extension/src/lib/notebook-view';
import { SITE, expect, loadFile, openPopup, overlayIn, setJimakuKey, test } from './fixtures/extension';

const eu = (n: number) => ({ episode: `eu${n}`, title: `Hibike! Euphonium - Episode ${n}`, fileName: `eu0${n}.srt` });
const ch = { episode: 'ch1', title: 'Chitose-kun - Episode 1', fileName: 'ch01.srt' };
const base = { source: 'auto' as const, time: 30, start: 0, length: 2 };
// No `pos` (as saved before PR 36): the page looks it up.
const ROWS: Omit<NotebookEntry, 'id' | 'shot'>[] = [
  { ...base, ...eu(3), word: '漠然', reading: 'ばくぜん', meaning: 'vague', level: 'N1', line: '漠然とした気持ち', at: 3 },
  { ...base, ...eu(4), word: '漠然', reading: 'ばくぜん', meaning: 'vague', level: 'N1', line: '漠然と考えていた', at: 5 },
  { ...base, ...ch, word: '諦める', reading: 'あきらめる', meaning: 'to give up', level: 'N2', line: '諦めるな', at: 4 },
  { ...base, ...eu(3), word: '弄ぶ', reading: 'もてあそぶ', meaning: 'to play with', level: 'rare', line: '弄ぶな', at: 2 },
  { ...base, ...ch, word: '曖昧', reading: 'あいまい', meaning: 'vague; ambiguous', level: 'N2', line: '曖昧な返事', at: 1 },
  { ...base, ...ch, word: '～ざるを得ない', meaning: 'have no choice but to', level: 'N2', line: '行かざるを得ない', at: 6, kind: 'grammar' },
];

unit.describe('grouping', () => {
  // P2-R1
  unit('P2-R1 part-of-speech groups and group order', () => {
    expect(posGroup(['v5b', 'vt'])).toBe('Verbs');
    expect(posGroup(['adj-i'])).toBe('い-adjectives');
    expect(posGroup(['adj-na', 'n'])).toBe('な-adjectives');
    expect(posGroup(['n', 'vs'])).toBe('Nouns');
    expect(posGroup(['adv'])).toBe('Adverbs');
    expect(posGroup(undefined)).toBe('Other');
    const rows = ROWS.map((r, id) => ({ ...r, id }));
    const names = (by: Parameters<typeof groupCards>[1]) => groupCards(rows, by, 'seen').map(([k]) => k);
    expect(names('level')).toEqual(['N1', 'rare', 'N2', 'N2 grammar']);
    expect(names('type')).toEqual(['Words', 'Grammar']);
    expect(names('episode')).toEqual(['Chitose-kun - Episode 1', 'Hibike! Euphonium - Episode 4', 'Hibike! Euphonium - Episode 3']);
    const pos = groupCards(rows, 'pos', 'seen', (c) => ({ 諦める: ['v1'], 弄ぶ: ['v5b'], 曖昧: ['adj-na'], 漠然: ['adj-t'] })[c.word]);
    expect(pos.map(([k, cs]) => `${k}:${cs.map((c) => c.word).join(',')}`)).toEqual([
      'Verbs:諦める,弄ぶ', 'な-adjectives:曖昧', 'Other adjectives:漠然', 'Grammar:～ざるを得ない',
    ]);
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
  await expect(nb.getByRole('article')).toHaveCount(5);
  return nb;
}

test.describe('notebook page', () => {
  // P2-R2
  test('P2-R2 group by level: hardest first, grammar after its level', async ({ context, extensionId }) => {
    const nb = await openNotebook(context, extensionId);
    await nb.getByLabel('Group').selectOption('level');
    await expect(nb.getByRole('heading', { level: 2 })).toHaveText(['N1 (1)', 'rare (1)', 'N2 (2)', 'N2 grammar (1)']);
  });

  // P2-R3
  test('P2-R3 group by part of speech, looked up for entries saved without it', async ({ context, extensionId }) => {
    const nb = await openNotebook(context, extensionId);
    await nb.getByLabel('Group').selectOption('pos');
    await expect(nb.getByRole('heading', { level: 2 })).toHaveText(['Verbs (2)', 'な-adjectives (1)', 'Other adjectives (1)', 'Grammar (1)'], { timeout: 10_000 });
    await expect(nb.getByRole('region', { name: 'Verbs' }).getByRole('article')).toHaveCount(2);
  });

  // P2-R4
  test('P2-R4 group by episode and by type', async ({ context, extensionId }) => {
    const nb = await openNotebook(context, extensionId);
    await nb.getByLabel('Group').selectOption('episode');
    await expect(nb.getByRole('heading', { level: 2 })).toHaveText(['Chitose-kun - Episode 1 (3)', 'Hibike! Euphonium - Episode 4 (1)', 'Hibike! Euphonium - Episode 3 (2)']);
    await nb.getByLabel('Group').selectOption('type');
    await expect(nb.getByRole('heading', { level: 2 })).toHaveText(['Words (4)', 'Grammar (1)']);
  });

  // P2-R5
  test('P2-R5 list view: one row per word', async ({ context, extensionId }) => {
    const nb = await openNotebook(context, extensionId);
    await nb.getByLabel('Group').selectOption('none');
    await nb.getByLabel('View').selectOption('list');
    await expect(nb.getByRole('article')).toHaveCount(0);
    const row = nb.getByRole('row', { name: '漠然' });
    await expect(row.getByRole('cell')).toHaveText(['Select', '漠然', 'ばくぜん', 'N1', 'vague', '2 episodes', 'Hibike! Euphonium - Episode 4 · 0:30']); // checkbox column since PR 39
    await expect(nb.getByRole('row')).toHaveCount(6); // header + 5 words
  });
});

test.describe('logging', () => {
  // P2-R6
  test('P2-R6 new entries keep their part of speech', async ({ context, extensionId }) => {
    const line = '漠然とした気持ちを弄んでいる';
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, { name: 'ep.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(`1\n00:00:00,000 --> 00:00:20,000\n${line}\n`) });
    await page.bringToFront();
    await expect(overlayIn(page)).toHaveText(line);
    const sw = context.serviceWorkers()[0]!;
    const pos = () =>
      sw.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => (indexedDB.open('jimaku-kasane-notebook').onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result)));
        if (!db.objectStoreNames.contains('entries')) return {};
        const rows = await new Promise<{ word: string; pos?: string[] }[]>((resolve) => (db.transaction('entries').objectStore('entries').getAll().onsuccess = (e) => resolve((e.target as IDBRequest).result)));
        db.close();
        return Object.fromEntries(rows.map((r) => [r.word, r.pos?.[0]]));
      });
    await expect.poll(pos, { timeout: 15_000 }).toEqual({ 漠然: 'adj-t', 弄ぶ: 'v5b' });
  });
});
