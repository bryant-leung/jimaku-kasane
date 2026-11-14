/**
 * Audio auto-sync: speech detected in tab audio is lined up with cue timings to set the offset.
 * Alignment is tested in Node on synthetic audio with a known offset; real tab capture needs a
 * click on the toolbar popup, so the browser tests cover the button and its error path.
 * Test IDs: docs/archive/TEST_PLAN-2026-11.md P3-14..P3-20.
 *
 * Run: npm run test:e2e -- e2e/pr-5-auto-sync.spec.ts
 *
 * Real-speech fixture (speech-music.wav/.json): 12 macOS TTS utterances over a music bed at 0.7×
 * speech loudness. Regenerate: for each line `say --file-format=WAVE --data-format=LEI16@16000
 * -o <dir>/uN.wav "<line>"`, then `node e2e/fixtures/make-speech-fixture.mjs <dir>`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test as unit } from '@playwright/test';
import * as ort from 'onnxruntime-web';
import type { Cue } from '../extension/src/lib/cue';
import { agreedOffset, alignPoints, computeSync, toVideoTime, type EnergyFrame, type TimeSample } from '../extension/src/lib/sync';
import { SileroVad, VAD_FRAME, VAD_RATE, voiceProbabilities } from '../extension/src/lib/vad';
import { FIXTURES, SITE, expect, loadFile, openPopup, setJimakuKey, test } from './fixtures/extension';

/** Deterministic PRNG so failures reproduce. */
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Dialogue-like cues: 0.8–3 s lines with 0.3–2.5 s gaps from 0 to `until` seconds. */
function makeCues(until: number, rand: () => number): Cue[] {
  const cues: Cue[] = [];
  for (let t = 1; t < until; ) {
    const len = 0.8 + rand() * 2.2;
    cues.push({ start: t, end: t + len, text: 'x' });
    t += len + 0.3 + rand() * 2.2;
  }
  return cues;
}

/**
 * Simulates `seconds` of playback starting at video time `from`: speech is loud where a cue
 * (shifted by `offset`) is active, background noise elsewhere, with random jitter.
 */
function simulate(
  cues: Cue[],
  offset: number,
  opts: { from?: number; seconds?: number; speech?: boolean; seed?: number; music?: boolean } = {},
) {
  const { from = 100, seconds = 45, speech = true, seed = 7, music = false } = opts;
  const rand = rng(seed);
  const t0 = 1_700_000_000_000;
  const frames: EnergyFrame[] = [];
  const samples: TimeSample[] = [];
  for (let ms = 0; ms < seconds * 1000; ms += 20) {
    const v = from + ms / 1000;
    const talking = speech && cues.some((c) => c.start + offset <= v && v < c.end + offset);
    // Music: a loud bed drifting ±6 dB over ~8 s; speech adds only ~6 dB on top of it.
    const bed = music ? -28 + 6 * Math.sin(ms / 1300) : -42;
    const db = music ? (talking ? bed + 6 : bed) : talking ? -22 : -42;
    frames.push({ at: t0 + ms, db: db + (rand() - 0.5) * (music ? 4 : 8) });
    if (ms % 200 === 0) samples.push({ at: t0 + ms, t: v, playing: true, rate: 1 });
  }
  return { frames, samples };
}

function readWav16(file: string): Float32Array {
  const b = readFileSync(file);
  const n = b.readUInt32LE(40) / 2;
  return Float32Array.from({ length: n }, (_, i) => b.readInt16LE(44 + i * 2) / 32768);
}

