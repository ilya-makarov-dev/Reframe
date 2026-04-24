/**
 * Zoom / pan controller for the DOM canvas.
 *
 * The iframe wrapper carries a `transform: translate(px, py) scale(z)`.
 * Mouse wheel → zoom-at-pointer. Space+drag → pan. Ctrl/Cmd+0 → fit.
 * Ctrl/Cmd+1 → 100%. Zoom levels snap to {25, 50, 75, 100, 150, 200, 300, 400} %
 * to avoid sub-pixel text blur from arbitrary scale factors in Chrome.
 *
 * Keeps the WRAPPER transform-origin at top-left so math stays simple
 * (pre→post-transform coords: `post = pan + pre * zoom`).
 */

export const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export interface ZoomPanState {
  zoom: number;
  panX: number;
  panY: number;
}

export function createZoomPan(opts: {
  wrapper: HTMLElement;
  viewport: HTMLElement;
  onChange?: (state: ZoomPanState) => void;
  /**
   * Multi-mount gate for window-global Space key and Ctrl+0/1/+/- shortcuts.
   * When N canvases are mounted, each attaches its own keydown/keyup
   * listeners; without this predicate every Space press would toggle pan
   * mode on every canvas. The predicate returns true for the focused
   * instance only. If omitted, defaults to "always focused" — single-mount
   * backward compat.
   */
  isFocused?: () => boolean;
}): {
  state: ZoomPanState;
  setZoom: (z: number, anchorX?: number, anchorY?: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomToFit: (sceneWidth: number, sceneHeight: number) => void;
  zoomTo100: () => void;
  destroy: () => void;
} {
  const state: ZoomPanState = { zoom: 1, panX: 0, panY: 0 };
  const apply = () => {
    opts.wrapper.style.transformOrigin = '0 0';
    opts.wrapper.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    opts.onChange?.(state);
  };
  const setZoom = (z: number, anchorX?: number, anchorY?: number) => {
    // Snap to nearest level. When anchor is provided, zoom-at-point:
    // keep the (ax, ay) viewport-local coord stable under the transform.
    const clamped = Math.min(ZOOM_LEVELS[ZOOM_LEVELS.length - 1], Math.max(ZOOM_LEVELS[0], z));
    const vpRect = opts.viewport.getBoundingClientRect();
    const ax = anchorX ?? vpRect.width / 2;
    const ay = anchorY ?? vpRect.height / 2;
    // Scene-space coord under anchor BEFORE zoom change.
    const sceneX = (ax - state.panX) / state.zoom;
    const sceneY = (ay - state.panY) / state.zoom;
    state.zoom = clamped;
    // Re-solve pan so (sceneX, sceneY) stays under the anchor.
    state.panX = ax - sceneX * state.zoom;
    state.panY = ay - sceneY * state.zoom;
    apply();
  };
  const nearestLevel = (delta: number) => {
    const idx = ZOOM_LEVELS.findIndex(l => Math.abs(l - state.zoom) < 0.001);
    const next = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, idx + delta));
    return ZOOM_LEVELS[next];
  };

  const focused = (): boolean => opts.isFocused?.() ?? true;

  // Ctrl/Cmd+wheel → zoom at pointer. Plain wheel → pan. Wheel is
  // viewport-scoped so pointer position naturally resolves which canvas
  // receives it — no focus gate needed.
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const step = e.deltaY > 0 ? -1 : 1;
      setZoom(nearestLevel(step), e.clientX - opts.viewport.getBoundingClientRect().left, e.clientY - opts.viewport.getBoundingClientRect().top);
    } else {
      e.preventDefault();
      state.panX -= e.deltaX;
      state.panY -= e.deltaY;
      apply();
    }
  };

  // Space+drag pan (common in design tools).
  let spaceHeld = false;
  let dragStart: { x: number; y: number; panX: number; panY: number } | null = null;
  const onKey = (e: KeyboardEvent) => {
    // Window-global listener; fire only for the focused canvas in
    // multi-mount. Without this, holding Space toggles pan mode across
    // every mounted canvas at once.
    if (!focused()) return;
    if (e.code === 'Space' && !e.repeat) spaceHeld = e.type === 'keydown';
    if (e.type === 'keydown' && (e.ctrlKey || e.metaKey)) {
      if (e.key === '0') { e.preventDefault(); /* fit — caller supplies dims via zoomToFit */ }
      if (e.key === '1') { e.preventDefault(); setZoom(1); }
      if (e.key === '=' || e.key === '+') { e.preventDefault(); setZoom(nearestLevel(1)); }
      if (e.key === '-') { e.preventDefault(); setZoom(nearestLevel(-1)); }
    }
  };
  const onMouseDown = (e: MouseEvent) => {
    // mousedown is viewport-scoped — already routes to the right canvas.
    // But spaceHeld only flips for focused canvas, so unfocused canvases
    // naturally don't enter pan drag even though their listener fires.
    if (!spaceHeld) return;
    dragStart = { x: e.clientX, y: e.clientY, panX: state.panX, panY: state.panY };
    opts.viewport.style.cursor = 'grabbing';
  };
  const onMouseMove = (e: MouseEvent) => {
    if (!dragStart) return;
    state.panX = dragStart.panX + (e.clientX - dragStart.x);
    state.panY = dragStart.panY + (e.clientY - dragStart.y);
    apply();
  };
  const onMouseUp = () => {
    dragStart = null;
    opts.viewport.style.cursor = spaceHeld ? 'grab' : '';
  };

  opts.viewport.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  opts.viewport.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  apply();

  return {
    state,
    setZoom,
    zoomIn: () => setZoom(nearestLevel(1)),
    zoomOut: () => setZoom(nearestLevel(-1)),
    zoomToFit: (sceneW: number, sceneH: number) => {
      const vp = opts.viewport.getBoundingClientRect();
      const padding = 40;
      const zFit = Math.min(
        (vp.width - padding * 2) / sceneW,
        (vp.height - padding * 2) / sceneH,
      );
      const snapped = ZOOM_LEVELS.reduce((best, l) =>
        Math.abs(l - zFit) < Math.abs(best - zFit) ? l : best, ZOOM_LEVELS[0]);
      state.zoom = snapped;
      state.panX = (vp.width - sceneW * snapped) / 2;
      state.panY = (vp.height - sceneH * snapped) / 2;
      apply();
    },
    zoomTo100: () => setZoom(1),
    destroy: () => {
      opts.viewport.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      opts.viewport.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    },
  };
}
