import type { Cue } from './cue';
import type { EpisodeInfo } from './episode';
import { parseSubtitleFile } from './parse';

export const ANILIST_URL = 'https://graphql.anilist.co';
export const JIMAKU_API = 'https://jimaku.cc/api';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

/** Network seam so the logic can be tested without a browser. */
export interface Http {
  json<T>(url: string, init?: RequestInit): Promise<T>;
  bytes(url: string, init?: RequestInit): Promise<Uint8Array>;
}

export const fetchHttp: Http = {
  async json<T>(url: string, init?: RequestInit) {
    const res = await fetch(url, init);
    if (!res.ok) throw new HttpError(res.status, url);
    return (await res.json()) as T;
  },
  async bytes(url: string, init?: RequestInit) {
    const res = await fetch(url, init);
    if (!res.ok) throw new HttpError(res.status, url);
    return new Uint8Array(await res.arrayBuffer());
  },
};

// --- AniList: find the show and every season in its franchise ---

export interface Season {
  id: number;
  episodes: number | null; // null while airing
  title: string;
}

interface AniMedia {
  id: number;
  episodes: number | null;
  format: string | null;
  title: { romaji: string | null; english: string | null };
  relations: { edges: { relationType: string; node: { id: number; type: string; format: string | null } }[] };
}

const SEASON_FORMATS = new Set(['TV', 'TV_SHORT', 'ONA']);
const FIELDS = 'id episodes format title{romaji english} relations{edges{relationType node{id type format}}}';
const MAX_SEASONS = 12;

