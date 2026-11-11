# extension

Chrome Manifest V3 extension in TypeScript, built with [WXT](https://wxt.dev). Commands run from the repo root; see the main [README](../README.md).

## Structure

```
src/
  entrypoints/
    content.ts         every frame: finds the main video, draws the overlay, offset hotkeys,
                       reports the episode title (top frame) and streams the video's audio for auto-sync
    background.ts      service worker: per-tab state, AniList + Jimaku lookup (one at a time per tab),
                       offsets per file and per show, starts/finishes auto-sync
    offscreen/         offscreen page: Silero VAD (onnxruntime-web), tab-capture sync, auto-sync sessions
    popup/             status, file picker, offset buttons, Auto-sync button, Jimaku key in Settings
  lib/
    parse.ts           .srt / .ass → Cue[] (encodings, tags, bad-line reporting)
    episode.ts         page title → show + episode
    autosubs.ts        AniList franchise walk, episode-number candidates, Jimaku file choice
    sync.ts            speech ↔ cue alignment (interval overlap, or cue starts for gapless TV captions)
    vad.ts             Silero VAD wrapper (16 kHz, 512-sample frames)
    overlay.ts         top-layer popover overlay in a shadow root
    subs.ts, cue.ts    shared types, messages, storage keys
public/
  vad/                 silero_vad_16k_op15.onnx (MIT), pcm-worklet.js
wxt.config.ts          manifest; copies ONNX Runtime wasm into ort/
```

## Manifest

| Setting | Why |
|---|---|
| `content_scripts`: `<all_urls>`, `all_frames` | players live in cross-origin iframes; site-agnostic |
| `permissions`: `storage` | offsets, settings, per-tab state |
| `permissions`: `tabCapture`, `offscreen` | Auto-sync button (manual) and the offscreen VAD page |
| `host_permissions`: jimaku.cc, graphql.anilist.co, 127.0.0.1 | subtitle lookup; local server later |
| CSP `wasm-unsafe-eval` (extension pages) | runs the bundled ONNX Runtime; no remote code |

## Storage

| Key | Area | Holds |
|---|---|---|
| `tab:<tabId>` | session | loaded cues for a tab |
| `auto:<tabId>`, `sync:<tabId>` | session | lookup / sync status shown in the popup |
| `offset:<fileKey>` | local | offset for one subtitle file |
| `showOffset:anilist:<id>` | local | last offset for a show (inherited by its next episode) |
| `synced:<fileKey>` | local | auto-sync done for this file |
| `show:<title>` | local | AniList franchise cache (12 h) |
| `jimakuKey` | local | Jimaku API key |
