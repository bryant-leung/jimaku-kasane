import { browser, type Browser } from 'wxt/browser';
import { fileKeyFor, type ExtRequest, type LoadResult, type SubsState, type SubsUpdated } from '@/lib/subs';

const tabKey = (tabId: number) => `tab:${tabId}`;

/** Only extension pages (the popup) may load subtitles, not content scripts. */
const fromExtensionPage = (sender: Browser.runtime.MessageSender) =>
  sender.url?.startsWith(browser.runtime.getURL('/')) ?? false;

async function handle(msg: ExtRequest, sender: Browser.runtime.MessageSender): Promise<unknown> {
  switch (msg.type) {
    case 'load-subs': {
      if (!fromExtensionPage(sender)) return { ok: false, error: 'Not allowed' } satisfies LoadResult;
      const state: SubsState = { fileName: msg.fileName, fileKey: fileKeyFor(msg.fileName, msg.cues), cues: msg.cues };
      // storage.session survives service worker restarts and page reloads, cleared when the browser closes.
      await browser.storage.session.set({ [tabKey(msg.tabId)]: state });
      // Reaches every frame in the tab, including cross-origin player iframes.
      await browser.tabs
        .sendMessage(msg.tabId, { type: 'subs-updated', state } satisfies SubsUpdated)
        .catch(() => {}); // no content script yet; frames fetch state when they start
      return { ok: true, count: state.cues.length, fileKey: state.fileKey } satisfies LoadResult;
    }
    case 'get-subs': {
      const tabId = msg.tabId ?? sender.tab?.id;
      if (tabId === undefined) return null;
      const key = tabKey(tabId);
      const stored = await browser.storage.session.get(key);
      return (stored[key] as SubsState | undefined) ?? null;
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
  browser.tabs.onRemoved.addListener((tabId) => void browser.storage.session.remove(tabKey(tabId)));
});
