/**
 * Phase 0 scaffold: extension loads in Chromium and mounts an overlay over <video>.
 * Covers: service worker boots, overlay in top frame, overlay in cross-origin iframe,
 * no overlay without video, popup renders.
 *
 * Run: npm run test:e2e -- e2e/pr-1-phase-0-scaffold.spec.ts
 */
import { test, expect, SITE, PLAYER } from './fixtures/extension';

// P0-01
test('extension service worker starts', async ({ extensionId }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);
});

// P0-02
test('overlay mounts over a video in the top frame', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(`${SITE}/watch`);
  await expect(page.getByRole('status', { name: 'Japanese subtitles' })).toHaveText('JP Sub ready');
});

// P0-03
test('overlay mounts over a video inside a cross-origin iframe', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(`${SITE}/embed`);
  const player = page.frameLocator(`iframe[src^="${PLAYER}"]`);
  await expect(player.getByRole('status', { name: 'Japanese subtitles' })).toHaveText('JP Sub ready');
});

// P0-04
test('no overlay on a page without video', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(`${SITE}/novideo`);
  await expect(page.getByRole('heading', { name: 'Just text' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Japanese subtitles' })).toHaveCount(0);
});

// P0-05
test('popup renders with version', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.getByRole('heading', { name: 'JP Sub Overlay' })).toBeVisible();
  await expect(page.getByText(/^Version \d/)).toBeVisible();
});
