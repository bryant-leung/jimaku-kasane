import * as ort from 'onnxruntime-web/wasm';
import { browser } from 'wxt/browser';
import type { Cue } from '@/lib/cue';
import type { AutoSyncMessage, SyncMessage } from '@/lib/subs';
import {
  agreedOffset,
  alignPoints,
  computeSync,
  pickClock,
  type EnergyFrame,
  type SyncMode,
  type SyncResult,
  type TimeSample,
} from '@/lib/sync';
import { SileroVad, VAD_FRAME, VAD_RATE } from '@/lib/vad';

/** Files added to the build by the wxt.config.ts hook aren't in WXT's typed path list. */
const assetUrl = (p: string) => (browser.runtime.getURL as (path: string) => string)(p);

// Bundled runtime + model; no remote code. Single thread: offscreen pages aren't cross-origin isolated.
ort.env.wasm.wasmPaths = assetUrl('/ort/');
ort.env.wasm.numThreads = 1;
const MODEL_URL = assetUrl('/vad/silero_vad_16k_op15.onnx');

const ENERGY_FRAME_MS = 20;
const CHECKPOINTS_S = [20, 35, 50, 60];

/** Feeds the tab audio through the Silero voice detector; one probability per 32 ms frame. */
async function startVad(stream: MediaStream, frames: EnergyFrame[]): Promise<() => void> {
  const vad = await SileroVad.create(ort, MODEL_URL);
  const ctx = new AudioContext({ sampleRate: VAD_RATE });
  await ctx.audioWorklet.addModule(assetUrl('/vad/pcm-worklet.js'));
  const tap = new AudioWorkletNode(ctx, 'pcm-tap');
  const mute = ctx.createGain();
  mute.gain.value = 0; // keep the graph pulling audio without playing it twice
  ctx.createMediaStreamSource(stream).connect(tap).connect(mute).connect(ctx.destination);

  let queue = Promise.resolve();
  tap.port.onmessage = (e: MessageEvent<{ pcm: Float32Array; end: number }>) => {
    const { pcm, end } = e.data;
    queue = queue.then(async () => {
      const p = await vad.process(pcm);
      // Audio clock → wall clock, so frames line up with the video's time samples.
      const ts = ctx.getOutputTimestamp();
      const mid = end - VAD_FRAME / VAD_RATE / 2;
      frames.push({ at: performance.timeOrigin + (ts.performanceTime ?? 0) + (mid - (ts.contextTime ?? 0)) * 1000, db: p });
    });
  };
  return () => {
    tap.port.onmessage = null;
    void ctx.close();
  };
}

/** Fallback when the model can't load: speech-band loudness. */
function startEnergy(ctx: AudioContext, source: MediaStreamAudioSourceNode, frames: EnergyFrame[]): () => void {
  const low = ctx.createBiquadFilter();
  low.type = 'highpass';
  low.frequency.value = 300;
  const high = ctx.createBiquadFilter();
  high.type = 'lowpass';
  high.frequency.value = 3400;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(low).connect(high).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const meter = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    frames.push({ at: Date.now(), db: 10 * Math.log10(sum / buf.length + 1e-12) });
  }, ENERGY_FRAME_MS);
  return () => clearInterval(meter);
}

/**
 * Listens to the tab's audio (tabCapture stream) while the user keeps watching, detects speech
 * and lines the cues up with it. Audio is analysed in memory here and never stored or sent.
 */
