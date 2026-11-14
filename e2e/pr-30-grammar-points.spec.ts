/**
 * Grammar points: 126 N2/N1 patterns written for this project (～ざるを得ない, ～わけにはいかない…),
 * matched on kuromoji's dictionary forms so conjugated forms count, logged to the notebook like
 * words (with line and screenshot) and filterable there.
 * Test IDs: docs/archive/TEST_PLAN-2026-11.md P2-G1..P2-G6.
 *
 * Run: npm run test:e2e -- e2e/pr-30-grammar-points.spec.ts
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { test as unit } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import { GRAMMAR, GrammarMatcher } from '../extension/src/lib/grammar';
import { loadTokenizer } from '../extension/src/lib/tokenizer';
import { SITE, expect, loadFile, openPopup, overlayIn, test } from './fixtures/extension';

const KUROMOJI = path.join(path.dirname(createRequire(import.meta.url).resolve('kuromoji/package.json')), 'dict');

unit.describe('grammar patterns', () => {
  let gm: GrammarMatcher;
  unit.beforeAll(async () => {
    const morph = await loadTokenizer(async (f) => {
      const b = gunzipSync(readFileSync(path.join(KUROMOJI, f)));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    });
    gm = new GrammarMatcher(morph);
  });
  const found = (s: string) => gm.match(s).map((m) => m.point.pattern);

  // P2-G1
  unit('every pattern matches its own example', () => {
    expect(GRAMMAR.length).toBeGreaterThanOrEqual(120);
    const missed = GRAMMAR.filter((p) => !gm.match(p.example).some((m) => m.point === p)).map((p) => p.pattern);
    expect(missed).toEqual([]);
    const uncompiled = gm.compiled.filter((c) => !c.point.re && c.seqs.length < c.point.cores.length).map((c) => c.point.pattern);
    expect(uncompiled).toEqual([]);
  });

  // P2-G2
  unit('conjugated forms count, and the match covers the pattern', () => {
    expect(found('中止せざるを得なかった')).toContain('～ざるを得ない');
    expect(found('帰るわけにはいかなかった')).toContain('～わけにはいかない');
    expect(found('お答えしかねます')).toEqual(['～かねる']);
    const [m] = gm.match('雨にもかかわらず試合は続いた');
    expect('雨にもかかわらず試合は続いた'.slice(m!.start, m!.start + m!.length)).toBe('にもかかわらず');
  });

  // P2-G3
  unit('everyday lines match nothing; a pattern inside a longer one is dropped', () => {
    for (const s of [
      '今日はいい天気ですね', 'もう一回やってみよう', '久美子、ちょっと来て', '先輩の演奏、すごかった', 'なんで知ってるの？',
      '明日の練習は何時から？', '全国大会に行きたい', 'ボールに当たって痛かった', '勉強を始めた', '好きにしろよ',
      'わけがわからない', 'それは彼のものだ', 'あなたもそうするべきだ', 'この曲が好きなんだ', '一緒に帰ろう',
    ]) {
      expect(found(s), s).toEqual([]);
    }
    expect(found('失敗しかねない')).toEqual(['～かねない']); // not also ～かねる
  });
});

/** Notebook rows read in the service worker. */
async function notebook(context: BrowserContext) {
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return sw.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => (indexedDB.open('jimaku-kasane-notebook').onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result)));
    if (!db.objectStoreNames.contains('entries')) return [];
    const rows = await new Promise<{ word: string; kind?: string; level: string; meaning?: string; start: number; length: number; shot?: number }[]>(
      (resolve) => (db.transaction('entries').objectStore('entries').getAll().onsuccess = (e) => resolve((e.target as IDBRequest).result)),
    );
    db.close();
    return rows;
  });
}

const LINE = '雨なので中止せざるを得なかった';

test.describe('grammar in the notebook', () => {
  async function play(context: BrowserContext, extensionId: string) {
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, { name: 'ep.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(`1\n00:00:00,000 --> 00:00:20,000\n${LINE}\n`) });
    await page.bringToFront();
    await expect(overlayIn(page)).toHaveText(LINE);
    return { page, popup };
  }

  // P2-G4
  test('a grammar pattern in a line on screen is logged with its meaning and place in the line', async ({ context, extensionId }) => {
    await play(context, extensionId);
    await expect.poll(async () => (await notebook(context)).filter((r) => r.kind === 'grammar').map((r) => r.word), { timeout: 15_000 }).toEqual(['～ざるを得ない']);
    const row = (await notebook(context)).find((r) => r.kind === 'grammar')!;
    expect(row.level).toBe('N2');
    expect(row.meaning).toMatch(/no choice/);
    expect(LINE.slice(row.start, row.start + row.length)).toBe('ざるを得なかっ');
    expect(row.shot).toBeDefined();
  });

  // P2-G5
  test('logging harder than N2 skips N2 patterns', async ({ context, extensionId }) => {
    const { page, popup } = await play(context, extensionId);
    await expect.poll(async () => (await notebook(context)).filter((r) => r.kind === 'grammar').length, { timeout: 15_000 }).toBe(1);
    await popup.getByText('Settings').click();
    await popup.getByLabel('Log to the notebook words harder than').selectOption('2');
    // A fresh file (new episode) with the same line: the N2 pattern is now below the bar.
    await loadFile(popup, { name: 'ep2.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(`1\n00:00:00,000 --> 00:00:20,000\n${LINE}\n`) });
    await page.bringToFront();
    await page.evaluate(() => {
      const v = document.querySelector('video')!;
      v.currentTime = 0;
      void v.play();
    });
    await page.waitForFunction(() => document.querySelector('video')!.currentTime > 2.5);
    expect((await notebook(context)).filter((r) => r.kind === 'grammar')).toHaveLength(1); // only the first episode's
  });

  // P2-G6
  test('the notebook page filters grammar and labels it', async ({ context, extensionId }) => {
    const { popup } = await play(context, extensionId);
    await expect.poll(async () => (await notebook(context)).some((r) => r.kind === 'grammar'), { timeout: 15_000 }).toBe(true);
    const [nb] = await Promise.all([context.waitForEvent('page'), popup.getByRole('button', { name: 'Open notebook' }).click()]);
    await nb.getByLabel('Type').selectOption('grammar');
    const card = nb.getByRole('article');
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAccessibleName('～ざるを得ない');
    await expect(card).toContainText('N2 grammar');
    await expect(card.locator('mark')).toHaveText('ざるを得なかっ');
    await nb.getByLabel('Type').selectOption('word');
    await expect(nb.getByRole('article', { name: '～ざるを得ない' })).toHaveCount(0);
  });
});
