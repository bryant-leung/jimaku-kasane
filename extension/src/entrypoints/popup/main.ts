import { browser } from 'wxt/browser';
import { parseSubtitleFile } from '@/lib/parse';
import {
  DISABLED_SITES_KEY,
  PREPARE_AHEAD_KEY,
  ENABLED_KEY,
  JIMAKU_KEY,
  autoKey,
  formatOffset,
  offsetKey,
  offsetWrites,
  roundOffset,
  syncKey,
  type AutoStatus,
  type SyncStatus,
  type ExtRequest,
  type LoadResult,
  type SubsState,
} from '@/lib/subs';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const fileInput = $<HTMLInputElement>('#file');
const statusEl = $<HTMLParagraphElement>('#status');
const errorEl = $<HTMLParagraphElement>('#error');
const controls = $<HTMLFieldSetElement>('#offset-controls');
const offsetEl = $<HTMLSpanElement>('#offset');
const autoEl = $<HTMLParagraphElement>('#auto');
const keyInput = $<HTMLInputElement>('#jimaku-key');
const keyStatus = $<HTMLParagraphElement>('#key-status');

$<HTMLParagraphElement>('#version').textContent = `Version ${browser.runtime.getManifest().version}`;

let fileKey: string | null = null;
let current: SubsState | null = null;
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

let stateSeq = 0;
async function showState(state: SubsState | null): Promise<void> {
  const mine = ++stateSeq; // a newer call wins if the awaits below finish out of order
  fileKey = state?.fileKey ?? null;
  current = state;
  controls.disabled = !state;
  statusEl.textContent = state ? `Loaded ${state.fileName} (${state.cues.length} cues)` : 'No subtitles loaded';
  offset = 0;
  if (fileKey) {
    const key = offsetKey(fileKey);
    const stored = await browser.storage.local.get(key);
    if (mine !== stateSeq) return;
    offset = typeof stored[key] === 'number' ? stored[key] : 0;
  }
  showOffset();
}

