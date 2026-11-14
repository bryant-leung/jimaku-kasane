import { SHOT_WIDTH } from '@/lib/notebook';
import { browser } from 'wxt/browser';
import { currentCue, replayTarget, type Cue } from '@/lib/cue';
import { parseEpisodeTitle } from '@/lib/episode';
import { Overlay, type WordTools } from '@/lib/overlay';
import type { Token, WordMatch } from '@/lib/dict';
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
  MARK_ABOVE_KEY,
  STUDY_MODE_KEY,
  LISTEN_MODE_KEY,
  SUB_STYLE_KEY,
  DEFAULT_SUB_STYLE,
  type SubStyle,
  DEFAULT_MARK_ABOVE,
  topHostname,
} from '@/lib/subs';

const VAD_RATE = 16000;
const FRAMES_PER_SEND = 31; // ~1 s of audio
/** The background copy plays this much faster than you, so it stays ahead. */
const PREP_RATE = 1.5;
/** In the prepare-ahead copy: its video, and where its current stretch of transcription began. */
let prepVideo: HTMLVideoElement | null = null;
let preparedFrom = 0;
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

/** Hotkeys by physical key: [ ] ±0.1 s, Shift+[ ] ±1 s, \ resets, R replays, S saves the current line. */
function hotkeyDelta(e: KeyboardEvent): number | 'reset' | 'replay' | 'save' | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return null;
  if (e.code === 'KeyR' && !e.shiftKey) return 'replay';
  if (e.code === 'KeyS' && !e.shiftKey) return 'save';
  const step = e.shiftKey ? 1 : 0.1;
  if (e.code === 'BracketRight') return step;
  if (e.code === 'BracketLeft') return -step;
  if (e.code === 'Backslash' && !e.shiftKey) return 'reset';
  return null;
}

/** Last frame grabbed: the same picture well after it means the browser stopped drawing the video. */
let lastFrame: { hash: string; t: number } | null = null;

/**
 * The video's current picture as a ~640 px JPEG (data URL), or null when the page doesn't allow
 * reading it (a cross-origin video without CORS taints the canvas) or the picture is stale or black
 * (Chrome can stop drawing video in a background tab).
 */
