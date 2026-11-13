/**
 * Compare mode (Phase 4 evaluation): on an episode that has a real subtitle file, Whisper runs
 * alongside and is scored against it (character error rate before/after name correction, timing).
 * The server is mocked; the page plays real speech so the VAD segmenter runs for real.
 * Test IDs: docs/TEST_PLAN.md P4-01..P4-06.
 *
 * Run: npm run test:e2e -- e2e/pr-7-compare-mode.spec.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext } from '@playwright/test';
import { compareLines, editDistance, normalizeJa } from '../extension/src/lib/compare';
import { FIXTURES, SITE, expect, loadFile, openPopup, overlayIn, test } from './fixtures/extension';

const SERVER = 'http://127.0.0.1:8765';
const meta = JSON.parse(readFileSync(path.join(FIXTURES, 'speech-music.json'), 'utf8')) as {
  speech: { start: number; end: number }[];
};
const LINE = (i: number) => `本当の台詞${i + 1}です`;
const ts = (s: number) => {
  const ms = Math.round(Math.max(0, s) * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `00:${p(Math.floor(ms / 60000))}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
/** The clip's lines as the "real" subtitle file, timed to the speech. */
const SRT = meta.speech.map((s, i) => `${i + 1}\n${ts(s.start)} --> ${ts(s.end)}\n${LINE(i)}\n`).join('\n');

/**
 * Fake server: returns the real lines spoken in each segment. Corrected text is exact; the raw
 * (before correction) text has one wrong character per line, so correction visibly helps.
 */
async function mockServer(context: BrowserContext, up = true) {
  const requests: { start: number; audio: string; partial?: boolean }[] = [];
  await context.route(`${SERVER}/**`, async (route) => {
    if (!up) return route.abort('connectionrefused');
    const url = new URL(route.request().url());
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/health') return route.fulfill({ json: { status: 'ok' }, headers: cors });
    const body = route.request().postDataJSON() as (typeof requests)[number];
    requests.push(body);
    const seconds = Buffer.from(body.audio, 'base64').length / 2 / 16000;
    const spoken = meta.speech
      .map((s, i) => ({ ...s, i }))
      .filter((s) => s.start >= body.start - 0.5 && s.start < body.start + seconds);
    if (!spoken.length) return route.fulfill({ headers: cors, json: { cues: [] } });
    return route.fulfill({
      headers: cors,
      json: {
        cues: [
          {
            start: spoken[0]!.start,
            end: spoken.at(-1)!.end,
            text: spoken.map((s) => LINE(s.i)).join(''),
            raw: spoken.map((s) => LINE(s.i).replace('本当', '本棟')).join(''),
            confidence: 0.8,
          },
        ],
      },
    });
  });
  return requests;
}

const stats = (text: string) => {
  const m = /error rate ([\d.]+)% \(before name correction ([\d.]+)%\)(?: · timing off by ([\d.]+)s)?/.exec(text);
  return m ? { cer: Number(m[1]), raw: Number(m[2]), timing: m[3] === undefined ? null : Number(m[3]) } : null;
};

test.describe.configure({ mode: 'serial' }); // real audio playback is CPU-heavy

