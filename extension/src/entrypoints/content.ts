const OVERLAY_ATTR = 'data-jpsub-overlay';

/** Positions an overlay box over a video and keeps it aligned. */
function mountOverlay(video: HTMLVideoElement): void {
  if (video.hasAttribute('data-jpsub-attached')) return;
  video.setAttribute('data-jpsub-attached', '');

  const overlay = document.createElement('div');
  overlay.setAttribute(OVERLAY_ATTR, '');
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-label', 'Japanese subtitles');
  Object.assign(overlay.style, {
    position: 'fixed',
    zIndex: '2147483647',
    pointerEvents: 'none',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    font: '600 24px/1.3 "Hiragino Sans", "Noto Sans JP", sans-serif',
    color: '#fff',
    textShadow: '0 0 4px #000, 0 0 2px #000',
  } satisfies Partial<CSSStyleDeclaration>);
  overlay.textContent = 'JP Sub ready';
  document.documentElement.append(overlay);

  const sync = () => {
    const r = video.getBoundingClientRect();
    Object.assign(overlay.style, {
      top: `${r.top + r.height * 0.05}px`,
      left: `${r.left}px`,
      width: `${r.width}px`,
      height: `${r.height * 0.9}px`,
    });
  };
  sync();
  new ResizeObserver(sync).observe(video);
  window.addEventListener('scroll', sync, { passive: true });
  window.addEventListener('resize', sync);
}

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    const scan = () => document.querySelectorAll('video').forEach(mountOverlay);
    scan();
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  },
});
