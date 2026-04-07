import { type INode, NodeType } from '../../host';
import { GuideElement, BannerElementType } from '../contracts/types';
import { uniformScaleForLetterbox } from '../geometry/fit';
import { getBoundsInFrame, getLayoutBoundsInFrame } from './layout-utils';
import { isEllipseOnlyClusterContainer, isGlowDecorClusterContainer } from './semantic-decor-containers';

export function depthFromBannerAncestor(n: INode, root: INode): number {
  let d = 0;
  let p: INode | null = n.parent;
  while (p && p !== root) {
    d += 1;
    p = p.parent;
  }
  return p === root ? d : 0;
}

/** Align node center to a point in frame coordinates. Like `oLD/guide-scaler.ts`: layout bounds for GROUP/RECT; abs only for ellipse/star/polygon/rotation and ellipse-only FRAME. */
export function alignVisualCenterToFramePoint(node: INode, frame: INode, targetCX: number, targetCY: number): void {
  const fb = frame.absoluteBoundingBox;
  if (
    !fb ||
    typeof fb.x !== 'number' ||
    typeof fb.y !== 'number' ||
    typeof fb.width !== 'number' ||
    typeof fb.height !== 'number'
  ) {
    return;
  }
  const rot = 'rotation' in node ? Math.abs(node.rotation ?? 0) : 0;
  const useAbsBBox =
    rot > 0.01 ||
    node.type === NodeType.Ellipse ||
    node.type === NodeType.Star ||
    node.type === NodeType.Polygon ||
    (node.type === NodeType.Frame && isEllipseOnlyClusterContainer(node));

  let cx: number;
  let cy: number;
  if (useAbsBBox) {
    const nb = 'absoluteBoundingBox' in node ? node.absoluteBoundingBox : null;
    if (
      !nb ||
      typeof nb.x !== 'number' ||
      typeof nb.y !== 'number' ||
      nb.width <= 0 ||
      nb.height <= 0
    ) {
      return;
    }
    cx = nb.x + nb.width / 2 - fb.x;
    cy = nb.y + nb.height / 2 - fb.y;
  } else {
    const lb = getLayoutBoundsInFrame(node, frame);
    if (lb.w <= 0 || lb.h <= 0) return;
    cx = lb.x + lb.w / 2;
    cy = lb.y + lb.h / 2;
  }
  const dx = targetCX - cx;
  const dy = targetCY - cy;
  if (Math.abs(dx) < 0.25 && Math.abs(dy) < 0.25) return;
  node.x = Math.round(node.x + dx);
  node.y = Math.round(node.y + dy);
}

/**
 * Age rating label: after resize/align the visual bbox (glyphs) often doesn't match layout width/height —
 * "0+" is visually not at the slot corner. Snap via absoluteBoundingBox to Remember slot edges.
 */
export function snapAgeRatingVisualToRememberSlot(
  t: INode,
  frame: INode,
  frameX: number,
  frameY: number,
  guideW: number,
  guideH: number,
  el: GuideElement
): void {
  if (!frame.absoluteBoundingBox) return;
  const b = getBoundsInFrame(t, frame);
  if (b.w < 1 || b.h < 1) return;
  const slotR = frameX + guideW;
  const slotB = frameY + guideH;
  const ra = el.rememberTextAlign;
  let dx: number;
  if (ra === 'LEFT') {
    dx = frameX - b.x;
  } else if (ra === 'CENTER') {
    dx = frameX + guideW / 2 - (b.x + b.w / 2);
  } else {
    dx = slotR - (b.x + b.w);
  }
  const dy = slotB - (b.y + b.h);
  if (Math.abs(dx) < 0.12 && Math.abs(dy) < 0.12) return;
  const capX = Math.max(guideW * 1.35, 56);
  const capY = Math.max(guideH * 1.35, 56);
  if (Math.abs(dx) > capX || Math.abs(dy) > capY) return;
  t.x = Math.round(t.x + dx);
  t.y = Math.round(t.y + dy);
}

/**
 * Master "island" metrics on the target frame (like resolveExactSessionLayout):
 * without this, font is computed from min(entire banner), and slot boxes from Cw*u / Ch*u → image/text drift.
 */
export interface RememberLayoutMetrics {
  minSide?: number;
  /** Ch * u — master area height in px; used for rememberFontRelHeight instead of full targetH */
  layoutHeight?: number;
}

