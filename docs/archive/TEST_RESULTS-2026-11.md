# Test results log

> **Archived 2026-11-14** (v1.1.0 plus PRs 41–46). No longer updated. Live docs: [MANUAL_CHECKS.md](../MANUAL_CHECKS.md) and [e2e/README.md](../../e2e/README.md).

Newest run first. One entry per test run that matters: a PR's final run, a phase sign-off, or a regression you hit.
Paste output **verbatim**. If a check wasn't run, write `not run`. Never mark something passed without the output.

Test case IDs (`P0-01`, `P1-03`, …) refer to [TEST_PLAN.md](TEST_PLAN-2026-11.md).

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

## 2026-11-14 — Difficulty score (PR 46, on top of PR 45) — PASS (automated), manual not run

| Check | Result |
|---|---|
| Your report: "common" on 捏造, 偽装, 増殖, 尾行, 急遽; 反応, 美術, 携帯 as N1 | "common" was JMdict's newspaper flag; some JLPT list levels are off |
| wordfreq probe (raw table) | 捏造 3.87, 携帯 4.93, 反応 4.95, 美術 4.29, 偽装 3.98, 尾行 3.15; verbs split by form (頑張っ 4.93, 頑張る 4.16) → summed per dictionary form with kuromoji at build: 頑張る 5.2 |
| `npm run dict` (+ `freq/`, 200,891 forms, 4.4 MB) | ✓ |
| Probe of marks (34 words, N3/N2/N1 settings) | logged at N3: 捏造, 偽装, 増殖, 尾行, 急遽, 悪戯, 叱る…; not: 携帯, 反応, 美術, 頑張る, 掴む, 喋る |
| Spec + updated specs (pr-11, pr-33, pr-45) | ✓ 19 passed. Updated to frequency verdicts: 携わる, 拒む, 措置, 該当 not underlined at N2; 掴む, 喋る, 僅か not "niche"; 大げさ now marked (rare in every spelling); plan now prefers 弄ぶ over 曖昧 |
| Full runs | 240 + 3 errors outside any test; 243 ✓ |
| Real episode | not run |

---

## 2026-11-14 — Show-aware word picking (PR 45, on top of PR 44) — PASS (automated), manual not run

| Check | Result |
|---|---|
| Probe: invented Index terms | kuromoji splits them into real words (幻想+殺し, 超+電磁+砲, 禁書+目録) → detected as words mostly seen inside a noun run the dictionary doesn't know |
| `e2e/pr-45-episode-plan.spec.ts` | ✓ 4 passed; P2-P4's first version clicked the episode's only hard word, which the plan had already logged (test fixed) |
| Test-suite stability (found while running this PR) | P2-H3: a word clicked while its line's frame was still saving got none → code fix (clicks wait for the pending frame). P2-H2 compared video time with wall-clock time → fixed. P2-H1/H4 hover gaps under load → pointer moves fired in-page. P3-50 (pr-6 skip ahead) gets 1 retry in its own group |
| Full runs | 239 ✓; 237 + 2 errors outside any test; 239 ✓; 239 ✓ |
| Real episode (Index, Euphonium) | not run |

| # | Sev | Issue | Status |
|---|---|---|---|
| 1 | P2 | Rare "errors outside any test" in full parallel runs (about 1 in 3–4 runs since PR 25), not tied to one spec. | open: needs its own investigation |

---

## 2026-11-14 — Final lines only in live transcription (PR 44, on top of PR 43) — PASS (automated), manual not run

| Check | Result |
|---|---|
| Your request: lines change while shown | cause: Whisper drafts (partial lines while speech continues), replaced by the finished line; finished lines are never replaced later |
| `e2e/pr-44-final-lines-only.spec.ts` + `pr-6` (P3-43 now turns drafts on) | ✓ 13 passed |
| `npm run test:e2e` (235) | ✓ 235 passed |
| Real show without a Jimaku file | not run |

