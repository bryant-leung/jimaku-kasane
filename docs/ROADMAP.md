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

## Phase 3a — Audio auto-sync (moved up: TV-rip subs are offset from streams)
- [x] Tab audio capture (`tabCapture` + offscreen document), one click in the popup
- [x] Speech detection + alignment with cue timings → offset set automatically
- [ ] Manual check on real episodes (M3-01)

## Phase 3b — Whisper fallback (next)
- [ ] FastAPI server skeleton, `/health`
- [ ] Whisper transcription → cues, streamed while the episode plays
- [ ] LangGraph: context → glossary → transcribe → correct → score
- [ ] Low-confidence lines styled differently

## Phase 2 — Learner features (after 3b)
- [ ] Furigana (kuromoji.js tokenisation)
- [ ] Click word → JMdict lookup popup
- [ ] Toggle / style settings (size, position, show only on pause)

## Phase 3 — Fallback pipeline (LangGraph)
- [ ] FastAPI server skeleton, `/health`
- [ ] Audio capture from tab (`chrome.tabCapture` + offscreen document)
- [ ] Whisper transcription → cues
- [ ] LangGraph: context → glossary → transcribe → correct → score
- [ ] Low-confidence lines styled differently

## Phase 4 — Evaluation
- [ ] Dataset: episodes that *do* have Jimaku subs
- [ ] Metrics: character error rate (raw ASR vs corrected), timing offset error
- [ ] Report: does glossary context measurably help?

## Phase 5 — Stretch
- [ ] Literal JA→EN gloss mode (same direction as FYP)
- [ ] Auto sync alignment (match cue timings to detected speech)
- [ ] Anki export of a line + screenshot