async function anilist<T>(http: Http, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await http.json<{ data: T }>(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  return res.data;
}

const toSeason = (m: AniMedia): Season => ({
  id: m.id,
  episodes: m.episodes,
  title: m.title.english ?? m.title.romaji ?? String(m.id),
});

export interface Franchise {
  matched: Season;
  /** In airing order. */
  seasons: Season[];
}

/** Searches AniList and walks PREQUEL/SEQUEL links to list the seasons in order. */
export async function findFranchise(http: Http, title: string): Promise<Franchise | null> {
  const found = await anilist<{ Page: { media: AniMedia[] } }>(
    http,
    `query($s:String){Page(perPage:1){media(search:$s,type:ANIME){${FIELDS}}}}`,
    { s: title },
  );
  const hit = found.Page.media[0];
  if (!hit) return null;

  const cache = new Map<number, AniMedia>([[hit.id, hit]]);
  const get = async (id: number) => {
    const known = cache.get(id);
    if (known) return known;
    const m = (await anilist<{ Media: AniMedia }>(http, `query($id:Int){Media(id:$id){${FIELDS}}}`, { id })).Media;
    cache.set(id, m);
    return m;
  };
  const linked = (m: AniMedia, rel: 'PREQUEL' | 'SEQUEL') =>
    m.relations.edges.find(
      (e) => e.relationType === rel && e.node.type === 'ANIME' && SEASON_FORMATS.has(e.node.format ?? ''),
    )?.node.id;

  let first = hit;
  const seen = new Set([hit.id]);
  for (let id = linked(first, 'PREQUEL'); id && !seen.has(id) && seen.size < MAX_SEASONS; id = linked(first, 'PREQUEL')) {
    seen.add(id);
    first = await get(id);
  }
  const chain = [first];
  const inChain = new Set([first.id]);
  for (let id = linked(first, 'SEQUEL'); id && !inChain.has(id) && chain.length < MAX_SEASONS; ) {
    const next = await get(id);
    chain.push(next);
    inChain.add(id);
    id = linked(next, 'SEQUEL');
  }
  const seasons = inChain.has(hit.id) ? chain.map(toSeason) : [toSeason(hit)];
  return { matched: toSeason(hit), seasons };
}

export interface Candidate {
  anilistId: number;
  episode: number;
}

/**
 * Sites number episodes per season or from the very first episode; uploaders sometimes number a
 * multi-part season continuously ("S2 - 17" for part 2 ep 5). Returns the plausible
 * (season, episode) pairs, most likely first.
 */
export function episodeCandidates(f: Franchise, n: number): Candidate[] {
  const out: Candidate[] = [];
  const add = (anilistId: number, episode: number) => {
    if (episode >= 1 && !out.some((c) => c.anilistId === anilistId && c.episode === episode)) {
      out.push({ anilistId, episode });
    }
  };
  if (f.matched.episodes === null || n <= f.matched.episodes) add(f.matched.id, n);

  // Episodes before each season, while all earlier seasons have a known length.
  const before: (number | null)[] = [];
  let total: number | null = 0;
  for (const s of f.seasons) {
    before.push(total);
    total = total === null || s.episodes === null ? null : total + s.episodes;
  }
  const idx = f.seasons.findIndex((s, i) => {
    const start = before[i];
    return start != null && n > start && (s.episodes === null || n <= start + s.episodes);
  });
  if (idx >= 0) {
    const season = f.seasons[idx]!;
    for (let j = idx; j >= 0; j--) add(season.id, n - before[j]!);
  }
  return out;
}

// --- Jimaku: find and download the subtitle file ---

interface JimakuEntry {
  id: number;
  name: string;
}
export interface JimakuFile {
  url: string;
  name: string;
  size: number;
}

/** Streaming rips share timing with what sites play; TV broadcast rips are often offset. */
const STREAMING_SOURCE = /web[-_. ]?(?:rip|dl)|netflix|amazon|\bamzn\b|disney|crunchyroll|\bcr\b|hulu|abema|u-?next/i;

/** Text subtitles only (.sup/.zip can't be parsed); streaming sources first, then .srt before .ass. */
export function pickFile(files: JimakuFile[]): JimakuFile | null {
  const format = (name: string) => (/\.srt$/i.test(name) ? 0 : /\.(ass|ssa)$/i.test(name) ? 1 : 9);
  const rank = (name: string) => format(name) + (STREAMING_SOURCE.test(name) ? 0 : 2);
  return files.filter((f) => format(f.name) < 9).sort((a, b) => rank(a.name) - rank(b.name))[0] ?? null;
}

export async function findJimakuFile(
  http: Http,
  apiKey: string,
  candidates: Candidate[],
): Promise<{ file: JimakuFile; entry: JimakuEntry; candidate: Candidate } | null> {
  const headers = { Authorization: apiKey };
  const entries = new Map<number, JimakuEntry[]>();
  for (const candidate of candidates) {
    let list = entries.get(candidate.anilistId);
    if (!list) {
      list = await http.json<JimakuEntry[]>(
        `${JIMAKU_API}/entries/search?anime=true&anilist_id=${candidate.anilistId}`,
        { headers },
      );
      entries.set(candidate.anilistId, list);
    }
    for (const entry of list) {
      const files = await http.json<JimakuFile[]>(
        `${JIMAKU_API}/entries/${entry.id}/files?episode=${candidate.episode}`,
        { headers },
      );
      const file = pickFile(files);
      if (file) return { file, entry, candidate };
    }
  }
  return null;
}

// --- The whole lookup ---

export type AutoResult =
  | { ok: true; fileName: string; cues: Cue[]; show: string; anilistId: number }
  | { ok: false; state: 'no-key' | 'not-found' | 'error'; message: string; anilistId?: number };

export async function resolveSubs(
  http: Http,
  apiKey: string | undefined,
  info: EpisodeInfo,
  franchiseCache?: { get(title: string): Promise<Franchise | null>; set(title: string, f: Franchise): Promise<void> },
): Promise<AutoResult> {
  if (!apiKey) return { ok: false, state: 'no-key', message: 'Add your Jimaku API key in Settings.' };
  const label = `${info.title} ep ${info.episode}`;
  try {
    let franchise = (await franchiseCache?.get(info.title)) ?? null;
    if (!franchise) {
      franchise = await findFranchise(http, info.title);
      if (franchise) await franchiseCache?.set(info.title, franchise);
    }
    if (!franchise) return { ok: false, state: 'not-found', message: `“${info.title}” not found on AniList.` };

    const hit = await findJimakuFile(http, apiKey, episodeCandidates(franchise, info.episode));
    if (!hit) {
      // Season the episode most likely belongs to: the live transcription's glossary comes from it.
      const anilistId = episodeCandidates(franchise, info.episode)[0]?.anilistId ?? franchise.matched.id;
      return { ok: false, state: 'not-found', message: `No Japanese subtitles on Jimaku for ${label} yet.`, anilistId };
    }

    const bytes = await http.bytes(hit.file.url, { headers: { Authorization: apiKey } });
    const parsed = parseSubtitleFile(hit.file.name, bytes);
    if (!parsed.ok) return { ok: false, state: 'error', message: parsed.error };
    const season = franchise.seasons.find((s) => s.id === hit.candidate.anilistId)?.title ?? hit.entry.name;
    return {
      ok: true,
      fileName: hit.file.name,
      cues: parsed.cues,
      show: `${season} ep ${hit.candidate.episode}`,
      anilistId: hit.candidate.anilistId,
    };
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 0;
    const message =
      status === 401
        ? 'Jimaku rejected the API key.'
        : status === 429
          ? 'Rate limited by AniList/Jimaku; try again in a minute.'
          : `Lookup failed for ${label} (${e instanceof Error ? e.message : String(e)}).`;
    return { ok: false, state: 'error', message };
  }
}
