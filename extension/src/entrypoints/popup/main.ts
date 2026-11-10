// Phase 1: show/episode picker, subtitle file picker, offset controls.
const statusEl = document.querySelector<HTMLParagraphElement>('#status');
if (statusEl) statusEl.textContent = `Version ${browser.runtime.getManifest().version}`;
