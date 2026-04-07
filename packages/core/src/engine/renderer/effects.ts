/**
 * Reframe Standalone Engine — Effects Rendering
 *
 * Drop shadows, inner shadows, blurs.
 * Caches ImageFilter/MaskFilter objects.
 */

import type { ICanvasKit, IRImageFilter, IRMaskFilter, IRPaint, IRCanvas, IRPath } from './types';
import type { Effect, SceneNode } from '../types';

// ─── Filter Cache ───────────────────────────────────────────────

export class EffectCache {
  private imageFilters = new Map<string, IRImageFilter>();
  private maskFilters = new Map<number, IRMaskFilter>();

  constructor(private ck: ICanvasKit) {}

  getDropShadow(
    dx: number, dy: number,
    sigma: number,
    color: Float32Array,
  ): IRImageFilter {
    const key = `ds:${dx},${dy},${sigma},${color[0]},${color[1]},${color[2]},${color[3]}`;
    let filter = this.imageFilters.get(key);
    if (!filter) {
      filter = this.ck.ImageFilter.MakeDropShadowOnly(dx, dy, sigma, sigma, color, null);
      this.imageFilters.set(key, filter);
    }
    return filter;
  }

  getBlur(sigma: number): IRImageFilter {
    const key = `blur:${sigma}`;
    let filter = this.imageFilters.get(key);
    if (!filter) {
      filter = this.ck.ImageFilter.MakeBlur(sigma, sigma, this.ck.TileMode.Clamp, null);
      this.imageFilters.set(key, filter);
    }
    return filter;
  }

  getDecalBlur(sigma: number): IRImageFilter {
    const key = `decal:${sigma}`;
    let filter = this.imageFilters.get(key);
    if (!filter) {
      filter = this.ck.ImageFilter.MakeBlur(sigma, sigma, this.ck.TileMode.Decal, null);
      this.imageFilters.set(key, filter);
    }
    return filter;
  }

  getMaskBlur(sigma: number): IRMaskFilter {
    let filter = this.maskFilters.get(sigma);
    if (!filter) {
      filter = this.ck.MaskFilter.MakeBlur(this.ck.BlurStyle.Normal, sigma, true);
      this.maskFilters.set(sigma, filter);
    }
    return filter;
  }

  clear(): void {
    for (const f of this.imageFilters.values()) f.delete();
    for (const f of this.maskFilters.values()) f.delete();
    this.imageFilters.clear();
    this.maskFilters.clear();
  }
}

// ─── Render Effects ─────────────────────────────────────────────

/**
 * Render effects for a node (either 'behind' or 'front' pass).
 *
 * Behind: DROP_SHADOW, BACKGROUND_BLUR
 * Front: INNER_SHADOW
 */
export function renderEffects(
  ck: ICanvasKit,
  canvas: IRCanvas,
  cache: EffectCache,
  auxPaint: IRPaint,
  layerPaint: IRPaint,
  node: SceneNode,
  shapePath: IRPath,
  rect: Float32Array,
  pass: 'behind' | 'front',
): void {
  for (const effect of node.effects) {
    if (!effect.visible) continue;

    if (pass === 'behind') {
      if (effect.type === 'DROP_SHADOW') {
        renderDropShadow(ck, canvas, cache, auxPaint, node, shapePath, rect, effect);
      } else if (effect.type === 'BACKGROUND_BLUR') {
        renderBackgroundBlur(ck, canvas, cache, layerPaint, shapePath, rect, effect);
      }
    } else {
      if (effect.type === 'INNER_SHADOW') {
        renderInnerShadow(ck, canvas, cache, auxPaint, node, shapePath, rect, effect);
      }
    }
  }
}

function renderDropShadow(
  ck: ICanvasKit,
  canvas: IRCanvas,
  cache: EffectCache,
  auxPaint: IRPaint,
  node: SceneNode,
  shapePath: IRPath,
  rect: Float32Array,
  effect: Effect,
): void {
  const c = effect.color;
  const sigma = effect.radius / 2;
  const spread = effect.spread || 0;

  const shadowColor = ck.Color4f(c.r, c.g, c.b, c.a);

  auxPaint.setColor(shadowColor);
  auxPaint.setMaskFilter(cache.getMaskBlur(sigma));
  auxPaint.setStyle(ck.PaintStyle.Fill);

  canvas.save();
  canvas.translate(effect.offset.x, effect.offset.y);

  if (spread !== 0) {
    // Expand shape by spread
    const expandedRect = ck.LTRBRect(
      -spread, -spread,
      node.width + spread, node.height + spread,
    );
    canvas.drawRect(expandedRect, auxPaint);
  } else {
    canvas.drawPath(shapePath, auxPaint);
  }

  canvas.restore();
  auxPaint.setMaskFilter(null);
}

function renderBackgroundBlur(
  ck: ICanvasKit,
  canvas: IRCanvas,
  cache: EffectCache,
  layerPaint: IRPaint,
  shapePath: IRPath,
  rect: Float32Array,
  effect: Effect,
): void {
  const sigma = effect.radius / 2;

  canvas.save();
  canvas.clipPath(shapePath, ck.ClipOp.Intersect, true);
  layerPaint.setImageFilter(cache.getBlur(sigma));
  canvas.saveLayer(layerPaint);
  canvas.restore();
  canvas.restore();
  layerPaint.setImageFilter(null);
}

function renderInnerShadow(
  ck: ICanvasKit,
  canvas: IRCanvas,
  cache: EffectCache,
  auxPaint: IRPaint,
  node: SceneNode,
  shapePath: IRPath,
  rect: Float32Array,
  effect: Effect,
): void {
  const c = effect.color;
  const sigma = effect.radius / 2;

  auxPaint.setColor(ck.Color4f(c.r, c.g, c.b, c.a));
  auxPaint.setImageFilter(cache.getDecalBlur(sigma));
  auxPaint.setStyle(ck.PaintStyle.Fill);

  canvas.save();
  canvas.clipPath(shapePath, ck.ClipOp.Intersect, true);
  canvas.translate(effect.offset.x, effect.offset.y);

  // Draw a large rect that exceeds the node bounds
  // The clip + blur creates the inner shadow effect
  const bigRect = ck.LTRBRect(
    -node.width, -node.height,
    node.width * 2, node.height * 2,
  );
  canvas.drawRect(bigRect, auxPaint);

  canvas.restore();
  auxPaint.setImageFilter(null);
}
