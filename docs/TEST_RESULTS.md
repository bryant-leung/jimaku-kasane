# Test results log

Newest run first. One entry per test run that matters: a PR's final run, a phase sign-off, or a regression you hit.
Paste output **verbatim**. If a check wasn't run, write `not run`. Never mark something passed without the output.

Test case IDs (`P0-01`, `P1-03`, …) refer to [TEST_PLAN.md](TEST_PLAN.md).

---

## Entry template

```markdown
## YYYY-MM-DD — <phase / PR / issue> — <PASS | FAIL | PARTIAL>

**Branch / commit:** `<branch>` @ `<short sha>`
**Environment:** macOS <ver>, Node <ver>, Playwright <ver>, TypeScript <ver>, Chromium (Playwright bundled)

### Checks
| Check | Command | Result |
|---|---|---|
| Build | `npm run build` | ✓ / ✘ / not run |
| Typecheck | `npm run typecheck` | ✓ / ✘ / not run |
| Lint (extension) | not set up yet | not run |
| E2E | `npm run test:e2e -- e2e/<spec>` | N passed / N failed |
| Server lint | `uv run ruff check` | … |
| Server types | `uv run mypy app` | … |
| Server tests | `uv run pytest` | … |
| Manual (Chrome) | see TEST_PLAN.md § Manual checks | ✓ / ✘ / not run |

### Results by test case
| ID | Test | Result | Notes |
|---|---|---|---|

### Raw output
(verbatim ✓/✘ lines + summary)

### Issues
| # | Severity | Summary | Status |
|---|---|---|---|
```

Severity: **P0** blocker / data loss / security · **P1** core feature broken, workaround exists · **P2** minor.

---

## 2026-11-13 — Save for review / Anki (PR 12) — PASS (automated), manual not run

| Check | Result |
|---|---|
| `npm run typecheck` | ✓ |
| `e2e/pr-12-save-lines.spec.ts` | ✓ 6 passed |
| `npm run test:e2e:full` (118 = 112 + 6 new) | ✓ 118 passed |
| Manual: import the file into Anki | not run |

| # | Sev | Issue | Status |
|---|---|---|---|
| 1 | P2 | No audio clip or screenshot on the card yet (roadmap "later"). | open |

---

## 2026-11-13 — Word lookup (PR 11) — PASS (automated), manual not run

| Check | Result |
|---|---|
| `npm run typecheck` | ✓ |
| `npm run dict` | ✓ 219,040 words, 7,747 with a JLPT level (JMdict 3.6.2+20261109214828) |
| `npm run build` | ✓ 45.71 MB (was 31.15 MB; dictionary ~15 MB gzipped) |
| `e2e/pr-11-word-lookup.spec.ts` | first run 5/6: P2-W4 timed out (the level select is inside the collapsed Settings; test now opens it) → ✓ 1/1 |
| `npm run test:e2e:full` (112 = 106 + 6 new) | ✓ 112 passed |
| Manual on a real episode | not run |

| # | Sev | Issue | Status |
|---|---|---|---|
| 1 | P2 | Word splitting is longest-match (no grammar parser): kana-only stretches can split oddly (e.g. になった tagged N1 via 似る). Kana-only words are never underlined, so this only affects what a click shows. | open (watch) |
| 2 | P2 | Waller's lists put a few everyday words at N1 (e.g. 俺), so they get underlined. | open (watch) |
| 3 | P2 | Character names often aren't in JMdict, or match a rare word (千歳 "millennium") and get underlined. | open (watch) |
| 4 | — | Dictionary is generated, not committed (`extension/public/dict/`, gitignored); `npm run build` builds it (downloads ~12 MB once, cached in `data/cache/dict/`; works offline once built). | done |

---

## 2026-11-13 — Replay line (PR 10) — PASS (automated), manual not run

| Check | Result |
|---|---|
| `npm run typecheck` | ✓ |
| `npm run test:e2e:full` (106 = 100 + 6 new) | ✓ 106 passed |
| Manual: R on animepahe (Kwik) | not run |

