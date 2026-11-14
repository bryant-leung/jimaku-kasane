/**
 * The study notebook: words harder than your level, logged by themselves while you watch, each
 * with its line and a screenshot of the frame (which shows the English hardsub). Stored in
 * IndexedDB on your computer; nothing is uploaded.
 */

export interface NotebookEntry {
  id?: number;
  /** Dictionary form as usually written (諦める), and its reading. */
  word: string;
  reading?: string;
  meaning?: string;
  /** N1…N5 when on a JLPT list; otherwise "unlisted" (older entries: common or rare); or Name. */
  level: string;
  /** Difficulty 0–100 (how rare the word is in real Japanese); older entries don't have it. */
  score?: number;
  /** The Japanese line, and where the word sits in it. */
  line: string;
  start: number;
  length: number;
  /** Screenshot id in the `shots` store (shared by the words of one line). */
  shot?: number;
  /** One subtitle file = one episode. */
  episode: string;
  /** Page title (show and episode as the site names them), the file and the page. */
  title?: string;
  fileName: string;
  anilistId?: number;
  url?: string;
  /** Video time of the line, seconds. */
  time: number;
  at: number;
  /** Logged by itself, or you clicked it. */
  source: 'auto' | 'click';
  /** A grammar pattern (～ざるを得ない) rather than a word. */
  kind?: 'grammar';
  /** JMdict part-of-speech codes of the word (v5b, adj-na…); older entries don't have them. */
  pos?: string[];
  /** JMdict subject fields (music, sports…); older entries don't have them. */
  topics?: string[];
}

/** Setting: log words harder than N`x` (0 = off). Default 3: logs N2, N1 and rare words. */
export const LOG_ABOVE_KEY = 'notebookLogAbove';
export const DEFAULT_LOG_ABOVE = 3;
/** Words you marked learned (dictionary forms): no longer logged. */
export const LEARNED_KEY = 'notebookLearned';
/** When each word was marked learned (ms), for "learned this week". */
export const LEARNED_AT_KEY = 'notebookLearnedAt';
/** Safety valve: a dense episode can't flood the notebook. */
export const MAX_PER_EPISODE = 80;
/** Screenshot width, px (JPEG, ~40 KB). */
export const SHOT_WIDTH = 640;

/** Where the video is in the tab's viewport (CSS px) and the viewport's width; null in fullscreen. */
export interface VideoRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Viewport width, CSS px: screenshot px per CSS px = screenshot width / vw (both axes). */
  vw: number;
}

/**
 * The pixel box to keep from a `width`×`height` tab screenshot so it shows only the video, or null
 * to keep it all (fullscreen, unknown, off screen, or the video fills the tab anyway).
 */
export function cropBox(rect: VideoRect | null | undefined, width: number, height: number) {
  if (!rect || ![rect.x, rect.y, rect.w, rect.h, rect.vw].every(Number.isFinite) || rect.vw <= 0) return null;
  const k = width / rect.vw;
  const x0 = Math.max(0, rect.x * k);
  const y0 = Math.max(0, rect.y * k);
  const x1 = Math.min(width, (rect.x + rect.w) * k);
  const y1 = Math.min(height, (rect.y + rect.h) * k);
  if (x1 - x0 < width * 0.05 || y1 - y0 < height * 0.05) return null; // off screen or tiny: keep the whole tab
  if (x1 - x0 > width * 0.98 && y1 - y0 > height * 0.98) return null; // already the whole tab
  return { sx: Math.round(x0), sy: Math.round(y0), sw: Math.round(x1 - x0), sh: Math.round(y1 - y0) };
}

const DB = 'jimaku-kasane-notebook';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

let opened: Promise<IDBDatabase> | null = null;
export function openNotebook(): Promise<IDBDatabase> {
  return (opened ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      const entries = db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
      entries.createIndex('episode', 'episode');
      db.createObjectStore('shots', { autoIncrement: true });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => {
      opened = null;
      reject(r.error);
    };
  }));
}

