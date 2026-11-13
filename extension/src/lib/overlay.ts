import { activeCues, type Cue } from './cue';
import { DEFAULT_SUB_STYLE, type SubStyle } from './subs';
import { isMarked, levelLabel, type Token, type WordMatch } from './dict';

/** Word lookup, provided by the content script (the dictionary lives in the background). */
export interface WordTools {
  segment(text: string): Promise<Token[]>;
  lookup(text: string, start: number): Promise<WordMatch | null>;
  /** Underline words harder than N`markAbove` (0 = off). */
  markAbove: number;
  /** "Save" in the card: the word, its reading and meaning, and the line it's in. */
  saveWord?(word: { word: string; reading?: string; meaning?: string; line: string }): void;
}

/** Shown before subtitles load: nothing, so pages without Japanese subs look untouched. */
export const READY_TEXT = '';
const BADGE_MS = 1500;
/** Whisper lines below this confidence are styled as unsure. */
const UNSURE_BELOW = 0.5;
const MEDIA_EVENTS = ['timeupdate', 'seeked', 'seeking', 'play', 'pause', 'ratechange', 'loadedmetadata'] as const;

const CSS = `
/* Small, in the strip under the burned-in English subs (which sit just above the bottom edge). */
.wrap { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end;
  align-items: center; padding: 0 4% calc(1.2% + var(--jpsub-raise, 0%)); box-sizing: border-box; }
.subs { text-align: center; white-space: pre-line; color: #fff;
  font: 600 var(--jpsub-size, 16px)/1.25 "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif;
  text-shadow: 0 0 4px #000, 0 0 3px #000, 0 0 2px #000; }
.subs > div + div { margin-top: 0.1em; }
/* Listening practice: hidden until revealed (H held, or paused at a line's end in study mode). */
.subs.hide { visibility: hidden; }
/* Optional dark box behind each line (style setting). */
.subs.box > div { display: table; margin-left: auto; margin-right: auto; padding: 0.05em 0.4em; border-radius: 4px;
  background: rgba(0, 0, 0, 0.6); }
/* Machine-transcribed lines the model wasn't sure about. */
.subs > div.unsure { opacity: 0.7; font-style: italic; }
/* Draft of a line still being spoken. */
.subs > div.partial { opacity: 0.85; }
/* Words: clickable for the dictionary; ones likely new to you get a faint dotted underline. */
.w { pointer-events: auto; cursor: pointer; border-radius: 3px; }
.w:hover { background: rgba(255, 255, 255, 0.2); }
.w.mark { text-decoration: underline dotted rgba(255, 255, 255, 0.8); text-decoration-thickness: 1.5px;
  text-underline-offset: 0.2em; }
.card { pointer-events: auto; position: relative; max-width: min(92%, 30em); margin-bottom: 0.6em;
  padding: 0.6em 2.2em 0.6em 0.8em; border-radius: 8px; background: rgba(18, 18, 18, 0.95); color: #fff;
  text-align: left; font: 400 max(13px, calc(var(--jpsub-size, 16px) * 0.9))/1.45 system-ui, "Hiragino Sans", sans-serif;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5); }
.card .head { font-size: 1.25em; font-weight: 700; }
.card .reading { margin-left: 0.5em; font-weight: 400; opacity: 0.85; }
.card .tag { margin-left: 0.6em; padding: 0 0.4em; border-radius: 4px; font-size: 0.75em; vertical-align: middle;
  background: #455a64; }
.card .tag.hard { background: #b26a00; }
.card ol { margin: 0.3em 0 0; padding-left: 1.4em; }
.card .pos { opacity: 0.6; font-size: 0.85em; }
.card .also { margin-top: 0.35em; opacity: 0.8; font-size: 0.9em; }
.card .save { margin-top: 0.4em; padding: 0.15em 0.7em; border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 4px; background: none; color: #fff; font: inherit; font-size: 0.85em; cursor: pointer; }
.card .close { position: absolute; top: 0.3em; right: 0.4em; border: 0; background: none; color: #fff;
  font-size: 1.1em; cursor: pointer; opacity: 0.7; }
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
  private words: WordTools | null = null;
  private readonly segments = new Map<string, Promise<Token[]>>();
  private wrapEl: HTMLDivElement | null = null;
  private card: HTMLDivElement | null = null;
  private pausedByCard = false;
  private studyMode = false;
  private style: SubStyle = DEFAULT_SUB_STYLE;
  private listenMode = false;
  private revealed = false;
  /** Study mode paused at a line's end: show it so you can check what you heard. */
  private revealedByStudy = false;
  /** The line study mode paused after: kept on screen until you play or seek. */
  private held: Cue | null = null;
  /** Video time at the previous render, to notice a line ending during playback. */
  private prevTime: number | null = null;
  private readonly resize = new ResizeObserver(() => this.position());

  constructor() {
    const reposition = () => this.position();
    window.addEventListener('scroll', reposition, { passive: true, capture: true });
    window.addEventListener('resize', reposition);
    // The card closes with Esc or a click anywhere else (clicking another word opens that one).
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.card) this.closeCard(true);
    }, true);
    document.addEventListener('pointerdown', (e) => {
      if (!this.card) return;
      const path = e.composedPath();
      if (path.includes(this.card) || path.some((n) => n instanceof HTMLElement && n.classList.contains('w'))) return;
      this.closeCard(true);
    }, true);
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
      this.host = this.subsEl = this.badgeEl = this.wrapEl = this.card = null;
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

  /** Size, height and background of the line. */
  setStyle(style: SubStyle): void {
    this.style = style;
    this.position();
  }

  /** Listening practice: hide the line until `reveal(true)`. */
  setListenMode(on: boolean): void {
    this.listenMode = on;
    this.applyHidden();
  }

  reveal(on: boolean): void {
    this.revealed = on;
    this.applyHidden();
  }

  private applyHidden(): void {
    this.subsEl?.classList.toggle('hide', this.listenMode && !this.revealed && !this.revealedByStudy);
  }

  /** Study mode: pause when a line ends (real subtitle files only; live lines arrive late). */
  setStudyMode(on: boolean): void {
    this.studyMode = on;
  }

  /** Turns word lookup on (or off with null); re-renders with the new marking. */
  setWords(words: WordTools | null): void {
    this.words = words;
    this.lastRendered = null;
    this.render();
  }

  setOffset(seconds: number, badgeText?: string): void {
    this.offset = seconds;
    this.render();
    if (badgeText) this.flash(badgeText);
  }

  /** A short note in the corner of the video ("Offset +0.5s", "Saved: …"). */
  flash(text: string): void {
    if (!this.badgeEl) return;
    const badge = this.badgeEl;
    badge.textContent = text;
    badge.hidden = false;
    clearTimeout(this.badgeTimer);
    this.badgeTimer = setTimeout(() => (badge.hidden = true), BADGE_MS);
  }

  private readonly onMedia = (e: Event) => {
    if (e.type === 'seeking') this.held = null;
    if (e.type === 'play') {
      if (this.card) this.closeCard(false); // you pressed play: the card's done
      this.held = null;
      if (this.revealedByStudy) {
        this.revealedByStudy = false;
        this.applyHidden();
      }
      this.loop();
    }
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
    this.wrapEl = wrap;
    this.applyHidden();
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
    const size = Math.max(12, Math.round(((r.height * 0.032) * this.style.scale) / 100));
    this.host.style.setProperty('--jpsub-size', `${size}px`);
    // Padding % is of the width; convert the raise (% of height) to px.
    this.host.style.setProperty('--jpsub-raise', `${Math.round((r.height * this.style.raise) / 100)}px`);
    this.subsEl?.classList.toggle('box', this.style.box);
  }

  /** Study mode: a line just ended during normal playback (not a seek) → pause. */
  private checkLineEnd(): void {
    const v = this.video!;
    const t = v.currentTime;
    const prev = this.prevTime;
    this.prevTime = t;
    if (!this.studyMode || !this.cues || this.maxLines || v.paused || prev === null) return;
    if (t <= prev || t - prev > 0.5) return; // seeked or stalled: not "reached the end"
    const ended = this.cues.find((c) => !c.partial && c.end + this.offset > prev && c.end + this.offset <= t);
    if (!ended) return;
    v.pause();
    this.held = ended;
    this.revealedByStudy = true; // listened; now check it
    this.applyHidden();
    this.flash('Study mode: paused after the line. Play to continue, R to hear it again');
  }

  private render(): void {
    if (!this.subsEl || !this.video) return;
    this.checkLineEnd();
    const active = this.cues ? activeCues(this.cues, this.video.currentTime - this.offset) : [];
    if (this.held && !active.includes(this.held)) active.unshift(this.held); // study mode: keep the line to read
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
        if (this.words && !partial) void this.decorate(line, text, key);
        return line;
      }),
    );
  }

  /** Splits a shown line into clickable words once the dictionary answers (if it's still shown). */
  private async decorate(line: HTMLDivElement, text: string, key: string): Promise<void> {
    const words = this.words!;
    if (!this.segments.has(text)) {
      if (this.segments.size > 200) this.segments.clear();
      this.segments.set(text, words.segment(text).catch(() => []));
    }
    const tokens = await this.segments.get(text)!;
    if (this.lastRendered !== key || !line.isConnected || !tokens.length) return;
    const parts: Node[] = [];
    let at = 0;
    for (const t of tokens) {
      if (t.start > at) parts.push(document.createTextNode(text.slice(at, t.start)));
      const span = document.createElement('span');
      span.className = isMarked(t, text, words.markAbove) ? 'w mark' : 'w';
      span.textContent = text.slice(t.start, t.start + t.length);
      span.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void this.openCard(text, t.start);
      });
      parts.push(span);
      at = t.start + t.length;
    }
    if (at < text.length) parts.push(document.createTextNode(text.slice(at)));
    line.replaceChildren(...parts);
  }

  private async openCard(text: string, start: number): Promise<void> {
    const v = this.video;
    if (!this.words || !this.wrapEl || !v) return;
    if (!v.paused) {
      v.pause();
      this.pausedByCard = true;
    }
    const match = await this.words.lookup(text, start);
    if (!this.wrapEl) return;
    this.card?.remove();
    const card = el('div', 'card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Dictionary');
    const close = el('button', 'close', '✕');
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeCard(true);
    });
    card.append(close);
    const first = match?.entries[0];
    if (!match || !first) {
      card.append(el('div', 'head', text.slice(start, start + 1)), el('div', '', 'No dictionary entry.'));
    } else {
      const head = el('div', 'head', first.k[0] ?? first.r[0] ?? match.term);
      if (first.k.length) head.append(el('span', 'reading', first.r[0] ?? ''));
      const label = levelLabel(first);
      const hard = first.l === 1 || label === 'rare';
      head.append(el('span', hard ? 'tag hard' : 'tag', label));
      const senses = el('ol');
      for (const [pos, gloss] of first.s.slice(0, 3)) {
        const li = el('li', '', gloss);
        if (pos) li.append(' ', el('span', 'pos', `(${pos})`));
        senses.append(li);
      }
      card.append(head, senses);
      if (this.words.saveWord) {
        const save = el('button', 'save', 'Save');
        save.setAttribute('aria-label', 'Save word');
        const words = this.words;
        save.addEventListener('click', (e) => {
          e.stopPropagation();
          words.saveWord!({
            word: first.k[0] ?? first.r[0] ?? match.term,
            reading: first.r[0],
            meaning: first.s.slice(0, 2).map(([, g]) => g).join(' / '),
            line: text,
          });
          save.textContent = 'Saved';
          save.disabled = true;
        });
        card.append(save);
      }
      const others = match.entries.slice(1, 3);
      if (others.length) {
        card.append(
          el('div', 'also', `Also: ${others.map((e) => `${e.k[0] ?? e.r[0]}（${e.r[0]}）${e.s[0]?.[1] ?? ''}`).join(' · ')}`),
        );
      }
    }
    this.wrapEl.insertBefore(card, this.subsEl);
    this.card = card;
  }

  /** Closes the card; `resume` plays again if opening it paused the video. */
  private closeCard(resume: boolean): void {
    this.card?.remove();
    this.card = null;
    if (resume && this.pausedByCard && this.video?.paused) void this.video.play().catch(() => {});
    this.pausedByCard = false;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
