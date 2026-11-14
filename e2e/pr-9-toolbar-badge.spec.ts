/**
 * Toolbar badge: what the extension is doing for a tab, without opening the popup.
 * JP = real subtitle file · AI = Whisper transcription · … = looking / preparing · ! = needs you.
 * Test IDs: docs/archive/TEST_PLAN-2026-11.md P2-B1..P2-B6.
 *
 * Run: npm run test:e2e -- e2e/pr-9-toolbar-badge.spec.ts
 */
import type { BrowserContext, Page } from '@playwright/test';
import { FAKE_KEY, mockApis } from './fixtures/apis';
import { SITE, expect, loadFile, openPopup, setJimakuKey, setLocal, tabIdOf, test } from './fixtures/extension';

const SERVER = 'http://127.0.0.1:8765';

/** The badge text and tooltip Chrome shows for the page's tab. */
async function badge(context: BrowserContext, page: Page): Promise<{ text: string; title: string }> {
  const tabId = await tabIdOf(context, page);
  const sw = context.serviceWorkers()[0]!;
  return sw.evaluate(async (tabId) => {
    const action = (
      globalThis as unknown as {
        chrome: { action: { getBadgeText(d: object): Promise<string>; getTitle(d: object): Promise<string> } };
      }
    ).chrome.action;
    return { text: await action.getBadgeText({ tabId }), title: await action.getTitle({ tabId }) };
  }, tabId);
}
const text = (context: BrowserContext, page: Page) => async () => (await badge(context, page)).text;

async function serverUp(context: BrowserContext): Promise<void> {
  await context.route(`${SERVER}/**`, (route) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (new URL(route.request().url()).pathname === '/health') return route.fulfill({ json: { status: 'ok' }, headers: cors });
    return route.fulfill({ headers: cors, json: { cues: [] } });
  });
}

test.describe('toolbar badge', () => {
  // P2-B1
  test('shows JP when Japanese subtitles are loaded, with the file in the tooltip', async ({ context }) => {
    await mockApis(context);
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/pahe`);
    await expect.poll(text(context, page), { timeout: 15_000 }).toBe('JP');
    expect((await badge(context, page)).title).toMatch(/Japanese subtitles loaded \(.+\)/);
  });

  // P2-B2
  test('shows … while looking up the episode', async ({ context }) => {
    await mockApis(context, { downloadDelayMs: 4_000 });
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/pahe`);
    await expect.poll(text(context, page), { timeout: 10_000 }).toBe('…');
    await expect.poll(text(context, page), { timeout: 15_000 }).toBe('JP');
  });

  // P2-B3
  test('shows ! when something needs you (no Jimaku key), with the reason in the tooltip', async ({ context }) => {
    await mockApis(context);
    const page = await context.newPage();
    await page.goto(`${SITE}/pahe`);
    await expect.poll(text(context, page), { timeout: 15_000 }).toBe('!');
    expect((await badge(context, page)).title).toMatch(/key/i);
  });

  // P2-B4
  test('shows AI while Whisper transcribes (Jimaku has nothing)', async ({ context }) => {
    await mockApis(context, { noFiles: true });
    await serverUp(context);
    await setLocal(context, { prepareAhead: false });
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/live`);
    await expect.poll(text(context, page), { timeout: 15_000 }).toBe('AI');
    expect((await badge(context, page)).title).toMatch(/Whisper/);
  });

  // P2-B5
  test('shows ! when Jimaku has nothing and the server is off', async ({ context }) => {
    await mockApis(context, { noFiles: true });
    await context.route(`${SERVER}/**`, (route) => route.abort('connectionrefused'));
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/pahe`);
    await expect.poll(text(context, page), { timeout: 15_000 }).toBe('!');
  });

  // P2-B6
  test('clears when switched off, comes back when switched on', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, 'sample.srt');
    await expect.poll(text(context, page)).toBe('JP');
    await popup.getByLabel('Show Japanese subtitles').uncheck();
    await expect.poll(text(context, page)).toBe('');
    await popup.getByLabel('Show Japanese subtitles').check();
    await expect.poll(text(context, page)).toBe('JP');
  });
});
