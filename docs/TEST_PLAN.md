# Test plan

The test cases for every phase in [ROADMAP.md](ROADMAP.md). Each case has an ID that specs, PR test plans and [TEST_RESULTS.md](TEST_RESULTS.md) all refer to.

## Conventions

- **ID:** `P<phase>-<nn>` for automated cases, `M<phase>-<nn>` for manual ones. IDs are never reused; a removed case keeps its ID with `(retired)`.
- **Layers:**
  - **e2e:** Playwright, loads the built extension into Chromium (`e2e/fixtures/extension.ts`). One spec per issue/PR: `e2e/issue-<n>-<slug>.spec.ts`.
  - **unit:** pure TS logic (parsers, timing math). Runner not set up yet; until it is, cover these through e2e.
  - **pytest:** server, in `server/tests/`.
  - **manual:** real browser on a real site; result goes in TEST_RESULTS.md.
- **Fixtures:** fake origins only (`SITE`, `PLAYER` via `context.route`). No real streaming sites, no real LLM, AniList or Jimaku calls in tests: mock them with `page.route` / `context.route`.
- **Selectors:** `getByRole` > `getByLabel` > `getByText` > `data-testid`. The overlay is `role="status"` named "Japanese subtitles".
- **Each case covers:** the happy path; an error path if it calls a network or API; repeat-safety for anything that writes (double click, re-load); the empty state for lists.
- **No `waitForTimeout`.** To control video time, set `video.currentTime` through `page.evaluate` and dispatch `timeupdate`; don't play real media.
- **Run:** `npm run test:e2e -- e2e/<spec>` while iterating; the full suite with `npm run test:e2e` before a PR.

### Adding a case
1. Add a row under the right phase: ID, layer, preconditions, steps, expected.
2. Write the test named after the "Test" column and put the ID in a comment above it.
3. Add a `- [ ]` line to the PR test plan with the run command.
4. Log the run in TEST_RESULTS.md.

---

## Phase 0: Scaffolding ✅

Spec: `e2e/pr-1-phase-0-scaffold.spec.ts`

| ID | Layer | Test | Preconditions | Steps | Expected |
|---|---|---|---|---|---|
| P0-01 | e2e | extension service worker starts | built `dist/chrome-mv3` | launch context | SW registers; extension ID matches `^[a-p]{32}$` |
| P0-02 | e2e | overlay mounts over a video in the top frame | `SITE/watch` has `<video>` | open page | `status` "Japanese subtitles" shows "JP Sub ready" |
| P0-03 | e2e | overlay mounts over a video inside a cross-origin iframe | `SITE/embed` iframes `PLAYER/player` | open page, enter frame | overlay is in the iframe, text "JP Sub ready" |
| P0-04 | e2e | no overlay on a page without video | `SITE/novideo` | open page | heading visible; overlay count is 0 |
| P0-05 | e2e | popup renders with version | — | open `popup.html` | heading "JP Sub Overlay"; text `Version <n>` |

### Manual checks
| ID | Steps | Expected |
|---|---|---|
| M0-01 | `npm run build`, then load `extension/dist/chrome-mv3` unpacked in `chrome://extensions` | Loads with no errors on the card |
| M0-02 | Open any site with an HTML5 video | "JP Sub ready" overlay sits over the video |
| M0-03 | Open a text-only page | No overlay; nothing in the console from the extension |
| M0-04 | Click the toolbar icon | Popup shows name + version 0.1.0 |

---

## Phase 1: Overlay MVP (no LLM)

Spec per issue, e.g. `e2e/issue-<n>-video-detection.spec.ts`. Fixtures needed: `e2e/fixtures/sample.srt` and `sample.ass` with known cues, including an overlapping pair, a multi-line cue and a cue containing `<i>` / `{\an8}` tags.

### Video detection
| ID | Layer | Test | Preconditions | Steps | Expected |
|---|---|---|---|---|---|
| P1-01 | e2e | detects a video added after page load | page starts with no video | inject `<video>` after 500 ms via script | overlay appears (MutationObserver), exactly one |
| P1-02 | e2e | picks the largest video when several exist | page with a 160×90 and a 640×360 video | open page | one overlay, positioned over the 640×360 video |
| P1-03 | e2e | removes overlay when the video is removed | `SITE/watch` | remove `<video>` from the DOM | overlay count is 0; no console errors |
| P1-04 | e2e | detects video in a nested cross-origin iframe (2 levels) | SITE → PLAYER → third origin | open page | overlay in the innermost frame |

