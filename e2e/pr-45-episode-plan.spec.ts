/**
 * Show-aware word picking: with a subtitle file, each episode's hard words are ranked before it
 * plays (harder, everyday, recurring first; terms made up for the show left out) and only the top N
 * are logged, so a dense show (A Certain Magical Index) gives its best words, a light one all of its few.
 * Test IDs: docs/TEST_PLAN.md P2-P1..P2-P4.
 *
 * Run: npm run test:e2e -- e2e/pr-45-episode-plan.spec.ts
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { test as unit } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import { Dictionary } from '../extension/src/lib/dict';
import { episodeCandidates, planEpisode, usefulness } from '../extension/src/lib/episode-plan';
import { loadTokenizer, type Morph } from '../extension/src/lib/tokenizer';
import { SITE, expect, loadFile, openPopup, overlayIn, setLocal, test } from './fixtures/extension';

const KUROMOJI = path.join(path.dirname(createRequire(import.meta.url).resolve('kuromoji/package.json')), 'dict');

unit.describe('episode plan', () => {
  let morph: Morph;
  const dict = new Dictionary(async (kind, b) => JSON.parse(gunzipSync(readFileSync(`extension/public/dict/${kind}/${b}.json.gz`)).toString()));
  unit.beforeAll(async () => {
    morph = await loadTokenizer(async (f) => {
      const b = gunzipSync(readFileSync(path.join(KUROMOJI, f)));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    });
  });

  // P2-P1
  unit('P2-P1 harder, everyday and recurring words rank first; a light episode keeps all', () => {
    const c = (word: string, level: string, common: boolean, count = 1) => ({ word, level, common, count });
    const cands = [c('弄ぶ', 'rare', false), c('曖昧', 'N2', true), c('漠然', 'N1', true, 2), c('掴む', 'N3', true)];
    expect(usefulness(cands[2]!)).toBeGreaterThan(usefulness(cands[1]!));
    expect([...planEpisode(cands, 2)]).toEqual(['漠然', '曖昧']);
    expect(planEpisode(cands, 40).size).toBe(4); // fewer than N: all of them
    expect(planEpisode(cands, 0).size).toBe(4); // "All"
  });

  // P2-P2
  unit("P2-P2 terms made up for the show are left out; real words in the same lines aren't", async () => {
    const lines = ['幻想殺しが発動した', 'また幻想殺しだ', '禁書目録を守る', '禁書目録の話', '漠然とした不安'];
    const words = (await episodeCandidates(dict, morph, lines, 3)).map((c) => c.word);
    expect(words).not.toContain('幻想'); // only ever seen inside 幻想殺し
    expect(words).not.toContain('目録'); // only inside 禁書目録
    expect(words).toContain('漠然');
  });
});

const lines: [string, string, string][] = [
  ['00:00:00,500', '00:00:04,000', '漠然とした気持ち'],
  ['00:00:04,000', '00:00:08,000', '弄んでいる'],
  ['00:00:08,000', '00:00:12,000', '曖昧な返事'],
  ['00:00:12,000', '00:00:16,000', '漠然と考える'],
];
const srt = lines.map(([a, b, t], i) => `${i + 1}\n${a} --> ${b}\n${t}\n`).join('\n');

async function rows(context: BrowserContext) {
  return context.serviceWorkers()[0]!.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => (indexedDB.open('jimaku-kasane-notebook').onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result)));
    if (!db.objectStoreNames.contains('entries')) return [];
    const all = await new Promise<{ word: string; source: string }[]>((resolve) => (db.transaction('entries').objectStore('entries').getAll().onsuccess = (e) => resolve((e.target as IDBRequest).result)));
    db.close();
    return [...new Set(all.filter((r) => r.source === 'auto').map((r) => r.word))].sort();
  });
}

test.describe('logging an episode', () => {
  // P2-P3
  test('P2-P3 only the most useful N words of the episode are logged', async ({ context, extensionId }) => {
    test.setTimeout(90_000);
    await setLocal(context, { notebookPerEpisode: 2 });
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, { name: 'ep.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srt) });
    await expect(popup.getByText('This episode: the 2 most useful of 3 hard words')).toBeVisible({ timeout: 15_000 });
    await page.bringToFront();
    await expect(overlayIn(page)).toHaveText('漠然と考える', { timeout: 20_000 });
    await page.waitForFunction(() => document.querySelector('video')!.currentTime > 14);
    expect(await rows(context)).toEqual(['曖昧', '漠然'].sort()); // not 弄ぶ (rare, uncommon, once)
  });

  // P2-P4
  test('P2-P4 words you click are logged whatever the plan', async ({ context, extensionId }) => {
    await setLocal(context, { notebookPerEpisode: 2 });
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    // 弄ぶ on screen now; two stronger words later in the file take the plan's 2 places.
    const file = [
      '1\n00:00:00,000 --> 00:01:00,000\n弄んでいる\n',
      '2\n00:02:00,000 --> 00:02:03,000\n漠然とした気持ち\n',
      '3\n00:02:04,000 --> 00:02:07,000\n漠然と考える\n',
      '4\n00:02:08,000 --> 00:02:11,000\n曖昧な返事\n',
    ].join('\n');
    await loadFile(popup, { name: 'ep.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(file) });
    await expect(popup.getByText('This episode: the 2 most useful of 3 hard words')).toBeVisible({ timeout: 15_000 });
    await page.bringToFront();
    await overlayIn(page).locator('.w', { hasText: '弄んでいる' }).click();
    const clicked = () =>
      context.serviceWorkers()[0]!.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => (indexedDB.open('jimaku-kasane-notebook').onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result)));
        if (!db.objectStoreNames.contains('entries')) return [];
        const all = await new Promise<{ word: string; source: string }[]>((resolve) => (db.transaction('entries').objectStore('entries').getAll().onsuccess = (e) => resolve((e.target as IDBRequest).result)));
        db.close();
        return all.map((r) => `${r.word}:${r.source}`);
      });
    await expect.poll(clicked).toContain('弄ぶ:click');
  });
});
