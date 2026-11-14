// The study notebook: one card per word (every sighting merged), sortable, by show or all together.
import { browser } from 'wxt/browser';
import { allEntries, deleteEntry, filterEntries, getShot, LEARNED_KEY, showName, type NotebookEntry } from '@/lib/notebook';
import { Dictionary } from '@/lib/dict';
import { groupCards, matchesQuery, mergeCards, sortCards, type GroupBy, type SortBy, type WordCard } from '@/lib/notebook-view';

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
const shotUrls = new Map<number, Promise<string | null>>();
/** Parts of speech looked up for words saved before entries kept them (by word). */
const posCache = new Map<string, string[]>();
let dictionary: Dictionary | null = null;
async function lookUpPos(cards: WordCard[]): Promise<void> {
  const missing = cards.filter((c) => c.kind !== 'grammar' && !c.seen.some((e) => e.pos) && !posCache.has(c.word));
  if (!missing.length) return;
  const getURL = browser.runtime.getURL as (path: string) => string;
  dictionary ??= new Dictionary(async (k, b) => {
    const res = await fetch(getURL(`/dict/${k}/${b}.json.gz`));
    return (await new Response(res.body!.pipeThrough(new DecompressionStream('gzip'))).json()) as Record<string, unknown>;
  });
  for (const c of missing) posCache.set(c.word, (await dictionary.lookupAt(c.word, 0).catch(() => null))?.entries[0]?.p ?? []);
  render();
}
const posOf = (c: WordCard) => c.seen.find((e) => e.pos)?.pos ?? posCache.get(c.word);

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
  const a = el('article', known ? 'learned' : '');
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
    learned = known ? learned.filter((w) => w !== c.word) : [...learned, c.word];
    await browser.storage.local.set({ [LEARNED_KEY]: learned });
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
  actions.append(learn, del);
  if (e.url) {
    const open = el('a', '', 'Episode');
    open.href = e.url;
    open.target = '_blank';
    open.rel = 'noreferrer';
    actions.append(open);
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
  const by = sort.value as SortBy;
  const keep = new Set(shown.map((c) => c.key));
  const draw = (cards: WordCard[]) => (view.value === 'list' ? table(cards) : grid(cards));
  if (group.value === 'pos') void lookUpPos(shown);
  const groups = groupCards(filtered(), group.value as GroupBy, by, posOf)
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

/** Compact view: one row per word. */
function table(cards: WordCard[]): HTMLElement {
  const t = el('table');
  const head = el('tr');
  for (const h of ['Word', 'Reading', 'Level', 'Meaning', 'Seen', 'Last']) head.append(el('th', '', h));
  t.append(head);
  for (const c of cards) {
    const e = c.seen[0]!;
    const tr = el('tr', learned.includes(c.word) ? 'learned' : '');
    tr.setAttribute('aria-label', c.word);
    tr.append(
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

// Export what's listed as an Anki deck: one note per word (its newest sighting with a screenshot).
const exportBtn = $<HTMLButtonElement>('#export-apkg');
const exportStatus = $<HTMLSpanElement>('#export-status');
exportBtn.addEventListener('click', async () => {
  const chosen = visibleCards().map((c) => c.seen.find((s) => s.shot !== undefined) ?? c.seen[0]!);
  if (!chosen.length) return void (exportStatus.textContent = 'Nothing to export.');
  exportBtn.disabled = true;
  exportStatus.textContent = `Exporting ${chosen.length}…`;
  try {
    const [{ default: initSqlJs }, { buildApkg }] = await Promise.all([import('sql.js'), import('@/lib/apkg')]);
    // Copied by a build hook, so not in WXT's typed public paths.
    const getURL = browser.runtime.getURL as (path: string) => string;
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
});

async function load(): Promise<void> {
  [entries, learned] = await Promise.all([
    allEntries(),
    browser.storage.local.get(LEARNED_KEY).then((s) => (s[LEARNED_KEY] as string[] | undefined) ?? []),
  ]);
  render();
}
void load();
// New words arrive while an episode plays in another tab.
setInterval(() => void allEntries().then((e) => e.length !== entries.length && ((entries = e), render())), 3000);
