import { browser, type Browser } from 'wxt/browser';
import { fetchHttp, resolveSubs, type Franchise } from '@/lib/autosubs';
import type { Cue } from '@/lib/cue';
import { episodeKey, type EpisodeInfo } from '@/lib/episode';
import {
  JIMAKU_KEY,
  autoKey,
  fileKeyFor,
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

async function setSubs(tabId: number, fileName: string, cues: Cue[], episode?: string): Promise<SubsState> {
  const state: SubsState = { fileName, fileKey: fileKeyFor(fileName, cues), cues, episodeKey: episode };
  await session.set({ [tabKey(tabId)]: state });
  // Reaches every frame in the tab, including cross-origin player iframes.
  await browser.tabs
    .sendMessage(tabId, { type: 'subs-updated', state } satisfies SubsUpdated)
    .catch(() => {}); // no content script yet; frames fetch state when they start
  return state;
}

const inflight = new Map<number, string>();

/** Looks up subtitles once the tab has both an episode title and a video. */
async function maybeAutoLoad(tabId: number, force = false): Promise<void> {
  const s = await session.get([pageKey(tabId), videoKey(tabId), autoKey(tabId)]);
  const info = s[pageKey(tabId)] as EpisodeInfo | undefined;
  if (!info || !s[videoKey(tabId)]) return;
  const key = episodeKey(info);
  const prev = s[autoKey(tabId)] as AutoStatus | undefined;
  if (!force && prev?.key === key && prev.state !== 'error') return;
  if (inflight.get(tabId) === key) return;
  inflight.set(tabId, key);

  const status = (st: Omit<AutoStatus, 'key'>) => session.set({ [autoKey(tabId)]: { key, ...st } satisfies AutoStatus });
  try {
    await status({ state: 'searching', message: `Looking up ${info.title} ep ${info.episode}…` });
    const apiKey = (await browser.storage.local.get(JIMAKU_KEY))[JIMAKU_KEY] as string | undefined;
    const res = await resolveSubs(fetchHttp, apiKey, info, franchiseCache);

    const now = (await session.get(pageKey(tabId)))[pageKey(tabId)] as EpisodeInfo | undefined;
    if (!now || episodeKey(now) !== key) return; // navigated away meanwhile
    if (res.ok) {
      await setSubs(tabId, res.fileName, res.cues, key);
      await status({ state: 'loaded', message: `Loaded ${res.show} from Jimaku` });
    } else {
      await status({ state: res.state, message: res.message });
    }
  } finally {
    if (inflight.get(tabId) === key) inflight.delete(tabId);
  }
}

async function handle(msg: ExtRequest, sender: Browser.runtime.MessageSender): Promise<unknown> {
  const senderTab = sender.tab?.id;
  switch (msg.type) {
    case 'load-subs': {
      if (!fromExtensionPage(sender)) return { ok: false, error: 'Not allowed' } satisfies LoadResult;
      const state = await setSubs(msg.tabId, msg.fileName, msg.cues);
      return { ok: true, count: state.cues.length, fileKey: state.fileKey } satisfies LoadResult;
    }
    case 'get-subs': {
      const tabId = msg.tabId ?? senderTab;
      if (tabId === undefined) return null;
      return ((await session.get(tabKey(tabId)))[tabKey(tabId)] as SubsState | undefined) ?? null;
    }
    case 'page-episode': {
      if (senderTab === undefined || sender.frameId !== 0) return null;
      await session.set({ [pageKey(senderTab)]: msg.info });
      void maybeAutoLoad(senderTab);
      return null;
    }
    case 'video-found': {
      if (senderTab === undefined) return null;
      await session.set({ [videoKey(senderTab)]: true });
      void maybeAutoLoad(senderTab);
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
  browser.runtime.onMessage.addListener((msg: ExtRequest, sender, sendResponse) => {
    handle(msg, sender).then(sendResponse, (e: unknown) => sendResponse({ ok: false, error: String(e) }));
    return true; // keep the channel open for the async response
  });
  // A new page load re-detects the episode; the video flag and loaded subs stay
  // (a player iframe reports its video only once, even when an SPA changes episode).
  browser.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'loading') void session.remove(pageKey(tabId));
  });
  browser.tabs.onRemoved.addListener(
    (tabId) => void session.remove([tabKey(tabId), pageKey(tabId), videoKey(tabId), autoKey(tabId)]),
  );
});