async function run(streamId: string, tabId: number, cues: Cue[]): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } as MediaTrackConstraints,
  });
  const play = new AudioContext();
  const source = play.createMediaStreamSource(stream);
  source.connect(play.destination); // capturing mutes the tab; keep it audible

  const frames: EnergyFrame[] = [];
  const samples: TimeSample[] = [];
  let mode: SyncMode = 'vad';
  let stop: () => void;
  try {
    stop = await startVad(stream, frames);
  } catch {
    mode = 'energy';
    stop = startEnergy(play, source, frames);
  }

  const onTime = (msg: SyncMessage) => {
    if (msg?.type === 'sync-time' && msg.tabId === tabId) samples.push(msg.sample);
  };
  browser.runtime.onMessage.addListener(onTime);

  const started = Date.now();
  let result = computeSync([], [], cues, mode);
  for (const at of CHECKPOINTS_S) {
    await new Promise((r) => setTimeout(r, started + at * 1000 - Date.now()));
    result = computeSync(frames, samples, cues, mode);
    if (result.offset !== null && at >= 35) break; // stable enough
  }
  stop();
  browser.runtime.onMessage.removeListener(onTime);
  for (const track of stream.getTracks()) track.stop();
  await play.close();
  const clock = pickClock(samples);
  await browser.runtime.sendMessage({
    type: 'sync-result',
    tabId,
    result,
    mode,
    clocks: clock.sources,
    frames: frames.length,
    samples: clock.samples.length,
  } satisfies SyncMessage);
}

// --- Automatic sync (no click): frames arrive from the video's own frame, already in video time ---

const AUTO_FIRST_CHECK_S = 20; // seconds of playback heard before the first attempt
const AUTO_FIRST_CHECK_WITH_PRIOR_S = 12;
const AUTO_CHECK_EVERY_S = 5;
const AUTO_GIVE_UP_S = 180;
const SILENT_AFTER_S = 15;
const FRAME_S = VAD_FRAME / VAD_RATE;

interface AutoSession {
  fileKey: string;
  /** The video we listen to: the first source that sends actual sound. */
  source: string | null;
  /** Seconds of audio received before any source had sound. */
  silentHeard: number;
  cues: Cue[];
  prior?: number;
  vad: Promise<SileroVad>;
  points: { t: number; db: number }[];
  lastT: number | null;
  heard: number;
  lastCheck: number;
  peak: number;
  queue: Promise<void>;
  history: SyncResult[];
}
const sessions = new Map<number, AutoSession>();

function finishAuto(tabId: number, s: AutoSession, result: SyncResult, error?: string): void {
  sessions.delete(tabId);
  void browser.runtime.sendMessage({
    type: 'auto-sync-result',
    tabId,
    fileKey: s.fileKey,
    result,
    error,
  } satisfies AutoSyncMessage);
}

function reportProgress(tabId: number, s: AutoSession): void {
  const speech = s.points.filter((p) => p.db > 0.5).length * FRAME_S;
  const last = s.history.at(-1);
  void browser.runtime.sendMessage({
    type: 'auto-sync-progress',
    tabId,
    fileKey: s.fileKey,
    heard: s.heard,
    speech,
    bestGuess: last?.bestGuess ?? null,
    confidence: last?.confidence,
    needed: last?.needed,
  } satisfies AutoSyncMessage);
}

async function onAutoAudio(tabId: number, s: AutoSession, frames: { t: number; pcm: number[] }[]): Promise<void> {
  const vad = await s.vad;
  for (const f of frames) {
    if (s.lastT !== null && Math.abs(f.t - s.lastT - FRAME_S) > 0.5) vad.reset(); // seek or pause
    s.lastT = f.t;
    const pcm = Float32Array.from(f.pcm, (v) => v / 32768);
    for (const v of pcm) s.peak = Math.max(s.peak, Math.abs(v));
    s.points.push({ t: f.t, db: await vad.process(pcm) });
    s.heard += FRAME_S;
  }
  if (sessions.get(tabId) !== s) return;
  const none = { offset: null, bestGuess: null, confidence: 0, speechSeconds: 0 };
  if (s.heard >= SILENT_AFTER_S && s.peak < 1e-3) return finishAuto(tabId, s, none, 'silent');
  // With the show's offset as a hint, a shorter stretch of audio is enough for a first check.
  const firstCheck = s.prior !== undefined ? AUTO_FIRST_CHECK_WITH_PRIOR_S : AUTO_FIRST_CHECK_S;
  if (s.heard < firstCheck || s.heard - s.lastCheck < AUTO_CHECK_EVERY_S) {
    if (Math.floor(s.heard / AUTO_CHECK_EVERY_S) !== Math.floor((s.heard - frames.length * FRAME_S) / AUTO_CHECK_EVERY_S)) {
      reportProgress(tabId, s);
    }
    return;
  }
  s.lastCheck = s.heard;
  const result = alignPoints(s.points, s.cues, 'vad', s.prior);
  s.history.push(result);
  reportProgress(tabId, s);
  const agreed = result.offset ?? agreedOffset(s.history);
  if (agreed !== null) return finishAuto(tabId, s, { ...result, offset: agreed });
  if (s.heard >= AUTO_GIVE_UP_S) finishAuto(tabId, s, result);
}

