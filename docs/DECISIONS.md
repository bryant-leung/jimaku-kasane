# Decision log

Lightweight ADRs. Newest at the bottom. Format: context → decision → consequences.

## 001 — Source Japanese, don't back-translate English
- **Context:** Translating English subs into Japanese yields unnatural Japanese that differs from the actual dialogue.
- **Decision:** Use real Japanese sources only: existing subs (Jimaku) first, ASR on the Japanese audio as fallback.
- **Consequences:** Needs subtitle sync handling and an ASR pipeline; output reflects what is actually said.

## 002 — Rely on `video.currentTime`, not the page's subtitle track
- **Context:** Target sites hardsub English; there is no track to read.
- **Decision:** Overlay is driven purely by playback time + user offset.
- **Consequences:** Site-agnostic; sync drift must be handled explicitly.

## 003 — LLM work lives in a local Python service
- **Context:** Whisper and LangGraph are Python-first; API keys shouldn't sit in the extension.
- **Decision:** Extension stays TypeScript; FastAPI server on localhost owns ASR + LangGraph + keys.
- **Consequences:** Phase 1–2 work without the server; phase 3 requires running it.

## 004 — Whisper and LLM for the fallback (resolved 2026-11-11)
- **Context:** Needs to run on an M3 Pro, live, at no ongoing cost.
- **Decision:** Whisper large-v3-turbo via MLX, one greedy pass (1.4 s per 12 s chunk; with temperature fallback 9.6 s). Correction via Ollama `qwen2.5:7b`, skipped when Ollama isn't running.
- **Consequences:** Free and local; Apple Silicon only; Japanese name correction is weaker than a hosted model would be.

## 005 — Targets: Chrome (primary) + Safari
- **Context:** Daily testing on Chrome; Safari wanted too. Both run WebExtensions (Manifest V3).
- **Decision:** One shared TypeScript codebase built with WXT, output for Chrome and Safari. Safari build is wrapped in a macOS app via `xcrun safari-web-extension-converter` (requires Xcode).
- **Consequences:**
  - Safari has no `tabCapture`/`offscreen` → phase 3 audio capture is Chrome-only unless in-page Web Audio capture works (untested).
  - Safari native video fullscreen hides overlays; must fullscreen the player container instead.
  - Personal use only (no store publishing). Local Safari dev needs Develop → "Allow Unsigned Extensions" (resets each launch).
