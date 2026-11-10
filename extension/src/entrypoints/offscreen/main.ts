import { browser } from 'wxt/browser';
import type { Cue } from '@/lib/cue';
import { computeSync, type EnergyFrame, type TimeSample } from '@/lib/sync';
import type { SyncMessage } from '@/lib/subs';

const FRAME_MS = 20;
const CHECKPOINTS_S = [20, 35, 50, 60];

/**
 * Listens to the tab's audio (tabCapture stream) while the user keeps watching, measures
 * speech-band loudness and lines the cues up with it. Audio is analysed here and never stored.
 */
async function run(streamId: string, tabId: number, cues: Cue[]): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } as MediaTrackConstraints,
  });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  source.connect(ctx.destination); // capturing mutes the tab; keep it audible
  const low = ctx.createBiquadFilter();
  low.type = 'highpass';
  low.frequency.value = 300;
  const high = ctx.createBiquadFilter();
  high.type = 'lowpass';
  high.frequency.value = 3400;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(low).connect(high).connect(analyser);

  const frames: EnergyFrame[] = [];
  const samples: TimeSample[] = [];
  const buf = new Float32Array(analyser.fftSize);
  const meter = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    frames.push({ at: Date.now(), db: 10 * Math.log10(sum / buf.length + 1e-12) });
  }, FRAME_MS);

  const onTime = (msg: SyncMessage) => {
    if (msg?.type === 'sync-time' && msg.tabId === tabId) samples.push(msg.sample);
  };
  browser.runtime.onMessage.addListener(onTime);

  const started = Date.now();
  let result = computeSync([], [], cues);
  for (const at of CHECKPOINTS_S) {
    await new Promise((r) => setTimeout(r, started + at * 1000 - Date.now()));
    result = computeSync(frames, samples, cues);
    if (result.offset !== null && at >= 35) break; // stable enough
  }
  clearInterval(meter);
  browser.runtime.onMessage.removeListener(onTime);
  for (const track of stream.getTracks()) track.stop();
  await ctx.close();
  await browser.runtime.sendMessage({ type: 'sync-result', tabId, result } satisfies SyncMessage);
}

browser.runtime.onMessage.addListener((msg: SyncMessage) => {
  if (msg?.type !== 'sync-capture') return;
  run(msg.streamId, msg.tabId, msg.cues).catch((e: unknown) =>
    browser.runtime.sendMessage({
      type: 'sync-result',
      tabId: msg.tabId,
      result: { offset: null, confidence: 0, speechSeconds: 0 },
      error: e instanceof Error ? e.message : String(e),
    } satisfies SyncMessage),
  );
});
