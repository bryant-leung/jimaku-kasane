import { browser } from 'wxt/browser';
import type { Cue } from '@/lib/cue';
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
  DISABLED_SITES_KEY,
  ENABLED_KEY,
  topHostname,
} from '@/lib/subs';

const VAD_RATE = 16000;
const FRAMES_PER_SEND = 31; // ~1 s of audio
/** The background copy plays this much faster than you, so it stays ahead. */
const PREP_RATE = 1.5;
/** Live transcription: how long a newly arrived line stays up, and how many show at once. */
const LIVE_HOLD_S = 3;
const LIVE_DRAFT_HOLD_S = 1.5;
const LIVE_MAX_LINES = 2;
const VAD_FRAME = 512;

/** Box-filter resampler to 16 kHz, streaming across chunks (input is usually 44.1 or 48 kHz). */
function makeResampler(): (input: Float32Array, rate: number) => Float32Array {
  let carry = new Float32Array(0);
  let pos = 0;
  return (input, rate) => {
    const step = rate / VAD_RATE;
    const buf = new Float32Array(carry.length + input.length);
    buf.set(carry);
    buf.set(input, carry.length);
    const out: number[] = [];
    while (pos + step <= buf.length) {
      const a = Math.floor(pos);
      const b = Math.max(a + 1, Math.floor(pos + step));
      let sum = 0;
      for (let k = a; k < b; k++) sum += buf[k]!;
      out.push(sum / (b - a));
      pos += step;
    }
    const keep = Math.floor(pos);
    carry = buf.slice(keep);
    pos -= keep;
    return Float32Array.from(out);
  };
}

/**
 * Streams the video's own audio (no tab-capture permission needed) as 16 kHz frames tagged with
 * video time. Uses MediaStreamTrackProcessor where available: unlike an AudioContext it needs no
 * click in the tab, so it also works in the background copy. Returns a stop function, or null if
 * this browser can't capture the element.
 */
