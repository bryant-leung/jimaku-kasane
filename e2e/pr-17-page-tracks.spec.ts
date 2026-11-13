/**
 * The page's own Japanese subtitles: when the video carries a Japanese text track (HTML5 <track>,
 * or a streaming player that exposes one), use it: official and timed to this stream. It beats
 * Jimaku and Whisper. Non-Japanese tracks are ignored. Players that draw subtitles themselves
 * without a text track (e.g. Netflix) aren't covered.
 * Test IDs: docs/TEST_PLAN.md P1-T1..P1-T5.
 *
 * Run: npm run test:e2e -- e2e/pr-17-page-tracks.spec.ts
 */
import type { BrowserContext } from '@playwright/test';
import { FAKE_KEY, mockApis } from './fixtures/apis';
import { SITE, expect, openPopup, overlayIn, setJimakuKey, setLocal, test } from './fixtures/extension';

const SERVER = 'http://127.0.0.1:8765';

async function serverUp(context: BrowserContext): Promise<string[]> {
  const transcribed: string[] = [];
  await context.route(`${SERVER}/**`, (route) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (new URL(route.request().url()).pathname === '/health') return route.fulfill({ json: { status: 'ok' }, headers: cors });
    transcribed.push(route.request().url());
    return route.fulfill({ headers: cors, json: { cues: [] } });
  });
  return transcribed;
}

test.describe("page's own Japanese subtitles", () => {
  // P1-T1
  test('uses the video\'s Japanese track instead of Jimaku, and says so', async ({ context, extensionId }) => {
    await mockApis(context);
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/track-ep`);
    await expect(overlayIn(page)).toHaveText('公式の字幕です', { timeout: 15_000 }); // tags stripped
    const popup = await openPopup(context, extensionId, page);
    await expect(popup.getByText(/Using this page's own Japanese subtitles \(日本語\)/)).toBeVisible();
    await expect(popup.getByText(/Loaded Page subtitles \(日本語\)/)).toBeVisible();
    // A Jimaku answer arriving later doesn't replace it.
    await page.waitForTimeout(3_000);
    await expect(overlayIn(page)).toHaveText('公式の字幕です');
    // The browser doesn't draw it as well (we do).
    expect(await page.evaluate(() => document.querySelector('video')!.textTracks[0]!.mode)).toBe('hidden');
  });

  // P1-T2
  test('ignores tracks in other languages (Jimaku as usual)', async ({ context, extensionId }) => {
    await mockApis(context);
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/track-en`);
    const popup = await openPopup(context, extensionId, page);
    await expect(popup.getByText(/Loaded .* from Jimaku/)).toBeVisible({ timeout: 15_000 });
    await expect(popup.getByText(/page's own Japanese subtitles/)).toBeHidden();
  });

  // P1-T3
  test('picks up lines added to the track later (streamed subtitles)', async ({ context }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/track-grow`);
    await expect(overlayIn(page)).toHaveText('最初の字幕', { timeout: 10_000 });
    await expect(overlayIn(page)).toHaveText('後から来た字幕', { timeout: 15_000 });
  });

  // P1-T4
  test('no Whisper when the page has Japanese subtitles and Jimaku has none', async ({ context, extensionId }) => {
    await mockApis(context, { noFiles: true });
    const transcribed = await serverUp(context);
    await setLocal(context, { prepareAhead: false });
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/track-ep`);
    await expect(overlayIn(page)).toHaveText('公式の字幕です', { timeout: 15_000 });
    await page.waitForTimeout(6_000); // speech keeps playing: nothing may be sent for transcription
    expect(transcribed).toHaveLength(0);
    const popup = await openPopup(context, extensionId, page);
    await expect(popup.getByText(/Using this page's own Japanese subtitles/)).toBeVisible();
  });

  // P1-T5
  test('shows in history as the page\'s own subtitles', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/track-ep`);
    await expect(overlayIn(page)).toHaveText('公式の字幕です', { timeout: 15_000 });
    const popup = await openPopup(context, extensionId, page);
    await popup.getByText('History').click();
    await expect(popup.locator('#history-list li').first()).toContainText(/ep 44 · the page's own subtitles · /);
  });
});
