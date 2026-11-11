"""Speech recognition. `Transcriber` is a seam so the pipeline is testable without the model."""

from dataclasses import dataclass
from typing import Protocol

import numpy as np
import numpy.typing as npt


@dataclass(frozen=True)
class Segment:
    start: float  # seconds from the start of the audio chunk
    end: float
    text: str
    avg_logprob: float
    no_speech_prob: float


class Transcriber(Protocol):
    def transcribe(self, audio: npt.NDArray[np.float32], prompt: str | None) -> list[Segment]: ...


class MlxWhisper:
    """Whisper on Apple Silicon via MLX. The model downloads on first use (~1.6 GB)."""

    def __init__(self, model: str) -> None:
        self.model = model

    def transcribe(self, audio: npt.NDArray[np.float32], prompt: str | None) -> list[Segment]:
        import mlx_whisper  # imported lazily: heavy, and macOS/arm64 only

        result = mlx_whisper.transcribe(
            audio,
            path_or_hf_repo=self.model,
            language="ja",
            initial_prompt=prompt,
            condition_on_previous_text=False,  # chunks are independent; avoids repeated lines
            # One greedy pass: retries at higher temperatures made a 12 s chunk take 9.6 s instead
            # of 1.4 s (M3 Pro). Live subtitles need speed more than a second opinion.
            temperature=(0.0,),
        )
        return [
            Segment(
                start=float(s["start"]),
                end=float(s["end"]),
                text=str(s["text"]).strip(),
                avg_logprob=float(s.get("avg_logprob", -1.0)),
                no_speech_prob=float(s.get("no_speech_prob", 0.0)),
            )
            for s in result.get("segments", [])
        ]
