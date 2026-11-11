import { browser } from 'wxt/browser';
import { parseEpisodeTitle } from '@/lib/episode';
import { Overlay } from '@/lib/overlay';
import {
  formatOffset,
  offsetKey,
  offsetWrites,
  roundOffset,
  type ExtRequest,
  type SubsState,
  type SubsUpdated,
  type SyncMessage,
  type AudioFrame,
  type AutoSyncMessage,
} from '@/lib/subs';

const VAD_RATE = 16000;
const VAD_FRAME = 512;

/**
 * Streams the video's own audio (no tab-capture permission needed) as 16 kHz frames tagged with
 * video time. Returns a stop function, or null if this browser can't capture the element.
 */
function captureVideoAudio(
  video: HTMLVideoElement,
  onFrames: (frames: AudioFrame[]) => void,
  onError: (error: string) => void,
): (() => void) | null {
  const capture = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream;
  if (!capture) return null;
  let ctx: AudioContext | null = null;
  let pending: AudioFrame[] = [];
  const frame = new Float32Array(VAD_FRAME);
  let n = 0;

  const begin = () => {
    try {
      start();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  const start = () => {
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume(); // autoplay policy: resume on the next play
      return;
    }
    const stream = capture.call(video);
    if (stream.getAudioTracks().length === 0) {
      stream.addEventListener('addtrack', begin, { once: true });
      return;
    }
    ctx = new AudioContext({ sampleRate: VAD_RATE });
    const source = ctx.createMediaStreamSource(stream);
    // ScriptProcessor (not AudioWorklet): page CSPs can block extension worklet modules.
    const proc = ctx.createScriptProcessor(1024, 1, 1);
    source.connect(proc);
    proc.connect(ctx.destination); // output stays silent; connecting keeps it running
    proc.onaudioprocess = (e) => {
      if (video.paused || video.seeking) {
        n = 0;
        return;
      }
      const data = e.inputBuffer.getChannelData(0);
      const now = video.currentTime;
      const rate = video.playbackRate || 1;
      for (let i = 0; i < data.length; i++) {
        frame[n++] = data[i]!;
        if (n === VAD_FRAME) {
          const after = (data.length - 1 - i) / VAD_RATE; // audio already played past this frame
          const t = now - (after + VAD_FRAME / VAD_RATE / 2) * rate;
          pending.push({ t, pcm: Array.from(frame, (x) => Math.round(Math.max(-1, Math.min(1, x)) * 32767)) });
          n = 0;
        }
      }
    };
  };
  let sent = 0;
  let playedSince = video.paused ? 0 : Date.now();
  video.addEventListener('playing', () => (playedSince ||= Date.now()));
  const flush = setInterval(() => {
    if (pending.length) {
      sent += pending.length;
      onFrames(pending);
    }
    pending = [];
    // Playing for a while but no audio frames at all: the player gives us nothing to hear.
    if (!sent && playedSince && !video.paused && Date.now() - playedSince > 12_000) {
      onError(ctx ? `no audio (${ctx.state})` : 'no audio track on the video');
      playedSince = 0;
    }
  }, 1000);
  if (!video.paused) begin();
  video.addEventListener('play', begin);
  return () => {
    clearInterval(flush);
    video.removeEventListener('play', begin);
    void ctx?.close();
  };
}

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

    const send = (msg: ExtRequest) => void browser.runtime.sendMessage(msg).catch(() => {});

    // --- episode detection (top frame only; reads document.title, no site selectors) ---
    let lastTitle: string | null = null;
    const checkTitle = () => {
      if (window !== window.top || document.title === lastTitle) return;
      lastTitle = document.title;
      const info = parseEpisodeTitle(document.title);
      send({ type: 'page-episode', info, title: document.title });
    };
    let videoReported = false;

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
      if (overlay.attachedVideo && !videoReported) {
        videoReported = true;
        send({ type: 'video-found' });
      }
      checkTitle(); // title changes are childList mutations too
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

    // Audio auto-sync: the frame playing the video reports its clock for the offscreen analyser.
    let timeReporter: ReturnType<typeof setInterval> | undefined;
    // Tells this video's clock apart from other frames'. (crypto.randomUUID needs https; pages may be http.)
    const source = Math.random().toString(36).slice(2);
    const stopReporting = () => clearInterval(timeReporter);

    let stopAutoCapture: (() => void) | null = null;
    let listeningFor: string | null = null;

    browser.runtime.onMessage.addListener((msg: SubsUpdated | SyncMessage | AutoSyncMessage) => {
      if (msg?.type === 'subs-updated') void applyState(msg.state);
      if (msg?.type === 'auto-listen-stop' || (msg?.type === 'auto-listen-start' && msg.fileKey !== listeningFor)) {
        stopAutoCapture?.();
        stopAutoCapture = null;
        listeningFor = null;
      }
      if (msg?.type === 'auto-listen-start' && overlay.attachedVideo && !stopAutoCapture) {
        const { tabId, fileKey } = msg;
        listeningFor = fileKey;
        stopAutoCapture = captureVideoAudio(
          overlay.attachedVideo,
          (frames) =>
            void browser.runtime
              .sendMessage({ type: 'auto-audio', tabId, fileKey, frames } satisfies AutoSyncMessage)
              .catch(() => {}),
          (error) =>
            void browser.runtime
              .sendMessage({ type: 'auto-audio-error', tabId, fileKey, error } satisfies AutoSyncMessage)
              .catch(() => {}),
        );
        if (!stopAutoCapture) {
          void browser.runtime
            .sendMessage({ type: 'auto-audio-error', tabId, fileKey, error: 'captureStream unavailable' } satisfies AutoSyncMessage)
            .catch(() => {});
        }
      }
      if (msg?.type === 'sync-time-stop') stopReporting();
      if (msg?.type === 'sync-time-start' && overlay.attachedVideo) {
        stopReporting();
        const until = Date.now() + msg.seconds * 1000;
        timeReporter = setInterval(() => {
          const v = overlay.attachedVideo;
          if (!v || Date.now() > until) return stopReporting();
          const r = v.getBoundingClientRect();
          const sample = {
            at: Date.now(),
            t: v.currentTime,
            playing: !v.paused,
            rate: v.playbackRate,
            source,
            area: Math.round(r.width * r.height),
            muted: v.muted || v.volume === 0,
          };
          void browser.runtime.sendMessage({ type: 'sync-time', tabId: msg.tabId, sample } satisfies SyncMessage).catch(() => {});
        }, 200);
      }
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
        void browser.storage.local.set(offsetWrites(state, next));
      },
      { capture: true },
    );
  },
});