test.describe('compare mode', () => {
  // P4-01
  test('scores Whisper against the loaded file while you watch; its lines are never shown', async ({
    context,
    extensionId,
  }) => {
    test.setTimeout(120_000);
    const requests = await mockServer(context);
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, { name: 'real.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(SRT) });
    await popup.getByRole('button', { name: 'Compare with Whisper' }).click();
    await expect(popup.getByRole('button', { name: 'Stop comparing' })).toBeVisible();

    // Several lines scored (keeps going after auto-sync finishes on the same audio).
    await expect
      .poll(async () => stats((await popup.locator('#compare-status').textContent()) ?? '')?.cer ?? -1, { timeout: 90_000 })
      .toBeGreaterThanOrEqual(0);
    await expect.poll(() => requests.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(6);
    const s = stats((await popup.locator('#compare-status').textContent()) ?? '')!;
    expect(s.cer).toBeLessThan(15); // exact text; only missed edges of a stretch can count
    expect(s.raw).toBeGreaterThan(s.cer); // correction helped
    expect(s.timing).not.toBeNull();
    expect(s.timing!).toBeLessThan(0.5);
    expect(requests.every((r) => !r.partial)).toBe(true); // no drafts in compare mode

    // The overlay only ever shows the real file's lines.
    await expect(overlayIn(page)).toHaveText(/^本当の台詞\d+です$/);
  });

  // P4-02
  test('says to start the server when it is not running', async ({ context, extensionId }) => {
    await mockServer(context, false);
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, { name: 'real.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(SRT) });
    await popup.getByRole('button', { name: 'Compare with Whisper' }).click();
    await expect(popup.getByText(/Start the local server first/)).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Compare with Whisper' })).toBeVisible(); // can try again
  });

  // P4-03
  test('is offered only when a subtitle file is loaded', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await expect(popup.getByRole('button', { name: 'Compare with Whisper' })).toBeHidden();
    await loadFile(popup, { name: 'real.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(SRT) });
    await expect(popup.getByRole('button', { name: 'Compare with Whisper' })).toBeVisible();
  });

  // P4-04
  test('Stop comparing stops sending audio to the server', async ({ context, extensionId }) => {
    test.setTimeout(90_000);
    const requests = await mockServer(context);
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, { name: 'real.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(SRT) });
    await popup.getByRole('button', { name: 'Compare with Whisper' }).click();
    await expect.poll(() => requests.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
    await popup.getByRole('button', { name: 'Stop comparing' }).click();
    await expect(popup.getByRole('button', { name: 'Compare with Whisper' })).toBeVisible();
    const after = requests.length;
    await page.waitForTimeout(6_000); // speech keeps playing; nothing more may be sent
    expect(requests.length).toBeLessThanOrEqual(after + 1); // at most one segment already in flight
  });

  // P4-05
  test('Copy report copies every compared episode as a Markdown table', async ({ context, extensionId }) => {
    test.setTimeout(90_000);
    await mockServer(context);
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, { name: 'real.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(SRT) });
    await popup.getByRole('button', { name: 'Compare with Whisper' }).click();
    await expect(popup.getByText(/Whisper vs this file: \d+ lines/)).toBeVisible({ timeout: 60_000 });
    await popup.evaluate(() => {
      (window as unknown as { copied: string[] }).copied = [];
      navigator.clipboard.writeText = async (t: string) => void (window as unknown as { copied: string[] }).copied.push(t);
    });
    await popup.getByRole('button', { name: 'Copy report' }).click();
    await expect(popup.getByText('Copied 1 episode as a Markdown table.')).toBeVisible();
    const copied = await popup.evaluate(() => (window as unknown as { copied: string[] }).copied[0]);
    expect(copied).toMatch(/^\| File \| Lines \| Ref chars \| CER \| CER before correction \|/);
    expect(copied).toContain('| real.srt |');
  });

  // P4-06
  test('error rate maths: punctuation, brackets and spacing ignored; edits counted', () => {
    expect(normalizeJa('（千歳）今日は、いい 天気！')).toBe('今日はいい天気');
    expect(editDistance('今日はいい天気', '今日は悪い天気')).toBe(1);
    const ref = [{ start: 0, end: 2, text: '今日はいい天気。' }];
    const exact = compareLines([{ start: 0.1, end: 2, text: '今日はいい天気', raw: '今日わいい天気' }], ref);
    expect(exact.cer).toBe(0);
    expect(exact.cerRaw).toBeCloseTo(1 / 7);
    expect(exact.timingMedian).toBeCloseTo(0.1);
    // Lines a minute apart are separate stretches: the subtitles between them aren't counted as misses.
    const gap = compareLines(
      [
        { start: 0, end: 2, text: 'あい', raw: 'あい' },
        { start: 100, end: 102, text: 'うえ', raw: 'うえ' },
      ],
      [
        { start: 0, end: 2, text: 'あい' },
        { start: 50, end: 52, text: '聞いてない' },
        { start: 100, end: 102, text: 'うえ' },
      ],
    );
    expect(gap.cer).toBe(0);
    expect(gap.refChars).toBe(4);
  });
});
