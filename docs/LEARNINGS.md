# What this project taught me for my final year project

JimakuKasane started as a tool for learning Japanese from anime. It also became hands-on practice for my final year project: a **retrieval-augmented generation (RAG) system for disaster resilience that reasons over time and place**. The domains differ (subtitles vs disaster information), but many of the problems are the same: grounding an LLM in retrieved facts, lining up streams of events in time, processing data as it arrives, working in more than one language, and measuring whether any of it is actually right.

This note maps what I built here to what I expect to need there, and lists what this project did **not** cover.

---

## 1. LangGraph pipelines

**Here:** the local server runs a LangGraph graph: `fetch_context → build_glossary → transcribe → correct → score` ([server/app/pipeline.py](../server/app/pipeline.py)). Each node reads and writes a typed shared state, records itself in a trace, and can fail without taking the whole request down.

**Lessons for the FYP:**
- Shape the work as small nodes over one typed state; it keeps each step testable on its own (each node has a fake in `server/tests`).
- Put **time budgets** on LLM steps. The correction step gets 4 s; past that, the uncorrected text is used. One slow model call once froze live subtitles for 21 s, which taught me this the hard way.
- **Degrade, don't fail:** no LLM or no AniList → the pipeline still returns Whisper's lines. A disaster assistant must still answer, with lower confidence, when one source is down.
- Lock only the scarce resource (the Whisper model), not the whole pipeline, so quick requests aren't stuck behind slow ones.

## 2. Retrieval and grounding (the "R" in RAG)

**Here:** before transcribing, the pipeline retrieves the show's context from AniList (title, character names) and turns it into a glossary. The glossary steers Whisper (as its prompt) and constrains the LLM corrector.

**Lessons:**
- **Retrieved context as a whitelist**, not just extra prompt text. The first version let the LLM rewrite lines freely, and it reworded them and invented surnames. The fix: the LLM may only *propose* replacements, and code applies only those whose new text is a retrieved glossary spelling. In a disaster RAG this is how to keep answers tied to retrieved sources: verify the output against what was retrieved, in code.
- **Cache retrieval per entity** (one AniList lookup per show, cached): the same applies to per-region or per-event context.
- Retrieval quality limits everything after it: a wrong season on AniList gives a wrong glossary and wrong names.

## 3. Temporal reasoning: lining up events in time

The most transferable part. Subtitles are timed events, and most of the work was getting two timelines to agree.