// --- Live transcription: speech segments → local Whisper server → lines ---

const SPEECH_P = 0.5;
const PREROLL_FRAMES = 6; // ~0.2 s before speech starts, so first syllables aren't clipped
// Shorter segments: lines arrive sooner and fewer at a time (server takes ~1 s per segment).
const END_SILENCE_S = 0.35;
const MAX_SEGMENT_S = 8;
/** While a line is being spoken, send a draft this often (once there's this much of it). */
const DRAFT_EVERY_S = 1;
const DRAFT_MIN_S = 0.8;

interface LiveSession {
  fileKey: string;
  anilistId?: number;
  title: string;
  vad: Promise<SileroVad>;
  recent: { t: number; pcm: number[] }[]; // pre-roll
  segment: { t: number; pcm: number[] }[];
  silence: number;
  lastT: number | null;
  queue: Promise<void>;
  sending: Promise<void>;
  segId: number;
  /** Off when a background copy prepares ahead: lines arrive before they're needed. */
  drafts: boolean;
  draftAt: number; // segment length (s) when the last draft was sent
  draftInFlight: boolean;
  finalsPending: number;
}
const live = new Map<number, LiveSession>();

function send(tabId: number, s: LiveSession, frames: { t: number; pcm: number[] }[], partial: boolean): Promise<void> {
  return browser.runtime
    .sendMessage({
      type: 'live-segment',
      tabId,
      fileKey: s.fileKey,
      start: Math.max(0, frames[0]!.t - FRAME_S / 2),
      audio: toBase64(frames),
      anilistId: s.anilistId,
      title: s.title,
      segId: s.segId,
      partial,
    } satisfies AutoSyncMessage)
    .then(() => {})
    .catch(() => {});
}

/**
 * Draft of the line in progress: at most one in flight. Not held back by a finished line still
 * being processed, so a slow line never freezes the screen (stale drafts are ignored on arrival).
 */
function maybeDraft(tabId: number, s: LiveSession): void {
  const length = s.segment.length * FRAME_S;
  if (!s.drafts || s.draftInFlight || length < DRAFT_MIN_S || length - s.draftAt < DRAFT_EVERY_S) return;
  s.draftAt = length;
  s.draftInFlight = true;
  void send(tabId, s, [...s.segment], true).finally(() => (s.draftInFlight = false));
}

