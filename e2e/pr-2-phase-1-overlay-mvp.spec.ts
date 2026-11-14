/**
 * Phase 1 local MVP: video detection, loading .srt/.ass from the popup, parser,
 * synced rendering (incl. fullscreen and iframes), offset hotkeys persisted per subtitle file.
 * Test IDs map to docs/archive/TEST_PLAN-2026-11.md (P1-01..P1-27, P1-35..P1-37).
 *
 * Run: npm run test:e2e -- e2e/pr-2-phase-1-overlay-mvp.spec.ts
 * Parser tests only (no browser): npx playwright test e2e/pr-2-phase-1-overlay-mvp.spec.ts -g "parser"
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test as unit } from '@playwright/test';
import { parseAss, parseSrt, parseSubtitleFile } from '../extension/src/lib/parse';
import {
  FIXTURES,
  INNER,
  PLAYER,
  SITE,
  expect,
  loadFile,
  openPopup,
  overlayIn,
  setTime,
  test,
} from './fixtures/extension';

const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8');

/** Shift-JIS bytes for one cue: 「日本語です」 at 1–3 s. */
const SJIS_SRT = Buffer.concat([
  Buffer.from('1\r\n00:00:01,000 --> 00:00:03,000\r\n'),
  Buffer.from([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0x82, 0xc5, 0x82, 0xb7]),
  Buffer.from('\r\n'),
]);
const SRT_ONE_CUE = '1\n00:00:01,000 --> 00:00:03,000\n日本語です\n';

unit.describe('parser', () => {
  // P1-11
  unit('parses SRT timestamps to seconds', () => {
    const { cues } = parseSrt(fixture('sample.srt'));
    expect(cues.at(-1)).toMatchObject({ start: 62.345, end: 64 });
    expect(parseSrt('1\n1:02,5 --> 1:03,25\nx').cues[0]).toMatchObject({ start: 62.5, end: 63.25 });
  });

  // P1-12
  unit('parses ASS timestamps to seconds', () => {
    const { cues } = parseAss(fixture('sample.ass'));
    expect(cues.at(-1)).toMatchObject({ start: 62.34, end: 64, text: '最後' });
  });

  // P1-13
  unit('keeps multi-line cues', () => {
    expect(parseSrt(fixture('sample.srt')).cues[1]!.text).toBe('よろしく\nお願いします');
    expect(parseAss(fixture('sample.ass')).cues[1]!.text).toBe('一行目\n二行目, です');
  });

  // P1-14
  unit('strips formatting tags', () => {
    const srt = parseSrt(fixture('sample.srt')).cues;
    expect(srt.map((c) => c.text)).toEqual(['はじめまして', 'よろしく\nお願いします', '重なり', '最後']);
    expect(parseAss(fixture('sample.ass')).cues[0]!.text).toBe('こんにちは');
  });

  // P1-15
  unit('sorts cues by start time', () => {
    const { cues } = parseSrt('2\n00:00:05,000 --> 00:00:06,000\nB\n\n1\n00:00:01,000 --> 00:00:02,000\nA\n');
    expect(cues.map((c) => c.text)).toEqual(['A', 'B']);
  });

  // P1-16
  unit('empty file gives zero cues', () => {
    expect(parseSrt('')).toEqual({ cues: [], issues: [] });
    expect(parseAss('')).toEqual({ cues: [], issues: [] });
    expect(parseSubtitleFile('empty.srt', new Uint8Array())).toEqual({
      ok: false,
      error: 'No subtitles found in empty.srt',
    });
  });

  // P1-35
  unit('skips ASS comments and drawings', () => {
    const texts = parseAss(fixture('sample.ass')).cues.map((c) => c.text);
    expect(texts).not.toContain('コメント');
    expect(texts).toHaveLength(3);
  });

  // P1-36
  unit('reports the line number of a broken timestamp', () => {
    const { cues, issues } = parseSrt(fixture('malformed.srt'));
    expect(cues.map((c) => c.text)).toEqual(['よい行', 'もう一つ']);
    expect(issues).toEqual([{ line: 6, message: 'Invalid timestamp' }]);
  });

  // P1-37
  unit('decodes Shift-JIS, UTF-8 BOM and UTF-16', () => {
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(SRT_ONE_CUE)]);
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(SRT_ONE_CUE, 'utf16le')]);
    for (const bytes of [SJIS_SRT, bom, utf16]) {
      const res = parseSubtitleFile('a.srt', new Uint8Array(bytes));
      expect(res.ok && res.cues[0]!.text).toBe('日本語です');
    }
  });
});

