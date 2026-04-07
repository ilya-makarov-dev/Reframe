/**
 * Heuristics for CTA (button rects, labels, grouping) and logo candidates (corner bias, lockup structure).
 */

import { type INode, NodeType } from '../../host';
import {
  uniformScaleForLetterbox,
  uniformScaleToFitWidth
} from '../geometry/fit';
import { getBoundsInFrame, collectAllDescendants } from './layout-utils';
import { hasVisibleImageFill, isEffectivelyNoFill, hasVisibleGeometryStroke } from './semantic-node-paint';
import { boundsOverlapPixels } from './semantic-slot-geometry';

export function getButtonFitSizeInFrame(node: INode, _frame: INode): { cw: number; ch: number } | null {
  if (node.type === NodeType.Instance || node.type === NodeType.Component || node.type === NodeType.Frame || node.type === NodeType.Group) {
    return { cw: node.width, ch: node.height };
  }
  return null;
}

export function getBestButtonHitRectBoundsInNode(
  root: INode,
  frame: INode
): { x: number; y: number; w: number; h: number } | null {
  const b = getBoundsInFrame(root, frame);
  if (root.type === NodeType.Rectangle) return b;
  if (root.children) {
    let best: { node: INode; area: number } | null = null;
    for (const child of root.children) {
      if (child.type === NodeType.Rectangle) {
        const area = child.width * child.height;
        if (!best || area > best.area) best = { node: child, area };
      }
    }
    if (best) return getBoundsInFrame(best.node, frame);
  }
  return b;
}

/**
 * Label above rect (overlap~0): as in `oLD/guide-scaler.ts:isTextStackedAboveRectCta(br, bt, frameH)`.
 */
function isRectBoundsStackedAboveTextBounds(
  rectB: { x: number; y: number; w: number; h: number },
  textB: { x: number; y: number; w: number; h: number },
  frameH: number
): boolean {
  const gap = rectB.y - (textB.y + textB.h);
  const maxGap = Math.max(10, frameH * 0.16);
  if (gap < -8 || gap > maxGap) return false;
  const ix = Math.max(0, Math.min(rectB.x + rectB.w, textB.x + textB.w) - Math.max(rectB.x, textB.x));
  const denom = Math.min(Math.max(rectB.w, 1e-6), Math.max(textB.w, 1e-6));
  return ix / denom >= 0.26;
}

/**
 * RECT + TEXT in same GROUP/FRAME: don't break slot — hoist wrapper as a whole.
 * Port of `oLD/guide-scaler.ts:getCtaGroupWrapper`: anchor to RECT/TEXT + overlap, without "parent 5% larger".
 */
