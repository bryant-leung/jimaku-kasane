import { browser, type Browser } from 'wxt/browser';
import { fetchHttp, resolveSubs, type Franchise } from '@/lib/autosubs';
import { MIN_CONFIDENCE } from '@/lib/sync';
import { loadTokenizer, type Morph } from '@/lib/tokenizer';
import { groupWords, type WordGroup } from '@/lib/words';
import { GrammarMatcher, type GrammarMatch } from '@/lib/grammar';
import {
  addEntries,
  countEntries,
  cropBox,
  type VideoRect,
  DEFAULT_LOG_ABOVE,
  episodeEntries,
  LEARNED_KEY,
  LOG_ABOVE_KEY,
  pickNew,
  SHOT_WIDTH,
  type NotebookEntry,
} from '@/lib/notebook';
import { BIAS_LOG_KEY, biasFor, recordCorrection, type BiasLog } from '@/lib/sync-bias';
import type { Cue } from '@/lib/cue';
import { compareLines } from '@/lib/compare';
import { badgeFor } from '@/lib/badge';
import { Dictionary, isMarked, levelLabel } from '@/lib/dict';
import { SAVED_CARDS_KEY, type SavedCard } from '@/lib/cards';
import { HISTORY_KEY, addToHistory, historyEntry, type HistoryEntry } from '@/lib/history';
import { episodeKey, type EpisodeInfo } from '@/lib/episode';
import {
  JIMAKU_KEY,
  NOT_FOUND_RETRY_MS,
  PREPARE_AHEAD_KEY,
  SERVER_URL,
  autoKey,
  fileKeyFor,
  formatOffset,
  roundOffset,
  offsetKey,
  offsetWrites,
  showOffsetKey,
  syncKey,
  syncedKey,
  syncedShowKey,
  SYNC_BIAS_KEY,
  type AutoSyncMessage,
  type SyncMessage,
  type SyncStatus,
  type AutoStatus,
  type ExtRequest,
  type LoadResult,
  type SubsState,
  type SubsUpdated,
  COMPARE_REPORTS_KEY,
  ENABLED_KEY,
  compareKey,
  type CompareReport,
  type CompareState,
} from '@/lib/subs';

// storage.session: survives SW restarts and page reloads, cleared when the browser quits.
const session = browser.storage.session;
const tabKey = (tabId: number) => `tab:${tabId}`;
const pageKey = (tabId: number) => `page:${tabId}`;
const videoKey = (tabId: number) => `video:${tabId}`;
const titleKey = (tabId: number) => `title:${tabId}`;
const urlKey = (tabId: number) => `url:${tabId}`;
/** The page has its own Japanese track: no Jimaku lookup, no Whisper. */
const pageTrackKey = (tabId: number) => `pagetrack:${tabId}`;

// --- Prepare ahead: a minimized copy of the episode plays muted at 1.5× and is transcribed, so
// lines reach your tab before they're spoken. prep tab id → your tab.
interface Prep {
  viewer: number;
  windowId: number;
  fileKey: string;
  /** The copy reported it is playing. */
  playing?: boolean;
}
/** No word from the copy by then → it didn't start: transcribe your tab live instead. */
const PREP_START_TIMEOUT_MS = 25_000;
const PREP_KEY = 'prepTabs';
const getPreps = async () => ((await session.get(PREP_KEY))[PREP_KEY] as Record<string, Prep> | undefined) ?? {};
const setPreps = (preps: Record<string, Prep>) => session.set({ [PREP_KEY]: preps });
async function prepOf(tabId: number): Promise<Prep | undefined> {
  return (await getPreps())[tabId];
}
async function prepForViewer(viewer: number): Promise<[number, Prep] | undefined> {
  const found = Object.entries(await getPreps()).find(([, p]) => p.viewer === viewer);
  return found ? [Number(found[0]), found[1]] : undefined;
}

async function startPrep(viewer: number, url: string, fileKey: string): Promise<boolean> {
  try {
    // Open blank, then load the episode: the window and its tab exist before any page loads.
    const win = await browser.windows.create({ url: 'about:blank', state: 'minimized', focused: false });
    const prepTab = win?.tabs?.[0]?.id;
    if (prepTab === undefined || win?.id === undefined) return false;
    await setPreps({ ...(await getPreps()), [prepTab]: { viewer, windowId: win.id, fileKey } });
    await browser.tabs.update(prepTab, { url });
    await browser.tabs.update(prepTab, { muted: true }).catch(() => {}); // Chrome-level mute, page unaware
    // Keep you on your episode: the copy shouldn't take focus (some setups open it as a tab).
    const viewerTab = await browser.tabs.get(viewer).catch(() => null);
    if (viewerTab) {
      await browser.tabs.update(viewer, { active: true }).catch(() => {});
      await browser.windows.update(viewerTab.windowId, { focused: true }).catch(() => {});
    }
    return true;
  } catch {
    return false;
  }
}

/** Ends preparing for `viewer`; with `fallBackToLive`, your tab transcribes live instead. */
async function stopPrep(viewer: number, fallBackToLive: boolean): Promise<void> {
  const found = await prepForViewer(viewer);
  if (found) {
    const [prepTab, prep] = found;
    const preps = await getPreps();
    delete preps[prepTab];
    await setPreps(preps);
    await browser.windows.remove(prep.windowId).catch(() => {});
  }
  const state = (await session.get(tabKey(viewer)))[tabKey(viewer)] as SubsState | undefined;
  if (!fallBackToLive || !state?.live) return;
  await ensureOffscreen();
  await browser.runtime.sendMessage({
    type: 'live-begin',
    tabId: viewer,
    fileKey: state.fileKey,
    anilistId: state.anilistId,
    title: state.fileName,
    drafts: true,
    from: 'viewer',
  } satisfies AutoSyncMessage);
  await browser.tabs
    .sendMessage(viewer, { type: 'auto-listen-start', tabId: viewer, fileKey: state.fileKey } satisfies AutoSyncMessage)
    .catch(() => {});
  await updateAutoMessage(viewer, 'Transcribing live with Whisper: lines appear a few seconds after they\'re spoken.');
}

