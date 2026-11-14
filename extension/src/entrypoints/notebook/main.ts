// The study notebook: one card per word (every sighting merged), sortable, by show or all together.
import { browser } from 'wxt/browser';
import type { ExtRequest } from '@/lib/subs';
import { allEntries, deleteEntry, filterEntries, getShot, LEARNED_AT_KEY, LEARNED_KEY, showName, type NotebookEntry } from '@/lib/notebook';
import { fetchHttp } from '@/lib/autosubs';
import { Dictionary } from '@/lib/dict';
import { fetchGenres, GENRES_KEY } from '@/lib/genres';
import { groupCards, matchesQuery, mergeCards, notebookStats, sortCards, type GroupBy, type SortBy, type WordCard } from '@/lib/notebook-view';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const query = $<HTMLInputElement>('#query');
const level = $<HTMLSelectElement>('#level');
const show = $<HTMLSelectElement>('#show');
const kind = $<HTMLSelectElement>('#kind');
const sort = $<HTMLSelectElement>('#sort');
const group = $<HTMLSelectElement>('#group');
const view = $<HTMLSelectElement>('#view');
const hideLearned = $<HTMLInputElement>('#hide-learned');
const list = $<HTMLElement>('#list');
const summary = $<HTMLParagraphElement>('#summary');
const empty = $<HTMLParagraphElement>('#empty');
const viewer = $<HTMLDialogElement>('#viewer');

let entries: NotebookEntry[] = [];
let learned: string[] = [];
let learnedAt: Record<string, number> = {};
/** Selected cards (by card key) for the bulk actions. */
const selected = new Set<string>();

async function setLearned(words: string[], on: boolean): Promise<void> {
  const now = Date.now();
  for (const w of words) {
    if (on && !learned.includes(w)) {
      learned = [...learned, w];
      learnedAt[w] = now;
    } else if (!on) {
      learned = learned.filter((x) => x !== w);
      delete learnedAt[w];
    }
  }
  await browser.storage.local.set({ [LEARNED_KEY]: learned, [LEARNED_AT_KEY]: learnedAt });
}
const shotUrls = new Map<number, Promise<string | null>>();
/** Part of speech and topics looked up for words saved before entries kept them (by word). */
const metaCache = new Map<string, { p: string[]; t: string[] }>();
let dictionary: Dictionary | null = null;
let fieldNames: Record<string, string> = {};
const getURL = browser.runtime.getURL as (path: string) => string;
async function lookUpMeta(cards: WordCard[], need: 'pos' | 'topics'): Promise<void> {
  const missing = cards.filter((c) => c.kind !== 'grammar' && !c.seen.some((e) => e[need]) && !metaCache.has(c.word));
  if (!missing.length && (need === 'pos' || Object.keys(fieldNames).length)) return;
  dictionary ??= new Dictionary(async (k, b) => {
    const res = await fetch(getURL(`/dict/${k}/${b}.json.gz`));
    return (await new Response(res.body!.pipeThrough(new DecompressionStream('gzip'))).json()) as Record<string, unknown>;
  });
  if (need === 'topics' && !Object.keys(fieldNames).length) fieldNames = await dictionary.fieldNames();
  for (const c of missing) {
    const e = (await dictionary.lookupAt(c.word, 0).catch(() => null))?.entries[0];
    metaCache.set(c.word, { p: e?.p ?? [], t: e?.t ?? [] });
  }
  render();
}
const posOf = (c: WordCard) => c.seen.find((e) => e.pos)?.pos ?? metaCache.get(c.word)?.p;
const topicName = (code: string) => {
  const n = fieldNames[code] ?? code;
  return n.charAt(0).toUpperCase() + n.slice(1);
};
const topicsOf = (c: WordCard) => (c.seen.find((e) => e.topics)?.topics ?? metaCache.get(c.word)?.t ?? []).map(topicName);

/** Anime genres by AniList id (cached in storage; asked once per show). */
let genres: Record<number, string[]> = {};
let genresAsked = false;
async function lookUpGenres(): Promise<void> {
  if (genresAsked) return;
  genresAsked = true;
  genres = ((await browser.storage.local.get(GENRES_KEY))[GENRES_KEY] as Record<number, string[]> | undefined) ?? {};
  const ids = [...new Set(entries.map((e) => e.anilistId).filter((id): id is number => id !== undefined && !genres[id]))];
  if (ids.length) {
    try {
      genres = { ...genres, ...(await fetchGenres(fetchHttp, ids)) };
      await browser.storage.local.set({ [GENRES_KEY]: genres });
    } catch {
      // Offline: shows without genres go under "Genre unknown".
    }
  }
  render();
}
const genresOf = (c: WordCard) => [...new Set(c.seen.flatMap((e) => (e.anilistId !== undefined ? (genres[e.anilistId] ?? []) : [])))];

