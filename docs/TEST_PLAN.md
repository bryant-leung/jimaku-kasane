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
| P0-05 | e2e | popup renders with version | — | open `popup.html` | heading "JimakuKasane 字幕重ね"; text `Version <n>` |
| P0-B1 | e2e | manifest name, description and icons (PR 21) | — | read manifest | name "JimakuKasane 字幕重ね"; icons 16/32/48/128 |
| P0-B2 | e2e | icons load and are the right size (PR 21) | — | open each icon | natural size = declared size |
| P0-B3 | e2e | popup heading and toolbar tooltip use the new name (PR 21) | file loaded | open popup | heading + title "JimakuKasane 字幕重ね"; tooltip "JimakuKasane: …" |

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

### On/off switches
| ID | Layer | Test | Expected |
|---|---|---|---|
| P1-53 | e2e | switching off hides the subtitles everywhere, switching on brings them back | uncheck → no overlay; check → cue shown again |
| P1-54 | e2e | "Off on this site" hides the overlay on that site only, also inside its player iframe | site off → no overlay in its iframe; other site unaffected |

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
| P1-52 | e2e | (in P1-32) offers "Check Jimaku again" when nothing was found | button visible; not-found results also expire after 30 min |
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
| P2-07 | e2e | text size changes the line size and is remembered after a reload (PR 14) | popup | Larger → reload | font ≥ 1.4× normal, same after reload |
| P2-08 | e2e | height lifts the line by a share of the video height (PR 14) | popup | Much higher | line 20 % of the video height higher (±3 px) |
| P2-09 | e2e | listening practice: hides the line; holding H shows it, releasing hides it again (PR 15) | setting on | hold H → release | hidden → visible → hidden |
| P2-10 | e2e | dictionary load doesn't block the overlay | throttle dict asset | show cue | text shows first, furigana fills in after |

Toolbar badge (PR 9, `e2e/pr-9-toolbar-badge.spec.ts`):

| ID | Layer | Test | Expected |
|---|---|---|---|
| P2-B1 | e2e | shows JP when Japanese subtitles are loaded, with the file in the tooltip | badge `JP`, tooltip names the file |
| P2-B2 | e2e | shows … while looking up the episode | `…` during a slow download, then `JP` |
| P2-B3 | e2e | shows ! when something needs you (no Jimaku key) | `!`, tooltip mentions the key |
| P2-B4 | e2e | shows AI while Whisper transcribes | `AI`, tooltip mentions Whisper |
| P2-B5 | e2e | shows ! when Jimaku has nothing and the server is off | `!` |
| P2-B6 | e2e | clears when switched off, comes back when switched on | `''` then `JP` |

Replay line (PR 10, `e2e/pr-10-replay-line.spec.ts`):

| ID | Layer | Test | Expected |
|---|---|---|---|
| P2-R1 | e2e | R jumps back to the start of the line being shown | video to line 3 start (−0.15 s), keeps playing |
| P2-R2 | e2e | R pressed right after a line starts goes to the line before | second press → line 2 |
| P2-R3 | e2e | works when the key is pressed on the page and the player is in an iframe | iframe video jumps |
| P2-R4 | e2e | follows the subtitle offset | offset +1 → jumps to where line 3 is shown |
| P2-R5 | e2e | does nothing while typing in a text field, or with no subtitles loaded | no jump; the field gets the `r` |
| P2-R6 | unit (in e2e) | replay target maths | drafts ignored, never before 0, previous line within 1 s |

Word lookup (PR 11, `e2e/pr-11-word-lookup.spec.ts`, real dictionary from `npm run dict`):

