/**
 * The notebook as an Anki deck (.apkg) with each entry's screenshot on its card. The collection
 * layout (schema 11) mirrors what genanki writes, which every current Anki imports.
 * Front: the word or grammar pattern and its line. Back: reading, meaning, level, screenshot, source.
 */
import type { SqlJsStatic } from 'sql.js';
import type { NotebookEntry } from './notebook';
import { zip } from './zip';

export const DECK_NAME = 'JimakuKasane notebook';
const MODEL_ID = 1731500000001;
const DECK_ID = 1731500000002;
const FIELDS = ['Word', 'Reading', 'Meaning', 'Level', 'Sentence', 'Picture', 'Source'] as const;

const CSS = `.card { font-family: "Hiragino Sans", "Noto Sans JP", sans-serif; font-size: 22px; text-align: center; }
.word { font-size: 40px; font-weight: 700; }
.sentence { margin-top: 12px; }
.sentence b { color: #d98c00; }
.reading { font-size: 26px; }
.meaning { margin-top: 8px; }
.level { font-size: 14px; opacity: 0.7; }
.picture img { max-width: 100%; margin-top: 12px; border-radius: 8px; }
.source { font-size: 13px; opacity: 0.6; margin-top: 8px; }`;

const FRONT = '<div class="word">{{Word}}</div><div class="sentence">{{Sentence}}</div>';
const BACK =
  '{{FrontSide}}<hr id=answer><div class="reading">{{Reading}}</div><div class="meaning">{{Meaning}}</div>' +
  '<div class="level">{{Level}}</div><div class="picture">{{Picture}}</div><div class="source">{{Source}}</div>';

const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null,
  dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null,
  dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null,
  tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null,
  usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null,
  factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null,
  odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null,
  lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);`;

function collection(now: number) {
  const sec = Math.floor(now / 1000);
  const today = { lrnToday: [0, 0], newToday: [0, 0], revToday: [0, 0], timeToday: [0, 0] };
  const deck = (id: number, name: string) => ({
    collapsed: false, conf: 1, desc: '', dyn: 0, extendNew: 10, extendRev: 50, id, mod: sec, name, usn: -1, ...today,
  });
  return {
    conf: {
      activeDecks: [1], addToCur: true, collapseTime: 1200, curDeck: 1, curModel: String(MODEL_ID), dueCounts: true, estTimes: true,
      newBury: true, newSpread: 0, nextPos: 1, sortBackwards: false, sortType: 'noteFld', timeLim: 0,
    },
    models: {
      [MODEL_ID]: {
        css: CSS, did: DECK_ID, id: String(MODEL_ID), mod: sec, name: 'JimakuKasane notebook', sortf: 0, tags: [], type: 0, usn: -1, vers: [],
        flds: FIELDS.map((name, ord) => ({ name, ord, font: 'Arial', media: [], rtl: false, size: 20, sticky: false })),
        tmpls: [{ name: 'Recognise', ord: 0, qfmt: FRONT, afmt: BACK, bafmt: '', bqfmt: '', bfont: '', bsize: 0, did: null }],
        latexPre: '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
        latexPost: '\\end{document}', latexsvg: false, req: [[0, 'any', [0, 4]]],
      },
    },
    decks: { 1: deck(1, 'Default'), [DECK_ID]: deck(DECK_ID, DECK_NAME) },
    dconf: {
      1: {
        autoplay: true, id: 1, maxTaken: 60, mod: 0, name: 'Default', replayq: true, timer: 0, usn: 0,
        lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
        new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20, separate: true },
        rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 100 },
      },
    },
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Stable id per word, so importing the deck again updates its card instead of duplicating it, and
 * a word met in several episodes is one note (since 1.1.0; 1.0.0 keyed it by episode too).
 */
async function guidFor(e: NotebookEntry): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`jimaku-kasane|${e.kind ?? 'word'}|${e.word}`)));
  return btoa(String.fromCharCode(...bytes.slice(0, 9)));
}

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** Builds the .apkg. `shot(id)` returns a screenshot's JPEG bytes. */
export async function buildApkg(
  SQL: SqlJsStatic,
  entries: readonly NotebookEntry[],
  shot: (id: number) => Promise<Uint8Array | undefined>,
  now = Date.now(),
): Promise<Uint8Array<ArrayBuffer>> {
  const db = new SQL.Database();
  db.run(SCHEMA);
  const c = collection(now);
  const sec = Math.floor(now / 1000);
  db.run('INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, ?)', [
    sec, now, now, JSON.stringify(c.conf), JSON.stringify(c.models), JSON.stringify(c.decks), JSON.stringify(c.dconf), '{}',
  ]);
  const media: Record<string, string> = {};
  const files: { name: string; data: Uint8Array }[] = [];
  const named = new Map<number, string>();
  let id = now;
  for (const [i, e] of entries.entries()) {
    let picture = '';
    if (e.shot !== undefined) {
      if (!named.has(e.shot)) {
        const bytes = await shot(e.shot);
        if (bytes) {
          const name = `jimaku-kasane-${e.shot}.jpg`;
          media[String(files.length)] = name;
          files.push({ name: String(files.length), data: bytes });
          named.set(e.shot, name);
        }
      }
      const name = named.get(e.shot);
      if (name) picture = `<img src="${name}">`;
    }
    const sentence = `${esc(e.line.slice(0, e.start))}<b>${esc(e.line.slice(e.start, e.start + e.length))}</b>${esc(e.line.slice(e.start + e.length))}`;
    const source = esc([e.title ?? e.fileName, clock(e.time)].join(' · '));
    const level = e.kind === 'grammar' ? `${e.level} grammar` : e.level;
    const flds = [esc(e.word), esc(e.reading ?? ''), esc(e.meaning ?? ''), esc(level), sentence, picture, source].join('\x1f');
    const tags = ` jimaku-kasane ${e.kind === 'grammar' ? 'grammar' : 'word'} ${e.level.replace(/\s+/g, '_')} `;
    const nid = id++;
    db.run('INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, 0, 0, "")', [nid, await guidFor(e), MODEL_ID, sec, tags, flds, e.word]);
    db.run('INSERT INTO cards VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, "")', [id++, nid, DECK_ID, sec, i]);
  }
  const collectionBytes = db.export();
  db.close();
  return zip([{ name: 'collection.anki2', data: collectionBytes }, { name: 'media', data: new TextEncoder().encode(JSON.stringify(media)) }, ...files]);
}