function toBase64(frames: { pcm: number[] }[]): string {
  const pcm = Int16Array.from(frames.flatMap((f) => f.pcm));
  const bytes = new Uint8Array(pcm.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function flushSegment(tabId: number, s: LiveSession): void {
  const frames = s.segment;
  s.segment = [];
  s.silence = 0;
  s.draftAt = 0;
  if (frames.length * FRAME_S < 0.4) {
    s.segId++;
    return; // a cough, not a line
  }
  // Finished lines go one at a time, in order; the background worker calls the server.
  s.finalsPending++;
  const id = s.segId++;
  s.sending = s.sending.then(async () => {
    if (live.get(tabId) === s) await send(tabId, { ...s, segId: id }, frames, false);
    s.finalsPending--;
  });
}

async function onLiveAudio(tabId: number, s: LiveSession, frames: { t: number; pcm: number[] }[]): Promise<void> {
  const vad = await s.vad;
  for (const f of frames) {
    if (s.lastT !== null && Math.abs(f.t - s.lastT - FRAME_S) > 0.5) {
      // Seek: the half-finished segment belongs to another part of the episode.
      vad.reset();
      s.segment = [];
      s.recent = [];
      s.silence = 0;
    }
    s.lastT = f.t;
    const speech = (await vad.process(Float32Array.from(f.pcm, (v) => v / 32768))) > SPEECH_P;
    if (s.segment.length === 0) {
      if (speech) s.segment = [...s.recent, f];
      else s.recent = [...s.recent.slice(-(PREROLL_FRAMES - 1)), f];
      continue;
    }
    s.segment.push(f);
    s.silence = speech ? 0 : s.silence + FRAME_S;
    if (speech) maybeDraft(tabId, s);
    if (s.silence >= END_SILENCE_S || s.segment.length * FRAME_S >= MAX_SEGMENT_S) {
      flushSegment(tabId, s);
      s.recent = [];
    }
  }
}

browser.runtime.onMessage.addListener((msg: AutoSyncMessage) => {
  if (msg?.type === 'live-begin') {
    live.set(msg.tabId, {
      fileKey: msg.fileKey,
      anilistId: msg.anilistId,
      title: msg.title,
      vad: SileroVad.create(ort, MODEL_URL),
      recent: [],
      segment: [],
      silence: 0,
      lastT: null,
      queue: Promise.resolve(),
      sending: Promise.resolve(),
      segId: 0,
      drafts: msg.drafts ?? true,
      draftAt: 0,
      draftInFlight: false,
      finalsPending: 0,
    });
  }
  if (msg?.type === 'auto-audio') {
    const s = live.get(msg.tabId);
    if (s && s.fileKey === msg.fileKey) {
      s.queue = s.queue.then(() => onLiveAudio(msg.tabId, s, msg.frames)).catch(() => {});
    }
  }
});

browser.runtime.onMessage.addListener((msg: AutoSyncMessage) => {
  if (msg?.type === 'auto-sync-begin') {
    sessions.set(msg.tabId, {
      fileKey: msg.fileKey,
      source: null,
      silentHeard: 0,
      cues: msg.cues,
      prior: msg.prior,
      vad: SileroVad.create(ort, MODEL_URL),
      points: [],
      lastT: null,
      heard: 0,
      lastCheck: 0,
      peak: 0,
      queue: Promise.resolve(),
      history: [],
    });
  }
  if (msg?.type === 'auto-audio') {
    const s = sessions.get(msg.tabId);
    if (!s || s.fileKey !== msg.fileKey) return;
    if (s.source === null) {
      const loud = msg.frames.some((f) => f.pcm.some((v) => Math.abs(v) > 32));
      if (!loud) {
        // Silent copy or a quiet start: wait for a source with sound, but not forever.
        s.silentHeard += msg.frames.length * FRAME_S;
        if (s.silentHeard >= 2 * SILENT_AFTER_S) {
          finishAuto(msg.tabId, s, { offset: null, bestGuess: null, confidence: 0, speechSeconds: 0 }, 'silent');
        }
        return;
      }
      s.source = msg.source;
    }
    if (msg.source !== s.source) return; // never mix two videos' audio and clocks
    s.queue = s.queue.then(() => onAutoAudio(msg.tabId, s, msg.frames)).catch((e: unknown) =>
      finishAuto(msg.tabId, s, { offset: null, bestGuess: null, confidence: 0, speechSeconds: 0 }, String(e)),
    );
  }
});

browser.runtime.onMessage.addListener((msg: SyncMessage | { type: 'vad-selftest' }, _sender, sendResponse) => {
  if (msg?.type === 'vad-selftest') {
    // Proves the bundled runtime + model load under the extension's CSP (used by e2e tests).
    SileroVad.create(ort, MODEL_URL)
      .then((vad) => vad.process(new Float32Array(VAD_FRAME)))
      .then((p) => sendResponse({ ok: true, p }), (e: unknown) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type !== 'sync-capture') return;
  run(msg.streamId, msg.tabId, msg.cues).catch((e: unknown) =>
    browser.runtime.sendMessage({
      type: 'sync-result',
      tabId: msg.tabId,
      result: { offset: null, bestGuess: null, confidence: 0, speechSeconds: 0 },
      error: e instanceof Error ? e.message : String(e),
    } satisfies SyncMessage),
  );
});
