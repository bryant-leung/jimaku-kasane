# server

Local service for episodes nobody has uploaded Japanese subtitles for yet. The extension sends the episode's speech (16 kHz chunks cut at pauses) and gets Japanese lines back, timed to the video. Everything runs on your Mac.

## Run

```bash
cd server
uv sync                                    # first time (Python 3.12, installs MLX Whisper)
uv run uvicorn app.main:app --port 8765    # leave running while you watch
```

- The first start downloads the Whisper model (`mlx-community/whisper-large-v3-turbo`, ~1.6 GB) and loads it (~45 s). Later starts are quick.
- Apple Silicon only (MLX). Measured on an M3 Pro: ~1.4 s to transcribe 12 s of audio.
- Then open an episode Jimaku doesn't have. The popup says "Transcribing live with Whisper", and lines appear a few seconds after they're spoken. If the server was started after the episode, press **Check Jimaku again**.

### Optional: name correction with Ollama (free, local)

```bash
brew install ollama
ollama serve &              # or open the Ollama app
ollama pull qwen2.5:7b      # ~4.7 GB
```

Without Ollama the `correct` step is skipped and Whisper's text is used as is.

## Pipeline (LangGraph)

```
fetch_context   AniList: native title + character names (cached per show)
→ build_glossary
→ transcribe    MLX Whisper, language=ja, glossary as initial prompt, one greedy pass
→ correct       Ollama proposes name fixes; only glossary spellings are applied, nothing else changes (4 s budget)
→ score         confidence = exp(avg_logprob) × (1 − no_speech_prob); low ones show in italics
```

Known Whisper hallucinations on silence/music ("ご視聴ありがとうございました", …) and repetition loops are dropped.

## API

| Method | Path | Body / result |
|---|---|---|
| GET | `/health` | `{status, model, llm}` |
| POST | `/transcribe` | `{anilist_id?, title, start, sample_rate: 16000, audio: base64 PCM16 mono ≤ 30 s, partial?: bool}` (`partial`: draft of a line still being spoken, skips correction) → `{cues: [{start, end, text, raw, confidence}]}` (times in video seconds) |

Binds to 127.0.0.1 only. CORS allows `chrome-extension://` origins.

## Settings (`.env` at the repo root, all optional)

`SERVER_PORT` (8765), `WHISPER_MODEL`, `OLLAMA_BASE_URL` (http://localhost:11434), `OLLAMA_MODEL` (qwen2.5:7b), `LLM_TIMEOUT_S` (4).

## Develop

```bash
uv run ruff check .      # lint
uv run mypy app          # types (strict)
uv run pytest            # tests with fake Whisper, AniList and Ollama
```

```
app/
  main.py       FastAPI app: /health, /transcribe; warms the model on start
  pipeline.py   LangGraph graph
  asr.py        Whisper (MLX) behind a Transcriber protocol
  anilist.py    show context for the glossary
  llm.py        Ollama corrector (any failure = no correction)
  config.py     settings
tests/          pytest (P3-01..P3-09)
```