export function countEllipseLeavesInSubtree(node: INode): number {
  if (node.type === NodeType.Ellipse) return 1;
  if (node.type !== NodeType.Group && node.type !== NodeType.Frame) return 0;
  let s = 0;
  for (const c of (node as any).children.filter((x: any) => !x.removed)) {
    s += countEllipseLeavesInSubtree(c as INode);
  }
  return s;
}

export function countDirectEllipseChildren(node: INode): number {
  if (!node.children || node.type === NodeType.Instance) return 0;
  let n = 0;
  for (const c of (node as any).children) {
    if ('removed' in c && c.removed) continue;
    if ((c as INode).type === NodeType.Ellipse) n += 1;
  }
  return n;
}

export function boundsOverlapPixels(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ix * iy;
}

/** Horizontal overlap fraction relative to the narrower of two boxes (for "caption over rect" stack). */
export function horizontalOverlapFraction(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const denom = Math.min(Math.max(a.w, 1e-6), Math.max(b.w, 1e-6));
  return ix / denom;
}

export function isDescendantOfFrameForAuto(node: INode, frame: INode): boolean {
  let p: INode | null = node.parent;
  while (p) {
    if (p === frame) return true;
    p = p.parent;
  }
  return false;
}

export function isAncestor(ancestor: INode, node: INode): boolean {
  let p: INode | null = node.parent;
  while (p) {
    if (p.id === ancestor.id) return true;
    p = p.parent;
  }
  return false;
}

export function depth(node: INode): number {
  let d = 0;
  let p: INode | null = node.parent;
  while (p) {
    d++;
    p = p.parent;
  }
  return d;
}

/**
 * In `other` slot: ellipses are usually multiple background glows; **cover** inflates them and on incorrect
 * slot match they visually "fly away". For ELLIPSE use contain only. Light cover only for STAR/POLYGON with clamp.
 */
export function slotUniformScaleFit(
  node: INode,
  slotType: BannerElementType,
  guideW: number,
  guideH: number,
  cw: number,
  ch: number,
  bannerAreaPx?: number,
  targetW?: number,
  targetH?: number
): number {
  const rw = Math.max(cw, 0.01);
  const rh = Math.max(ch, 0.01);
  const contain = uniformScaleForLetterbox(rw, rh, guideW, guideH, 'contain');
  if (slotType !== 'other') return contain;
  if (node.type === NodeType.Ellipse) return contain;
  if (node.type === NodeType.Star || node.type === NodeType.Polygon) {
    const cover = uniformScaleForLetterbox(rw, rh, guideW, guideH, 'cover');
    return Math.min(cover, contain * 2.75);
  }
  if (
    bannerAreaPx &&
    bannerAreaPx > 100 &&
    !isGlowDecorClusterContainer(node) &&
    (node.type === NodeType.Frame ||
      node.type === NodeType.Group ||
      node.type === NodeType.Component ||
      node.type === NodeType.Instance)
  ) {
    const na = cw * ch;
    if (na / bannerAreaPx > 0.05) {
      let factor = 0.82;
      if (targetW && targetH && targetH > targetW * 1.35) factor = 0.58;
      else if (targetW && targetH && targetH > targetW * 1.12) factor = 0.68;
      return contain * factor;
    }
  }
  return contain;
}

/**
 * Remember / strict / cross exact: master slots are the source of truth. No "hero"×0.58 and no portrait sScreen
 * (those are for built-in JSON guide and break native 9:16 matching on cross from a wide source).
 */
export function slotUniformScaleFitExactSession(
  node: INode,
  slotType: BannerElementType,
  guideW: number,
  guideH: number,
  cw: number,
  ch: number
): number {
  const rw = Math.max(cw, 0.01);
  const rh = Math.max(ch, 0.01);
  const contain = uniformScaleForLetterbox(rw, rh, guideW, guideH, 'contain');
  if (slotType !== 'other') return contain;
  if (node.type === NodeType.Ellipse) return contain;
  if (node.type === NodeType.Star || node.type === NodeType.Polygon) {
    const cover = uniformScaleForLetterbox(rw, rh, guideW, guideH, 'cover');
    return Math.min(cover, contain * 2.75);
  }
  return contain;
}
