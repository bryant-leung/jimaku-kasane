# Roadmap

## Phase 0 — Scaffolding
- [x] Repo layout, docs, env template
- [x] `git init` (GitHub remote optional)
- [x] Extension toolchain (WXT + TypeScript, MV3; Chrome + Safari targets)
- [x] Playwright set up to load the unpacked extension

## Phase 1 — Overlay MVP (no LLM)
- [ ] Content script detects `<video>` in top frame and iframes
- [ ] Load a local `.srt`/`.ass` file via popup
- [ ] Parser → `Cue[]`
- [ ] Overlay renders cue for `currentTime + offset`; survives fullscreen
- [ ] Offset hotkeys (±0.1s / ±1s) persisted per episode
- [ ] AniList search + Jimaku fetch instead of manual file

**Done when:** an episode with Jimaku subs plays with synced Japanese overlay.

## Phase 2 — Learner features
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