export async function episodeEntries(episode: string): Promise<NotebookEntry[]> {
  const db = await openNotebook();
  return req(db.transaction('entries').objectStore('entries').index('episode').getAll(episode) as IDBRequest<NotebookEntry[]>);
}

export async function allEntries(): Promise<NotebookEntry[]> {
  const db = await openNotebook();
  return req(db.transaction('entries').objectStore('entries').getAll() as IDBRequest<NotebookEntry[]>);
}

export async function countEntries(): Promise<number> {
  const db = await openNotebook();
  return req(db.transaction('entries').objectStore('entries').count());
}

/** Stores the screenshot (if any) and the entries pointing at it, in one transaction. */
export async function addEntries(entries: Omit<NotebookEntry, 'shot'>[], shot: Blob | null): Promise<void> {
  const db = await openNotebook();
  const tx = db.transaction(['entries', 'shots'], 'readwrite');
  const shotId = shot ? ((await req(tx.objectStore('shots').add(shot))) as number) : undefined;
  for (const e of entries) tx.objectStore('entries').add({ ...e, ...(shotId !== undefined ? { shot: shotId } : {}) });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getShot(id: number): Promise<Blob | undefined> {
  const db = await openNotebook();
  return req(db.transaction('shots').objectStore('shots').get(id) as IDBRequest<Blob | undefined>);
}

/**
 * Which of `candidates` (dictionary forms) to log for an episode: not learned, not already in the
 * episode, at most `MAX_PER_EPISODE` in all, each once.
 */
export function pickNew(candidates: string[], already: readonly string[], learned: readonly string[], room = MAX_PER_EPISODE): string[] {
  const seen = new Set([...already, ...learned]);
  const out: string[] = [];
  for (const c of candidates) {
    if (out.length >= Math.max(0, room - already.length)) break;
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

/** Deletes an entry, and its screenshot when no other entry uses it. */
export async function deleteEntry(id: number): Promise<void> {
  const db = await openNotebook();
  const tx = db.transaction(['entries', 'shots'], 'readwrite');
  const entries = tx.objectStore('entries');
  const entry = (await req(entries.get(id))) as NotebookEntry | undefined;
  entries.delete(id);
  if (entry?.shot !== undefined) {
    const others = ((await req(entries.getAll())) as NotebookEntry[]).filter((e) => e.shot === entry.shot && e.id !== id);
    if (!others.length) tx.objectStore('shots').delete(entry.shot);
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** The show a page title names: "Hibike! Euphonium - Episode 3 - AnimePahe" → "Hibike! Euphonium". */
export function showName(e: Pick<NotebookEntry, 'title' | 'fileName'>): string {
  const t = e.title?.trim();
  if (t) {
    const cut = t.split(/\s*[-–—|:]?\s*(?:\b(?:ep|episode)\.?\s*\d+|第\s*\d+\s*話|#\d+)\b/i)[0]?.trim();
    if (cut) return cut;
  }
  return e.fileName.replace(/\.[^.]+$/, '').replace(/[\s._-]*(?:ep?\s*)?\d{1,3}(?:\D.*)?$/i, '').trim() || e.fileName;
}

export interface NotebookFilter {
  query: string;
  /** '' = both; 'word' or 'grammar'. */
  kind?: string;
  /** '' = any; 'N1', 'N2'…, 'rare', 'common', 'Name'. */
  level: string;
  show: string;
  hideLearned: boolean;
}

export function filterEntries(entries: readonly NotebookEntry[], f: NotebookFilter, learned: readonly string[]): NotebookEntry[] {
  const q = f.query.trim().toLowerCase();
  const known = new Set(learned);
  return entries.filter(
    (e) =>
      (!f.hideLearned || !known.has(e.word)) &&
      (!f.kind || (f.kind === 'grammar') === (e.kind === 'grammar')) &&
      (!f.level || (f.level === 'Name' ? !/^N\d|^rare$|^common$/.test(e.level) : e.level === f.level)) &&
      (!f.show || showName(e) === f.show) &&
      (!q || [e.word, e.reading, e.meaning, e.line].some((s) => s?.toLowerCase().includes(q))),
  );
}