| ID | Layer | Test | Expected |
|---|---|---|---|
| P2-W1 | e2e | underlines words above N2 by default: N1 and rare ones only | `漠然とした気持ちを弄んでいる` → marks `漠然`, `弄んでいる` |
| P2-W2 | e2e | clicking a word pauses the video and shows its meaning; Esc closes and resumes | card: 漠然 ばくぜん N1 "vague"; paused; Esc → hidden, playing |
| P2-W3 | e2e | finds the dictionary form of an inflected word | 弄んでいる → 弄ぶ もてあそぶ; ✕ closes, playing |
| P2-W4 | e2e | the underline level follows the setting | default 2; N1 → rare only; Off → none; N3 → both |
| P2-W5 | e2e | clicking elsewhere closes the card; pressing play closes it too | hidden after page click / play |
| P2-W6 | unit (in e2e) | dictionary logic: inflections, word splitting and marking | 食べなかった/食べられなかった → 食べる, 行って → 行く, 勉強しない → 勉強, 今日は → 今日 + は |

Word splitting (PR 26, `e2e/pr-26-word-splitting.spec.ts`, real kuromoji + JMdict):

| ID | Layer | Test | Expected |
|---|---|---|---|
| P2-K1 | unit (in e2e) | names stay whole and are marked as names, never underlined | 久美子 → name, くみこ; no 美; at N5 only 先輩 underlined |
| P2-K2 | unit (in e2e) | verbs and adjectives keep their endings | 漠然と / した / 気持ち / を / 弄んでいる; 勉強しなかった; あきらめないで |
| P2-K3 | unit (in e2e) | kana words get the same entry and level as the kanji spelling | あきらめないで = 諦めないで (諦める); ことごとく N1, underlined at N2 |
| P2-K4 | unit (in e2e) | particles and inflected verbs are looked up as what they are | は, ね → particle (not 歯, 根); した → する (shown as する, not 為る) |
| P2-K5 | unit (in e2e) | a piece of an unknown surname isn't underlined | 黄前久美子 → nothing underlined |
| P2-K6 | e2e | clicking a name shows it as a name with its reading | card: 久美子 くみこ Name |
| P2-K7 | e2e | a kana-written N1 word is underlined and shows its usual spelling | ことごとく underlined; card 悉く N1 |

Example sentences (PR 27, `e2e/pr-27-example-sentences.spec.ts`):

| ID | Layer | Test | Expected |
|---|---|---|---|
| P2-X1 | unit (in e2e) | dictionary entries carry Tatoeba sentences with English | 諦める: 1–2 [ja, en] pairs |
| P2-X2 | e2e | the card shows example sentences with English | "Examples" section, Japanese + English |
| P2-X3 | e2e | the card lists other lines of this episode with the same word | `0:20 もう諦めた`, `0:35 絶対に諦めるな`; not the unrelated line or the current one |
| P2-X4 | e2e | clicking an episode line jumps the video there | card closes; video at 20 s |

Study notebook, automatic logging (PR 28, `e2e/pr-28-notebook-logging.spec.ts`):

| ID | Layer | Test | Expected |
|---|---|---|---|
| P2-N1 | unit (in e2e) | once per episode, not learned words, at most 80 | duplicates, already logged and learned dropped; 79 + 2 → 1 |
| P2-N2 | e2e | hard words in a line on screen are logged with the line and a screenshot | 漠然 (N1), 弄ぶ; line, time 0, source auto; one shared JPEG > 1 KB |
| P2-N3 | e2e | the popup shows the notebook size; the same line again adds nothing | "Notebook: 2 words"; replay → still 2 |
| P2-N4 | e2e | with logging off, only words you click are logged | none after 2.5 s; click 気持ち → [気持ち, click] |
| P2-N5 | e2e | words marked learned are not logged | learned 漠然 → only 弄ぶ |
| P2-N6 | e2e | the log level setting is in Settings, default N3 | select shows 3; N1 → `notebookLogAbove` 1 |

Notebook page (PR 29, `e2e/pr-29-notebook-page.spec.ts`):