test.describe('video detection', () => {
  // P1-01
  test('detects a video added after page load', async ({ context }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/late`);
    await expect(overlayIn(page)).toHaveCount(1) /* attached; empty until subtitles load */;
    await expect(overlayIn(page)).toHaveCount(1);
  });

  // P1-02
  test('picks the largest video when several exist', async ({ context }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/multi`);
    await expect(overlayIn(page)).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const host = document.querySelector('[data-jpsub-overlay]')!.getBoundingClientRect();
          const big = document.getElementById('big')!.getBoundingClientRect();
          return [host.left - big.left, host.top - big.top, host.width - big.width];
        }),
      )
      .toEqual([0, 0, 0]);
  });

  // P1-03
  test('removes overlay when the video is removed', async ({ context }) => {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${SITE}/watch`);
    await expect(overlayIn(page)).toHaveCount(1);
    await page.evaluate(() => document.querySelector('video')!.remove());
    await expect(overlayIn(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  // P1-04
  test('detects video in a nested cross-origin iframe (2 levels)', async ({ context }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/nested`);
    const inner = page.frameLocator(`iframe[src^="${PLAYER}"]`).frameLocator(`iframe[src^="${INNER}"]`);
    await expect(overlayIn(inner)).toHaveCount(1) /* attached; empty until subtitles load */;
  });
});

test.describe('loading a subtitle file', () => {
  // P1-05
  test('loads a .srt file from the popup', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/watch`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, 'sample.srt');
    await expect(popup.getByRole('status')).toHaveText('Loaded sample.srt (4 cues)');
    await expect(popup.getByRole('alert')).toBeHidden();
    await setTime(page, 2);
    await expect(overlayIn(page)).toHaveText('はじめまして');
  });

  // P1-06
  test('loads an .ass file from the popup', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/watch`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, 'sample.ass');
    await expect(popup.getByRole('status')).toHaveText('Loaded sample.ass (3 cues)');
    await setTime(page, 1.5);
    await expect(overlayIn(page)).toHaveText('こんにちは');
  });

  // P1-07
  test('rejects an unsupported file type', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/watch`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, 'sample.srt');
    await expect(popup.getByRole('status')).toHaveText('Loaded sample.srt (4 cues)');

    await loadFile(popup, 'notes.txt');
    await expect(popup.getByRole('alert')).toHaveText('Unsupported file type: .txt. Use .srt or .ass.');
    await expect(popup.getByRole('status')).toHaveText('Loaded sample.srt (4 cues)');
    await setTime(page, 2);
    await expect(overlayIn(page)).toHaveText('はじめまして'); // previous cues kept
  });

  // P1-08
  test('handles a malformed .srt', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/watch`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, 'malformed.srt');
    await expect(popup.getByRole('status')).toHaveText('Loaded malformed.srt (2 cues)');
    await expect(popup.getByRole('alert')).toHaveText('Skipped 1 invalid cue (line 6: Invalid timestamp)');
    await setTime(page, 6.5);
    await expect(overlayIn(page)).toHaveText('もう一つ');
  });

  // P1-09
  test('loading a second file replaces the first', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/watch`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, 'sample.srt');
    await expect(popup.getByRole('status')).toHaveText('Loaded sample.srt (4 cues)');
    await loadFile(popup, 'sample.ass');
    await expect(popup.getByRole('status')).toHaveText('Loaded sample.ass (3 cues)');
    await setTime(page, 2);
    await expect(overlayIn(page)).toHaveText('こんにちは');
    await expect(overlayIn(page).locator('div')).toHaveCount(1);
  });

  // P1-10
  test('handles Shift-JIS / UTF-8 BOM files', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/watch`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, { name: 'sjis.srt', mimeType: 'application/x-subrip', buffer: SJIS_SRT });
    await expect(popup.getByRole('status')).toHaveText('Loaded sjis.srt (1 cues)');
    await setTime(page, 2);
    await expect(overlayIn(page)).toHaveText('日本語です');

    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(SRT_ONE_CUE.replace('日本語', 'ニホンゴ'))]);
    await loadFile(popup, { name: 'bom.srt', mimeType: 'application/x-subrip', buffer: bom });
    await expect(overlayIn(page)).toHaveText('ニホンゴです');
  });
});

