/**
 * Shared utilities for overlay layer implementations.
 *
 * Extracted up-front (per #5 brief footer) — three layer types already
 * need seeded RNG and config-key lookup with defaults; physics layers
 * (#10) will add 6 more. Putting these in one file from day-1 prevents
 * the inevitable copy-paste-3-times-then-extract pattern.
 *
 * ─── Determinism contract ───────────────────────────────────
 *
 * Layer init MUST be deterministic given (config, layerId). Two mounts
 * of the same overlay show identical first frame — particle scatter,
 * grain noise, gradient phase. The seed source is the layerId (stable
 * across compiles) hashed via fnv32 → seeded into mulberry32. NEVER
 * Math.random() at init.
 *
 * Why seeded determinism is load-bearing:
 *   - HTML export round-trip: exported .html opened in browser must
 *     match /preview canvas pixel-for-pixel at t=0. Without seeded init,
 *     particles drift between runs.
 *   - Visual diff testing: pixel-comparison tests need stable t=0 state.
 *   - Multi-mount: same overlayId mounted in two iframes side-by-side
 *     should show synced initial state, drift only under independent
 *     time bases.
 *
 * Time-based variation (which IS allowed and IS expected — overlays are
 * animated) flows through `time` argument to layer.render(), not init.
 */

// ─── BROWSER_SOURCE-shipped fragment ─────────────────────────
//
// The same utility code must run in three contexts:
//   1. Node — server-side compile validation (type-checked TS)
//   2. Browser ESM — overlay-renderer.ts in the editor bundle
//   3. Inline IIFE — exported standalone HTML files
//
// To avoid drift between contexts, the JavaScript text of these helpers
// is the SOURCE OF TRUTH (BROWSER_SOURCE constant) and the TS exports
// below evaluate that same string at module-load via new Function().
// HTML export inlines BROWSER_SOURCE verbatim into the <script> block.

export const OVERLAY_UTILS_BROWSER_SOURCE = `
function fnv32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let s = seed >>> 0;
  return function() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededRng(layerId) { return mulberry32(fnv32(layerId)); }
function readNumber(config, key, fallback, min, max) {
  const v = config[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  if (min !== undefined && v < min) return min;
  if (max !== undefined && v > max) return max;
  return v;
}
function readString(config, key, fallback) {
  const v = config[key];
  return typeof v === 'string' ? v : fallback;
}
function readEnum(config, key, allowed, fallback) {
  const v = config[key];
  return typeof v === 'string' && allowed.indexOf(v) !== -1 ? v : fallback;
}
function readColorArray(config, key, fallback) {
  const v = config[key];
  if (!Array.isArray(v)) return fallback;
  const out = [];
  for (let i = 0; i < v.length; i++) {
    if (typeof v[i] === 'string') out.push(v[i]);
  }
  return out.length > 0 ? out : fallback;
}
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3
    ? h.split('').map(function(c) { return c + c; }).join('')
    : h;
  return {
    r: parseInt(v.substring(0, 2), 16) || 0,
    g: parseInt(v.substring(2, 4), 16) || 0,
    b: parseInt(v.substring(4, 6), 16) || 0,
  };
}
function lerpColor(a, b, t) {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  return {
    r: Math.round(ca.r + (cb.r - ca.r) * t),
    g: Math.round(ca.g + (cb.g - ca.g) * t),
    b: Math.round(ca.b + (cb.b - ca.b) * t),
  };
}
`;

// ─── Server-side typed exports (eval the same source) ───────

interface UtilsModule {
  fnv32(s: string): number;
  mulberry32(seed: number): () => number;
  seededRng(layerId: string): () => number;
  readNumber(c: Record<string, unknown>, key: string, fallback: number, min?: number, max?: number): number;
  readString(c: Record<string, unknown>, key: string, fallback: string): string;
  readEnum<T extends string>(c: Record<string, unknown>, key: string, allowed: readonly T[], fallback: T): T;
  readColorArray(c: Record<string, unknown>, key: string, fallback: string[]): string[];
  hexToRgb(hex: string): { r: number; g: number; b: number };
  lerpColor(a: string, b: string, t: number): { r: number; g: number; b: number };
}

const _utils: UtilsModule = (() => {
  const factory = new Function(
    OVERLAY_UTILS_BROWSER_SOURCE +
    `; return { fnv32, mulberry32, seededRng, readNumber, readString, readEnum, readColorArray, hexToRgb, lerpColor };`,
  );
  return factory() as UtilsModule;
})();

export const fnv32 = _utils.fnv32;
export const mulberry32 = _utils.mulberry32;
export const seededRng = _utils.seededRng;
export const readNumber = _utils.readNumber;
export const readString = _utils.readString;
export const readEnum = _utils.readEnum;
export const readColorArray = _utils.readColorArray;
export const hexToRgb = _utils.hexToRgb;
export const lerpColor = _utils.lerpColor;

// ─── Validation result type (server compile-time) ───────────

export type LayerValidationResult =
  | { ok: true }
  | { ok: false; param: string; message: string };

/** Permissive hex check — accepts #abc / #aabbcc forms; case-insensitive. */
export function isHexColor(s: unknown): s is string {
  return typeof s === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s);
}
