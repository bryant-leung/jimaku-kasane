/**
 * Audio auto-sync: speech detected in tab audio is lined up with cue timings to set the offset.
 * Alignment is tested in Node on synthetic audio with a known offset; real tab capture needs a
 * click on the toolbar popup, so the browser tests cover the button and its error path.
 * Test IDs: docs/TEST_PLAN.md P3-14..P3-20.
 *
 * Run: npm run test:e2e -- e2e/pr-5-auto-sync.spec.ts
 */
import { test as unit } from '@playwright/test';
import type { Cue } from '../extension/src/lib/cue';
import { computeSync, toVideoTime, type EnergyFrame, type TimeSample } from '../extension/src/lib/sync';
import { SITE, expect, loadFile, openPopup, test } from './fixtures/extension';

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

unit.describe('alignment', () => {
  const cues = makeCues(400, rng(42));

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