async function grabFrame(v: HTMLVideoElement): Promise<string | null> {
  if (!v.videoWidth || !v.videoHeight) return null;
  try {
    const w = Math.min(SHOT_WIDTH, v.videoWidth);
    const h = Math.round((v.videoHeight * w) / v.videoWidth);
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d')!.drawImage(v, 0, 0, w, h);
    const tiny = new OffscreenCanvas(32, 18);
    const tctx = tiny.getContext('2d')!;
    tctx.drawImage(canvas, 0, 0, 32, 18);
    const px = tctx.getImageData(0, 0, 32, 18).data; // throws if the video is cross-origin
    let hash = '';
    let bright = 0;
    for (let i = 0; i < px.length; i += 4) {
      const lum = (px[i]! + px[i + 1]! + px[i + 2]!) / 3;
      bright = Math.max(bright, lum);
      hash += String.fromCharCode(48 + (lum >> 4));
    }
    if (bright < 8) return null; // black: nothing drawn
    if (lastFrame && lastFrame.hash === hash && Math.abs(v.currentTime - lastFrame.t) > 1.5) return null;
    lastFrame = { hash, t: v.currentTime };
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Players hide their control bar about this long after the pointer stops moving over the video. */
const CONTROLS_HIDE_MS = 3000;

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
    // Click a word for the dictionary; words likely new to you are underlined (setting in the popup).
    const wordTools = (markAbove: number): WordTools => ({
      markAbove,
      saveWord: (word) => {
        const v = overlay.attachedVideo;
        const cue = v && state ? currentCue(state.cues, v.currentTime, offset) : null;
        void saveCard({ ...word, time: cue ? cue.start + offset : (v?.currentTime ?? 0) });
      },
      segment: (text) => browser.runtime.sendMessage({ type: 'dict-segment', text } satisfies ExtRequest) as Promise<Token[]>,
      lookup: (text, start) => {
        const v = overlay.attachedVideo;
        const cue = v && state ? currentCue(state.cues, v.currentTime, offset) : null;
        const time = cue ? cue.start + offset : v?.currentTime;
        return browser.runtime.sendMessage({ type: 'dict-lookup', text, start, ...(time !== undefined ? { time } : {}) } satisfies ExtRequest) as Promise<WordMatch | null>;
      },
    });
    const markAbove = (s: Record<string, unknown>) =>
      typeof s[MARK_ABOVE_KEY] === 'number' ? (s[MARK_ABOVE_KEY] as number) : DEFAULT_MARK_ABOVE;
    void browser.storage.local.get(MARK_ABOVE_KEY).then((s) => overlay.setWords(wordTools(markAbove(s))));
    const styleOf = (v: unknown): SubStyle => ({ ...DEFAULT_SUB_STYLE, ...(v as Partial<SubStyle> | undefined) });
    void browser.storage.local.get(SUB_STYLE_KEY).then((s) => overlay.setStyle(styleOf(s[SUB_STYLE_KEY])));
    void browser.storage.local.get(LISTEN_MODE_KEY).then((s) => overlay.setListenMode(s[LISTEN_MODE_KEY] === true));
    void browser.storage.local.get(STUDY_MODE_KEY).then((s) => overlay.setStudyMode(s[STUDY_MODE_KEY] === true));

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

    // Where the video is in the tab, so notebook screenshots show only the video. The video's frame
    // posts its box up through any iframes (each adds its iframe's offset); the top frame reports it.
    const reportRect = (r: { x: number; y: number; w: number; h: number } | null) => {
      if (window === window.top) {
        const full = r === null || document.fullscreenElement !== null;
        const rect = full ? null : { ...r, vw: innerWidth };
        send({ type: 'video-rect', rect });
      } else {
        window.parent.postMessage({ jimakuKasaneRect: r }, '*');
      }
    };
    window.addEventListener('message', (e) => {
      const d = (e.data as { jimakuKasaneRect?: { x: number; y: number; w: number; h: number } | null } | null)?.jimakuKasaneRect;
      if (d === undefined) return;
      const frame = [...document.querySelectorAll('iframe')].find((f) => f.contentWindow === e.source);
      if (!frame) return;
      if (d === null) return reportRect(null);
      if (![d.x, d.y, d.w, d.h].every(Number.isFinite)) return;
      const f = frame.getBoundingClientRect();
      reportRect({ x: d.x + f.left + frame.clientLeft, y: d.y + f.top + frame.clientTop, w: d.w, h: d.h });
    });
    setInterval(() => {
      const v = overlay.attachedVideo;
      if (!active || !state || !v || document.hidden) return;
      if (document.fullscreenElement) return reportRect(null);
      const r = v.getBoundingClientRect();
      reportRect({ x: r.left, y: r.top, w: r.width, h: r.height });
    }, 1000);

    // Study notebook: once a finished line has been on screen ~1 s (so the English hardsub is up
    // too), the background logs its hard words with a screenshot. Each line once per file.
    // Players show their control bar while the pointer moves over the video and hide it ~3 s after
    // it stops: wait for that, so screenshots don't show the bar. If it never clears before the line
    // ends, the words are still logged, without a screenshot (`clean: false`).
    let pointerOverVideoAt = 0;
    document.addEventListener(
      'pointermove',
      (e) => {
        const r = overlay.attachedVideo?.getBoundingClientRect();
        if (r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) pointerOverVideoAt = Date.now();
      },
      { capture: true, passive: true },
    );
    const noted = new Set<string>();
    let grabbing = false;
    setInterval(() => {
      const v = overlay.attachedVideo;
      // Also in a background tab: the frame comes from the video itself. Not in the helper copy.
      if (!active || !state || !v || v.paused || prepVideo || grabbing) return;
      const cue = currentCue(state.cues, v.currentTime, offset);
      if (!cue || cue.partial) return;
      const shownFor = v.currentTime - (cue.start + offset);
      const left = cue.end + offset - v.currentTime;
      if (shownFor < Math.min(1, (cue.end - cue.start) / 2) || left <= 0) return;
      const id = `${state.fileKey}|${cue.start}`;
      if (noted.has(id)) return;
      const line = { type: 'notebook-line' as const, text: cue.text, time: cue.start + offset };
      grabbing = true;
      void grabFrame(v).then((frame) => {
        grabbing = false;
        if (noted.has(id)) return;
        // The video's own picture: no control bar, no site around it, works in a background tab.
        if (frame) return void (noted.add(id), send({ ...line, frame }));
        // Not allowed (a cross-origin video without CORS) or no fresh picture: a tab screenshot
        // instead, which needs the tab on screen and the control bar hidden.
        if (document.hidden) return void (noted.add(id), send({ ...line, clean: false }));
        const clean = Date.now() - pointerOverVideoAt >= CONTROLS_HIDE_MS;
        if (!clean && left > 0.6 * v.playbackRate) return; // wait for the bar to go
        noted.add(id);
        send({ ...line, clean });
      });
    }, 400);

    // --- episode detection (top frame only; reads document.title, no site selectors) ---
    let lastTitle: string | null = null;
    const checkTitle = () => {
      if (!active || window !== window.top || document.title === lastTitle) return;
      lastTitle = document.title;
      const info = parseEpisodeTitle(document.title);
      send({ type: 'page-episode', info, title: document.title });
    };
    let videoReported = false;

    // --- The video's own Japanese subtitle track (HTML5 <track>, HLS/DASH players that expose one) ---
    let trackWatched: HTMLVideoElement | null = null;
    const isJapanese = (t: TextTrack) =>
      (t.kind === 'subtitles' || t.kind === 'captions') &&
      (/^(ja|jpn)\b/i.test(t.language) || /japanese|日本語/i.test(t.label));
    const watchPageTrack = (v: HTMLVideoElement) => {
      trackWatched = v;
      let sent = -1;
      const check = () => {
        if (!browser.runtime?.id || !active || prepVideo || overlay.attachedVideo !== v) return;
        const track = [...v.textTracks].find(isJapanese);
        if (!track) return;
        // We draw it (clickable, styled); 'hidden' still loads the cues without the browser drawing them.
        if (track.mode !== 'hidden') track.mode = 'hidden';
        const cues = track.cues ? [...track.cues] : [];
        if (cues.length === 0 || cues.length === sent) return;
        sent = cues.length;
        send({
          type: 'page-track',
          label: track.label || track.language,
          cues: cues.map((c) => ({
            start: c.startTime,
            end: c.endTime,
            text: ('text' in c ? String(c.text) : '').replace(/<[^>]+>/g, '').trim(),
          })),
        });
      };
      v.textTracks.addEventListener('addtrack', check);
      const timer = setInterval(() => {
        if (trackWatched !== v || !browser.runtime?.id) return clearInterval(timer);
        check();
      }, 2000);
      check();
    };

    // --- jump to a scene from the notebook: the background holds the time for this tab ---
    let seekAsked = false;
    const takeSeek = (v: HTMLVideoElement) => {
      seekAsked = true;
      void (browser.runtime.sendMessage({ type: 'take-seek' } satisfies ExtRequest) as Promise<number | null>)
        .then((t) => {
          if (typeof t !== 'number') return;
          // A couple of seconds early, so the line is heard from its start.
          const go = () => (v.currentTime = Math.max(0, t - 2));
          if (v.readyState >= 1) go();
          else v.addEventListener('loadedmetadata', go, { once: true });
        })
        .catch(() => {});
    };

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
      if (overlay.attachedVideo && !seekAsked) takeSeek(overlay.attachedVideo);
      if (overlay.attachedVideo && overlay.attachedVideo !== trackWatched) watchPageTrack(overlay.attachedVideo);
      checkTitle(); // title changes are childList mutations too
    };
    const queueScan = () => {
      if (scanQueued) return;
      scanQueued = true;
      // Animation frames never fire in a minimized window (the prepare-ahead copy): use a timer there.
      if (document.hidden) setTimeout(scan, 200);
      else requestAnimationFrame(scan);
    };
    scan();
    // Live/prepared lines: tell the copy when you skip (e.g. the opening), so it prepares from there.
    document.addEventListener(
      'seeked',
      (e) => {
        if (e.target !== overlay.attachedVideo || prepVideo || !state?.live) return;
        send({ type: 'viewer-seeked', t: (e.target as HTMLVideoElement).currentTime });
      },
      true,
    );
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
      if (msg?.type === 'reveal') {
        overlay.reveal(msg.on);
        return;
      }
      if (msg?.type === 'replay-line' || msg?.type === 'save-line') {
        if (overlay.attachedVideo && !prepVideo) (msg.type === 'replay-line' ? replayLine : saveLine)();
        return;
      }
      if (msg?.type === 'prep-seek' && prepVideo) {
        // You jumped outside what's prepared: the copy follows (a little before, to catch the line).
        const t = Math.max(0, msg.t - 1);
        if (t > prepVideo.currentTime || t < preparedFrom) {
          prepVideo.currentTime = t;
          preparedFrom = t;
        }
        return;
      }
      if (msg?.type === 'prep-start' && overlay.attachedVideo && !stopAutoCapture) {
        // This tab is the minimized copy: play muted and fast, and send audio for the viewer's tab.
        const v = overlay.attachedVideo;
        const { viewerTabId, fileKey } = msg;
        prepVideo = v;
        preparedFrom = v.currentTime;
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
          'JimakuKasane: helper copy, transcribing ahead of you (muted, fast). ' +
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
      if (area === 'local' && changes[SUB_STYLE_KEY]) overlay.setStyle(styleOf(changes[SUB_STYLE_KEY].newValue));
      if (area === 'local' && changes[LISTEN_MODE_KEY]) overlay.setListenMode(changes[LISTEN_MODE_KEY].newValue === true);
      if (area === 'local' && changes[STUDY_MODE_KEY]) overlay.setStudyMode(changes[STUDY_MODE_KEY].newValue === true);
      if (area === 'local' && changes[MARK_ABOVE_KEY]) {
        overlay.setWords(wordTools(markAbove({ [MARK_ABOVE_KEY]: changes[MARK_ABOVE_KEY].newValue })));
      }
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

    /** Back to the start of the line being shown (or the one before, if it only just started). */
    const replayLine = () => {
      const v = overlay.attachedVideo;
      if (!v || !state) return;
      const to = replayTarget(state.cues, v.currentTime, offset);
      if (to === null) return;
      v.currentTime = to;
      if (v.paused) void v.play().catch(() => {});
    };

    /** Saves the line on screen (or the last one) for review / Anki. */
    const saveLine = () => {
      const v = overlay.attachedVideo;
      if (!v || !state) return;
      const cue = currentCue(state.cues, v.currentTime, offset);
      if (!cue) return;
      void saveCard({ line: cue.text, time: cue.start + offset });
    };
    const saveCard = async (card: Extract<ExtRequest, { type: 'save-card' }>['card']) => {
      const res = await browser.runtime.sendMessage({ type: 'save-card', card } satisfies ExtRequest).catch(() => null);
      overlay.flash(res ? `Saved: ${card.word ?? card.line}` : 'Couldn\'t save');
    };

    // Listening practice: hold H to see the line (every frame: the key may land outside the player).
    const onReveal = (e: KeyboardEvent, on: boolean) => {
      if (e.code !== 'KeyH' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !active || !state) return;
      if (isEditable(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      overlay.reveal(on);
      send({ type: 'reveal', on });
    };
    window.addEventListener('keydown', (e) => onReveal(e, true), { capture: true });
    window.addEventListener('keyup', (e) => onReveal(e, false), { capture: true });
    window.addEventListener('blur', () => overlay.reveal(false)); // released elsewhere

    window.addEventListener(
      'keydown',
      (e) => {
        if (!active || !state || isEditable(e.target)) return;
        const delta = hotkeyDelta(e);
        if (delta === null) return;
        e.preventDefault();
        e.stopPropagation();
        if (delta === 'replay' || delta === 'save') {
          // The key may land in the page while the video is in a player iframe: ask that frame.
          if (overlay.attachedVideo) (delta === 'replay' ? replayLine : saveLine)();
          else send({ type: delta === 'replay' ? 'replay-line' : 'save-line' });
          return;
        }
        const next = delta === 'reset' ? 0 : roundOffset(offset + delta);
        offset = next;
        // Every frame (incl. this one) picks the change up via storage.onChanged.
        void browser.storage.local.set(offsetWrites(state, next));
      },
      { capture: true },
    );
  },
});
