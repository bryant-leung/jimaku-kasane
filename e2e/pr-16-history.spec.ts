/**
 * History: the popup lists recent episodes watched with Japanese subtitles, where the subtitles
 * came from (Jimaku / Whisper / your file), the offset used and when; each links back to its page.
 * Test IDs: docs/TEST_PLAN.md P2-H1..P2-H5.
 *
 * Run: npm run test:e2e -- e2e/pr-16-history.spec.ts
 */
import type { BrowserContext } from '@playwright/test';
import { addToHistory, historyEntry, type HistoryEntry } from '../extension/src/lib/history';
import { FAKE_KEY, mockApis } from './fixtures/apis';
import { SITE, expect, loadFile, openPopup, setJimakuKey, setLocal, test } from './fixtures/extension';

const SERVER = 'http://127.0.0.1:8765';
const history = (popup: import('@playwright/test').Page) => popup.locator('#history-list li');

async function serverUp(context: BrowserContext): Promise<void> {
  await context.route(`${SERVER}/**`, (route) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (new URL(route.request().url()).pathname === '/health') return route.fulfill({ json: { status: 'ok' }, headers: cors });
    return route.fulfill({ headers: cors, json: { cues: [] } });
  });
}

test.describe('history', () => {
  // P2-H1
  test('lists an auto-loaded episode with its source and a link back to the page', async ({ context, extensionId }) => {
    await mockApis(context);
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/pahe`);
    const popup = await openPopup(context, extensionId, page);
    await popup.getByText('History').click();
    await expect(history(popup)).toHaveCount(1, { timeout: 15_000 }); // appears once the lookup loads the file
    await expect(history(popup).first()).toContainText(/Mission: Yozakura Family ep 44 · Jimaku · /);
    await expect(history(popup).getByRole('link', { name: 'Mission: Yozakura Family ep 44' })).toHaveAttribute('href', `${SITE}/pahe`);
  });

  // P2-H2
  test('a file you load yourself shows as your file, with the offset you set', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, 'sample.srt');
    await popup.getByRole('button', { name: '+1s', exact: true }).click();
    await popup.getByText('History').click();
    await expect(history(popup).first()).toContainText(/sample\.srt · your file · offset \+1\.0s · /);
  });

  // P2-H3
  test('an episode transcribed by Whisper shows as Whisper', async ({ context, extensionId }) => {
    await mockApis(context, { noFiles: true });
    await serverUp(context);
    await setLocal(context, { prepareAhead: false });
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/live`);
    const popup = await openPopup(context, extensionId, page);
    await expect(popup.getByText(/Transcribing live/)).toBeVisible({ timeout: 15_000 });
    await popup.getByText('History').click();
    await expect(history(popup).first()).toContainText(/ep 44 · Whisper · /);
  });

  // P2-H4
  test('empty history says what will appear', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await popup.getByText('History').click();
    await expect(popup.getByText('Episodes you watch with Japanese subtitles show up here.')).toBeVisible();
    await expect(history(popup)).toHaveCount(0);
  });

  // P2-H5
  test('same episode again moves to the top instead of repeating; at most 30 kept', () => {
    const state = { fileName: 'S2 - 17.srt', fileKey: 'k1', cues: [], episodeKey: 'yozakura|44' };
    const a = historyEntry(state, 'Mission: Yozakura Family Ep. 44 :: site', 'http://x/44', new Date('2026-11-13T10:00:00Z'));
    expect(a).toMatchObject({ key: 'yozakura|44', title: 'Mission: Yozakura Family ep 44', source: 'jimaku' });
    const b = historyEntry({ fileName: 'mine.srt', fileKey: 'k2', cues: [] }, undefined, undefined);
    expect(b).toMatchObject({ key: 'file:k2', title: 'mine.srt', source: 'file' });
    let list: HistoryEntry[] = addToHistory(addToHistory([], a), b);
    list = addToHistory(list, { ...a, at: 'later' });
    expect(list.map((e) => e.key)).toEqual(['yozakura|44', 'file:k2']);
    for (let i = 0; i < 40; i++) list = addToHistory(list, { ...b, key: `file:${i}` });
    expect(list).toHaveLength(30);
  });
});
