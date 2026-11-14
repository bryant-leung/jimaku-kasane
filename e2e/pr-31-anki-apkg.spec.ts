/**
 * Anki export with pictures: the notebook page exports what's listed as an .apkg (Anki deck) with
 * each entry's screenshot on its card. Collection layout mirrors genanki (schema 11).
 * Test IDs: docs/TEST_PLAN.md P2-A1..P2-A4. (Import into real Anki: see docs/TEST_RESULTS.md.)
 *
 * Run: npm run test:e2e -- e2e/pr-31-anki-apkg.spec.ts
 * Sample decks for an Anki import check: APKG_SAMPLE=/path/a.apkg (P2-A1, Node) or APKG_SAMPLE_BROWSER=/path/b.apkg (P2-A3, browser)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { test as unit } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import initSqlJs from 'sql.js';
import { buildApkg, DECK_NAME } from '../extension/src/lib/apkg';
import type { NotebookEntry } from '../extension/src/lib/notebook';
import { crc32 } from '../extension/src/lib/zip';
import { SITE, expect, openPopup, setJimakuKey, test } from './fixtures/extension';

/** Reads a stored (uncompressed) zip, checking each file's CRC. */
function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  while (v.getUint32(at, true) === 0x04034b50) {
    const crc = v.getUint32(at + 14, true);
    const size = v.getUint32(at + 18, true);
    const nameLen = v.getUint16(at + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLen));
    const data = bytes.slice(at + 30 + nameLen, at + 30 + nameLen + size);
    expect(crc32(data), name).toBe(crc);
    out.set(name, data);
    at += 30 + nameLen + size;
  }
  return out;
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const base = { at: 1, source: 'auto' as const, time: 65, episode: 'eu3', title: 'Hibike! Euphonium - Episode 3', fileName: 'eu03.srt' };
const ENTRIES: NotebookEntry[] = [
  { ...base, id: 1, word: '漠然', reading: 'ばくぜん', meaning: 'vague', level: 'N1', line: '漠然とした気持ち', start: 0, length: 2, shot: 7 },
  { ...base, id: 2, word: '弄ぶ', reading: 'もてあそぶ', meaning: 'to play with', level: 'rare', line: '気持ちを<弄>んでいる', start: 4, length: 3, shot: 7 },
  { ...base, id: 3, word: '～ざるを得ない', meaning: 'have no choice but to', level: 'N2', line: '中止せざるを得なかった', start: 3, length: 7, kind: 'grammar' },
];

async function readDeck(bytes: Uint8Array) {
  const files = unzip(bytes);
  const SQL = await initSqlJs();
  const db = new SQL.Database(files.get('collection.anki2')!);
  const rows = (sql: string) => db.exec(sql)[0]?.values ?? [];
  return { files, db, rows };
}

