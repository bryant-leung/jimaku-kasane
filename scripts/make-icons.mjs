#!/usr/bin/env node
/**
 * Renders docs/assets/logo.svg to the extension's toolbar/store icons (extension/public/icon/<size>.png)
 * and a 1280×640 social-preview image (docs/assets/social-preview.png). Uses Playwright's Chromium.
 * Run: node scripts/make-icons.mjs
 */
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(import.meta.dirname, '..');
const svg = readFileSync(path.join(ROOT, 'docs/assets/logo.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
mkdirSync(path.join(ROOT, 'extension/public/icon'), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
  await page.screenshot({ path: path.join(ROOT, `extension/public/icon/${size}.png`), omitBackground: true });
}
await page.setViewportSize({ width: 1280, height: 640 });
await page.setContent(`<style>
  html,body{margin:0;width:1280px;height:640px;background:#1d1b2f;color:#fbf7ef;font-family:"Hiragino Sans","Noto Sans JP",system-ui,sans-serif}
  .wrap{display:flex;align-items:center;gap:64px;height:100%;padding:0 96px;box-sizing:border-box}
  svg{width:300px;height:300px;flex:none}
  h1{margin:0;font-size:84px;letter-spacing:-1px} h1 span{color:#d7263d;font-size:64px;margin-left:16px}
  p{margin:20px 0 0;font-size:34px;line-height:1.4;color:#c9cdf0}
</style><div class="wrap">${svg}<div><h1>JimakuKasane<span>字幕重ね</span></h1>
<p>Japanese subtitles layered under the English ones on streaming anime: auto-synced, clickable for meanings, built for study.</p></div></div>`);
await page.screenshot({ path: path.join(ROOT, 'docs/assets/social-preview.png') });
await browser.close();
console.log('icons: extension/public/icon/{16,32,48,128}.png, docs/assets/social-preview.png');