export function getCtaGroupWrapper(node: INode, frame: INode): INode | null {
  const anchorRect = (node.type === NodeType.Rectangle || node.type === NodeType.Vector || node.type === NodeType.Frame || node.type === NodeType.Instance) ? node : null;
  const anchorText = node.type === NodeType.Text ? node : null;

  const frameW = Math.max(frame.width, 1);
  const frameH = Math.max(frame.height, 1);

  const ctaTextLooks = (t: INode): boolean => {
    if (looksLikeCtaLabelText(t, frame)) return true;
    const raw = (t.characters ?? '').trim();
    return raw.length > 0 && raw.length <= 40;
  };

  let cur: INode | null = node.parent;
  while (cur && cur !== frame) {
    if (cur.type !== NodeType.Group && cur.type !== NodeType.Frame) {
      cur = cur.parent;
      continue;
    }

    if (anchorRect) {
      const br = getBoundsInFrame(anchorRect, frame);
      if (br.w <= 0 || br.h <= 0) {
        cur = cur.parent;
        continue;
      }
      if (!(br.w >= 4 && br.h >= 4 && looksLikeButtonHitRectBounds(br, frameW, frameH))) {
        cur = cur.parent;
        continue;
      }

      let found = false;
      for (const dn of collectAllDescendants(cur as INode)) {
        if (dn.type !== NodeType.Text) continue;
        if ('removed' in dn && dn.removed) continue;
        const bt = dn;
        if (!ctaTextLooks(bt)) continue;

        const btb = getBoundsInFrame(bt, frame);
        const ov = boundsOverlapPixels(br, btb);
        const rectArea = Math.max(br.w * br.h, 1);
        const overlapFrac = ov / rectArea;
        if (overlapFrac >= 0.08) {
          found = true;
          break;
        }
        if (isRectBoundsStackedAboveTextBounds(br, btb, frameH)) {
          found = true;
          break;
        }
      }

      if (found) return cur;
    } else if (anchorText) {
      if (!ctaTextLooks(anchorText)) {
        cur = cur.parent;
        continue;
      }

      const tb = getBoundsInFrame(anchorText, frame);
      let found = false;
      for (const dn of collectAllDescendants(cur as INode)) {
        if (dn === anchorText) continue;
        const validPillType = dn.type === NodeType.Rectangle || dn.type === NodeType.Vector || dn.type === NodeType.Frame || dn.type === NodeType.Component || dn.type === NodeType.Instance;
        if (!validPillType) continue;
        if ('removed' in dn && dn.removed) continue;

        const r = dn as INode;
        const rb = getBoundsInFrame(r, frame);
        if (!(rb.w >= 4 && rb.h >= 4 && looksLikeButtonHitRectBounds(rb, frameW, frameH))) continue;

        const ov = boundsOverlapPixels(rb, tb);
        const rectArea = Math.max(rb.w * rb.h, 1);
        const overlapFrac = ov / rectArea;
        // Text is inside or heavily overlays the pill.
        if (overlapFrac >= 0.08 || isRectBoundsStackedAboveTextBounds(rb, tb, frameH)) {
          found = true;
          break;
        }
      }
      if (found) return cur;
    } else {
      cur = cur.parent;
      continue;
    }

    cur = cur.parent;
  }

  return null;
}

/**
 * Rectangle (or any shape) stacked with text — typical for CTA.
 */
export function isShapeBoundsStackedWithTextBounds(
  shapeB: { x: number; y: number; w: number; h: number },
  textB: { x: number; y: number; w: number; h: number },
  frameH: number
): boolean {
  const overlap = boundsOverlapPixels(shapeB, textB);
  if (overlap > 0) {
    const textArea = textB.w * textB.h;
    if (overlap / Math.max(textArea, 1) > 0.15) return true;
  }

  const gap = shapeB.y - (textB.y + textB.h);
  const maxGap = Math.max(10, frameH * 0.16);
  if (gap >= -8 && gap <= maxGap) {
    const ix = Math.max(0, Math.min(shapeB.x + shapeB.w, textB.x + textB.w) - Math.max(shapeB.x, textB.x));
    const denom = Math.min(Math.max(shapeB.w, 1e-6), Math.max(textB.w, 1e-6));
    if (ix / denom >= 0.26) return true;
  }
  return false;
}

/** CTA label length — no dictionary, metrics only. */
const BUTTON_LABEL_LEN_MIN = 2;
const BUTTON_LABEL_LEN_MAX = 52;
/** Headlines usually in top third; CTA labels — lower (normalized Y center). */
const CTA_LABEL_MIN_CENTER_Y_NORM = 0.33;

/**
 * Text looks like a single-line CTA label in **banner coordinates**:
 * length, single line, not age-rating, Y zone, reasonable fontSize.
 * No substring/language checks — only measurable node properties.
 */
export function looksLikeCtaLabelText(t: INode, frame: INode): boolean {
  const raw = (t.characters ?? '').trim();
  if (raw.length < BUTTON_LABEL_LEN_MIN || raw.length > BUTTON_LABEL_LEN_MAX) return false;
  if (raw.includes('\n')) return false;
  if (/^\s*\d{1,2}\+\s*$/.test(raw)) return false;
  const b = getBoundsInFrame(t, frame);
  const H = Math.max(frame.height, 1);
  const cy = (b.y + b.h / 2) / H;
  if (cy < CTA_LABEL_MIN_CENTER_Y_NORM) return false;
  if (typeof t.fontSize === 'number') {
    if (t.fontSize < 10 || t.fontSize > 96) return false;
  }
  return true;
}

