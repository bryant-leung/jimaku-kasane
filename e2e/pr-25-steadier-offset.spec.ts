/**
 * Steadier auto-sync offset: a show's established offset only moves by more than 0.5 s when a
 * second check on more audio agrees; your usual correction is learned per show from small manual
 * changes only (a bigger change means auto-sync was wrong, not your taste).
 * Test IDs: docs/archive/TEST_PLAN-2026-11.md P3-S1..P3-S6.
 *
 * Run: npm run test:e2e -- e2e/pr-25-steadier-offset.spec.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test as unit } from '@playwright/test';
import { settledOffset, type SyncResult } from '../extension/src/lib/sync';
import { BIAS_LOG_MAX, biasFor, recordCorrection, type BiasLog } from '../extension/src/lib/sync-bias';
import { FIXTURES, SITE, expect, loadFile, openPopup, setJimakuKey, test } from './fixtures/extension';

const r = (offset: number | null, bestGuess = offset, confidence = 6): SyncResult => ({
  offset,
  bestGuess,
  confidence,
  speechSeconds: 10,
});

unit.describe('changing an established offset', () => {
  // P3-S1
  unit('close to the remembered offset, one confident check is enough', () => {
    expect(settledOffset([r(-0.9)], -0.7)).toBe(-0.9);
    expect(settledOffset([r(3.2)])).toBe(3.2); // no remembered offset: unchanged behaviour
  });

  // P3-S2
  unit('a jump of more than 0.5 s must be found again on the next check', () => {
    expect(settledOffset([r(-1.8)], -0.7)).toBeNull(); // keep listening
    expect(settledOffset([r(-1.8), r(-0.7)], -0.7)).toBe(-0.7); // second look: it was right
    expect(settledOffset([r(-1.8), r(-1.8)], -0.7)).toBe(-1.8); // confirmed: really changed
    expect(settledOffset([r(null, -1.8, 2), r(-1.8)], -0.7)).toBeNull(); // earlier check wasn't sure
  });
});

unit.describe('your usual correction', () => {
  // P3-S3
  unit('small manual changes are learned per file; big ones are fixes and forgotten', () => {
    let log: BiasLog = {};
    log = recordCorrection(log, 'a', 1, 0.3, 1);
    expect(log.a?.d).toBe(0.3);
    log = recordCorrection(log, 'a', 1, 0.4, 2); // last change on a file counts
    expect(Object.keys(log)).toEqual(['a']);
    expect(log.a?.d).toBe(0.4);
    log = recordCorrection(log, 'a', 1, 1.1, 3); // auto-sync was wrong here
    expect(log.a).toBeUndefined();
    for (let i = 0; i < BIAS_LOG_MAX + 5; i++) log = recordCorrection(log, `f${i}`, 1, 0.1, 10 + i);
    expect(Object.keys(log)).toHaveLength(BIAS_LOG_MAX);
    expect(log.f0).toBeUndefined(); // oldest dropped
  });

  // P3-S4
  unit("applied per show (median), else across shows; an old big global value is ignored", () => {
    const log: BiasLog = {
      a: { show: 1, d: 0.3, at: 1 },
      b: { show: 1, d: 0.2, at: 2 },
      c: { show: 1, d: -0.5, at: 3 },
      d: { show: 2, d: -0.4, at: 4 },
    };
    expect(biasFor(log, 1)).toBe(0.2);
    expect(biasFor(log, 2)).toBe(-0.4);
    expect(biasFor(log, 3)).toBe(-0.1); // unknown show: median of all four, (-0.4 + 0.2) / 2
    expect(biasFor({}, 1, 0.3)).toBe(0.3); // old single value still used when small
    expect(biasFor({}, 1, 1.1)).toBe(0); // old value from a fix: ignored
    expect(biasFor(undefined, undefined)).toBe(0);
  });
});

test.describe('automatic sync without a click', () => {
  const meta = JSON.parse(readFileSync(path.join(FIXTURES, 'speech-music.json'), 'utf8')) as {
    speech: { start: number; end: number }[];
  };
  const ts = (s: number) => {
    const ms = Math.round(Math.max(0, s) * 1000);
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `00:${p(Math.floor(ms / 60000))}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  const srtFor = (early: number) =>
    meta.speech.map((s, i) => `${i + 1}\n${ts(s.start - early)} --> ${ts(s.end - early)}\nline ${i + 1}\n`).join('\n');
  const storage = (context: Parameters<typeof setJimakuKey>[0]) => {
    const sw = context.serviceWorkers()[0]!;
    type Local = { get(k: string): Promise<Record<string, unknown>>; set(v: object): Promise<void> };
    return {
      get: (k: string) =>
        sw.evaluate((key) => (globalThis as unknown as { chrome: { storage: { local: Local } } }).chrome.storage.local.get(key), k),
      set: (v: object) =>
        sw.evaluate((val) => (globalThis as unknown as { chrome: { storage: { local: Local } } }).chrome.storage.local.set(val), v),
    };
  };

  // P3-S5
  test('a big manual fix after a sync is not learned as your preference', async ({ context, extensionId }) => {
    test.setTimeout(120_000);
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, { name: 'early.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srtFor(3.2)) });
    await page.bringToFront();
    await expect(popup.getByText(/^Auto-synced: offset \+3\.[0-4]s$/)).toBeVisible({ timeout: 90_000 });
    const local = storage(context);
    for (let i = 0; i < 2; i++) await popup.getByRole('button', { name: '+0.1s' }).click();
    await expect.poll(async () => Object.keys(((await local.get('syncBiasLog')).syncBiasLog ?? {}) as object).length).toBe(1);
    for (let i = 0; i < 9; i++) await popup.getByRole('button', { name: '+0.1s' }).click(); // now +1.1 s: a fix
    await expect.poll(async () => Object.keys(((await local.get('syncBiasLog')).syncBiasLog ?? {}) as object).length).toBe(0);
  });

  // P3-S6
  test('an old large learned correction no longer shifts the next sync', async ({ context, extensionId }) => {
    test.setTimeout(120_000);
    await setJimakuKey(context, 'unused'); // ensures the service worker is up
    await storage(context).set({ syncBias: 1.1 });
    const page = await context.newPage();
    await page.goto(`${SITE}/talk`);
    const popup = await openPopup(context, extensionId, page);
    await loadFile(popup, { name: 'early.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srtFor(3.2)) });
    await page.bringToFront();
    await expect(popup.getByText(/^Auto-synced: offset \+3\.[0-4]s$/)).toBeVisible({ timeout: 90_000 });
  });
});
