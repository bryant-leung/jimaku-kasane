/**
 * Whisper fallback: Jimaku has nothing → the extension transcribes the episode's audio with the
 * local server and shows the lines as they arrive. The server is mocked here (its own tests are
 * pytest in server/tests); the page plays real speech so the VAD segmenter runs for real.
 * Test IDs: docs/TEST_PLAN.md P3-38..P3-40.
 *
 * Run: npm run test:e2e -- e2e/pr-6-whisper-fallback.spec.ts
 */
import type { BrowserContext } from '@playwright/test';
import { FAKE_KEY, mockApis } from './fixtures/apis';
import { SITE, expect, openPopup, overlayIn, setJimakuKey, test } from './fixtures/extension';

const SERVER = 'http://127.0.0.1:8765';

/** Fake transcription server: answers each speech segment with one line at its start time. */
async function mockServer(context: BrowserContext, up = true) {
  const requests: { anilist_id: number | null; start: number; audio: string; partial?: boolean }[] = [];
  const drafts: (typeof requests)[number][] = [];
  await context.route(`${SERVER}/**`, async (route) => {
    if (!up) return route.abort('connectionrefused');
    const url = new URL(route.request().url());
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/health') return route.fulfill({ json: { status: 'ok' }, headers: cors });
    const body = route.request().postDataJSON() as (typeof requests)[number];
    if (body.partial) {
      drafts.push(body);
      return route.fulfill({
        headers: cors,
        json: { cues: [{ start: body.start, end: body.start + 1, text: `途中${drafts.length}`, raw: '', confidence: 0.2 }] },
      });
    }
    requests.push(body); // finished lines
    const n = requests.length;
    return route.fulfill({
      headers: cors,
      json: {
        cues: [
          // first line confident, later lines unsure, to check styling
          { start: body.start, end: body.start + 1.5, text: `ライブ字幕${n}`, raw: `らいぶ${n}`, confidence: n === 1 ? 0.9 : 0.3 },
        ],
      },
    });
  });
  return Object.assign(requests, { drafts });
}

test.describe.configure({ mode: 'serial' }); // real audio playback is CPU-heavy

test.describe('whisper fallback', () => {
  // P3-38
  test('transcribes live when Jimaku has nothing and the server is running', async ({ context, extensionId }) => {
    test.setTimeout(120_000);
    await mockApis(context, { noFiles: true });
    const requests = await mockServer(context);
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/live`);

    await expect(overlayIn(page)).toHaveText(/ライブ字幕\d/, { timeout: 60_000 });
    expect(requests[0]!.anilist_id).toBe(213657); // Season 2 Part 2: its characters make the glossary
    expect(requests[0]!.start).toBeGreaterThanOrEqual(0);
    expect(Buffer.from(requests[0]!.audio, 'base64').length % 2).toBe(0); // 16-bit PCM

    const popup = await openPopup(context, extensionId, page);
    await expect(popup.getByText(/Transcribing live with Whisper/)).toBeVisible();
    await expect(popup.getByText(/Nothing to press/)).toBeVisible();
    await expect(popup.getByRole('status')).toHaveText(/^Loaded Live transcription: .* ep 44 \(\d+ cues\)$/);

    // P3-42: "Check Jimaku again" must not throw away lines already transcribed.
    const count = () => popup.getByRole('status').textContent().then((s) => Number(s?.match(/\((\d+) cues\)/)?.[1]));
    const before = await count();
    await popup.getByRole('button', { name: 'Check Jimaku again' }).click();
    await expect(popup.getByText(/Transcribing live with Whisper/)).toBeVisible();
    await expect.poll(count).toBeGreaterThanOrEqual(before);
  });

  // P3-39
  test('styles low-confidence lines as unsure', async ({ context }) => {
    test.setTimeout(120_000);
    await mockApis(context, { noFiles: true });
    await mockServer(context);
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/live`);
    await expect(overlayIn(page).locator('div.unsure')).toHaveText(/ライブ字幕[2-9]/, { timeout: 90_000 });
  });

  // P3-41
  test('shows only the newest lines, never a pile-up', async ({ context }) => {
    test.setTimeout(120_000);
    await mockApis(context, { noFiles: true });
    const requests = await mockServer(context);
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/live`);
    await expect.poll(() => requests.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(4);
    // Several batches have arrived, yet at most two lines are on screen, and a recent one shows.
    expect(await overlayIn(page).locator('div').count()).toBeLessThanOrEqual(2);
    const shown = Number((await overlayIn(page).textContent())?.match(/ライブ字幕(\d+)/)?.[1] ?? 0);
    expect(shown).toBeGreaterThanOrEqual(requests.length - 2);
  });

  // P3-43
  test('shows a draft while a line is spoken, then the finished line', async ({ context }) => {
    test.setTimeout(120_000);
    await mockApis(context, { noFiles: true });
    const requests = await mockServer(context);
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/live`);
    await expect(overlayIn(page).locator('div.partial')).toHaveText(/途中\d/, { timeout: 60_000 });
    expect(requests.drafts[0]!.partial).toBe(true);
    await expect(overlayIn(page)).toHaveText(/ライブ字幕\d/, { timeout: 30_000 });
  });

  // P3-40
  test('says how to start the server when it is not running', async ({ context, extensionId }) => {
    await mockApis(context, { noFiles: true });
    await mockServer(context, false);
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/live`);
    const popup = await openPopup(context, extensionId, page);
    await expect(popup.getByText(/start the local server \(server\/README\.md\)/)).toBeVisible();
  });
});
