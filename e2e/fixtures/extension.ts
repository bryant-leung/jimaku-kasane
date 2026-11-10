import { test as base, chromium, type BrowserContext, type Frame, type Page } from '@playwright/test';
import path from 'node:path';

const EXTENSION_PATH = path.resolve(import.meta.dirname, '../../extension/dist/chrome-mv3');
export const FIXTURES = import.meta.dirname;

/** Fake origins served via page.route — no real streaming sites in tests. */
export const SITE = 'http://anime-site.test';
export const PLAYER = 'http://player.test'; // cross-origin, like kwik
export const INNER = 'http://inner.test'; // a second iframe level

const VIDEO = `<video width="640" height="360"></video>`;

const SITE_PAGES: Record<string, string> = {
  '/watch': `<h1>Episode 1</h1>${VIDEO}<input aria-label="Comment">`,
  '/embed': `<h1>Episode 2</h1><iframe src="${PLAYER}/player" width="660" height="380"></iframe>`,
  '/nested': `<h1>Nested</h1><iframe src="${PLAYER}/nested" width="700" height="420"></iframe>`,
  '/novideo': `<h1>Just text</h1>`,
  '/late': `<h1>Late video</h1><script>
      setTimeout(() => document.body.insertAdjacentHTML('beforeend', '${VIDEO}'), 300);
    </script>`,
  '/multi': `<h1>Two videos</h1>
    <video id="small" width="160" height="90"></video>
    <video id="big" width="640" height="360"></video>`,
  '/fullscreen': `<h1>Fullscreen</h1>
    <div id="box" style="background:#000">${VIDEO}</div>
    <button onclick="document.getElementById('box').requestFullscreen()">Fullscreen</button>`,
};

const PLAYER_PAGES: Record<string, string> = {
  '/player': VIDEO,
  '/nested': `<iframe src="${INNER}/player" width="680" height="400"></iframe>`,
};

const html = (body: string) => `<!doctype html><meta charset="utf-8"><body>${body}</body>`;

export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium', // new headless supports extensions
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    await context.route(`${SITE}/**`, (route) => {
      const body = SITE_PAGES[new URL(route.request().url()).pathname];
      return route.fulfill({ contentType: 'text/html', body: html(body ?? 'not found') });
    });
    await context.route(`${PLAYER}/**`, (route) => {
      const body = PLAYER_PAGES[new URL(route.request().url()).pathname];
      return route.fulfill({ contentType: 'text/html', body: html(body ?? 'not found') });
    });
    await context.route(`${INNER}/**`, (route) => route.fulfill({ contentType: 'text/html', body: html(VIDEO) }));
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(new URL(sw.url()).host);
  },
});

export const expect = test.expect;

/** Overlay status inside a page or frame. */
export const overlayIn = (target: Page | ReturnType<Page['frameLocator']>) =>
  target.getByRole('status', { name: 'Japanese subtitles' });

/** Chrome tab id of `page`, read from the extension's service worker. */
export async function tabIdOf(context: BrowserContext, page: Page): Promise<number> {
  await page.bringToFront();
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return sw.evaluate(async () => {
    const tabs = (globalThis as unknown as { chrome: { tabs: { query(q: object): Promise<{ id?: number }[]> } } })
      .chrome.tabs;
    const [tab] = await tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined) throw new Error('no active tab');
    return tab.id;
  });
}

/** Opens the popup as a page that controls `page`'s tab. */
export async function openPopup(context: BrowserContext, extensionId: string, page: Page): Promise<Page> {
  const tabId = await tabIdOf(context, page);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${tabId}`);
  await expect(popup.getByRole('status')).toHaveText(/./); // initial state fetched
  return popup;
}

type FilePayload = { name: string; mimeType: string; buffer: Buffer };

/** Picks a subtitle file in the popup: a fixture name or an in-memory file. */
export async function loadFile(popup: Page, file: string | FilePayload): Promise<void> {
  const input = popup.getByLabel('Subtitle file');
  await input.setInputFiles(typeof file === 'string' ? path.join(FIXTURES, file) : file);
}

/** Seeks the (source-less) video and fires timeupdate, as playback would. */
export async function setTime(target: Page | Frame, seconds: number): Promise<void> {
  await target.evaluate((t) => {
    const v = document.querySelector('video');
    if (!v) throw new Error('no video');
    v.currentTime = t;
    v.dispatchEvent(new Event('timeupdate'));
  }, seconds);
}
