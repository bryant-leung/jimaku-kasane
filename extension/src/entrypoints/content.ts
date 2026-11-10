import { browser } from 'wxt/browser';
import { Overlay } from '@/lib/overlay';
import { formatOffset, offsetKey, roundOffset, type ExtRequest, type SubsState, type SubsUpdated } from '@/lib/subs';

/** The frame's main video: the largest one that is actually on screen. */
function pickVideo(): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null;
  let bestArea = 0;
  for (const v of document.querySelectorAll('video')) {
    const r = v.getBoundingClientRect();
    const area = r.width * r.height;
    if (area > bestArea) {
      best = v;
      bestArea = area;
    }
  }
  return best;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Hotkeys by physical key: [ ] ±0.1 s, Shift+[ ] ±1 s, \ resets. */
function hotkeyDelta(e: KeyboardEvent): number | 'reset' | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return null;
  const step = e.shiftKey ? 1 : 0.1;
  if (e.code === 'BracketRight') return step;
  if (e.code === 'BracketLeft') return -step;
  if (e.code === 'Backslash' && !e.shiftKey) return 'reset';
  return null;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    const overlay = new Overlay();
    let state: SubsState | null = null;
    let offset = 0;

    // --- video detection ---
    const watched = new WeakSet<HTMLVideoElement>();
    let scanQueued = false;
    const watchSizes = new ResizeObserver(() => queueScan());
    const scan = () => {
      scanQueued = false;
      for (const v of document.querySelectorAll('video')) {
        if (!watched.has(v)) {
          watched.add(v);
          watchSizes.observe(v);
        }
      }
      overlay.attach(pickVideo());
    };
    const queueScan = () => {
      if (scanQueued) return;
      scanQueued = true;
      requestAnimationFrame(scan);
    };
    scan();
    new MutationObserver(queueScan).observe(document.documentElement, { childList: true, subtree: true });

    // --- subtitles + offset ---
    const applyState = async (next: SubsState | null) => {
      state = next;
      overlay.setCues(state?.cues ?? null);
      offset = 0;
      if (state) {
        const key = offsetKey(state.fileKey);
        const stored = await browser.storage.local.get(key);
        offset = typeof stored[key] === 'number' ? stored[key] : 0;
      }
      overlay.setOffset(offset);
    };

    browser.runtime.onMessage.addListener((msg: SubsUpdated) => {
      if (msg?.type === 'subs-updated') void applyState(msg.state);
    });
    void browser.runtime
      .sendMessage({ type: 'get-subs' } satisfies ExtRequest)
      .then((s: SubsState | null) => applyState(s))
      .catch(() => {}); // extension reloaded or context gone

    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !state) return;
      const change = changes[offsetKey(state.fileKey)];
      if (!change) return;
      offset = typeof change.newValue === 'number' ? change.newValue : 0;
      overlay.setOffset(offset, `Offset ${formatOffset(offset)}`);
    });

    window.addEventListener(
      'keydown',
      (e) => {
        if (!state || isEditable(e.target)) return;
        const delta = hotkeyDelta(e);
        if (delta === null) return;
        e.preventDefault();
        e.stopPropagation();
        const next = delta === 'reset' ? 0 : roundOffset(offset + delta);
        offset = next;
        // Every frame (incl. this one) picks the change up via storage.onChanged.
        void browser.storage.local.set({ [offsetKey(state.fileKey)]: next });
      },
      { capture: true },
    );
  },
});
