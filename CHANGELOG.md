# Changelog

Versions follow [semantic versioning](https://semver.org): **patch** (1.0.1) for fixes, **minor** (1.1.0) for new features, **major** (2.0.0) when something you rely on changes in an incompatible way (e.g. the notebook's storage or the Anki note type).

## Unreleased

### Fixed
- Notebook screenshots come from the video's own picture: they work while you're in another tab and never show the player's controls (falls back to a tab screenshot when a site doesn't allow it) (#43).
- Text in brackets (speaker labels （久美子）, readings like 北宇治(きたうじ)) is never underlined or logged; うじ was being logged as 氏 (#42).
- A notebook card without a screenshot shows a slim note instead of an empty frame (#42).
- Notebook screenshots no longer show the player's control bar: they wait until the pointer has left the video alone for 3 s; words you click reuse the line's clean frame instead of a shot of the paused player with the card open (#41).

## 1.1.0 — 2026-11-14

The notebook becomes a study tool: one card per word, sorting, grouping, topics, jump to scene and bulk actions.

### Notebook
- One card per word: sightings across episodes are merged ("Seen in N episodes"), with a strip to flip between them (#35).
- Sort: most seen, hardest first, newest, reading (あいう), episode order; group by show or not at all (#35).
- Search matches hiragana and katakana to each other (#35).
- Group by episode, level, type or part of speech; compact list view (#36).
- Group by topic (JMdict subject tags: music, baseball, food…) or by anime genre (AniList, cached) (#37).
- Jump to scene: opens the episode at 2 s before the line (#38).
- Bulk actions (select, then mark learned / delete / export) and a stats line (#39).
- Steadier test suite: the Whisper "skip ahead" test waits longer under load; the helper copy's lines skip notebook work early (#36).
- Anki export: one note per word. Notes from a 1.0.0 export of a word met in several episodes aren't matched; delete those in Anki if you re-export (#35).

## 1.0.0 — 2026-11-14

First versioned release. Everything up to PR #33.

### Subtitles and timing
- Japanese line under the English hardsub on streaming sites (also in cross-origin player iframes and fullscreen), loaded automatically from Jimaku via AniList, or from a file, the page's own track, or local Whisper transcription (live or prepared ahead in a hidden copy).
- Auto-sync from the video's audio (on-device voice detection), remembered per file and per show; steadier between episodes: a change of more than 0.5 s must be confirmed twice, and only small manual corrections are learned, per show (#25).
- Compare mode (Whisper vs a real file), toolbar badge, history.

### Learning tools
- Click any word for an offline JMdict card (JLPT level, meanings), with example sentences from Tatoeba and other lines from this episode (#27); works in fullscreen (#24, #32).
- Word splitting with kuromoji: names stay whole (久美子), kana words find their dictionary form (#26).
- Underlines only for genuinely challenging words: not pronouns, interjections, loanwords or words built from kanji you know; niche words one level easier included (#33).
- Replay (`R`), save (`S`) with Anki text export, study mode, listening practice, style settings.

### Study notebook
- Words and 126 N2/N1 grammar patterns harder than your level are logged by themselves with their line and a screenshot of the video (#28, #30, #32).
- Notebook page: by show and episode, search, filters, learned, delete (#29).
- Export as an Anki deck (.apkg) with the screenshots on the cards (#31).
