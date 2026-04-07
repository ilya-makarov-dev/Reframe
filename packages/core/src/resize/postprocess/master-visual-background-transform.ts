/** Background resize/cover/fit and subtree constraint locks for deterministic scaling. */

import { type INode, NodeType, MIXED } from '../../host';

import { aspectDeltaRelativeToTarget } from '../geometry/aspect';
import { scaleToFill, stretchBackgroundToFill } from '../scaling/scaler';
import { setPositionInFrame } from './layout-utils';

export function coverBackgroundToTargetFrame(
  node: INode,
  frame: INode,
  targetWidth: number,
  targetHeight: number
): void {
  const hasChildren =
    node.children &&
    node.type !== NodeType.Instance &&
    node.children.length > 0;
  if (hasChildren) {
    stretchBackgroundToFill(node, targetWidth, targetHeight);
  } else if (node.resize) {
    const bw = Math.max(node.width ?? 1, 1);
    const bh = Math.max(node.height ?? 1, 1);
    const aspectDiff = aspectDeltaRelativeToTarget(bw, bh, targetWidth, targetHeight);
    if (aspectDiff < 0.5) {
      node.resize(targetWidth, targetHeight);
      setPositionInFrame(node, frame, 0, 0);
    } else {
      scaleToFill(node, targetWidth, targetHeight);
    }
  }
  try {
    const nw = Math.max(node.width ?? 0, 0);
    const nh = Math.max(node.height ?? 0, 0);
    if (nw > 0 && nh > 0) {
      setPositionInFrame(
        node,
        frame,
        Math.round((targetWidth - nw) / 2),
        Math.round((targetHeight - nh) / 2)
      );
    }
  } catch (_) {}
  if (node.parent === frame) {
    try {
      if ((frame.children ?? []).indexOf(node) > 0) frame.insertChild!(0, node);
    } catch (_) {}
  }
}

export function scaleChildrenNonUniform(container: INode, sx: number, sy: number): void {
  if (!container.children || container.type === NodeType.Instance) return;
  for (const child of container.children!) {
    if (child.removed) continue;
    try {
      child.x = Math.round(child.x * sx);
      child.y = Math.round(child.y * sy);
    } catch (_) {}
    try {
      if (child.resize) {
        const w = Math.max(1, Math.round(child.width * sx));
        const h = Math.max(1, Math.round(child.height * sy));
        child.resize(w, h);
      }
    } catch (_) {}
    scaleChildrenNonUniform(child, sx, sy);
  }
}

export function fitBackgroundToTargetFrameNonUniform(
  node: INode,
  frame: INode,
  targetWidth: number,
  targetHeight: number
): void {
  lockBackgroundSubtreeForDeterministicResize(node);
  try {
    if (node.type === NodeType.Frame && node.layoutMode !== undefined) {
      node.layoutMode = 'NONE';
    }
    if (node.resize) {
      node.resize(Math.max(1, Math.round(targetWidth)), Math.max(1, Math.round(targetHeight)));
    }
  } catch (_) {}
  try {
    setPositionInFrame(node, frame, 0, 0);
  } catch (_) {}
}

export function fitBackgroundToSlotNonUniform(
  node: INode,
  frame: INode,
  slotX: number,
  slotY: number,
  slotW: number,
  slotH: number
): void {
  lockBackgroundSubtreeForDeterministicResize(node);
  try {
    if (node.type === NodeType.Frame && node.layoutMode !== undefined) {
      node.layoutMode = 'NONE';
    }
    if (node.resize) {
      node.resize(Math.max(1, Math.round(slotW)), Math.max(1, Math.round(slotH)));
    }
  } catch (_) {}
  try {
    const nw = Math.max(node.width ?? slotW, 1);
    const nh = Math.max(node.height ?? slotH, 1);
    const px = Math.round(slotX + Math.max(0, (slotW - nw) / 2));
    const py = Math.round(slotY + Math.max(0, (slotH - nh) / 2));
    setPositionInFrame(node, frame, px, py);
  } catch (_) {}
}

export function lockBackgroundSubtreeForDeterministicResize(node: INode): void {
  try {
    if (node.constraints !== undefined && node.parent && node.parent.type !== NodeType.Instance) {
      node.constraints = { horizontal: 'SCALE', vertical: 'SCALE' };
    }
  } catch (_) {}
  if (node.type === NodeType.Frame && node.layoutMode !== undefined) {
    try {
      node.layoutMode = 'NONE';
    } catch (_) {}
  }
  if (node.children && node.type !== NodeType.Instance) {
    for (const c of node.children) {
      if (!c.removed) {
        lockBackgroundSubtreeForDeterministicResize(c);
      }
    }
  }
}

export function scaleBackgroundSubtreeEffects(node: INode, scale: number): void {
  if (!Number.isFinite(scale) || scale <= 0 || Math.abs(scale - 1) < 0.01) return;
  try {
    if (node.effects) {
      const effects = node.effects;
      if (Array.isArray(effects)) {
        const next = effects.map((e: any) => {
          if (!e || typeof e !== 'object') return e;
          if (e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR') {
            return { ...e, radius: Math.max(0, (e.radius ?? 0) * scale) };
          }
          if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
            const ox = e.offset?.x ?? 0;
            const oy = e.offset?.y ?? 0;
            return {
              ...e,
              radius: Math.max(0, (e.radius ?? 0) * scale),
              spread: typeof e.spread === 'number' ? Math.max(0, e.spread * scale) : e.spread,
              offset: { x: ox * scale, y: oy * scale }
            };
          }
          return e;
        });
        node.effects = next;
      }
    }
  } catch (_) {}
  if (node.children && node.type !== NodeType.Instance) {
    for (const c of node.children) {
      if (!c.removed) {
        scaleBackgroundSubtreeEffects(c, scale);
      }
    }
  }
}