/**
 * Subtree has compact TEXT **geometrically** fitting within root bbox
 * — typical "icon + label", no dictionary; for relax see `subtreeHasVisibleImageFill`.
 */
export function subtreeHasButtonChromeLabel(root: INode, frame: INode): boolean {
  const rootB = getBoundsInFrame(root, frame);
  const rootArea = Math.max(rootB.w * rootB.h, 1);
  const walk = (n: INode): boolean => {
    if (n.type === NodeType.Text) {
      const t = n;
      const raw = (t.characters ?? '').trim();
      if (raw.length < BUTTON_LABEL_LEN_MIN || raw.length > BUTTON_LABEL_LEN_MAX) return false;
      if (raw.includes('\n')) return false;
      if (/^\s*\d{1,2}\+\s*$/.test(raw)) return false;
      const tb = getBoundsInFrame(t, frame);
      const ix = Math.max(tb.x, rootB.x);
      const iy = Math.max(tb.y, rootB.y);
      const iw = Math.min(tb.x + tb.w, rootB.x + rootB.w) - ix;
      const ih = Math.min(tb.y + tb.h, rootB.y + rootB.h) - iy;
      if (iw <= 0 || ih <= 0) return false;
      const overlap = iw * ih;
      const ta = Math.max(tb.w * tb.h, 1);
      if (overlap / ta < 0.42) return false;
      if (ta / rootArea > 0.92) return false;
      return true;
    }
    if (n.children) {
      for (const c of n.children) {
        if (walk(c as INode)) return true;
      }
    }
    return false;
  };
  return walk(root);
}

export function subtreeHasCtaLabelText(root: INode, frame: INode): boolean {
  if (root.type === NodeType.Text && looksLikeCtaLabelText(root, frame)) return true;
  if (root.children) {
    for (const child of root.children) {
      if (subtreeHasCtaLabelText(child, frame)) return true;
    }
  }
  return false;
}

/**
 * Don't traverse INSTANCE — text inside may be inaccessible.
 */
export function masterButtonSubtreeHasCtaLabelText(master: INode, frame: INode): boolean {
  const walk = (n: INode): boolean => {
    if (n.removed) return false;
    if (n.type === NodeType.Text) return looksLikeCtaLabelText(n, frame);
    if (n.type === NodeType.Instance) return false;
    if (n.children) {
      for (const c of n.children) {
        if (walk(c)) return true;
      }
    }
    return false;
  };
  return walk(master);
}

/**
 * Button hit rect by bounds (as in `oLD/guide-scaler.ts:looksLikeButtonHitRect`), not 1px-line / decor.
 * Physical button rect: cannot be too thin or too large.
 */
export function looksLikeButtonHitRectBounds(
  br: { x: number; y: number; w: number; h: number },
  frameW: number,
  frameH: number
): boolean {
  const H = Math.max(frameH, 1);
  const W = Math.max(frameW, 1);
  if (br.h < Math.max(6, H * 0.015)) return false;
  if (br.h > H * 0.48) return false;
  const ar = br.w / Math.max(br.h, 1);
  if (ar < 0.2) return false;
  // Too large rects (heroes/backgrounds) — not buttons
  if (br.w * br.h > W * H * 0.25) return false;
  return true;
}

/**
 * Like `oLD/guide-scaler.ts:subtreeHasCtaLabelText`: pill-RECT + CTA text with overlap — button stack.
 */
