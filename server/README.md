# server

Local FastAPI service for the phase 3 fallback: Whisper ASR + LangGraph correction pipeline.

## Planned structure
```
app/
  main.py         FastAPI app, routes
  config.py       settings from .env (pydantic-settings)
  asr/            Whisper wrapper
  graph/          LangGraph state, nodes, graph builder
  sources/        AniList + Jimaku clients
tests/
pyproject.toml
```

## Planned endpoints
| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness |
| POST | `/context` | AniList ID → glossary |
| POST | `/transcribe` | audio chunk + episode → corrected cues |
