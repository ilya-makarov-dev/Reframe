/** Shared geometry/fill/stroke checks for semantic classification and logo/CTA heuristics. */

import { type INode, MIXED } from '../../host';

export function hasVisibleImageFill(node: INode): boolean {
  if (!('fills' in node)) return false;
  const f = node.fills;
  if ((f as unknown) === MIXED || !Array.isArray(f)) return false;
  return f.some(p => p.type === 'IMAGE' && p.visible !== false);
}

export function subtreeHasVisibleImageFill(node: INode): boolean {
  if (hasVisibleImageFill(node)) return true;
  if (node.children) {
    for (const child of node.children) {
      if (subtreeHasVisibleImageFill(child)) return true;
    }
  }
  return false;
}

export function isEffectivelyNoFill(node: INode): boolean {
  if (!('fills' in node)) return true;
  const f = node.fills;
  if ((f as unknown) === MIXED || !Array.isArray(f)) return true;
  return f.every(p => p.visible === false);
}

export function hasVisibleGeometryStroke(node: INode): boolean {
  if (!('strokes' in node)) return false;
  const s = node.strokes;
  if ((s as unknown) === MIXED || !Array.isArray(s)) return false;
  const sw = node.strokeWeight;
  return s.some(p => p.visible !== false) && typeof sw === 'number' && sw > 0;
}

export function hasStructuralWrapperEffects(node: INode): boolean {
  if (!('effects' in node)) return false;
  const e = node.effects;
  if (!Array.isArray(e)) return false;
  return e.some(ef => ef.visible !== false && (ef.type === 'DROP_SHADOW' || ef.type === 'INNER_SHADOW' || ef.type === 'LAYER_BLUR'));
}
