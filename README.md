<p align="center">
  <img src="docs/assets/logo.svg" width="112" alt="JimakuKasane logo: a Japanese subtitle card layered over an English one">
</p>

<h1 align="center">JimakuKasane 字幕重ね</h1>

<p align="center">
  <b>Japanese subtitles, layered under the English ones.</b><br>
  A Chrome extension for learning Japanese from anime: auto-synced Japanese lines, click-for-meaning, and study tools.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-yellow"></a>
  <img alt="Chrome MV3" src="https://img.shields.io/badge/Chrome-MV3-4285F4?logo=googlechrome&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white">
  <img alt="WXT" src="https://img.shields.io/badge/built%20with-WXT-67D55E">
  <img alt="Python server" src="https://img.shields.io/badge/server-Python%203.12-3776AB?logo=python&logoColor=white">
  <img alt="LangGraph" src="https://img.shields.io/badge/LangGraph-Whisper%20pipeline-1C3C3C?logo=langchain&logoColor=white">
  <img alt="Playwright tests" src="https://img.shields.io/badge/Playwright-148%20e2e%20tests-2EAD33?logo=playwright&logoColor=white">
  <img alt="Offline dictionary" src="https://img.shields.io/badge/dictionary-JMdict%20offline-d7263d">
</p>

> 字幕 *jimaku* = subtitles · 重ね *kasane* = layering. An independent personal project; not affiliated with [Jimaku](https://jimaku.cc), which it uses as one of its subtitle sources.

A Chrome extension for Japanese learners who watch anime with burned-in English subtitles. It adds a **Japanese subtitle line** under the English one, keeps it in time with the video, and turns it into a study tool: click any word for its meaning, replay or save lines, pause after each line, or hide the line to practise listening.

Open an episode and it does the rest: finds the show and episode, fetches the Japanese subtitles and syncs them to the audio, with no clicks. When nobody has published Japanese subtitles yet (e.g. on release day), an optional local server transcribes the episode with Whisper.

---

## Contents

- [Quick start](#quick-start)
- [Where the Japanese subtitles come from](#where-the-japanese-subtitles-come-from)
- [Timing and auto-sync](#timing-and-auto-sync)
- [Release-day episodes: Whisper fallback](#release-day-episodes-whisper-fallback)
- [Learning tools](#learning-tools)
- [Controls reference](#controls-reference)
- [Settings](#settings)
- [Compare mode (Whisper accuracy)](#compare-mode-whisper-accuracy)
- [Privacy](#privacy)
- [Limits](#limits)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Status](#status)
- [Credits](#credits) · [Disclaimer](#disclaimer)

---

## Quick start

Requirements: Chrome and Node.js (built with Node 24). Optional, for release-day episodes: an Apple Silicon Mac with [uv](https://docs.astral.sh/uv/) (see [server/README.md](server/README.md)).

```bash
npm install
npm run build   # first run also downloads and builds the offline dictionary (~12 MB download)
```

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, pick `extension/dist/chrome-mv3`.
2. Pin **JimakuKasane** (puzzle icon → pin) so you can see its badge.
3. Click the icon → **Settings** → paste your **Jimaku API key** (free: jimaku.cc → Account) → **Save**. It's stored in Chrome's local storage only.
4. Open an episode and press play. The Japanese line appears under the English one and the badge shows `JP`.

**After pulling or changing code:** run `npm run build`, click ↻ on the extension card in `chrome://extensions`, **then reload the video tab**. A tab that wasn't reloaded keeps the old, disconnected copy (it removes its overlay within 2 s).

---

## Where the Japanese subtitles come from

For each episode the extension tries these sources, best first:

| # | Source | When | Timing |
|---|---|---|---|
| 1 | **The video's own Japanese track** | The player exposes a Japanese subtitle track (HTML5 `<track>`, or an HLS/DASH player that publishes its subtitles as text tracks). Lines streamed in later are picked up too. | Official and already in time; never re-synced |
| 2 | **Jimaku** ([jimaku.cc](https://jimaku.cc)) | Someone has uploaded Japanese subtitles for the episode: TV-broadcast captions, Netflix/Amazon/U-NEXT/ABEMA rips, the old Kitsunekko archive. For a new episode this usually takes 1–3 days. | Usually close; auto-sync fixes shifts |
| 3 | **Whisper** (local server) | Nothing published yet and the server is running. | Prepared ahead: on time. Live: a few seconds late |
| — | **Your own file** | Popup → **Subtitle file** (`.srt`, `.ass`/`.ssa`; UTF-8, UTF-16 or Shift-JIS). Overrides the above for that tab. | Auto-sync applies |

How the Jimaku lookup finds the right file:

1. **Finds the video** on any site, including players in cross-origin iframes (e.g. Kwik on animepahe). There's no site-specific code.
2. **Reads the episode from the page title**: `Show Ep. 44`, `Show Episode 44`, `Show - 44 :: site`, including `Season 2 Part 2` style titles.
3. **Finds the season on AniList** by walking the franchise (prequels and sequels) and works out the episode number each source uses. Sites often count from episode 1 of season 1, AniList counts per part and uploaders per season: site ep 44 = AniList *Season 2 Part 2* ep 5 = Jimaku "S2 - 17".
4. **Picks a file**: prefers streaming rips (their timing matches streams) and skips image subtitles (`.sup`).
5. **Re-checks later**: an episode Jimaku didn't have is looked up again after 30 minutes (or press **Check Jimaku again**). When the file appears it replaces Whisper's lines.

---

## Timing and auto-sync

Subtitle files, especially TV rips, are often a few seconds off a streamed episode. The extension fixes this **by itself while you watch**:

- It listens to the video's own audio (no tab-capture prompt) with a small on-device voice detector ([Silero VAD](https://github.com/snakers4/silero-vad)) and lines the subtitle starts up with the speech. It copes with gapless TV captions and music-heavy scenes.
- **Already in time** (within 0.25 s): left alone, and the popup says "timing already matches".
- **Shifted**: the offset is set automatically once three checks agree, usually after 20–60 s of dialogue. The popup shows progress (`75s heard, 48s of speech; best guess +3.6s`).
- **Unsure**: keeps listening for up to 3 minutes, then keeps the show's remembered offset.
- **Learns your preference**: if you nudge the offset a little (up to 0.5 s) after an auto-sync, e.g. you like the Japanese line slightly after the voice, that adjustment is applied to future syncs of that show. Bigger changes are treated as fixing a wrong sync and aren't learned.
- **Steady per show**: a new episode's offset only moves more than 0.5 s from the show's last one if a second check on more audio agrees; the popup then says `Auto-synced: offset −1.8s; last episode −0.7s` so you notice.
- **Remembers per show**: the next episode of the show starts from its last offset.

Manual control is always there: `[` / `]` (±0.1 s), `Shift`+`[` / `]` (±1 s), `\` (reset), or the popup buttons. **Auto-sync timing (listen 60s)** in the popup runs a one-off sync via tab capture. A positive offset means the subtitles show later. Offsets are saved per subtitle file and per show.

---

## Release-day episodes: Whisper fallback

When Jimaku has nothing and the local server is running ([server/README.md](server/README.md)), the episode's Japanese audio is transcribed on your Mac with **MLX Whisper large-v3-turbo** through a **LangGraph** pipeline:

```
fetch_context (AniList: title + character names) → build_glossary → transcribe (Whisper, glossary as prompt)
→ correct (local Ollama LLM may only fix names to glossary spellings, 4 s budget) → score (confidence)
```

There are two modes:

- **Prepare ahead (default).** A **minimized, muted copy** of the episode opens in its own window and plays at 1.5×. It's transcribed ahead of you, so lines reach your tab before they're spoken and are timed exactly.
  - Leave the copy alone (it says so on screen) and watch your own tab; focus returns to it automatically. Give it about a minute's head start.
  - If you skip ahead (e.g. past the opening), the copy jumps to the same spot.
  - Prepared lines are auto-synced against your tab's audio, since the copy may play a slightly different source.
  - If the copy can't start within 25 s, it closes and your tab is transcribed live instead. **Stop preparing (use live)** in the popup does the same by hand.
- **Live** (Settings → untick *prepare ahead*). Your own tab is transcribed as it plays. A draft appears about a second after someone speaks and is replaced by the finished line.

Whisper's lines can contain mistakes, and unsure ones are shown in *italics*. Known Whisper hallucinations on silence or music ("ご視聴ありがとうございました"…) and repetition loops are dropped. The toolbar badge shows `AI` for Whisper lines.

---

## Learning tools

All of these work on any Japanese line, whatever its source.

### Click a word: offline dictionary

Click any word in the Japanese line. The video pauses and a card shows the word, its reading, its **JLPT level** (N5–N1, or *common* / *rare*) and up to three meanings, plus other matches. Close it with `Esc`, ✕, a click elsewhere or by pressing play, and the video continues.

- Works on inflected forms: 弄んでいる → 弄ぶ, 食べられなかった → 食べる, 勉強しない → 勉強.
- Names show as names with their reading (久美子 くみこ *Name*).
- **Examples**: up to two example sentences with English ([Tatoeba](https://tatoeba.org)), and up to three **other lines from this episode** with the same word. Click an episode line to jump there and hear it.
- Fully offline: [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) (219,000 entries) with JLPT levels from Jonathan Waller's lists, built into the extension by `npm run dict`.

### Underlines for words above your level

Words likely to be new to you get a **faint dotted underline**; nothing else is added to the screen. Choose your level in Settings → *Underline words harder than*:

| Setting | Underlined |
|---|---|
| N3 | N2, N1 and rare words |
| **N2 (default)** | N1 and rare words |
| N1 | rare words only |
| Off | nothing |

"Rare" means on no JLPT list and not marked common in JMdict. Only words with kanji (or long katakana words) are underlined.

### Replay a line: `R`

Jumps back to the start of the line being shown and plays. Press it again right away for the line before (like ⏮). Handy for shadowing.

### Save for review / Anki: `S`

`S` saves the line on screen with the show, episode and time. In the dictionary card, **Save** saves the word with its reading, its meaning and the line it's in.

Popup → **Export for Anki** downloads a file for Anki's **File → Import** (tab-separated, with HTML and header lines; needs Anki 2.1.55+):
- the front is the word (or the whole line);
- the back has the reading, the meaning, the line with the word in bold, and where it's from.

**Clear** empties the list; it takes two clicks so a stray one can't.

### Study notebook (automatic)

While you watch, words **harder than N3** (N2, N1 and rare words; change it in Settings → *Log to the notebook words harder than*) are logged by themselves, no clicking:
- each with its dictionary form, reading, meaning, level and the Japanese line;
- a **screenshot of the video**, taken once the line has been on screen about a second, so the English hardsub is in it. It's cropped to the video (not the site around it), or the whole screen in fullscreen; one per line, ~640 px JPEG;
- the show, episode, time and page.

Each word is logged once per episode; names, particles and words you've marked learned are skipped; an episode holds at most 80. Words you click are logged too, whatever their level.

**Grammar** is logged the same way: 126 N2 and N1 patterns written for this project (～ざるを得ない, ～わけにはいかない, ～にもかかわらず, ～をよそに…), each with a one-line meaning. They match conjugated forms too (得なかった, いかなかった). The same setting applies: harder than N3 logs N2 and N1 patterns. A pattern can occasionally misfire; mark it learned or delete it.

Popup → **Open notebook** shows them all, grouped by show and episode (newest first), each with its screenshot (click to enlarge), reading, meaning, level, the line with the word marked, and the time:
- **search** words, readings, meanings and lines; filter by **words / grammar**, **level** or **show**;
- **Learned** hides a word (untick *Hide learned* to see it again) and stops it being logged; **Delete** removes it and its screenshot;
- **Episode** opens the page it came from.

**Export for Anki (.apkg)** on the notebook page downloads what's listed (after filters) as an Anki deck, *JimakuKasane notebook*: the front shows the word or grammar pattern and its line, the back the reading, meaning, level, **screenshot** and source. Open the file to import it. Exporting again later updates the same cards instead of duplicating them.

### Study mode

A popup switch. The video **pauses as each line ends** and keeps the line on screen to read. Press play to continue, or `R` to hear it again. Skipping ahead doesn't trigger it, and it's not used for live Whisper lines (they arrive after being spoken).

### Listening practice

A popup switch. The Japanese line stays **hidden; hold `H` to see it**. With study mode also on, the line appears by itself when the video pauses at its end: listen first, then check.

---

## Controls reference

### Keys on the video page

The keys work whether focus is on the page or inside the player's iframe, and are ignored while you type in a text field. They're only taken while Japanese subtitles are loaded.

| Key | Action |
|---|---|
| `[` / `]` | Subtitles 0.1 s earlier / later |
| `Shift` + `[` / `]` | 1 s earlier / later |
| `\` | Reset offset to 0 |
| `R` | Replay the current line (twice quickly: the line before) |
| `S` | Save the current line for review |
| hold `H` | Show the line (listening practice) |
| `Esc` | Close the dictionary card |
| click a word | Dictionary card |

### Toolbar badge

| Badge | Meaning |
|---|---|
| `JP` (green) | Japanese subtitles loaded (Jimaku, your file or the page's own track) |
| `AI` (purple) | Lines transcribed by Whisper |
| `…` (grey) | Looking up the episode, or preparing ahead with no lines yet |
| `!` (red) | Needs you: no Jimaku key, nothing found and the server is off, or an error. Hover for the reason |
| (none) | Switched off, or nothing to do on this page |

### Popup

| Part | What |
|---|---|
| **Show Japanese subtitles** / **Off on &lt;site&gt;** | Switch everything off, or only for this site (e.g. YouTube). Off means nothing is shown, looked up or listened to |
| **Study mode** / **Listening practice** | See [Learning tools](#learning-tools) |
| **Auto:** line | What was found (show, season, episode, file, inherited offset), or why nothing was |
| **Check Jimaku again** | Look again now (e.g. a file was just uploaded) |
| **Stop preparing (use live)** | End prepare-ahead and transcribe your tab live |
| **Subtitle file** | Load your own `.srt` / `.ass` |
| **Offset** buttons, **Auto-sync timing** | Manual timing (see [Timing](#timing-and-auto-sync)) |
| **Compare with Whisper** / **Copy report** | See [Compare mode](#compare-mode-whisper-accuracy) |
| **Saved for review** / **Export for Anki** / **Clear** | See [Save for review](#save-for-review--anki-s) |
| **History** | Last 15 episodes: where the subtitles came from (Jimaku / Whisper / your file / the page's own subtitles), the offset used and when. Click one to reopen the episode |
| **Settings** | See below |

---

## Settings

Popup → **Settings**:

| Setting | Default | What |
|---|---|---|
| Jimaku API key | (none) | Needed for automatic subtitles |
| Prepare ahead | on | The Whisper fallback uses the minimized copy (on) or your own tab live (off) |
| Japanese line → Text size | Normal | Small / Normal / Large / Larger (×0.8 to ×1.5 of the automatic size) |
| Japanese line → Height | Under the English subs | A little higher / Higher / Much higher (5 / 10 / 20 % of the video height) |
| Japanese line → Dark box | off | Translucent box behind the text for busy scenes |
| Underline words harder than | N2 | N3 / N2 / N1 / Off |

Everything is stored in Chrome's local storage and applies immediately.

---

## Compare mode (Whisper accuracy)

To measure how good the Whisper fallback is, open an episode that **does** have a Jimaku file, start the server, and click **Compare with Whisper**. Whisper transcribes alongside (its lines aren't shown) and the popup scores it against the real file:

```
Whisper vs this file: 42 lines, 980 chars · error rate 18.2% (before name correction 21.0%) · timing off by 0.31s (median)
```

- **Error rate** is the character error rate. Punctuation, spaces and bracketed speaker names are ignored, and it's scored per stretch of continuous listening, so skipped parts don't count.
- **Before name correction** shows whether the LLM correction step helps.
- **Copy report** copies a Markdown table of every compared episode.

---

## Privacy

- Audio is analysed **in memory on your computer** (voice detection, auto-sync) and never stored.
- With the Whisper server, audio goes only to `127.0.0.1` (your own Mac), and the server binds to localhost only.
- The extension makes network requests to only two services:
  - **AniList**, for the show lookup. Only page titles that look like an episode, on pages with a video, are sent.
  - **Jimaku**, for subtitles, with your key.
- The dictionary is offline.
- Saved lines, history, offsets and settings stay in Chrome's local storage. The study notebook and its screenshots stay in the extension's IndexedDB on your computer. There are no accounts, analytics or LLM keys.
- Permissions: *all sites* (the subtitle overlay runs on any video page, and the notebook screenshots the tab you're watching; Chrome shows the same "all sites" warning either way), tab capture and offscreen (auto-sync), unlimited storage (notebook screenshots).

---

## Limits

- **Chrome only** for audio features (Safari has no `tabCapture`/`offscreen`). The tooling can build for Safari, but that build is untested.
- The page title must contain the episode number (`Ep 44`, `Episode 44` or `- 44`). Otherwise the popup says so and you can load a file manually.
- Players that draw their own subtitles without a text track (e.g. Netflix) aren't read. A video's own Japanese track is used only when the player exposes one.
- Release-day episodes need the local server (Apple Silicon). Whisper makes mistakes, especially with names, music and overlapping speech.
- Words are split by [kuromoji](https://github.com/takuyaa/kuromoji.js) (a Japanese grammar parser), so names stay whole (久美子 shows as a name, not 美) and kana words find their dictionary form (あきらめない → 諦める). Still expect some oddities:
  - names the parser doesn't know split up (黄前 → 黄 + 前); the pieces aren't underlined;
  - a few everyday words are on Waller's N1 list (e.g. 俺) and get underlined;
  - the first line after the extension wakes takes a second or two to split (the parser's dictionary loads).
- Clicking words works in fullscreen when the player makes its own box fullscreen (most players, including Kwik). If a player makes the bare `<video>` fullscreen, lines still show but can't be clicked; leave fullscreen to look words up.
- `R`, `S`, `H`, `[`, `]` and `\` are taken while subtitles are loaded; a site that uses those keys loses them then.
- The extension is about 66 MB: the ONNX runtime for the voice detector, the offline dictionary and the word splitter's dictionary.

---

## Troubleshooting

| Symptom | Try |
|---|---|
| Nothing appears after updating the extension | Reload the video tab (an old tab keeps the disconnected copy) |
| Badge `!`, "No Jimaku key" | Settings → paste the key → Save |
| "No Japanese subtitles on Jimaku … yet" | Start the server for Whisper, or wait: it re-checks every 30 min (or press **Check Jimaku again**) |
| Preparing ahead but no lines after a minute | The popup should say "copy is playing at m:ss". If it says the copy didn't start, it has switched to live. Check the server is running (`/health`) |
| Japanese line consistently early or late | Let auto-sync finish (popup status), or nudge with `[` / `]`; the show remembers it |
| Words aren't clickable | Run `npm run build` (builds the dictionary), ↻ the extension, reload the tab |
| A site's own keys stopped working | Those keys are taken while subtitles are loaded; switch the extension off for that site |

---

## Development

```
extension/   Chrome MV3 extension (TypeScript, WXT): see extension/README.md
server/      Local Python service: MLX Whisper + LangGraph (see server/README.md)
scripts/     build-dict.mjs: JMdict + JLPT lists → extension/public/dict/ (generated, not committed)
             make-icons.mjs: docs/assets/logo.svg → extension icons + social preview
e2e/         Playwright: real extension in Chromium, fake sites, mocked AniList/Jimaku/server,
             a speech-over-music clip for audio tests
docs/        ARCHITECTURE, DECISIONS, ROADMAP, TEST_PLAN (case IDs), TEST_RESULTS (run log)
```

| Command | What |
|---|---|
| `npm run dev` | Chrome with the extension, hot reload |
| `npm run build` | Dictionary (if needed) + production build → `extension/dist/chrome-mv3` |
| `npm run dict` | Build the dictionary only (downloads cached in `data/cache/dict/`; works offline once built) |
| `npm run typecheck` | `tsc` for extension + tests |
| `npm run test:e2e` | Full suite, parallel, dot output (~3 min, 148 tests; audio tests run one at a time) |
| `npm run test:e2e:changed` | Only specs touched by uncommitted changes |
| `npm run test:e2e:failed` | Only last run's failures |
| `npm run test:e2e:full` | One line per test, for PR logs |
| `cd server && uv run pytest` | Server tests (fake Whisper, AniList and Ollama) |

First time only: `npx playwright install chromium`.
- Conventions (branches, conventional commits, one Playwright spec per PR): [AGENTS.md](AGENTS.md).
- Test cases and their IDs: [docs/TEST_PLAN.md](docs/TEST_PLAN.md). Every PR's run is logged in [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md).
- Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Status

| Phase | State |
|---|---|
| 0 Scaffold | done |
| 1 Overlay, parser, offsets, AniList + Jimaku auto-load, the video's own Japanese track | done |
| 3a Audio auto-sync (VAD, no click) | done; checked on real episodes |
| 3b Whisper + LangGraph fallback, live drafts, prepare ahead | done; checked on a real episode. The prepare-ahead fixes and Ollama correction still need a manual check |
| 2 Learner features: dictionary + level underlines, replay, save/Anki, study mode, listening practice, style settings, badge, history | built; manual check pending |
| 4 Evaluation: compare mode (CER, timing) | built; real runs pending |
| Later | furigana (planned separately), audio clips on Anki cards, Safari |

Work lands through pull requests, one per feature, each with its own Playwright spec. Roadmap: [docs/ROADMAP.md](docs/ROADMAP.md).

---

## Credits

- Dictionary: [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) © Electronic Dictionary Research and Development Group, CC BY-SA 4.0, via [jmdict-simplified](https://github.com/scriptin/jmdict-simplified).
- Example sentences: [Tatoeba](https://tatoeba.org) (Tanaka Corpus), CC BY 2.0 FR, via jmdict-simplified.
- JLPT levels: Jonathan Waller's lists, via [yomitan-jlpt-vocab](https://github.com/stephenmk/yomitan-jlpt-vocab), CC BY-SA 4.0.
- Word splitting: [kuromoji.js](https://github.com/takuyaa/kuromoji.js) (Apache-2.0) with the IPADIC dictionary (© NAIST, BSD-style license).
- Logo and icons: `docs/assets/logo.svg` (rendered by `node scripts/make-icons.mjs`).
- Voice detection: [Silero VAD](https://github.com/snakers4/silero-vad), MIT.
- Subtitles: [Jimaku](https://jimaku.cc) and its uploaders. Show data: [AniList](https://anilist.co).
- Speech recognition: [Whisper](https://github.com/openai/whisper) via [MLX](https://github.com/ml-explore/mlx-examples). Pipeline: [LangGraph](https://github.com/langchain-ai/langgraph). Name correction: [Ollama](https://ollama.com).

## License

[MIT](LICENSE) © 2026 bryant-leung. Third-party parts keep their own licenses: Silero VAD, ONNX Runtime and sql.js (MIT, bundled); kuromoji.js (Apache-2.0) and IPADIC (BSD-style), bundled from npm at build time; JMdict and the JLPT lists (CC BY-SA 4.0) and Tatoeba example sentences (CC BY 2.0 FR), downloaded at build time, not in this repo.

## Disclaimer

Personal learning tool. It does not host, download or redistribute video. Subtitle files are fetched from their public source at runtime for personal use.
