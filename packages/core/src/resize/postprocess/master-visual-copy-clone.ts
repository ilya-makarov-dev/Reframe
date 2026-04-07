/** Copy fills/effects from master nodes and clone background subtrees into the result frame. */

import { type INode, NodeType, MIXED } from '../../host';

import { getBoundsInFrame, setPositionInFrame, subtreeHasNonBackgroundContentSignals } from './layout-utils';
import { tryResolveNodeById } from './figma-node-resolve';

export function stretchGlowClusterChildren(container: INode, sx: number, sy: number): void {
  if (!container.children) return;
  for (const child of container.children!) {
    if (child.removed) continue;
    child.x = Math.round(child.x * sx);
    child.y = Math.round(child.y * sy);
    if ('resize' in child && typeof (child as { resize?: (w: number, h: number) => void }).resize === 'function') {
      const w = Math.max(1, Math.round((child as { width: number }).width * sx));
      const h = Math.max(1, Math.round((child as { height: number }).height * sy));
      (child as { resize(w: number, h: number): void }).resize(w, h);
    }
  }
}

export function copyVisualFromMasterNode(resultNode: INode, masterNodeId: string): void {
  const master = tryResolveNodeById(masterNodeId);
  if (!master || master.removed) return;
  try {
    if (master.fills !== undefined && resultNode.fills !== undefined && resultNode.type !== NodeType.Text && resultNode.type !== NodeType.Instance) {
      const mf = master.fills;
      if (mf !== MIXED && Array.isArray(mf)) {
        resultNode.fills = mf;
      }
    }
    if (master.effects !== undefined && resultNode.effects !== undefined) {
      const me = master.effects;
      if (Array.isArray(me)) {
        resultNode.effects = me;
      }
    }
    if (master.blendMode !== undefined && resultNode.blendMode !== undefined) {
      resultNode.blendMode = master.blendMode;
    }
    if (master.opacity !== undefined && resultNode.opacity !== undefined) {
      resultNode.opacity = master.opacity;
    }
    if (master.strokes !== undefined && resultNode.strokes !== undefined && resultNode.type !== NodeType.Text) {
      const ms = master.strokes;
      if (Array.isArray(ms)) {
        resultNode.strokes = ms;
      }
    }
  } catch (_) {}
}

/**
 * Recursively copy fills/effects from master node's children to result node's children (for groups/frames).
 * Matches children by index (same tree structure from clone).
 */
export function copyVisualFromMasterNodeDeep(resultNode: INode, masterNodeId: string): void {
  copyVisualFromMasterNode(resultNode, masterNodeId);
  const master = tryResolveNodeById(masterNodeId);
  if (!master) return;
  if (master.children && resultNode.children) {
    const mKids = master.children;
    const rKids = resultNode.children;
    const len = Math.min(mKids.length, rKids.length);
    for (let i = 0; i < len; i++) {
      const rk = rKids[i];
      const mk = mKids[i];
      if (!rk || !mk) continue;
      copyVisualFromMasterNodeDeep(rk as INode, mk.id);
    }
  }
}

/**
 * Remap background children: copy fills/effects AND reposition/resize each child
 * from the master's layout. Matches by node type + relative area.
 * After this, result background children mirror master's arrangement.
 */
export function copyVisualFromMasterChildren(resultNode: INode, masterNodeId: string): void {
  const master = tryResolveNodeById(masterNodeId);
  if (!master) return;

  copyVisualFromMasterNode(resultNode, masterNodeId);

  if (!master.children || !resultNode.children) return;
  const mKids = master.children.filter(c => !c.removed);
  if (mKids.length === 0) return;
  let rKids = resultNode.children.filter(c => !c.removed);

  if (rKids.length === 0 && resultNode.type !== NodeType.Instance) {
    for (const mk of mKids) {
      try {
        if (mk.clone) {
          const cloned = mk.clone();
          resultNode.appendChild!(cloned);
        }
      } catch (_) {}
    }
    rKids = resultNode.children.filter(c => !c.removed);
    if (rKids.length === 0) return;
  }

  const mW = Math.max(master.width, 1);
  const mH = Math.max(master.height, 1);
  const rW = Math.max(resultNode.width, 1);
  const rH = Math.max(resultNode.height, 1);

  const s = Math.min(rW / mW, rH / mH);
  const fitW = mW * s;
  const fitH = mH * s;
  const offX = (rW - fitW) / 2;
  const offY = (rH - fitH) / 2;

  interface ChildMeta {
    node: INode;
    relArea: number;
    idx: number;
  }

  const childMeta = (n: INode, pw: number, ph: number, i: number): ChildMeta => {
    const w = n.width;
    const h = n.height;
    return { node: n, relArea: (w * h) / (pw * ph), idx: i };
  };

  const masterMetas = mKids.map((c: any, i: number) => childMeta(c as INode, mW, mH, i));
  const resultMetas = rKids.map((c: any, i: number) => childMeta(c as INode, rW, rH, i));

  const usedMaster = new Set<number>();

  for (const rm of resultMetas) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let j = 0; j < masterMetas.length; j++) {
      if (usedMaster.has(j)) continue;
      const mm = masterMetas[j];
      const typePenalty = rm.node.type !== mm.node.type ? 2.0 : 0;
      const areaDiff = (rm.relArea - mm.relArea) ** 2;
      const d = typePenalty + areaDiff * 10;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = j;
      }
    }
    if (bestIdx >= 0) {
      usedMaster.add(bestIdx);
      const mChild = masterMetas[bestIdx].node;

      if (mChild.children && rm.node.children) {
        copyVisualFromMasterNodeDeep(rm.node, mChild.id);
      } else {
        copyVisualFromMasterNode(rm.node, mChild.id);
      }

      try {
        const mx = mChild.x;
        const my = mChild.y;
        const mw = mChild.width;
        const mh = mChild.height;
        if (rm.node.resize && mw > 0 && mh > 0) {
          rm.node.resize(Math.max(1, Math.round(mw * s)), Math.max(1, Math.round(mh * s)));
        }
        rm.node.x = Math.round(offX + mx * s);
        rm.node.y = Math.round(offY + my * s);
      } catch (_) {}
    }
  }
}

export function cloneMasterBackgroundIntoResult(
  resultNode: INode,
  masterNodeId: string,
  frame: INode
): INode {
  const master = tryResolveNodeById(masterNodeId);
  if (!master || !master.clone) return resultNode;
  try {
    const clone = master.clone();
    frame.appendChild!(clone);
    try {
      frame.insertChild!(0, clone);
    } catch (_) {}

    try {
      const b = getBoundsInFrame(resultNode, frame);
      setPositionInFrame(clone, frame, b.x, b.y);
    } catch (_) {}

    // Wrong "background" slot can point at a hero/group; removing it deletes all layers except the cloned bg.
    if (subtreeHasNonBackgroundContentSignals(resultNode)) {
      try {
        clone.remove!();
      } catch (_) {}
      return resultNode;
    }

    try {
      resultNode.remove!();
    } catch (_) {}
    return clone;
  } catch (_) {
    return resultNode;
  }
}

export function cloneMasterBackgroundDirectToFrame(masterNodeId: string, frame: INode): INode | null {
  const master = tryResolveNodeById(masterNodeId);
  if (!master || !master.clone) return null;
  try {
    const clone = master.clone();
    frame.appendChild!(clone);
    try {
      frame.insertChild!(0, clone);
    } catch (_) {}
    return clone;
  } catch (_) {
    return null;
  }
}
