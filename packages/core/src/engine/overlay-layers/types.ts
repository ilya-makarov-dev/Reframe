/**
 * LayerImpl contract — every overlay layer file exports one.
 *
 * Two surfaces:
 *
 *   1. validate(config) — runs at COMPILE time on the server. Pure
 *      schema check, no canvas / DOM / browser globals. Returns
 *      ResolvedConfig (with defaults filled in) or a per-param error.
 *      Compile rejects bad configs before write to disk.
 *
 *   2. BROWSER_SOURCE — a JS-text constant defining a top-level
 *      function `factory_<type>(canvas, resolvedConfig, baseSize, layerId)`
 *      that returns a LayerInstance with render(ctx, time) /
 *      resize(w, h) / destroy(). The same source runs in (a) the
 *      editor bundle's overlay-renderer ESM and (b) standalone
 *      exported HTML's inline IIFE registry.
 *
 * The validate() server impl and the factory_<type> in BROWSER_SOURCE
 * are independent functions — keeping them separate lets the server
 * stay typed without dragging canvas / RAF mocks into compile, and
 * lets BROWSER_SOURCE stay browser-portable without TS dependencies.
 *
 * Adding a new layer type: drop a new file alongside noise-grain.ts /
 * gradient-pulse.ts / particle-dust.ts, register it in index.ts. No
 * changes to compile.ts or html.ts needed — those iterate the registry.
 */

import type { JsonValue, OverlayLayerType } from '../composition.js';

export type LayerValidationResult =
  | { ok: true; resolved: Record<string, JsonValue> }
  | { ok: false; param: string; message: string };

export interface LayerImpl {
  type: OverlayLayerType;
  /**
   * Pure compile-time schema check. Returns the resolved config (with
   * defaults filled) on ok, or a `{ param, message }` pair naming the
   * failing key. Server uses this to generate `compile.overlay.invalid_layer_config`
   * envelope details.
   */
  validate(config: Record<string, JsonValue>): LayerValidationResult;
  /**
   * JavaScript source text for the runtime factory. Must define a
   * top-level function `factory_<type>(canvas, config, baseSize, layerId)`
   * returning `{ render(ctx, time), resize(w, h), destroy() }`. May
   * use any helper defined in OVERLAY_UTILS_BROWSER_SOURCE which the
   * exporter prepends to the IIFE.
   *
   * Also imported by overlay-renderer.ts via new Function() so server
   * and client run byte-identical layer code.
   */
  readonly BROWSER_SOURCE: string;
}

/** Runtime shape returned by factory_<type>. Lives in browser, never imported server-side. */
export interface LayerInstance {
  render(ctx: CanvasRenderingContext2D, time: number): void;
  resize(width: number, height: number): void;
  destroy(): void;
}
