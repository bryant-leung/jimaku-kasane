import { test as base, chromium, type BrowserContext, type Frame, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
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
  '/pahe': `<title>Mission: Yozakura Family Ep. 44 :: anime-site</title><h1>Episode 44</h1>
    <iframe src="${PLAYER}/player" width="660" height="380"></iframe>`,
  '/pahe-dash': `<title>Mission: Yozakura Family Season 2 Part 2 - 44 :: anime-site</title>
    <iframe src="${PLAYER}/player" width="660" height="380"></iframe>`,
  '/pahe-45': `<title>Mission: Yozakura Family Season 2 Part 2 - 45 :: anime-site</title>
    <iframe src="${PLAYER}/player" width="660" height="380"></iframe>`,
  '/talk': `<h1>Talking</h1><video src="/speech.wav" width="640" height="360" autoplay></video>`,
  '/embed-talk': `<h1>Player in an iframe</h1><iframe src="${PLAYER}/talk" width="660" height="380" allow="autoplay"></iframe>`,
  // Like animepahe: a big muted "glow" copy in the page, the real player in a cross-origin iframe.
  '/talk-ambient': `<h1>Ambient</h1>
    <video src="/speech.wav" width="900" height="500" muted autoplay style="filter: blur(20px)"></video>
    <iframe src="${PLAYER}/talk" width="660" height="380" allow="autoplay"></iframe>`,
  // Episode page whose subtitles aren't on Jimaku, with real speech audio.
  // Like Kwik's player: saves mute/speed for the whole site whenever the video's change.
  '/live': `<title>Mission: Yozakura Family Season 2 Part 2 - 44 :: anime-site</title>
    <video src="/speech.wav" width="640" height="360" autoplay></video>
    <script>
      const v = document.querySelector('video');
      v.addEventListener('volumechange', () => localStorage.setItem('player-muted', String(v.muted)));
      v.addEventListener('ratechange', () => localStorage.setItem('player-speed', String(v.playbackRate)));
    </script>`,
  '/live-loop': `<title>Mission: Yozakura Family Season 2 Part 2 - 44 :: anime-site</title>
    <video src="/speech.wav" width="640" height="360" autoplay loop></video>`,
  // Like Kwik: the player adds its video after load. Blob source, so it can seek (skip the opening).
  '/live-seek': `<title>Mission: Yozakura Family Season 2 Part 2 - 44 :: anime-site</title>
    <script>
      fetch('/speech.wav').then((r) => r.blob()).then((b) => {
        const v = document.createElement('video');
        Object.assign(v, { width: 640, height: 360, autoplay: true, src: URL.createObjectURL(b) });
        document.body.append(v);
      });
    </script>`,
  // The video carries its own subtitle tracks (like HTML5 / HLS players that expose them).
  '/track-ep': `<title>Mission: Yozakura Family Season 2 Part 2 - 44 :: anime-site</title><h1>Own track</h1>
    <video src="/speech.wav" width="640" height="360" autoplay>
      <track kind="subtitles" srclang="ja" label="日本語" src="/ja.vtt">
    </video>`,
  '/track-en': `<title>Mission: Yozakura Family Season 2 Part 2 - 44 :: anime-site</title><h1>English track</h1>
    <video src="/speech.wav" width="640" height="360" autoplay>
      <track kind="subtitles" srclang="en" label="English" src="/ja.vtt">
    </video>`,
  // Track filled in pieces, like a streaming player adding cues as segments load.
  '/track-grow': `<h1>Growing track</h1><video src="/speech.wav" width="640" height="360" autoplay></video>
    <script>
      const v = document.querySelector('video');
      const t = v.addTextTrack('subtitles', '日本語', 'ja');
      t.addCue(new VTTCue(0, 4, '最初の字幕'));
      setTimeout(() => t.addCue(new VTTCue(4, 60, '後から来た字幕')), 2500);
    </script>`,
  // Only the first load gets a video: the background copy never finds one.
  '/live-copy-novideo': `<title>Mission: Yozakura Family Season 2 Part 2 - 44 :: anime-site</title>
    <script>
      if (!localStorage.getItem('loaded')) {
        localStorage.setItem('loaded', '1');
        document.write('<video src="/speech.wav" width="640" height="360" autoplay></video>');
      }
    </script>`,
  // A player that won't start unless its own button is clicked.
  '/live-stubborn': `<title>Mission: Yozakura Family Season 2 Part 2 - 44 :: anime-site</title>
    <video src="/speech.wav" width="640" height="360"></video>
    <script>
      const v = document.querySelector('video');
      v.addEventListener('play', () => setTimeout(() => { v.pause(); v.currentTime = 0; }, 0));
    </script>`,
  '/unknown': `<title>Totally Unknown Show Episode 3 - anime-site</title>${VIDEO}`,
  '/late': `<h1>Late video</h1><script>
      setTimeout(() => document.body.insertAdjacentHTML('beforeend', '${VIDEO}'), 300);
    </script>`,
  '/multi': `<h1>Two videos</h1>
    <video id="small" width="160" height="90"></video>
    <video id="big" width="640" height="360"></video>`,
  '/fullscreen': `<h1>Fullscreen</h1>
    <div id="box" style="background:#000">${VIDEO}</div>
    <button onclick="document.getElementById('box').requestFullscreen()">Fullscreen</button>`,
  // Notebook screenshots: a bright page around the video, which the crop must leave out.
  '/shot-page': `<body style="margin:0;background:#f0f"><h1 style="height:120px;margin:0">Episode</h1>
    <video src="/speech.wav" width="640" height="360" autoplay style="margin-left:300px;background:#000"></video></body>`,
  '/shot-embed': `<body style="margin:0;background:#f0f"><h1 style="height:120px;margin:0">Episode</h1>
    <iframe src="${PLAYER}/talk-dark" width="660" height="380" allow="autoplay" style="margin-left:300px;border:0"></iframe></body>`,
  // Like Kwik's player: the box that goes fullscreen toggles play on a click.
  '/fs-plyr-embed': `<h1>Player in an iframe</h1><iframe src="${PLAYER}/fs-plyr" width="660" height="420" allow="autoplay; fullscreen"></iframe>`,
  // The <video> itself goes fullscreen (nothing can be placed inside it).
  '/fullscreen-video': `<h1>Fullscreen video</h1>${VIDEO}
    <button onclick="document.querySelector('video').requestFullscreen()">Fullscreen</button>`,
  // Like animepahe: the player's own box goes fullscreen inside a cross-origin iframe.
  '/fs-embed': `<h1>Player in an iframe</h1><iframe src="${PLAYER}/fs-player" width="660" height="420" allow="fullscreen"></iframe>`,
};

