/**
 * Live transcription shows each line once, finished (Whisper's final result), instead of a rough
 * draft that keeps changing while the line is spoken. Drafts can be turned back on in Settings.
 * Test IDs: docs/TEST_PLAN.md P3-60..P3-61. (Drafts on: pr-6 P3-43.)
 *
 * Run: npm run test:e2e -- e2e/pr-44-final-lines-only.spec.ts
 */
import type { BrowserContext } from '@playwright/test';
import { FAKE_KEY, mockApis } from './fixtures/apis';
import { SITE, expect, openPopup, overlayIn, setJimakuKey, setLocal, test } from './fixtures/extension';

/** Fake local Whisper server: counts draft and finished requests. */
async function mockServer(context: BrowserContext) {
  const finished: unknown[] = [];
  const drafts: unknown[] = [];
  await context.route('http://127.0.0.1:8765/**', async (route) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (new URL(route.request().url()).pathname === '/health') return route.fulfill({ json: { status: 'ok' }, headers: cors });
    const body = route.request().postDataJSON() as { start: number; partial?: boolean };
    (body.partial ? drafts : finished).push(body);
    const text = body.partial ? `途中${drafts.length}` : `ライブ字幕${finished.length}`;
    return route.fulfill({ headers: cors, json: { cues: [{ start: body.start, end: body.start + 1.5, text, raw: '', confidence: 0.9 }] } });
  });
  return { finished, drafts };
}

test.describe.configure({ mode: 'serial' }); // real audio playback is CPU-heavy

test.describe('live transcription', () => {
  // P3-60
  test('P3-60 by default each line shows once, finished: no changing drafts', async ({ context }) => {
    test.setTimeout(120_000);
    await mockApis(context, { noFiles: true });
    const server = await mockServer(context);
    await setJimakuKey(context, FAKE_KEY);
    await setLocal(context, { prepareAhead: false }); // live mode
    const page = await context.newPage();
    await page.goto(`${SITE}/live`);
    let sawDraft = false;
    await expect
      .poll(
        async () => {
          if ((await overlayIn(page).locator('div.partial').count()) > 0) sawDraft = true;
          return (await overlayIn(page).textContent()) ?? '';
        },
        { timeout: 60_000, intervals: [100] },
      )
      .toMatch(/ライブ字幕\d/);
    expect(sawDraft).toBe(false);
    expect(server.drafts).toHaveLength(0); // not even asked for
  });

  // P3-61
  test('P3-61 the drafts setting is in Settings, off by default', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await popup.getByText('Settings').click();
    const box = popup.getByLabel('Show rough drafts while a line is spoken (live transcription)');
    await expect(box).not.toBeChecked();
    await box.check();
    const sw = context.serviceWorkers()[0]!;
    await expect
      .poll(() => sw.evaluate(() => (globalThis as unknown as { chrome: { storage: { local: { get(k: string): Promise<Record<string, boolean>> } } } }).chrome.storage.local.get('liveDrafts').then((s) => s.liveDrafts)))
      .toBe(true);
  });
});
