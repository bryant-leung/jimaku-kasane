/** Anime genres from AniList (Music, Romance, Sports…), by AniList id, for the notebook's grouping. */
import { ANILIST_URL, type Http } from './autosubs';

/** storage.local: { [anilistId]: genres } so each show is asked about once. */
export const GENRES_KEY = 'showGenres';

export async function fetchGenres(http: Http, ids: number[]): Promise<Record<number, string[]>> {
  if (!ids.length) return {};
  const res = await http.json<{ data: { Page: { media: { id: number; genres: string[] }[] } } }>(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: 'query($ids:[Int]){Page(perPage:50){media(id_in:$ids){id genres}}}', variables: { ids: ids.slice(0, 50) } }),
  });
  return Object.fromEntries(res.data.Page.media.map((m) => [m.id, m.genres]));
}
