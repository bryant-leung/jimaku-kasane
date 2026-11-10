import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext } from '@playwright/test';

/**
 * Fake AniList + Jimaku shaped like the real "Mission: Yozakura Family" data:
 * S1 27 eps → S2 12 eps → S2 Part 2 (airing). Sites number it 44, AniList says Part 2 ep 5,
 * the Jimaku uploader says "S2 - 17".
 */
const media = (id: number, episodes: number | null, english: string, prequel?: number, sequel?: number) => ({
  id,
  episodes,
  format: 'TV',
  title: { romaji: english, english },
  relations: {
    edges: [
      ...(prequel ? [{ relationType: 'PREQUEL', node: { id: prequel, type: 'ANIME', format: 'TV' } }] : []),
      ...(sequel ? [{ relationType: 'SEQUEL', node: { id: sequel, type: 'ANIME', format: 'TV' } }] : []),
      { relationType: 'ADAPTATION', node: { id: 1, type: 'MANGA', format: 'MANGA' } },
    ],
  },
});
const MEDIA: Record<number, ReturnType<typeof media>> = {
  158898: media(158898, 27, 'Mission: Yozakura Family', undefined, 182578),
  182578: media(182578, 12, 'Mission: Yozakura Family Season 2', 158898, 213657),
  213657: media(213657, null, 'Mission: Yozakura Family Season 2 Part 2', 182578),
};

export const FAKE_KEY = 'test-jimaku-key';
export const DOWNLOAD_URL = 'https://jimaku.cc/entry/12748/download/S2%20-%2017.srt';

export interface FakeOptions {
  /** Jimaku has no file for the episode yet. */
  noFiles?: boolean;
}

/** Answers one request like the real APIs would. `null` = unknown URL. */
export function fakeApi(
  url: string,
  init: { body?: string; headers?: Record<string, string> },
  opts: FakeOptions = {},
): { status: number; json?: unknown; body?: Buffer } | null {
  if (url.startsWith('https://graphql.anilist.co')) {
    const { query, variables } = JSON.parse(init.body ?? '{}') as { query: string; variables: { s?: string; id?: number } };
    if (query.includes('Page')) {
      const found = /yozakura/i.test(variables.s ?? '') ? [MEDIA[158898]] : [];
      return { status: 200, json: { data: { Page: { media: found } } } };
    }
    return { status: 200, json: { data: { Media: MEDIA[variables.id ?? 0] ?? null } } };
  }
  if (url.startsWith('https://jimaku.cc/')) {
    if (init.headers?.Authorization !== FAKE_KEY && init.headers?.authorization !== FAKE_KEY) {
      return { status: 401, json: { error: 'unauthenticated', code: 401 } };
    }
    const u = new URL(url);
    if (u.pathname === '/api/entries/search') {
      const hit = u.searchParams.get('anilist_id') === '213657';
      return { status: 200, json: hit ? [{ id: 12748, name: 'Yozakura-san Chi no Daisakusen 2nd Season Part 2' }] : [] };
    }
    if (u.pathname === '/api/entries/12748/files') {
      if (opts.noFiles || u.searchParams.get('episode') !== '17') return { status: 200, json: [] };
      return {
        status: 200,
        json: [
          { url: `${DOWNLOAD_URL.replace('.srt', '.sup')}`, name: 'S2 - 17.sup', size: 9 },
          { url: DOWNLOAD_URL, name: 'S2 - 17.srt', size: 9 },
        ],
      };
    }
    if (url === DOWNLOAD_URL) {
      return { status: 200, body: readFileSync(path.join(import.meta.dirname, 'sample.srt')) };
    }
    return { status: 200, json: [] };
  }
  return null;
}

/** Routes AniList + Jimaku for the extension's service worker. Returns the URLs requested. */
export async function mockApis(context: BrowserContext, opts: FakeOptions = {}): Promise<string[]> {
  const seen: string[] = [];
  for (const pattern of ['https://graphql.anilist.co/**', 'https://jimaku.cc/**']) {
    await context.route(pattern, async (route) => {
      const req = route.request();
      seen.push(req.url());
      const res = fakeApi(req.url(), { body: req.postData() ?? undefined, headers: await req.allHeaders() }, opts);
      if (!res) return route.abort();
      return route.fulfill({
        status: res.status,
        contentType: res.body ? 'application/x-subrip' : 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: res.body ?? JSON.stringify(res.json),
      });
    });
  }
  return seen;
}
