/**
 * Phase 3 — Present mode for the DOM canvas.
 *
 * "Present mode" = the cinematic view of a reframe scene. Edit mode
 * (Phase 2) shows the iframe 1:1 with selection handles on top — that's
 * for design work. Present mode strips chrome, applies a configurable
 * camera (CSS 3D perspective transforms) + filter stack (blur / grain /
 * vignette / chromatic aberration), and enables transitions between
 * scenes. Meant for showing clients, shipping video (feeds into
 * hyperframes export), and "wow" demos.
 *
 * Three layers of effect:
 *   1. Camera — CSS `perspective(Npx) rotateX rotateY scale translate3d`
 *      on the iframe wrapper. Works in every browser today, GPU-composited.
 *   2. Filter stack — CSS `filter: grayscale() blur() contrast()` +
 *      `backdrop-filter` for surrounding chrome. Also today, GPU.
 *   3. WebGL upgrade (see `webgl-present.ts`) — when Chromium's
 *      `gl.texElementImage2D` ships stable, the camera matrix + filter
 *      pipeline moves into a textured WebGL quad with real shaders
 *      (light scattering, DOF, chromatic, etc.). Same API from the
 *      caller's side; detection picks the backend automatically.
 *
 * Public API: `createPresentMode({ iframe, viewport })` returns a
 * controller. Call `enter()` / `exit()` / `setCamera(preset)` /
 * `setFilter(preset)`. Escape exits. Ctrl+P toggles. Arrow keys rotate
 * camera. ± zoom. Space cycles filter presets.
 */

export type CameraPreset =
  | 'front'           // static, no transform — 1:1 flat view, CTA polish
  | 'tilt'            // slight perspective tilt, showcase mode
  | 'fly-through'     // orbiting camera, auto-rotates
  | 'isometric'       // 30° X + 45° Y, figma/sketch-style 3D view
  | 'parallax';       // follows mouse for desktop live-feel

export type FilterPreset =
  | 'none'
  | 'cinema'          // slight contrast + warm tint + subtle blur at edges (vignette)
  | 'noir'            // grayscale + high contrast
  | 'dream'           // soft blur + hue-rotate
  | 'neon'            // saturation boost + brightness
  | 'crt';            // scanlines via backdrop; chromatic via drop-shadow

export interface PresentModeOptions {
  /** The Phase 2 iframe element rendering the scene. */
  iframe: HTMLIFrameElement;
  /** Host viewport (`.rfd-canvas-viewport` by convention). */
  viewport: HTMLElement;
  /** Called on enter/exit so the host can hide/show editor chrome. */
  onModeChange?: (active: boolean) => void;
  /**
   * Multi-mount gate for the window-global parallax mousemove listener
   * and keydown controls (arrows / 1-5 / 0 / Space). Without it, moving
   * the mouse over any part of the page would animate every mounted
   * canvas's camera, and a single arrow press would rotate all of them.
   * If omitted, defaults to always-focused (single-mount backward compat).
   */
  isFocused?: () => boolean;
}

export interface PresentModeController {
  enter: (camera?: CameraPreset, filter?: FilterPreset) => void;
  exit: () => void;
  toggle: () => void;
  setCamera: (preset: CameraPreset) => void;
  setFilter: (preset: FilterPreset) => void;
  /** Orbit camera (fly-through) — use from a mouse move listener or animation loop. */
  orbit: (dx: number, dy: number) => void;
  /** Current active state. */
  isActive: () => boolean;
  destroy: () => void;
}

// ─── Camera definitions ────────────────────────────────────

/**
 * Camera preset → rotation / perspective fragment only. Final transform
 * is composed centrally in `applyTransforms` as:
 *   translate(vpCx, vpCy)  ← move to viewport center
 *   + perspective + rotateX/Y   ← camera tilt around iframe center
 *   + scale(fit * zoom)          ← fit into viewport, then user zoom
 *   + translate(-iw/2, -ih/2)   ← shift so iframe center sits at origin
 *
 * CSS transform order is right-to-left. With `transform-origin: 0 0`,
 * this composition rotates and scales around the iframe's own center
 * (not its top-left corner) so `tilt` / `fly-through` / `isometric`
 * feel like a camera orbiting the scene.
 *
 * The per-preset fragment is ONLY perspective+rotate. No scale, no
 * translate — those are owned by the composer.
 */
const CAMERA_FRAGMENT: Record<CameraPreset, (rx: number, ry: number) => string> = {
  'front': () => '',
  'tilt': (rx, ry) =>
    `perspective(1600px) rotateX(${8 + rx}deg) rotateY(${-6 + ry}deg)`,
  'fly-through': (rx, ry) =>
    `perspective(1400px) rotateX(${rx}deg) rotateY(${ry}deg)`,
  'isometric': (rx, ry) =>
    `perspective(2000px) rotateX(${-30 + rx}deg) rotateY(${-45 + ry}deg)`,
  'parallax': (rx, ry) =>
    `perspective(1800px) rotateX(${rx * 0.3}deg) rotateY(${ry * 0.3}deg)`,
};
/** Per-preset scale multiplier applied on top of fit-scale. */
const CAMERA_SCALE: Record<CameraPreset, number> = {
  'front': 1, 'tilt': 1, 'fly-through': 1, 'isometric': 0.9, 'parallax': 1,
};

