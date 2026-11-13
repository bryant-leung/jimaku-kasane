/**
 * Listening practice: the Japanese line stays hidden until you hold H. With study mode, the line
 * shows by itself when the video pauses at its end (listen first, then check).
 * Test IDs: docs/TEST_PLAN.md P2-09 (redefined), P2-L1..P2-L3.
 *
 * Run: npm run test:e2e -- e2e/pr-15-listening-practice.spec.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { FIXTURES, PLAYER, SITE, expect, loadFile, openPopup, test } from './fixtures/extension';

/** The line, found even while hidden (a hidden line drops out of the accessibility tree). */
const overlayIn = (where: Page | ReturnType<Page['frameLocator']>) => where.locator('[data-jpsub-overlay] .subs');

const meta = JSON.parse(readFileSync(path.join(FIXTURES, 'speech-music.json'), 'utf8')) as {
  speech: { start: number; end: number }[];
};
const ts = (s: number) => {
  const ms = Math.round(Math.max(0, s) * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `00:${p(Math.floor(ms / 60000))}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
const ONE = `1\n00:00:00,000 --> 00:01:00,000\n聞き取り練習\n`;
const LINES = meta.speech.map((s, i) => `${i + 1}\n${ts(s.start)} --> ${ts(s.end)}\n台詞${i + 1}\n`).join('\n');

async function setup(context: BrowserContext, extensionId: string, srt: string, opts: { listen?: boolean; study?: boolean; path?: string } = {}) {
  const page = await context.newPage();
  await page.goto(`${SITE}${opts.path ?? '/talk'}`);
  const popup = await openPopup(context, extensionId, page);
  await loadFile(popup, { name: 'line.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srt) });
  if (opts.listen) await popup.getByLabel('Listening practice: hide the line until you hold H').check();
  if (opts.study) await popup.getByLabel('Study mode: pause after each line').check();
  await page.bringToFront();
  return { page, popup };
}

test.describe('listening practice', () => {
  // P2-09
  test('hides the line; holding H shows it, releasing hides it again', async ({ context, extensionId }) => {
    const { page } = await setup(context, extensionId, ONE, { listen: true });
    await expect(overlayIn(page)).toHaveText('聞き取り練習');
    await expect(overlayIn(page)).toBeHidden();
    await page.keyboard.down('h');
    await expect(overlayIn(page)).toBeVisible();
    await page.keyboard.up('h');
    await expect(overlayIn(page)).toBeHidden();
  });

  // P2-L1
  test('works when the key is pressed on the page and the player is in an iframe', async ({ context, extensionId }) => {
    const { page } = await setup(context, extensionId, ONE, { listen: true, path: '/embed-talk' });
    const player = page.frameLocator(`iframe[src^="${PLAYER}"]`);
    await expect(overlayIn(player)).toHaveText('聞き取り練習');
    await expect(overlayIn(player)).toBeHidden();
    await page.locator('h1').click();
    await page.keyboard.down('h');
    await expect(overlayIn(player)).toBeVisible();
    await page.keyboard.up('h');
    await expect(overlayIn(player)).toBeHidden();
  });

  // P2-L2
  test('off by default: the line shows as usual', async ({ context, extensionId }) => {
    const { page, popup } = await setup(context, extensionId, ONE);
    await expect(popup.getByLabel('Listening practice: hide the line until you hold H')).not.toBeChecked();
    await expect(overlayIn(page)).toBeVisible();
  });

  // P2-L3
  test('with study mode: the line shows when the video pauses at its end, hides again on play', async ({
    context,
    extensionId,
  }) => {
    const { page } = await setup(context, extensionId, LINES, { listen: true, study: true });
    await page.evaluate(() => {
      const v = document.querySelector('video')!;
      v.currentTime = 0;
      void v.play();
    });
    await expect.poll(() => page.evaluate(() => document.querySelector('video')!.paused), { timeout: 10_000 }).toBe(true);
    await expect(overlayIn(page)).toBeVisible();
    await expect(overlayIn(page)).toHaveText('台詞1');
    await page.evaluate(() => void document.querySelector('video')!.play());
    await expect(overlayIn(page)).toBeHidden();
  });
});
