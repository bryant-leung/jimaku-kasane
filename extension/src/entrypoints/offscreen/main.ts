import * as ort from 'onnxruntime-web/wasm';
import { browser } from 'wxt/browser';
import type { Cue } from '@/lib/cue';
import type { AutoSyncMessage, SyncMessage } from '@/lib/subs';
import {
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
  vad: Promise<SileroVad>;
  points: { t: number; db: number }[];
  lastT: number | null;
  heard: number;
  lastCheck: number;
  peak: number;
  queue: Promise<void>;
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
  void browser.runtime.sendMessage({
    type: 'auto-sync-progress',
    tabId,
    fileKey: s.fileKey,
    heard: s.heard,
    speech,
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
  if (s.heard < AUTO_FIRST_CHECK_S || s.heard - s.lastCheck < AUTO_CHECK_EVERY_S) {
    if (Math.floor(s.heard / AUTO_CHECK_EVERY_S) !== Math.floor((s.heard - frames.length * FRAME_S) / AUTO_CHECK_EVERY_S)) {
      reportProgress(tabId, s);
    }
    return;
  }
  s.lastCheck = s.heard;
  reportProgress(tabId, s);
  const result = alignPoints(s.points, s.cues, 'vad');
  if (result.offset !== null || s.heard >= AUTO_GIVE_UP_S) finishAuto(tabId, s, result);
}

browser.runtime.onMessage.addListener((msg: AutoSyncMessage) => {
  if (msg?.type === 'auto-sync-begin') {
    sessions.set(msg.tabId, {
      fileKey: msg.fileKey,
      source: null,
      silentHeard: 0,
      cues: msg.cues,
      vad: SileroVad.create(ort, MODEL_URL),
      points: [],
      lastT: null,
      heard: 0,
      lastCheck: 0,
      peak: 0,
      queue: Promise.resolve(),
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
