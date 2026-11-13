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
  /** N1…N5, common, rare or Name. */
  level: string;
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
}

/** Setting: log words harder than N`x` (0 = off). Default 3: logs N2, N1 and rare words. */
export const LOG_ABOVE_KEY = 'notebookLogAbove';
export const DEFAULT_LOG_ABOVE = 3;
/** Words you marked learned (dictionary forms): no longer logged. */
export const LEARNED_KEY = 'notebookLearned';
/** Safety valve: a dense episode can't flood the notebook. */
export const MAX_PER_EPISODE = 80;
/** Screenshot width, px (JPEG, ~40 KB). */
export const SHOT_WIDTH = 640;

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
