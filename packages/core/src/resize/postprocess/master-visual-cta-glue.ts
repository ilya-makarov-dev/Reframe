/**
 * RECT button without overlap to CTA-like text: snap size/position to the nearest label.
 */

import { type INode, NodeType } from '../../host';

import type { ExactSessionPlacement } from './exact-session-types';
import { boundsOverlapPixels, looksLikeCtaLabelText } from './semantic-classifier';
import { collectAllDescendants, getBoundsInFrame, setPositionInFrame } from './layout-utils';

export function glueDetachedCtaRectangleToNearestLabel(
  frame: INode,
  placements: ExactSessionPlacement[],
  layout: { Rw: number; Rh: number; u: number; ox: number; oy: number },
  targetWidth: number,
  targetHeight: number
): void {
  const btnPl = placements.find(p => p.slotType === 'button');
  if (!btnPl?.element) return;
  const nodeById = new Map<string, INode>();
  for (const n of collectAllDescendants(frame)) nodeById.set(n.id, n);
  const btn = nodeById.get(btnPl.resultNodeId);
  if (!btn || ('removed' in btn && btn.removed) || btn.type !== NodeType.Rectangle) return;

  const texts: INode[] = [];
  const walk = (n: INode): void => {
    if (n === btn) return;
    if (n.removed) return;
    if (n.type === NodeType.Instance) return;
    if (n.type === NodeType.Text && looksLikeCtaLabelText(n, frame)) texts.push(n);
    if (n.children) {
      for (const c of n.children) walk(c);
    }
  };
  walk(frame);
  if (texts.length === 0) return;

  const logoPl = placements.find(p => p.slotType === 'logo');
  const logoNode = logoPl ? nodeById.get(logoPl.resultNodeId) : null;
  const underLogo = (t: INode): boolean => {
    if (!logoNode || logoNode.removed) return false;
    let p: INode | null = t.parent;
    while (p && p !== frame) {
      if (p.id === logoNode.id) return true;
      p = p.parent;
    }
    return false;
  };
  let labelPool = texts.filter(t => !underLogo(t));
  if (labelPool.length === 0) return;

  const btnParent = btn.parent;
  const siblingCtas = labelPool.filter(t => t.parent?.id === btnParent?.id);
  if (siblingCtas.length > 0) labelPool = siblingCtas;

  const bb = getBoundsInFrame(btn, frame);
  if (labelPool.some(t => boundsOverlapPixels(bb, getBoundsInFrame(t, frame)) >= 22)) return;

  const { Rw, Rh, u, ox, oy } = layout;
  const el = btnPl.element;
  const wr = el.widthRatio ?? 0;
  const hr = el.heightRatio ?? 0;
  const slotCx = ((el.left ?? 0) + wr / 2) * Rw * u + ox;
  const slotCy = ((el.top ?? 0) + hr / 2) * Rh * u + oy;

  let best: INode | null = null;
  let bestD = Infinity;
  let bestScore = -Infinity;

  const ctaStrengthScore = (t: INode): number => {
    const raw = (t.characters ?? '').trim();
    const letters = raw.replace(/[^a-zA-Z\u0400-\u04FF]/g, '');
    if (letters.length === 0) return 0;
    const upper = letters.replace(/[^A-Z\u0400-\u052F]/g, '').length;
    const upperFrac = upper / Math.max(1, letters.length);
    const words = raw.split(/\s+/).filter(Boolean).length;
    const shortBoost = raw.length <= 18 ? 0.6 : raw.length <= 26 ? 0.25 : 0;
    const wordPenalty = Math.min(1, words / 4);
    return upperFrac * 1.25 + shortBoost - wordPenalty * 0.15;
  };
  for (const t of labelPool) {
    const tb = getBoundsInFrame(t, frame);
    const d = Math.hypot(tb.x + tb.w / 2 - slotCx, tb.y + tb.h / 2 - slotCy);
    const s = ctaStrengthScore(t);
    if (
      d < bestD - 0.5 ||
      (Math.abs(d - bestD) < 28 && s > bestScore + 1e-6) ||
      (Math.abs(d - bestD) < 4 && s > bestScore + 1e-6)
    ) {
      bestD = d;
      best = t;
      bestScore = s;
    }
  }
  if (!best) return;
  const maxGlue = Math.max(targetWidth, targetHeight) * 0.72;
  if (bestD > maxGlue) return;

  const tb = getBoundsInFrame(best, frame);
  const padX = Math.max(14, Math.min(36, tb.w * 0.22));
  const padY = Math.max(10, Math.min(28, tb.h * 0.5));
  let nw = Math.max(bb.w, tb.w + padX * 2);
  let nh = Math.max(bb.h, tb.h + padY * 2);
  nw = Math.min(Math.round(nw), targetWidth - 2);
  nh = Math.min(Math.round(nh), targetHeight - 2);
  nw = Math.max(nw, 8);
  nh = Math.max(nh, 8);
  try {
    btn.resize(nw, nh);
  } catch (_) {}

  const bb2 = getBoundsInFrame(btn, frame);
  const tcx = tb.x + tb.w / 2;
  const tcy = tb.y + tb.h / 2;
  let nx = Math.round(tcx - bb2.w / 2);
  let ny = Math.round(tcy - bb2.h / 2);
  nx = Math.max(0, Math.min(nx, targetWidth - bb2.w));
  ny = Math.max(0, Math.min(ny, targetHeight - bb2.h));
  try {
    setPositionInFrame(btn, frame, nx, ny);
  } catch (_) {}

  const par = best.parent;
  if (par && btn.parent === par && par.insertChild) {
    try {
      const idx = par.children ? Array.from(par.children).indexOf(best) : -1;
      if (idx >= 0) par.insertChild(idx, btn);
    } catch (_) {}
  }
}
