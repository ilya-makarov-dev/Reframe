/** Ellipse-heavy decor alignment against master geometry (index walk and cluster bbox). */

import { type INode, NodeType, MIXED } from '../../host';

import { tryResolveNodeById } from './figma-node-resolve';

export function nodeHasBlurEffect(node: INode): boolean {
  if (!node.effects || !Array.isArray(node.effects)) return false;
  const effects = node.effects;
  return effects.some((e: any) => e?.type === 'LAYER_BLUR' || e?.type === 'BACKGROUND_BLUR');
}

export function isEllipseLikeDecor(node: INode): boolean {
  return node.type === NodeType.Ellipse;
}

export type LocalBox = { x: number; y: number; w: number; h: number; node: INode };

export function collectEllipseLocalBoxes(root: INode): LocalBox[] {
  const out: LocalBox[] = [];
  const walk = (n: INode, ox: number, oy: number): void => {
    const nx = n.x ?? 0;
    const ny = n.y ?? 0;
    const px = ox + nx;
    const py = oy + ny;
    if (n.type === NodeType.Ellipse) {
      const w = n.width ?? 0;
      const h = n.height ?? 0;
      if (w > 0 && h > 0) out.push({ x: px, y: py, w, h, node: n });
    }
    if (n.children && n.type !== NodeType.Instance) {
      for (const c of n.children) {
        if (!c.removed) walk(c, px, py);
      }
    }
  };
  walk(root, 0, 0);
  return out;
}