| # | Sev | Issue | Status |
|---|---|---|---|
| 1 | — | Test harness: the fake site's clip now answers byte-range requests, so test videos can seek like real players (needed for replay; the whole suite still passes). | done |
| 2 | P2 | A site that uses R itself (none known among anime players) loses it while subtitles are loaded, like `[ ] \` (#3 of PR 2). | open (watch) |

---

## 2026-11-13 — Toolbar badge (PR 9) — PASS (automated), manual not run

| Check | Result |
|---|---|
| `npm run typecheck` | ✓ |
| `npm run test:e2e:full` (100 = 94 + 6 new) | 99 passed, 1 failed: P0 "no overlay on a page without video" — `Test timeout … while setting up "context"` (known slow-start flake, #5); `--last-failed` ✓ 1 passed; `npm run test:e2e` ✓ 100 passed |
| Manual: badge in real Chrome | not run |

| # | Sev | Issue | Status |
|---|---|---|---|
| 1 | P2 | `…` while preparing ahead with 0 lines isn't covered by an e2e test (badge logic only). | open |

---

## 2026-11-13 — Compare mode (PR 8) — PASS (automated), manual not run

| Check | Result |
|---|---|
| `npm run typecheck` | ✓ |
| `npm run test:e2e:full` (94 = 88 + 6 new) | ✓ 94 passed |
| `e2e/pr-7-compare-mode.spec.ts` alone | ✓ 6 passed |
| Manual on a real episode (P4-07) | not run |

| # | Sev | Issue | Status |
|---|---|---|---|
| 1 | P2 | P4-04 uses a fixed 6 s wait to prove nothing more is sent (a negative check has no event to wait for). | accepted |
| 2 | P2 | Error rate counts the file's lines inside each stretch of listening; a long pause (< 30 s) inside a stretch counts the lines you didn't play as misses. | open (watch) |

---

## 2026-11-11 — Whisper fallback (PR 6) — PASS (automated + one real-server run)

| Check | Result |
|---|---|
| `uv run ruff check .` / `uv run mypy app` / `uv run pytest` | ✓ / ✓ (strict) / ✓ 9 passed |
| `npm run typecheck` | ✓ |
| `npm run test:e2e` (80 = 77 + 3 new) | ✓ 80 passed ×2 |
| Real model speed (M3 Pro, 12 s chunk) | 9.6 s with temperature fallback → **1.4 s** single pass (adopted); first load 45.7 s (now warmed at server start) |
| Real server + extension end to end (throwaway spec) | ✓ line in overlay ~9 s after load, `POST /transcribe 200` (English test audio → Japanese text, as expected) |
| Ollama correction live | not run (Ollama not installed) |
| Manual on a real episode | not run |

| # | Sev | Issue | Status |
|---|---|---|---|
| 2 | P1 | Manual 02:02 (Chitose ep 18, real server): **working** — real Japanese lines, names right (千歳), but up to 3 lines piled up on screen. Now each new batch replaces what's shown (max 2 lines, held 3 s); segments cut at 0.35 s silence / 8 s (were 0.5 s / 12 s). P3-41. | fixed |
| 3 | P1 | "Check Jimaku again" restarted live transcription and discarded lines already transcribed (user pressed it repeatedly thinking it was needed). Now keeps the running transcription; popup says "Nothing to press". P3-42. | fixed |
| 4 | P2 | User: delay varies (a line is only sent after a pause, up to 8 s). Added drafts: while a line is spoken, the segment so far is transcribed about every second (no LLM correction, one in flight, never ahead of a finished line) and shown, then replaced by the finished line. Tests P3-10 (pytest), P3-43. | done, manual check pending |
| 5 | P2 | `0254f98` was pushed with one failing run (pre-push rule broken). Cause: P3-31 auto-sync measured −0.2 s on a correct file and moved it ("already matches" tolerance was 0.15 s; timing noise under load is ~0.2 s). Now results within 0.25 s keep the current offset. P3-31 3/3, suite 82/82 ×2. | fixed |
| 6 | P1 | Ollama installed; real correction test (qwen2.5:7b, warm 2.2 s): fixed 2 of 4 names but **reworded lines** (dropped です, added a surname). Now the model only proposes replacements; code applies those whose new text is a glossary spelling (or part of one) and whose old text is in the line, keeping endings like です/さん. P3-11. | fixed |
| 7 | P1 | Manual 17:42: live transcription showed 0 lines. Cause: finished lines took **21.5 s** (Ollama + a Whisper repetition loop) and a server-wide lock plus "no drafts while a finished line is pending" froze everything. Now: LLM budget 4 s (else Whisper text), lock covers Whisper only, drafts never wait for finished lines, repetition loops dropped (compression ratio > 2.4, P3-12). Re-timed: finished 1.5–2.1 s, concurrent draft 3.0 s. Suite 82/82 ×2 (one run had a one-off P1-05 failure; 5/5 on repeat — known #5). | fixed, manual re-check pending |
| 8 | — | User: live is always about one line behind the English (inherent: a line can only be transcribed after it's spoken). Added **prepare ahead** (default, setting to turn off): a minimized copy plays muted at 1.5× and is transcribed; lines reach your tab before they're spoken, with real timing (checked: line shown within 1 s of its start, not a line late). Stop button falls back to live; failures (copy can't be heard, closed) fall back automatically. Feasibility check first: muted `captureStream` at 1.5× still yields audio (peak 0.75). Audio now sent from the audio callback (hidden windows throttle timers). Tests P3-44, P3-45; suite 83/83 ×2. | done, manual check pending |
| 9 | P1 | Manual 18:16–18:18 (animepahe): the helper copy opened as a visible tab (unclear what it was, couldn't be paused), **your tab came up muted and then at 1.5×**, and no lines. Cause: Kwik's player saves mute/speed for the whole site; the copy's changes were saved as yours. Fix: the copy's volume/speed events are stopped before the page sees them (P3-46 with a fake player that saves them), Chrome-level tab mute, a banner "helper copy… watch your original tab" in the copy, and a playing check: if the copy isn't really playing after 6 s, it closes and your tab is transcribed live (P3-47). User must restore 1× / unmute once in their player. Suite 84/84 ×2 (one earlier run had a P3-44 failure; 4/4 on repeat after the banner locator fix). | fixed, manual re-check pending |
| 10 | P1 | Manual 18:27–18:28: copy playing (0:29) but 0 lines; then lines appeared, ~3 s late; switching back to your tab was annoying. Changes: (a) audio now read with MediaStreamTrackProcessor (no AudioContext → no click needed; P3-48 under Chrome's real autoplay rules — note: the old path also passed there, so "needs a click" is unconfirmed); (b) focus returns to your tab after the copy opens; (c) prepared lines are auto-synced against your tab's audio once 8 exist, with new lines fed to the running sync (the copy may play another source of the episode); (d) **bug**: copy and your-tab audio were mixed in one session (15 lines for 12 utterances; sync stuck when the copy ended) — streams now tagged `from: prep|viewer`; (e) live offsets no longer overwrite the show's Jimaku offset. Test harness: the copy sometimes loaded before routes attached (Chrome error page) — copy now opens blank then navigates. P3-49 (lines 3 s late → auto-synced −3 s, 3/3). Suite 86/86 ×2. | fixed, manual re-check pending |
| 11 | P1 | Manual 2026-11-13 01:03 (Chitose ep 18, animepahe): 0 lines after 2 min, popup stuck on "Preparing ahead…" (no "copy is playing" status). Cause (from code, not observed in the browser): video detection was scheduled with `requestAnimationFrame`, which never fires in a minimized window, so the copy never found Kwik's video (added after load) and never started; nothing noticed. Fix: timer in hidden pages; background watchdog — no "playing" from the copy within 25 s → close it, transcribe your tab live (P3-51). Also: skipping (e.g. the opening) made the copy fall minutes behind; the copy now jumps to where you skip (P3-50). Suite 88/88. | fixed, manual re-check pending |
| 1 | P2 | Offscreen-page `fetch` to the server wasn't interceptable in tests (0 requests seen); moved server calls to the background worker (also keeps all network access in one place). | fixed |

---

## 2026-11-10 — Audio auto-sync (PR 5) — PASS (automated), manual not run

**Branch:** `feat/auto-sync`
| Check | Result |
|---|---|
| `npm run typecheck` | ✓ |
| `npm run test:e2e` (57 = 50 regression + 7 new) | ✓ 57 passed ×4 after fix below |
| Manual M3-01 (real tab audio) | not run |

| # | Sev | Issue | Status |
|---|---|---|---|
| 1 | P2 | Flaky P1-32 (1 of 2 runs): popup read status before subscribing to changes, so an update in between was lost. Now subscribes first. | fixed |
| 2 | P1 | Manual M3-01 (23:57, Yozakura ep 44, CBC TV rip vs Disney+): "No clear match", offset unchanged; Black Clover (already in sync) fine. Likely BGM under dialogue saturating the loudness detector and/or shift > ±20 s. Now: loudness relative to a 3 s local average (cancels music beds), search ±60 s, failure message shows best guess + confidence. New tests P3-21 (music), P3-22 (-37.5 s). | re-test 00:01: still "No clear match (best guess +43.2s, confidence 2.1)". Ground truth by hand: **+3.2 s** (user, refined from +3.0) (「四怨なら残り数日で…」 ↔ "Knowing Shion as I do,"). Loudness detection can't separate voice from BGM/SFX → replaced with Silero VAD (loudness kept as fallback). Verified offline on real speech under music (P3-23..25) and in-extension model load (P3-26); 64/64 ×2. | re-test 00:26 with VAD: still "No clear match (best guess +43.5s, confidence 2.3)" — nearly the same wrong guess as the loudness detector, so suspect the video clock, not the detector: every frame with a video reports time, so a second video (e.g. a muted background clip) would mix clocks. Now uses only the audible, largest video's clock (P3-27) and the failure message shows mode/clocks/frames/samples/speech. | re-test pending |
| 7 | P1 | Re-test 00:35 with diagnostics `[vad, 1 clock, 1875 audio frames, 300 time samples, 16s speech]`: inputs all fine, still "+43.7s". Root cause found in the real Jimaku file (CBC TV ep 17): cues cover **91%** of the timeline and 351/402 gaps are zero (each caption stays up until the next), so "speech overlaps cues" carries no timing. Fix: for gapless files (>70% coverage) match **speech onsets to cue starts**; threshold 7 for that signal (right episode 9.4, wrong-episode captions 3.3–5.3 over 8 seeds). Tests P3-28 (+3.2 on gapless/split captions), P3-29 (no false match). | fix pushed, re-test pending |
| 9 | — | Manual re-test 00:43 (button): **"Synced: offset +3.8s"** vs hand-set +3.6 s; lines match on screen. M3-01 pass. | ✓ |
| 10 | — | Fully automatic sync (no click): captures the video element's own audio (`captureStream`), VAD in the offscreen page, once per subtitle file; leaves correct files alone. End-to-end tests play the speech-over-music clip in Chromium: +3.2 s fixed by itself (P3-30, ~25 s), correct file left as is (P3-31). Full suite 70/70 ×2, third run the known slow-run timeout (#5). | done, manual check pending |
| 11 | P1 | Manual 00:56 (ep 40): status stuck on "checking the timing while you watch…" with no way to tell whether audio was heard. Added live progress (`Ns heard, Ns of speech`) and explicit errors when the player's audio can't be read (captureStream missing/throws, or no frames after 12 s of playback). Also seen: offset +0.0 although +3.8 was inherited — asking user whether `\` / Reset was pressed. 70/70 ×2. | diagnostics pushed, re-test pending |
| 12 | P1 | Manual 00:59: Chrome's extension error page showed a ScriptProcessorNode deprecation warning (harmless) whose context was the **animepahe top page**, i.e. auto-sync was also capturing a video in the page (likely the muted ambient "glow" copy) and mixing it with the player's audio. Now: muted videos are skipped, audio is tagged by source, and the analyser locks onto the first source with sound. New P3-32 (muted glow copy + real player in an iframe). Audio-playback e2e tests run serially (were flaky under parallel load); suite 71/71 ×3 (1.4 min). | fixed, re-test pending |
| 13 | P2 | Manual 01:10: popup "No subtitles loaded", controls disabled, but stale Japanese still drawn. Cause: extension reloaded (↻ wipes `storage.session`) without reloading the tab; the old content script kept drawing while cut off. Now an orphaned content script removes its overlay within 2 s. Not automatable in Playwright (extension reload); manual check. | fixed, manual check pending |
| 14 | P1 | Manual 01:12 (ep 40 on animepahe): automatic capture works through the Kwik iframe (**75 s heard, 48 s of speech**) but no confident answer yet — gapless threshold 7 (from synthetic data) likely too strict for real audio. Now also accepts an answer repeated by 3 successive checks within 0.2 s at confidence ≥ 4 (P3-33), and progress shows the current best guess + confidence. | pushed, re-test pending |
| 15 | P1 | Manual 01:20–01:22 (ep 41): auto-synced **+3.7 s** but took ~2 min; intermediate guesses (+10.0 s, conf 2.1–2.5) looked erratic. Now: the show's remembered offset narrows the search (clear peak within ±1.5 s of it accepted at confidence ≥ 3; first check after 12 s); progress only shows a guess once it's near the bar. Tried "use whichever of the two signals is stronger": rejected — wrong-episode tests then matched (48.7 s, −29.4 s, −33.8 s). Tests P3-34 (15 s of audio + hint → +3.2), P3-35 (hint never forces a wrong-episode match). | pushed, re-test pending |
| 16 | — | User prefers **+4.0 s** where auto-sync finds +3.7 s (aligns to the English hardsubs, which trail the voice). Now learns a personal correction from a manual change after a sync and adds it to future results ("includes your +0.3s adjustment"). Tests P3-36, P3-37. | done |
| 17 | P2 | Manual 01:25 (Chitose ep 18): "No Japanese subtitles on Jimaku … yet" is correct — site ep 18 = Part 2 ep 5 (S01E18); Jimaku's latest Part 2 file is S01E15 (2026-11-09). Added "Check Jimaku again" button and 30-min expiry of not-found results (P1-52). Real fix for brand-new episodes: Whisper fallback (Phase 3b). Full suite 75/75 ×2 (1.7 min). | done |
| 18 | P2 | User: "JP Sub ready" on every video (e.g. YouTube) is annoying. Placeholder removed (overlay stays empty until subtitles load); popup gains "Show Japanese subtitles" (global) and "Off on <site>" (per page hostname, also applies inside its player iframes). Off = no overlay, no lookups, no listening, no hotkeys. P0/P1 tests that waited for the placeholder now check the overlay is attached. New P1-53, P1-54; suite 77/77 ×2. | done |
| 8 | — | User feedback: correct offset for ep 44 is **+3.6 s**. New: the offset you settle on is remembered per AniList season and applied to the next auto-loaded episode (P1-51). | done |
| 6 | P0 | Regression in `0f0ab65` (pushed without a clean suite run): `crypto.randomUUID()` is undefined on http pages, so the content script crashed on start (4 tests failed every run). Replaced with an http-safe ID; 65/65 ×2, third run the known slow-run timeout (#5). | fixed |
| 3 | P1 | Found while stabilising the suite: reloading the episode while a lookup was running could leave subtitles unloaded forever, or download twice (title and episode were saved in two writes; a stale "searching" status blocked retries). Lookups now run one at a time per tab, title + episode are one write, and an interrupted lookup is retried. New test P1-50 (reload mid-download); reload tests 30/30. | fixed |
| 4 | P2 | Popup could show stale data when two async reads finished out of order (offset of the previous file; older auto status). Sequence guards added. | fixed |
| 5 | P2 | Occasional slow full-suite run (~1 min instead of ~14 s), usually the first run after a rebuild; one random UI test then times out. Looks like machine load (6 parallel browsers, 31 MB extension with the ONNX runtime). 3 of 4 runs clean (64/64). | open (watch) |

---

## 2026-11-10 — Automatic subtitles (PR 4) — PASS

**Branch:** `feat/auto-subs` · **Env:** as below
| Check | Result |
|---|---|
| `npm run typecheck` | ✓ |
| `npm run test:e2e` (48 = 37 regression + 11 new) | ✓ 48 passed ×3 runs (12.0s, 12.7s, 12.0s) |
| Live check (throwaway script, real AniList + Jimaku): "Mission: Yozakura Family" ep 44 | ✓ → S2 Part 2 ep 17, `S2 - 17 (CBC TV …).srt`, 403 cues |
| Manual on animepahe (M1-01, M1-03) | ✓ auto-load + iframe overlay; fullscreen (M1-02) not confirmed yet |

| # | Sev | Issue | Status |
|---|---|---|---|
| 1 | P1 | Found on animepahe (manual run): its title is `Show - 44` style, not detected, so nothing auto-loaded. Added `Show - 44` parsing + a popup message when no episode number is found (P1-47, P1-48). Overlay moved to the top so it doesn't cover burned-in English subs. Re-run: 50 passed ×2. | fixed; manual re-check ✓ 2026-11-10 23:38: animepahe ep 44 auto-loaded, line 「言う隙　あげてないでしょ！」 shown at top, in step with the English hardsub |
| 2 | P2 | Episode numbering is matched by trying candidates; an uploader using an unusual scheme can still miss. | open |
| 3 | P2 | Manual (23:44): ep 44 only has a CBC TV broadcast rip on Jimaku; animepahe streams the Disney+ version, so Japanese lines run early by a fixed amount. Workaround: `]` / `Shift+]` offset (saved per file). Now prefers streaming-source files (WEBRip/Netflix/Amazon/Disney…) when both exist (P1-49). Auto-alignment is Phase 5. | mitigated |
| 4 | — | Manual: fullscreen keeps the overlay visible (M1-02). | ✓ |

---

## 2026-11-10 — Phase 1 local MVP (PR 2) — PASS

**Branch / commit:** `feat/phase-1-overlay-mvp` (on top of `52cc7ba`, PR 1)
**Environment:** macOS 15.7.4, Node v24.18.0, Playwright 1.65.0, TypeScript 5.9.3, WXT 0.20.27, Chromium (Playwright bundled, new headless)

### Checks
| Check | Command | Result |
|---|---|---|
| Build | `npm run build` | ✓ built `dist/chrome-mv3` (17.54 kB) |
| Typecheck | `npm run typecheck` | ✓ no errors (extension + e2e) |
| Lint (extension) | not set up yet | not run |
| E2E (full suite) | `npm run test:e2e` | 37 passed (5 regression + 32 new), 2 consecutive runs |
| Safari build | `npm run build:safari -w extension` | not run |
| Manual (Chrome) | M1-01..M1-03 | not run |

### Results by test case
| ID | Test | Result |
|---|---|---|
| P0-01..P0-05 | Phase 0 regression | ✓ 5/5 |
| P1-11..P1-16, P1-35..P1-37 | parser (Node) | ✓ 9/9 |
| P1-01..P1-04 | video detection | ✓ 4/4 |
| P1-05..P1-10 | loading a subtitle file | ✓ 6/6 |
| P1-17..P1-20, P1-22 | rendering and sync | ✓ 5/5 |
| P1-21, P1-38 | fullscreen, iframe rendering | ✓ 2/2 |
| P1-23..P1-27, P1-39 | offset | ✓ 6/6 |
| P1-28..P1-34 | AniList + Jimaku | not built yet (next PR) |

### Raw output
```
Running 37 tests using 1 worker
  ✓   1 e2e/pr-1-phase-0-scaffold.spec.ts:11:1 › extension service worker starts (1.2s)
  ✓   2 e2e/pr-1-phase-0-scaffold.spec.ts:16:1 › overlay mounts over a video in the top frame (705ms)
  ✓   3 e2e/pr-1-phase-0-scaffold.spec.ts:23:1 › overlay mounts over a video inside a cross-origin iframe (660ms)
  ✓   4 e2e/pr-1-phase-0-scaffold.spec.ts:31:1 › no overlay on a page without video (614ms)
  ✓   5 e2e/pr-1-phase-0-scaffold.spec.ts:39:1 › popup renders with version (632ms)
  ✓   6 e2e/pr-2-phase-1-overlay-mvp.spec.ts:38:3 › parser › parses SRT timestamps to seconds (2ms)
  ✓   7 e2e/pr-2-phase-1-overlay-mvp.spec.ts:45:3 › parser › parses ASS timestamps to seconds (1ms)
  ✓   8 e2e/pr-2-phase-1-overlay-mvp.spec.ts:51:3 › parser › keeps multi-line cues (1ms)
  ✓   9 e2e/pr-2-phase-1-overlay-mvp.spec.ts:57:3 › parser › strips formatting tags (1ms)
  ✓  10 e2e/pr-2-phase-1-overlay-mvp.spec.ts:64:3 › parser › sorts cues by start time (0ms)
  ✓  11 e2e/pr-2-phase-1-overlay-mvp.spec.ts:70:3 › parser › empty file gives zero cues (1ms)
  ✓  12 e2e/pr-2-phase-1-overlay-mvp.spec.ts:80:3 › parser › skips ASS comments and drawings (0ms)
  ✓  13 e2e/pr-2-phase-1-overlay-mvp.spec.ts:87:3 › parser › reports the line number of a broken timestamp (0ms)
  ✓  14 e2e/pr-2-phase-1-overlay-mvp.spec.ts:94:3 › parser › decodes Shift-JIS, UTF-8 BOM and UTF-16 (1ms)
  ✓  15 e2e/pr-2-phase-1-overlay-mvp.spec.ts:106:3 › video detection › detects a video added after page load (906ms)
  ✓  16 e2e/pr-2-phase-1-overlay-mvp.spec.ts:114:3 › video detection › picks the largest video when several exist (734ms)
  ✓  17 e2e/pr-2-phase-1-overlay-mvp.spec.ts:130:3 › video detection › removes overlay when the video is removed (707ms)
  ✓  18 e2e/pr-2-phase-1-overlay-mvp.spec.ts:142:3 › video detection › detects video in a nested cross-origin iframe (2 levels) (800ms)
  ✓  19 e2e/pr-2-phase-1-overlay-mvp.spec.ts:152:3 › loading a subtitle file › loads a .srt file from the popup (809ms)
  ✓  20 e2e/pr-2-phase-1-overlay-mvp.spec.ts:164:3 › loading a subtitle file › loads an .ass file from the popup (766ms)
  ✓  21 e2e/pr-2-phase-1-overlay-mvp.spec.ts:175:3 › loading a subtitle file › rejects an unsupported file type (845ms)
  ✓  22 e2e/pr-2-phase-1-overlay-mvp.spec.ts:190:3 › loading a subtitle file › handles a malformed .srt (766ms)
  ✓  23 e2e/pr-2-phase-1-overlay-mvp.spec.ts:202:3 › loading a subtitle file › loading a second file replaces the first (755ms)
  ✓  24 e2e/pr-2-phase-1-overlay-mvp.spec.ts:216:3 › loading a subtitle file › handles Shift-JIS / UTF-8 BOM files (784ms)
  ✓  25 e2e/pr-2-phase-1-overlay-mvp.spec.ts:244:3 › rendering and sync › shows the cue for the current time (752ms)
  ✓  26 e2e/pr-2-phase-1-overlay-mvp.spec.ts:251:3 › rendering and sync › clears between cues (784ms)
  ✓  27 e2e/pr-2-phase-1-overlay-mvp.spec.ts:261:3 › rendering and sync › shows both overlapping cues (733ms)
  ✓  28 e2e/pr-2-phase-1-overlay-mvp.spec.ts:268:3 › rendering and sync › follows seeking backwards (747ms)
  ✓  29 e2e/pr-2-phase-1-overlay-mvp.spec.ts:277:3 › rendering and sync › overlay follows a resized video (887ms)
  ✓  30 e2e/pr-2-phase-1-overlay-mvp.spec.ts:298:3 › rendering in special places › overlay survives fullscreen (863ms)
  ✓  31 e2e/pr-2-phase-1-overlay-mvp.spec.ts:318:3 › rendering in special places › renders cues inside a cross-origin iframe player (1.1s)
  ✓  32 e2e/pr-2-phase-1-overlay-mvp.spec.ts:342:3 › offset › +0.1s / -0.1s hotkeys shift timing (826ms)
  ✓  33 e2e/pr-2-phase-1-overlay-mvp.spec.ts:359:3 › offset › ±1s hotkeys shift timing (815ms)
  ✓  34 e2e/pr-2-phase-1-overlay-mvp.spec.ts:371:3 › offset › hotkeys ignored while typing in an input (837ms)
  ✓  35 e2e/pr-2-phase-1-overlay-mvp.spec.ts:381:3 › offset › offset persists per subtitle file across reload (773ms)
  ✓  36 e2e/pr-2-phase-1-overlay-mvp.spec.ts:395:3 › offset › offset is separate per subtitle file (924ms)
  ✓  37 e2e/pr-2-phase-1-overlay-mvp.spec.ts:411:3 › offset › popup offset buttons shift timing (829ms)
  37 passed (23.2s)