unit.describe('voice detection on real speech under music', () => {
  const meta = JSON.parse(readFileSync(path.join(FIXTURES, 'speech-music.json'), 'utf8')) as {
    seconds: number;
    speech: { start: number; end: number }[];
  };
  const from = 100; // video time where the clip starts
  let frames: EnergyFrame[] = [];
  let samples: TimeSample[] = [];

  unit.beforeAll(async () => {
    const model = new Uint8Array(readFileSync(path.join(FIXTURES, '../../extension/public/vad/silero_vad_16k_op15.onnx')));
    const vad = await SileroVad.create(ort, model);
    const probs = await voiceProbabilities(vad, readWav16(path.join(FIXTURES, 'speech-music.wav')));
    const t0 = 1_700_000_000_000;
    const frameMs = (VAD_FRAME / VAD_RATE) * 1000;
    frames = probs.map((p, i) => ({ at: t0 + (i + 0.5) * frameMs, db: p }));
    samples = Array.from({ length: Math.ceil(meta.seconds * 5) }, (_, k) => ({
      at: t0 + k * 200,
      t: from + k * 0.2,
      playing: true,
      rate: 1,
    }));
  });

  /** The episode's subtitle file: these 12 lines shifted by -offset, plus other dialogue around them. */
  const cuesFor = (offset: number): Cue[] => {
    const real = meta.speech.map((s) => ({ start: from + s.start - offset, end: from + s.end - offset, text: 'x' }));
    const others = makeCues(400, rng(5)).filter((c) => c.end < from - 10 || c.start > from + meta.seconds + 10);
    return [...others, ...real].sort((a, b) => a.start - b.start);
  };

  // P3-23
  unit('finds +3.0 s (the Yozakura ep 44 case) with the VAD', () => {
    const res = computeSync(frames, samples, cuesFor(3), 'vad');
    expect(res.offset).not.toBeNull();
    expect(Math.abs(res.offset! - 3)).toBeLessThanOrEqual(0.2);
  });

  // P3-24
  unit('finds -2.4 s with the VAD', () => {
    const res = computeSync(frames, samples, cuesFor(-2.4), 'vad');
    expect(res.offset).not.toBeNull();
    expect(Math.abs(res.offset! + 2.4)).toBeLessThanOrEqual(0.2);
  });

  // P3-28
  unit('finds +3.2 s with back-to-back TV captions (no gaps, lines split)', () => {
    // Like the real CBC TV file: each caption stays up until the next (91% coverage), and some
    // utterances are split across two captions.
    const tv = (offset: number): Cue[] => {
      const lines = cuesFor(offset).flatMap((c, i) =>
        i % 3 === 0 ? [{ ...c, end: (c.start + c.end) / 2 }, { ...c, start: (c.start + c.end) / 2 }] : [c],
      );
      return lines.map((c, i) => ({ ...c, end: Math.max(c.end, lines[i + 1]?.start ?? c.end) }));
    };
    const res = computeSync(frames, samples, tv(3.2), 'vad');
    expect(res.offset, JSON.stringify(res)).not.toBeNull();
    expect(Math.abs(res.offset! - 3.2)).toBeLessThanOrEqual(0.2);
  });

  // P3-29
  unit('gives no offset for back-to-back captions from another episode', () => {
    const other = makeCues(400, rng(31)); // scored 5.3, the highest wrong-episode score seen
    const gapless = other.map((c, i) => ({ ...c, end: other[i + 1]?.start ?? c.end }));
    const res = computeSync(frames, samples, gapless, 'vad');
    expect(res.offset, JSON.stringify(res)).toBeNull();
  });

  // P3-34
  unit("uses the show's remembered offset to settle on less audio", () => {
    const short = toVideoTime(frames.slice(0, Math.round(15 / 0.032)), samples); // first 15 s only
    const cues = cuesFor(3.2);
    const withHint = alignPoints(short, cues, 'vad', 3.6); // last episode was +3.6
    expect(withHint.offset, JSON.stringify(withHint)).not.toBeNull();
    expect(Math.abs(withHint.offset! - 3.2)).toBeLessThanOrEqual(0.2);
  });

  // P3-35
  unit('a remembered offset does not force a match for the wrong episode', () => {
    const other = makeCues(400, rng(31));
    const gapless = other.map((c, i) => ({ ...c, end: other[i + 1]?.start ?? c.end }));
    for (const cues of [other, gapless]) {
      const res = computeSync(frames, samples, cues, 'vad');
      expect(alignPoints(toVideoTime(frames, samples), cues, 'vad', 3.6).offset, JSON.stringify(res)).toBeNull();
    }
  });

  // P3-25
  unit('gives no offset when the dialogue belongs to another episode', () => {
    const other = makeCues(400, rng(77));
    expect(computeSync(frames, samples, other, 'vad').offset).toBeNull();
  });
});

