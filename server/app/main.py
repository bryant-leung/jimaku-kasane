"""Local server for the extension: `uv run uvicorn app.main:app --port 8765` (see README)."""

import asyncio
import base64
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.anilist import ShowContext, fetch_context
from app.asr import MlxWhisper, Transcriber
from app.config import settings
from app.llm import Corrector, OllamaCorrector
from app.pipeline import build_graph

SAMPLE_RATE = 16_000
MAX_SECONDS = 30


class TranscribeRequest(BaseModel):
    anilist_id: int | None = None
    title: str = ""
    start: float = Field(ge=0, description="Video time (s) where this audio chunk starts")
    sample_rate: int = SAMPLE_RATE
    audio: str = Field(description="Base64 PCM, 16-bit little-endian, mono")


class CueOut(BaseModel):
    start: float
    end: float
    text: str
    raw: str
    confidence: float


class TranscribeResponse(BaseModel):
    cues: list[CueOut]


def create_app(
    transcriber: Transcriber | None = None,
    corrector: Corrector | None = None,
    client: httpx.AsyncClient | None = None,
) -> FastAPI:
    http = client or httpx.AsyncClient()
    asr = transcriber or MlxWhisper(settings.whisper_model)
    llm = corrector or OllamaCorrector(
        http, settings.ollama_base_url, settings.ollama_model, settings.llm_timeout_s
    )
    contexts: dict[int, ShowContext] = {}

    async def get_context(anilist_id: int) -> ShowContext:
        if anilist_id not in contexts:
            contexts[anilist_id] = await fetch_context(http, settings.anilist_graphql_url, anilist_id)
        return contexts[anilist_id]

    graph = build_graph(asr, llm, get_context)
    lock = asyncio.Lock()  # one transcription at a time: the model isn't re-entrant

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        # Load the model now (~45 s the first time) so the first episode doesn't wait for it.
        warm = asyncio.create_task(asyncio.to_thread(asr.transcribe, np.zeros(SAMPLE_RATE, np.float32), None))
        yield
        warm.cancel()
        if client is None:
            await http.aclose()

    app = FastAPI(title="jpsub-server", lifespan=lifespan)
    # Only the extension (chrome-extension://…) calls this, on 127.0.0.1.
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^chrome-extension://[a-p]{32}$",
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {"status": "ok", "model": settings.whisper_model, "llm": settings.ollama_model}

    @app.post("/transcribe", response_model=TranscribeResponse)
    async def transcribe(req: TranscribeRequest) -> TranscribeResponse:
        if req.sample_rate != SAMPLE_RATE:
            raise HTTPException(422, f"sample_rate must be {SAMPLE_RATE}")
        try:
            raw = base64.b64decode(req.audio, validate=True)
        except ValueError as e:
            raise HTTPException(422, "audio must be base64") from e
        if len(raw) % 2:
            raise HTTPException(422, "audio must be 16-bit PCM")
        if len(raw) > MAX_SECONDS * SAMPLE_RATE * 2:
            raise HTTPException(413, f"audio chunks must be at most {MAX_SECONDS}s")
        audio = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
        async with lock:
            out = await graph.ainvoke(
                {"anilist_id": req.anilist_id, "title": req.title, "start": req.start, "audio": audio}
            )
        return TranscribeResponse(cues=[CueOut(**c) for c in out["cues"]])

    return app


app = create_app()
