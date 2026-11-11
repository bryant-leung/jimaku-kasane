# Test plan

The test cases for every phase in [ROADMAP.md](ROADMAP.md). Each case has an ID that specs, PR test plans and [TEST_RESULTS.md](TEST_RESULTS.md) all refer to.

## Conventions

- **ID:** `P<phase>-<nn>` for automated cases, `M<phase>-<nn>` for manual ones. IDs are never reused; a removed case keeps its ID with `(retired)`.
- **Layers:**
  - **e2e:** Playwright, loads the built extension into Chromium (`e2e/fixtures/extension.ts`). One spec per issue/PR: `e2e/issue-<n>-<slug>.spec.ts`.
  - **unit:** pure TS logic (parsers, timing math). Runs in Node under the Playwright runner: import from `extension/src/lib/` and use the plain `@playwright/test` `test` (no browser launched).
  - **pytest:** server, in `server/tests/`.
  - **manual:** real browser on a real site; result goes in TEST_RESULTS.md.
- **Fixtures:** fake origins only (`SITE`, `PLAYER` via `context.route`). No real streaming sites, no real LLM, AniList or Jimaku calls in tests: mock them with `page.route` / `context.route`.
- **Selectors:** `getByRole` > `getByLabel` > `getByText` > `data-testid`. The overlay is `role="status"` named "Japanese subtitles".
- **Each case covers:** the happy path; an error path if it calls a network or API; repeat-safety for anything that writes (double click, re-load); the empty state for lists.
- **No `waitForTimeout`.** To control video time use `setTime(page | frame, seconds)` from `e2e/fixtures/extension.ts` (sets `currentTime`, fires `timeupdate`); don't play real media.
- **Helpers** (`e2e/fixtures/extension.ts`): `openPopup(context, extensionId, page)` opens the popup bound to that page's tab (`popup.html?tabId=`), `loadFile(popup, 'sample.srt' | {name, mimeType, buffer})`, `overlayIn(page | frameLocator)`.
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

Local-file MVP spec: `e2e/pr-2-phase-1-overlay-mvp.spec.ts` (P1-01..P1-27, P1-35..P1-39, all passing). AniList + Jimaku (P1-28..P1-34) get their own spec.

Fixtures in `e2e/fixtures/`: `sample.srt` (4 cues: overlap at 6.0–6.5 s, a multi-line cue, `<i>` and `{\an8}` tags, a cue at 1:02.345), `sample.ass` (3 dialogue cues + a Comment + a `\p1` drawing), `malformed.srt` (bad timestamp on line 6), `notes.txt`. Shift-JIS / BOM / UTF-16 files are built in the spec.

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
| P1-38 | e2e | renders cues inside a cross-origin iframe player | `SITE/embed`, srt loaded | set time in the player frame | iframe overlay shows the cue |

### Parser (unit once a runner exists; e2e until then)
| ID | Layer | Test | Input | Expected |
|---|---|---|---|---|
| P1-11 | unit | parses SRT timestamps to seconds | `00:01:02,345` | `62.345` |
| P1-12 | unit | parses ASS timestamps to seconds | `0:01:02.34` | `62.34` |
| P1-13 | unit | keeps multi-line cues | 2-line SRT cue | one `Cue` whose text contains `\n` |
| P1-14 | unit | strips formatting tags | `<i>はい</i>`, `{\an8}はい` | `はい` |
| P1-15 | unit | sorts cues by start time | out-of-order file | `Cue[]` ascending by `start` |
| P1-16 | unit | empty file gives zero cues | `""` | `[]`, no throw |
| P1-35 | unit | skips ASS comments and drawings | `sample.ass` | no `Comment:` text, no `\p1` vector cue |
| P1-36 | unit | reports the line number of a broken timestamp | `malformed.srt` | 2 cues; issue `{ line: 6, message: 'Invalid timestamp' }` |
| P1-37 | unit | decodes Shift-JIS, UTF-8 BOM and UTF-16 | same cue in each encoding | `日本語です` every time |

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

