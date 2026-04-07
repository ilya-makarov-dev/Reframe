/**
 * Deterministic signal collection from a frame — single pass, no ML.
 */

import { type INode, NodeType } from '../../host';
import { collectAllDescendants, getBoundsInFrame } from '../postprocess/layout-utils';
import { hasVisibleImageFill } from '../postprocess/semantic-node-paint';
import type { BannerLayoutSignals } from './types';

export function collectBannerLayoutSignals(frame: INode): BannerLayoutSignals {
  const W = Math.max(frame.width, 1);
  const H = Math.max(frame.height, 1);
  const areaFrame = W * H;

  let textNodeCount = 0;
  let textInLowerThirdCount = 0;
  let nestedFrameDepthMax = 0;
  let largestRectAreaRatio = 0;
  let imageFillAreaRatioApprox = 0;

  const descendants = collectAllDescendants(frame);
  const rootChildren = (frame.children ?? []).length;

  for (const n of descendants) {
    if (n === frame) continue;
    if ('removed' in n && n.removed) continue;

    let depth = 0;
    let p: INode | null = n.parent;
    while (p && p !== frame) {
      if (p.type === NodeType.Frame || p.type === NodeType.Group) depth += 1;
      p = p.parent;
    }
    nestedFrameDepthMax = Math.max(nestedFrameDepthMax, depth);

    if (n.type === NodeType.Text) {
      textNodeCount += 1;
      const b = getBoundsInFrame(n, frame);
      const cy = (b.y + b.h / 2) / H;
      if (cy >= 2 / 3) textInLowerThirdCount += 1;
    }

    if (n.type === NodeType.Rectangle || n.type === NodeType.Frame) {
      const b = getBoundsInFrame(n, frame);
      const ar = (b.w * b.h) / areaFrame;
      largestRectAreaRatio = Math.max(largestRectAreaRatio, ar);
    }

    if (hasVisibleImageFill(n)) {
      const b = getBoundsInFrame(n, frame);
      const r = Math.min(1, (b.w * b.h) / areaFrame);
      /** Max, not sum — overlapping image layers were inflating toward 1.0 and blurring class boundaries. */
      imageFillAreaRatioApprox = Math.max(imageFillAreaRatioApprox, r);
    }
  }

  return {
    width: W,
    height: H,
    aspectRatio: W / H,
    largestRectAreaRatio,
    textNodeCount,
    textInLowerThirdCount,
    nestedFrameDepthMax,
    imageFillAreaRatioApprox,
    rootChildCount: rootChildren
  };
}