---

## 2026-11-14 — Screenshots from the video (PR 43, on top of PR 42) — PASS (automated), manual not run

| Check | Result |
|---|---|
| Your request: screenshots from the playing tab even when you've switched away | tab screenshots (`captureVisibleTab`) can't see other tabs → frames now come from the `<video>` element |
| `e2e/pr-43-video-frames.spec.ts` | ✓ 3 passed. Simulating a hidden tab failed (switching tabs, minimizing via DevTools, moving to a minimized window: the test browser still reports visible), so P2-V2 uses an inactive tab, where a tab screenshot returns nothing |
| `npm run test:e2e` (233) | ✓ 233 passed |
| Real Chrome, episode in a background tab on animepahe | not run: Chrome may stop drawing video in background tabs (a stale or black picture is then skipped, no screenshot), and Kwik's video must allow reading (else the tab screenshot is used) |

| # | Sev | Issue | Status |
|---|---|---|---|
| 1 | P2 | Whether Chrome keeps drawing video frames in a real background tab, and whether Kwik's video can be read, is unverified. | open (check on a real episode) |

---

## 2026-11-14 — Brackets and the no-screenshot note (PR 42, on top of PR 41) — PASS (automated), manual not run

| Check | Result |
|---|---|
| Your report (notebook screenshot) | 氏 うじ logged from 北宇治(きたうじ): readings and speaker labels in brackets were split into words; empty 16:9 "No screenshot" box |
| Probe: kuromoji on bracketed lines | ASCII brackets come out as nouns and `)）` merges into one token → bracket depth is tracked from characters |
| `e2e/pr-42-bracket-asides.spec.ts` | ✓ 4 passed |
| `npm run test:e2e` (230) | ✓ 230 passed |

---

## 2026-11-14 — Screenshots without the control bar (PR 41) — PASS (automated), manual not run