export function unionBoxes(boxes: LocalBox[]): { x: number; y: number; w: number; h: number } | null {
  if (boxes.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

export function alignEllipseCentersByMasterIndex(resultNode: INode, masterNodeId: string): void {
  const master = tryResolveNodeById(masterNodeId);
  if (!master || !master.children || !resultNode.children) return;

  const mW = Math.max(master.width, 1);
  const mH = Math.max(master.height, 1);
  const rW = Math.max(resultNode.width, 1);
  const rH = Math.max(resultNode.height, 1);
  const sx = rW / mW;
  const sy = rH / mH;

  const walk = (r: INode, m: INode, isRoot: boolean): void => {
    if (!isRoot && isEllipseLikeDecor(r) && isEllipseLikeDecor(m)) {
      try {
        const mw = m.width ?? 0;
        const mh = m.height ?? 0;
        const mx = m.x ?? 0;
        const my = m.y ?? 0;
        const rw = r.width ?? 0;
        const rh = r.height ?? 0;
        const targetCx = (mx + mw / 2) * sx;
        const targetCy = (my + mh / 2) * sy;
        r.x = Math.round(targetCx - rw / 2);
        r.y = Math.round(targetCy - rh / 2);
      } catch (_) {}
    }

    if (r.children && m.children) {
      const rKids = r.children.filter(c => !c.removed);
      const mKids = m.children.filter(c => !c.removed);
      const len = Math.min(rKids.length, mKids.length);
      for (let i = 0; i < len; i++) {
        walk(rKids[i], mKids[i], false);
      }
    }
  };

  walk(resultNode, master, true);
}

export function alignEllipseVisualByMasterIndex(resultNode: INode, masterNodeId: string): void {
  const master = tryResolveNodeById(masterNodeId);
  if (!master || !master.children || !resultNode.children) return;

  const mW = Math.max(master.width, 1);
  const mH = Math.max(master.height, 1);
  const rW = Math.max(resultNode.width, 1);
  const rH = Math.max(resultNode.height, 1);
  const s = Math.min(rW / mW, rH / mH);

  const copyVisual = (r: INode, m: INode): void => {
    try {
      if (m.fills !== undefined && r.fills !== undefined) {
        const f = m.fills;
        if (f !== MIXED && Array.isArray(f)) r.fills = f;
      }
      if (m.effects !== undefined && r.effects !== undefined) {
        const e = m.effects;
        if (Array.isArray(e)) {
          const scaled = e.map((ef: any) => {
            if (!ef || typeof ef !== 'object') return ef;
            if (ef.type === 'LAYER_BLUR' || ef.type === 'BACKGROUND_BLUR') {
              return { ...ef, radius: Math.max(0, (ef.radius ?? 0) * s) };
            }
            if (ef.type === 'DROP_SHADOW' || ef.type === 'INNER_SHADOW') {
              const ox = ef.offset?.x ?? 0;
              const oy = ef.offset?.y ?? 0;
              return {
                ...ef,
                radius: Math.max(0, (ef.radius ?? 0) * s),
                spread: typeof ef.spread === 'number' ? Math.max(0, ef.spread * s) : ef.spread,
                offset: { x: ox * s, y: oy * s }
              };
            }
            return ef;
          });
          r.effects = scaled;
        }
      }
      if (m.opacity !== undefined && r.opacity !== undefined) r.opacity = m.opacity;
      if (m.blendMode !== undefined && r.blendMode !== undefined) r.blendMode = m.blendMode;
      if (m.strokes !== undefined && r.strokes !== undefined) {
        const st = m.strokes;
        if (Array.isArray(st)) r.strokes = st;
      }
      if (m.strokeWeight !== undefined && r.strokeWeight !== undefined) {
        const sw = m.strokeWeight;
        if (typeof sw === 'number') r.strokeWeight = Math.max(0, sw * s);
      }
      if (m.rotation !== undefined && r.rotation !== undefined) {
        r.rotation = m.rotation;
      }
      if ('strokeAlign' in m && 'strokeAlign' in r) {
        (r as any).strokeAlign = (m as any).strokeAlign;
      }
      if ('strokeCap' in m && 'strokeCap' in r) {
        (r as any).strokeCap = (m as any).strokeCap;
      }
    } catch (_) {}
  };

  const walk = (r: INode, m: INode, isRoot: boolean): void => {
    if (!isRoot && isEllipseLikeDecor(r) && isEllipseLikeDecor(m)) {
      copyVisual(r, m);
    }
    if (r.children && m.children) {
      const rKids = r.children.filter(c => !c.removed);
      const mKids = m.children.filter(c => !c.removed);
      const len = Math.min(rKids.length, mKids.length);
      for (let i = 0; i < len; i++) walk(rKids[i], mKids[i], false);
    }
  };

  walk(resultNode, master, true);
}

export function alignEllipseClusterByMasterBBox(resultNode: INode, masterNodeId: string): void {
  const master = tryResolveNodeById(masterNodeId);
  if (!master) return;
  const mBoxes = collectEllipseLocalBoxes(master);
  const rBoxes = collectEllipseLocalBoxes(resultNode);
  const mU = unionBoxes(mBoxes);
  const rU = unionBoxes(rBoxes);
  if (!mU || !rU) return;

  const mW = Math.max(master.width, 1);
  const mH = Math.max(master.height, 1);
  const rW = Math.max(resultNode.width, 1);
  const rH = Math.max(resultNode.height, 1);
  const sx = rW / mW;
  const sy = rH / mH;

  const targetCx = (mU.x + mU.w / 2) * sx;
  const targetCy = (mU.y + mU.h / 2) * sy;
  const currentCx = rU.x + rU.w / 2;
  const currentCy = rU.y + rU.h / 2;
  let dx = targetCx - currentCx;
  let dy = targetCy - currentCy;
  const maxDx = rW * 0.25;
  const maxDy = rH * 0.25;
  dx = Math.max(-maxDx, Math.min(maxDx, dx));
  dy = Math.max(-maxDy, Math.min(maxDy, dy));
  if (Math.abs(dx) < 0.2 && Math.abs(dy) < 0.2) return;

  for (const b of rBoxes) {
    try {
      b.node.x = Math.round((b.node.x ?? 0) + dx);
      b.node.y = Math.round((b.node.y ?? 0) + dy);
    } catch (_) {}
  }
}
