/**
 * Text in brackets is never underlined or logged: speaker labels （久美子）, readings after names
 * 北宇治(きたうじ) (which were split into words like 氏 うじ), sound notes. Quotes 「…」 still count.
 * A word logged without a screenshot shows a slim note, not an empty frame.
 * Test IDs: docs/archive/TEST_PLAN-2026-11.md P2-B8..P2-B11.
 *
 * Run: npm run test:e2e -- e2e/pr-42-bracket-asides.spec.ts
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { test as unit } from '@playwright/test';
import { Dictionary, isMarked } from '../extension/src/lib/dict';
import { loadTokenizer, type Morph } from '../extension/src/lib/tokenizer';
import { groupWords } from '../extension/src/lib/words';
import { SITE, expect, loadFile, openPopup, overlayIn, setJimakuKey, test } from './fixtures/extension';

const KUROMOJI = path.join(path.dirname(createRequire(import.meta.url).resolve('kuromoji/package.json')), 'dict');

unit.describe('brackets', () => {
  let morph: Morph;
  const dict = new Dictionary(async (kind, b) => JSON.parse(gunzipSync(readFileSync(`extension/public/dict/${kind}/${b}.json.gz`)).toString()));
  unit.beforeAll(async () => {
    morph = await loadTokenizer(async (f) => {
      const b = gunzipSync(readFileSync(path.join(KUROMOJI, f)));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    });
  });
  const marked = async (s: string, above: number) =>
    (await dict.tokensFor(groupWords(morph.tokenize(s)))).filter((t) => isMarked(t, s, above)).map((t) => s.slice(t.start, t.start + t.length));

  // P2-B8
  unit('P2-B8 readings and speaker labels in brackets are never marked; words outside still are', async () => {
    expect(await marked('（久美子）北宇治(きたうじ)高校は 吹奏楽コンクール', 3)).toEqual([]); // was: うじ (氏)
    expect(await marked('（沢田(さわだ)樹里(じゅり)）漠然とした気持ち', 2)).toEqual(['漠然と']);
    const asides = groupWords(morph.tokenize('（葉月）記念写真！')).filter((g) => g.aside).map((g) => g.surface);
    expect(asides).toEqual(['葉月']);
  });

  // P2-B9
  unit('P2-B9 quotes are not brackets: words inside 「」 still count', async () => {
    expect(await marked('「漠然とした気持ち」', 2)).toEqual(['漠然と']);
  });
});

test.describe('notebook page', () => {
  // P2-B10
  test('P2-B10 a word without a screenshot shows a slim note, not an empty frame', async ({ context, extensionId }) => {
    await setJimakuKey(context, 'unused');
    await context.serviceWorkers()[0]!.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open('jimaku-kasane-notebook', 1);
        r.onupgradeneeded = () => {
          r.result.createObjectStore('entries', { keyPath: 'id', autoIncrement: true }).createIndex('episode', 'episode');
          r.result.createObjectStore('shots', { autoIncrement: true });
        };
        r.onsuccess = () => resolve(r.result);
      });
      const tx = db.transaction('entries', 'readwrite');
      tx.objectStore('entries').add({ word: '全身', level: 'N2', line: '全身で表す', start: 0, length: 2, episode: 'e', fileName: 'e.srt', time: 1, at: 1, source: 'auto' });
      await new Promise((resolve) => (tx.oncomplete = resolve));
      db.close();
    });
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    const [nb] = await Promise.all([context.waitForEvent('page'), popup.getByRole('button', { name: 'Open notebook' }).click()]);
    const note = nb.getByRole('article', { name: '全身' }).getByText(/^No screenshot/);
    await expect(note).toBeVisible();
    expect((await note.boundingBox())!.height).toBeLessThan(60); // was a 16:9 empty box (~170 px)
  });
});

test.describe('overlay', () => {
  // P2-B11
  test('P2-B11 on screen, the reading in brackets is not underlined', async ({ context, extensionId }) => {
    const line = '北宇治(きたうじ)の漠然とした音';
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, { name: 'ep.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(`1\n00:00:00,000 --> 00:01:00,000\n${line}\n`) });
    await page.bringToFront();
    await expect(overlayIn(page).locator('.w').first()).toBeVisible({ timeout: 15_000 });
    await popup.getByText('Settings').click();
    await popup.getByLabel('Underline words harder than').selectOption('3');
    await expect(overlayIn(page).locator('.w.mark')).toHaveText(['漠然と']);
  });
});