| ID | Layer | Test | Expected |
|---|---|---|---|
| P2-B1 | unit (in e2e) | show names from page titles; filters | "Hibike! Euphonium - Episode 3 - AnimePahe" → "Hibike! Euphonium"; search / level / show / learned |
| P2-B2 | e2e | the popup opens the notebook: words by show and episode, with line and screenshot | 3 words in 2 shows; 漠然 ばくぜん N1, meaning, `<mark>漠然</mark>`, 1:05, image loaded; click source shown |
| P2-B3 | e2e | search, level and show filters narrow the list | "play with" → 弄ぶ; N2 → 諦める; show → 2 |
| P2-B4 | e2e | Learned hides a word and stops it being logged; it can be undone | hidden, `notebookLearned` [漠然]; Not learned restores (logging skip: P2-N5) |
| P2-B5 | e2e | Delete removes the word and its unused screenshot | 3/3 → 2/2 entries/shots |
| P2-B6 | e2e | clicking a screenshot enlarges it; a click closes it | dialog shown, then hidden |
| P2-B7 | e2e | words logged while you watch appear in the notebook | play line → 漠然 card with image, 弄ぶ with its line |

Grammar points (PR 30, `e2e/pr-30-grammar-points.spec.ts`, real kuromoji):

| ID | Layer | Test | Expected |
|---|---|---|---|
| P2-G1 | unit (in e2e) | every pattern matches its own example | ≥ 120 patterns; none missed, every core compiles |
| P2-G2 | unit (in e2e) | conjugated forms count, and the match covers the pattern | 得なかった, いかなかった, しかねます; span = にもかかわらず |
| P2-G3 | unit (in e2e) | everyday lines match nothing; a pattern inside a longer one is dropped | 15 ordinary lines (incl. 好きにしろよ, ものだ, べきだ) → none; しかねない → only ～かねない |
| P2-G4 | e2e | a grammar pattern in a line on screen is logged with its meaning and place in the line | ～ざるを得ない, N2, "no choice", span ざるを得なかっ, screenshot |
| P2-G5 | e2e | logging harder than N2 skips N2 patterns | next episode at N2 → no new grammar entry |
| P2-G6 | e2e | the notebook page filters grammar and labels it | Type = Grammar → 1 card "N2 grammar", marked span; Words → hidden |

Anki export with pictures (PR 31, `e2e/pr-31-anki-apkg.spec.ts`):

| ID | Layer | Test | Expected |
|---|---|---|---|
| P2-A1 | unit (in e2e) | a valid deck: notes with sentence, picture and tags; one image per screenshot | zip CRCs ok; `collection.anki2` integrity ok, ver 11, 7 fields, deck name; `<b>` sentence, `<img>`, HTML escaped, shared shot stored once, grammar label/tags |
| P2-A2 | unit (in e2e) | exporting again gives the same note ids for the same words | GUIDs equal across builds, unique per word |
| P2-A3 | e2e | Export for Anki downloads a deck with every listed word and its screenshot | `jimaku-kasane-notebook-YYYY-MM-DD.apkg`, 3 notes, 3 JPEGs, status text |
| P2-A4 | e2e | the export follows the filters | Type = Grammar → only ～ざるを得ない |
| M-A1 | manual (scripted) | Anki's own importer accepts the file | `anki` 26.09.4 `import_anki_package`: 3 new notes in *JimakuKasane notebook*, media present, none missing; re-import → 3 duplicates, 0 new |

Screenshot crop and real-player fullscreen (PR 32, `e2e/pr-32-shot-crop.spec.ts`):

| ID | Layer | Test | Expected |
|---|---|---|---|
| P2-C1 | unit (in e2e) | crops to the video; keeps the whole tab in fullscreen, off screen or when the video fills it | box in screenshot px (also at 2×), clipped to the image; null for fullscreen / off screen / full tab |
| P2-C2 | e2e | video on the page: the site around it is left out | magenta page around the video → < 2 % magenta in the shot, ≤ 640 px |
| P2-C3 | e2e | player in a cross-origin iframe: still cropped to the video | same, through the iframe's offset |
| P2-C4 | e2e | a word clicks in fullscreen even when the player box toggles play on click | card opens, video stays paused |
Word clicks in fullscreen (PR 24, `e2e/pr-24-fullscreen-clicks.spec.ts`):

