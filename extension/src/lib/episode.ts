export interface EpisodeInfo {
  title: string;
  episode: number;
}

/** "<title> Ep. 44 :: site", "Watch <title> Episode 44 English Sub", "<title> - EP 3". */
const EPISODE_TITLE = /^(.*?)[\s:\-–—|]*\bep(?:isode)?\.?\s*(\d{1,4})\b/i;

/** Reads show title + episode number from a page title. Site-agnostic; null when it doesn't look like an episode. */
export function parseEpisodeTitle(raw: string): EpisodeInfo | null {
  const m = EPISODE_TITLE.exec(raw.trim());
  if (!m) return null;
  const title = m[1]!
    .replace(/^(?:watch|stream(?:ing)?)\s+/i, '')
    .replace(/[\s:\-–—|]+$/, '')
    .trim();
  const episode = Number(m[2]);
  return title && episode > 0 ? { title, episode } : null;
}

export const episodeKey = (info: EpisodeInfo) => `${info.title.toLowerCase()}|${info.episode}`;
