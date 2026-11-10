/**
 * Automatic subtitles: page title → AniList season → Jimaku file → overlay, with no clicks.
 * AniList and Jimaku are mocked (e2e/fixtures/apis.ts) with the real Yozakura numbering:
 * site ep 44 = AniList S2 Part 2 ep 5 = Jimaku "S2 - 17".
 * Test IDs: docs/TEST_PLAN.md P1-28..P1-33, P1-40..P1-46.
 *
 * Run: npm run test:e2e -- e2e/pr-4-auto-subs.spec.ts
 */
import { test as unit } from '@playwright/test';
import { episodeCandidates, findFranchise, pickFile, resolveSubs, type Http } from '../extension/src/lib/autosubs';
import { parseEpisodeTitle } from '../extension/src/lib/episode';
import { DOWNLOAD_URL, FAKE_KEY, fakeApi, mockApis, type FakeOptions } from './fixtures/apis';
import { PLAYER, SITE, expect, openPopup, overlayIn, setJimakuKey, setTime, test } from './fixtures/extension';

/** Http backed by the same fake APIs the browser tests use. */
function fakeHttp(opts: FakeOptions = {}): Http & { calls: string[] } {
  const calls: string[] = [];
  const call = (url: string, init?: RequestInit) => {
    calls.push(url);
    const res = fakeApi(url, { body: init?.body as string, headers: init?.headers as Record<string, string> }, opts);
    if (!res || res.status >= 400) throw Object.assign(new Error(`HTTP ${res?.status}`), { status: res?.status });
    return res;
  };
  return {
    calls,
    json: async <T>(url: string, init?: RequestInit) => call(url, init).json as T,
    bytes: async (url: string, init?: RequestInit) => new Uint8Array(call(url, init).body!),
  };
}
const YOZAKURA = { title: 'Mission: Yozakura Family', episode: 44 };

unit.describe('lookup logic', () => {
  // P1-40
  unit('parses episode from page titles', () => {
    expect(parseEpisodeTitle('Mission: Yozakura Family Ep. 44 :: animepahe')).toEqual(YOZAKURA);
    expect(parseEpisodeTitle('Watch One Piece Episode 1100 English Subbed')).toEqual({ title: 'One Piece', episode: 1100 });
    expect(parseEpisodeTitle('Frieren - EP 12 | site')).toEqual({ title: 'Frieren', episode: 12 });
    expect(parseEpisodeTitle('Mission: Yozakura Family Season 2 Part 2 - 44 :: animepahe')).toEqual({
      title: 'Mission: Yozakura Family Season 2 Part 2',
      episode: 44,
    });
    expect(parseEpisodeTitle('Frieren - 12')).toEqual({ title: 'Frieren', episode: 12 });
    expect(parseEpisodeTitle('Re:Zero - Starting Life in Another World')).toBeNull();
    expect(parseEpisodeTitle('86 - Eighty Six')).toBeNull();
    expect(parseEpisodeTitle('Deep Sea Documentary')).toBeNull();
    expect(parseEpisodeTitle('YouTube')).toBeNull();
  });

  // P1-41
  unit('maps absolute episode numbers to season candidates', async () => {
    const f = (await findFranchise(fakeHttp(), 'Mission: Yozakura Family'))!;
    expect(episodeCandidates(f, 44)).toEqual([
      { anilistId: 213657, episode: 5 },
      { anilistId: 213657, episode: 17 },
      { anilistId: 213657, episode: 44 },
    ]);
    expect(episodeCandidates(f, 3)[0]).toEqual({ anilistId: 158898, episode: 3 }); // per-season numbering
    expect(episodeCandidates(f, 30)).toContainEqual({ anilistId: 182578, episode: 3 });
  });

  // P1-42
  unit('walks AniList prequels and sequels in order', async () => {
    const f = (await findFranchise(fakeHttp(), 'Mission: Yozakura Family'))!;
    expect(f.seasons.map((s) => [s.id, s.episodes])).toEqual([
      [158898, 27],
      [182578, 12],
      [213657, null],
    ]);
    expect(await findFranchise(fakeHttp(), 'nothing like this')).toBeNull();
  });

  // P1-43
  unit('picks text subtitle files only', () => {
    const f = (name: string) => ({ url: name, name, size: 1 });
    expect(pickFile([f('a.sup'), f('a.ass'), f('a.srt')])?.name).toBe('a.srt');
    expect(pickFile([f('a.sup'), f('a.ass')])?.name).toBe('a.ass');
    expect(pickFile([f('a.zip'), f('a.sup')])).toBeNull();
  });

  // P1-44
  unit('reports no key, not found and a bad key', async () => {
    expect(await resolveSubs(fakeHttp(), undefined, YOZAKURA)).toMatchObject({ ok: false, state: 'no-key' });
    expect(await resolveSubs(fakeHttp({ noFiles: true }), FAKE_KEY, YOZAKURA)).toMatchObject({
      ok: false,
      state: 'not-found',
      message: 'No Japanese subtitles on Jimaku for Mission: Yozakura Family ep 44 yet.',
    });
    expect(await resolveSubs(fakeHttp(), 'wrong', YOZAKURA)).toMatchObject({ ok: false, state: 'error' });
    const ok = await resolveSubs(fakeHttp(), FAKE_KEY, YOZAKURA);
    expect(ok).toMatchObject({ ok: true, fileName: 'S2 - 17.srt', show: 'Mission: Yozakura Family Season 2 Part 2 ep 17' });
  });
});