/** Replaces the part of the popup's "Auto:" line after the Jimaku result. */
async function updateAutoMessage(tabId: number, tail: string): Promise<void> {
  const cur = (await session.get(autoKey(tabId)))[autoKey(tabId)] as AutoStatus | undefined;
  if (!cur) return;
  const head = cur.message.split(' Transcribing')[0]!.split(' Preparing')[0]!;
  await session.set({ [autoKey(tabId)]: { ...cur, message: `${head} ${tail}` } satisfies AutoStatus });
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const SHOW_TTL_MS = 12 * 60 * 60 * 1000;

/** AniList franchise lookups cached per title (storage.local). */
const franchiseCache = {
  async get(title: string): Promise<Franchise | null> {
    const key = `show:${title.toLowerCase()}`;
    const hit = (await browser.storage.local.get(key))[key] as { at: number; f: Franchise } | undefined;
    return hit && Date.now() - hit.at < SHOW_TTL_MS ? hit.f : null;
  },
  async set(title: string, f: Franchise): Promise<void> {
    await browser.storage.local.set({ [`show:${title.toLowerCase()}`]: { at: Date.now(), f } });
  },
};

/** Only extension pages (the popup) may load subtitles, not content scripts. */
const fromExtensionPage = (sender: Browser.runtime.MessageSender) =>
  sender.url?.startsWith(browser.runtime.getURL('/')) ?? false;

/**
 * The page's own Japanese track: official and timed to this stream, so it beats Jimaku and Whisper.
 * Called again as the track grows (streamed subtitles arrive in pieces); the file key stays the same.
 */
async function usePageTrack(tabId: number, label: string, cues: Cue[]): Promise<void> {
  const current = (await session.get(tabKey(tabId)))[tabKey(tabId)] as SubsState | undefined;
  const fileName = `Page subtitles (${label})`;
  if (!current?.pageTrack) {
    await session.set({ [pageTrackKey(tabId)]: true });
    // Stop transcribing: not needed any more.
    if (current?.live) {
      await stopPrep(tabId, false);
      await browser.runtime.sendMessage({ type: 'live-end', tabId } satisfies AutoSyncMessage).catch(() => {});
      await browser.tabs.sendMessage(tabId, { type: 'auto-listen-stop', tabId } satisfies AutoSyncMessage).catch(() => {});
    }
    const pageInfo = (await session.get(pageKey(tabId)))[pageKey(tabId)] as EpisodeInfo | undefined;
    await session.set({
      [autoKey(tabId)]: {
        key: pageInfo ? episodeKey(pageInfo) : `page|${label}`,
        at: Date.now(),
        state: 'loaded',
        message: `Using this page's own Japanese subtitles (${label}): official and already in time.`,
      } satisfies AutoStatus,
    });
  }
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  const state: SubsState = { fileName, fileKey: `page|${label}`, cues: sorted, pageTrack: true };
  await session.set({ [tabKey(tabId)]: state });
  if (!current?.pageTrack) void recordHistory(tabId, state);
  await browser.tabs.sendMessage(tabId, { type: 'subs-updated', state } satisfies SubsUpdated).catch(() => {});
}

/** History writes one at a time (two tabs can load at once). */
let historyQueue: Promise<void> = Promise.resolve();
function recordHistory(tabId: number, state: SubsState): Promise<void> {
  historyQueue = historyQueue
    .then(async () => {
      const s = await session.get([titleKey(tabId), urlKey(tabId)]);
      const entry = historyEntry(state, s[titleKey(tabId)] as string | undefined, s[urlKey(tabId)] as string | undefined);
      const list = ((await browser.storage.local.get(HISTORY_KEY))[HISTORY_KEY] as HistoryEntry[] | undefined) ?? [];
      await browser.storage.local.set({ [HISTORY_KEY]: addToHistory(list, entry) });
    })
    .catch(() => {});
  return historyQueue;
}

async function setSubs(
  tabId: number,
  fileName: string,
  cues: Cue[],
  auto?: { episodeKey: string; anilistId?: number; live?: boolean },
): Promise<SubsState> {
  const state: SubsState = { fileName, fileKey: fileKeyFor(fileName, cues), cues, ...auto };
  await session.set({ [tabKey(tabId)]: state });
  void recordHistory(tabId, state);
  // Reaches every frame in the tab, including cross-origin player iframes.
  await browser.tabs
    .sendMessage(tabId, { type: 'subs-updated', state } satisfies SubsUpdated)
    .catch(() => {}); // no content script yet; frames fetch state when they start
  return state;
}

const HANDLED = new Set<string | undefined>([
  'load-subs',
  'get-subs',
  'page-episode',
  'video-found',
  'retry-auto',
  'sync-start',
  'sync-result',
  'auto-sync-result',
  'auto-sync-progress',
  'auto-audio-error',
  'live-segment',
  'prep-done',
  'prep-status',
  'prep-stop',
  'viewer-seeked',
  'replay-line',
  'page-track',
  'save-line',
  'reveal',
  'save-card',
  'dict-segment',
  'dict-lookup',
  'notebook-line',
  'notebook-count',
  'video-rect',
  'open-scene',
  'take-seek',
  'compare-start',
  'compare-stop',
]);

async function serverUp(): Promise<boolean> {
  try {
    return (await fetch(`${SERVER_URL}/health`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

/**
 * Nothing on Jimaku: if the local Whisper server is running, transcribe the episode's audio as it
 * plays (lines appear a few seconds after they're spoken). Otherwise say how to start it.
 */
async function startLive(
  tabId: number,
  info: EpisodeInfo,
  episodeKey: string,
  anilistId: number | undefined,
  notFound: string,
  status: (st: Omit<AutoStatus, 'key'>) => Promise<void>,
): Promise<void> {
  if (!(await serverUp())) {
    await status({
      state: 'not-found',
      message: `${notFound} To generate them from the audio, start the local server (server/README.md) and press "Check Jimaku again".`,
    });
    return;
  }
  const liveMessage = `${notFound} Transcribing live with Whisper: lines appear a few seconds after they're spoken.`;
  const prepMessage = `${notFound} Preparing ahead in a minimized window (muted, ${PREP_SPEED}×): lines are timed exactly.`;
  // Already transcribing this episode (e.g. "Check Jimaku again" pressed): keep its lines.
  const current = (await session.get(tabKey(tabId)))[tabKey(tabId)] as SubsState | undefined;
  if (current?.live && current.episodeKey === episodeKey) {
    await status({ state: 'not-found', message: (await prepForViewer(tabId)) ? prepMessage : liveMessage });
    return;
  }
  const state = await setSubs(tabId, `Live transcription: ${info.title} ep ${info.episode}`, [], {
    episodeKey,
    anilistId,
    live: true,
  });
  // Prefer a copy that runs ahead (no delay); live transcription of your tab is the fallback.
  const url = (await session.get(urlKey(tabId)))[urlKey(tabId)] as string | undefined;
  const ahead = (await browser.storage.local.get(PREPARE_AHEAD_KEY))[PREPARE_AHEAD_KEY] !== false;
  const preparing = url && ahead ? await startPrep(tabId, url, state.fileKey) : false;
  await ensureOffscreen();
  await browser.runtime.sendMessage({
    type: 'live-begin',
    tabId,
    fileKey: state.fileKey,
    anilistId,
    title: info.title,
    drafts: !preparing,
    from: preparing ? 'prep' : 'viewer',
  } satisfies AutoSyncMessage);
  if (!preparing) {
    await browser.tabs
      .sendMessage(tabId, { type: 'auto-listen-start', tabId, fileKey: state.fileKey } satisfies AutoSyncMessage)
      .catch(() => {});
  }
  await status({ state: 'not-found', message: preparing ? prepMessage : liveMessage });
  if (preparing) {
    setTimeout(() => {
      void (async () => {
        const found = await prepForViewer(tabId);
        if (!found || found[1].playing) return;
        await stopPrep(tabId, true);
        await updateAutoMessage(
          tabId,
          "The background copy didn't start, so transcribing your tab live instead (lines a few seconds late).",
        );
      })();
    }, PREP_START_TIMEOUT_MS);
  }
}

const PREP_SPEED = 1.5;
/** Prepared lines needed before checking them against your tab's audio. */
const PREPARED_LINES_BEFORE_SYNC = 8;

/**
 * One lookup at a time per tab, so each sees the previous one's result (no duplicate downloads
 * from two triggers reading the same stale status).
 */
const queues = new Map<number, Promise<void>>();
function maybeAutoLoad(tabId: number, force = false): Promise<void> {
  const next = (queues.get(tabId) ?? Promise.resolve()).then(() => autoLoad(tabId, force));
  queues.set(tabId, next.catch(() => {}));
  return next;
}

/** Looks up subtitles once the tab has both an episode title and a video. */
async function autoLoad(tabId: number, force: boolean): Promise<void> {
  const s = await session.get([pageKey(tabId), videoKey(tabId), autoKey(tabId), titleKey(tabId), pageTrackKey(tabId)]);
  if (!s[videoKey(tabId)] || s[pageTrackKey(tabId)]) return;
  const info = s[pageKey(tabId)] as EpisodeInfo | undefined;
  const title = s[titleKey(tabId)] as string | undefined;
  if (!info) {
    if (title !== undefined) {
      const message = `No episode number in the page title “${title}”. Load a file manually.`;
      await session.set({ [autoKey(tabId)]: { key: `title|${title}`, state: 'not-found', message } satisfies AutoStatus });
    }
    return;
  }
  const key = episodeKey(info);
  const prev = s[autoKey(tabId)] as AutoStatus | undefined;
  // A finished result for this episode stands; a 'searching' left by an interrupted run doesn't.
  const stale = prev?.state === 'not-found' && Date.now() - (prev.at ?? 0) > NOT_FOUND_RETRY_MS;
  const settled = !stale && (prev?.state === 'loaded' || prev?.state === 'not-found' || prev?.state === 'no-key');
  if (!force && prev?.key === key && settled) return;

  const status = (st: Omit<AutoStatus, 'key'>) =>
    session.set({ [autoKey(tabId)]: { key, at: Date.now(), ...st } satisfies AutoStatus });
  {
    await status({ state: 'searching', message: `Looking up ${info.title} ep ${info.episode}…` });
    const apiKey = (await browser.storage.local.get(JIMAKU_KEY))[JIMAKU_KEY] as string | undefined;
    const res = await resolveSubs(fetchHttp, apiKey, info, franchiseCache);

    const now = (await session.get(pageKey(tabId)))[pageKey(tabId)] as EpisodeInfo | undefined;
    // Drop the result only if another episode is open now. A reload mid-lookup clears the
    // page record briefly; the result still belongs to this tab.
    if (now && episodeKey(now) !== key) return;
    if ((await session.get(pageTrackKey(tabId)))[pageTrackKey(tabId)]) return; // the page's own track won
    if (res.ok) {
      // New file for this show: start from the offset used on its last episode.
      const fileKey = fileKeyFor(res.fileName, res.cues);
      const local = await browser.storage.local.get([offsetKey(fileKey), showOffsetKey(res.anilistId)]);
      const inherited =
        local[offsetKey(fileKey)] === undefined ? (local[showOffsetKey(res.anilistId)] as number | undefined) : undefined;
      if (inherited !== undefined) await browser.storage.local.set({ [offsetKey(fileKey)]: inherited });
      await setSubs(tabId, res.fileName, res.cues, { episodeKey: key, anilistId: res.anilistId });
      const note = inherited ? ` (offset ${formatOffset(inherited)} from your last episode)` : '';
      await status({ state: 'loaded', message: `Loaded ${res.show} from Jimaku${note}` });
      void maybeAutoSync(tabId);
    } else if (res.state === 'not-found') {
      await startLive(tabId, info, key, res.anilistId, res.message, status);
    } else {
      await status({ state: res.state, message: res.message });
    }
  }
}

async function ensureOffscreen(): Promise<void> {
  const open = await browser.runtime.getContexts({ contextTypes: [browser.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (open.length) return;
  await browser.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [browser.offscreen.Reason.USER_MEDIA, browser.offscreen.Reason.WORKERS],
    justification: 'Run a voice-activity model on episode audio to line subtitles up with speech.',
  });
}

const syncStatus = (tabId: number, st: SyncStatus) => session.set({ [syncKey(tabId)]: st });

/** Tabs with an automatic sync running (offscreen page must stay open for them). */
const autoSessions = new Map<number, string>();
/** Auto-sync results within this of the current offset leave it unchanged. */
const ALREADY_MATCHES_S = 0.25;

/** Listens while the user watches and fixes the offset without a click; once per subtitle file. */
async function maybeAutoSync(tabId: number): Promise<void> {
  const state = (await session.get(tabKey(tabId)))[tabKey(tabId)] as SubsState | undefined;
  // Live transcription of your own tab is timed from that audio: nothing to sync. Lines prepared by
  // the background copy can be offset (it may play another source of the episode), so sync those.
  if (!state || autoSessions.get(tabId) === state.fileKey) return;
  if (state.pageTrack) return; // official track for this very stream: already in time
  if (state.live && !(await prepForViewer(tabId))) return;
  if (state.live && state.cues.length < PREPARED_LINES_BEFORE_SYNC) return;
  if ((await browser.storage.local.get(syncedKey(state.fileKey)))[syncedKey(state.fileKey)] !== undefined) return;
  await ensureOffscreen();
  autoSessions.set(tabId, state.fileKey);
  const showKey = state.anilistId !== undefined ? showOffsetKey(state.anilistId) : undefined;
  const stored = await browser.storage.local.get([...(showKey ? [showKey] : []), SYNC_BIAS_KEY, BIAS_LOG_KEY]);
  const bias = biasFor(stored[BIAS_LOG_KEY] as BiasLog | undefined, state.anilistId, stored[SYNC_BIAS_KEY] as number | undefined);
  const shown = showKey ? (stored[showKey] as number | undefined) : undefined;
  // The show's remembered offset includes your adjustment; the search needs the raw speech offset.
  const prior = shown === undefined ? undefined : shown - bias;
  await browser.runtime.sendMessage({
    type: 'auto-sync-begin',
    tabId,
    fileKey: state.fileKey,
    cues: state.cues,
    prior,
  } satisfies AutoSyncMessage);
  await browser.tabs
    .sendMessage(tabId, { type: 'auto-listen-start', tabId, fileKey: state.fileKey } satisfies AutoSyncMessage)
    .catch(() => {});
  await syncStatus(tabId, { state: 'listening', message: 'Auto-sync: checking the timing while you watch…', auto: true });
}

// --- Dictionary (built by scripts/build-dict.mjs): gzipped JSON buckets, loaded as needed ---
const getURL = browser.runtime.getURL as (path: string) => string;
const dictionary = new Dictionary(async (kind, bucket) => {
  const res = await fetch(getURL(`/dict/${kind}/${bucket}.json.gz`));
  if (!res.ok || !res.body) throw new Error(`dictionary ${kind}/${bucket}: ${res.status}`);
  return (await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).json()) as Record<string, unknown>;
});

// --- Word splitter (kuromoji, IPADIC; files copied to /kuromoji/ at build): loaded on first use ---
let morph: Promise<Morph | null> | null = null;
const loadMorph = () =>
  (morph ??= loadTokenizer(async (file) => {
    const res = await fetch(getURL(`/kuromoji/${file}`));
    if (!res.ok || !res.body) throw new Error(`kuromoji ${file}: ${res.status}`);
    return new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }).catch((e: unknown) => {
    console.warn('JimakuKasane: word splitter unavailable, using longest match', e);
    return null;
  }));
/** Recent lines' words: the card looks up the word you clicked in the same split. */
const wordCache = new Map<string, WordGroup[]>();
async function wordsIn(text: string): Promise<WordGroup[] | null> {
  const hit = wordCache.get(text);
  if (hit) return hit;
  const m = await loadMorph();
  if (!m) return null;
  const groups = groupWords(m.tokenize(text));
  wordCache.set(text, groups);
  if (wordCache.size > 200) wordCache.delete(wordCache.keys().next().value!);
  return groups;
}

/** Up to 3 other lines of the tab's subtitle file with the same word (by dictionary form). */
async function episodeLines(tabId: number, line: string, g: WordGroup): Promise<{ text: string; start: number }[]> {
  const state = (await session.get(tabKey(tabId)))[tabKey(tabId)] as SubsState | undefined;
  const m = await loadMorph();
  if (!state || !m || g.kind === 'particle') return [];
  // Cheap filter first: the word's kanji (or its kana if it has none) must appear in the line.
  const key = (g.base || g.surface).match(/[㐀-鿿々]+/)?.[0] ?? g.surface;
  const same = (w: WordGroup) => (g.base ? w.base === g.base : w.surface === g.surface) && w.kind === g.kind;
  const out: { text: string; start: number }[] = [];
  for (const c of state.cues) {
    if (out.length >= 3) break;
    const text = c.text.replace(/\n/g, ' ');
    if (text === line.replace(/\n/g, ' ') || !text.includes(key) || out.some((o) => o.text === text)) continue;
    if (groupWords(m.tokenize(text)).some(same)) out.push({ text, start: c.start });
  }
  return out;
}

// --- Study notebook: hard words logged with their line and a screenshot (lib/notebook.ts) ---
let notebookQueue: Promise<void> = Promise.resolve();

/** Logs `groups` of `line` (not yet in this episode, not learned) with one screenshot of the tab. */
let grammar: Promise<GrammarMatcher | null> | null = null;
async function grammarIn(text: string): Promise<GrammarMatch[]> {
  grammar ??= loadMorph().then((m) => (m ? new GrammarMatcher(m) : null));
  return (await grammar)?.match(text) ?? [];
}

function noteWords(
  tabId: number,
  line: string,
  time: number,
  groups: WordGroup[],
  source: NotebookEntry['source'],
  url?: string,
  patterns: GrammarMatch[] = [],
  shot: Blob | null = null,
) {
  const next = notebookQueue.then(async () => {
    if (await prepOf(tabId)) return; // the minimized helper copy, not what you watch
    const state = (await session.get(tabKey(tabId)))[tabKey(tabId)] as SubsState | undefined;
    if (!state) return;
    const found = [];
    for (const g of groups) {
      if (g.kind === 'particle' || g.kind === 'symbol') continue;
      const m = await dictionary.lookupWord(g);
      const e = m.entries[0];
      const word = g.kind === 'name' ? g.surface : e ? ((e.u ? e.r[0] : e.k[0]) ?? e.r[0] ?? g.surface) : g.surface;
      found.push({ g, m, e, word });
    }
    const points = patterns.map((p) => ({ p, word: p.point.pattern }));
    const already = (await episodeEntries(state.fileKey)).map((x) => x.word);
    const learned = ((await browser.storage.local.get(LEARNED_KEY))[LEARNED_KEY] as string[] | undefined) ?? [];
    const pick = new Set(pickNew([...found.map((f) => f.word), ...points.map((p) => p.word)], already, learned));
    const chosen = found.filter((f) => pick.delete(f.word));
    const chosenPoints = points.filter((p) => pick.delete(p.word));
    if (!chosen.length && !chosenPoints.length) return;
    const title = (await session.get(titleKey(tabId)))[titleKey(tabId)] as string | undefined;
    await addEntries(
      chosen.map(({ g, m, e, word }) => ({
        word,
        ...(g.kind === 'name' ? { reading: g.reading } : e?.r[0] ? { reading: e.r[0] } : {}),
        ...(e ? { meaning: e.s.slice(0, 2).map(([, gl]) => gl).join(' / ') } : {}),
        level: m.name ? m.name.label : e ? levelLabel(e) : 'rare',
        ...(e && !m.name ? { pos: e.p } : {}),
        ...(e?.t && !m.name ? { topics: e.t } : {}),
        line,
        start: g.start,
        length: g.length,
        episode: state.fileKey,
        ...(title ? { title } : {}),
        fileName: state.fileName,
        ...(state.anilistId !== undefined ? { anilistId: state.anilistId } : {}),
        ...(url ? { url } : {}),
        time,
        at: Date.now(),
        source,
      })).concat(
        chosenPoints.map(({ p, word }) => ({
          word,
          meaning: p.point.meaning,
          level: `N${p.point.level}`,
          line,
          start: p.start,
          length: p.length,
          episode: state.fileKey,
          ...(title ? { title } : {}),
          fileName: state.fileName,
          ...(state.anilistId !== undefined ? { anilistId: state.anilistId } : {}),
          ...(url ? { url } : {}),
          time,
          at: Date.now(),
          source,
          kind: 'grammar' as const,
        })),
      ),
      shot,
    );
  });
  notebookQueue = next.catch(() => {});
  return next;
}

/** Jump to a scene from the notebook: the tab's video seeks there when it appears (within 2 min). */
const seekKey = (tabId: number) => `seek:${tabId}`;
const SEEK_WAIT_MS = 120_000;

/** The last few lines' clean frames per tab (memory only), for words you click on them. */
const recentFrames = new Map<number, { line: string; time: number; shot: Blob | null }[]>();
function rememberFrame(tabId: number, line: string, time: number, shot: Blob | null): void {
  recentFrames.set(tabId, [{ line, time, shot }, ...(recentFrames.get(tabId) ?? [])].slice(0, 5));
}

/** Where each tab's video is (from its top frame), for cropping screenshots. */
const videoRects = new Map<number, VideoRect | null>();

/** The visible tab as a ~640 px JPEG, or null when it isn't on screen (background tab, minimized). */
async function screenshot(tabId: number): Promise<Blob | null> {
  const tab = await browser.tabs.get(tabId);
  if (!tab.active) return null;
  const win = await browser.windows.get(tab.windowId);
  if (win.state === 'minimized') return null;
  const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 85 });
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  // Only the video (not the site around it), unless fullscreen.
  const box = cropBox(videoRects.get(tabId), bmp.width, bmp.height) ?? { sx: 0, sy: 0, sw: bmp.width, sh: bmp.height };
  const scale = Math.min(1, SHOT_WIDTH / box.sw);
  const canvas = new OffscreenCanvas(Math.round(box.sw * scale), Math.round(box.sh * scale));
  canvas.getContext('2d')!.drawImage(bmp, box.sx, box.sy, box.sw, box.sh, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
}
/** Offset key presses arrive quickly: one bias-log update at a time. */
let biasQueue: Promise<void> = Promise.resolve();

/** Saves arrive concurrently (S pressed quickly): one write at a time. */
let saveQueue: Promise<void> = Promise.resolve();

// --- Compare mode: Whisper runs alongside a real subtitle file and is scored against it ---
const compareOf = async (tabId: number) =>
  (await session.get(compareKey(tabId)))[compareKey(tabId)] as CompareState | undefined;
/** Lines arrive concurrently: one update at a time per tab. */
const compareQueues = new Map<number, Promise<void>>();

async function startCompare(tabId: number): Promise<void> {
  const state = (await session.get(tabKey(tabId)))[tabKey(tabId)] as SubsState | undefined;
  const fail = (error: string) =>
    session.set({ [compareKey(tabId)]: { fileKey: state?.fileKey ?? '', lines: [], stats: null, error } satisfies CompareState });
  if (!state || state.live) return void (await fail('Load a subtitle file first: Whisper is scored against it.'));
  if (!(await serverUp())) {
    return void (await fail('Start the local server first: cd server && uv run uvicorn app.main:app --port 8765'));
  }
  await session.set({ [compareKey(tabId)]: { fileKey: state.fileKey, lines: [], stats: null } satisfies CompareState });
  await ensureOffscreen();
  await browser.runtime.sendMessage({
    type: 'live-begin',
    tabId,
    fileKey: state.fileKey,
    anilistId: state.anilistId,
    title: state.fileName,
    drafts: false,
    from: 'viewer',
  } satisfies AutoSyncMessage);
  await browser.tabs
    .sendMessage(tabId, { type: 'auto-listen-start', tabId, fileKey: state.fileKey } satisfies AutoSyncMessage)
    .catch(() => {});
}

async function stopCompare(tabId: number): Promise<void> {
  await session.remove(compareKey(tabId));
  await browser.runtime.sendMessage({ type: 'live-end', tabId } satisfies AutoSyncMessage).catch(() => {});
  if (!autoSessions.has(tabId)) {
    await browser.tabs.sendMessage(tabId, { type: 'auto-listen-stop', tabId } satisfies AutoSyncMessage).catch(() => {});
  }
}

function addCompareLines(tabId: number, fileKey: string, cues: (Cue & { raw?: string })[]): Promise<void> {
  const next = (compareQueues.get(tabId) ?? Promise.resolve()).then(async () => {
    const cmp = await compareOf(tabId);
    const state = (await session.get(tabKey(tabId)))[tabKey(tabId)] as SubsState | undefined;
    if (!cmp || cmp.fileKey !== fileKey || !state || state.fileKey !== fileKey) return;
    cmp.lines = [...cmp.lines, ...cues.map((c) => ({ start: c.start, end: c.end, text: c.text, raw: c.raw ?? c.text }))];
    // The file as you see it: shifted by its offset.
    const key = offsetKey(fileKey);
    const offset = ((await browser.storage.local.get(key))[key] as number | undefined) ?? 0;
    const ref = state.cues.map((c) => ({ ...c, start: c.start + offset, end: c.end + offset }));
    cmp.stats = compareLines(cmp.lines, ref);
    await session.set({ [compareKey(tabId)]: cmp });
    const reports = ((await browser.storage.local.get(COMPARE_REPORTS_KEY))[COMPARE_REPORTS_KEY] ?? {}) as Record<string, CompareReport>;
    reports[fileKey] = { fileName: state.fileName, anilistId: state.anilistId, at: new Date().toISOString(), stats: cmp.stats };
    await browser.storage.local.set({ [COMPARE_REPORTS_KEY]: reports });
  });
  compareQueues.set(tabId, next.catch(() => {}));
  return next;
}

async function finishAutoSync(msg: Extract<AutoSyncMessage, { type: 'auto-sync-result' }>): Promise<void> {
  if (autoSessions.get(msg.tabId) === msg.fileKey) autoSessions.delete(msg.tabId);
  if (!(await compareOf(msg.tabId))) {
    // (Compare mode keeps listening to the same audio.)
    await browser.tabs.sendMessage(msg.tabId, { type: 'auto-listen-stop', tabId: msg.tabId } satisfies AutoSyncMessage).catch(() => {});
  }
  const state = (await session.get(tabKey(msg.tabId)))[tabKey(msg.tabId)] as SubsState | undefined;
  if (!state || state.fileKey !== msg.fileKey) return; // subtitles changed meanwhile
  const key = offsetKey(state.fileKey);
  const current = ((await browser.storage.local.get(key))[key] as number | undefined) ?? 0;
  const found = msg.result.offset;
  if (found !== null) {
    const showKey = state.anilistId !== undefined ? showOffsetKey(state.anilistId) : undefined;
    const stored = await browser.storage.local.get([SYNC_BIAS_KEY, BIAS_LOG_KEY, ...(showKey ? [showKey] : [])]);
    const bias = biasFor(stored[BIAS_LOG_KEY] as BiasLog | undefined, state.anilistId, stored[SYNC_BIAS_KEY] as number | undefined);
    const before = showKey ? (stored[showKey] as number | undefined) : undefined;
    const target = roundOffset(found + bias);
    // Differences this small are measurement noise (timing drifts ~0.2 s under load): a file
    // that is already right isn't moved.
    const matches = Math.abs(target - current) < ALREADY_MATCHES_S;
    const offset = matches ? current : target;
    // synced:<file> keeps the raw speech offset, so later manual changes reveal your preference.
    await browser.storage.local.set({
      ...offsetWrites(state, offset),
      [syncedKey(state.fileKey)]: found,
      ...(state.anilistId !== undefined ? { [syncedShowKey(state.fileKey)]: state.anilistId } : {}),
    });
    const yours = bias ? ` (includes your ${formatOffset(bias)} adjustment)` : '';
    // A change from the show's last episode is worth knowing about: [ and ] undo it.
    const was = before !== undefined && Math.abs(before - offset) >= 0.05 ? `; last episode ${formatOffset(before)}` : '';
    const message = matches
      ? `Auto-sync: timing already matches (offset ${formatOffset(offset)})${yours}`
      : `Auto-synced: offset ${formatOffset(offset)}${yours}${was}`;
    await syncStatus(msg.tabId, { state: 'done', message });
    return;
  }
  const why = msg.error === 'silent' ? ' (no sound from the video; try the Auto-sync button)' : '';
  await syncStatus(msg.tabId, {
    state: 'failed',
    message: `Auto-sync couldn't confirm the timing${why}; keeping ${formatOffset(current)}. Use [ and ] if it's off.`,
  });
}

async function finishSync(msg: Extract<SyncMessage, { type: 'sync-result' }>): Promise<void> {
  await browser.tabs.sendMessage(msg.tabId, { type: 'sync-time-stop' } satisfies SyncMessage).catch(() => {});
  if (autoSessions.size === 0) await browser.offscreen.closeDocument().catch(() => {});
  const state = (await session.get(tabKey(msg.tabId)))[tabKey(msg.tabId)] as SubsState | undefined;
  const { offset, speechSeconds, bestGuess, confidence } = msg.result;
  if (state && offset !== null) {
    await browser.storage.local.set(offsetWrites(state, offset));
    const how = msg.mode === 'energy' ? ' (loudness fallback)' : '';
    await syncStatus(msg.tabId, { state: 'done', message: `Synced: offset ${formatOffset(offset)}${how}` });
    return;
  }
  const message = msg.error
    ? `Audio capture failed: ${msg.error}`
    : speechSeconds < 8
      ? 'Not enough speech heard. Keep the episode playing and try again.'
      : `No clear match (best guess ${bestGuess === null ? '?' : formatOffset(bestGuess)}, confidence ${confidence.toFixed(1)} of ${msg.result.needed ?? MIN_CONFIDENCE} needed). Set it with [ and ] instead.`;
  const diag = ` [${msg.mode ?? '?'}, ${msg.clocks ?? '?'} clock(s), ${msg.frames ?? '?'} audio frames, ${msg.samples ?? '?'} time samples, ${speechSeconds.toFixed(0)}s speech]`;
  await syncStatus(msg.tabId, { state: 'failed', message: message + diag });
}

async function handle(
  msg: ExtRequest | SyncMessage | AutoSyncMessage,
  sender: Browser.runtime.MessageSender,
): Promise<unknown> {
  const senderTab = sender.tab?.id;
  switch (msg.type) {
    case 'load-subs': {
      if (!fromExtensionPage(sender)) return { ok: false, error: 'Not allowed' } satisfies LoadResult;
      const state = await setSubs(msg.tabId, msg.fileName, msg.cues);
      void maybeAutoSync(msg.tabId);
      return { ok: true, count: state.cues.length, fileKey: state.fileKey } satisfies LoadResult;
    }
    case 'get-subs': {
      const tabId = msg.tabId ?? senderTab;
      if (tabId === undefined) return null;
      return ((await session.get(tabKey(tabId)))[tabKey(tabId)] as SubsState | undefined) ?? null;
    }
    case 'page-episode': {
      if (senderTab === undefined || sender.frameId !== 0) return null;
      if (await prepOf(senderTab)) return null; // the minimized copy doesn't look anything up
      if (sender.url) await session.set({ [urlKey(senderTab)]: sender.url });
      // One write for title + episode: a lookup reading between two writes would see a title
      // without its episode and report "no episode number".
      if (msg.info) await session.set({ [titleKey(senderTab)]: msg.title, [pageKey(senderTab)]: msg.info });
      else {
        await session.remove(pageKey(senderTab));
        await session.set({ [titleKey(senderTab)]: msg.title });
      }
      void maybeAutoLoad(senderTab);
      return null;
    }
    case 'video-found': {
      if (senderTab === undefined) return null;
      const prep = await prepOf(senderTab);
      if (prep) {
        await browser.tabs
          .sendMessage(senderTab, { type: 'prep-start', viewerTabId: prep.viewer, fileKey: prep.fileKey } satisfies AutoSyncMessage)
          .catch(() => {});
        return null;
      }
      await session.set({ [videoKey(senderTab)]: true });
      void maybeAutoLoad(senderTab);
      void maybeAutoSync(senderTab); // e.g. reload: subs already loaded, not yet synced
      return null;
    }
    case 'sync-start': {
      if (!fromExtensionPage(sender)) return null;
      const state = (await session.get(tabKey(msg.tabId)))[tabKey(msg.tabId)] as SubsState | undefined;
      if (!state) {
        await syncStatus(msg.tabId, { state: 'failed', message: 'Load subtitles first.' });
        return null;
      }
      await ensureOffscreen();
      await syncStatus(msg.tabId, { state: 'listening', message: 'Listening… keep the episode playing (up to 60s).' });
      await browser.tabs
        .sendMessage(msg.tabId, { type: 'sync-time-start', tabId: msg.tabId, seconds: 70 } satisfies SyncMessage)
        .catch(() => {});
      await browser.runtime.sendMessage({
        type: 'sync-capture',
        tabId: msg.tabId,
        streamId: msg.streamId,
        cues: state.cues,
      } satisfies SyncMessage);
      return null;
    }
    case 'auto-sync-progress': {
      if (!fromExtensionPage(sender) || autoSessions.get(msg.tabId) !== msg.fileKey) return null;
      await syncStatus(msg.tabId, {
        state: 'listening',
        auto: true,
        message:
          `Auto-sync: listening while you watch… ${Math.round(msg.heard)}s heard, ${Math.round(msg.speech)}s of speech` +
          // Early guesses wobble; only mention one once it's getting close to the bar.
          (msg.bestGuess != null && msg.confidence !== undefined && msg.confidence >= 0.75 * (msg.needed ?? 4)
            ? `; leaning towards ${formatOffset(msg.bestGuess)}.`
            : '.'),
      });
      return null;
    }
    case 'auto-audio-error': {
      if (senderTab !== undefined && (await prepOf(senderTab))) {
        await stopPrep(msg.tabId, true); // the copy can't be heard: transcribe your tab live instead
        return null;
      }
      if (senderTab === undefined || autoSessions.get(senderTab) !== msg.fileKey) return null;
      autoSessions.delete(senderTab);
      await syncStatus(senderTab, {
        state: 'failed',
        message: `Auto-sync can't read this player's audio (${msg.error}). Use the Auto-sync button instead.`,
      });
      return null;
    }
    case 'live-segment': {
      if (!fromExtensionPage(sender)) return null;
      let cues: Cue[];
      try {
        const res = await fetch(`${SERVER_URL}/transcribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            anilist_id: msg.anilistId ?? null,
            title: msg.title,
            start: msg.start,
            audio: msg.audio,
            partial: msg.partial,
          }),
        });
        if (!res.ok) return null;
        cues = ((await res.json()) as { cues: Cue[] }).cues;
      } catch {
        return null; // server stopped mid-episode: drop this line, keep going
      }
      const state = (await session.get(tabKey(msg.tabId)))[tabKey(msg.tabId)] as SubsState | undefined;
      if (state && !state.live && !msg.partial) {
        await addCompareLines(msg.tabId, msg.fileKey, cues); // compare mode: scored, never shown
        return null;
      }
      if (!state?.live || state.fileKey !== msg.fileKey) return null;
      const prepared = (await prepForViewer(msg.tabId)) !== undefined;
      if (msg.partial) {
        // Drafts go straight to the page; only finished lines are stored.
        if (cues.length) {
          await browser.tabs
            .sendMessage(msg.tabId, {
              type: 'subs-partial',
              fileKey: msg.fileKey,
              segId: msg.segId,
              cues: cues.map((c) => ({ ...c, partial: true })),
            } satisfies AutoSyncMessage)
            .catch(() => {});
        }
        return null;
      }
      state.cues = [...state.cues, ...cues].sort((a, b) => a.start - b.start);
      if (prepared) {
        if (autoSessions.get(msg.tabId) === state.fileKey) {
          // A sync is running: give it the new lines too (it started with only the first few).
          await browser.runtime
            .sendMessage({ type: 'auto-sync-cues', tabId: msg.tabId, fileKey: state.fileKey, cues } satisfies AutoSyncMessage)
            .catch(() => {});
        } else if (state.cues.length >= PREPARED_LINES_BEFORE_SYNC) {
          void maybeAutoSync(msg.tabId);
        }
        const upTo = Math.max(...cues.map((c) => c.end));
        await updateAutoMessage(
          msg.tabId,
          `Preparing ahead in a minimized window (muted, ${PREP_SPEED}×): lines are timed exactly. Ready up to ${clock(upTo)}.`,
        );
      }
      await session.set({ [tabKey(msg.tabId)]: state });
      await browser.tabs
        .sendMessage(msg.tabId, {
          type: 'subs-append',
          fileKey: msg.fileKey,
          cues,
          segId: msg.segId,
          prepared,
        } satisfies AutoSyncMessage)
        .catch(() => {});
      return null;
    }
    case 'prep-done': {
      if (senderTab === undefined || !(await prepOf(senderTab))) return null;
      await stopPrep(msg.viewerTabId, false);
      await updateAutoMessage(msg.viewerTabId, 'Prepared the whole episode.');
      return null;
    }
    case 'prep-status': {
      const prep = senderTab === undefined ? undefined : await prepOf(senderTab);
      if (senderTab === undefined || !prep) return null;
      if (msg.playing) {
        await setPreps({ ...(await getPreps()), [senderTab]: { ...prep, playing: true } });
        await updateAutoMessage(
          msg.viewerTabId,
          `Preparing ahead in a minimized window (muted, ${PREP_SPEED}×): copy is playing at ${clock(msg.t)}.`,
        );
      } else {
        // The copy didn't start (e.g. the player needs its own button): transcribe your tab live.
        await stopPrep(msg.viewerTabId, true);
        await updateAutoMessage(
          msg.viewerTabId,
          "The background copy didn't start playing, so transcribing your tab live instead (lines a few seconds late).",
        );
      }
      return null;
    }
    case 'dict-segment': {
      const groups = await wordsIn(msg.text);
      if (groups) return dictionary.tokensFor(groups).catch(() => []);
      return dictionary.segment(msg.text).catch(() => []);
    }
    case 'dict-lookup': {
      const groups = await wordsIn(msg.text);
      const g = groups?.find((w) => w.start <= msg.start && msg.start < w.start + w.length && w.kind !== 'symbol');
      const m = await (g ? dictionary.lookupWord(g) : dictionary.lookupAt(msg.text, msg.start)).catch(() => null);
      const episode = g && senderTab !== undefined ? await episodeLines(senderTab, msg.text, g).catch(() => []) : [];
      // Words you look up go in the notebook too (any level).
      if (g && senderTab !== undefined && msg.time !== undefined) {
        // Not a new screenshot (paused video: control bar and this card showing) but the line's clean frame.
        const frame = recentFrames.get(senderTab)?.find((f) => f.line === msg.text && Math.abs(f.time - msg.time!) < 0.05);
        void noteWords(senderTab, msg.text, msg.time, [g], 'click', sender.tab?.url, [], frame?.shot ?? null).catch(() => {});
      }
      return m && { ...m, entries: m.entries.slice(0, 4), ...(episode.length ? { episode } : {}) };
    }
    case 'notebook-line': {
      // Not from the minimized helper copy: don't even split its lines.
      if (senderTab === undefined || (await prepOf(senderTab))) return null;
      // A clean frame of every line (bar hidden), kept for a moment: words you click on it later reuse it.
      const shot = msg.clean !== false ? await screenshot(senderTab).catch(() => null) : null;
      rememberFrame(senderTab, msg.text, msg.time, shot);
      const logAbove = ((await browser.storage.local.get(LOG_ABOVE_KEY))[LOG_ABOVE_KEY] as number | undefined) ?? DEFAULT_LOG_ABOVE;
      const groups = logAbove ? await wordsIn(msg.text) : null;
      if (!groups) return null;
      const tokens = await dictionary.tokensFor(groups);
      const hard = groups.filter((g) => tokens.some((t) => t.start === g.start && isMarked(t, msg.text, logAbove)));
      // Grammar patterns above your level too (N2 patterns when logging harder than N3).
      const grammar = (await grammarIn(msg.text)).filter((m) => m.point.level < logAbove);
      if (hard.length || grammar.length) {
        await noteWords(senderTab, msg.text, msg.time, hard, 'auto', sender.tab?.url, grammar, shot).catch(() => {});
      }
      return null;
    }
    case 'video-rect':
      if (senderTab !== undefined && sender.frameId === 0) videoRects.set(senderTab, msg.rect);
      return null;
    case 'open-scene': {
      const tab = await browser.tabs.create({ url: msg.url });
      if (tab.id !== undefined) await session.set({ [seekKey(tab.id)]: { t: msg.time, at: Date.now() } });
      return null;
    }
    case 'take-seek': {
      if (senderTab === undefined) return null;
      const pending = (await session.get(seekKey(senderTab)))[seekKey(senderTab)] as { t: number; at: number } | undefined;
      if (!pending) return null;
      await session.remove(seekKey(senderTab));
      return Date.now() - pending.at < SEEK_WAIT_MS ? pending.t : null;
    }
    case 'notebook-count':
      return countEntries().catch(() => 0);
    case 'reveal': {
      if (senderTab !== undefined) {
        await browser.tabs.sendMessage(senderTab, { type: 'reveal', on: msg.on } satisfies AutoSyncMessage).catch(() => {});
      }
      return null;
    }
    case 'save-line': {
      if (senderTab !== undefined) {
        await browser.tabs.sendMessage(senderTab, { type: 'save-line' } satisfies AutoSyncMessage).catch(() => {});
      }
      return null;
    }
    case 'save-card': {
      if (senderTab === undefined) return null;
      const s = await session.get([titleKey(senderTab), tabKey(senderTab)]);
      const title = (s[titleKey(senderTab)] as string | undefined)?.trim();
      const source = title || (s[tabKey(senderTab)] as SubsState | undefined)?.fileName || 'unknown';
      const card: SavedCard = { ...msg.card, id: crypto.randomUUID(), source, savedAt: new Date().toISOString() };
      saveQueue = saveQueue.then(async () => {
        const list = ((await browser.storage.local.get(SAVED_CARDS_KEY))[SAVED_CARDS_KEY] as SavedCard[] | undefined) ?? [];
        await browser.storage.local.set({ [SAVED_CARDS_KEY]: [...list, card] });
      });
      await saveQueue;
      return { ok: true, count: 1 };
    }
    case 'page-track': {
      if (senderTab === undefined || (await prepOf(senderTab))) return null;
      await usePageTrack(senderTab, msg.label, msg.cues);
      return null;
    }
    case 'replay-line': {
      if (senderTab !== undefined) {
        await browser.tabs.sendMessage(senderTab, { type: 'replay-line' } satisfies AutoSyncMessage).catch(() => {});
      }
      return null;
    }
    case 'compare-start': {
      if (!fromExtensionPage(sender)) return null;
      await startCompare(msg.tabId);
      return null;
    }
    case 'compare-stop': {
      if (!fromExtensionPage(sender)) return null;
      await stopCompare(msg.tabId);
      return null;
    }
    case 'viewer-seeked': {
      const found = senderTab === undefined ? undefined : await prepForViewer(senderTab);
      if (found) await browser.tabs.sendMessage(found[0], { type: 'prep-seek', t: msg.t } satisfies AutoSyncMessage).catch(() => {});
      return null;
    }
    case 'prep-stop': {
      if (!fromExtensionPage(sender)) return null;
      await stopPrep(msg.tabId, true);
      return null;
    }
    case 'auto-sync-result': {
      if (!fromExtensionPage(sender)) return null;
      await finishAutoSync(msg);
      return null;
    }
    case 'sync-result': {
      if (!fromExtensionPage(sender)) return null;
      await finishSync(msg);
      return null;
    }
    case 'retry-auto': {
      if (!fromExtensionPage(sender)) return null;
      void maybeAutoLoad(msg.tabId, true);
      return null;
    }
    default:
      return null;
  }
}

/** Toolbar icon for one tab: JP file · AI transcription · … working · ! needs you. */
async function updateBadge(tabId: number): Promise<void> {
  if (await prepOf(tabId)) return; // the minimized copy: nobody looks at its toolbar
  const s = await session.get([tabKey(tabId), autoKey(tabId)]);
  const enabled = (await browser.storage.local.get(ENABLED_KEY))[ENABLED_KEY] !== false;
  const badge = badgeFor({
    enabled,
    subs: s[tabKey(tabId)] as SubsState | undefined,
    auto: s[autoKey(tabId)] as AutoStatus | undefined,
    preparing: (await prepForViewer(tabId)) !== undefined,
  });
  await browser.action.setBadgeText({ tabId, text: badge.text }).catch(() => {}); // tab may be gone
  await browser.action.setBadgeBackgroundColor({ tabId, color: badge.color }).catch(() => {});
  await browser.action.setTitle({ tabId, title: badge.title }).catch(() => {});
}

export default defineBackground(() => {
  // Badge follows the tab's state.
  browser.storage.onChanged.addListener((changes, area) => {
    const tabs = new Set<number>();
    if (area === 'session') {
      for (const key of Object.keys(changes)) {
        const m = /^(?:tab|auto):(\d+)$/.exec(key);
        if (m) tabs.add(Number(m[1]));
      }
      const preps = changes[PREP_KEY];
      for (const v of [preps?.oldValue, preps?.newValue] as (Record<string, Prep> | undefined)[]) {
        for (const p of Object.values(v ?? {})) tabs.add(p.viewer);
      }
    }
    if (area === 'local' && changes[ENABLED_KEY]) {
      void session.get(null).then((all) => {
        for (const key of Object.keys(all)) {
          const m = /^(?:tab|auto):(\d+)$/.exec(key);
          if (m) void updateBadge(Number(m[1]));
        }
      });
    }
    for (const t of tabs) void updateBadge(t);
  });
  browser.runtime.onMessage.addListener((msg: ExtRequest | SyncMessage | AutoSyncMessage, sender, sendResponse) => {
    // Answer only our own requests; other listeners (offscreen page) answer theirs.
    if (!HANDLED.has(msg?.type)) return false;
    handle(msg, sender).then(sendResponse, (e: unknown) => sendResponse({ ok: false, error: String(e) }));
    return true; // keep the channel open for the async response
  });
  // A new page load re-detects the episode; the video flag and loaded subs stay
  // (a player iframe reports its video only once, even when an SPA changes episode).
  browser.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'loading') void session.remove([pageKey(tabId), titleKey(tabId), pageTrackKey(tabId)]);
  });
  // Learn your usual correction: a manual offset change on a file auto-sync already handled.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [key, change] of Object.entries(changes)) {
      if (!key.startsWith('offset:') || typeof change.newValue !== 'number') continue;
      const fileKey = key.slice('offset:'.length);
      if (changes[syncedKey(fileKey)]) continue; // this write *is* the auto-sync
      void (biasQueue = biasQueue.then(async () => {
        const s = await browser.storage.local.get([syncedKey(fileKey), syncedShowKey(fileKey), BIAS_LOG_KEY]);
        const found = s[syncedKey(fileKey)];
        if (typeof found !== 'number') return;
        const show = s[syncedShowKey(fileKey)] as number | undefined;
        const d = roundOffset((change.newValue as number) - found);
        const log = recordCorrection((s[BIAS_LOG_KEY] ?? {}) as BiasLog, fileKey, show, d, Date.now());
        await browser.storage.local.set({ [BIAS_LOG_KEY]: log });
      }).catch(() => {}));
    }
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    recentFrames.delete(tabId);
    videoRects.delete(tabId);
    void session.remove([tabKey(tabId), pageKey(tabId), videoKey(tabId), autoKey(tabId), titleKey(tabId), urlKey(tabId)]);
    void (async () => {
      const prep = await prepOf(tabId);
      if (prep) await stopPrep(prep.viewer, true); // you closed the minimized copy
      else await stopPrep(tabId, false); // you closed the episode: close its copy too
    })();
  });
});
