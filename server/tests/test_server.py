"""Server tests: fakes for Whisper, AniList (httpx MockTransport) and Ollama. IDs: docs/TEST_PLAN.md."""

import asyncio
import base64
import json

import httpx
import numpy as np
import numpy.typing as npt
import pytest
from fastapi.testclient import TestClient

from app.asr import Segment
from app.llm import OllamaCorrector, apply_fixes
from app.main import create_app


class FakeWhisper:
    def __init__(self, segments: list[Segment]) -> None:
        self.segments = segments
        self.prompts: list[str | None] = []

    def transcribe(self, audio: npt.NDArray[np.float32], prompt: str | None) -> list[Segment]:
        self.prompts.append(prompt)
        return self.segments


class FakeCorrector:
    def __init__(self, fixed: list[str] | None) -> None:
        self.fixed = fixed

    async def correct(self, lines: list[str], glossary: list[str]) -> list[str] | None:
        return self.fixed


def anilist(handler_ok: bool = True) -> httpx.AsyncClient:
    def handle(req: httpx.Request) -> httpx.Response:
        if not handler_ok:
            return httpx.Response(500)
        return httpx.Response(
            200,
            json={
                "data": {
                    "Media": {
                        "title": {"native": "夜桜さんちの大作戦", "romaji": "Yozakura-san"},
                        "characters": {
                            "nodes": [{"name": {"native": "朝野太陽"}}, {"name": {"native": "夜桜六美"}}]
                        },
                    }
                }
            },
        )

    return httpx.AsyncClient(transport=httpx.MockTransport(handle))


SEGS = [
    Segment(0.5, 2.0, "あさのたいようです", -0.1, 0.01),
    Segment(3.0, 4.5, "ご視聴ありがとうございました", -0.2, 0.0),  # hallucination
    Segment(5.0, 6.0, "よろしく", -1.2, 0.3),
]


def pcm(seconds: float) -> str:
    return base64.b64encode(np.zeros(int(16000 * seconds), dtype="<i2").tobytes()).decode()


def client_for(whisper: FakeWhisper, fixed: list[str] | None, ok: bool = True) -> TestClient:
    return TestClient(create_app(transcriber=whisper, corrector=FakeCorrector(fixed), client=anilist(ok)))


# P3-01
def test_health() -> None:
    res = client_for(FakeWhisper([]), None).get("/health")
    assert res.status_code == 200 and res.json()["status"] == "ok"


# P3-02
@pytest.mark.parametrize(
    ("body", "status"),
    [
        ({"start": 0, "audio": "not base64!"}, 422),
        ({"start": 0, "audio": base64.b64encode(b"\x00\x00\x00").decode()}, 422),  # odd byte count
        ({"start": 0, "audio": pcm(31)}, 413),
        ({"start": 0, "audio": pcm(1), "sample_rate": 44100}, 422),
        ({"start": -1, "audio": pcm(1)}, 422),
    ],
)
def test_rejects_bad_audio(body: dict[str, object], status: int) -> None:
    assert client_for(FakeWhisper([]), None).post("/transcribe", json=body).status_code == status


# P3-03, P3-04, P3-05, P3-06, P3-07
def test_pipeline_glossary_correction_and_timing() -> None:
    whisper = FakeWhisper(SEGS)
    res = client_for(whisper, ["朝野太陽です", "よろしく"]).post(
        "/transcribe", json={"anilist_id": 158898, "start": 100.0, "audio": pcm(8)}
    )
    assert res.status_code == 200
    cues = res.json()["cues"]
    # hallucination dropped; times shifted to video time; correction applied, raw kept
    assert [c["text"] for c in cues] == ["朝野太陽です", "よろしく"]
    assert cues[0]["raw"] == "あさのたいようです"
    assert (cues[0]["start"], cues[0]["end"]) == (100.5, 102.0)
    # AniList names reached Whisper as its prompt
    assert whisper.prompts == ["夜桜さんちの大作戦、朝野太陽、夜桜六美"]
    # confidence in [0, 1], lower for the shaky line
    assert 0 <= cues[1]["confidence"] < cues[0]["confidence"] <= 1


# P3-10
def test_partial_drafts_skip_correction() -> None:
    res = client_for(FakeWhisper(SEGS), ["朝野太陽です", "よろしく"]).post(
        "/transcribe", json={"anilist_id": 1, "start": 0, "audio": pcm(4), "partial": True}
    )
    assert [c["text"] for c in res.json()["cues"]] == ["あさのたいようです", "よろしく"]


# P3-08
def test_no_llm_or_anilist_still_returns_raw_lines() -> None:
    res = client_for(FakeWhisper(SEGS), None, ok=False).post(
        "/transcribe", json={"anilist_id": 1, "start": 0, "audio": pcm(8)}
    )
    assert [c["text"] for c in res.json()["cues"]] == ["あさのたいようです", "よろしく"]


# P3-09
def test_ollama_corrector_success_and_failures() -> None:
    def ok(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        assert body["format"] == "json" and "朝野太陽" in body["messages"][0]["content"]
        fixes = [{"line": 0, "from": "あさのたいよう", "to": "朝野太陽"}]
        return httpx.Response(200, json={"message": {"content": json.dumps({"fixes": fixes})}})

    def garbage(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"message": {"content": "not json"}})

    def down(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    async def run(handler: object) -> list[str] | None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:  # type: ignore[arg-type]
            corrector = OllamaCorrector(c, "http://ollama", "m", 1)
            return await corrector.correct(["あさのたいようです"], ["朝野太陽"])

    assert asyncio.run(run(ok)) == ["朝野太陽です"]  # です kept: only the name is replaced
    assert asyncio.run(run(garbage)) is None
    assert asyncio.run(run(down)) is None


# P3-11
def test_fixes_cannot_reword_lines() -> None:
    glossary = ["夜桜凶一郎", "朝野太陽"]
    lines = ["あさのたいようです、よろしく", "きょういちろう兄さんが来るぞ", "今日はいい天気だね"]
    fixes = [
        {"line": 0, "from": "あさのたいようです", "to": "朝野太陽"},  # would drop です
        {"line": 1, "from": "きょういちろう", "to": "凶一郎"},  # given name alone: allowed
        {"line": 2, "from": "今日は", "to": "明日は"},  # not a glossary spelling: rejected
        {"line": 2, "from": "存在しない", "to": "朝野太陽"},  # text not in the line: rejected
        {"line": 9, "from": "a", "to": "朝野太陽"},  # no such line: rejected
        "nonsense",
    ]
    out = apply_fixes(lines, fixes, glossary)
    assert out[1] == "凶一郎兄さんが来るぞ"
    assert out[2] == "今日はいい天気だね"
    # The model swallowed です into the name: it's put back, so nothing but the name changes.
    assert out[0] == "朝野太陽です、よろしく"


# P3-12
def test_drops_whisper_repetition_loops() -> None:
    loop = "私を教えていたら、" * 12
    segs = [Segment(0, 4, loop, -0.3, 0.0), Segment(4, 5, "よろしく", -0.2, 0.0)]
    res = client_for(FakeWhisper(segs), None).post("/transcribe", json={"start": 0, "audio": pcm(5)})
    assert [c["text"] for c in res.json()["cues"]] == ["よろしく"]