async function setOffset(next: number): Promise<void> {
  if (!fileKey) return;
  offset = roundOffset(next);
  showOffset();
  await browser.storage.local.set(current ? offsetWrites(current, offset) : { [offsetKey(fileKey)]: offset });
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

const syncEl = $<HTMLParagraphElement>('#sync');
const syncBtn = $<HTMLButtonElement>('#auto-sync');
function showSync(status: SyncStatus | undefined): void {
  syncEl.hidden = !status;
  syncEl.textContent = status?.message ?? '';
  syncBtn.disabled = status?.state === 'listening' && !status.auto;
}

syncBtn.addEventListener('click', async () => {
  const tabId = await targetTabId();
  if (tabId === undefined) return;
  try {
    // Needs the click: Chrome only grants tab audio from a user gesture on the extension.
    const streamId = await browser.tabCapture.getMediaStreamId({ targetTabId: tabId });
    await browser.runtime.sendMessage({ type: 'sync-start', tabId, streamId } satisfies ExtRequest);
  } catch (e) {
    showSync({ state: 'failed', message: `Can't capture this tab's audio: ${e instanceof Error ? e.message : String(e)}` });
  }
});

const recheckBtn = $<HTMLButtonElement>('#recheck');
const stopPrepBtn = $<HTMLButtonElement>('#stop-prep');
stopPrepBtn.addEventListener('click', async () => {
  const tabId = await targetTabId();
  if (tabId !== undefined) await browser.runtime.sendMessage({ type: 'prep-stop', tabId } satisfies ExtRequest);
});
recheckBtn.addEventListener('click', async () => {
  const tabId = await targetTabId();
  if (tabId !== undefined) await browser.runtime.sendMessage({ type: 'retry-auto', tabId } satisfies ExtRequest);
});

function showAuto(status: AutoStatus | undefined): void {
  autoEl.hidden = !status;
  autoEl.textContent = status ? `Auto: ${status.message}` : '';
  // Only an episode lookup that found nothing (or failed) is worth re-checking.
  recheckBtn.hidden = !status || !['not-found', 'error'].includes(status.state) || status.key.startsWith('title|');
  const live = !!status?.message.includes('Transcribing live');
  const preparing = !!status?.message.includes('Preparing ahead');
  $<HTMLParagraphElement>('#live-hint').hidden = !live && !preparing;
  stopPrepBtn.hidden = !preparing;
}

$<HTMLButtonElement>('#save-key').addEventListener('click', async () => {
  const key = keyInput.value.trim();
  if (!key) return;
  await browser.storage.local.set({ [JIMAKU_KEY]: key });
  keyInput.value = '';
  keyStatus.textContent = 'Saved.';
  const tabId = await targetTabId();
  if (tabId !== undefined) await browser.runtime.sendMessage({ type: 'retry-auto', tabId } satisfies ExtRequest);
});

// --- On/off switches ---
const enabledBox = $<HTMLInputElement>('#enabled');
const aheadBox = $<HTMLInputElement>('#prepare-ahead');
void browser.storage.local.get(PREPARE_AHEAD_KEY).then((s) => (aheadBox.checked = s[PREPARE_AHEAD_KEY] !== false));
aheadBox.addEventListener('change', () => void browser.storage.local.set({ [PREPARE_AHEAD_KEY]: aheadBox.checked }));
const siteRow = $<HTMLLabelElement>('#site-row');
const siteOff = $<HTMLInputElement>('#site-off');
enabledBox.addEventListener('change', () => void browser.storage.local.set({ [ENABLED_KEY]: enabledBox.checked }));

async function setupSwitches(tabId: number): Promise<void> {
  const s = await browser.storage.local.get([ENABLED_KEY, DISABLED_SITES_KEY]);
  enabledBox.checked = s[ENABLED_KEY] !== false;
  // The page's own hostname, from its top frame (no tabs permission needed).
  const host = (await browser.tabs.sendMessage(tabId, { type: 'get-host' }, { frameId: 0 }).catch(() => null)) as string | null;
  if (!host) return; // e.g. chrome:// pages
  $<HTMLSpanElement>('#site-name').textContent = host;
  siteOff.checked = ((s[DISABLED_SITES_KEY] as string[] | undefined) ?? []).includes(host);
  siteRow.hidden = false;
  siteOff.addEventListener('change', async () => {
    const list = ((await browser.storage.local.get(DISABLED_SITES_KEY))[DISABLED_SITES_KEY] as string[] | undefined) ?? [];
    const next = siteOff.checked ? [...new Set([...list, host])] : list.filter((h) => h !== host);
    await browser.storage.local.set({ [DISABLED_SITES_KEY]: next });
  });
}

void (async () => {
  const tabId = await targetTabId();
  if (tabId === undefined) return;
  void setupSwitches(tabId);
  // Automatic lookups finish after the popup opens; follow them live.
  // Subscribe before the first read so no change can slip in between.
  // A first read that finishes after a change event would show older data; count events to tell.
  let autoEvents = 0;
  let syncEvents = 0;
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session') return;
    const auto = changes[autoKey(tabId)];
    if (auto) {
      autoEvents++;
      showAuto(auto.newValue as AutoStatus | undefined);
    }
    const sync = changes[syncKey(tabId)];
    if (sync) {
      syncEvents++;
      showSync(sync.newValue as SyncStatus | undefined);
    }
    const subs = changes[`tab:${tabId}`];
    if (subs?.newValue) void showState(subs.newValue as SubsState);
  });
  const state = (await browser.runtime.sendMessage({ type: 'get-subs', tabId } satisfies ExtRequest)) as SubsState | null;
  await showState(state);
  const autoBefore = autoEvents;
  const auto = (await browser.storage.session.get(autoKey(tabId)))[autoKey(tabId)] as AutoStatus | undefined;
  if (autoEvents === autoBefore) showAuto(auto);
  const syncBefore = syncEvents;
  const sync = (await browser.storage.session.get(syncKey(tabId)))[syncKey(tabId)] as SyncStatus | undefined;
  if (syncEvents === syncBefore) showSync(sync);
  if ((await browser.storage.local.get(JIMAKU_KEY))[JIMAKU_KEY]) keyStatus.textContent = 'Key saved. Paste a new one to replace it.';

})();
