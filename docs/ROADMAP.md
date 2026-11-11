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
- [x] Manual check on a real episode (Chitose ep 18): real Japanese lines, names right
- [ ] Manual check with Ollama running (correction step)

## Phase 2 — Learner features (next)
- [ ] Furigana (kuromoji.js tokenisation)
- [ ] Click word → JMdict lookup popup
- [x] On/off switch and per-site off
- [ ] Style settings (size, position, show only on pause); currently small, under the hardsubs

## Phase 4 — Evaluation
- [ ] Dataset: episodes that *do* have Jimaku subs
- [ ] Metrics: character error rate (raw ASR vs corrected), timing offset error
- [ ] Report: does glossary context measurably help?

## Phase 5 — Stretch
- [ ] Literal JA→EN gloss mode (same direction as FYP)
- [x] ~~Auto sync alignment~~ (done in Phase 3a)
- [ ] Read-ahead from the player's buffered stream for zero-delay transcription (experiment)
- [ ] Anki export of a line + screenshot
