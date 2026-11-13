/**
 * Study mode: the video pauses when each Japanese line ends, so you can read or shadow it.
 * Off by default; a popup switch. Seeking past a line doesn't count as reaching its end.
 * Test IDs: docs/TEST_PLAN.md P2-M1..P2-M4.
 *
 * Run: npm run test:e2e -- e2e/pr-13-study-mode.spec.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { FIXTURES, SITE, expect, loadFile, openPopup, overlayIn, test } from './fixtures/extension';

const meta = JSON.parse(readFileSync(path.join(FIXTURES, 'speech-music.json'), 'utf8')) as {
  speech: { start: number; end: number }[];
};
const ts = (s: number) => {
  const ms = Math.round(Math.max(0, s) * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `00:${p(Math.floor(ms / 60000))}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
const SRT = meta.speech.map((s, i) => `${i + 1}\n${ts(s.start)} --> ${ts(s.end)}\n台詞${i + 1}\n`).join('\n');
const END1 = meta.speech[0]!.end; // 3.70 s
const END2 = meta.speech[1]!.end; // 7.74 s

const video = (page: Page) => () =>
  page.evaluate(() => {
    const v = document.querySelector('video')!;
    return { paused: v.paused, t: v.currentTime };
  });

async function setup(context: BrowserContext, extensionId: string, study: boolean) {
  const page = await context.newPage();
  await page.goto(`${SITE}/talk`);
  await page.evaluate(() => {
    const v = document.querySelector('video')!;
    v.pause();
    v.currentTime = 0;
  });
  const popup = await openPopup(context, extensionId, page);
  await loadFile(popup, { name: 'lines.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(SRT) });
  if (study) await popup.getByLabel('Study mode: pause after each line').check();
  await page.bringToFront();
  await page.evaluate(() => void document.querySelector('video')!.play());
  return { page, popup };
}

test.describe('study mode', () => {
  // P2-M1
  test('pauses when each line ends; play continues to the next line', async ({ context, extensionId }) => {
    const { page } = await setup(context, extensionId, true);
    await expect.poll(async () => (await video(page)()).paused, { timeout: 10_000 }).toBe(true);
    const first = await video(page)();
    expect(first.t).toBeGreaterThanOrEqual(END1 - 0.05);
    expect(first.t).toBeLessThan(END1 + 0.3);
    await expect(page.getByText(/Study mode: paused after the line/)).toBeVisible();
    // The line stays on screen while paused, so you can read it (it has technically ended).
    await expect(overlayIn(page)).toHaveText('台詞1');
    await page.evaluate(() => void document.querySelector('video')!.play());
    await expect.poll(async () => (await video(page)()).t, { timeout: 10_000 }).toBeGreaterThan(END1 + 0.5);
    await expect.poll(async () => (await video(page)()).paused, { timeout: 10_000 }).toBe(true);
    const second = await video(page)();
    expect(second.t).toBeGreaterThanOrEqual(END2 - 0.05);
    expect(second.t).toBeLessThan(END2 + 0.3);
  });

  // P2-M2
  test('R after the pause replays the line and pauses at its end again', async ({ context, extensionId }) => {
    const { page } = await setup(context, extensionId, true);
    await expect.poll(async () => (await video(page)()).paused, { timeout: 10_000 }).toBe(true);
    await page.keyboard.press('r');
    await expect.poll(async () => (await video(page)()).t).toBeLessThan(END1 - 1);
    await expect.poll(async () => (await video(page)()).paused, { timeout: 10_000 }).toBe(true);
    expect((await video(page)()).t).toBeLessThan(END1 + 0.3);
  });

  // P2-M3
  test('off by default: playback runs past line ends', async ({ context, extensionId }) => {
    const { page, popup } = await setup(context, extensionId, false);
    await expect(popup.getByLabel('Study mode: pause after each line')).not.toBeChecked();
    await expect.poll(async () => (await video(page)()).t, { timeout: 15_000 }).toBeGreaterThan(END2 + 0.5);
    expect((await video(page)()).paused).toBe(false);
  });

  // P2-M4
  test('skipping over lines does not pause', async ({ context, extensionId }) => {
    const { page } = await setup(context, extensionId, true);
    await page.evaluate(() => (document.querySelector('video')!.currentTime = 19.5)); // jumps over lines 1–5
    await expect.poll(async () => (await video(page)()).t).toBeGreaterThan(20);
    expect((await video(page)()).paused).toBe(false); // next line (6) ends at 23.0
  });
});