| Check | Result |
|---|---|
| Your report: player bar in some screenshots | causes: pointer moving over the video (players show the bar), and clicked words captured while paused with the card open |
| `e2e/pr-41-clean-shots.spec.ts` | ✓ 4 passed (P2-H1 and P2-H4 would fail on the old code, which always captured) |
| `npm run test:e2e` (226) | ✓ 226 passed |
| On animepahe (Kwik's bar timing) | not run |

---

## 2026-11-14 — Notebook bulk actions and stats (PR 39, on top of PR 38) — PASS (automated), manual not run

| Check | Result |
|---|---|
| `e2e/pr-39-bulk-stats.spec.ts` + notebook specs 29/35/36 | ✓ 25 passed (pr-36 list row has a checkbox cell first now) |
| `npm run test:e2e` (222) | ✓ 222 passed |
| Your real notebook | not run |

---

## 2026-11-14 — Jump to scene (PR 38, on top of PR 37) — PASS (automated), manual not run

| Check | Result |
|---|---|
| `e2e/pr-38-jump-to-scene.spec.ts` | first run: 3 failed (my test waited for a page whose URL was still blank); fixed; waits tightened to 8 s so passing proves a seek; ✓ 3 passed |
| `npm run test:e2e` (217) | ✓ 217 passed |
| On animepahe (player loads after a click) | not run |

---

## 2026-11-14 — Notebook topics and genres (PR 37, on top of PR 36) — PASS (automated), manual not run

| Check | Result |
|---|---|
| JMdict subject tags (probe) | 33,068 of 219,040 words tagged; top: computing, medicine, food, Buddhism, maths, chemistry, law, anatomy, physics, music, sports, baseball |
| `npm run dict` (+ `t` per entry, `fields/0.json.gz` with 96 names) | ✓ |
| `e2e/pr-37-notebook-topics.spec.ts` | ✓ 4 passed |
| `npm run test:e2e` (214) | ✓ 214 passed |
| Genre grouping against the real AniList | not run (mocked in tests) |

---

## 2026-11-14 — Notebook grouping + list view (PR 36, on top of PR 35) — PASS (automated), manual not run

| Check | Result |
|---|---|
| `e2e/pr-36-notebook-groups.spec.ts` + pr-35 + pr-29 | ✓ 20 passed (pr-29 / pr-35: show headings now carry a count) |
| Full run 1 | 205 passed, 1 failed (pr-6 "skip ahead": no request from 23.5 s within 30 s; the copy had jumped), 4 did not run |
| Fix | the test waits 60 s for that request; the background skips notebook work for the helper copy before splitting its lines |
| Full runs 2 and 3 | ✓ 210 passed, ✓ 210 passed |
| Your real notebook | not run |

| # | Sev | Issue | Status |
|---|---|---|---|
| 1 | P2 | pr-6 "skip ahead" flaky under full parallel load (4 failures since PR 26). | fixed: longer wait (2 clean full runs since) |

---

## 2026-11-14 — Notebook cards and sorting (PR 35) — PASS (automated), manual not run

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run build` | ✓ |
| `e2e/pr-35-notebook-sort.spec.ts` | ✓ 7 passed |
| `e2e/pr-29-notebook-page.spec.ts` (summary now counts sightings; episode on the card instead of a heading) | ✓ 7 passed after updating 4 expectations |
| `npm run test:e2e` (204) | ✓ 204 passed |
| Your real notebook | not run |

---

## 2026-11-14 — Harder words only (PR 33, on top of PR 32) — PASS (automated), manual not run

| Check | Result |
|---|---|
| Your report: 私 (あたし) and other easy words underlined / logged | causes: Waller's lists put あたし, 俺 at N1; ごめん, 部 marked; 青春, 大げさ N1 but N5 kanji; フレージング, 金賞, 吹奏楽, 入部, 悔し涙 counted as "rare" (on no list) |
| Probe: kanji level for every word | rejected: dropped 13 of 25 hard words (漠 from 砂漠, 懸 from 一生懸命, 煩 from 煩い) |
| Probe: final rules (25 hard words, 12 episode lines) | screenshot's easy words: none marked at N2 or N3; hard words: those on N1 / no list kept at N2; N2-level ones kept at N3 |
| Your follow-up: niche N3 words are fine | probe: "not common" N3 words are mostly junk (あんなに, はあ, single kanji); "written with a harder kanji" gives 掴む, 喋る, 繋ぐ, 悪戯, 叱る, 僅か → used |
| `npm run dict` (format: + `kanji/0.json.gz`, 1913 kanji) | ✓ |
| `e2e/pr-33-harder-words.spec.ts` + word / notebook specs | ✓ 24 passed |
| `npm run test:e2e` (197) | ✓ 197 passed |
| Real episode | not run |

---

## 2026-11-14 — Screenshot crop + fullscreen fix in the build (PR 32, on top of PRs 24–31) — PASS (automated), manual not run

| Check | Result |
|---|---|
| Your report: fullscreen clicks still failed | cause: PRs #26–#31 were built on `main` without #24 (fullscreen) and #25 (offset), so your build lacked both. This branch merges them in (doc conflicts only). |
| `e2e/pr-24-…`, `pr-25-…`, `pr-5-…` on the merged code | ✓ 33 passed |
| `e2e/pr-32-shot-crop.spec.ts` | first run: 2 failed, shot 4.4 % magenta, a strip at the top (vertical scale taken from `innerHeight`, which needn't match the screenshot); fixed by scaling both axes by screenshot width ÷ viewport width; ✓ 4 passed |
| `npm run test:e2e` (192) | ✓ 192 passed |
| Real episode on animepahe (crop, fullscreen click) | not run |

---

## 2026-11-14 — Anki export with pictures (PR 31, on top of PRs 26–30) — PASS (automated + Anki importer)

| Check | Result |
|---|---|
| Reference layout from genanki (throwaway) | schema, `col` JSON (conf/models/decks/dconf) mirrored |
| `npm run typecheck`, `npm run build` (66.23 MB, `sqljs/sql-wasm.wasm` 688 kB) | ✓ |
| `e2e/pr-31-anki-apkg.spec.ts` | ✓ 4 passed |
| Anki's importer (`anki` 26.09.4 on PyPI, fresh collection) on the Node-built and the browser-downloaded deck | ✓ both: 3 new notes, deck *JimakuKasane notebook*, fields and tags right, media present, `missing media []`; re-import: 0 new, 3 duplicates |
| `npm run test:e2e` (178 = 174 + 4 new) | run 1: 173 passed, 1 failed (pr-6 "skip ahead"), 4 did not run; run 2: 173 passed, 3 did not run, 1 error outside any test; run 3 ✓ 178 passed |
| Anki desktop app (open the file, review a card) | not run (Anki not installed here) |

| # | Sev | Issue | Status |
|---|---|---|---|
| 1 | P2 | Full-suite flakes (pr-6 "skip ahead"; errors outside tests) now in 2 of 3 runs, up from 1 in 2. Every test with subtitles now also splits words and logs to the notebook, which adds load. | open: investigate (e.g. turn off notebook logging in tests that don't need it) |

---

## 2026-11-13 — Grammar points (PR 30, on top of PRs 26–29) — PASS (automated), manual not run

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run build` | ✓ |
| Throwaway probe: 126 examples, 20 ordinary lines, 5,098 Tatoeba sentences | first pass: 14 examples missed (parser splits patterns differently alone than in a line), 1 false hit (two cores written backwards), ～にしても / ～ものなら / ～べく fired on にする / ものだ / べき; fixed (context prefixes, exact match for conjugated parts, 5 text patterns). Final: 0 missed, 0 false on the ordinary lines; the remaining Tatoeba hits are real uses |
| `e2e/pr-30-grammar-points.spec.ts` | ✓ 6 passed (first run: P2-G5 changed the setting before the first log; test now waits) |
| `npm run test:e2e` (174 = 168 + 6 new) | ✓ 174 passed |
| Real episode | not run |

| # | Sev | Issue | Status |
|---|---|---|---|
| 1 | P2 | A few patterns have ordinary readings too (割に合う matches ～わりに; として "as a" matches ～としても). | open (delete or mark learned) |

---

## 2026-11-13 — Notebook page (PR 29, on top of PRs 26–28) — PASS (automated), manual not run

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run build` (65.47 MB, `notebook.html`) | ✓ |
| `e2e/pr-29-notebook-page.spec.ts` | ✓ 7 passed |
| Layout screenshot of the page with seeded data (throwaway) | ✓ looked at: groups, cards, filters render as intended |
| `npm run test:e2e` (168 = 161 + 7 new) | ✓ 168 passed |
| With a real notebook after an episode | not run |

---

## 2026-11-13 — Study notebook: automatic logging (PR 28, on top of PRs 26–27) — PASS (automated), manual not run

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run build` (65.46 MB) | ✓ |
| `e2e/pr-28-notebook-logging.spec.ts` | ✓ 6 passed (real `captureVisibleTab` screenshots in headless Chromium) |
| `npm run test:e2e` (161 = 155 + 6 new) | ✓ 161 passed |
| Real episode: screenshot shows the English hardsub; fullscreen; the helper copy logs nothing | not run |

| # | Sev | Issue | Status |
|---|---|---|---|
| 1 | P2 | Screenshots need the tab visible: a line that plays while you're in another tab or window is logged without one. | by design |
| 2 | P2 | No page to browse the notebook yet (popup shows the count). | fixed in PR 29 |

---

## 2026-11-13 — Example sentences (PR 27, on top of PR 26) — PASS (automated), manual not run

| Check | Result |
|---|---|
| `npm run dict` (format v5: jmdict-examples-eng, 2 sentences per entry) | ✓ 219040 words; 28,928 entries have sentences; dict 17 → 19 MB |
| `npm run typecheck`, `npm run build` (65.46 MB) | ✓ |
| `e2e/pr-27-example-sentences.spec.ts` | ✓ 4 passed (first run: P2-X4 seeked past the 41 s test clip; cue times moved inside it) |
| `npm run test:e2e` (155 = 151 + 4 new) | ✓ 155 passed |
| Real episode | not run |

| # | Sev | Issue | Status |
|---|---|---|---|
| 1 | P2 | EDRDG's own download (examples.utf) fails HTTPS certificate checks. | avoided: same Tanaka sentences from jmdict-simplified over HTTPS |
| 2 | P2 | Episode lines match by dictionary form as written: a kana-written あきらめた doesn't list under 諦める. | open |

---

## 2026-11-13 — Word splitting and names (PR 26) — PASS (automated), manual not run

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run build` (63.6 MB) | ✓ |
| `npm run dict` (format v3: usually-kana flag) | ✓ 219040 words, 7747 with a JLPT level |
| `e2e/pr-26-word-splitting.spec.ts` | ✓ 7 passed |
| `e2e/pr-11-word-lookup.spec.ts` (漠然 → 漠然と in P2-W1, W4) | ✓ 6 passed |
| `npm run test:e2e` (151 = 144 on main + 7 new) | run 1: 146 passed, 1 failed (pr-6 "skip ahead", passes alone 11/11), 4 did not run; run 2 ✓ 151 passed |
| Real episode (Euphonium: 久美子, 麗奈, 滝先生) | not run |

| # | Sev | Issue | Status |
|---|---|---|---|
| 1 | P2 | Names were split into dictionary pieces (久美子 → 美). | fixed: kuromoji names |
| 2 | P2 | Kana-only words weren't found or underlined. | fixed: dictionary form from kuromoji |
| 3 | P2 | Surnames IPADIC doesn't know (黄前) still split; pieces are no longer underlined. | open (JMnedict could fill; not bundled) |
| 4 | P2 | pr-6 "skip ahead" failed once under full parallel load, passed alone and on rerun. | open (flaky; watch) |

---

## 2026-11-13 — Steadier auto-sync offset (PR 25) — PASS (automated), manual not run

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run build` | ✓ |
| `e2e/pr-25-steadier-offset.spec.ts` + `e2e/pr-5-auto-sync.spec.ts` | ✓ 29 passed |
| `npm run test:e2e` (150 = 144 on main + 6 new) | first run: 148 passed + 2 errors outside any test (near the Shift-JIS file test); rerun ✓ 150 passed |
| Simulated sync accuracy (throwaway, 8 settings × 8 runs, 60–180 s) | within 0.1 s, or 0.4 s when lines start 0.3 s before the voice; never off by ~1 s |
| Real episode (Hibike! Euphonium) | not run |

| # | Sev | Issue | Status |
|---|---|---|---|
| 1 | P1 | A manual fix of a wrong auto-sync was learned as your "preference" and added to every later sync, in every show. | fixed: only changes ≤ 0.5 s are learned, per show, median |
| 2 | P2 | One short check (12 s of audio with a remembered offset) could move a show's offset by up to 1.5 s. | fixed: changes > 0.5 s must be found again 5 s later |
| 3 | P2 | 2 errors outside any test on one full run, not reproduced on the rerun. | open (flaky; watch) |
| 4 | P2 | The new `; last episode …` popup note isn't covered by e2e (needs a show id, i.e. the Jimaku flow). | open |

---

## 2026-11-13 — Word clicks in fullscreen (PR 24) — PASS (automated), manual not run

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run build` | ✓ |
| `e2e/pr-24-fullscreen-clicks.spec.ts` | ✓ 4 passed |
| same spec with the old `overlay.ts` | ✘ 3 failed (P2-F1..F3), 1 passed: confirms the bug |
| `npm run test:e2e` (148 = 144 + 4 new) | ✓ 148 passed |
| Click a word in fullscreen on animepahe | not run |

| # | Sev | Issue | Status |
|---|---|---|---|
| 1 | P1 | In fullscreen Chrome makes everything outside the fullscreen element inert: the line showed but clicks went to the video. | fixed: overlay moves inside the fullscreen element |
| 2 | P2 | A player that makes the `<video>` itself fullscreen can't hold the overlay: lines show, clicks don't. | known limit (README) |

---

## 2026-11-13 — Rename to JimakuKasane 字幕重ね + icons (PR 21) — PASS (automated)

| Check | Result |
|---|---|
| `npm run typecheck` | ✓ |
| `e2e/pr-21-branding.spec.ts` + renamed checks in pr-1 / pr-12 | ✓ 14 passed |
| `npm run test:e2e:full` (144 = 141 + 3 new) | ✓ 144 passed |
| Look of the icon in the real toolbar | not run |

| # | Sev | Issue | Status |
|---|---|---|---|
| 1 | — | Anki tags change from `jp-sub-overlay` to `jimaku-kasane`; cards exported before keep the old tag. | by design |

---

## 2026-11-13 — Page's own Japanese subtitles (PR 17) — PASS (automated), manual not run

| Check | Result |
|---|---|
| `npm run typecheck` | ✓ |
| `e2e/pr-17-page-tracks.spec.ts` | ✓ 5 passed |
| `npm run test:e2e:full` | ✓ 141 passed |
| Manual on a real episode | not run |

| # | Sev | Issue | Status |
|---|---|---|---|
| 1 | P2 | Players that draw subtitles themselves without exposing a text track (Netflix, Crunchyroll's own renderer) aren't covered; reading those would need site-specific code (AGENTS.md: none). | open (by design) |

---

## 2026-11-13 — History (PR 16) — PASS (automated), manual not run

| Check | Result |
|---|---|
| `npm run typecheck` | ✓ |
| `e2e/pr-16-history.spec.ts` | ✓ 5 passed |
| `npm run test:e2e:full` | ✓ 136 passed |
| Manual on a real episode | not run |

---

## 2026-11-13 — Listening practice (PR 15) — PASS (automated), manual not run

| Check | Result |
|---|---|
| `npm run typecheck` | ✓ |
| `e2e/pr-15-listening-practice.spec.ts` | ✓ 4 passed |
| `npm run test:e2e:full` | ✓ 131 passed |
| Manual on a real episode | not run |

| # | Sev | Issue | Status |
|---|---|---|---|
| 1 | P1 | Found while testing: study mode (PR 13) paused just after a line ended, so the line had already disappeared. Now the ended line stays on screen until you play or seek; P2-M1 checks it. | fixed |

---

## 2026-11-13 — Style settings (PR 14) — PASS (automated), manual not run

| Check | Result |
|---|---|
| `npm run typecheck` | ✓ |
| `e2e/pr-14-style-settings.spec.ts` | ✓ 5 passed |
| `npm run test:e2e:full` | ✓ 127 passed |
| Manual on a real episode | not run |

---

## 2026-11-13 — Study mode (PR 13) — PASS (automated), manual not run

| Check | Result |
|---|---|
| `npm run typecheck` | ✓ |
| `e2e/pr-13-study-mode.spec.ts` | ✓ 4 passed |
| `npm run test:e2e:full` | ✓ 122 passed |
| Manual on a real episode | not run |

| # | Sev | Issue | Status |
|---|---|---|---|
| 1 | P2 | Lines from Whisper (live) never pause (they arrive after being spoken). | by design |

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
| 1 | P2 | Word splitting is longest-match (no grammar parser): kana-only stretches can split oddly (e.g. になった tagged N1 via 似る). Kana-only words are never underlined, so this only affects what a click shows. | fixed in PR 26 (kuromoji) |
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
