/**
 * OverlayRenderer — base scene iframe + N peer-element <canvas> layers
 * stacked over it, driven by a single requestAnimationFrame loop and
 * sized to the iframe via ResizeObserver.
 *
 * Distinct from `overlay.ts` (selection handles) — this is the T2 #5
 * canvas overlay primitive: ambient runtime visuals (grain noise,
 * gradient pulse, particle dust) that don't fit inside the SceneGraph
 * because they're 2nd-render-pass — they decorate the rendered base
 * scene, not the structured tree.
 *
 * ─── Lifecycle ──────────────────────────────────────────────
 *
 *   mount:
 *     1. fetch /platform/api/overlay/:id → spec + layerRuntimeSource
 *     2. createDOMCanvas for base scene under hostId `${overlayId}:base`
 *     3. for each layer in spec:
 *          a. create <canvas> element, position absolute over iframe
 *          b. eval factory_<type> from layerRuntimeSource (cached)
 *          c. layer.init(canvas, config, baseSize, layerId) → instance
 *     4. ResizeObserver on the iframe wrapper element
 *     5. start RAF loop calling layer.render(ctx, time) for each layer
 *
 *   unmount:
 *     1. cancelAnimationFrame
 *     2. ResizeObserver.disconnect()
 *     3. layer.destroy() for each
 *     4. remove canvas elements
 *     5. createDOMCanvas's destroy()
 *
 * ─── Layers are NOT scenes ──────────────────────────────────
 *
 * Phase 0: layers don't register in the canvas-dom focus registry.
 * Click-to-select on a layer = no-op (pointer-events:none on layer
 * canvases routes clicks through to the base iframe). Inspector
 * focuses base scene; per-layer config editing is a future feature
 * gated on signal.
 *
 * ─── Determinism ────────────────────────────────────────────
 *
 * factory_<type>(canvas, config, baseSize, layerId) MUST seed any RNG
 * from layerId (via seededRng(layerId) provided in BROWSER_SOURCE
 * utils). Same overlayId mounted twice → identical first-frame pixels.
 * This is load-bearing for HTML export round-trip parity.
 */

import { createDOMCanvas } from './dom-canvas.js';

// ─── Spec types — shape received from /platform/api/overlay/:id ────

interface OverlayLayerSpec {
  id: string;
  type: string;
  config: Record<string, unknown>;
  zIndex?: number;
  blendMode?: string;
}

interface OverlaySpec {
  overlayId: string;
  name: string;
  baseSceneId: string;
  layers: OverlayLayerSpec[];
}

interface OverlayApiResponse {
  ok: true;
  spec: OverlaySpec;
  layerRuntimeSource: string;
}

// ─── Runtime layer instance — what factory_<type> returns ────

interface LayerRuntimeInstance {
  render(ctx: CanvasRenderingContext2D, time: number): void;
  resize(width: number, height: number): void;
  destroy(): void;
}

type LayerFactory = (
  canvas: HTMLCanvasElement,
  config: Record<string, unknown>,
  baseSize: { width: number; height: number },
  layerId: string,
) => LayerRuntimeInstance;

// ─── Public API ──────────────────────────────────────────────

export interface OverlayRendererOptions {
  host: HTMLElement;
  overlayId: string;
  /** Optional pre-fetched spec. Falls back to /platform/api/overlay/:id GET. */
  spec?: OverlaySpec;
  /** Pre-fetched layer runtime source string. Required when `spec` is passed. */
  layerRuntimeSource?: string;
}

export interface OverlayRendererHandle {
  readonly overlayId: string;
  /** Number of mounted active layers. */
  readonly layerCount: number;
  /** Capture base canvas pixel data — used by determinism contract tests. */
  captureFrame(): ImageData | null;
  destroy(): void;
}

