"""LangGraph pipeline: fetch_context → build_glossary → transcribe → correct → score.

The graph is built from injected services so tests can swap in fakes for the model, AniList
and the LLM. Each node returns only the keys it adds to the state.
"""

import asyncio
import math
from collections.abc import Awaitable, Callable
from typing import Any, TypedDict

import numpy as np
import numpy.typing as npt
from langgraph.graph import END, START, StateGraph

from app.anilist import ShowContext
from app.asr import Segment, Transcriber
from app.llm import Corrector

# Phrases Whisper invents on silence or music (Japanese YouTube outros etc.).
HALLUCINATIONS = ("ご視聴ありがとうございました", "チャンネル登録", "最後までご視聴", "字幕")


class Cue(TypedDict):
    start: float
    end: float
    text: str
    raw: str
    confidence: float


class State(TypedDict, total=False):
    anilist_id: int | None
    title: str
    start: float  # video time where the audio chunk begins
    partial: bool  # draft of a line still being spoken: skip the slow correction step
    audio: npt.NDArray[np.float32]
    context: ShowContext
    glossary: list[str]
    segments: list[Segment]
    corrected: list[str]
    cues: list[Cue]
    trace: list[str]  # node order, for tests and debugging


def _trace(state: State, node: str) -> list[str]:
    return [*state.get("trace", []), node]


def build_graph(
    transcriber: Transcriber,
    corrector: Corrector,
    get_context: Callable[[int], Awaitable[ShowContext]],
) -> Any:
    async def fetch_context(state: State) -> State:
        aid = state.get("anilist_id")
        try:
            ctx = await get_context(aid) if aid else ShowContext(title=state.get("title", ""))
        except Exception:  # AniList down: carry on without names
            ctx = ShowContext(title=state.get("title", ""))
        return {"context": ctx, "trace": _trace(state, "fetch_context")}

    def build_glossary(state: State) -> State:
        ctx = state["context"]
        seen: dict[str, None] = {}
        for term in [ctx.title, *ctx.names]:
            if term:
                seen[term] = None
        return {"glossary": list(seen)[:40], "trace": _trace(state, "build_glossary")}

    async def transcribe(state: State) -> State:
        # The glossary as Whisper's prompt nudges it towards the right kanji for names.
        prompt = "、".join(state["glossary"]) or None
        # Off the event loop: the model call blocks for ~1–2 s per chunk.
        found = await asyncio.to_thread(transcriber.transcribe, state["audio"], prompt)
        segments = [
            s
            for s in found
            if s.text and not any(h in s.text for h in HALLUCINATIONS) and s.no_speech_prob < 0.8
        ]
        return {"segments": segments, "trace": _trace(state, "transcribe")}

    async def correct(state: State) -> State:
        lines = [s.text for s in state["segments"]]
        # Drafts are replaced a second later; correcting them would only add delay.
        fixed = (
            await corrector.correct(lines, state["glossary"]) if lines and not state.get("partial") else None
        )
        return {"corrected": fixed or lines, "trace": _trace(state, "correct")}

    def score(state: State) -> State:
        offset = state["start"]
        cues: list[Cue] = []
        for seg, text in zip(state["segments"], state["corrected"], strict=True):
            confidence = max(0.0, min(1.0, math.exp(seg.avg_logprob) * (1 - seg.no_speech_prob)))
            cues.append(
                {
                    "start": round(offset + seg.start, 3),
                    "end": round(offset + seg.end, 3),
                    "text": text,
                    "raw": seg.text,
                    "confidence": round(confidence, 3),
                }
            )
        return {"cues": cues, "trace": _trace(state, "score")}

    g = StateGraph(State)
    for name, fn in [
        ("fetch_context", fetch_context),
        ("build_glossary", build_glossary),
        ("transcribe", transcribe),
        ("correct", correct),
        ("score", score),
    ]:
        g.add_node(name, fn)
    g.add_edge(START, "fetch_context")
    g.add_edge("fetch_context", "build_glossary")
    g.add_edge("build_glossary", "transcribe")
    g.add_edge("transcribe", "correct")
    g.add_edge("correct", "score")
    g.add_edge("score", END)
    return g.compile()
