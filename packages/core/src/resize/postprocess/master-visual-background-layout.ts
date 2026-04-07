/**
 * Background slot resolution, subtree sync, orphan backdrop stretch, cover-from-clone, child alignment.
 */

import { type INode, NodeType } from '../../host';

import { stretchBackgroundNonUniformToFill } from '../scaling/scaler';
import type { ExactSessionPlacement } from './exact-session-types';
import {
  alignVisualCenterToFramePoint,
  countDirectEllipseChildren,
  countEllipseLeavesInSubtree,
  nodeOrDescendantInSet
} from './semantic-classifier';
import { getBoundsInFrame, setPositionInFrame, getLayoutBoundsInFrame } from './layout-utils';
import { tryResolveNodeById } from './figma-node-resolve';
import { scaleChildrenNonUniform, scaleBackgroundSubtreeEffects } from './master-visual-background-transform';

export function clampBackgroundVisualBoundsToTarget(
  node: INode,
  frame: INode,
  targetWidth: number,
  targetHeight: number
): void {
  try {
    const b1 = getBoundsInFrame(node, frame);
    if (b1.w <= 0 || b1.h <= 0) return;
    const sx = targetWidth / Math.max(b1.w, 1);
    const sy = targetHeight / Math.max(b1.h, 1);
    // Avoid scaleChildrenNonUniform when sx/sy are far from 1 (e.g. 4k+ px drift).
    if (sx > 1.06 || sx < 0.94 || sy > 1.06 || sy < 0.94) {
      return;
    }
    if (Math.abs(sx - 1) > 0.02 || Math.abs(sy - 1) > 0.02) {
      try {
        scaleChildrenNonUniform(node, sx, sy);
      } catch (_) {}
      try {
        if (node.resize) {
          node.resize(
            Math.max(1, Math.round((node.width ?? targetWidth) * sx)),
            Math.max(1, Math.round((node.height ?? targetHeight) * sy))
          );
        }
      } catch (_) {}
    }
    const b2 = getBoundsInFrame(node, frame);
    node.x = Math.round(node.x - b2.x);
    node.y = Math.round(node.y - b2.y);
  } catch (_) {}
}

export function clampBackgroundVisualBoundsToSlot(
  node: INode,
  frame: INode,
  slotX: number,
  slotY: number,
  slotW: number,
  slotH: number
): void {
  try {
    const b1 = getBoundsInFrame(node, frame);
    if (b1.w <= 0 || b1.h <= 0) return;
    const sx = slotW / Math.max(b1.w, 1);
    const sy = slotH / Math.max(b1.h, 1);
    if (Math.abs(sx - 1) > 0.02 || Math.abs(sy - 1) > 0.02) {
      if (node.type === NodeType.Frame && node.layoutMode !== undefined) {
        try {
          node.layoutMode = 'NONE';
        } catch (_) {}
      }
      try {
        if (node.resize) {
          node.resize(
            Math.max(1, Math.round((node.width ?? slotW) * sx)),
            Math.max(1, Math.round((node.height ?? slotH) * sy))
          );
        }
      } catch (_) {}
    }
    const b2 = getBoundsInFrame(node, frame);
    node.x = Math.round(node.x + (slotX - b2.x));
    node.y = Math.round(node.y + (slotY - b2.y));
  } catch (_) {}
}

