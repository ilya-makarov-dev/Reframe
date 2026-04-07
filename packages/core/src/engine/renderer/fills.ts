/**
 * Reframe Standalone Engine — Fill Rendering
 *
 * Solid, gradient, and image fills via CanvasKit.
 */

import type { ICanvasKit, IRPaint, IRShader, IRImage, IRCanvas } from './types';
import type { Fill, GradientTransform, SceneNode } from '../types';

// ─── Solid Fill ─────────────────────────────────────────────────

export function applySolidFill(
  ck: ICanvasKit,
  paint: IRPaint,
  fill: Fill,
): void {
  const c = fill.color;
  const a = fill.opacity ?? 1;
  paint.setColor(ck.Color4f(c.r, c.g, c.b, c.a * a));
  paint.setShader(null);
}

// ─── Gradient Fills ─────────────────────────────────────────────

function gradientColorsAndPositions(
  ck: ICanvasKit,
  fill: Fill,
): { colors: Float32Array[]; positions: number[] } {
  const stops = fill.gradientStops ?? [];
  return {
    colors: stops.map(s => ck.Color4f(s.color.r, s.color.g, s.color.b, s.color.a * (fill.opacity ?? 1))),
    positions: stops.map(s => s.position),
  };
}

export function applyLinearGradient(
  ck: ICanvasKit,
  paint: IRPaint,
  fill: Fill,
  node: SceneNode,
): void {
  const t = fill.gradientTransform ?? { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
  const w = node.width;
  const h = node.height;
  const { colors, positions } = gradientColorsAndPositions(ck, fill);

  const startX = t.m02 * w;
  const startY = t.m12 * h;
  const endX = (t.m00 + t.m02) * w;
  const endY = (t.m10 + t.m12) * h;

  const shader = ck.Shader.MakeLinearGradient(
    [startX, startY], [endX, endY],
    colors, positions,
    ck.TileMode.Clamp,
  );
  paint.setShader(shader);
}

export function applyRadialGradient(
  ck: ICanvasKit,
  paint: IRPaint,
  fill: Fill,
  node: SceneNode,
): void {
  const t = fill.gradientTransform ?? { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
  const w = node.width;
  const h = node.height;
  const { colors, positions } = gradientColorsAndPositions(ck, fill);

  const localMatrix = ck.Matrix.multiply(
    ck.Matrix.scaled(w, h),
    new Float32Array([t.m00, t.m01, t.m02, t.m10, t.m11, t.m12, 0, 0, 1]),
  );

  const shader = ck.Shader.MakeRadialGradient(
    [0.5, 0.5], 0.5,
    colors, positions,
    ck.TileMode.Clamp,
    localMatrix,
  );
  paint.setShader(shader);
}

export function applySweepGradient(
  ck: ICanvasKit,
  paint: IRPaint,
  fill: Fill,
  node: SceneNode,
): void {
  const t = fill.gradientTransform ?? { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
  const w = node.width;
  const h = node.height;
  const { colors, positions } = gradientColorsAndPositions(ck, fill);

  const localMatrix = ck.Matrix.multiply(
    ck.Matrix.scaled(w, h),
    new Float32Array([t.m00, t.m01, t.m02, t.m10, t.m11, t.m12, 0, 0, 1]),
  );

  const shader = ck.Shader.MakeSweepGradient(
    0.5, 0.5,
    colors, positions,
    ck.TileMode.Clamp,
    localMatrix,
  );
  paint.setShader(shader);
}

// ─── Image Fill ─────────────────────────────────────────────────

export function applyImageFill(
  ck: ICanvasKit,
  paint: IRPaint,
  fill: Fill,
  node: SceneNode,
  getImage: (hash: string) => IRImage | null,
): boolean {
  if (!fill.imageHash) return false;
  const img = getImage(fill.imageHash);
  if (!img) return false;

  const iw = img.width();
  const ih = img.height();
  const nw = node.width;
  const nh = node.height;
  const scaleMode = fill.imageScaleMode ?? 'FILL';

  let shader: IRShader;

  if (scaleMode === 'TILE') {
    shader = img.makeShaderCubic(
      ck.TileMode.Repeat,
      ck.TileMode.Repeat,
      1 / 3, 1 / 3,
    );
  } else {
    // FILL, FIT, CROP — compute scale and offset
    let sx: number, sy: number, ox: number, oy: number;

    if (scaleMode === 'FIT') {
      const scale = Math.min(nw / iw, nh / ih);
      sx = scale; sy = scale;
      ox = -(nw / sx - iw) / 2;
      oy = -(nh / sy - ih) / 2;
    } else {
      // FILL or CROP
      const scale = Math.max(nw / iw, nh / ih);
      sx = scale; sy = scale;
      ox = -(nw / sx - iw) / 2;
      oy = -(nh / sy - ih) / 2;
    }

    const matrix = ck.Matrix.multiply(
      ck.Matrix.scaled(sx, sy),
      ck.Matrix.translated(-ox, -oy),
    );

    shader = img.makeShaderCubic(
      ck.TileMode.Clamp,
      ck.TileMode.Clamp,
      1 / 3, 1 / 3,
      matrix,
    );
  }

  paint.setShader(shader);
  return true;
}

// ─── Apply Any Fill ─────────────────────────────────────────────

export function applyFill(
  ck: ICanvasKit,
  paint: IRPaint,
  fill: Fill,
  node: SceneNode,
  getImage: (hash: string) => IRImage | null,
): boolean {
  if (!fill.visible) return false;

  switch (fill.type) {
    case 'SOLID':
      applySolidFill(ck, paint, fill);
      return true;
    case 'GRADIENT_LINEAR':
      applyLinearGradient(ck, paint, fill, node);
      return true;
    case 'GRADIENT_RADIAL':
    case 'GRADIENT_DIAMOND':
      applyRadialGradient(ck, paint, fill, node);
      return true;
    case 'GRADIENT_ANGULAR':
      applySweepGradient(ck, paint, fill, node);
      return true;
    case 'IMAGE':
      return applyImageFill(ck, paint, fill, node, getImage);
    default:
      return false;
  }
}