const PLAYER_PAGES: Record<string, string> = {
  '/player': VIDEO,
  '/talk': `<video src="/speech.wav" width="640" height="360" autoplay></video>`,
  '/nested': `<iframe src="${INNER}/player" width="680" height="400"></iframe>`,
  '/talk-dark': `<body style="margin:0;background:#000"><video src="/speech.wav" width="640" height="360" autoplay style="background:#000"></video></body>`,
  '/fs-plyr': `<div id="box" style="background:#000"><video src="/speech.wav" width="640" height="360" autoplay></video></div>
    <button onclick="document.getElementById('box').requestFullscreen()">Fullscreen</button>
    <script>
      const box = document.getElementById('box');
      const v = box.querySelector('video');
      box.addEventListener('click', () => (v.paused ? v.play() : v.pause()));
    </script>`,
  '/fs-player': `<div id="box" style="background:#000">${VIDEO}</div>
    <button onclick="document.getElementById('box').requestFullscreen()">Fullscreen</button>`,
};

/** The speech clip, with byte ranges so the video can seek like a real player. */
function fulfillWav(route: Route) {
  const wav = readFileSync(path.join(FIXTURES, 'speech-music.wav'));
  const m = /bytes=(\d+)-(\d*)/.exec(route.request().headers()['range'] ?? '');
  if (!m) return route.fulfill({ contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: wav });
  const start = Number(m[1]);
  const end = m[2] ? Math.min(Number(m[2]), wav.length - 1) : wav.length - 1;
  return route.fulfill({
    status: 206,
    contentType: 'audio/wav',
    headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${wav.length}` },
    body: wav.subarray(start, end + 1),
  });
}

const html = (body: string) => `<!doctype html><meta charset="utf-8"><body>${body}</body>`;

export const test = base.extend<{ context: BrowserContext; extensionId: string; realAutoplay: boolean }>({
  /** true: Chrome's normal autoplay rules (audio only after a click), like a real browser. */
  realAutoplay: [false, { option: true }],
  context: async ({ realAutoplay }, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium', // new headless supports extensions
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        // Lets the audio fixture play unattended (off for tests of real-browser behaviour).
        ...(realAutoplay ? [] : ['--autoplay-policy=no-user-gesture-required']),
      ],
    });
    await context.route(`${SITE}/**`, (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/speech.wav') return fulfillWav(route);
      if (pathname === '/ja.vtt') {
        return route.fulfill({
          contentType: 'text/vtt',
          body: 'WEBVTT\n\n00:00.000 --> 00:30.000\n<c.yellow>公式の字幕です</c>\n\n00:30.000 --> 01:00.000\n二行目\n',
        });
      }
      const body = SITE_PAGES[pathname];
      return route.fulfill({ contentType: 'text/html', body: html(body ?? 'not found') });
    });
    await context.route(`${PLAYER}/**`, (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/speech.wav') return fulfillWav(route);
      const body = PLAYER_PAGES[pathname];
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
    type Win = { state?: string; focused: boolean; tabs?: { id?: number; active: boolean }[] };
    const chrome = (globalThis as unknown as { chrome: { windows: { getAll(q: object): Promise<Win[]> } } }).chrome;
    // Skip minimized windows: the extension's own background copy (prepare ahead) lives there.
    const wins = (await chrome.windows.getAll({ populate: true })).filter((w) => w.state !== 'minimized');
    const win = wins.find((w) => w.focused) ?? wins.at(-1);
    const tab = win?.tabs?.find((t) => t.active);
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

/** Writes extension settings (chrome.storage.local) as if set in the popup. */
export async function setLocal(context: BrowserContext, values: Record<string, unknown>): Promise<void> {
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await sw.evaluate(async (v) => {
    const storage = (globalThis as unknown as { chrome: { storage: { local: { set(v: object): Promise<void> } } } })
      .chrome.storage.local;
    await storage.set(v);
  }, values);
}

/** Saves a Jimaku API key as if entered in Settings. */
export async function setJimakuKey(context: BrowserContext, key: string): Promise<void> {
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await sw.evaluate(async (k) => {
    const storage = (globalThis as unknown as { chrome: { storage: { local: { set(v: object): Promise<void> } } } })
      .chrome.storage.local;
    await storage.set({ jimakuKey: k });
  }, key);
}
