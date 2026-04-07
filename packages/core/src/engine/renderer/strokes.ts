/**
 * Reframe Standalone Engine — Stroke Rendering
 *
 * Stroke drawing with alignment (INSIDE, CENTER, OUTSIDE),
 * independent side weights, cap/join/dash.
 */

import type { ICanvasKit, IRPaint, IRCanvas, IRPath } from './types';
import type { Stroke, SceneNode, StrokeCap, StrokeJoin } from '../types';

// ─── Cap / Join Mapping ─────────────────────────────────────────

export function mapStrokeCap(ck: ICanvasKit, cap: StrokeCap | undefined): number {
  switch (cap) {
    case 'ROUND': return ck.StrokeCap.Round;
    case 'SQUARE': return ck.StrokeCap.Square;
    default: return ck.StrokeCap.Butt;
  }
}

export function mapStrokeJoin(ck: ICanvasKit, join: StrokeJoin | undefined): number {
  switch (join) {
    case 'ROUND': return ck.StrokeJoin.Round;
    case 'BEVEL': return ck.StrokeJoin.Bevel;
    default: return ck.StrokeJoin.Miter;
  }
}

// ─── Configure Stroke Paint ─────────────────────────────────────

export function configureStrokePaint(
  ck: ICanvasKit,
  paint: IRPaint,
  stroke: Stroke,
): void {
  const c = stroke.color;
  paint.setColor(ck.Color4f(c.r, c.g, c.b, c.a * stroke.opacity));
  paint.setStrokeWidth(stroke.weight);
  paint.setStyle(ck.PaintStyle.Stroke);
  paint.setAntiAlias(true);

  if (stroke.cap) paint.setStrokeCap(mapStrokeCap(ck, stroke.cap));
  if (stroke.join) paint.setStrokeJoin(mapStrokeJoin(ck, stroke.join));
  if (stroke.dashPattern && stroke.dashPattern.length >= 2) {
    paint.setPathEffect(ck.PathEffect.MakeDash(stroke.dashPattern, 0));
  } else {
    paint.setPathEffect(null);
  }
}

// ─── Stroke with Alignment ──────────────────────────────────────

/**
 * Draw a stroke with alignment handling.
 *
 * - INSIDE: clip to node shape, double stroke width
 * - OUTSIDE: clip inverse, double stroke width
 * - CENTER: direct stroke
 */
export function drawStrokeWithAlign(
  ck: ICanvasKit,
  canvas: IRCanvas,
  paint: IRPaint,
  stroke: Stroke,
  shapePath: IRPath,
  rect: Float32Array,
): void {
  const align = stroke.align ?? 'CENTER';

  if (align === 'INSIDE') {
    canvas.save();
    canvas.clipPath(shapePath, ck.ClipOp.Intersect, true);
    const origWidth = stroke.weight;
    paint.setStrokeWidth(origWidth * 2);
    canvas.drawPath(shapePath, paint);
    paint.setStrokeWidth(origWidth);
    canvas.restore();
  } else if (align === 'OUTSIDE') {
    canvas.save();
    canvas.clipPath(shapePath, ck.ClipOp.Difference, true);
    const origWidth = stroke.weight;
    paint.setStrokeWidth(origWidth * 2);
    canvas.drawPath(shapePath, paint);
    paint.setStrokeWidth(origWidth);
    canvas.restore();
  } else {
    canvas.drawPath(shapePath, paint);
  }
}

// ─── Independent Side Strokes ───────────────────────────────────

export function drawIndividualSideStrokes(
  ck: ICanvasKit,
  canvas: IRCanvas,
  paint: IRPaint,
  node: SceneNode,
  align: string,
): void {
  const w = node.width;
  const h = node.height;

  const sides = [
    { weight: node.borderTopWeight, x0: 0, y0: 0, x1: w, y1: 0 },
    { weight: node.borderRightWeight, x0: w, y0: 0, x1: w, y1: h },
    { weight: node.borderBottomWeight, x0: 0, y0: h, x1: w, y1: h },
    { weight: node.borderLeftWeight, x0: 0, y0: 0, x1: 0, y1: h },
  ];

  for (const side of sides) {
    if (side.weight <= 0) continue;
    paint.setStrokeWidth(side.weight);

    let offset = 0;
    if (align === 'INSIDE') offset = side.weight / 2;
    else if (align === 'OUTSIDE') offset = -side.weight / 2;

    canvas.drawLine(side.x0, side.y0, side.x1, side.y1, paint);
  }
}
