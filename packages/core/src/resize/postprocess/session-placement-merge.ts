import { type INode, NodeType } from '../../host';
import type { GuideElement } from '../contracts/types';
import type { ExactSessionPlacement } from './exact-session-types';
import { collectAllDescendants, getBoundsInFrame } from './layout-utils';
import { isGlowBlurPlate, isGlowDecorClusterContainer } from './semantic-decor-containers';

/**
 * Merge slot fractions (like `oLD/guide-scaler.ts:mergeGuideSlotElements`).
 */
export function mergeGuideSlotElements(els: GuideElement[]): GuideElement {
  const first = els[0]!;
  let minL = Infinity;
  let minT = Infinity;
  let maxR = -Infinity;
  let maxB = -Infinity;
  for (const el of els) {
    const l = el.left ?? 0;
    const t = el.top ?? 0;
    const wr = el.widthRatio ?? 0;
    const hr = el.heightRatio ?? 0;
    minL = Math.min(minL, l);
    minT = Math.min(minT, t);
    maxR = Math.max(maxR, l + wr);
    maxB = Math.max(maxB, t + hr);
  }
  return {
    ...first,
    name: first.name,
    left: minL,
    top: minT,
    widthRatio: Math.max(0.02, maxR - minL),
    heightRatio: Math.max(0.02, maxB - minT)
  };
}

/**
 * Multiple `other` slots on glow leaves inside one GROUP/FRAME → one slot per container (like oLD).
 */
export function coalesceEllipseClusterPlacements(
  resultFrame: INode,
  placements: ExactSessionPlacement[]
): ExactSessionPlacement[] {
  const byId = new Map(placements.map(p => [p.resultNodeId, p]));
  const remove = new Set<string>();
  const extra: ExactSessionPlacement[] = [];

  for (const n of collectAllDescendants(resultFrame)) {
    if (!isGlowDecorClusterContainer(n)) continue;
    const kids = (n as any).children.filter((c: any) => !c.removed);
    const parts: ExactSessionPlacement[] = [];
    for (const e of kids) {
      if (
        e.type !== NodeType.Ellipse &&
        e.type !== NodeType.Star &&
        e.type !== NodeType.Polygon &&
        e.type !== 'LINE' &&
        !isGlowBlurPlate(e as INode)
      ) {
        continue;
      }
      const pl = byId.get(e.id);
      if (pl && pl.slotType === 'other') parts.push(pl);
    }
    if (parts.length < 2) continue;

    for (const pl of parts) remove.add(pl.resultNodeId);
    const mergedEl = mergeGuideSlotElements(parts.map(p => p.element));
    mergedEl.name = (n as any).name ?? mergedEl.name;
    const b = getBoundsInFrame(n as INode, resultFrame);
    extra.push({
      resultNodeId: n.id,
      slotType: 'other',
      element: mergedEl,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h
    });
  }

  const kept = placements.filter(p => !remove.has(p.resultNodeId));
  const seen = new Set(kept.map(p => p.resultNodeId));
  for (const e of extra) {
    if (!seen.has(e.resultNodeId)) {
      kept.push(e);
      seen.add(e.resultNodeId);
    }
  }
  return kept;
}