Offset is stored per subtitle file (not page URL: a cross-origin player can't see it). Positive = subtitles later; shown time = `currentTime − offset`. Keys: `[` `]` ±0.1 s, `Shift+[` `]` ±1 s, `\` reset.

| ID | Layer | Test | Preconditions | Steps | Expected |
|---|---|---|---|---|---|
| P1-23 | e2e | +0.1s / -0.1s hotkeys shift timing | cue A 1.0–3.0s | press `]`, set time; press `[` twice | badge `Offset +0.1s`, cue starts at 1.1; then `-0.1s`, starts at 0.9 |
| P1-24 | e2e | ±1s hotkeys shift timing | as above | `Shift+]` twice, then `\` | badge + popup `+2.0s`; reset to `+0.0s` |
| P1-25 | e2e | hotkeys ignored while typing in an input | page has `<input>` focused | press hotkey | offset unchanged |
| P1-26 | e2e | offset persists per subtitle file across reload | offset +1.1 | reload page | cues still loaded, cue A starts at 2.1 |
| P1-27 | e2e | offset is separate per subtitle file | srt at +1.0 | load ass, then srt again | ass at `+0.0s`; srt back to `+1.0s` |
| P1-39 | e2e | popup offset buttons shift timing | srt loaded | click `-0.1s`, `-1s` | popup `-1.1s`; cue A shows at 0.5 s, gone at 2 s |

### AniList + Jimaku (automatic, mocked)

Spec: `e2e/pr-4-auto-subs.spec.ts`. Mocks in `e2e/fixtures/apis.ts` mirror real numbering: site ep 44 = AniList S2 Part 2 ep 5 = Jimaku "S2 - 17". The same fake data backs the Node unit tests (`fakeHttp`) and browser tests (`mockApis`, service worker requests routed).

| ID | Layer | Test | Expected |
|---|---|---|---|
| P1-28 | e2e | loads subtitles automatically when an episode opens | title `… Ep. 44 :: site` + iframe video → S2 - 17.srt downloaded, cue shows in player iframe, popup `Auto: Loaded … ep 17 from Jimaku`; `.sup` never fetched |
| P1-30 | e2e | asks for an API key, then loads once it is saved | `Auto: Add your Jimaku API key in Settings.`; save in Settings → loads; key not echoed |
| P1-32 | e2e | says when Jimaku has no subtitles yet; manual upload still works | `Auto: No Japanese subtitles on Jimaku for … ep 44 yet.`; manual .ass loads |
| P1-50 | e2e | reloading while the lookup is running still loads the subtitles | download held 1.5 s, page reloaded mid-download → subs shown |
| P1-51 | e2e | the next episode starts from the show's last offset | +3.6 set on ep 44 → ep 45 loads with +3.6 and popup says so |
| P1-33 | e2e | no-video pages with episode-like titles trigger no lookups | zero AniList/Jimaku requests |
| P1-45 | e2e | reports a show AniList does not know | `Auto: “…” not found on AniList.` |
| P1-46 | e2e | reloading the episode does not download again | 1 download; cues still shown after reload |
| P1-47 | e2e | loads from a "Show Season 2 Part 2 - 44" title | animepahe-style title → subs load |
| P1-48 | e2e | explains when the page title has no episode number | `Auto: No episode number in the page title “…”` |
| P1-40 | unit | parses episode from page titles | `Ep. 44`, `Episode 1100`, `EP 12`, `Show - 44 :: site`; `Re:Zero - Starting…`, `86 - Eighty Six` → null |
| P1-41 | unit | maps absolute episode numbers to season candidates | 44 → (Part 2, 5), (Part 2, 17), (Part 2, 44); per-season numbering kept |
| P1-42 | unit | walks AniList prequels and sequels in order | S1 27 → S2 12 → Part 2 null |
| P1-43 | unit | picks text subtitle files only | .srt > .ass; .sup/.zip skipped |
| P1-44 | unit | reports no key, not found and a bad key | states `no-key`, `not-found`, `error` (401) |
| P1-29, P1-31, P1-34 | (retired) | superseded by the automatic flow; the key is entered at runtime and never in source or the bundle | |

### Manual checks
| ID | Steps | Expected |
|---|---|---|
| M1-01 | Real episode with Jimaku subs, play for 5 min | Lines stay in sync within ±0.3s after setting the offset |
| M1-02 | Toggle fullscreen several times while playing | Overlay never disappears or duplicates |
| M1-03 | Player in a cross-origin iframe on a real site | Overlay works inside the iframe |

**Phase 1 done when:** P1-01..P1-46 pass and M1-01 is logged as a pass.

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

## Phase 3a: Audio auto-sync

Spec: `e2e/pr-5-auto-sync.spec.ts`. Alignment runs in Node on synthetic audio (seeded PRNG): speech loud where shifted cues are active, noise elsewhere.

| ID | Layer | Test | Expected |
|---|---|---|---|
| P3-33 | unit | accepts an answer repeated across three checks | 3 agreeing guesses (±0.2 s, conf ≥ 4) → accepted; too few / disagreeing / weak → null |
| P3-14 | unit | maps audio frames to video time and drops paused stretches | paused + stale (>1 s since a time sample) frames dropped |
| P3-15 | unit | finds a positive offset (subtitles early) | +2.3 |
| P3-16 | unit | finds a negative offset (subtitles late) | -1.5 |
| P3-17 | unit | finds a large offset within ±20 s | +12.4 |
| P3-18 | unit | gives no offset when audio does not match the subtitles | null |
| P3-19 | unit | gives no offset when there is too little speech | null, speech < 8 s |
| P3-21 | unit | finds the offset under loud background music | +3.4 with a ±6 dB drifting music bed, speech only +6 dB |
| P3-22 | unit | finds an offset beyond 20 s | -37.5 (search is ±60 s) |
| P3-23 | unit | finds +3.0 s (the Yozakura ep 44 case) with the VAD | Silero VAD over `speech-music.wav` (12 TTS lines, music at 0.7× speech loudness) → +3.0 ±0.2 |
| P3-24 | unit | finds -2.4 s with the VAD | -2.4 ±0.2 |
| P3-25 | unit | gives no offset when the dialogue belongs to another episode | null |
| P3-26 | e2e | loads the bundled runtime and model under the extension CSP | offscreen page loads ORT wasm + model; silence < 0.5; no CSP/wasm errors |
| P3-27 | unit | uses only the audible video clock when several videos report time | muted background clip 40 s ahead is ignored → +2.3 |
| P3-28 | unit | finds +3.2 s with back-to-back TV captions (no gaps, lines split) | caption-start matching → +3.2 ±0.2 |
| P3-29 | unit | gives no offset for back-to-back captions from another episode | null (confidence 5.3 < 7) |
| P3-30 | e2e | fixes a 3.2 s offset by itself while the episode plays | `/talk` plays speech-music.wav; .srt 3.2 s early loaded → popup `Auto-synced: offset +3.2s` (±0.2), no clicks |
| P3-32 | e2e | listens to the player, not a muted glow copy in the page | big muted copy in the page + real player in a cross-origin iframe → `Auto-synced: offset +3.2s` |
| P3-31 | e2e | leaves an already-correct file alone | `Auto-sync: timing already matches (offset ±0.0/0.1s)` |
| P3-20 | e2e | is disabled until subtitles are loaded, and explains a refused capture | button disabled → enabled; clear error, no hang |
| M3-01 | manual | real episode with TV-rip subs: click Auto-sync, keep playing ≤60 s | `Synced: offset +x.xs`; lines match the English hardsubs |

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