// ─── Filter stacks ─────────────────────────────────────────

const FILTERS: Record<FilterPreset, string> = {
  'none': 'none',
  'cinema': 'contrast(1.1) saturate(1.1) brightness(0.98)',
  'noir': 'grayscale(1) contrast(1.3)',
  'dream': 'blur(0.4px) saturate(1.2) hue-rotate(-5deg) brightness(1.03)',
  'neon': 'saturate(1.6) brightness(1.08) contrast(1.1)',
  'crt': 'saturate(1.2) contrast(1.08)',
};

/**
 * CRT filter additionally wants an overlay (scanlines) and chromatic
 * aberration. We append a repeating-gradient pseudo-element on the
 * viewport when this preset is active.
 */
const FILTER_OVERLAYS: Partial<Record<FilterPreset, string>> = {
  'crt': 'repeating-linear-gradient(0deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px, rgba(0,0,0,0.18) 3px)',
  'cinema': 'radial-gradient(circle at center, rgba(0,0,0,0) 50%, rgba(0,0,0,0.4) 100%)', // vignette
};

// ─── Controller ────────────────────────────────────────────

export function createPresentMode(opts: PresentModeOptions): PresentModeController {
  let active = false;
  let camera: CameraPreset = 'front';
  let filter: FilterPreset = 'none';
  let zoom = 1;
  let rx = 0; // dynamic rotate-X (deg)
  let ry = 0; // dynamic rotate-Y
  let rafId: number | null = null;
  let flyAngle = 0;

  // Overlay div for CRT / vignette / chromatic stacks. Lives in the
  // viewport, above the iframe. Detached when not active.
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    display: 'none',
    mixBlendMode: 'multiply',
    zIndex: '10',
  });

  // Chrome-hider sibling — covers the editor's non-canvas chrome during
  // present mode with a solid dark background so the camera transforms
  // don't reveal the editor underneath.
  const backdrop = document.createElement('div');
  Object.assign(backdrop.style, {
    position: 'absolute',
    inset: '0',
    background: '#0a0a0a',
    pointerEvents: 'none',
    display: 'none',
    zIndex: '5',
  });

  opts.viewport.appendChild(backdrop);
  opts.viewport.appendChild(overlay);

  // Wrapper for iframe transforms. We DON'T replace the iframe's wrapper
  // from dom-canvas.ts — present mode operates on the EXISTING parent
  // element by layering its transform with ours.
  const iframeParent = opts.iframe.parentElement;

  const savedParentTransform = { transform: '', transformOrigin: '', transition: '' };

  const applyTransforms = () => {
    if (!iframeParent) return;
    // Ensure wrapper is ABOVE backdrop (z:5) and BELOW overlay (z:10).
    // Without this, the backdrop paints over the tilted scene → user
    // sees solid #0a0a0a with no content, thinks present mode broke.
    if (active) iframeParent.style.zIndex = '8';
    else iframeParent.style.zIndex = '';
    if (active) {
      const iframe = opts.iframe;
      const iw = parseFloat(iframe.style.width) || iframe.offsetWidth || 1440;
      const ih = parseFloat(iframe.style.height) || iframe.offsetHeight || 900;
      const vp = opts.viewport.getBoundingClientRect();
      const pad = 60;
      const fitScale = Math.min((vp.width - pad * 2) / iw, (vp.height - pad * 2) / ih);
      const finalScale = fitScale * CAMERA_SCALE[camera] * zoom;
      const vpCx = vp.width / 2;
      const vpCy = vp.height / 2;
      // Right-to-left CSS transform application:
      //   1. translate(-iw/2, -ih/2): put iframe center at (0,0)
      //   2. scale(finalScale): scale around that center
      //   3. perspective + rotateX/Y: camera tilt around center
      //   4. translate(vpCx, vpCy): move the centered+tilted scene to viewport center
      const cam = CAMERA_FRAGMENT[camera](rx, ry);
      iframeParent.style.transform =
        `translate(${vpCx}px, ${vpCy}px) ${cam} scale(${finalScale}) translate(${-iw / 2}px, ${-ih / 2}px)`;
      iframeParent.style.transformOrigin = '0 0';
      iframeParent.style.transition = 'transform 0.08s linear';
    } else {
      iframeParent.style.transform = savedParentTransform.transform;
      iframeParent.style.transformOrigin = savedParentTransform.transformOrigin;
      iframeParent.style.transition = savedParentTransform.transition;
    }
  };

  const applyFilter = () => {
    opts.iframe.style.filter = active ? FILTERS[filter] : '';
    const ovl = FILTER_OVERLAYS[filter];
    if (active && ovl) {
      overlay.style.display = 'block';
      overlay.style.background = ovl;
    } else {
      overlay.style.display = 'none';
    }
  };

  // Fly-through orbit loop.
  const flyLoop = () => {
    if (!active || camera !== 'fly-through') { rafId = null; return; }
    flyAngle += 0.2;
    ry = Math.sin(flyAngle * 0.01) * 12; // ±12° gentle yaw
    rx = Math.cos(flyAngle * 0.013) * 4; // ±4° gentle pitch
    applyTransforms();
    rafId = requestAnimationFrame(flyLoop);
  };

  const focused = (): boolean => opts.isFocused?.() ?? true;

  // Keyboard: arrow rotate, ± zoom, Space cycle filter, Esc exit,
  // 1-5 cycle camera presets. Window-global listener; multi-mount gate
  // keeps the arrow / number keys scoped to the focused instance even
  // when several canvases are in present mode simultaneously.
  const onKey = (e: KeyboardEvent) => {
    if (!active) return;
    if (!focused()) return;
    if (e.key === 'Escape') { e.preventDefault(); ctrl.exit(); return; }
    if (e.key === 'ArrowLeft')  { ry -= 5; applyTransforms(); e.preventDefault(); }
    if (e.key === 'ArrowRight') { ry += 5; applyTransforms(); e.preventDefault(); }
    if (e.key === 'ArrowUp')    { rx -= 5; applyTransforms(); e.preventDefault(); }
    if (e.key === 'ArrowDown')  { rx += 5; applyTransforms(); e.preventDefault(); }
    if (e.key === '=' || e.key === '+') { zoom = Math.min(2, zoom + 0.05); applyTransforms(); }
    if (e.key === '-' || e.key === '_') { zoom = Math.max(0.3, zoom - 0.05); applyTransforms(); }
    if (e.key === '0') { zoom = 1; rx = 0; ry = 0; applyTransforms(); }
    if (e.key === ' ') {
      const order: FilterPreset[] = ['none', 'cinema', 'noir', 'dream', 'neon', 'crt'];
      const next = order[(order.indexOf(filter) + 1) % order.length];
      ctrl.setFilter(next);
      e.preventDefault();
    }
    if (e.key >= '1' && e.key <= '5') {
      const presets: CameraPreset[] = ['front', 'tilt', 'fly-through', 'isometric', 'parallax'];
      ctrl.setCamera(presets[parseInt(e.key, 10) - 1]);
    }
  };

  // Parallax mouse follow (only when camera === 'parallax'). Mousemove
  // is window-global; the focus gate prevents cursor motion over
  // variant[0] from animating variant[1]'s camera. The rect intersection
  // check below still useful as a fallback (mouse outside viewport) even
  // for the focused instance.
  const onMove = (e: MouseEvent) => {
    if (!active || camera !== 'parallax') return;
    if (!focused()) return;
    const rect = opts.viewport.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / rect.width - 0.5;   // -0.5 .. 0.5
    const cy = (e.clientY - rect.top) / rect.height - 0.5;
    ry = cx * 20;
    rx = -cy * 14;
    applyTransforms();
  };

  const ctrl: PresentModeController = {
    enter: (c, f) => {
      if (active) return;
      active = true;
      if (c) camera = c;
      if (f) filter = f;
      if (iframeParent) {
        savedParentTransform.transform = iframeParent.style.transform;
        savedParentTransform.transformOrigin = iframeParent.style.transformOrigin;
        savedParentTransform.transition = iframeParent.style.transition;
      }
      backdrop.style.display = 'block';
      applyTransforms();
      applyFilter();
      if (camera === 'fly-through' && rafId == null) rafId = requestAnimationFrame(flyLoop);
      opts.onModeChange?.(true);
    },
    exit: () => {
      if (!active) return;
      active = false;
      if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
      backdrop.style.display = 'none';
      applyTransforms();
      applyFilter();
      opts.onModeChange?.(false);
    },
    toggle: () => (active ? ctrl.exit() : ctrl.enter()),
    setCamera: (preset) => {
      camera = preset;
      rx = 0; ry = 0; zoom = 1;
      applyTransforms();
      if (active && camera === 'fly-through' && rafId == null) rafId = requestAnimationFrame(flyLoop);
    },
    setFilter: (preset) => { filter = preset; applyFilter(); },
    orbit: (dx, dy) => { ry += dx; rx -= dy; applyTransforms(); },
    isActive: () => active,
    destroy: () => {
      ctrl.exit();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousemove', onMove);
      backdrop.remove();
      overlay.remove();
    },
  };

  window.addEventListener('keydown', onKey);
  window.addEventListener('mousemove', onMove);

  return ctrl;
}