unit.describe('Anki deck file', () => {
  // P2-A1
  unit('P2-A1 a valid deck: notes with sentence, picture and tags; one image per screenshot', async () => {
    const SQL = await initSqlJs();
    const bytes = await buildApkg(SQL, ENTRIES, async (id) => (id === 7 ? JPEG : undefined), 1_700_000_000_000);
    if (process.env.APKG_SAMPLE) writeFileSync(process.env.APKG_SAMPLE, bytes);
    const { files, rows } = await readDeck(bytes);
    expect([...files.keys()]).toEqual(['collection.anki2', 'media', '0']);
    expect(JSON.parse(new TextDecoder().decode(files.get('media')!))).toEqual({ 0: 'jimaku-kasane-7.jpg' });
    expect(files.get('0')).toEqual(JPEG);
    expect(rows('PRAGMA integrity_check')).toEqual([['ok']]);
    const [col] = rows('SELECT ver, models, decks FROM col');
    expect(col![0]).toBe(11);
    const model = Object.values(JSON.parse(col![1] as string) as Record<string, { flds: { name: string }[] }>)[0]!;
    expect(model.flds.map((f) => f.name)).toEqual(['Word', 'Reading', 'Meaning', 'Level', 'Sentence', 'Picture', 'Source']);
    expect(Object.values(JSON.parse(col![2] as string) as Record<string, { name: string }>).map((d) => d.name)).toContain(DECK_NAME);
    const notes = rows('SELECT flds, tags, sfld FROM notes ORDER BY id').map(([f, t, s]) => ({ f: (f as string).split('\x1f'), t, s }));
    expect(notes).toHaveLength(3);
    expect(notes[0]!.f[4]).toBe('<b>漠然</b>とした気持ち');
    expect(notes[0]!.f[5]).toBe('<img src="jimaku-kasane-7.jpg">');
    expect(notes[1]!.f[4]).toBe('気持ちを<b>&lt;弄&gt;</b>んでいる'); // escaped
    expect(notes[1]!.f[5]).toBe(notes[0]!.f[5]); // same screenshot, one file
    expect(notes[2]!.f[3]).toBe('N2 grammar');
    expect(notes[2]!.f[5]).toBe(''); // no screenshot
    expect(notes[2]!.t).toBe(' jimaku-kasane grammar N2 ');
    expect(notes[0]!.f[6]).toBe('Hibike! Euphonium - Episode 3 · 1:05');
    expect(rows('SELECT count(*) FROM cards')).toEqual([[3]]);
  });

  // P2-A2
  unit('P2-A2 exporting again gives the same note ids for the same words (re-import updates)', async () => {
    const SQL = await initSqlJs();
    const guids = async (now: number) =>
      (await readDeck(await buildApkg(SQL, ENTRIES, async () => JPEG, now))).rows('SELECT guid FROM notes ORDER BY id').map(([g]) => g);
    expect(await guids(1)).toEqual(await guids(2_000_000));
    expect(new Set(await guids(1)).size).toBe(3);
  });
});

/** Seeds the notebook database through the service worker. */
async function seed(context: BrowserContext, rows: Omit<NotebookEntry, 'id' | 'shot'>[]) {
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
  }, rows);
}

test.describe('export from the notebook page', () => {
  async function openNotebook(context: BrowserContext, extensionId: string) {
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    const [nb] = await Promise.all([context.waitForEvent('page'), popup.getByRole('button', { name: 'Open notebook' }).click()]);
    await expect(nb.getByRole('article')).toHaveCount(3);
    return nb;
  }
  const rows = ENTRIES.map(({ id: _i, shot: _s, ...e }) => e);

  // P2-A3
  test('P2-A3 Export for Anki downloads a deck with every listed word and its screenshot', async ({ context, extensionId }) => {
    await seed(context, rows);
    const nb = await openNotebook(context, extensionId);
    const [download] = await Promise.all([nb.waitForEvent('download'), nb.getByRole('button', { name: 'Export for Anki (.apkg)' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^jimaku-kasane-notebook-\d{4}-\d{2}-\d{2}\.apkg$/);
    await expect(nb.getByRole('status')).toHaveText('Exported 3 cards. Open the file to import it into Anki.');
    if (process.env.APKG_SAMPLE_BROWSER) await download.saveAs(process.env.APKG_SAMPLE_BROWSER);
    const { files, rows: q } = await readDeck(readFileSync((await download.path())!));
    expect(q('SELECT count(*) FROM notes')).toEqual([[3]]);
    expect(Object.keys(JSON.parse(new TextDecoder().decode(files.get('media')!)))).toHaveLength(3); // each seeded with its own
    expect(files.get('0')!.subarray(0, 2)).toEqual(new Uint8Array([0xff, 0xd8])); // JPEG
  });

  // P2-A4
  test('P2-A4 the export follows the filters', async ({ context, extensionId }) => {
    await seed(context, rows);
    const nb = await openNotebook(context, extensionId);
    await nb.getByLabel('Type').selectOption('grammar');
    const [download] = await Promise.all([nb.waitForEvent('download'), nb.getByRole('button', { name: 'Export for Anki (.apkg)' }).click()]);
    const { rows: q } = await readDeck(readFileSync((await download.path())!));
    expect(q('SELECT sfld FROM notes')).toEqual([['～ざるを得ない']]);
  });
});
