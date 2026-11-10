# extension

Manifest V3 browser extension (TypeScript, built with [WXT](https://wxt.dev) for Chrome + Safari).

## Structure
```
src/
  entrypoints/
    content.ts      video detection + overlay (runs in all frames)
    background.ts   service worker: AniList, Jimaku, cache, server client (phase 1)
    popup/          show/episode picker, offset, settings
  lib/              subtitle parsers (srt, ass), Cue types
wxt.config.ts       manifest + build config
```

## Commands (run from repo root)
| Command | What |
|---|---|
| `npm run dev` | Launches Chrome with the extension, hot-reloads on save |
| `npm run build` | Production build → `extension/dist/chrome-mv3` |
| `npm run build:safari -w extension` | Safari build → `extension/dist/safari-mv3` (then wrap with `xcrun safari-web-extension-converter`) |
| `npm run typecheck` | `tsc` for extension + e2e |
| `npm run test:e2e` | Build, then Playwright |

## Key manifest settings
- `content_scripts[].all_frames: true` — players live in cross-origin iframes
- `host_permissions`: `<all_urls>` (site-agnostic), `https://jimaku.cc/*`, `https://graphql.anilist.co/*`, `http://127.0.0.1/*`
- `permissions`: `storage`, `tabCapture`, `offscreen` (phase 3)
