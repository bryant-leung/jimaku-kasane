# Plan: study notebook + better hiragana handling

Goal: while you watch, words and grammar that are worth learning **for an N2 holder** are logged by themselves (no clicking), each with the sentence, its meaning and a **screenshot of the frame** (which shows the burned-in English line), so you can review later and see where each came from. Subtitles written in plain hiragana get the same treatment as kanji ones.

Built one step at a time, one PR each, in this order (each step is usable on its own).

## Step 1 — Real word splitting (fixes hiragana-only subtitles)

Today words are found by longest dictionary match, and only words with kanji (or long katakana) are underlined. Kana-only text splits badly (`あきらめない` can be read as `あき + らめ…`) and is never marked.

- Add **kuromoji.js** (Japanese morphological analyser, Apache-2.0, IPADIC) to split lines into real words with their **dictionary form, reading and part of speech**. Runs in the extension's offscreen page; about +17 MB to the extension.
- Look each word up in JMdict by dictionary form **and** by reading, so `あきらめない` → 諦める (N2).
- Kana-written words get levels and underlines like kanji ones; particles, auxiliaries and names (proper nouns) are never marked.
- Dictionary card says how it's usually written: `あきらめる — usually written 諦める`.
- The current longest-match splitter stays as a fallback.
- Tests: a set of lines written in kanji and in kana must give the same words and levels.

## Step 2 — Automatic logging with screenshots

- **What's logged (default: N2, N1 and rare words)**: words harder than your comfort level. Setting: *Log words harder than* N3 (default) / N2 / N1 / Off. Plus words you click and lines you save with `S`.
- Once per word per episode; skips names, words you've marked *learned*, and lines from Whisper drafts.
- **Screenshot**: one per line that has something logged, taken around the middle of the line so the English hardsub is on screen; shared by every word from that line. JPEG, ~640 px wide (~40 KB). Needs Chrome's visible-tab capture (no new install warning: the extension already runs on all sites) and *unlimited storage*.
- Each entry: word (kanji + reading), meaning, level, the Japanese line with the word highlighted, screenshot, show / episode / time, link to the episode.
- Stored in IndexedDB on your computer; nothing uploaded.
- Safety valve: at most 80 entries per episode (setting), so a dense episode can't flood the notebook.

## Step 3 — Notebook page

- Opened from the popup (**Notebook**). Grouped by show → episode, newest first.
- Each card: screenshot thumbnail (click to enlarge), word, reading, meaning, level, sentence, time.
- Search; filters by level, words / grammar, show, *not learned yet*.
- **Learned** tick (hides it and stops logging that word); delete.

## Step 4 — Grammar points

- A curated list of about 120 N2/N1 grammar patterns written for this project (e.g. ～ざるを得ない, ～にもかかわらず, ～わけにはいかない, ～に越したことはない), each with a one-line English meaning and its level.
- Matched on kuromoji's words (dictionary forms), so conjugated forms count (得なかった, いかなかった).
- Logged like words: the sentence, screenshot, pattern and meaning. Pattern matching can misfire occasionally; entries can be deleted or marked learned.

## Step 5 — Anki export with pictures

- Export the notebook (or a filter of it) as an Anki deck file (`.apkg`) with the screenshot on each card, so images come along (the current text export can't carry them).
- Front: word / grammar pattern + the sentence; back: reading, meaning, screenshot, source.

## Later / optional

- English for sites without burned-in English subs: optional sentence translation by your local Ollama.
- Kanji hint above kana-written words on the overlay (off by default; you have your own furigana plans).

## Defaults to confirm

| Decision | Proposed |
|---|---|
| Log words harder than | N3 → logs N2, N1, rare |
| Underlines on screen | unchanged (N1 + rare); separate setting |
| Max entries per episode | 80 |
| Extension size | ~46 MB → ~63 MB (kuromoji dictionary) |
