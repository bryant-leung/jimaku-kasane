/**
 * Whisper fallback: Jimaku has nothing → the extension transcribes the episode's audio with the
 * local server and shows the lines as they arrive. The server is mocked here (its own tests are
 * pytest in server/tests); the page plays real speech so the VAD segmenter runs for real.
 * Test IDs: docs/TEST_PLAN.md P3-38..P3-51.
 *
 * Run: npm run test:e2e -- e2e/pr-6-whisper-fallback.spec.ts
 */
import type { BrowserContext } from '@playwright/test';
import { FAKE_KEY, mockApis } from './fixtures/apis';
import { SITE, expect, openPopup, overlayIn, setJimakuKey, setLocal, test } from './fixtures/extension';

const SERVER = 'http://127.0.0.1:8765';

/** Fake transcription server: answers each speech segment with one line at its start time. */
async function mockServer(context: BrowserContext, up = true, shift = 0) {
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
          {
            start: body.start + shift,
            end: body.start + shift + 1.5,
            text: `ライブ字幕${n}`,
            raw: `らいぶ${n}`,
            confidence: n === 1 ? 0.9 : 0.3,
          },
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
    await setLocal(context, { prepareAhead: false }); // live mode
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
    await setLocal(context, { prepareAhead: false }); // live mode
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
    await setLocal(context, { prepareAhead: false }); // live mode
    const page = await context.newPage();
    await page.goto(`${SITE}/live`);
    await expect.poll(() => requests.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(4);
    // Several batches have arrived, yet at most two lines are on screen, and a recent one shows.
    expect(await overlayIn(page).locator('div').count()).toBeLessThanOrEqual(2);
    const shown = Number((await overlayIn(page).textContent())?.match(/ライブ字幕(\d+)/)?.[1] ?? 0);
    expect(shown).toBeGreaterThanOrEqual(requests.length - 2);
  });

  // P3-43
  test('with drafts on: shows a draft while a line is spoken, then the finished line', async ({ context }) => {
    test.setTimeout(120_000);
    await mockApis(context, { noFiles: true });
    const requests = await mockServer(context);
    await setJimakuKey(context, FAKE_KEY);
    await setLocal(context, { prepareAhead: false, liveDrafts: true }); // live mode, drafts on (off by default since PR 44)
    const page = await context.newPage();
    await page.goto(`${SITE}/live`);
    await expect(overlayIn(page).locator('div.partial')).toHaveText(/途中\d/, { timeout: 60_000 });
    expect(requests.drafts[0]!.partial).toBe(true);
    await expect(overlayIn(page)).toHaveText(/ライブ字幕\d/, { timeout: 30_000 });
  });

  // P3-44
  test('prepares ahead in a minimized muted copy; lines arrive before they are spoken', async ({ context, extensionId }) => {
    test.setTimeout(120_000);
    await mockApis(context, { noFiles: true });
    const requests = await mockServer(context);
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/live`);
    await page.evaluate(() => document.querySelector('video')!.pause()); // you haven't started watching yet

    // A second copy opens, muted and fast.
    await expect.poll(() => context.pages().filter((p) => p.url() === `${SITE}/live`).length, { timeout: 30_000 }).toBe(2);
    const copy = context.pages().find((p) => p !== page && p.url() === `${SITE}/live`)!;
    await expect
      .poll(() => copy.evaluate(() => [document.querySelector('video')!.muted, document.querySelector('video')!.playbackRate]))
      .toEqual([true, 1.5]);

    await expect(copy.getByRole('note')).toContainText('helper copy'); // says what this window is

    // P3-46: the player never sees our mute/speed changes, so it can't save them for your tab.
    expect(await copy.evaluate(() => [localStorage.getItem('player-muted'), localStorage.getItem('player-speed')])).toEqual([
      null,
      null,
    ]);
    expect(await page.evaluate(() => document.querySelector('video')!.muted)).toBe(false);

    // Lines for parts you haven't reached yet arrive while your video is still at 0.
    await expect.poll(() => requests.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
    expect(requests.drafts).toHaveLength(0); // no drafts needed when running ahead
    expect(await page.evaluate(() => document.querySelector('video')!.currentTime)).toBeLessThan(1); // still at the start
    const popup = await openPopup(context, extensionId, page);
    await expect(popup.getByText(/Preparing ahead in a minimized window.*Ready up to \d+:\d\d/)).toBeVisible();

    // Now you press play: line 2 shows at its own time (prepared earlier), no delay adjustment.
    // (The fake site can't seek, so the test plays through instead of jumping.)
    await page.evaluate(() => void document.querySelector('video')!.play());
    await expect(overlayIn(page)).toHaveText('ライブ字幕2', { timeout: 20_000 });
    const shownAt = await page.evaluate(() => document.querySelector('video')!.currentTime);
    expect(Math.abs(shownAt - requests[1]!.start)).toBeLessThan(1); // on time, not a line late

    // P3-45: Stop closes the copy and falls back to live.
    await popup.getByRole('button', { name: 'Stop preparing (use live)' }).click().catch(() => {});
    await expect.poll(() => context.pages().filter((p) => p.url() === `${SITE}/live`).length).toBe(1);
    // (Playwright may have put the popup page in that window, so open it again from your tab.)
    const after = await openPopup(context, extensionId, page);
    await expect(after.getByText(/Transcribing live with Whisper/)).toBeVisible();
  });

  // P3-47
  test("falls back to live when the copy's player won't start", async ({ context, extensionId }) => {
    test.setTimeout(120_000);
    await mockApis(context, { noFiles: true });
    await mockServer(context);
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/live-stubborn`);
    await expect.poll(() => context.pages().filter((p) => p.url() === `${SITE}/live-stubborn`).length, { timeout: 30_000 }).toBe(2);
    // After ~6 s the copy reports it isn't playing: closed, live mode instead, and the popup says why.
    await expect.poll(() => context.pages().filter((p) => p.url() === `${SITE}/live-stubborn`).length, { timeout: 30_000 }).toBe(1);
    const popup = await openPopup(context, extensionId, page);
    await expect(popup.getByText(/background copy didn't start playing/)).toBeVisible();
  });

  // P3-51
  test("falls back to live when the copy never finds its video", async ({ context, extensionId }) => {
    test.setTimeout(90_000);
    await mockApis(context, { noFiles: true });
    await mockServer(context);
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/live-copy-novideo`);
    await expect.poll(() => context.pages().filter((p) => p.url() === `${SITE}/live-copy-novideo`).length, { timeout: 30_000 }).toBe(2);
    // No word from the copy for 25 s: closed, live mode instead, and the popup says why.
    await expect.poll(() => context.pages().filter((p) => p.url() === `${SITE}/live-copy-novideo`).length, { timeout: 45_000 }).toBe(1);
    const popup = await openPopup(context, extensionId, page);
    await expect(popup.getByText(/background copy didn't start, so transcribing your tab live/)).toBeVisible();
  });

  // P3-49
  test('auto-syncs prepared lines that come out late (another source of the episode)', async ({
    context,
    extensionId,
  }) => {
    test.setTimeout(150_000);
    await mockApis(context, { noFiles: true });
    await mockServer(context, true, 3); // lines 3 s late, as reported
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/live-loop`); // you're watching from the start (clip loops: it's only 41 s)
    const popup = await openPopup(context, extensionId, page);
    await page.bringToFront(); // the real popup doesn't hide your tab; this test page does
    await expect(popup.getByText(/^Auto-synced: offset -(2\.[7-9]|3\.[0-3])s$/)).toBeVisible({ timeout: 120_000 });
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

test.describe('whisper fallback with real autoplay rules', () => {
  test.use({ realAutoplay: true });

  // P3-48
  test('the never-clicked background copy still produces lines', async ({ context, extensionId }) => {
    test.setTimeout(120_000);
    await mockApis(context, { noFiles: true });
    const requests = await mockServer(context);
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/live`);
    // Nobody clicks anything in the copy; an AudioContext there would never start.
    await expect.poll(() => requests.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
    const popup = await openPopup(context, extensionId, page);
    await expect(popup.getByRole('status')).toHaveText(/\([1-9]\d* cues\)/);
  });
});

// P3-50 on its own with one retry: under the full parallel suite the 41 s clip (played at 1.5×) can
// end before the first request from the new position (failed ~1 in 6 full runs; always passes alone).
test.describe('whisper fallback (timing-sensitive)', () => {
  test.describe.configure({ retries: 1 });
  // P3-50
  test('when you skip ahead (e.g. the opening), the copy jumps there and prepares from there', async ({ context }) => {
    test.setTimeout(120_000);
    await mockApis(context, { noFiles: true });
    const requests = await mockServer(context);
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/live-seek`);
    await expect.poll(() => context.pages().filter((p) => p.url() === `${SITE}/live-seek`).length, { timeout: 30_000 }).toBe(2);
    const copy = context.pages().find((p) => p !== page && p.url() === `${SITE}/live-seek`)!;
    await expect.poll(() => copy.evaluate(() => document.querySelector('video')?.playbackRate)).toBe(1.5); // copy started
    await page.evaluate(() => (document.querySelector('video')!.currentTime = 25)); // skip ahead
    await expect.poll(() => copy.evaluate(() => document.querySelector('video')!.currentTime), { timeout: 10_000 }).toBeGreaterThan(23.5);
    // Lines from there. Under the full parallel suite the first request can take > 30 s (failed 4 times at 30 s).
    await expect.poll(() => requests.some((r) => r.start >= 23.5), { timeout: 60_000 }).toBe(true);
  });
});
