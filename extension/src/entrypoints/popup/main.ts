import { browser } from 'wxt/browser';
import { parseSubtitleFile } from '@/lib/parse';
import { formatOffset, offsetKey, roundOffset, type ExtRequest, type LoadResult, type SubsState } from '@/lib/subs';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const fileInput = $<HTMLInputElement>('#file');
const statusEl = $<HTMLParagraphElement>('#status');
const errorEl = $<HTMLParagraphElement>('#error');
const controls = $<HTMLFieldSetElement>('#offset-controls');
const offsetEl = $<HTMLSpanElement>('#offset');

$<HTMLParagraphElement>('#version').textContent = `Version ${browser.runtime.getManifest().version}`;

let fileKey: string | null = null;
let offset = 0;

/** Tab to control: `?tabId=` (tests, or a popup opened as a page), else the active tab. */
async function targetTabId(): Promise<number | undefined> {
  const param = new URLSearchParams(location.search).get('tabId');
  if (param) return Number(param);
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function showError(message: string | null): void {
  errorEl.textContent = message ?? '';
  errorEl.hidden = !message;
}

const showOffset = () => (offsetEl.textContent = formatOffset(offset));

async function showState(state: SubsState | null): Promise<void> {
  fileKey = state?.fileKey ?? null;
  controls.disabled = !state;
  statusEl.textContent = state ? `Loaded ${state.fileName} (${state.cues.length} cues)` : 'No subtitles loaded';
  offset = 0;
  if (fileKey) {
    const key = offsetKey(fileKey);
    const stored = await browser.storage.local.get(key);
    offset = typeof stored[key] === 'number' ? stored[key] : 0;
  }
  showOffset();
}

async function setOffset(next: number): Promise<void> {
  if (!fileKey) return;
  offset = roundOffset(next);
  showOffset();
  await browser.storage.local.set({ [offsetKey(fileKey)]: offset });
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = ''; // picking the same file again still fires change
  if (!file) return;
  showError(null);

  const parsed = parseSubtitleFile(file.name, new Uint8Array(await file.arrayBuffer()));
  if (!parsed.ok) return showError(parsed.error);

  const tabId = await targetTabId();
  if (tabId === undefined) return showError('No active tab to show subtitles on.');

  const res = (await browser.runtime.sendMessage({
    type: 'load-subs',
    tabId,
    fileName: file.name,
    cues: parsed.cues,
  } satisfies ExtRequest)) as LoadResult;
  if (!res.ok) return showError(res.error);

  await showState({ fileName: file.name, fileKey: res.fileKey, cues: parsed.cues });
  if (parsed.issues.length) {
    const n = parsed.issues.length;
    const detail = parsed.issues
      .slice(0, 3)
      .map((i) => `line ${i.line}: ${i.message}`)
      .join('; ');
    showError(`Skipped ${n} invalid ${n === 1 ? 'cue' : 'cues'} (${detail}${n > 3 ? '; …' : ''})`);
  }
});

for (const btn of document.querySelectorAll<HTMLButtonElement>('button[data-delta]')) {
  btn.addEventListener('click', () => void setOffset(offset + Number(btn.dataset.delta)));
}
$<HTMLButtonElement>('#reset').addEventListener('click', () => void setOffset(0));

// Hotkeys on the page change the offset too; keep the popup in step.
browser.storage.onChanged.addListener((changes, area) => {
  const change = fileKey && area === 'local' ? changes[offsetKey(fileKey)] : undefined;
  if (!change) return;
  offset = typeof change.newValue === 'number' ? change.newValue : 0;
  showOffset();
});

void (async () => {
  const tabId = await targetTabId();
  if (tabId === undefined) return;
  const state = (await browser.runtime.sendMessage({ type: 'get-subs', tabId } satisfies ExtRequest)) as SubsState | null;
  await showState(state);
})();
