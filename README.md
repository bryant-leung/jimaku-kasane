# JP Sub Overlay (working name)

Browser extension that overlays **Japanese subtitles** on top of streaming anime (which usually ships with hardsubbed English), for Japanese learners watching subbed.

## How it works (target)

1. **Detect** the `<video>` on the page (site-agnostic; any player, including cross-origin iframes).
2. **Identify** the show + episode (page title / manual pick → AniList ID).
3. **Fetch** existing Japanese subs from Jimaku (`.ass` / `.srt`).
4. **Fallback** when none exist: local Python service transcribes the Japanese audio (Whisper) and runs a LangGraph pipeline that corrects names/terms using AniList context (synopsis, characters in kanji).
5. **Render** synced lines over the video, with offset controls, furigana and word lookup.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/ROADMAP.md](docs/ROADMAP.md).

## Repo layout

```
extension/   Manifest V3 browser extension (TypeScript)
server/      Local Python service: Whisper ASR + LangGraph pipeline (FastAPI)
e2e/         Playwright tests (extension loaded into Chromium)
docs/        Architecture, roadmap, decisions
```

## Quick start

```bash
cp .env.example .env              # fill in keys (needed from phase 1)
npm install                       # root workspace (extension + Playwright)
npx playwright install chromium   # first time only

npm run dev        # opens Chrome with the extension loaded, hot reload
# or: npm run build → chrome://extensions → Developer mode → Load unpacked → extension/dist/chrome-mv3

npm run typecheck
npm run test:e2e
```

Server (phase 3): `cd server && uv sync && uv run fastapi dev app/main.py`

## Status

Phase 0 done — extension loads, overlay mounts over any `<video>` (incl. cross-origin iframes). See [docs/ROADMAP.md](docs/ROADMAP.md).

## Disclaimer

Personal learning tool. Does not host, download or redistribute video. Subtitle files are fetched from their public sources at runtime for personal use.
