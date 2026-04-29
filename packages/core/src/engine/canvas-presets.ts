/**
 * Canvas size presets (T3 #31).
 *
 * 9 named dimensions covering common artifacts — component catalogs,
 * content tiles, social-media exports, web pages. Custom NxN format
 * is the escape hatch for ad-hoc sizes; dimensions clamped to 50–4096
 * each axis to prevent unrenderable inputs (5×5) and memory blow
 * (10000×10000).
 *
 * `web` preset (1440×900) matches the existing default — explicitly
 * available so designers can opt in to "default-equivalent" via name.
 *
 * ─── Foundation for adjacent primitives ─────────────────────
 *
 * Sampler (#25) cells benefit from constrained canvas (each cell can
 * use `icon` or `tile` size). Future `component` composition kind will
 * consume this for catalog displays. The field is scene-level, not
 * composition-level — composition kinds layer over scenes that already
 * carry their own canvas.
 *
 * ─── Backward compat ────────────────────────────────────────
 *
 * Existing scenes have no canvas field. Their compile path stays
 * untouched: only when `canvas` option is explicitly passed does the
 * compiler set scene root dimensions + persist the canvas field.
 */

export interface CanvasDimensions {
  width: number;
  height: number;
}

/**
 * Resolved canvas spec stored on SceneGraph + serialized scene envelope.
 * `preset` is set when a named preset was used; undefined when the
 * caller passed a custom NxN string. Round-trip preserves both forms.
 */
export interface CanvasSpec extends CanvasDimensions {
  preset?: string;
}

/** Named preset registry. Add new presets here — the resolver auto-picks them. */
export const CANVAS_PRESETS = {
  /** Component catalogs / icon previews. */
  'icon': { width: 200, height: 200 },
  /** Card-grid thumbnails / pinterest-style tiles. */
  'thumbnail': { width: 300, height: 300 },
  /** Mid-density catalog tile. */
  'tile': { width: 400, height: 400 },
  /** Content-card aspect (3:2). */
  'card': { width: 600, height: 400 },
  /** Instagram square / generic social post. */
  'social-square': { width: 1080, height: 1080 },
  /** Instagram / TikTok story aspect. */
  'social-story': { width: 1080, height: 1920 },
  /** Open-Graph banner (1200×630 — Twitter / Facebook / LinkedIn standard). */
  'social-banner': { width: 1200, height: 630 },
  /** Default web canvas — matches the engine's pre-#31 1440px baseline. */
  'web': { width: 1440, height: 900 },
  /** Wide-screen / desktop wallpaper aspect. */
  'wide': { width: 1920, height: 1080 },
} as const satisfies Record<string, CanvasDimensions>;

export type CanvasPreset = keyof typeof CANVAS_PRESETS;

/** Sorted preset names for stable error-message rendering + iteration. */
export const KNOWN_CANVAS_PRESETS = Object.keys(CANVAS_PRESETS) as CanvasPreset[];

/** Lower / upper guards on custom NxN dimensions. */
export const CANVAS_MIN_DIM = 50;
export const CANVAS_MAX_DIM = 4096;

/**
 * Error subclass for canvas resolution failures. Carries a stable
 * `code` field that compile dispatchers re-emit in the structured
 * tool-error envelope (`compile.canvas.unknown_preset`,
 * `compile.canvas.dimensions_out_of_range`).
 */
export class CanvasResolveError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'CanvasResolveError';
  }
}

/**
 * Resolve a canvas spec string into concrete dimensions.
 *
 * Accepts:
 *   - preset name from CANVAS_PRESETS (e.g. `"icon"`, `"social-square"`)
 *   - custom `NxN` shape (e.g. `"320x240"`, `"800x600"`)
 *
 * Throws CanvasResolveError on:
 *   - unknown name that's also not NxN-shaped
 *   - NxN dimensions outside CANVAS_MIN_DIM..CANVAS_MAX_DIM range
 *
 * Determinism: same string → same CanvasSpec. The `preset` field is
 * set only when a named preset matches; custom NxN leaves it undefined.
 */
export function resolveCanvas(input: string): CanvasSpec {
  const trimmed = input.trim();
  // Preset lookup first — exact match (case-sensitive). Designer-typed
  // strings come from DESIGN.md / agent prompts, both well-controlled.
  if (trimmed in CANVAS_PRESETS) {
    const dim = CANVAS_PRESETS[trimmed as CanvasPreset];
    return { width: dim.width, height: dim.height, preset: trimmed };
  }
  // Custom NxN format. Only digits, no decimals (canvas pixels are int).
  const m = trimmed.match(/^(\d+)\s*[xX×]\s*(\d+)$/);
  if (m) {
    const w = parseInt(m[1], 10);
    const h = parseInt(m[2], 10);
    if (
      !Number.isFinite(w) || !Number.isFinite(h) ||
      w < CANVAS_MIN_DIM || w > CANVAS_MAX_DIM ||
      h < CANVAS_MIN_DIM || h > CANVAS_MAX_DIM
    ) {
      throw new CanvasResolveError(
        'compile.canvas.dimensions_out_of_range',
        `Custom canvas "${input}" out of range — each dimension must be ${CANVAS_MIN_DIM}..${CANVAS_MAX_DIM} px (got ${w}×${h}).`,
      );
    }
    return { width: w, height: h };
  }
  throw new CanvasResolveError(
    'compile.canvas.unknown_preset',
    `Unknown canvas preset "${input}". Available: ${KNOWN_CANVAS_PRESETS.join(', ')} or NxN format (e.g. "200x200").`,
  );
}
