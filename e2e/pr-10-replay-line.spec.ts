/**
 * Replay line: R jumps back to the start of the Japanese line being shown (shadowing).
 * Pressed again right away, it goes one line further back. Works with the player in an iframe.
 * Test IDs: docs/TEST_PLAN.md P2-R1..P2-R6.
 *
 * Run: npm run test:e2e -- e2e/pr-10-replay-line.spec.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Frame, Page } from '@playwright/test';
import { replayTarget } from '../extension/src/lib/cue';
import { FIXTURES, PLAYER, SITE, expect, loadFile, openPopup, test } from './fixtures/extension';

const meta = JSON.parse(readFileSync(path.join(FIXTURES, 'speech-music.json'), 'utf8')) as {
  speech: { start: number; end: number }[];
};
const ts = (s: number) => {
  const ms = Math.round(Math.max(0, s) * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `00:${p(Math.floor(ms / 60000))}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
const SRT = meta.speech.map((s, i) => `${i + 1}\n${ts(s.start)} --> ${ts(s.end)}\n台詞${i + 1}\n`).join('\n');
const LINE3 = meta.speech[2]!.start; // 8.62 s
const LINE2 = meta.speech[1]!.start; // 5.64 s

const time = (where: Page | Frame) => () => where.evaluate(() => document.querySelector('video')!.currentTime);

/** Plays until `t` is a little past line 3's start (well inside it). */
async function playInto(where: Page | Frame, t: number): Promise<void> {
  await where.evaluate(() => void document.querySelector('video')!.play());
  await expect.poll(time(where), { timeout: 20_000 }).toBeGreaterThan(t);
}

test.describe('replay line', () => {
  // P2-R1
  test('R jumps back to the start of the line being shown', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, { name: 'lines.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(SRT) });
    await page.bringToFront();
    await playInto(page, LINE3 + 1.3);
    await page.keyboard.press('r');
    await expect.poll(time(page)).toBeLessThan(LINE3 + 0.5);
    expect(await time(page)()).toBeGreaterThan(LINE3 - 0.4); // line 3, not line 2
    expect(await page.evaluate(() => document.querySelector('video')!.paused)).toBe(false);
  });

  // P2-R2
  test('R pressed right after a line starts goes to the line before', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, { name: 'lines.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(SRT) });
    await page.bringToFront();
    await playInto(page, LINE3 + 1.3);
    await page.keyboard.press('r'); // → line 3
    await expect.poll(time(page)).toBeLessThan(LINE3 + 0.5);
    await page.keyboard.press('r'); // within 1 s → line 2
    await expect.poll(time(page)).toBeLessThan(LINE2 + 0.5);
    expect(await time(page)()).toBeGreaterThan(LINE2 - 0.4);
  });

  // P2-R3
  test('works when the key is pressed on the page and the player is in an iframe', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/embed-talk`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, { name: 'lines.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(SRT) });
    await page.bringToFront();
    const player = page.frames().find((f) => f.url().startsWith(PLAYER))!;
    await playInto(player, LINE3 + 1.3);
    await page.locator('h1').click(); // focus the outer page, not the player
    await page.keyboard.press('r');
    await expect.poll(time(player)).toBeLessThan(LINE3 + 0.5);
    expect(await time(player)()).toBeGreaterThan(LINE3 - 0.4);
  });

  // P2-R4
  test('follows the subtitle offset', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, { name: 'lines.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(SRT) });
    await popup.getByRole('button', { name: '+1s', exact: true }).click(); // lines show 1 s later
    await expect(popup.getByLabel('Subtitle offset')).toHaveText('+1.0s');
    await page.bringToFront();
    await playInto(page, LINE3 + 1 + 1.3);
    await page.keyboard.press('r');
    await expect.poll(time(page)).toBeLessThan(LINE3 + 1 + 0.5); // where line 3 is shown
    expect(await time(page)()).toBeGreaterThan(LINE3 + 1 - 0.4);
  });

  // P2-R5
  test('does nothing while typing in a text field, or with no subtitles loaded', async ({ context }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<input aria-label="Search">'));
    await playInto(page, LINE3 + 1.3);
    await page.keyboard.press('r'); // no subtitles: ignored
    await page.getByLabel('Search').fill('r'); // typing: ignored
    await expect(page.getByLabel('Search')).toHaveValue('r');
    expect(await time(page)()).toBeGreaterThan(LINE3 + 1.2); // never jumped back
  });

  // P2-R6
  test('replay target maths', () => {
    const cues = [
      { start: 1, end: 3, text: 'a' },
      { start: 5, end: 7, text: 'b' },
      { start: 9, end: 12, text: 'c', partial: true }, // drafts ignored
    ];
    expect(replayTarget(cues, 0.5, 0)).toBeNull(); // nothing started yet
    expect(replayTarget(cues, 6.5, 0)).toBeCloseTo(4.85); // inside b → b
    expect(replayTarget(cues, 5.3, 0)).toBeCloseTo(0.85); // b only just started → a
    expect(replayTarget(cues, 8, 0)).toBeCloseTo(4.85); // between lines → last one
    expect(replayTarget(cues, 10, 0)).toBeCloseTo(4.85); // a draft isn't a line
    expect(replayTarget(cues, 7.5, 1)).toBeCloseTo(5.85); // offset +1: b shows from 6
    expect(replayTarget([{ start: 0.1, end: 2, text: 'x' }], 0.5, 0)).toBe(0); // never before 0
  });
});
