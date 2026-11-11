"""Show context from AniList: native title and character names, for the glossary."""

from dataclasses import dataclass, field

import httpx

QUERY = """query($id:Int){Media(id:$id){title{native romaji}
characters(perPage:40,sort:[ROLE,RELEVANCE]){nodes{name{native full}}}}}"""


@dataclass
class ShowContext:
    title: str = ""
    names: list[str] = field(default_factory=list)


async def fetch_context(client: httpx.AsyncClient, url: str, anilist_id: int) -> ShowContext:
    res = await client.post(url, json={"query": QUERY, "variables": {"id": anilist_id}}, timeout=10)
    res.raise_for_status()
    media = (res.json().get("data") or {}).get("Media") or {}
    title = (media.get("title") or {}).get("native") or (media.get("title") or {}).get("romaji") or ""
    names = [
        n["name"]["native"]
        for n in (media.get("characters") or {}).get("nodes", [])
        if n.get("name", {}).get("native")
    ]
    return ShowContext(title=title, names=names)