```

### Issues
| # | Severity | Summary | Status |
|---|---|---|---|
| 1 | P2 | First run: popup `<output>` for the offset has implicit role `status`, so `getByRole('status')` matched 2 elements (19 tests failed). Replaced with a labelled `<span>`. | fixed |
| 2 | P2 | P1-21 checks the overlay re-enters the top layer (`:popover-open`) and is visible in fullscreen; it can't prove pixel stacking. Needs manual M1-02. | open |
| 3 | P2 | Hotkeys `[` `]` `\` are swallowed on pages while subtitles are loaded; a site using those keys loses them. | open (watch) |
| 4 | P2 | Videos inside a page's own shadow DOM (custom player elements) aren't detected (`querySelectorAll` doesn't pierce). | open |
| 5 | P2 | Carried over: no extension lint; Safari never built; manual Chrome checks not run. | open |

---

## 2026-11-10 — Phase 0 scaffold (PR 1) — PASS

**Branch / commit:** `chore/phase-0-scaffold` @ no commits yet (all files untracked)
**Environment:** macOS 15.7.4, Node v24.18.0, Playwright 1.65.0, TypeScript 5.9.3, WXT 0.20.27, Chromium (Playwright bundled, new headless)

### Checks
| Check | Command | Result |
|---|---|---|
| Build | `npm run build` | ✓ built `dist/chrome-mv3` (6.76 kB) |
| Typecheck | `npm run typecheck` | ✓ no errors (extension + e2e) |
| Lint (extension) | not set up yet | not run |
| E2E | `npx playwright test e2e/pr-1-phase-0-scaffold.spec.ts` | 5 passed |
| Server lint / types / tests | — | not run (no server code yet) |
| Safari build | `npm run build:safari -w extension` | not run |
| Manual (Chrome) | TEST_PLAN.md § Manual checks M0-01..M0-04 | not run |

### Results by test case
| ID | Test | Result | Notes |
|---|---|---|---|
| P0-01 | extension service worker starts | ✓ pass | 1.6s |
| P0-02 | overlay mounts over a video in the top frame | ✓ pass | 701ms |
| P0-03 | overlay mounts over a video inside a cross-origin iframe | ✓ pass | 693ms |
| P0-04 | no overlay on a page without video | ✓ pass | 628ms |
| P0-05 | popup renders with version | ✓ pass | 658ms |

### Raw output
```
Running 5 tests using 1 worker

  ✓  1 e2e/pr-1-phase-0-scaffold.spec.ts:10:1 › extension service worker starts (1.6s)
  ✓  2 e2e/pr-1-phase-0-scaffold.spec.ts:14:1 › overlay mounts over a video in the top frame (701ms)
  ✓  3 e2e/pr-1-phase-0-scaffold.spec.ts:20:1 › overlay mounts over a video inside a cross-origin iframe (693ms)
  ✓  4 e2e/pr-1-phase-0-scaffold.spec.ts:27:1 › no overlay on a page without video (628ms)
  ✓  5 e2e/pr-1-phase-0-scaffold.spec.ts:34:1 › popup renders with version (658ms)

  5 passed (4.7s)
```

### Issues
| # | Severity | Summary | Status |
|---|---|---|---|
| 1 | P2 | Branch `chore/phase-0-scaffold` had no commits; results weren't tied to a SHA. | fixed: `52cc7ba`, PR #1 |
| 2 | P2 | `e2e/README.md` mentions a sample `.srt` fixture; none exists (`e2e/fixtures/` only has `extension.ts`). Needed for Phase 1 (P1-04+). | fixed in PR 2 |
| 3 | P2 | No extension lint configured (AGENTS.md: "not set up yet"). | open |
| 4 | P2 | Safari target never built or tested. | open |
| 5 | P2 | Manual Chrome check (M0-01..M0-04) not run on a real site. | open |