test.describe('rendering and sync', () => {
  test.beforeEach(async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/watch`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, 'sample.srt');
    await expect(popup.getByRole('status')).toHaveText('Loaded sample.srt (4 cues)');
    await popup.close();
  });
  const sitePage = (context: import('@playwright/test').BrowserContext) =>
    context.pages().find((p) => p.url().startsWith(SITE))!;

  // P1-17
  test('shows the cue for the current time', async ({ context }) => {
    const page = sitePage(context);
    await setTime(page, 2);
    await expect(overlayIn(page)).toHaveText('はじめまして');
  });

  // P1-18
  test('clears between cues', async ({ context }) => {
    const page = sitePage(context);
    await setTime(page, 2);
    await expect(overlayIn(page)).toHaveText('はじめまして');
    await setTime(page, 3.5);
    await expect(overlayIn(page)).toHaveText('');
    await expect(overlayIn(page)).toHaveCount(1);
  });

  // P1-19
  test('shows both overlapping cues', async ({ context }) => {
    const page = sitePage(context);
    await setTime(page, 6.2);
    await expect(overlayIn(page).locator('div')).toHaveText(['よろしく\nお願いします', '重なり']);
  });

  // P1-20
  test('follows seeking backwards', async ({ context }) => {
    const page = sitePage(context);
    await setTime(page, 63);
    await expect(overlayIn(page)).toHaveText('最後');
    await setTime(page, 2);
    await expect(overlayIn(page)).toHaveText('はじめまして');
  });

  // P1-22
  test('overlay follows a resized video', async ({ context }) => {
    const page = sitePage(context);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() => {
      const v = document.querySelector('video')!;
      v.width = 1280;
      v.height = 720;
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const host = document.querySelector('[data-jpsub-overlay]')!.getBoundingClientRect();
          return [Math.round(host.width), Math.round(host.height)];
        }),
      )
      .toEqual([1280, 720]);
  });
});

test.describe('rendering in special places', () => {
  // P1-21
  test('overlay survives fullscreen', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/fullscreen`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, 'sample.srt');
    await expect(popup.getByRole('status')).toHaveText('Loaded sample.srt (4 cues)');
    await page.bringToFront();

    await page.getByRole('button', { name: 'Fullscreen' }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('box');
    await setTime(page, 2);
    await expect(overlayIn(page)).toHaveText('はじめまして');
    await expect(overlayIn(page)).toBeVisible();
    // Re-entered the top layer after the fullscreen element, so it stacks above it.
    expect(await page.evaluate(() => document.querySelector('[data-jpsub-overlay]')!.matches(':popover-open'))).toBe(
      true,
    );
  });

  // P1-38
  test('renders cues inside a cross-origin iframe player', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/embed`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, 'sample.srt');
    await expect(popup.getByRole('status')).toHaveText('Loaded sample.srt (4 cues)');
    const frame = page.frame({ url: /player\.test/ })!;
    await setTime(frame, 2);
    await expect(overlayIn(page.frameLocator(`iframe[src^="${PLAYER}"]`))).toHaveText('はじめまして');
  });
});

test.describe('on/off switches', () => {
  // P1-53
  test('switching off hides the subtitles everywhere, switching on brings them back', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/watch`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, 'sample.srt');
    await setTime(page, 2);
    await expect(overlayIn(page)).toHaveText('はじめまして');

    await popup.getByLabel('Show Japanese subtitles').uncheck();
    await expect(overlayIn(page)).toHaveCount(0);
    await popup.getByLabel('Show Japanese subtitles').check();
    await setTime(page, 2);
    await expect(overlayIn(page)).toHaveText('はじめまして');
  });

  // P1-54
  test('"Off on this site" hides the overlay on that site only, also inside its player iframe', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/embed`);
    const popup = await openPopup(context, extensionId, page);
    const player = page.frameLocator(`iframe[src^="${PLAYER}"]`);
    await expect(overlayIn(player)).toHaveCount(1);

    await popup.getByLabel('Off on anime-site.test').check();
    await expect(overlayIn(player)).toHaveCount(0);

    const other = await context.newPage();
    await other.goto(`${PLAYER}/player`); // a different site
    await expect(overlayIn(other)).toHaveCount(1);
  });
});

test.describe('offset', () => {
  async function setup(context: import('@playwright/test').BrowserContext, extensionId: string, url = '/watch') {
    const page = await context.newPage();
    await page.goto(`${SITE}${url}`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, 'sample.srt');
    await expect(popup.getByRole('status')).toHaveText('Loaded sample.srt (4 cues)');
    await page.bringToFront();
    return { page, popup };
  }

  // P1-23
  test('+0.1s / -0.1s hotkeys shift timing', async ({ context, extensionId }) => {
    const { page } = await setup(context, extensionId);
    await page.keyboard.press(']');
    await expect(page.getByText('Offset +0.1s')).toBeVisible();
    await setTime(page, 1.05);
    await expect(overlayIn(page)).toHaveText(''); // cue A now starts at 1.1
    await setTime(page, 1.15);
    await expect(overlayIn(page)).toHaveText('はじめまして');

    await page.keyboard.press('[');
    await page.keyboard.press('[');
    await expect(page.getByText('Offset -0.1s')).toBeVisible();
    await setTime(page, 0.95);
    await expect(overlayIn(page)).toHaveText('はじめまして'); // cue A now starts at 0.9
  });

  // P1-24
  test('±1s hotkeys shift timing', async ({ context, extensionId }) => {
    const { page, popup } = await setup(context, extensionId);
    await page.keyboard.press('Shift+BracketRight');
    await page.keyboard.press('Shift+BracketRight');
    await expect(page.getByText('Offset +2.0s')).toBeVisible();
    await expect(popup.getByLabel('Subtitle offset')).toHaveText('+2.0s');

    await page.keyboard.press('Backslash');
    await expect(page.getByText('Offset +0.0s')).toBeVisible();
  });

  // P1-25
  test('hotkeys ignored while typing in an input', async ({ context, extensionId }) => {
    const { page, popup } = await setup(context, extensionId);
    const input = page.getByLabel('Comment');
    await input.click();
    await page.keyboard.type('a]b');
    await expect(input).toHaveValue('a]b');
    await expect(popup.getByLabel('Subtitle offset')).toHaveText('+0.0s');
  });

  // P1-26
  test('offset persists per subtitle file across reload', async ({ context, extensionId }) => {
    const { page } = await setup(context, extensionId);
    await page.keyboard.press('Shift+BracketRight');
    await page.keyboard.press(']');
    await expect(page.getByText('Offset +1.1s')).toBeVisible();

    await page.reload();
    await setTime(page, 2.05);
    await expect(overlayIn(page)).toHaveText(''); // cue A now 2.1–4.1
    await setTime(page, 2.2);
    await expect(overlayIn(page)).toHaveText('はじめまして');
  });

  // P1-27
  test('offset is separate per subtitle file', async ({ context, extensionId }) => {
    const { page, popup } = await setup(context, extensionId);
    await popup.getByRole('button', { name: '+1s' }).click();
    await expect(popup.getByLabel('Subtitle offset')).toHaveText('+1.0s');

    await loadFile(popup, 'sample.ass');
    await expect(popup.getByRole('status')).toHaveText('Loaded sample.ass (3 cues)');
    await expect(popup.getByLabel('Subtitle offset')).toHaveText('+0.0s');
    await setTime(page, 1.5);
    await expect(overlayIn(page)).toHaveText('こんにちは');

    await loadFile(popup, 'sample.srt');
    await expect(popup.getByLabel('Subtitle offset')).toHaveText('+1.0s');
  });

  // P1-39
  test('popup offset buttons shift timing', async ({ context, extensionId }) => {
    const { page, popup } = await setup(context, extensionId);
    await popup.getByRole('button', { name: '-0.1s' }).click();
    await popup.getByRole('button', { name: '-1s' }).click();
    await expect(popup.getByLabel('Subtitle offset')).toHaveText('-1.1s');
    await setTime(page, 0.5);
    await expect(overlayIn(page)).toHaveText('はじめまして'); // cue A now -0.1–1.9
    await setTime(page, 2);
    await expect(overlayIn(page)).toHaveText('');
  });
});
