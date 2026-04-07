/** Decor containers: glow, ellipses, "hero" shapes outside ellipse clusters. */

import { type INode, NodeType } from '../../host';

/** Like `oLD/guide-scaler.ts`: container of 2+ "glow" leaves (ellipses / blur plates). */
export function isGlowDecorClusterContainer(node: INode): boolean {
  if (node.type !== NodeType.Group && node.type !== NodeType.Frame) return false;
  const ch = (node as any).children.filter((c: any) => !c.removed);
  if (ch.length < 2) return false;
  let glow = 0;
  for (const c of ch) {
    if (c.type === NodeType.Ellipse || c.type === NodeType.Star || c.type === NodeType.Polygon || c.type === NodeType.Line) {
      glow++;
      continue;
    }
    if (c.type === NodeType.Rectangle || c.type === NodeType.Vector) {
      if (isGlowBlurPlate(c as INode)) {
        glow++;
        continue;
      }
    }
    return false;
  }
  return glow >= 2;
}

export function isEllipseOnlyClusterContainer(node: INode): boolean {
  return isGlowDecorClusterContainer(node);
}

export function isGlowBlurPlate(node: INode): boolean {
  if (!('effects' in node)) return false;
  const e = node.effects;
  return Array.isArray(e) && e.some((ef: any) => ef.type === 'LAYER_BLUR' && ef.visible !== false);
}

export function isNonEllipseHeroShape(node: INode, _frame: INode, areaFrame: number): boolean {
  if (node.type === NodeType.Rectangle || node.type === NodeType.Vector || node.type === NodeType.BooleanOp) {
    const area = node.width * node.height;
    if (area > areaFrame * 0.05) return true;
  }
  return false;
}

export function subtreeHasHeroOrNonEllipseVisual(node: INode, frame: INode, areaFrame: number): boolean {
  if ((node as { type: string }).type === 'IMAGE' || isNonEllipseHeroShape(node, frame, areaFrame)) return true;
  if (node.children) {
    for (const child of node.children) {
      if (subtreeHasHeroOrNonEllipseVisual(child, frame, areaFrame)) return true;
    }
  }
  return false;
}

export function countGlowBlurPlateLeavesInSubtree(node: INode): number {
  let count = 0;
  if (isGlowBlurPlate(node)) count++;
  if (node.children) {
    for (const child of node.children) {
      count += countGlowBlurPlateLeavesInSubtree(child);
    }
  }
  return count;
}

export function isEllipseGlowIllustrationContainer(node: INode, _frame: INode, _areaFrame: number): boolean {
  if (node.type !== NodeType.Frame && node.type !== NodeType.Group && node.type !== NodeType.Instance && node.type !== NodeType.Component)
    return false;
  const leaves = countGlowBlurPlateLeavesInSubtree(node);
  return leaves >= 2;
}