unit.describe('alignment', () => {
  const cues = makeCues(400, rng(42));

  // P3-33
  unit('accepts an answer repeated across three checks', () => {
    const r = (bestGuess: number, confidence: number) => ({ offset: null, bestGuess, confidence, speechSeconds: 30 });
    expect(agreedOffset([r(3.6, 5), r(3.7, 5.2), r(3.6, 5.5)])).toBe(3.6);
    expect(agreedOffset([r(3.6, 5), r(3.7, 5.2)])).toBeNull(); // too few checks
    expect(agreedOffset([r(3.6, 5), r(12, 5.2), r(3.6, 5.5)])).toBeNull(); // disagree
    expect(agreedOffset([r(3.6, 3), r(3.6, 3.1), r(3.6, 3.2)])).toBeNull(); // too weak
  });

  // P3-14
  unit('maps audio frames to video time and drops paused stretches', () => {
    const frames = [0, 100, 300, 2500].map((ms) => ({ at: ms, db: -20 }));
    const samples: TimeSample[] = [
      { at: 0, t: 10, playing: true, rate: 1 },
      { at: 200, t: 10.2, playing: false, rate: 1 },
    ];
    expect(toVideoTime(frames, samples)).toEqual([
      { t: 10, db: -20 },
      { t: 10.1, db: -20 },
    ]); // 300 ms is paused, 2500 ms is stale
  });

  // P3-27
  unit('uses only the audible video clock when several videos report time', () => {
    const { frames, samples } = simulate(cues, 2.3);
    const main = samples.map((s) => ({ ...s, source: 'player', area: 640 * 360, muted: false }));
    // A muted background clip elsewhere on the page, 40 s further along.
    const bg = samples.map((s) => ({ ...s, at: s.at + 37, t: s.t + 40, source: 'bg', area: 300 * 200, muted: true }));
    expect(computeSync(frames, [...bg, ...main], cues).offset).toBe(2.3);
  });

  // P3-15
  unit('finds a positive offset (subtitles early)', () => {
    const { frames, samples } = simulate(cues, 2.3);
    expect(computeSync(frames, samples, cues).offset).toBe(2.3);
  });

  // P3-16
  unit('finds a negative offset (subtitles late)', () => {
    const { frames, samples } = simulate(cues, -1.5, { from: 250, seed: 3 });
    expect(computeSync(frames, samples, cues).offset).toBe(-1.5);
  });

  // P3-17
  unit('finds a large offset within ±20 s', () => {
    const { frames, samples } = simulate(cues, 12.4, { seconds: 60, seed: 11 });
    expect(computeSync(frames, samples, cues).offset).toBe(12.4);
  });

  // P3-21
  unit('finds the offset under loud background music', () => {
    const { frames, samples } = simulate(cues, 3.4, { music: true, seconds: 60, seed: 21 });
    expect(computeSync(frames, samples, cues).offset).toBe(3.4);
  });

  // P3-22
  unit('finds an offset beyond 20 s', () => {
    const { frames, samples } = simulate(cues, -37.5, { from: 200, seconds: 60, seed: 8 });
    expect(computeSync(frames, samples, cues).offset).toBe(-37.5);
  });

  // P3-18
  unit('gives no offset when audio does not match the subtitles', () => {
    const other = makeCues(400, rng(999)); // a different episode's dialogue
    const { frames, samples } = simulate(other, 0, { seed: 5 });
    expect(computeSync(frames, samples, cues).offset).toBeNull();
  });

  // P3-19
  unit('gives no offset when there is too little speech', () => {
    const { frames, samples } = simulate(cues, 1, { speech: false });
    const res = computeSync(frames, samples, cues);
    expect(res.offset).toBeNull();
    expect(res.speechSeconds).toBeLessThan(8);
  });
});

test.describe('voice model in the extension', () => {
  // P3-26
  test('loads the bundled runtime and model under the extension CSP', async ({ context, extensionId }) => {
    const errors: string[] = [];
    const page = await context.newPage();
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`chrome-extension://${extensionId}/offscreen.html`);
    const res = await page.evaluate(
      () =>
        new Promise<{ ok: boolean; p?: number; error?: string }>((resolve) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars -- only used below as `typeof rt`
          const rt = (globalThis as unknown as { chrome: { runtime: { sendMessage(m: object, cb: (r: never) => void): void } } })
            .chrome.runtime;
          // The page can't message itself; a second extension page asks it.
          const frame = document.createElement('iframe');
          frame.src = location.href.replace('offscreen.html', 'popup.html');
          frame.onload = () =>
            (frame.contentWindow as unknown as { chrome: typeof globalThis }).chrome
              ? (frame.contentWindow as unknown as { chrome: { runtime: typeof rt } }).chrome.runtime.sendMessage(
                  { type: 'vad-selftest' },
                  resolve,
                )
              : resolve({ ok: false, error: 'no chrome in frame' });
          document.body.append(frame);
        }),
    );
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
    expect(res.p).toBeGreaterThanOrEqual(0);
    expect(res.p).toBeLessThan(0.5); // silence is not speech
    expect(errors.filter((e) => /wasm|onnx|Content Security Policy/i.test(e))).toEqual([]);
  });
});

