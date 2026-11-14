// The study notebook: every logged word with its line and screenshot, by show and episode.
import { browser } from 'wxt/browser';
import {
  allEntries,
  deleteEntry,
  filterEntries,
  getShot,
  LEARNED_KEY,
  showName,
  type NotebookEntry,
} from '@/lib/notebook';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const query = $<HTMLInputElement>('#query');
const level = $<HTMLSelectElement>('#level');
const show = $<HTMLSelectElement>('#show');
const kind = $<HTMLSelectElement>('#kind');
const hideLearned = $<HTMLInputElement>('#hide-learned');
const list = $<HTMLElement>('#list');
const summary = $<HTMLParagraphElement>('#summary');
const empty = $<HTMLParagraphElement>('#empty');
const viewer = $<HTMLDialogElement>('#viewer');

let entries: NotebookEntry[] = [];
let learned: string[] = [];
const shotUrls = new Map<number, Promise<string | null>>();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function shotUrl(id: number): Promise<string | null> {
  if (!shotUrls.has(id)) shotUrls.set(id, getShot(id).then((b) => (b ? URL.createObjectURL(b) : null)));
  return shotUrls.get(id)!;
}

function card(e: NotebookEntry): HTMLElement {
  const known = learned.includes(e.word);
  const a = el('article', known ? 'learned' : '');
  a.setAttribute('aria-label', e.word);
  if (e.shot !== undefined) {
    const b = el('button', 'shot');
    b.setAttribute('aria-label', `Enlarge screenshot of ${e.word}`);
    const img = el('img');
    img.alt = `Frame where ${e.word} came up`;
    void shotUrl(e.shot).then((u) => u && (img.src = u));
    b.append(img);
    b.addEventListener('click', () => {
      viewer.querySelector('img')!.src = img.src;
      viewer.showModal();
    });
    a.append(b);
  } else {
    a.append(el('div', 'noshot', 'No screenshot (the tab was in the background)'));
  }
  const body = el('div', 'body');
  const head = el('div', 'word', e.word);
  if (e.reading && e.reading !== e.word) head.append(el('span', 'reading', e.reading));
  const label = e.kind === 'grammar' ? `${e.level} grammar` : e.level;
  head.append(el('span', e.level === 'N1' || e.level === 'rare' ? 'tag hard' : 'tag', label));
  body.append(head);
  if (e.meaning) body.append(el('div', 'meaning', e.meaning));
  const line = el('div', 'line');
  line.append(e.line.slice(0, e.start), el('mark', '', e.line.slice(e.start, e.start + e.length)), e.line.slice(e.start + e.length));
  body.append(line);
  body.append(el('div', 'meta', `${clock(e.time)} · ${e.source === 'click' ? 'you looked it up' : 'logged'} · ${new Date(e.at).toLocaleDateString()}`));
  const actions = el('div', 'actions');
  const learn = el('button', '', known ? 'Not learned' : 'Learned');
  learn.setAttribute('aria-pressed', String(known));
  learn.addEventListener('click', async () => {
    learned = known ? learned.filter((w) => w !== e.word) : [...learned, e.word];
    await browser.storage.local.set({ [LEARNED_KEY]: learned });
    render();
  });
  const del = el('button', '', 'Delete');
  del.addEventListener('click', async () => {
    await deleteEntry(e.id!);
    entries = entries.filter((x) => x.id !== e.id);
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

function render(): void {
  const shown = filterEntries(entries, { query: query.value, kind: kind.value, level: level.value, show: show.value, hideLearned: hideLearned.checked }, learned);
  const shows = [...new Set(entries.map(showName))].sort();
  if (show.options.length - 1 !== shows.length) {
    const keep = show.value;
    show.replaceChildren(new Option('All shows', ''), ...shows.map((s) => new Option(s, s)));
    show.value = shows.includes(keep) ? keep : '';
  }
  summary.textContent = `${entries.length} word${entries.length === 1 ? '' : 's'} in ${shows.length} show${shows.length === 1 ? '' : 's'} · ${learned.length} learned · showing ${shown.length}`;
  empty.hidden = entries.length > 0;
  // Newest first: shows by their latest word, episodes likewise, words by time in the episode.
  const byShow = new Map<string, Map<string, NotebookEntry[]>>();
  for (const e of [...shown].sort((a, b) => b.at - a.at)) {
    const s = byShow.get(showName(e)) ?? byShow.set(showName(e), new Map()).get(showName(e))!;
    (s.get(e.episode) ?? s.set(e.episode, []).get(e.episode)!).push(e);
  }
  const parts: HTMLElement[] = [];
  for (const [name, episodes] of byShow) {
    const section = el('section');
    section.setAttribute('aria-label', name);
    section.append(el('h2', '', name));
    for (const words of episodes.values()) {
      const first = words[0]!;
      section.append(el('h3', '', first.title ?? first.fileName));
      const grid = el('div', 'grid');
      grid.append(...[...words].sort((a, b) => a.time - b.time).map(card));
      section.append(grid);
    }
    parts.push(section);
  }
  list.replaceChildren(...parts);
}

viewer.addEventListener('click', () => viewer.close());

// Export what's listed (after filters) as an Anki deck with the screenshots on the cards.
const exportBtn = $<HTMLButtonElement>('#export-apkg');
const exportStatus = $<HTMLSpanElement>('#export-status');
exportBtn.addEventListener('click', async () => {
  const chosen = filterEntries(entries, { query: query.value, kind: kind.value, level: level.value, show: show.value, hideLearned: hideLearned.checked }, learned);
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
for (const c of [query, kind, level, show, hideLearned]) c.addEventListener('input', render);

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
