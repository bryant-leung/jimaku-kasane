# JP Sub Overlay

A Chrome extension that shows **Japanese subtitles** over streaming anime: an extra line under the burned-in English subs, for Japanese learners. It finds the show and episode, downloads the Japanese subtitles and keeps them in time with the video, without any clicks.

## What it does

1. **Finds the video** on any site, including players inside cross-origin iframes (e.g. Kwik on animepahe). It uses no site-specific code.
2. **Recognises the episode** from the page title: `Show Ep. 44`, `Show Episode 44` or `Show - 44 :: site`.
3. **Finds the season on AniList** and works out the episode number each source uses. Sites often count from episode 1 of season 1, AniList counts per part and uploaders per season: site ep 44 = AniList *Season 2 Part 2* ep 5 = Jimaku "S2 - 17".
4. **Downloads the Japanese subtitles from Jimaku.** It prefers streaming rips (Netflix/Amazon/Disney…) because their timing matches the stream, and skips image subtitles (`.sup`).
5. **Syncs automatically while you watch.** It listens to the video's own audio with a small on-device voice detector ([Silero VAD](https://github.com/snakers4/silero-vad)) and lines the subtitles up with the speech:
   - already in time → left alone ("timing already matches");
   - shifted (common with TV-broadcast rips against a streamed episode) → offset set by itself;
   - unsure → keeps listening up to 3 min, then keeps the show's remembered offset.
6. **Remembers your offset per show.** The next episode starts from it.
7. **No subtitles anywhere yet?** With the local server running, it transcribes the episode's Japanese audio live (MLX Whisper, names corrected by a local LLM via LangGraph). By default it **prepares ahead**: a minimized, muted copy of the episode plays at 1.5× and is transcribed, so lines reach your tab before they're spoken and are timed exactly (start watching a minute or so after opening the episode). Turn it off in Settings to transcribe your own tab live instead (a draft appears about a second after someone speaks).

The Japanese line sits small under the English hardsubs and stays visible in fullscreen.

## Install (Chrome)

```bash
npm install
npm run build   # first time also downloads the dictionary (~12 MB)
```

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, pick `extension/dist/chrome-mv3`.
2. Click the extension's toolbar icon → **Settings** → paste your **Jimaku API key** (jimaku.cc → Account) → **Save**. The key is kept in Chrome's local storage only.
3. Open an episode and press play.

After changing code: `npm run build`, click ↻ on the extension card, **then reload the video tab**. A tab that wasn't reloaded keeps the old, disconnected copy; it removes its overlay within 2 s.

## Using it

