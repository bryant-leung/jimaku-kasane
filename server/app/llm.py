"""Ollama client for the correction step. Any failure means "no correction", never an error."""

import json
from typing import Protocol

import httpx


class Corrector(Protocol):
    async def correct(self, lines: list[str], glossary: list[str]) -> list[str] | None: ...


PROMPT = """You fix speech-recognition errors in Japanese anime subtitles.
Glossary (correct spellings of names and terms in this show): {glossary}
Lines: {lines}
Only fix words that are clearly misheard versions of glossary entries. Change nothing else.
Reply with JSON: {{"lines": [...]}} with exactly {n} strings, in order."""


class OllamaCorrector:
    def __init__(self, client: httpx.AsyncClient, base_url: str, model: str, timeout_s: float) -> None:
        self.client, self.base_url, self.model, self.timeout_s = client, base_url, model, timeout_s

    async def correct(self, lines: list[str], glossary: list[str]) -> list[str] | None:
        if not lines or not glossary:
            return None
        prompt = PROMPT.format(
            glossary="、".join(glossary), lines=json.dumps(lines, ensure_ascii=False), n=len(lines)
        )
        try:
            res = await self.client.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": self.model,
                    "messages": [{"role": "user", "content": prompt}],
                    "format": "json",
                    "stream": False,
                    "options": {"temperature": 0},
                },
                timeout=self.timeout_s,
            )
            res.raise_for_status()
            fixed = json.loads(res.json()["message"]["content"]).get("lines")
        except (httpx.HTTPError, KeyError, ValueError, TypeError):
            return None  # Ollama not running, model missing, or bad output: keep Whisper's text
        if (
            not isinstance(fixed, list)
            or len(fixed) != len(lines)
            or not all(isinstance(x, str) for x in fixed)
        ):
            return None
        return [str(x) for x in fixed]