test.describe('automatic sync without a click', () => {
  // Real audio playback + the VAD are CPU-heavy: run these one at a time.
  test.describe.configure({ mode: 'serial' });
  const meta = JSON.parse(readFileSync(path.join(FIXTURES, 'speech-music.json'), 'utf8')) as {
    speech: { start: number; end: number }[];
  };
  const ts = (s: number) => {
    const ms = Math.round(Math.max(0, s) * 1000);
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `00:${p(Math.floor(ms / 60000))}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  /** The clip's 12 lines as an .srt, shifted `early` seconds before the speech. */
  const srtFor = (early: number) =>
    meta.speech.map((s, i) => `${i + 1}\n${ts(s.start - early)} --> ${ts(s.end - early)}\nline ${i + 1}\n`).join('\n');

  // P3-30
  test('fixes a 3.2 s offset by itself while the episode plays', async ({ context, extensionId }) => {
    test.setTimeout(120_000);
    // Subtitle file 3.2 s early, as with a TV rip against a stream.
    const srt = srtFor(3.2);

    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, { name: 'early.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srt) });
    await expect(popup.getByRole('status')).toHaveText('Loaded early.srt (12 cues)');
    await page.bringToFront();

    await expect(popup.getByText(/^Auto-sync: listening while you watch… \d+s heard, \d+s of speech/)).toBeVisible({
      timeout: 30_000,
    });
    await expect(popup.getByText(/^Auto-synced: offset \+3\.[0-4]s$/)).toBeVisible({ timeout: 90_000 });
    await expect(popup.getByLabel('Subtitle offset')).toHaveText(/^\+3\.[0-4]s$/);

    // P3-36: nudging after a sync teaches your usual correction.
    for (let i = 0; i < 3; i++) await popup.getByRole('button', { name: '+0.1s' }).click();
    const sw = context.serviceWorkers()[0]!;
    await expect
      .poll(() =>
        sw.evaluate(() =>
          (globalThis as unknown as { chrome: { storage: { local: { get(k: string): Promise<Record<string, number>> } } } })
            .chrome.storage.local.get('syncBiasLog')
            .then((s) => Object.values(s.syncBiasLog ?? {}).map((e) => (e as unknown as { d: number }).d)),
        ),
      )
      .toEqual([0.3]); // you moved it 0.3 s past what auto-sync found (stored per file since PR 25)
  });

  // P3-37
  test('applies your usual correction to the next sync', async ({ context, extensionId }) => {
    test.setTimeout(120_000);
    await setJimakuKey(context, 'unused'); // ensures the service worker is up
    const sw = context.serviceWorkers()[0]!;
    await sw.evaluate(() =>
      (globalThis as unknown as { chrome: { storage: { local: { set(v: object): Promise<void> } } } }).chrome.storage.local.set({
        syncBias: 0.3,
      }),
    );
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, { name: 'early.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srtFor(3.2)) });
    await page.bringToFront();
    await expect(popup.getByText(/^Auto-synced: offset \+3\.[3-7]s \(includes your \+0\.3s adjustment\)$/)).toBeVisible({
      timeout: 90_000,
    });
  });

  // P3-32
  test('listens to the player, not a muted glow copy in the page', async ({ context, extensionId }) => {
    test.setTimeout(120_000);
    const page = await context.newPage();
    await page.goto(`${SITE}/talk-ambient`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, { name: 'early.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srtFor(3.2)) });
    await page.bringToFront();
    await expect(popup.getByText(/^Auto-synced: offset \+3\.[0-4]s$/)).toBeVisible({ timeout: 90_000 });
  });

  // P3-31
  test('leaves an already-correct file alone', async ({ context, extensionId }) => {
    test.setTimeout(120_000);
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, { name: 'right.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srtFor(0)) });
    await page.bringToFront();
    await expect(popup.getByText(/^Auto-sync: timing already matches \(offset [+-]0\.[01]s\)$/)).toBeVisible({
      timeout: 90_000,
    });
  });
});

test.describe('auto-sync button', () => {
  // P3-20
  test('is disabled until subtitles are loaded, and explains a refused capture', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`${SITE}/watch`);
    const popup = await openPopup(context, extensionId, page);
    const button = popup.getByRole('button', { name: /Auto-sync timing/ });
    await expect(button).toBeDisabled();

    await loadFile(popup, 'sample.srt');
    await expect(button).toBeEnabled();
    // Outside a real toolbar click Chrome refuses tab capture; the popup must say so, not hang.
    await button.click();
    await expect(popup.getByText(/^Can't capture this tab's audio: /)).toBeVisible();
  });
});
