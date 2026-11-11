import { activeCues, type Cue } from './cue';

/** Shown before subtitles load: nothing, so pages without Japanese subs look untouched. */
export const READY_TEXT = '';
const BADGE_MS = 1500;
/** Whisper lines below this confidence are styled as unsure. */
const UNSURE_BELOW = 0.5;
const MEDIA_EVENTS = ['timeupdate', 'seeked', 'seeking', 'play', 'pause', 'ratechange', 'loadedmetadata'] as const;

const CSS = `
/* Small, in the strip under the burned-in English subs (which sit just above the bottom edge). */
.wrap { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end;
  align-items: center; padding: 0 4% 1.2%; box-sizing: border-box; }
.subs { text-align: center; white-space: pre-line; color: #fff;
  font: 600 var(--jpsub-size, 16px)/1.25 "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif;
  text-shadow: 0 0 4px #000, 0 0 3px #000, 0 0 2px #000; }
.subs > div + div { margin-top: 0.1em; }
/* Machine-transcribed lines the model wasn't sure about. */
.subs > div.unsure { opacity: 0.7; font-style: italic; }
/* Draft of a line still being spoken. */
.subs > div.partial { opacity: 0.85; }
.badge { position: absolute; top: 8px; right: 8px; padding: 4px 8px; border-radius: 4px;
  font: 600 14px/1 system-ui, sans-serif; color: #fff; background: rgba(0, 0, 0, 0.7); }
.badge[hidden] { display: none; }
`;

/**
 * One overlay per frame, bound to the frame's main video.
 * The host is a manual popover so it lives in the top layer; it is re-shown after
 * fullscreen changes so it stacks above the fullscreen element.
 */
export class Overlay {
  private host: HTMLDivElement | null = null;
  private subsEl: HTMLDivElement | null = null;
  private badgeEl: HTMLDivElement | null = null;
  private video: HTMLVideoElement | null = null;
  private cues: Cue[] | null = null;
  private maxLines: number | undefined;
  private offset = 0;
  private raf = 0;
  private badgeTimer: ReturnType<typeof setTimeout> | undefined;
  private lastRendered: string | null = null;
  private readonly resize = new ResizeObserver(() => this.position());

  constructor() {
    const reposition = () => this.position();
    window.addEventListener('scroll', reposition, { passive: true, capture: true });
    window.addEventListener('resize', reposition);
    for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) {
      document.addEventListener(ev, () => {
        this.raise();
        this.position();
      });
    }
  }

  get attachedVideo(): HTMLVideoElement | null {
    return this.video;
  }

  attach(video: HTMLVideoElement | null): void {
    if (video === this.video) return;
    this.detachVideo();
    this.video = video;
    if (!video) {
      this.host?.remove();
      this.host = this.subsEl = this.badgeEl = null;
      return;
    }
    this.ensureHost();
    for (const ev of MEDIA_EVENTS) video.addEventListener(ev, this.onMedia);
    this.resize.observe(video);
    this.position();
    this.render();
    if (!video.paused) this.loop();
  }

  /** `maxLines`: show only the newest N active lines (live transcription). */
  setCues(cues: Cue[] | null, maxLines?: number): void {
    this.cues = cues;
    this.maxLines = maxLines;
    this.render();
  }

  setOffset(seconds: number, badgeText?: string): void {
    this.offset = seconds;
    this.render();
    if (badgeText && this.badgeEl) {
      const badge = this.badgeEl;
      badge.textContent = badgeText;
      badge.hidden = false;
      clearTimeout(this.badgeTimer);
      this.badgeTimer = setTimeout(() => (badge.hidden = true), BADGE_MS);
    }
  }

  private readonly onMedia = (e: Event) => {
    if (e.type === 'play') this.loop();
    this.render();
  };

  private detachVideo(): void {
    if (!this.video) return;
    for (const ev of MEDIA_EVENTS) this.video.removeEventListener(ev, this.onMedia);
    this.resize.unobserve(this.video);
    cancelAnimationFrame(this.raf);
  }

  /** Renders every frame while playing; timeupdate alone is only ~4 Hz. */
  private loop(): void {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      this.render();
      if (this.video && !this.video.paused) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private ensureHost(): void {
    if (this.host) return;
    const host = document.createElement('div');
    host.setAttribute('data-jpsub-overlay', '');
    host.setAttribute('popover', 'manual');
    Object.assign(host.style, {
      position: 'fixed',
      inset: 'auto',
      margin: '0',
      padding: '0',
      border: '0',
      background: 'transparent',
      overflow: 'visible',
      pointerEvents: 'none',
      zIndex: '2147483647',
    } satisfies Partial<CSSStyleDeclaration>);

    // Built with DOM APIs, not innerHTML, so it works on Trusted Types pages.
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    const subs = document.createElement('div');
    subs.className = 'subs';
    subs.setAttribute('role', 'status');
    subs.setAttribute('aria-label', 'Japanese subtitles');
    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.hidden = true;
    wrap.append(subs);
    root.append(style, wrap, badge);

    document.documentElement.append(host);
    this.host = host;
    this.subsEl = subs;
    this.badgeEl = badge;
    this.lastRendered = null;
    this.raise();
  }

  /** (Re)enters the top layer so the overlay stacks above anything shown before it. */
  private raise(): void {
    const host = this.host;
    if (!host || typeof host.showPopover !== 'function') return;
    try {
      if (host.matches(':popover-open')) host.hidePopover();
      host.showPopover();
    } catch {
      // Not connected or popover unsupported: stays a fixed-position element.
    }
  }

  private position(): void {
    if (!this.host || !this.video) return;
    const r = this.video.getBoundingClientRect();
    Object.assign(this.host.style, {
      top: `${r.top}px`,
      left: `${r.left}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    this.host.style.setProperty('--jpsub-size', `${Math.max(12, Math.round(r.height * 0.032))}px`);
  }

  private render(): void {
    if (!this.subsEl || !this.video) return;
    const active = this.cues ? activeCues(this.cues, this.video.currentTime - this.offset) : [];
    const shown = this.maxLines ? active.slice(-this.maxLines) : active;
    const lines: { text: string; unsure: boolean; partial: boolean }[] = this.cues
      ? shown.map((c) => ({
          text: c.text,
          // Drafts are expected to be rough; only finished lines get the "unsure" style.
          unsure: !c.partial && c.confidence !== undefined && c.confidence < UNSURE_BELOW,
          partial: !!c.partial,
        }))
      : READY_TEXT
        ? [{ text: READY_TEXT, unsure: false, partial: false }]
        : [];
    const key = lines.map((l) => `${l.unsure ? '?' : ''}${l.partial ? '~' : ''}${l.text}`).join('\u0000');
    if (key === this.lastRendered) return;
    this.lastRendered = key;
    this.subsEl.replaceChildren(
      ...lines.map(({ text, unsure, partial }) => {
        const line = document.createElement('div');
        line.textContent = text;
        if (partial) line.className = 'partial';
        if (unsure) {
          line.className = 'unsure';
          line.title = 'Transcribed by Whisper, low confidence';
        }
        return line;
      }),
    );
  }
}
