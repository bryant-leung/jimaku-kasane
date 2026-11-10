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
5. Content script renders the cue matching `video.currentTime + offset`.

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