/** Which sighting each card shows (by card key). */
const picked = new Map<string, number>();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const day = (ms: number) => new Date(ms).toLocaleDateString();

function shotUrl(id: number): Promise<string | null> {
  if (!shotUrls.has(id)) shotUrls.set(id, getShot(id).then((b) => (b ? URL.createObjectURL(b) : null)));
  return shotUrls.get(id)!;
}

function image(id: number, alt: string): HTMLImageElement {
  const img = el('img');
  img.alt = alt;
  void shotUrl(id).then((u) => u && (img.src = u));
  return img;
}

function card(c: WordCard): HTMLElement {
  const known = learned.includes(c.word);
  const at = Math.min(picked.get(c.key) ?? 0, c.seen.length - 1);
  const e = c.seen[at]!;
  const a = el('article', [known ? 'learned' : '', selected.has(c.key) ? 'selected' : ''].join(' ').trim());
  a.setAttribute('aria-label', c.word);
  if (e.shot !== undefined) {
    const b = el('button', 'shot');
    b.setAttribute('aria-label', `Enlarge screenshot of ${c.word}`);
    const img = image(e.shot, `Frame where ${c.word} came up`);
    b.append(img);
    b.addEventListener('click', () => {
      viewer.querySelector('img')!.src = img.src;
      viewer.showModal();
    });
    a.append(b);
  } else {
    a.append(el('div', 'noshot', 'No screenshot (the tab was in the background)'));
  }
  // Every sighting: pick one to see its frame and line.
  if (c.seen.length > 1) {
    const strip = el('div', 'strip');
    strip.setAttribute('aria-label', 'Sightings');
    c.seen.forEach((s, i) => {
      const b = el('button');
      b.setAttribute('aria-label', `Sighting ${i + 1} of ${c.seen.length}: ${s.title ?? s.fileName} ${clock(s.time)}`);
      b.setAttribute('aria-pressed', String(i === at));
      if (s.shot !== undefined) b.append(image(s.shot, ''));
      b.addEventListener('click', () => {
        picked.set(c.key, i);
        render();
      });
      strip.append(b);
    });
    a.append(strip);
  }
  const body = el('div', 'body');
  const head = el('div', 'word', c.word);
  if (c.reading && c.reading !== c.word) head.append(el('span', 'reading', c.reading));
  const label = c.kind === 'grammar' ? `${c.level} grammar` : c.level;
  head.append(el('span', c.level === 'N1' || c.level === 'rare' ? 'tag hard' : 'tag', label));
  body.append(head);
  if (c.episodes > 1) body.append(el('div', 'seen', `Seen in ${c.episodes} episodes · first ${day(c.first)} · last ${day(c.last)}`));
  if (c.meaning) body.append(el('div', 'meaning', c.meaning));
  const line = el('div', 'line');
  line.append(e.line.slice(0, e.start), el('mark', '', e.line.slice(e.start, e.start + e.length)), e.line.slice(e.start + e.length));
  body.append(line);
  body.append(el('div', 'meta', `${e.title ?? e.fileName} · ${clock(e.time)} · ${e.source === 'click' ? 'you looked it up' : 'logged'} · ${day(e.at)}`));
  const actions = el('div', 'actions');
  const learn = el('button', '', known ? 'Not learned' : 'Learned');
  learn.setAttribute('aria-pressed', String(known));
  learn.addEventListener('click', async () => {
    await setLearned([c.word], !known);
    render();
  });
  // Deleting removes every sighting on the card: two clicks when there's more than one.
  const del = el('button', '', 'Delete');
  del.addEventListener('click', async () => {
    if (c.seen.length > 1 && del.textContent === 'Delete') return void (del.textContent = `Delete all ${c.seen.length}?`);
    for (const s of c.seen) await deleteEntry(s.id!);
    const gone = new Set(c.seen.map((s) => s.id));
    entries = entries.filter((x) => !gone.has(x.id));
    render();
  });
  actions.append(learn, del, picker(c));
  if (e.url) {
    // Opens the episode and jumps to just before the line.
    const jump = el('button', '', 'Jump to scene');
    jump.addEventListener('click', () => {
      void browser.runtime.sendMessage({ type: 'open-scene', url: e.url!, time: e.time } satisfies ExtRequest);
    });
    actions.append(jump);
  }
  body.append(actions);
  a.append(body);
  return a;
}