| Where | What |
|---|---|
| Toolbar icon badge | `JP` real subtitles · `AI` Whisper lines · `…` looking / preparing · `!` needs you (hover for why) |
| Popup "Auto:" line | What was found: show, season, episode, file, inherited offset |
| Popup status under the buttons | Auto-sync progress (`75s heard, 48s of speech; best guess +3.6s`) and the result |
| `[` / `]` on the video page | Subtitles 0.1 s earlier / later |
| `Shift` + `[` / `]` | 1 s earlier / later |
| `\` | Reset offset to 0 |
| Click a Japanese word | Its dictionary entry (reading, JLPT level, meanings); pauses the video, Esc or ✕ to close. Words harder than your level get a faint dotted underline (Settings: default N2 → N1 and rare words underlined) |
| `S` | Save the current Japanese line for review (the dictionary card has **Save** for a word). Popup → **Export for Anki** gives a file for Anki's File → Import |
| `R` | Replay the current Japanese line (press again right away: the line before) |
| Popup buttons | Same offsets, plus **Auto-sync timing** (manual 60 s listen via tab capture) |
| Popup **Settings › Japanese line** | Text size (Small–Larger), height (lift it above the English subs), dark box behind the text |
| Popup **Listening practice** | The Japanese line stays hidden; hold `H` to see it. With study mode it shows by itself when the video pauses at the line's end |
| Popup **Study mode** | Pauses when each Japanese line ends (play to continue, `R` to hear it again). Off by default |
| Popup **Show Japanese subtitles** / **Off on <site>** | Switch everything off, or just for one site (e.g. YouTube). Off = nothing shown, nothing looked up, nothing listened to |
| Popup **Compare with Whisper** | On an episode with a real file and the server running: Whisper listens alongside (its lines aren't shown) and the popup shows its error rate against the file, before and after name correction, and its timing. **Copy report** copies all compared episodes as a table |
| Popup **Subtitle file** | Load your own `.srt` / `.ass` (UTF-8, UTF-16 or Shift-JIS) |

Positive offset = subtitles later. Offsets are saved per subtitle file and per show.

## Privacy

- Audio is analysed **in memory on your computer** and never stored or sent anywhere.
- Network requests go only to AniList (show lookup) and Jimaku (subtitles). Only page titles that look like an episode, on pages with a video, are sent to AniList.
- No LLM keys or server are needed for any of the above.

## Limits

- Chrome only for audio sync (Safari has no `tabCapture`/`offscreen`); Safari build untested.
- The page title must contain the episode number (`Ep 44`, `Episode 44` or `- 44`). Otherwise the popup says so and you can load a file manually.
- Episodes nobody has uploaded Japanese subtitles for yet need the local server running ([server/README.md](server/README.md)): it transcribes the audio live with Whisper, so lines appear a few seconds late and can contain mistakes (unsure lines are shown in italics).
- The extension is ~46 MB: the ONNX runtime for the voice model and the offline dictionary.

## Repo layout

```
extension/   Chrome MV3 extension (TypeScript, WXT): see extension/README.md
e2e/         Playwright tests: real extension in Chromium, fake sites, mocked AniList/Jimaku,
             a speech-over-music audio clip for sync tests
docs/        ARCHITECTURE, DECISIONS, ROADMAP, TEST_PLAN (case IDs), TEST_RESULTS (run log)
server/      Local Python service: MLX Whisper + LangGraph fallback (see server/README.md)
```

## Development

| Command | What |
|---|---|
| `npm run dev` | Chrome with the extension, hot reload |
| `npm run build` | Production build → `extension/dist/chrome-mv3` |
| `npm run typecheck` | `tsc` for extension + tests |
| `npm run test:e2e` | Full suite, parallel, dot output (~1.5 min; audio tests run one at a time) |
| `npm run test:e2e:changed` | Only specs touched by uncommitted changes |
| `npm run test:e2e:failed` | Only last run's failures |
| `npm run test:e2e:full` | One line per test, for PR logs |

First time only: `npx playwright install chromium`. Conventions (branches, commits, one spec per PR) are in [AGENTS.md](AGENTS.md). Test cases and their IDs are in [docs/TEST_PLAN.md](docs/TEST_PLAN.md); every PR run is logged in [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md).

## Status

| Phase | State |
|---|---|
| 0 Scaffold | done |
| 1 Overlay, parser, offsets, AniList + Jimaku auto-load | done |
| 3a Audio auto-sync (VAD, no click) | done; checked on real episodes |
| 3b Whisper + LangGraph fallback, live drafts | done; checked on a real episode (Ollama correction not yet) |
| 2 Furigana, word lookup, style settings | next (on/off switches done) |
| 4 Evaluation: compare mode (CER, timing) | built; real runs pending |

Work lands through stacked pull requests (#1 → #2 → #4 → #5 → #6 → #8 → #9 → #10 → #11 → #12 → #13 → #14 → #15); GitHub's `main` shows it once they are merged.

Details: [docs/ROADMAP.md](docs/ROADMAP.md) · design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Credits

- Dictionary: [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) © Electronic Dictionary Research and Development Group, CC BY-SA 4.0, via [jmdict-simplified](https://github.com/scriptin/jmdict-simplified).
- JLPT levels: Jonathan Waller's lists, via [yomitan-jlpt-vocab](https://github.com/stephenmk/yomitan-jlpt-vocab), CC BY-SA 4.0.
- Voice detection: [Silero VAD](https://github.com/snakers4/silero-vad), MIT.

## Disclaimer

Personal learning tool. It does not host, download or redistribute video. Subtitle files are fetched from their public source at runtime for personal use.
