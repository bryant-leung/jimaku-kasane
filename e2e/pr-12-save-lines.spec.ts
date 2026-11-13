/**
 * Save for review: S saves the Japanese line on screen; "Save" in the dictionary card saves the
 * word with its reading, meaning and line. The popup exports everything as an Anki import file.
 * Test IDs: docs/TEST_PLAN.md P2-S1..P2-S6.
 *
 * Run: npm run test:e2e -- e2e/pr-12-save-lines.spec.ts
 */
import { readFileSync } from 'node:fs';
import type { BrowserContext, Page } from '@playwright/test';
import { toAnkiTsv } from '../extension/src/lib/cards';
import { currentCue } from '../extension/src/lib/cue';
import { PLAYER, SITE, expect, loadFile, openPopup, overlayIn, test } from './fixtures/extension';

const SRT = `1\n00:00:00,000 --> 00:01:00,000\n漠然とした気持ちを弄んでいる\n`;
const saved = async (context: BrowserContext) => {
  const sw = context.serviceWorkers()[0]!;
  return sw.evaluate(async () => {
    const c = (globalThis as unknown as { chrome: { storage: { local: { get(k: string): Promise<Record<string, unknown>> } } } }).chrome;
    return ((await c.storage.local.get('savedCards')).savedCards ?? []) as { line: string; word?: string; reading?: string; meaning?: string; source: string; time: number }[];
  });
};

async function setup(context: BrowserContext, extensionId: string, path = '/talk'): Promise<{ page: Page; popup: Page }> {
  const page = await context.newPage();
  await page.goto(`${SITE}${path}`);
  const popup = await openPopup(context, extensionId, page);
  await loadFile(popup, { name: 'line.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(SRT) });
  await page.bringToFront();
  return { page, popup };
}

test.describe('save for review', () => {
  // P2-S1
  test('S saves the line on screen, with where it came from', async ({ context, extensionId }) => {
    const { page, popup } = await setup(context, extensionId);
    await expect(overlayIn(page)).toHaveText('漠然とした気持ちを弄んでいる');
    await page.keyboard.press('s');
    await expect(page.getByText('Saved: 漠然とした気持ちを弄んでいる')).toBeVisible();
    await expect.poll(async () => (await saved(context)).length).toBe(1);
    const [card] = await saved(context);
    expect(card!.line).toBe('漠然とした気持ちを弄んでいる');
    expect(card!.word).toBeUndefined();
    expect(card!.source.length).toBeGreaterThan(0);
    await expect(popup.getByText('Saved for review: 1')).toBeVisible();
  });

  // P2-S2
  test('Save in the dictionary card saves the word, its reading and meaning, and the line', async ({
    context,
    extensionId,
  }) => {
    const { page } = await setup(context, extensionId);
    await overlayIn(page).locator('.w', { hasText: '漠然' }).click();
    const card = page.getByRole('dialog', { name: 'Dictionary' });
    await card.getByRole('button', { name: 'Save word' }).click();
    await expect(card.getByRole('button', { name: 'Save word' })).toHaveText('Saved');
    await expect.poll(async () => (await saved(context)).length).toBe(1);
    const [w] = await saved(context);
    expect(w).toMatchObject({ word: '漠然', reading: 'ばくぜん', line: '漠然とした気持ちを弄んでいる' });
    expect(w!.meaning).toMatch(/vague/i);
  });

  // P2-S3
  test('works when the key is pressed on the page and the player is in an iframe', async ({ context, extensionId }) => {
    const { page } = await setup(context, extensionId, '/embed-talk');
    const player = page.frameLocator(`iframe[src^="${PLAYER}"]`);
    await expect(overlayIn(player)).toHaveText('漠然とした気持ちを弄んでいる');
    await page.locator('h1').click();
    await page.keyboard.press('s');
    await expect.poll(async () => (await saved(context)).length).toBe(1);
  });

  // P2-S4
  test('Export for Anki downloads an import file with every saved item', async ({ context, extensionId }) => {
    const { page, popup } = await setup(context, extensionId);
    await page.keyboard.press('s');
    await overlayIn(page).locator('.w', { hasText: '漠然' }).click();
    await page.getByRole('dialog', { name: 'Dictionary' }).getByRole('button', { name: 'Save word' }).click();
    await expect(popup.getByText('Saved for review: 2')).toBeVisible();
    const [download] = await Promise.all([popup.waitForEvent('download'), popup.getByRole('button', { name: 'Export for Anki' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^jimaku-kasane-anki-\d{4}-\d\d-\d\d\.txt$/);
    const text = readFileSync((await download.path())!, 'utf8');
    const lines = text.trim().split('\n');
    expect(lines.slice(0, 3)).toEqual(['#separator:tab', '#html:true', '#columns:Front\tBack\tTags']);
    expect(lines).toHaveLength(5);
    expect(lines[4]!.split('\t')[0]).toBe('漠然');
    expect(lines[4]).toContain('<b>漠然</b>とした');
  });

  // P2-S5
  test('Clear needs a second click, then empties the list', async ({ context, extensionId }) => {
    const { page, popup } = await setup(context, extensionId);
    await page.keyboard.press('s');
    await expect(popup.getByText('Saved for review: 1')).toBeVisible();
    await popup.getByRole('button', { name: 'Clear' }).click();
    await expect(popup.getByRole('button', { name: 'Really clear 1?' })).toBeVisible();
    expect(await saved(context)).toHaveLength(1);
    await popup.getByRole('button', { name: 'Really clear 1?' }).click();
    await expect(popup.getByText('Saved for review: 0')).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Export for Anki' })).toBeDisabled();
  });

  // P2-S6
  test('export format and current-line maths', () => {
    const cues = [
      { start: 1, end: 3, text: 'a' },
      { start: 5, end: 7, text: 'b' },
      { start: 6, end: 9, text: 'c', partial: true },
    ];
    expect(currentCue(cues, 0.5, 0)).toBeNull();
    expect(currentCue(cues, 2, 0)?.text).toBe('a');
    expect(currentCue(cues, 4, 0)?.text).toBe('a'); // between lines: the last one
    expect(currentCue(cues, 6.5, 0)?.text).toBe('b'); // drafts ignored
    expect(currentCue(cues, 6.5, 2)?.text).toBe('a'); // offset +2: b shows from 7
    const tsv = toAnkiTsv([
      { id: '1', line: 'a<b>\tc', source: 'Show Ep. 1', time: 65, savedAt: '' },
      { id: '2', line: '本を読む', word: '本', reading: 'ほん', meaning: 'book', source: 'S', time: 3725, savedAt: '' },
    ]).split('\n');
    expect(tsv[3]).toBe('a&lt;b&gt; c\t<small>Show Ep. 1 · 1:05</small>\tjimaku-kasane line');
    expect(tsv[4]).toBe('本\t【ほん】 book<br><b>本</b>を読む<br><small>S · 1:02:05</small>\tjimaku-kasane word');
  });
});
