# Roadmap

## Phase 0 — Scaffolding
- [x] Repo layout, docs, env template
- [x] `git init` (GitHub remote optional)
- [x] Extension toolchain (WXT + TypeScript, MV3; Chrome + Safari targets)
- [x] Playwright set up to load the unpacked extension

## Phase 1 — Overlay MVP (no LLM)
- [x] Content script detects `<video>` in top frame and iframes
- [x] Load a local `.srt`/`.ass` file via popup
- [x] Parser → `Cue[]`
- [x] Overlay renders cue for `currentTime − offset`; survives fullscreen
- [x] Offset hotkeys (±0.1s / ±1s) persisted per subtitle file
- [x] AniList search + Jimaku fetch instead of manual file (automatic from the page title)

**Done when:** an episode with Jimaku subs plays with synced Japanese overlay.

## Phase 3a — Audio auto-sync (moved up from Phase 5: TV-rip subs are offset from streams)
- [x] Silero VAD (on-device) + alignment with cue timings; caption-start matching for gap-free TV files
- [x] Fully automatic while the episode plays (reads the video element's audio); button kept as fallback
- [x] Remembers the offset per show and uses it as a hint; learns your usual correction
- [x] Leaves already-correct files alone; on/off switch and per-site off
- [x] Manual check on real episodes (M3-01): Yozakura ep 44 +3.8 s, ep 41 +3.7 s vs +3.6–4.0 s by hand

## Phase 3b — Whisper fallback
- [x] FastAPI server, `/health`, `/transcribe` (MLX Whisper large-v3-turbo)
- [x] Live: VAD-cut speech segments → server → lines appear while the episode plays
- [x] LangGraph: fetch_context → build_glossary → transcribe → correct (Ollama) → score
- [x] Low-confidence lines styled differently
- [x] Drafts while a line is being spoken (~1 s after speech starts), replaced by the finished line
- [x] Prepare ahead (default): minimized muted copy at 1.5× → lines timed exactly, no delay
- [x] Manual check on a real episode (Chitose ep 18): real Japanese lines, names right
- [ ] Manual check with Ollama running (correction step)

## Plan from here (2026-11-13), built one at a time, one PR each

| # | Item | Why | State |
|---|---|---|---|
| 1 | Manual check: helper copy on animepahe (after d072441) | only untested piece; release-day path | waiting on you |
| 2 | **Compare mode** (Phase 4): on an episode Jimaku *has*, run Whisper alongside and score it against the real file (CER, timing) → report in the popup | real error rate; tune glossary/threshold; FYP evidence | built (PR 8); real-episode run pending |
| 3 | Toolbar badge: `JP` file · `AI` Whisper · `…` preparing · `!` problem | status without opening the popup | built (PR 9) |
| 4 | Replay current line (hotkey) | shadowing | built (PR 10) |
| 5 | Click a word → dictionary popup (offline JMdict) | nothing extra on screen unless clicked; words above your level (default N1 + rare) get a dotted underline | built (PR 11) |
| 6 | Save line → list, export to Anki (later: audio clip) | review | next |
| 7 | Study mode: pause after each line (off by default) | intensive watching | planned |
| 8 | Style settings: size, position nudge, background | readability | planned |
| 9 | Hide JP line until a key is held ("test yourself") | listening practice | planned |
| 10 | Episode history in the popup (source, offset) | overview | planned |
| 11 | Read on-screen JP subtitles from services that show them (e.g. Netflix) | official text on release day | optional |
| 12 | Safari build | other browser | optional |

Furigana stays out (your own plan for later).

## Phase 2 — Learner features
- [ ] Furigana (kuromoji.js tokenisation)
- [x] Click word → JMdict lookup card (offline), JLPT-level underlines
- [x] On/off switch and per-site off
- [ ] Style settings (size, position, show only on pause); currently small, under the hardsubs

## Phase 4 — Evaluation
- [x] Compare mode: Whisper alongside a real file while you watch (no audio stored)
- [x] Metrics: character error rate (before vs after correction), timing (median)
- [ ] Run on several real episodes; copy the report
- [ ] Report: does glossary context measurably help?

## Phase 5 — Stretch
- [ ] Literal JA→EN gloss mode (same direction as FYP)
- [x] ~~Auto sync alignment~~ (done in Phase 3a)
- [ ] Read-ahead from the player's buffered stream for zero-delay transcription (experiment)
- [ ] Anki export of a line + screenshot