/** Entries passing the filters (search is applied to whole cards). */
const filtered = () =>
  filterEntries(entries, { query: '', kind: kind.value, level: level.value, show: show.value, hideLearned: hideLearned.checked }, learned);

/** The cards on screen, in order: what the export takes. */
function visibleCards(): WordCard[] {
  return sortCards(mergeCards(filtered()), sort.value as SortBy).filter((c) => matchesQuery(c, query.value));
}

function render(): void {
  const shows = [...new Set(entries.map(showName))].sort();
  if (show.options.length - 1 !== shows.length) {
    const keep = show.value;
    show.replaceChildren(new Option('All shows', ''), ...shows.map((s) => new Option(s, s)));
    show.value = shows.includes(keep) ? keep : '';
  }
  const all = mergeCards(entries);
  const shown = visibleCards();
  summary.textContent =
    `${all.length} word${all.length === 1 ? '' : 's'} (${entries.length} sighting${entries.length === 1 ? '' : 's'}) ` +
    `in ${shows.length} show${shows.length === 1 ? '' : 's'} · ${learned.length} learned · showing ${shown.length}`;
  empty.hidden = entries.length > 0;
  const st = notebookStats(all, learnedAt);
  $<HTMLParagraphElement>('#stats').textContent =
    `${st.byLevel.map(([k, n]) => `${k} ${n}`).join(' · ')}${st.byLevel.length ? ' — ' : ''}` +
    `${st.loggedThisWeek} new this week · ${st.learnedThisWeek} learned this week`;
  for (const k of [...selected]) if (!all.some((c) => c.key === k)) selected.delete(k); // deleted meanwhile
  bulkCount.textContent = `${selected.size} selected`;
  for (const b of [bulkLearned, bulkDelete, bulkExport, bulkClear]) b.disabled = selected.size === 0;
  bulkDelete.textContent = 'Delete';
  const by = sort.value as SortBy;
  const keep = new Set(shown.map((c) => c.key));
  const draw = (cards: WordCard[]) => (view.value === 'list' ? table(cards) : grid(cards));
  if (group.value === 'pos') void lookUpMeta(shown, 'pos');
  if (group.value === 'topic') void lookUpMeta(shown, 'topics');
  if (group.value === 'genre') void lookUpGenres();
  const groups = groupCards(filtered(), group.value as GroupBy, by, posOf, { topicsOf, genresOf })
    .map(([name, cards]): [string, WordCard[]] => [name, cards.filter((c) => keep.has(c.key) && matchesQuery(c, query.value))])
    .filter(([, cards]) => cards.length);
  if (group.value === 'none') return void list.replaceChildren(draw(groups[0]?.[1] ?? []));
  list.replaceChildren(
    ...groups.map(([name, cards]) => {
      const section = el('section');
      section.setAttribute('aria-label', name);
      section.append(el('h2', '', `${name} (${cards.length})`), draw(cards));
      return section;
    }),
  );
}

function grid(cards: WordCard[]): HTMLElement {
  const g = el('div', 'grid');
  g.append(...cards.map(card));
  return g;
}

/** "Select" checkbox for a card or row. */
function picker(c: WordCard): HTMLElement {
  const label = el('label', 'pick');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = selected.has(c.key);
  box.setAttribute('aria-label', `Select ${c.word}`);
  box.addEventListener('change', () => {
    if (box.checked) selected.add(c.key);
    else selected.delete(c.key);
    render();
  });
  label.append(box, 'Select');
  return label;
}