function captureVideoAudio(
  video: HTMLVideoElement,
  onFrames: (frames: AudioFrame[]) => void,
  onError: (error: string) => void,
): (() => void) | null {
  const capture = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream;
  if (!capture) return null;
  let pending: AudioFrame[] = [];
  let sent = 0;
  const frame = new Float32Array(VAD_FRAME);
  let n = 0;
  let started = false;
  let stopSource: () => void = () => {};

  /** Adds 16 kHz samples that end "now" in video time. */
  const push = (samples: Float32Array) => {
    if (video.paused || video.seeking) {
      n = 0;
      return;
    }
    const now = video.currentTime;
    const rate = video.playbackRate || 1;
    for (let i = 0; i < samples.length; i++) {
      frame[n++] = samples[i]!;
      if (n === VAD_FRAME) {
        const after = (samples.length - 1 - i) / VAD_RATE; // audio already played past this frame
        const t = now - (after + VAD_FRAME / VAD_RATE / 2) * rate;
        pending.push({ t, pcm: Array.from(frame, (x) => Math.round(Math.max(-1, Math.min(1, x)) * 32767)) });
        n = 0;
      }
    }
    // Sent as audio arrives, not on a timer: hidden windows throttle timers to once a minute.
    if (pending.length >= FRAMES_PER_SEND) {
      sent += pending.length;
      onFrames(pending);
      pending = [];
    }
  };

  const fromProcessor = (track: MediaStreamTrack): boolean => {
    type Reader = ReadableStreamDefaultReader<AudioData>;
    const Processor = (globalThis as unknown as {
      MediaStreamTrackProcessor?: new (o: { track: MediaStreamTrack }) => { readable: ReadableStream<AudioData> };
    }).MediaStreamTrackProcessor;
    if (!Processor) return false;
    const reader: Reader = new Processor({ track }).readable.getReader();
    const resample = makeResampler();
    let stopped = false;
    void (async () => {
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done || !value) break;
        const mono = new Float32Array(value.numberOfFrames);
        value.copyTo(mono, { planeIndex: 0, format: 'f32-planar' });
        const rate = value.sampleRate;
        value.close();
        push(resample(mono, rate));
      }
    })().catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));
    stopSource = () => {
      stopped = true;
      void reader.cancel().catch(() => {});
    };
    return true;
  };

  const fromAudioContext = (stream: MediaStream) => {
    // Fallback (older browsers). Note: an AudioContext only runs after a click in the tab.
    const ctx = new AudioContext({ sampleRate: VAD_RATE });
    const source = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(1024, 1, 1);
    source.connect(proc);
    proc.connect(ctx.destination); // output stays silent; connecting keeps it running
    proc.onaudioprocess = (e) => push(Float32Array.from(e.inputBuffer.getChannelData(0)));
    video.addEventListener('play', () => void ctx.resume());
    stopSource = () => void ctx.close();
  };

  const begin = () => {
    if (started) return;
    try {
      const stream = capture.call(video);
      const track = stream.getAudioTracks()[0];
      if (!track) {
        stream.addEventListener('addtrack', begin, { once: true });
        return;
      }
      started = true;
      if (!fromProcessor(track)) fromAudioContext(stream);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  let playedSince = video.paused ? 0 : Date.now();
  video.addEventListener('playing', () => (playedSince ||= Date.now()));
  const check = setInterval(() => {
    // Playing for a while but no audio frames at all: the player gives us nothing to hear.
    if (!sent && !pending.length && playedSince && !video.paused && Date.now() - playedSince > 12_000) {
      onError(started ? 'no audio from the video' : 'no audio track on the video');
      playedSince = 0;
    }
  }, 1000);
  if (!video.paused) begin();
  video.addEventListener('play', begin);
  return () => {
    clearInterval(check);
    video.removeEventListener('play', begin);
    stopSource();
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
  async main() {
    // Off switch: everything, or this site. Checked before doing anything on the page.
    const host = topHostname();
    const isActive = (s: Record<string, unknown>) =>
      s[ENABLED_KEY] !== false && !((s[DISABLED_SITES_KEY] as string[] | undefined) ?? []).includes(host);
    let active = isActive(await browser.storage.local.get([ENABLED_KEY, DISABLED_SITES_KEY]));

    const overlay = new Overlay();

    // After the extension is reloaded or updated, this copy is cut off: it can't sync, take
    // hotkeys or talk to the popup. Remove its overlay instead of leaving stale subtitles.
    const orphanCheck = setInterval(() => {
      if (browser.runtime?.id) return;
      clearInterval(orphanCheck);
      stopAutoCapture?.();
      overlay.attach(null);
      observer.disconnect();
    }, 2000);
    let state: SubsState | null = null;
    let offset = 0;

    const send = (msg: ExtRequest) => void browser.runtime.sendMessage(msg).catch(() => {});

    // --- episode detection (top frame only; reads document.title, no site selectors) ---
    let lastTitle: string | null = null;
    const checkTitle = () => {
      if (!active || window !== window.top || document.title === lastTitle) return;
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
      if (!active) return overlay.attach(null);
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
    const observer = new MutationObserver(() => {
      if (browser.runtime?.id) queueScan();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // --- subtitles + offset ---
    const applyState = async (next: SubsState | null) => {
      state = next;
      overlay.setCues(state?.cues ?? null, state?.live ? LIVE_MAX_LINES : undefined);
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
    /** Live transcription: the line being spoken, and the first segment not yet finished. */
    let draft: { segId: number; cues: Cue[] } | null = null;
    let finishedSeg = 0;

    browser.runtime.onMessage.addListener((msg: SubsUpdated | SyncMessage | AutoSyncMessage, _sender, sendResponse) => {
      if (msg?.type === 'subs-updated') void applyState(msg.state);
      if (msg?.type === 'subs-append' && msg.prepared && state?.fileKey === msg.fileKey) {
        // Prepared ahead: real timing, nothing to adjust.
        state.cues = [...state.cues, ...msg.cues].sort((a, b) => a.start - b.start);
        overlay.setCues(state.cues);
        return;
      }
      if (msg?.type === 'prep-start' && overlay.attachedVideo && !stopAutoCapture) {
        // This tab is the minimized copy: play muted and fast, and send audio for the viewer's tab.
        const v = overlay.attachedVideo;
        const { viewerTabId, fileKey } = msg;
        // Players save mute and speed for the whole site (your tab included). Hide our changes from
        // them: these events are stopped before the page's own listeners run.
        const hide = (e: Event) => {
          if (e.target === v) e.stopImmediatePropagation();
        };
        window.addEventListener('volumechange', hide, true);
        window.addEventListener('ratechange', hide, true);
        v.muted = true;
        v.playbackRate = PREP_RATE;
        // Say what this window is, so nobody tries to watch or pause it.
        const banner = document.createElement('div');
        banner.setAttribute('role', 'note');
        banner.textContent =
          'JP Sub Overlay: helper copy, transcribing ahead of you (muted, fast). ' +
          'Leave it running and watch your original tab; it closes by itself.';
        Object.assign(banner.style, {
          position: 'fixed',
          inset: '0 0 auto 0',
          zIndex: '2147483647',
          padding: '12px 16px',
          font: '600 16px/1.4 system-ui, sans-serif',
          color: '#fff',
          background: 'rgba(20, 20, 20, 0.9)',
          textAlign: 'center',
          pointerEvents: 'none',
        } satisfies Partial<CSSStyleDeclaration>);
        document.documentElement.append(banner);
        const keepGoing = () => {
          if (!v.ended && stopAutoCapture) void v.play().catch(() => {}); // players may pause hidden tabs
          if (v.playbackRate !== PREP_RATE) v.playbackRate = PREP_RATE;
        };
        v.addEventListener('pause', keepGoing);
        // Report whether it's really playing: some players load the video only from their own button.
        for (const delay of [6_000, 20_000]) {
          setTimeout(() => {
            const playing = !v.paused && v.currentTime > 1;
            void browser.runtime
              .sendMessage({ type: 'prep-status', viewerTabId, playing, t: v.currentTime } satisfies AutoSyncMessage)
              .catch(() => {});
          }, delay);
        }
        v.addEventListener('ended', () =>
          void browser.runtime.sendMessage({ type: 'prep-done', viewerTabId } satisfies AutoSyncMessage).catch(() => {}),
        );
        listeningFor = fileKey;
        stopAutoCapture = captureVideoAudio(
          v,
          (frames) =>
            void browser.runtime
              .sendMessage({ type: 'auto-audio', tabId: viewerTabId, fileKey, source, from: 'prep', frames } satisfies AutoSyncMessage)
              .catch(() => {}),
          (error) =>
            void browser.runtime
              .sendMessage({ type: 'auto-audio-error', tabId: viewerTabId, fileKey, error } satisfies AutoSyncMessage)
              .catch(() => {}),
        );
        void v.play().catch(() => {});
      }
      if ((msg?.type === 'subs-append' || msg?.type === 'subs-partial') && state?.fileKey === msg.fileKey) {
        // Live lines arrive after they're spoken: the newest replaces what's on screen and stays
        // up long enough to read. Drafts update every second while a line is being spoken.
        const now = overlay.attachedVideo?.currentTime ?? 0;
        const hold = msg.type === 'subs-partial' ? LIVE_DRAFT_HOLD_S : LIVE_HOLD_S;
        const fresh = msg.cues.map((c) => ({ ...c, start: Math.min(c.start, now), end: Math.max(c.end, now + hold) }));
        state.cues = state.cues.map((c) => (c.end > now ? { ...c, end: now } : c));
        if (msg.type === 'subs-partial') {
          if (msg.segId >= finishedSeg) draft = { segId: msg.segId, cues: fresh };
        } else {
          state.cues = [...state.cues, ...fresh].sort((a, b) => a.start - b.start);
          if (msg.segId !== undefined) finishedSeg = Math.max(finishedSeg, msg.segId + 1);
          if (draft && draft.segId < finishedSeg) draft = null; // its finished line is here
        }
        overlay.setCues([...state.cues, ...(draft?.cues ?? [])].sort((a, b) => a.start - b.start), LIVE_MAX_LINES);
      }
      if ((msg as { type?: string })?.type === 'get-host' && window === window.top) sendResponse(host);
      if (msg?.type === 'auto-listen-stop' || (msg?.type === 'auto-listen-start' && msg.fileKey !== listeningFor)) {
        stopAutoCapture?.();
        stopAutoCapture = null;
        listeningFor = null;
      }
      const audible = (v: HTMLVideoElement) => !v.muted && v.volume > 0;
      if (msg?.type === 'auto-listen-start' && active && overlay.attachedVideo && audible(overlay.attachedVideo) && !stopAutoCapture) {
        const { tabId, fileKey } = msg;
        listeningFor = fileKey;
        stopAutoCapture = captureVideoAudio(
          overlay.attachedVideo,
          (frames) =>
            void browser.runtime
              .sendMessage({ type: 'auto-audio', tabId, fileKey, source, from: 'viewer', frames } satisfies AutoSyncMessage)
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
      if (area === 'local' && (changes[ENABLED_KEY] || changes[DISABLED_SITES_KEY])) {
        void browser.storage.local.get([ENABLED_KEY, DISABLED_SITES_KEY]).then((s) => {
          active = isActive(s);
          if (!active) {
            stopAutoCapture?.();
            stopAutoCapture = null;
          }
          lastTitle = null; // re-report the episode when switched back on
          queueScan();
        });
      }
      if (area !== 'local' || !state) return;
      const change = changes[offsetKey(state.fileKey)];
      if (!change) return;
      offset = typeof change.newValue === 'number' ? change.newValue : 0;
      overlay.setOffset(offset, `Offset ${formatOffset(offset)}`);
    });

    window.addEventListener(
      'keydown',
      (e) => {
        if (!active || !state || isEditable(e.target)) return;
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
