import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';

const EXTENSION_PATH = path.resolve(import.meta.dirname, '../../extension/dist/chrome-mv3');

/** Fake origins served via page.route — no real streaming sites in tests. */
export const SITE = 'http://anime-site.test';
export const PLAYER = 'http://player.test'; // cross-origin, like kwik

export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium', // new headless supports extensions
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    await context.route(`${SITE}/**`, (route) => {
      const url = new URL(route.request().url());
      const pages: Record<string, string> = {
        '/watch': `<h1>Episode 1</h1><video width="640" height="360"></video>`,
        '/embed': `<h1>Episode 2</h1><iframe src="${PLAYER}/player" width="660" height="380"></iframe>`,
        '/novideo': `<h1>Just text</h1>`,
      };
      return route.fulfill({ contentType: 'text/html', body: pages[url.pathname] ?? 'not found' });
    });
    await context.route(`${PLAYER}/**`, (route) =>
      route.fulfill({ contentType: 'text/html', body: `<video width="640" height="360"></video>` }),
    );
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(new URL(sw.url()).host);
  },
});

export const expect = test.expect;