export async function mountOverlayRenderer(
  opts: OverlayRendererOptions,
): Promise<OverlayRendererHandle> {
  const { host, overlayId } = opts;

  // Resolve spec + runtime source.
  let spec: OverlaySpec;
  let runtimeSource: string;
  if (opts.spec && opts.layerRuntimeSource) {
    spec = opts.spec;
    runtimeSource = opts.layerRuntimeSource;
  } else {
    const res = await fetch(`/platform/api/overlay/${encodeURIComponent(overlayId)}`);
    if (!res.ok) throw new Error(`overlay-renderer: GET /platform/api/overlay/${overlayId} → ${res.status}`);
    const body = (await res.json()) as OverlayApiResponse;
    spec = body.spec;
    runtimeSource = body.layerRuntimeSource;
  }

  // Build factories table from runtime source. The source defines top-
  // level functions named `factory_<type>` (with `-` → `_`) plus the
  // shared utils. We eval once and bind each factory by name.
  const factories: Record<string, LayerFactory> = evalLayerFactories(runtimeSource, spec.layers.map(l => l.type));

  // Wipe host (caller responsibility to preserve anything outside).
  host.style.position = 'relative';
  host.style.overflow = 'hidden';
  host.innerHTML = '';

  // Base scene container — the iframe lives inside this. Layer canvases
  // are siblings stacked above via z-index.
  const baseContainer = document.createElement('div');
  baseContainer.className = 'rfd-overlay-base';
  baseContainer.style.position = 'absolute';
  baseContainer.style.inset = '0';
  baseContainer.style.zIndex = '0';
  host.appendChild(baseContainer);

  const baseHostId = `${overlayId}:base`;
  const baseCanvas = createDOMCanvas({
    container: baseContainer,
    sceneId: spec.baseSceneId,
    hostId: baseHostId,
    compositionKind: 'overlay' as any,
  });

  // Layer canvases. Sort by zIndex (default = array index) so explicit
  // overrides win predictably. Stable-sort matters when two layers share
  // a zIndex — keep the input order via index tiebreak.
  const sortedLayerIndices = spec.layers
    .map((l, i) => ({ l, i, z: l.zIndex ?? i }))
    .sort((a, b) => (a.z - b.z) || (a.i - b.i));

  type ActiveLayer = {
    spec: OverlayLayerSpec;
    canvas: HTMLCanvasElement;
    instance: LayerRuntimeInstance;
  };
  const activeLayers: ActiveLayer[] = [];

  // Initial size from baseContainer's bbox (same as iframe — iframe
  // `inset:0` fills container).
  function currentSize(): { width: number; height: number } {
    const r = baseContainer.getBoundingClientRect();
    // Round to integers — fractional canvas dimensions cause sub-pixel
    // blur on some browsers and break ImageData round-trip pixel checks.
    return { width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) };
  }

  for (const { l: layerSpec } of sortedLayerIndices) {
    const factory = factories[layerSpec.type];
    if (!factory) {
      console.warn(`[overlay-renderer] no factory for layer type "${layerSpec.type}", skipping`);
      continue;
    }
    const canvas = document.createElement('canvas');
    canvas.dataset.layerId = layerSpec.id;
    canvas.dataset.layerType = layerSpec.type;
    const { width, height } = currentSize();
    canvas.width = width;
    canvas.height = height;
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    // pointer-events:none so clicks fall through to the base iframe.
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = String((layerSpec.zIndex ?? 0) + 1);
    if (layerSpec.blendMode) {
      // CSS mix-blend-mode applies between this canvas and what's below
      // (the base iframe + lower layers). globalCompositeOperation only
      // applies within a single canvas's draws, so CSS is the right knob
      // for inter-layer composition.
      canvas.style.mixBlendMode = layerSpec.blendMode;
    }
    host.appendChild(canvas);

    const instance = factory(canvas, layerSpec.config, { width, height }, layerSpec.id);
    activeLayers.push({ spec: layerSpec, canvas, instance });
  }

  // ResizeObserver on the host (which is sized by its parent — iframe
  // matches via inset:0). Iframe internal scroll is not observed; that's
  // intentional Phase 0 (overlay clips to viewport, doesn't follow scroll).
  let lastWidth = 0;
  let lastHeight = 0;
  const ro = new ResizeObserver(() => {
    const { width, height } = currentSize();
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;
    for (const layer of activeLayers) {
      try { layer.instance.resize(width, height); }
      catch (err) { console.warn('[overlay-renderer] layer.resize threw', err); }
    }
  });
  ro.observe(host);

  // RAF loop. One loop drives every layer; per-frame the loop walks
  // activeLayers in the same order they were created (z-stack already
  // applied via DOM order). Frame time is performance.now() so it's
  // monotonic + sub-ms precise.
  let rafId = 0;
  let stopped = false;
  function tick(time: number) {
    if (stopped) return;
    for (const layer of activeLayers) {
      try {
        const ctx = layer.canvas.getContext('2d');
        if (!ctx) continue;
        layer.instance.render(ctx, time);
      } catch (err) {
        console.warn(`[overlay-renderer] layer ${layer.spec.id} render threw`, err);
      }
    }
    rafId = requestAnimationFrame(tick);
  }
  // Kick the first frame at t=0 explicitly so determinism tests can
  // capture-then-compare without timing skew.
  rafId = requestAnimationFrame(() => {
    for (const layer of activeLayers) {
      const ctx = layer.canvas.getContext('2d');
      if (ctx) {
        try { layer.instance.render(ctx, 0); }
        catch (err) { console.warn(`[overlay-renderer] layer ${layer.spec.id} initial render threw`, err); }
      }
    }
    rafId = requestAnimationFrame(tick);
  });

  return {
    overlayId,
    get layerCount() { return activeLayers.length; },
    captureFrame(): ImageData | null {
      // Stitch all layer canvases into a single ImageData by drawing
      // them onto an off-screen canvas in z-order. Useful for the
      // determinism contract test (mount → capture → mount → capture →
      // compare bytes).
      if (activeLayers.length === 0) return null;
      const { width, height } = currentSize();
      const off = document.createElement('canvas');
      off.width = width;
      off.height = height;
      const offCtx = off.getContext('2d');
      if (!offCtx) return null;
      for (const layer of activeLayers) {
        offCtx.drawImage(layer.canvas, 0, 0);
      }
      try { return offCtx.getImageData(0, 0, width, height); }
      catch { return null; }
    },
    destroy() {
      stopped = true;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      for (const layer of activeLayers) {
        try { layer.instance.destroy(); }
        catch (err) { console.warn('[overlay-renderer] destroy threw', err); }
        layer.canvas.remove();
      }
      activeLayers.length = 0;
      try { baseCanvas.destroy(); }
      catch (err) { console.warn('[overlay-renderer] baseCanvas.destroy threw', err); }
      host.innerHTML = '';
    },
  };
}

// ─── eval helper ─────────────────────────────────────────────

/**
 * Eval the runtime source string into a name → factory table.
 *
 * The runtime source defines top-level functions whose names follow the
 * `factory_<type>` convention (with type's `-` replaced by `_`). We
 * wrap the eval in a Function() so it doesn't pollute global scope and
 * return a dispatch object indexed by ORIGINAL type name.
 *
 * Why Function() not eval(): scoped-by-call-site (unlike global eval),
 * doesn't leak into surrounding closure. CSP that allows
 * `script-src 'unsafe-eval'` permits both equally — overlay needs that
 * permission already (browser-shipped factory source IS dynamic code).
 */
function evalLayerFactories(source: string, types: string[]): Record<string, LayerFactory> {
  const uniqueTypes = Array.from(new Set(types));
  const factoryNames = uniqueTypes.map(t => 'factory_' + t.replace(/-/g, '_'));
  const returnExpr = '{ ' + uniqueTypes.map((t, i) => `'${t}': ${factoryNames[i]}`).join(', ') + ' }';
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(source + '\n; return ' + returnExpr + ';');
  return factory() as Record<string, LayerFactory>;
}
