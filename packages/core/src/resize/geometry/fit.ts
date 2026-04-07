import type { Rect } from './types';

export type LetterboxFit = 'cover' | 'contain';

export function uniformScaleToFitWidth(srcW: number, dstW: number): number {
  return dstW / Math.max(srcW, 0.01);
}

export function uniformScaleToFitHeight(srcH: number, dstH: number): number {
  return dstH / Math.max(srcH, 0.01);
}

export function uniformScaleForLetterbox(
  srcW: number, srcH: number, dstW: number, dstH: number, fit: LetterboxFit
): number {
  const sw = Math.max(srcW, 0.01);
  const sh = Math.max(srcH, 0.01);
  return fit === 'cover'
    ? Math.max(dstW / sw, dstH / sh)
    : Math.min(dstW / sw, dstH / sh);
}

export interface LetterboxOffsets {
  u: number;
  scaledW: number;
  scaledH: number;
  offX: number;
  offY: number;
}

export function centeredLetterboxOffsets(
  srcW: number, srcH: number, dstW: number, dstH: number, fit: LetterboxFit
): LetterboxOffsets {
  const u = uniformScaleForLetterbox(srcW, srcH, dstW, dstH, fit);
  const scaledW = srcW * u;
  const scaledH = srcH * u;
  return { u, scaledW, scaledH, offX: (dstW - scaledW) / 2, offY: (dstH - scaledH) / 2 };
}

export function rectCenterLocal(r: Rect): { cx: number; cy: number } {
  return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
}

export function translationToAlignCenters(
  inner: Rect, targetCX: number, targetCY: number
): { dx: number; dy: number } {
  const { cx, cy } = rectCenterLocal(inner);
  return { dx: targetCX - cx, dy: targetCY - cy };
}