/** Compact view: one row per word. */
function table(cards: WordCard[]): HTMLElement {
  const t = el('table');
  const head = el('tr');
  for (const h of ['', 'Word', 'Reading', 'Level', 'Meaning', 'Seen', 'Last']) head.append(el('th', '', h));
  t.append(head);
  for (const c of cards) {
    const e = c.seen[0]!;
    const tr = el('tr', learned.includes(c.word) ? 'learned' : '');
    tr.setAttribute('aria-label', c.word);
    const pick = el('td');
    pick.append(picker(c));
    tr.append(
      pick,
      el('td', 'w', c.word),
      el('td', '', c.reading && c.reading !== c.word ? c.reading : ''),
      el('td', '', c.kind === 'grammar' ? `${c.level} grammar` : c.level),
      el('td', '', c.meaning ?? ''),
      el('td', '', c.episodes > 1 ? `${c.episodes} episodes` : '1 episode'),
      el('td', '', `${e.title ?? e.fileName} · ${clock(e.time)}`),
    );
    t.append(tr);
  }
  return t;
}

viewer.addEventListener('click', () => viewer.close());
for (const c of [query, kind, level, show, sort, group, view, hideLearned]) c.addEventListener('input', render);

// Export as an Anki deck: one note per word (its newest sighting with a screenshot).
const exportBtn = $<HTMLButtonElement>('#export-apkg');
const exportStatus = $<HTMLSpanElement>('#export-status');
async function exportCards(cards: WordCard[]): Promise<void> {
  const chosen = cards.map((c) => c.seen.find((s) => s.shot !== undefined) ?? c.seen[0]!);
  if (!chosen.length) return void (exportStatus.textContent = 'Nothing to export.');
  exportBtn.disabled = true;
  exportStatus.textContent = `Exporting ${chosen.length}…`;
  try {
    const [{ default: initSqlJs }, { buildApkg }] = await Promise.all([import('sql.js'), import('@/lib/apkg')]);
    // Copied by a build hook, so not in WXT's typed public paths.
    const SQL = await initSqlJs({ locateFile: () => getURL('/sqljs/sql-wasm.wasm') });
    const bytes = await buildApkg(SQL, chosen, async (id) => {
      const b = await getShot(id);
      return b ? new Uint8Array(await b.arrayBuffer()) : undefined;
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    a.download = `jimaku-kasane-notebook-${new Date().toISOString().slice(0, 10)}.apkg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    exportStatus.textContent = `Exported ${chosen.length} card${chosen.length === 1 ? '' : 's'}. Open the file to import it into Anki.`;
  } catch (err) {
    exportStatus.textContent = `Export failed: ${String(err)}`;
  } finally {
    exportBtn.disabled = false;
  }
}
exportBtn.addEventListener('click', () => void exportCards(visibleCards()));

// --- Bulk actions on the selected cards ---
const bulkCount = $<HTMLSpanElement>('#bulk-count');
const bulkLearned = $<HTMLButtonElement>('#bulk-learned');
const bulkDelete = $<HTMLButtonElement>('#bulk-delete');
const bulkExport = $<HTMLButtonElement>('#bulk-export');
const bulkClear = $<HTMLButtonElement>('#bulk-clear');
const selectedCards = () => mergeCards(entries).filter((c) => selected.has(c.key));
$<HTMLButtonElement>('#select-all').addEventListener('click', () => {
  for (const c of visibleCards()) selected.add(c.key);
  render();
});
bulkClear.addEventListener('click', () => {
  selected.clear();
  render();
});
bulkLearned.addEventListener('click', async () => {
  await setLearned(selectedCards().map((c) => c.word), true);
  selected.clear();
  render();
});
bulkDelete.addEventListener('click', async () => {
  const cards = selectedCards();
  const sightings = cards.reduce((n, c) => n + c.seen.length, 0);
  // Two clicks: the first says how much will go.
  if (bulkDelete.textContent === 'Delete') return void (bulkDelete.textContent = `Delete ${cards.length} words (${sightings} sightings)?`);
  const gone = new Set<number>();
  for (const c of cards) for (const s of c.seen) {
    await deleteEntry(s.id!);
    gone.add(s.id!);
  }
  entries = entries.filter((x) => !gone.has(x.id!));
  selected.clear();
  render();
});
bulkExport.addEventListener('click', () => void exportCards(selectedCards()));

async function load(): Promise<void> {
  const stored = await browser.storage.local.get([LEARNED_KEY, LEARNED_AT_KEY]);
  learned = (stored[LEARNED_KEY] as string[] | undefined) ?? [];
  learnedAt = (stored[LEARNED_AT_KEY] as Record<string, number> | undefined) ?? {};
  entries = await allEntries();
  render();
}
void load();
// New words arrive while an episode plays in another tab.
setInterval(() => void allEntries().then((e) => e.length !== entries.length && ((entries = e), render())), 3000);
