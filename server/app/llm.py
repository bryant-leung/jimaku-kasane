"""Ollama client for the correction step. Any failure means "no correction", never an error."""

import json
from typing import Protocol

import httpx


class Corrector(Protocol):
    async def correct(self, lines: list[str], glossary: list[str]) -> list[str] | None: ...


PROMPT = """You fix speech-recognition errors in Japanese anime subtitles.
Glossary (correct spellings of names and terms in this show): {glossary}
Lines (numbered): {lines}
Find words that are misheard or kana spellings of glossary entries (e.g. a name written in hiragana).
Reply with JSON: {{"fixes": [{{"line": <n>, "from": "<exact text in that line>",
"to": "<glossary spelling>"}}]}}.
Use [] when nothing needs fixing. Never rewrite other words."""

MAX_FROM_CHARS = 12
# Endings a model tends to swallow into a name ("あさのたいようです" -> "朝野太陽"); kept after the name.
KEEP_SUFFIXES = ("兄さん", "姉さん", "さん", "くん", "ちゃん", "様", "です", "だ")


def allowed_spellings(glossary: list[str]) -> set[str]:
    """Glossary entries plus their parts (a given name alone, e.g. 凶一郎 from 夜桜凶一郎)."""
    out: set[str] = set()
    for term in glossary:
        out.add(term)
        for i in range(len(term)):
            for j in range(i + 2, len(term) + 1):
                out.add(term[i:j])
    return out


def apply_fixes(lines: list[str], fixes: object, glossary: list[str]) -> list[str]:
    """Applies only replacements whose new text comes from the glossary and whose old text is in
    the line: the model can fix a name but can never drop, add or reword anything else."""
    allowed = allowed_spellings(glossary)
    out = list(lines)
    if not isinstance(fixes, list):
        return out
    for fix in fixes:
        if not isinstance(fix, dict):
            continue
        i, old, new = fix.get("line"), fix.get("from"), fix.get("to")
        if not (isinstance(i, int) and 0 <= i < len(out) and isinstance(old, str) and isinstance(new, str)):
            continue
        if not old or old == new or len(old) > MAX_FROM_CHARS or new not in allowed or old not in out[i]:
            continue
        for suffix in KEEP_SUFFIXES:
            if old.endswith(suffix) and not new.endswith(suffix):
                new += suffix
                break
        out[i] = out[i].replace(old, new, 1)
    return out


class OllamaCorrector:
    def __init__(self, client: httpx.AsyncClient, base_url: str, model: str, timeout_s: float) -> None:
        self.client, self.base_url, self.model, self.timeout_s = client, base_url, model, timeout_s

    async def correct(self, lines: list[str], glossary: list[str]) -> list[str] | None:
        if not lines or not glossary:
            return None
        numbered = json.dumps({i: line for i, line in enumerate(lines)}, ensure_ascii=False)
        prompt = PROMPT.format(glossary="、".join(glossary), lines=numbered)
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
            fixes = json.loads(res.json()["message"]["content"]).get("fixes")
        except (httpx.HTTPError, KeyError, ValueError, TypeError, AttributeError):
            return None  # Ollama not running, model missing, or bad output: keep Whisper's text
        return apply_fixes(lines, fixes, glossary)