| ID | Layer | Test | Expected |
|---|---|---|---|
| P2-F1 | e2e | clicking a word in a fullscreen player opens its card | box fullscreen → click 漠然 → card ばくぜん (failed before the fix: video intercepted the click) |
| P2-F2 | e2e | after leaving fullscreen the overlay moves back and words still click | overlay inside `#box` while fullscreen, under `<html>` after; card opens |
| P2-F3 | e2e | fullscreen player inside a cross-origin iframe: words click | like animepahe/Kwik; card opens in the iframe |
| P2-F4 | e2e | a fullscreen `<video>` itself still shows the line | line visible (clicks can't reach it: known limit) |

Save for review (PR 12, `e2e/pr-12-save-lines.spec.ts`):

| ID | Layer | Test | Expected |
|---|---|---|---|
| P2-S1 | e2e | S saves the line on screen, with where it came from | "Saved: …" note; 1 card with line + source; popup count 1 |
| P2-S2 | e2e | Save in the dictionary card saves the word, its reading and meaning, and the line | 漠然 / ばくぜん / "vague" / line |
| P2-S3 | e2e | works when the key is pressed on the page and the player is in an iframe | 1 card |
| P2-S4 | e2e | Export for Anki downloads an import file with every saved item | header lines + 2 rows; word bolded in the line |
| P2-S5 | e2e | Clear needs a second click, then empties the list | "Really clear 1?" then 0 |
| P2-S6 | unit (in e2e) | export format and current-line maths | escaping, clock format, drafts ignored, offset |

Study mode (PR 13, `e2e/pr-13-study-mode.spec.ts`):

| ID | Layer | Test | Expected |
|---|---|---|---|
| P2-M1 | e2e | pauses when each line ends; play continues to the next line | paused within 0.3 s after line 1 end, then line 2 end; note shown; the ended line stays on screen while paused (PR 15) |
| P2-M2 | e2e | R after the pause replays the line and pauses at its end again | back before line 1, paused again at its end |
| P2-M3 | e2e | off by default: playback runs past line ends | switch unchecked, still playing past line 2 |
| P2-M4 | e2e | skipping over lines does not pause | seek 0→19.5 s keeps playing |

Style settings (PR 14, `e2e/pr-14-style-settings.spec.ts`):

| ID | Layer | Test | Expected |
|---|---|---|---|
| P2-07 | e2e | text size changes the line size and is remembered after a reload | see above |
| P2-08 | e2e | height lifts the line by a share of the video height | see above |
| P2-Y1 | e2e | dark box puts a background behind the text | rgba(0,0,0,0.6) behind the line |
| P2-Y2 | e2e | defaults: normal size, under the English subs, no box | 100 / 0 / unchecked |
| P2-Y3 | e2e | the popup shows the saved style when reopened | 125 / 10 / checked |

Listening practice (PR 15, `e2e/pr-15-listening-practice.spec.ts`):

| ID | Layer | Test | Expected |
|---|---|---|---|
| P2-09 | e2e | hides the line; holding H shows it, releasing hides it again | see above |
| P2-L1 | e2e | works when the key is pressed on the page and the player is in an iframe | iframe line shows while H held |
| P2-L2 | e2e | off by default: the line shows as usual | unchecked, visible |
| P2-L3 | e2e | with study mode: the line shows when the video pauses at its end, hides again on play | visible with 台詞1 while paused, hidden on play |

History (PR 16, `e2e/pr-16-history.spec.ts`):

| ID | Layer | Test | Expected |
|---|---|---|---|
| P2-H1 | e2e | lists an auto-loaded episode with its source and a link back to the page | Show ep 44 · Jimaku, link to the page |
| P2-H2 | e2e | a file you load yourself shows as your file, with the offset you set | sample.srt · your file · offset +1.0s |
| P2-H3 | e2e | an episode transcribed by Whisper shows as Whisper | ep 44 · Whisper |
| P2-H4 | e2e | empty history says what will appear | hint, 0 items |
| P2-H5 | unit (in e2e) | same episode again moves to the top instead of repeating; at most 30 kept | dedupe + cap |

Page's own Japanese subtitles (PR 17, `e2e/pr-17-page-tracks.spec.ts`):

| ID | Layer | Test | Expected |
|---|---|---|---|
| P1-T1 | e2e | uses the video's Japanese track instead of Jimaku, and says so | track text shown (tags stripped), popup says so, a later Jimaku answer doesn't replace it, track mode hidden |
| P1-T2 | e2e | ignores tracks in other languages (Jimaku as usual) | Loaded … from Jimaku |
| P1-T3 | e2e | picks up lines added to the track later (streamed subtitles) | second cue added after 2.5 s shows |
| P1-T4 | e2e | no Whisper when the page has Japanese subtitles and Jimaku has none | 0 transcribe requests in 6 s of speech |
| P1-T5 | e2e | shows in history as the page's own subtitles | history source |

---

## Phase 3a: Audio auto-sync

Spec: `e2e/pr-5-auto-sync.spec.ts`. Alignment runs in Node on synthetic audio (seeded PRNG): speech loud where shifted cues are active, noise elsewhere.

| ID | Layer | Test | Expected |
|---|---|---|---|
| P3-33 | unit | accepts an answer repeated across three checks | 3 agreeing guesses (±0.2 s, conf ≥ 4) → accepted; too few / disagreeing / weak → null |
| P3-34 | unit | uses the show's remembered offset to settle on less audio | 15 s of audio, hint +3.6 → +3.2 ±0.2 |
| P3-35 | unit | a remembered offset does not force a match for the wrong episode | gappy and gapless wrong-episode cues + hint → null |
| P3-36 | e2e | (in P3-30) nudging after a sync teaches your usual correction | +0.3 after sync → `syncBiasLog` has one entry, d 0.3 (was `syncBias` before PR 25) |
| P3-37 | e2e | applies your usual correction to the next sync | bias 0.3 + 3.2 s early file → `+3.5s (includes your +0.3s adjustment)` |

Steadier offset (PR 25, `e2e/pr-25-steadier-offset.spec.ts`):

| ID | Layer | Test | Expected |
|---|---|---|---|
| P3-S1 | unit | close to the remembered offset, one confident check is enough | −0.9 vs −0.7 → −0.9; no prior → applied |
| P3-S2 | unit | a jump of more than 0.5 s must be found again on the next check | −1.8 vs −0.7 once → keep listening; then −0.7 → −0.7; then −1.8 → −1.8 |
| P3-S3 | unit | small manual changes are learned per file; big ones are fixes and forgotten | last change per file; > 0.5 s removes it; capped at 20 files |
| P3-S4 | unit | applied per show (median), else across shows; an old big global value is ignored | show 1 → +0.2; unknown → −0.1; legacy 0.3 used, 1.1 ignored |
| P3-S5 | e2e | a big manual fix after a sync is not learned as your preference | +0.2 → 1 entry; then +1.1 → 0 entries |
| P3-S6 | e2e | an old large learned correction no longer shifts the next sync | legacy `syncBias` 1.1 → `Auto-synced: offset +3.0–3.4s` with no adjustment |
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

## Phase 3b: Whisper fallback (built)

Server: `cd server && uv run pytest` (`tests/test_server.py`). Extension: `e2e/pr-6-whisper-fallback.spec.ts` with a mocked server and real speech audio.

| ID | Layer | Test | Expected |
|---|---|---|---|
| P3-01 | pytest | test_health | 200 `status: ok` |
| P3-02 | pytest | test_rejects_bad_audio | bad base64 / odd bytes / wrong rate / negative start → 422; >30 s → 413 |
| P3-03..07 | pytest | test_pipeline_glossary_correction_and_timing | hallucination dropped; video-time offsets; correction applied, raw kept; AniList names as Whisper prompt; confidence ordered |
| P3-08 | pytest | test_no_llm_or_anilist_still_returns_raw_lines | AniList 500 + no correction → raw lines |
| P3-09 | pytest | test_ollama_corrector_success_and_failures | JSON mode; wrong length or connection refused → no correction |
| P3-11 | pytest | test_fixes_cannot_reword_lines | only glossary spellings replace text found in the line; です/さん kept |
| P3-12 | pytest | test_drops_whisper_repetition_loops | looped segment dropped, normal line kept |
| P3-38 | e2e | transcribes live when Jimaku has nothing and the server is running | lines in overlay; request has Part 2's AniList id, 16-bit PCM; popup says "Transcribing live" |
| P3-39 | e2e | styles low-confidence lines as unsure | `div.unsure` for confidence < 0.5 |
| P3-41 | e2e | shows only the newest lines, never a pile-up | ≥ 4 batches → ≤ 2 lines on screen, a recent one shown |
| P3-42 | e2e | (in P3-38) "Check Jimaku again" keeps lines already transcribed | cue count doesn't drop |
| P3-10 | pytest | test_partial_drafts_skip_correction | `partial: true` → Whisper text, no correction |
| P3-43 | e2e | shows a draft while a line is spoken, then the finished line | `div.partial` draft, then the finished line |
| P3-44 | e2e | prepares ahead in a minimized muted copy; lines arrive before they are spoken | 2nd copy muted at 1.5×; ≥ 2 lines while you're at 0; no drafts; popup "Ready up to m:ss"; on play, line shows within 1 s of its start |
| P3-45 | e2e | (in P3-44) Stop closes the copy and falls back to live | copy closed; popup "Transcribing live" |
| P3-46 | e2e | (in P3-44) the player never sees the copy's mute/speed changes; your tab stays unmuted; banner explains the copy | fake player's saved settings stay unset |
| P3-47 | e2e | falls back to live when the copy's player won't start | copy closed after ~6 s; popup explains |
| P3-48 | e2e | the never-clicked background copy still produces lines (real autoplay rules) | ≥ 1 line |
| P3-49 | e2e | auto-syncs prepared lines that come out late (another source of the episode) | lines 3 s late → `Auto-synced: offset -3.0s` (±0.3) |
| P3-50 | e2e | when you skip ahead (e.g. the opening), the copy jumps there and prepares from there | you seek to 25 s → copy's time > 23.5 s, server gets a segment starting ≥ 23.5 s |
| P3-51 | e2e | falls back to live when the copy never finds its video | copy closes within 45 s; popup: "background copy didn't start, so transcribing your tab live" |
| P3-40 | e2e | says how to start the server when it is not running | popup points to server/README.md |

The original Phase 3 plan follows for reference (P3-10..P3-13 superseded by the rows above).

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

Compare mode (PR 7, `e2e/pr-8-compare-mode.spec.ts`): on an episode with a real file, Whisper runs alongside and is scored against it.

| ID | Layer | Test | Expected |
|---|---|---|---|
| P4-01 | e2e | scores Whisper against the loaded file while you watch; its lines are never shown | ≥6 segments sent, no drafts; popup: error rate < 15%, before-correction rate higher, timing median < 0.5 s; overlay shows only the file's lines |
| P4-02 | e2e | says to start the server when it is not running | "Start the local server first"; button still says Compare |
| P4-03 | e2e | is offered only when a subtitle file is loaded | button hidden with no file, shown after loading one |
| P4-04 | e2e | Stop comparing stops sending audio to the server | ≤1 more request in 6 s of speech after Stop |
| P4-05 | e2e | Copy report copies every compared episode as a Markdown table | header row + `| real.srt |` row copied |
| P4-06 | unit (in e2e) | error rate maths | punctuation/brackets/spaces ignored; 1 edit = 1/7; stretches 30 s+ apart don't count the gap |
| P4-07 | manual | real episode with a Jimaku file + real server | report row with plausible CER (expect 10–30%); correction rate ≤ before-correction rate |
| P4-08 | planned | glossary on vs off (server switch) | does AniList context measurably help? |

---

## Phase 5: Stretch (outline; detail when started)

| ID | Layer | Test |
|---|---|---|
| P5-01 | e2e | gloss mode shows a literal EN line under the JP line |
| P5-02 | pytest | auto-sync aligns a cue set shifted by +2s to within ±0.2s |
| P5-03 | e2e | Anki export produces a card with sentence, reading, gloss and screenshot |
