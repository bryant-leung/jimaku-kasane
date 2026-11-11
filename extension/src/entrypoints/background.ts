import { browser, type Browser } from 'wxt/browser';
import { fetchHttp, resolveSubs, type Franchise } from '@/lib/autosubs';
import { MIN_CONFIDENCE } from '@/lib/sync';
import type { Cue } from '@/lib/cue';
import { episodeKey, type EpisodeInfo } from '@/lib/episode';
import {
  JIMAKU_KEY,
  NOT_FOUND_RETRY_MS,
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
  SYNC_BIAS_KEY,
  type AutoSyncMessage,
  type SyncMessage,
  type SyncStatus,
  type AutoStatus,
  type ExtRequest,
  type LoadResult,
  type SubsState,
  type SubsUpdated,
} from '@/lib/subs';

// storage.session: survives SW restarts and page reloads, cleared when the browser quits.
const session = browser.storage.session;
const tabKey = (tabId: number) => `tab:${tabId}`;
const pageKey = (tabId: number) => `page:${tabId}`;
const videoKey = (tabId: number) => `video:${tabId}`;
const titleKey = (tabId: number) => `title:${tabId}`;

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

async function setSubs(
  tabId: number,
  fileName: string,
  cues: Cue[],
  auto?: { episodeKey: string; anilistId?: number; live?: boolean },
): Promise<SubsState> {
  const state: SubsState = { fileName, fileKey: fileKeyFor(fileName, cues), cues, ...auto };
  await session.set({ [tabKey(tabId)]: state });
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
  // Already transcribing this episode (e.g. "Check Jimaku again" pressed): keep its lines.
  const current = (await session.get(tabKey(tabId)))[tabKey(tabId)] as SubsState | undefined;
  if (current?.live && current.episodeKey === episodeKey) {
    await status({ state: 'not-found', message: liveMessage });
    return;
  }
  const state = await setSubs(tabId, `Live transcription: ${info.title} ep ${info.episode}`, [], {
    episodeKey,
    anilistId,
    live: true,
  });
  await ensureOffscreen();
  await browser.runtime.sendMessage({
    type: 'live-begin',
    tabId,
    fileKey: state.fileKey,
    anilistId,
    title: info.title,
  } satisfies AutoSyncMessage);
  await browser.tabs
    .sendMessage(tabId, { type: 'auto-listen-start', tabId, fileKey: state.fileKey } satisfies AutoSyncMessage)
    .catch(() => {});
  await status({ state: 'not-found', message: liveMessage });
}

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
  const s = await session.get([pageKey(tabId), videoKey(tabId), autoKey(tabId), titleKey(tabId)]);
  if (!s[videoKey(tabId)]) return;
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

/** Listens while the user watches and fixes the offset without a click; once per subtitle file. */
async function maybeAutoSync(tabId: number): Promise<void> {
  const state = (await session.get(tabKey(tabId)))[tabKey(tabId)] as SubsState | undefined;
  // Live transcription is timed from the audio itself: nothing to sync.
  if (!state || state.live || autoSessions.get(tabId) === state.fileKey) return;
  if ((await browser.storage.local.get(syncedKey(state.fileKey)))[syncedKey(state.fileKey)] !== undefined) return;
  await ensureOffscreen();
  autoSessions.set(tabId, state.fileKey);
  const showKey = state.anilistId !== undefined ? showOffsetKey(state.anilistId) : undefined;
  const stored = await browser.storage.local.get([...(showKey ? [showKey] : []), SYNC_BIAS_KEY]);
  const bias = (stored[SYNC_BIAS_KEY] as number | undefined) ?? 0;
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

async function finishAutoSync(msg: Extract<AutoSyncMessage, { type: 'auto-sync-result' }>): Promise<void> {
  if (autoSessions.get(msg.tabId) === msg.fileKey) autoSessions.delete(msg.tabId);
  await browser.tabs.sendMessage(msg.tabId, { type: 'auto-listen-stop', tabId: msg.tabId } satisfies AutoSyncMessage).catch(() => {});
  const state = (await session.get(tabKey(msg.tabId)))[tabKey(msg.tabId)] as SubsState | undefined;
  if (!state || state.fileKey !== msg.fileKey) return; // subtitles changed meanwhile
  const key = offsetKey(state.fileKey);
  const current = ((await browser.storage.local.get(key))[key] as number | undefined) ?? 0;
  const found = msg.result.offset;
  if (found !== null) {
    const bias = ((await browser.storage.local.get(SYNC_BIAS_KEY))[SYNC_BIAS_KEY] as number | undefined) ?? 0;
    const offset = roundOffset(found + bias);
    // synced:<file> keeps the raw speech offset, so later manual changes reveal your preference.
    await browser.storage.local.set({ ...offsetWrites(state, offset), [syncedKey(state.fileKey)]: found });
    const yours = bias ? ` (includes your ${formatOffset(bias)} adjustment)` : '';
    const message =
      Math.abs(offset - current) < 0.15
        ? `Auto-sync: timing already matches (offset ${formatOffset(offset)})${yours}`
        : `Auto-synced: offset ${formatOffset(offset)}${yours}`;
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
          body: JSON.stringify({ anilist_id: msg.anilistId ?? null, title: msg.title, start: msg.start, audio: msg.audio }),
        });
        if (!res.ok) return null;
        cues = ((await res.json()) as { cues: Cue[] }).cues;
      } catch {
        return null; // server stopped mid-episode: drop this line, keep going
      }
      const state = (await session.get(tabKey(msg.tabId)))[tabKey(msg.tabId)] as SubsState | undefined;
      if (!cues.length || !state?.live || state.fileKey !== msg.fileKey) return null;
      state.cues = [...state.cues, ...cues].sort((a, b) => a.start - b.start);
      await session.set({ [tabKey(msg.tabId)]: state });
      await browser.tabs
        .sendMessage(msg.tabId, { type: 'subs-append', fileKey: msg.fileKey, cues } satisfies AutoSyncMessage)
        .catch(() => {});
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

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg: ExtRequest | SyncMessage | AutoSyncMessage, sender, sendResponse) => {
    // Answer only our own requests; other listeners (offscreen page) answer theirs.
    if (!HANDLED.has(msg?.type)) return false;
    handle(msg, sender).then(sendResponse, (e: unknown) => sendResponse({ ok: false, error: String(e) }));
    return true; // keep the channel open for the async response
  });
  // A new page load re-detects the episode; the video flag and loaded subs stay
  // (a player iframe reports its video only once, even when an SPA changes episode).
  browser.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'loading') void session.remove([pageKey(tabId), titleKey(tabId)]);
  });
  // Learn your usual correction: a manual offset change on a file auto-sync already handled.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [key, change] of Object.entries(changes)) {
      if (!key.startsWith('offset:') || typeof change.newValue !== 'number') continue;
      const fileKey = key.slice('offset:'.length);
      if (changes[syncedKey(fileKey)]) continue; // this write *is* the auto-sync
      void browser.storage.local.get(syncedKey(fileKey)).then((s) => {
        const found = s[syncedKey(fileKey)];
        if (typeof found === 'number') {
          void browser.storage.local.set({ [SYNC_BIAS_KEY]: roundOffset(change.newValue as number - found) });
        }
      });
    }
  });
  browser.tabs.onRemoved.addListener(
    (tabId) => void session.remove([tabKey(tabId), pageKey(tabId), videoKey(tabId), autoKey(tabId), titleKey(tabId)]),
  );
});