test.describe('automatic subtitles', () => {
  const player = (page: import('@playwright/test').Page) => page.frameLocator(`iframe[src^="${PLAYER}"]`);
  const playerFrame = (page: import('@playwright/test').Page) => page.frame({ url: /player\.test/ })!;

  // P1-28
  test('loads subtitles automatically when an episode opens', async ({ context, extensionId }) => {
    const requests = await mockApis(context);
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/pahe`);

    await expect.poll(() => requests.includes(DOWNLOAD_URL)).toBe(true);
    await setTime(playerFrame(page), 2);
    await expect(overlayIn(player(page))).toHaveText('はじめまして');

    const popup = await openPopup(context, extensionId, page);
    await expect(popup.getByText('Auto: Loaded Mission: Yozakura Family Season 2 Part 2 ep 17 from Jimaku')).toBeVisible();
    await expect(popup.getByRole('status')).toHaveText('Loaded S2 - 17.srt (4 cues)');
    expect(requests.some((u) => u.endsWith('.sup'))).toBe(false);
  });

  // P1-30
  test('asks for an API key, then loads once it is saved', async ({ context, extensionId }) => {
    await mockApis(context);
    const page = await context.newPage();
    await page.goto(`${SITE}/pahe`);
    const popup = await openPopup(context, extensionId, page);
    await expect(popup.getByText('Auto: Add your Jimaku API key in Settings.')).toBeVisible();

    await popup.getByText('Settings', { exact: true }).click();
    await popup.getByLabel('Jimaku API key').fill(FAKE_KEY);
    await popup.getByRole('button', { name: 'Save' }).click();
    await expect(popup.getByText(/^Auto: Loaded .* ep 17 from Jimaku$/)).toBeVisible();
    await expect(popup.getByLabel('Jimaku API key')).toHaveValue(''); // not echoed back
  });

  // P1-32
  test('says when Jimaku has no subtitles yet; manual upload still works', async ({ context, extensionId }) => {
    await mockApis(context, { noFiles: true });
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/pahe`);
    const popup = await openPopup(context, extensionId, page);
    await expect(
      popup.getByText('Auto: No Japanese subtitles on Jimaku for Mission: Yozakura Family ep 44 yet.'),
    ).toBeVisible();

    await popup.getByLabel('Subtitle file').setInputFiles('e2e/fixtures/sample.ass');
    await expect(popup.getByRole('status')).toHaveText('Loaded sample.ass (3 cues)');
  });

  // P1-45
  test('reports a show AniList does not know', async ({ context, extensionId }) => {
    await mockApis(context);
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/unknown`);
    const popup = await openPopup(context, extensionId, page);
    await expect(popup.getByText('Auto: “Totally Unknown Show” not found on AniList.')).toBeVisible();
  });

  // P1-47
  test('loads from a "Show Season 2 Part 2 - 44" title', async ({ context }) => {
    const requests = await mockApis(context);
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/pahe-dash`);
    await expect.poll(() => requests.includes(DOWNLOAD_URL)).toBe(true);
    await setTime(playerFrame(page), 2);
    await expect(overlayIn(player(page))).toHaveText('はじめまして');
  });

  // P1-48
  test('explains when the page title has no episode number', async ({ context, extensionId }) => {
    await mockApis(context);
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/watch`);
    const popup = await openPopup(context, extensionId, page);
    await expect(popup.getByText(/^Auto: No episode number in the page title/)).toBeVisible();
  });

  // P1-46
  test('reloading the episode does not download again', async ({ context }) => {
    const requests = await mockApis(context);
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/pahe`);
    await expect.poll(() => requests.filter((u) => u === DOWNLOAD_URL).length).toBe(1);

    await page.reload();
    await setTime(playerFrame(page), 2);
    await expect(overlayIn(player(page))).toHaveText('はじめまして');
    expect(requests.filter((u) => u === DOWNLOAD_URL)).toHaveLength(1);
  });

  // P1-33
  test('no-video pages with episode-like titles trigger no lookups', async ({ context }) => {
    const requests = await mockApis(context);
    await setJimakuKey(context, FAKE_KEY);
    const page = await context.newPage();
    await page.goto(`${SITE}/novideo`);
    await page.evaluate(() => (document.title = 'Some Show Episode 5'));
    await expect(page.getByRole('heading', { name: 'Just text' })).toBeVisible();
    expect(requests).toEqual([]);
  });
});
