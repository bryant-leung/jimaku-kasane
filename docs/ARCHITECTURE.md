# Architecture

## Components

```
┌──────────────────────── Browser ────────────────────────┐
│  Content script (all_frames)                            │
│    - finds <video>, reads currentTime                   │
│    - renders overlay, handles offset hotkeys            │
│            ▲ cues            │ episode info             │
│            │                 ▼                          │
│  Background service worker                              │
│    - AniList lookup, Jimaku fetch, cache (IndexedDB)    │
│    - talks to local server when no subs exist           │
│  Popup / options UI                                     │
│    - pick show/episode, pick sub file, offset, settings │
└────────────────────────────┬────────────────────────────┘
                             │ HTTP (localhost)
┌────────────────────────────▼────────────────────────────┐
│  Local server (FastAPI, phase 3)                        │
│    - /transcribe : audio chunks → Japanese cues         │
│    - LangGraph pipeline (see below)                     │
└─────────────────────────────────────────────────────────┘
```

## Data flow

1. Content script detects video, sends page title/URL to background.
2. Background resolves AniList ID (search by title; user confirms in popup).
3. Background queries Jimaku by AniList ID → list of subtitle files for the episode.
4. Parse `.ass`/`.srt` → `Cue[] { start, end, text }`, cache per episode.
5. Content script renders the cues matching `video.currentTime − offset` (positive offset = subtitles later, like mpv's `sub-delay`).

### Automatic lookup
1. Top frame parses `document.title` (`<title> Ep. 44 …`); any frame with a video reports it. Lookups start only when a tab has both.
2. AniList search → walk PREQUEL/SEQUEL (TV/ONA) → ordered seasons with episode counts (cached 12 h in `storage.local` `show:<title>`).
3. Candidates for absolute/per-season/per-part numbering (ep 44 → Part 2 ep 5, 17, 44) → Jimaku `entries/search?anilist_id=` → `entries/{id}/files?episode=` → first `.srt`/`.ass`.
4. Download, parse, store like a manual load; status in `storage.session` `auto:<tabId>`, shown in the popup.
5. Jimaku key: entered in popup Settings, `storage.local` `jimakuKey`; never in source or the bundle.

### Phase 1 state (local files)

| Data | Where | Key | Lifetime |
|---|---|---|---|
| Loaded cues for a tab | `storage.session` (background only) | `tab:<tabId>` | until tab closes or browser quits; survives reloads and SW restarts |
| Offset | `storage.local` | `offset:<fileName>\|<count>\|<first start>\|<last end>` | permanent, per subtitle release |

- Popup parses the file and sends `load-subs` to the background, which stores it and broadcasts `subs-updated` to every frame of the tab (`tabs.sendMessage`).
- Each frame asks `get-subs` on start (the background uses `sender.tab.id`), so reloads and late iframes get the cues.
- Offset is keyed by the subtitle file, not the page URL: a cross-origin player iframe can't see the page URL, and the sync error belongs to the subtitle release anyway.
- One overlay per frame, on the frame's largest visible `<video>`. The overlay is a `popover="manual"` element (top layer) and is re-shown on `fullscreenchange`, so it stays above a fullscreen player. Content lives in an open shadow root built with DOM APIs (works on Trusted Types pages).
- Hotkeys (any frame, ignored in text fields): `[` `]` ±0.1 s, `Shift+[` `]` ±1 s, `\` reset.

## Fallback pipeline (LangGraph, phase 3)

```
fetch_context   AniList: synopsis, characters (native names), staff
  → build_glossary
  → transcribe  Whisper / kotoba-whisper, glossary as initial prompt
  → correct     LLM fixes misheard names/terms against glossary
  → score       flag low-confidence lines (shown differently in UI)
  → enrich      optional: literal JA→EN gloss, grammar notes
```

State object carries: `anilist_id`, `episode`, `glossary`, `raw_cues`, `corrected_cues`, `flags`.

## Key constraints

- **Hardsubs**: English subs are burned into the video, so the English track cannot be read; only `currentTime` is used.
- **Cross-origin iframes**: players (e.g. kwik) live in iframes → content script must run with `all_frames: true` and matching host permissions.
- **Sync drift**: different releases differ in timing → manual offset first, auto-alignment later.
- **Site-agnostic**: no selectors tied to one site; domains change often.

## External services

| Service | Use | Auth |
|---|---|---|
| AniList GraphQL (`https://graphql.anilist.co`) | Show metadata, characters | None |
| Jimaku (`https://jimaku.cc/api`) | Japanese subtitle files | API key (`Authorization` header) |
| LLM provider | Correction / gloss | API key |
