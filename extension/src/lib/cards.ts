/** A line (and maybe a word from it) saved for review. */
export interface SavedCard {
  id: string;
  line: string;
  /** Set when saved from the dictionary card. */
  word?: string;
  reading?: string;
  meaning?: string;
  /** Page title (show + episode) or subtitle file name. */
  source: string;
  /** Video time of the line, seconds. */
  time: number;
  savedAt: string;
}

export const SAVED_CARDS_KEY = 'savedCards';

const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const mm = String(Math.floor(t / 60) % 60).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(t % 60).padStart(2, '0')}`;
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\t\r\n]+/g, ' ');

/**
 * Anki import file (File → Import): tab-separated, HTML fields, header lines tell Anki the format.
 * Front: the word (or the line). Back: reading, meaning, the line with the word in bold, and where it's from.
 */
export function toAnkiTsv(cards: readonly SavedCard[]): string {
  const rows = cards.map((c) => {
    const source = `${esc(c.source)} · ${clock(c.time)}`;
    if (!c.word) return [esc(c.line), `<small>${source}</small>`, 'jp-sub-overlay line'];
    const line = esc(c.line).split(esc(c.word)).join(`<b>${esc(c.word)}</b>`);
    const back = [c.reading && `【${esc(c.reading)}】`, c.meaning && esc(c.meaning)].filter(Boolean).join(' ');
    return [esc(c.word), `${back}<br>${line}<br><small>${source}</small>`, 'jp-sub-overlay word'];
  });
  return ['#separator:tab', '#html:true', '#columns:Front\tBack\tTags', ...rows.map((r) => r.join('\t'))].join('\n') + '\n';
}