export function subtreeHasCtaRectTextOverlapStack(root: INode, frame: INode): boolean {
  if (!root || ('removed' in root && root.removed)) return false;

  const rects: { b: { x: number; y: number; w: number; h: number } }[] = [];
  const texts: INode[] = [];

  const collect = (n: INode): void => {
    if ('removed' in n && n.removed) return;
    if (n.type === NodeType.Text) {
      if (looksLikeCtaLabelText(n, frame)) texts.push(n);
      return;
    }
    if (n.type === NodeType.Rectangle) {
      const b = getBoundsInFrame(n, frame);
      if (b.w > 0 && b.h > 0 && looksLikeButtonHitRectBounds(b, frame.width, frame.height)) {
        rects.push({ b });
      }
    }
    if (n.children) {
      for (const c of n.children) {
        if (!c.removed) collect(c);
      }
    }
  };

  collect(root);
  if (rects.length === 0 || texts.length === 0) return false;

  for (const t of texts) {
    const tb = getBoundsInFrame(t, frame);
    if (tb.w <= 0 || tb.h <= 0) continue;
    const textArea = Math.max(1, tb.w * tb.h);
    for (const r of rects) {
      const ov = boundsOverlapPixels(r.b, tb);
      if (ov <= 0) continue;
      const rectArea = Math.max(1, r.b.w * r.b.h);
      const fracText = ov / textArea;
      const fracRect = ov / rectArea;
      if (fracText >= 0.18 && fracRect >= 0.05) return true;
    }
  }
  return false;
}

/**
 * Button slot often matches TEXT ("button text"); gradient is then on parent FRAME, without child RECT.
 * Promote to shell, otherwise scale/hoist attach to text and the filled "button" container is lost.
 */
export function promoteButtonPlacementToChromeRoot(node: INode, frame: INode): INode {
  if (node.type === NodeType.Instance || node.type === NodeType.Component) return node;

  const wrap = getCtaGroupWrapper(node, frame);
  if (wrap) return wrap;

  const W = Math.max(frame.width, 1);
  const H = Math.max(frame.height, 1);

  if (node.type === NodeType.Frame || node.type === NodeType.Group) {
    const pill = getBestButtonHitRectBoundsInNode(node, frame);
    if (pill && looksLikeButtonHitRectBounds(pill, W, H)) return node;
  }

  if (node.type === NodeType.Rectangle) {
    const p = node.parent;
    if (p && (p.type === NodeType.Frame || p.type === NodeType.Group || p.type === NodeType.Component)) {
      const shell = p as INode;
      const pill = getBestButtonHitRectBoundsInNode(shell, frame);
      if (pill && looksLikeButtonHitRectBounds(pill, W, H)) return shell;
    }
  }

  if (node.type === NodeType.Text || node.type === NodeType.Line) {
    let cur: INode | null = node.parent;
    while (cur && cur !== frame) {
      if (cur.type === NodeType.Frame || cur.type === NodeType.Group || cur.type === NodeType.Component) {
        const shell = cur as INode;
        const pill = getBestButtonHitRectBoundsInNode(shell, frame);
        if (pill && looksLikeButtonHitRectBounds(pill, W, H)) return shell;
        const sb = getBoundsInFrame(shell, frame);
        if (looksLikeButtonHitRectBounds(sb, W, H) && subtreeHasCtaLabelText(shell, frame)) return shell;
      }
      cur = cur.parent;
    }
  }

  return node;
}

export function looksLikeButtonHitRect(node: INode, frame: INode, areaFrame: number): boolean {
  if (node.type !== NodeType.Rectangle) return false;
  const area = node.width * node.height;
  if (area < 200 || area > areaFrame * 0.2) return false;
  if (isEffectivelyNoFill(node) && !hasVisibleGeometryStroke(node)) return false;
  return true;
}