export function pickCanonicalBackgroundPlacement(
  placements: ExactSessionPlacement[],
  targetWidth: number,
  targetHeight: number
): ExactSessionPlacement | null {
  const bg = placements.filter(
    p => p.slotType === 'background' && p.element.fill === true && !!p.masterSourceNodeId
  );
  if (bg.length === 0) return null;
  let best: ExactSessionPlacement | null = null;
  let bestScore = -Infinity;
  for (const p of bg) {
    const m = p.masterSourceNodeId ? tryResolveNodeById(p.masterSourceNodeId) : null;
    const hasChildren = !!(m && m.children && m.children.length > 0);
    const ellipseCount = m ? countEllipseLeavesInSubtree(m) : 0;
    const directEllipseCount = m ? countDirectEllipseChildren(m) : 0;
    const w = m ? Math.max(m.width ?? 0, 0) : 0;
    const h = m ? Math.max(m.height ?? 0, 0) : 0;
    const area = w * h;
    let rootFrameArea = Math.max(area, 1);
    let nearestFrameW = 1;
    let nearestFrameH = 1;
    if (m) {
      let q: INode | null = m.parent;
      let outerFrame: INode | null = null;
      while (q) {
        if (q.type === NodeType.Frame) outerFrame = q;
        if ((q.type as string) === 'PAGE') break;
        q = q.parent;
      }
      if (outerFrame) {
        rootFrameArea = Math.max(outerFrame.width * outerFrame.height, 1);
        nearestFrameW = Math.max(outerFrame.width, 1);
        nearestFrameH = Math.max(outerFrame.height, 1);
      }
    }
    const areaRatio = area / rootFrameArea;
    const fullBleedBonus = areaRatio >= 0.65 ? 18_000_000_000 : 0;
    const midLayerBonus = areaRatio >= 0.22 && areaRatio < 0.65 ? 2_000_000_000 : 0;
    const tinyDecorPenalty = areaRatio < 0.14 ? 10_000_000_000 : 0;
    const projected = p.masterSourceNodeId
      ? resolveBackgroundSlotFromMasterNodeToTarget(p.masterSourceNodeId, targetWidth, targetHeight)
      : null;
    let projectionPenalty = 0;
    if (projected) {
      const wr = projected.w / Math.max(targetWidth, 1);
      const hr = projected.h / Math.max(targetHeight, 1);
      if (wr > 1.15 || hr > 1.15 || wr < 0.05 || hr < 0.05) {
        projectionPenalty = 3_000_000_000;
      }
    }
    const masterAspect = nearestFrameW / nearestFrameH;
    const targetAspect = targetWidth / Math.max(targetHeight, 1);
    const aspectPenalty =
      Math.abs(masterAspect - targetAspect) / Math.max(Math.min(masterAspect, targetAspect), 1e-6) > 0.25
        ? 4_000_000_000
        : 0;
    const score =
      fullBleedBonus +
      midLayerBonus -
      tinyDecorPenalty +
      directEllipseCount * 120_000_000 +
      ellipseCount * 60_000_000 +
      (hasChildren ? 400_000_000 : 0) -
      projectionPenalty -
      aspectPenalty;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

export function resolveBackgroundSlotFromMasterNodeLive(
  masterNodeId: string,
  Rw: number,
  Rh: number,
  u: number,
  ox: number,
  oy: number,
  targetWidth: number,
  targetHeight: number
): { x: number; y: number; w: number; h: number } | null {
  const m = tryResolveNodeById(masterNodeId);
  if (!m || !m.parent) return null;
  const parent = m.parent;
  const pw = Math.max(parent.width ?? 0, 1);
  const ph = Math.max(parent.height ?? 0, 1);
  const bx = m.x ?? 0;
  const by = m.y ?? 0;
  const bw = m.width ?? 0;
  const bh = m.height ?? 0;
  if (bw <= 0 || bh <= 0) return null;
  const left = bx / pw;
  const top = by / ph;
  const wr = bw / pw;
  const hr = bh / ph;
  const w = Math.max(1, Math.round(wr * Rw * u));
  const h = Math.max(1, Math.round(hr * Rh * u));
  const x = Math.max(0, Math.min(left * Rw * u + ox, targetWidth - w));
  const y = Math.max(0, Math.min(top * Rh * u + oy, targetHeight - h));
  return { x, y, w, h };
}

export function resolveBackgroundSlotFromMasterNodeToTarget(
  masterNodeId: string,
  targetWidth: number,
  targetHeight: number
): { x: number; y: number; w: number; h: number } | null {
  const m = tryResolveNodeById(masterNodeId);
  if (!m) return null;

  let rootFrame: INode | null = null;
  let p: INode | null = m.parent;
  while (p) {
    if (p.type === NodeType.Frame) rootFrame = p;
    if ((p.type as string) === 'PAGE') break;
    p = p.parent;
  }
  if (!rootFrame) return null;

  let lx = m.x ?? 0;
  let ly = m.y ?? 0;
  let up: INode | null = m.parent;
  while (up && up !== rootFrame) {
    lx += up.x ?? 0;
    ly += up.y ?? 0;
    up = up.parent;
  }
  const lw = m.width ?? 0;
  const lh = m.height ?? 0;
  if (lw <= 0 || lh <= 0 || rootFrame.width <= 0 || rootFrame.height <= 0) return null;

  const nx = lx / rootFrame.width;
  const ny = ly / rootFrame.height;
  const nw = lw / rootFrame.width;
  const nh = lh / rootFrame.height;

  const x = Math.round(nx * targetWidth);
  const y = Math.round(ny * targetHeight);
  const w = Math.max(1, Math.round(nw * targetWidth));
  const h = Math.max(1, Math.round(nh * targetHeight));
  return { x, y, w, h };
}

export function syncSubtreeLayoutByMasterIndex(resultNode: INode, masterNode: INode): void {
  if (!resultNode.children || !masterNode.children) return;
  const mW = Math.max(masterNode.width, 1);
  const mH = Math.max(masterNode.height, 1);
  const rW = Math.max(resultNode.width, 1);
  const rH = Math.max(resultNode.height, 1);
  const sx = rW / mW;
  const sy = rH / mH;

  const rKids = resultNode.children!.filter(c => !c.removed);
  const mKids = masterNode.children!.filter(c => !c.removed);
  const len = Math.min(rKids.length, mKids.length);
  for (let i = 0; i < len; i++) {
    const r = rKids[i] as INode;
    const m = mKids[i] as INode;
    try {
      if (r.resize) {
        r.resize(
          Math.max(1, Math.round((m.width ?? 1) * sx)),
          Math.max(1, Math.round((m.height ?? 1) * sy))
        );
      }
    } catch (_) {}
    try {
      r.x = Math.round((m.x ?? 0) * sx);
      r.y = Math.round((m.y ?? 0) * sy);
      if (r.rotation !== undefined && m.rotation !== undefined) {
        r.rotation = m.rotation;
      }
    } catch (_) {}
    syncSubtreeLayoutByMasterIndex(r, m);
  }
}

export function applyBackgroundFromMasterAbsolute(
  resultNode: INode,
  masterNodeId: string,
  frame: INode,
  targetWidth: number,
  targetHeight: number
): void {
  const master = tryResolveNodeById(masterNodeId);
  if (!master) return;
  let rootFrame: INode | null = null;
  let p: INode | null = master.parent;
  while (p) {
    if (p.type === NodeType.Frame) rootFrame = p;
    if ((p.type as string) === 'PAGE') break;
    p = p.parent;
  }
  const slot = resolveBackgroundSlotFromMasterNodeToTarget(masterNodeId, targetWidth, targetHeight);
  if (!slot || !rootFrame) return;

  const sxFrame = targetWidth / Math.max(rootFrame.width, 1);
  const syFrame = targetHeight / Math.max(rootFrame.height, 1);
  const aspectDelta = Math.abs(sxFrame - syFrame) / Math.max(Math.min(sxFrame, syFrame), 1e-6);
  const canUniform = aspectDelta < 0.03;
  const uniformS = (sxFrame + syFrame) / 2;

  try {
    if (resultNode.type === NodeType.Frame && resultNode.layoutMode !== undefined) {
      resultNode.layoutMode = 'NONE';
    }
    if (canUniform && resultNode.rescale) {
      const curW = Math.max(resultNode.width ?? 1, 1);
      const targetW = Math.max(1, Math.round(master.width * uniformS));
      const s = targetW / curW;
      if (Number.isFinite(s) && s > 0 && Math.abs(s - 1) > 0.0001) {
        resultNode.rescale(s);
      }
    } else if (resultNode.resize) {
      const rw = Math.max(1, Math.min(slot.w, Math.round(targetWidth * 1.05)));
      const rh = Math.max(1, Math.min(slot.h, Math.round(targetHeight * 1.05)));
      resultNode.resize(rw, rh);
    }
  } catch (_) {}

  try {
    const rw = Math.max(resultNode.width ?? slot.w, 1);
    const rh = Math.max(resultNode.height ?? slot.h, 1);
    const rx = Math.max(0, Math.min(slot.x, targetWidth - rw));
    const ry = Math.max(0, Math.min(slot.y, targetHeight - rh));
    setPositionInFrame(resultNode, frame, rx, ry);
  } catch (_) {}
}

export function stretchCanonicalAndOrphanBackdropsToFrame(
  frame: INode,
  bgNode: INode,
  canonicalBgId: string,
  protectedIds: Set<string>,
  tw: number,
  th: number
): void {
  const pin = (n: INode): void => {
    try {
      if (n.parent !== frame) {
        frame.insertChild!(0, n);
      }
      stretchBackgroundNonUniformToFill(n, tw, th);
      setPositionInFrame(n, frame, 0, 0);
    } catch (_) {}
  };
  pin(bgNode);
  for (const s of [...(frame.children ?? [])]) {
    if (s.removed || s.id === canonicalBgId) continue;
    if (s.type === NodeType.Text || s.type === NodeType.Instance || s.type === NodeType.Component) continue;
    if (nodeOrDescendantInSet(s, protectedIds)) continue;
    const lb = getLayoutBoundsInFrame(s, frame);
    if (lb.w <= 0 || lb.h <= 0) continue;
    const narrow = lb.w < tw * 0.88;
    const tallish = lb.h > lb.w * 1.08;
    const significant = lb.w * lb.h > tw * th * 0.055;
    if (!narrow || !tallish || !significant) continue;
    if (!s.resize) continue;
    pin(s);
  }
}

export function applyBackgroundCoverFromClone(
  bgNode: INode,
  frame: INode,
  slot: { x: number; y: number; w: number; h: number }
): void {
  try {
    if (bgNode.type === NodeType.Frame && bgNode.layoutMode !== undefined) {
      bgNode.layoutMode = 'NONE';
    }
  } catch (_) {}

  const w = Math.max(bgNode.width, 1);
  const h = Math.max(bgNode.height, 1);
  const sw = Math.max(slot.w, 1);
  const sh = Math.max(slot.h, 1);
  const s = Math.max(sw / w, sh / h);

  if (Number.isFinite(s) && s > 0 && Math.abs(s - 1) > 0.001) {
    try {
      if (bgNode.rescale) {
        bgNode.rescale(s);
      } else if (bgNode.resize) {
        bgNode.resize(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
      }
    } catch (_) {}
    scaleBackgroundSubtreeEffects(bgNode, s);
  }

  const nw = Math.max(bgNode.width ?? sw, 1);
  const nh = Math.max(bgNode.height ?? sh, 1);
  const cx = Math.round(slot.x + (sw - nw) / 2);
  const cy = Math.round(slot.y + (sh - nh) / 2);
  try {
    setPositionInFrame(bgNode, frame, cx, cy);
    alignVisualCenterToFramePoint(bgNode, frame, slot.x + sw / 2, slot.y + sh / 2);
  } catch (_) {}
}

export function alignBackgroundChildrenToMasterNormalized(resultNode: INode, masterNodeId: string): void {
  const master = tryResolveNodeById(masterNodeId);
  if (!master) return;
  if (!master.children || !resultNode.children) return;
  const mKids = master.children!.filter(c => !c.removed);
  const rKids = resultNode.children!.filter(c => !c.removed);
  if (mKids.length === 0 || rKids.length === 0) return;

  const mW = Math.max(master.width, 1);
  const mH = Math.max(master.height, 1);
  const rW = Math.max(resultNode.width, 1);
  const rH = Math.max(resultNode.height, 1);
  const sx = rW / mW;
  const sy = rH / mH;
  type Meta = {
    node: INode;
    relArea: number;
    relCx: number;
    relCy: number;
  };
  const mkMeta = (n: INode, pw: number, ph: number): Meta => {
    const x = n.x;
    const y = n.y;
    const w = n.width;
    const h = n.height;
    return {
      node: n,
      relArea: (w * h) / Math.max(pw * ph, 1),
      relCx: (x + w / 2) / Math.max(pw, 1),
      relCy: (y + h / 2) / Math.max(ph, 1)
    };
  };
  const masters = mKids.map(n => mkMeta(n, mW, mH));
  const results = rKids.map(n => mkMeta(n, rW, rH));
  const used = new Set<number>();

  for (const rr of results) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < masters.length; i++) {
      if (used.has(i)) continue;
      const mm = masters[i];
      const typePenalty = rr.node.type === mm.node.type ? 0 : 2.0;
      const areaD = (rr.relArea - mm.relArea) ** 2;
      const posD = (rr.relCx - mm.relCx) ** 2 + (rr.relCy - mm.relCy) ** 2;
      const d = typePenalty + areaD * 8 + posD * 4;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) continue;
    used.add(best);
    const m = masters[best].node;
    const r = rr.node;
    try {
      if (r.resize) {
        r.resize(
          Math.max(1, Math.round((m.width ?? 1) * sx)),
          Math.max(1, Math.round((m.height ?? 1) * sy))
        );
      }
    } catch (_) {}
    try {
      r.x = Math.round((m.x ?? 0) * sx);
      r.y = Math.round((m.y ?? 0) * sy);
    } catch (_) {}
  }
}

export function alignBackgroundChildrenByMasterIndex(resultNode: INode, masterNodeId: string): void {
  const master = tryResolveNodeById(masterNodeId);
  if (!master) return;
  const mW = Math.max(master.width, 1);
  const mH = Math.max(master.height, 1);
  const rW = Math.max(resultNode.width, 1);
  const rH = Math.max(resultNode.height, 1);
  const sx = rW / mW;
  const sy = rH / mH;

  const applyPair = (r: INode, m: INode, isRoot: boolean): void => {
    if (!isRoot) {
      try {
        if (r.resize) {
          r.resize(
            Math.max(1, Math.round((m.width ?? 1) * sx)),
            Math.max(1, Math.round((m.height ?? 1) * sy))
          );
        }
      } catch (_) {}
      try {
        r.x = Math.round((m.x ?? 0) * sx);
        r.y = Math.round((m.y ?? 0) * sy);
      } catch (_) {}
    }

    if (r.children && m.children) {
      const rKids = r.children.filter(c => !c.removed);
      const mKids = m.children.filter(c => !c.removed);
      const len = Math.min(rKids.length, mKids.length);
      for (let i = 0; i < len; i++) {
        applyPair(rKids[i], mKids[i], false);
      }
    }
  };

  applyPair(resultNode, master, true);
}