**Here:**
- **Offset estimation:** auto-sync finds the shift between subtitle times and the speech heard in the video (voice detection plus matching cue starts to speech starts), from noisy evidence (music, sound effects).
- **Confidence before acting:** it changes the timing only after three checks agree, keeps listening when unsure, and gives up after 3 minutes with a sensible default (the show's last offset).
- **Priors and learning:** the last offset for the show is the prior for the next episode, and your manual corrections become a learned bias.
- **Mapping between clocks:** the page's playback time, the audio clock and wall time differ; the code picks a consistent clock before comparing.
- **Episode numbering across sources:** the same episode is 44 on the site, 5 in AniList's Season 2 Part 2, and "S2 - 17" on Jimaku; a franchise walk maps between them. This is entity resolution across sources that count differently.

**Lessons for disaster data:**
- Reports, sensor readings and social posts arrive with **different clocks and delays**. Align them first, with an explicit estimate of the offset and how sure you are.
- Treat time alignment as **estimation with uncertainty**, not a lookup: accumulate evidence, require agreement, and know when to fall back.
- Keep a **prior per entity** (per show here; per region, sensor or agency there).
- The same event can have **different identifiers** in different sources; resolving them is its own step.

## 4. Streaming and incremental processing

**Here:**
- Live transcription cuts audio into segments at pauses, shows a **draft** of a line while it's still being spoken, then replaces it with the **final** line.
- **Prepare-ahead** runs a second copy at 1.5× to process ahead of the viewer, and jumps when the viewer skips.
- Results arrive out of order and have to be merged into one timeline without duplicates or pile-ups.

**Lessons:** for live disaster feeds, separate **provisional** answers (fast, may change) from **final** ones; process ahead when you can; design for out-of-order arrival; never let one slow item block the stream.

## 5. Evaluation

**Here:** **compare mode** scores Whisper against a real subtitle file while you watch: character error rate **before and after** the LLM correction step, plus timing error ([extension/src/lib/compare.ts](../extension/src/lib/compare.ts)). It only scores stretches that were actually listened to, so skipped parts don't count as misses.

**Lessons:**
- Measure each pipeline stage separately (before/after correction): it shows whether a stage helps or hurts. For RAG: answer quality with and without retrieval, with and without each source.
- Make evaluation part of normal use, not a separate project, so real data accumulates.
- Define the scoring window carefully; a naive metric punishes the system for data it never saw.
- Planned next here, and directly reusable: an **ablation** (glossary on vs off) to check that retrieved context measurably helps.

## 6. Multilingual text processing

**Here:** Japanese without spaces had to be split into words, inflected forms mapped back to dictionary forms (食べられなかった → 食べる), and words looked up in an offline dictionary built from JMdict and sharded for fast loading ([scripts/build-dict.mjs](../scripts/build-dict.mjs), [extension/src/lib/deinflect.ts](../extension/src/lib/deinflect.ts)).

**Lessons:**
- Disaster information is multilingual: Japan alone issues alerts in Japanese first. **Normalise text before retrieval** (word splitting, base forms, spelling variants) or matching misses obvious hits.
- **Build indexes ahead of time** and load only the shard you need: the dictionary build downloads, normalises, buckets by key and compresses. It's the same shape as building a keyword or vector index for documents.
- Rule-based steps (deinflection) are predictable and testable; use models where rules can't reach.

## 7. Running models locally

**Here:** MLX Whisper on an Apple Silicon Mac (about 1.4 s per 12 s of audio after removing a retry loop), Ollama with qwen2.5:7b, and Silero VAD in the browser via ONNX Runtime.

**Lessons:** measure latency per stage before optimising; warm models up at start; local models make privacy and offline use possible (relevant when networks are degraded during a disaster), at the cost of quality, so pair them with checks.

## 8. Engineering habits

- **Tests with fakes for every external service:** the e2e suite (144 Playwright tests) mocks AniList, Jimaku and the transcription server; the server's pytest suite fakes Whisper, AniList and Ollama. Most bugs found in real use got a regression test.
- **Test plan with IDs and a results log** ([TEST_PLAN](archive/TEST_PLAN-2026-11.md), [TEST_RESULTS](archive/TEST_RESULTS-2026-11.md), both archived), recording failures honestly, not just passes.
- **One PR per feature**, conventional commits, decisions written down ([DECISIONS.md](DECISIONS.md)).
- **Privacy by design:** audio analysed in memory, nothing uploaded, secrets only in `.env`.

---

## What this project did *not* cover (to learn for the FYP)

- **Spatial reasoning.** Nothing here is geographic. Still to learn: geospatial data types and indexes (PostGIS, H3 or geohash), retrieval filtered by location and radius, map-based evaluation, and joining reports to places when names are ambiguous.
- **Vector search and embeddings.** Retrieval here is by exact keys (show ID, dictionary form). A document RAG needs embeddings, a vector store, chunking, and hybrid keyword + vector search with re-ranking.
- **Time-aware retrieval.** Here time was for alignment, not for ranking. A disaster RAG must prefer recent information, expire stale warnings, and answer "as of" a time.
- **Answer generation with citations.** The LLM here only corrects names; it never writes answers. The FYP needs generated answers that cite their sources, with faithfulness checks.
- **Scale.** One user, one episode at a time; no multi-user serving, queues or monitoring.

## Tools used here that carry over

| Tool | Used here for | Likely FYP use |
|---|---|---|
| LangGraph | ASR → correction pipeline with budgets and fallbacks | RAG orchestration: retrieve → filter by time/place → generate → verify |
| Ollama (local LLM) | Constrained name correction | Local generation and checks; offline fallback |
| FastAPI | Local transcription API | Serving the RAG backend |
| pytest with fakes, Playwright | Server and browser tests | Pipeline and UI tests |
| Typed Python (mypy strict), TypeScript strict | All code | Same |
| Offline index building | JMdict → sharded, compressed buckets | Building document / keyword indexes |