export function findDetachedCTARectTextPair(
  frame: INode,
  areaFrame: number
): { rect: INode; text: INode } | null {
  const rects: INode[] = [];
  const texts: INode[] = [];
  for (const n of collectAllDescendants(frame)) {
    if (looksLikeButtonHitRect(n, frame, areaFrame)) rects.push(n);
    if (n.type === NodeType.Text && looksLikeCtaLabelText(n, frame)) texts.push(n);
  }
  for (const r of rects) {
    for (const t of texts) {
      if (isShapeBoundsStackedWithTextBounds(getBoundsInFrame(r, frame), getBoundsInFrame(t, frame), frame.height)) return { rect: r, text: t };
    }
  }
  return null;
}

export function removeDetachedCTALabelSiblings(resultNode: INode, _frame: INode): void {
  if (!resultNode.parent) return;
  const p = resultNode.parent;
  const text = resultNode.characters;
  if (!text) return;
  for (const child of p!.children!) {
    if (child !== resultNode && child.type === NodeType.Text && child.characters === text) {
      child.remove!();
    }
  }
}

export function logoCornerDistanceNorm(
  b: { x: number; y: number; w: number; h: number },
  W: number,
  H: number
): number {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = Math.min(cx, W - cx) / W;
  const dy = Math.min(cy, H - cy) / H;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Legal text or small captions.
 */
export function isLegalTextNode(node: INode): boolean {
  if (node.type !== NodeType.Text) return false;
  const t = node;
  const raw = (t.characters || '').trim();
  if (raw.length > 55) return true; // Long text in corner — it's a disclaimer
  if (typeof t.fontSize === 'number' && t.fontSize < 11) return true;
  return false;
}

/**
 * Technical dividers or lines.
 */
export function isTechnicalDivider(node: INode, frame: INode): boolean {
  const b = getBoundsInFrame(node, frame);
  const ar = b.w / Math.max(b.h, 1);
  if (ar > 15 || ar < 0.06) return true; // Too thin — these are lines
  return false;
}

/**
 * Compact lockup in top/peripheral zone of banner.
 * No dictionaries: corner, area share, Y center.
 */
export function isLikelyCornerLogoLockup(
  node: INode,
  frame: INode,
  b: { x: number; y: number; w: number; h: number },
  areaFrame: number
): boolean {
  const H = Math.max(frame.height, 1);
  const cy = (b.y + b.h / 2) / H;
  const areaFrac = (b.w * b.h) / Math.max(areaFrame, 1);

  if (areaFrac >= 0.15) return false; // Logo can't be larger than 15% of area
  if (isLegalTextNode(node)) return false; // Small text — not a logo

  const corner = logoCornerDistanceNorm(b, frame.width, frame.height);
  if (corner < 0.28) return true; // Strong corner signal

  // Center-top Logo (Header)
  const cx = (b.x + b.w / 2) / Math.max(frame.width, 1);
  if (Math.abs(cx - 0.5) < 0.1 && cy < 0.18) return true;

  if (node.type === NodeType.Instance) return areaFrac < 0.12;

  return false;
}

export function logoInstanceStructuralBoost(node: INode, _area: number, _areaFrame: number): number {
  if (node.type === NodeType.Instance) return 50;
  return 0;
}

export function logoLockupStructureBoost(node: INode, _areaPx: number, _areaFrame: number): number {
  if (node.type !== NodeType.Frame && node.type !== NodeType.Group && node.type !== NodeType.Instance) return 0;
  let hasImg = false;
  let hasText = false;
  if (node.children) {
    for (const child of node.children) {
      if (child.type === NodeType.Text) hasText = true;
      if (hasVisibleImageFill(child)) hasImg = true;
    }
  }
  return hasImg && hasText ? 40 : 0;
}

export function looksLikeLogoTypographyText(t: INode): boolean {
  const s = (t.characters || '').trim();
  // Logo-like text nodes are short bold labels in a corner,
  // provided they are not a button or legal text.
  return s.length >= 2 && s.length <= 15 && !s.includes('\n');
}

export function isCornerPillNotLogo(node: INode, _frame: INode, areaFrame: number): boolean {
  const area = node.width * node.height;
  if (area < areaFrame * 0.005) return true;
  return false;
}

export function isLikelyWideHeroChunkNotLogo(node: INode, frame: INode, _areaFrame: number): boolean {
  if (node.width > frame.width * 0.6) return true;
  return false;
}

export function logoGraphicCandidateScore(node: INode, frame: INode, areaFrame: number): number {
  const b = getBoundsInFrame(node, frame);
  const dist = logoCornerDistanceNorm(b, frame.width, frame.height);
  const areaFrac = (b.w * b.h) / Math.max(areaFrame, 1);

  let score = (1.0 - dist) * 100;

  // Type bonuses
  if (node.type === NodeType.Instance || node.type === NodeType.Component) score += 50;
  if (hasVisibleImageFill(node)) score += 40;

  // Center-top (header)
  const cx = (b.x + b.w / 2) / Math.max(frame.width, 1);
  const cy = (b.y + b.h / 2) / Math.max(frame.height, 1);
  if (Math.abs(cx - 0.5) < 0.08 && cy < 0.15) score += 60;

  // Penalties
  if (areaFrac > 0.15) score -= 400; // Too large — not a logo
  if (isLegalTextNode(node)) score -= 500; // Legal text — definitely not a logo
  if (isTechnicalDivider(node, frame)) score -= 300; // Lines — not a logo

  if (isCornerPillNotLogo(node, frame, areaFrame)) score -= 60;
  if (isLikelyWideHeroChunkNotLogo(node, frame, areaFrame)) score -= 80;

  return score;
}

export function tryPickLogoNode(frame: INode, areaFrame: number): INode | null {
  let best: { node: INode; score: number } | null = null;
  const candidates = collectAllDescendants(frame).filter(n => {
    if (n === frame) return false;
    if (n.type === NodeType.Rectangle || n.type === NodeType.Vector || n.type === NodeType.Instance || n.type === NodeType.Frame || n.type === NodeType.Group) {
      if (hasVisibleImageFill(n)) return true;
      if (n.type === NodeType.Instance || n.type === NodeType.Frame || n.type === NodeType.Group) return true;
    }
    return false;
  });

  for (const c of candidates) {
    const s = logoGraphicCandidateScore(c, frame, areaFrame);
    if (!best || s > best.score) best = { node: c, score: s };
  }
  return best && best.score > 30 ? best.node : null;
}

export function tryPickLogoDesperateFallback(_frame: INode, _areaFrame: number): INode | null {
  return null;
}

export function tryPickLogoLastResortEdgeInstance(_frame: INode): INode | null {
  return null;
}

export function tryPickLogoTextNode(frame: INode): INode | null {
  for (const n of collectAllDescendants(frame)) {
    if (n.type === NodeType.Text && looksLikeLogoTypographyText(n)) return n;
  }
  return null;
}

/**
 * Button in slot: min(guideW/cw, guideH/ch) on ultra-wide/low banners gives unreadable CTA.
 * Raise scale until post-scale height becomes a reasonable slot fraction (fitting by width).
 */
export function buttonUniformScaleForSlot(
  guideW: number,
  guideH: number,
  cw: number,
  ch: number,
  targetFrameHeight: number
): number {
  if (cw <= 0 || ch <= 0 || guideW <= 0 || guideH <= 0) return 1;
  let scale = uniformScaleForLetterbox(cw, ch, guideW, guideH, 'contain');
  const minHFrac = targetFrameHeight < 480 ? 0.34 : 0.24;
  const minBtnH = Math.max(26, guideH * minHFrac);
  if (ch * scale < minBtnH) {
    scale = uniformScaleForLetterbox(cw, ch, guideW, minBtnH, 'contain');
  }
  if (guideW > guideH * 2.6 && guideH > 16) {
    const floorH = Math.max(minBtnH, guideH * 0.4);
    const sFloor = uniformScaleForLetterbox(cw, ch, guideW, floorH, 'contain');
    scale = Math.max(scale, sFloor);
    scale = Math.min(scale, uniformScaleToFitWidth(cw, guideW));
  }
  return scale;
}