### Loading a subtitle file (popup)
| ID | Layer | Test | Preconditions | Steps | Expected |
|---|---|---|---|---|---|
| P1-05 | e2e | loads a .srt file from the popup | `SITE/watch` open | popup → set file input to `sample.srt` | popup shows filename and cue count; overlay gets the cues |
| P1-06 | e2e | loads an .ass file from the popup | as above | set file input to `sample.ass` | styling tags stripped; cue count correct |
| P1-07 | e2e | rejects an unsupported file type | as above | upload `notes.txt` | error message "Unsupported file"; previous cues kept |
| P1-08 | e2e | handles a malformed .srt | as above | upload a file with a broken timestamp | valid cues load; error reports the bad line number |
| P1-09 | e2e | loading a second file replaces the first | `sample.srt` loaded | load `sample.ass` | only the new cues show; no duplicates |
| P1-10 | e2e | handles Shift-JIS / UTF-8 BOM files | fixture in each encoding | load each | Japanese text renders correctly, no mojibake |

### Parser (unit once a runner exists; e2e until then)
| ID | Layer | Test | Input | Expected |
|---|---|---|---|---|
| P1-11 | unit | parses SRT timestamps to seconds | `00:01:02,345` | `62.345` |
| P1-12 | unit | parses ASS timestamps to seconds | `0:01:02.34` | `62.34` |
| P1-13 | unit | keeps multi-line cues | 2-line SRT cue | one `Cue` whose text contains `\n` |
| P1-14 | unit | strips formatting tags | `<i>はい</i>`, `{\an8}はい` | `はい` |
| P1-15 | unit | sorts cues by start time | out-of-order file | `Cue[]` ascending by `start` |
| P1-16 | unit | empty file gives zero cues | `""` | `[]`, no throw |

### Rendering and sync
| ID | Layer | Test | Preconditions | Steps | Expected |
|---|---|---|---|---|---|
| P1-17 | e2e | shows the cue for the current time | cues loaded; cue A 1.0–3.0s | set `currentTime = 2` | overlay text = cue A |
| P1-18 | e2e | clears between cues | gap 3.0–4.0s | set `currentTime = 3.5` | overlay empty (still mounted) |
| P1-19 | e2e | shows both overlapping cues | overlap pair | set time inside overlap | both lines visible, in start order |
| P1-20 | e2e | follows seeking backwards | at 10s | seek to 2s | overlay shows cue A |
| P1-21 | e2e | overlay survives fullscreen | `SITE/watch` | request fullscreen on the video's container | overlay still visible over the video |
| P1-22 | e2e | overlay follows a resized video | 640×360 | resize to 1280×720 | overlay bottom-centred on the new box |

### Offset hotkeys
| ID | Layer | Test | Preconditions | Steps | Expected |
|---|---|---|---|---|---|
| P1-23 | e2e | +0.1s / −0.1s hotkeys shift timing | cue A 1.0–3.0s | press +0.1 key, set time | offset shown as `+0.1s`; cue boundary moves 0.1s |
| P1-24 | e2e | ±1s hotkeys shift timing | as above | press +1s twice | offset `+2.0s` |
| P1-25 | e2e | hotkeys ignored while typing in an input | page has `<input>` focused | press hotkey | offset unchanged |
| P1-26 | e2e | offset persists per episode | offset +1.5 on `/watch?ep=1` | reload page | offset still +1.5 |
| P1-27 | e2e | offset is separate per episode | ep 1 at +1.5 | open `?ep=2` | offset 0 |

### AniList + Jimaku (mocked)
| ID | Layer | Test | Preconditions | Steps | Expected |
|---|---|---|---|---|---|
| P1-28 | e2e | search AniList and list results | AniList GraphQL mocked with 3 shows | type title in popup | 3 results with romaji + native title |
| P1-29 | e2e | AniList with no results | mock returns `[]` | search | "No matches" empty state |
| P1-30 | e2e | AniList error | mock 500 | search | error message, retry button; no crash |
| P1-31 | e2e | fetch Jimaku subs for an episode | Jimaku mocked with a file list + `.srt` body | pick show → episode | cues load; overlay shows text at time |
| P1-32 | e2e | Jimaku has no subs for the episode | mock empty list | pick episode | "No subtitles found"; manual upload still offered |
| P1-33 | e2e | double-clicking fetch sends one request | as P1-31 | double click fetch | exactly 1 request to the Jimaku file URL |
| P1-34 | e2e | no API key in the extension bundle | built dist | grep `dist/` for `sk-`, `JIMAKU_API_KEY` values | no matches (AGENTS.md: extension holds no keys) |

### Manual checks
| ID | Steps | Expected |
|---|---|---|
| M1-01 | Real episode with Jimaku subs, play for 5 min | Lines stay in sync within ±0.3s after setting the offset |
| M1-02 | Toggle fullscreen several times while playing | Overlay never disappears or duplicates |
| M1-03 | Player in a cross-origin iframe on a real site | Overlay works inside the iframe |

**Phase 1 done when:** P1-01..P1-34 pass and M1-01 is logged as a pass.

---

## Phase 2: Learner features

| ID | Layer | Test | Preconditions | Steps | Expected |
|---|---|---|---|---|---|
| P2-01 | unit | tokenises a line with kuromoji | `日本語を勉強する` | tokenise | tokens with surface + reading (katakana) |
| P2-02 | e2e | renders furigana above kanji only | cue with kanji + kana | show cue | `<ruby>` on kanji tokens; no `<rt>` on kana |
| P2-03 | e2e | furigana toggle off | setting off | show cue | no `<rt>` elements |
| P2-04 | e2e | click word opens JMdict popup | cue shown | click `勉強` | popup with reading べんきょう and an English gloss |
| P2-05 | e2e | lookup for an unknown word | click a token not in JMdict | — | "No entry" message; popup closes on Esc |
| P2-06 | e2e | clicking a word pauses the video (if setting on) | playing | click word | `video.paused === true` |
| P2-07 | e2e | font size setting applies and persists | popup | set size 32 → reload | overlay font-size 32px |
| P2-08 | e2e | position setting (top / bottom) | popup | set top | overlay anchored to the top of the video |
| P2-09 | e2e | "show only on pause" | setting on | play → pause | hidden while playing, visible when paused |
| P2-10 | e2e | dictionary load doesn't block the overlay | throttle dict asset | show cue | text shows first, furigana fills in after |

---

## Phase 3: Fallback pipeline (LangGraph server)

### Server (pytest, `server/tests/`)
| ID | Layer | Test | Expected |
|---|---|---|---|
| P3-01 | pytest | `GET /health` | 200 `{"status":"ok"}` |
| P3-02 | pytest | transcribe endpoint rejects a missing / oversized audio chunk | 422 / 413 with a clear message |
| P3-03 | pytest | Whisper output → cues | segments map to `Cue[]` with start/end in seconds |
| P3-04 | pytest | graph runs nodes in order: context → glossary → transcribe → correct → score | node call order recorded; state has each key |
| P3-05 | pytest | glossary node uses show metadata | character names from AniList mock appear in glossary |
| P3-06 | pytest | correct node with the LLM mocked | corrected text replaces raw text; raw text kept |
| P3-07 | pytest | score node gives confidence in [0, 1] | every cue has `confidence` |
| P3-08 | pytest | LLM timeout / 5xx | falls back to raw ASR cue, flagged low-confidence; no 500 |
| P3-09 | pytest | no secrets in responses or logs | API key string absent from response + captured logs |

### Extension
| ID | Layer | Test | Preconditions | Steps | Expected |
|---|---|---|---|---|---|
| P3-10 | e2e | fallback kicks in when no subs are found | Jimaku mock empty; server mocked | start fallback | request to the server; cues stream into the overlay |
| P3-11 | e2e | low-confidence lines styled differently | server mock returns `confidence: 0.3` | show cue | cue has the low-confidence style (e.g. `data-confidence="low"`) |
| P3-12 | e2e | server offline | server route aborts | start fallback | "Server unreachable" message; overlay keeps working with manual subs |
| P3-13 | manual | tab audio capture (`tabCapture` + offscreen doc) | real tab playing audio | start capture | permission prompt once; audio chunks reach server |

---

## Phase 4: Evaluation

| ID | Layer | Test | Expected |
|---|---|---|---|
| P4-01 | pytest | CER metric on known strings | `cer("abc","abd") == 1/3` |
| P4-02 | pytest | timing offset error metric | mean absolute start offset on fixture pairs matches hand-computed value |
| P4-03 | pytest | dataset loader pairs audio with Jimaku reference | every item has audio + reference cues; missing ones reported, not skipped silently |
| P4-04 | pytest | report compares raw vs corrected vs corrected+glossary | three columns per metric; deterministic with a fixed seed |

---

## Phase 5: Stretch (outline; detail when started)

| ID | Layer | Test |
|---|---|---|
| P5-01 | e2e | gloss mode shows a literal EN line under the JP line |
| P5-02 | pytest | auto-sync aligns a cue set shifted by +2s to within ±0.2s |
| P5-03 | e2e | Anki export produces a card with sentence, reading, gloss and screenshot |
