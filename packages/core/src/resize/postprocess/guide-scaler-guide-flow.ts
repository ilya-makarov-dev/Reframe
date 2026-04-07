/**
 * Guide -- universal layout rules by element semantics.
 * Matching by semantics only: what by size/position/type is a title,
 * button, logo, key image, etc. Layer names are not used.
 */

import { type INode, NodeType, MIXED } from '../../host';

import { GuideSize, GuideElement, BannerElementType } from '../contracts/types';

import { aspectDeltaRelativeToTarget } from '../geometry/aspect';
import { uniformScaleForLetterbox } from '../geometry/fit';
import {
  scaleToFill,
  scaleElement,
  scaleButtonFrameUniform,
  stretchBackgroundToFill
} from '../scaling/scaler';
import { collectAllDescendants, getBoundsInFrame, setPositionInFrame } from './layout-utils';
import {
  assignSemanticTypes,
  buttonUniformScaleForSlot,
  findFallbackTitleDescription,
  fitTextInSlotPreserveProportions,
  getButtonFitSizeInFrame,
  getGuideSlotType,
  inferLetterboxContentIsland,
  slotUniformScaleFit,
  topmostBySlotType
} from './semantic-classifier';
import { applyRememberToShapeNode, applyRememberToTextNode } from './session-slots';

export async function applyGuidePostProcess(
  frame: INode,
  targetWidth: number,
  targetHeight: number,
  guide: GuideSize,
  semanticMap?: Map<string, BannerElementType>,
  opts?: { skipSemanticFallback?: boolean; exactPlacement?: boolean; afterUniformLetterbox?: boolean }
): Promise<void> {
  const allNodes = collectAllDescendants(frame).slice(1);
  let semanticTypes: Map<string, BannerElementType> = semanticMap ?? assignSemanticTypes(allNodes, frame);

  if (semanticMap && !opts?.skipSemanticFallback) {
    const assigned = new Set(semanticTypes.keys());
    const fallback = findFallbackTitleDescription(frame, allNodes, assigned, guide);
    if (fallback.size > 0) {
      semanticTypes = new Map(semanticTypes);
      for (const [id, slotType] of fallback) semanticTypes.set(id, slotType);
    }
  }

  const nodeItems = allNodes
    .map(node => ({ node, slotType: semanticTypes.get(node.id) }))
    .filter((x): x is { node: INode; slotType: BannerElementType } => x.slotType != null);
  const topmost = topmostBySlotType(nodeItems);

  const guideSlots: { el: GuideElement; slotType: BannerElementType }[] = [];
  for (const el of guide.elements) {
    if (el.type === 'background' && el.fill) {
      guideSlots.push({ el, slotType: 'background' });
      continue;
    }
    if (el.left == null || el.top == null) continue;
    guideSlots.push({ el, slotType: getGuideSlotType(el) });
  }
  guideSlots.sort((a, b) => (a.el.top ?? 0) - (b.el.top ?? 0) || (a.el.left ?? 0) - (b.el.left ?? 0));

  const used = new Set<string>();
  const byType = new Map<BannerElementType, { node: INode; slotType: BannerElementType }[]>();
  for (const item of topmost) {
    if (!byType.has(item.slotType)) byType.set(item.slotType, []);
    byType.get(item.slotType)!.push(item);
  }

  const tw0 = targetWidth;
  const th0 = targetHeight;
  let slotOx = 0;
  let slotOy = 0;
  let slotPw = tw0;
  let slotPh = th0;
  if (opts?.afterUniformLetterbox && !opts?.exactPlacement) {
    const isl = inferLetterboxContentIsland(frame, semanticTypes, tw0, th0);
    const frac = (isl.w * isl.h) / Math.max(tw0 * th0, 1);
    if (frac < 0.9 && isl.w >= 8 && isl.h >= 8) {
      slotOx = isl.x;
      slotOy = isl.y;
      slotPw = isl.w;
      slotPh = isl.h;
    }
  }

  const frameAlreadyTargetSize =
    Math.abs(frame.width - targetWidth) <= 2 && Math.abs(frame.height - targetHeight) <= 2;
  const skipGuideBackgroundStretch = frameAlreadyTargetSize || opts?.afterUniformLetterbox === true;

  const bgSlot = guideSlots.find(s => s.slotType === 'background' && s.el.fill);
  if (bgSlot && !skipGuideBackgroundStretch) {
    let bgNode: INode | null = null;
    const areaF = frame.width * frame.height;
    bgNode = byType.get('background')?.find(x => !used.has(x.node.id))?.node ?? null;
    if (!bgNode) {
      const directChildren = (frame.children ?? []).filter(c => !c.removed);
      const withFillLarge = directChildren.filter(n => {
        if (!('fills' in n) || n.fills === MIXED || !Array.isArray(n.fills) || n.fills.length === 0)
          return false;
        const b = getBoundsInFrame(n, frame);
        return b.w * b.h >= areaF * 0.22;
      });
      if (withFillLarge.length > 0) {
        withFillLarge.sort(
          (a, b) =>
            getBoundsInFrame(b, frame).w * getBoundsInFrame(b, frame).h -
            getBoundsInFrame(a, frame).w * getBoundsInFrame(a, frame).h
        );
        bgNode = withFillLarge[0]!;
      }
    }
    if (!bgNode) {
      const withFills = allNodes.filter(n => {
        if ('fills' in n && n.fills !== MIXED && n.fills && n.fills.length > 0) return true;
        return false;
      });
      const boundsMap = new Map<string, { w: number; h: number }>();
      for (const n of allNodes) {
        const b = getBoundsInFrame(n, frame);
        boundsMap.set(n.id, { w: b.w, h: b.h });
      }
      const areaFrame = targetWidth * targetHeight;
      const sorted = withFills
        .filter(n => {
          const bb = boundsMap.get(n.id);
          return !!bb && bb.w * bb.h >= areaFrame * 0.2;
        })
        .sort((a, b) => {
          const ba = boundsMap.get(a.id);
          const bb = boundsMap.get(b.id);
          if (!ba || !bb) return 0;
          return bb.w * bb.h - ba.w * ba.h;
        });
      bgNode = sorted.length > 0 ? sorted[0] : null;
    }
    if (bgNode) {
      used.add(bgNode.id);
      try {
        if (bgNode.type === NodeType.Frame && 'layoutMode' in bgNode) {
          bgNode.layoutMode = 'NONE';
        }
        const hasChildren = bgNode.children && bgNode.type !== NodeType.Instance && bgNode.children.length > 0;
        if (hasChildren) {
          stretchBackgroundToFill(bgNode, targetWidth, targetHeight);
        } else {
          const bw = bgNode.width ?? 1;
          const bh = bgNode.height ?? 1;
          const aspectDiff = aspectDeltaRelativeToTarget(bw, bh, targetWidth, targetHeight);
          if (aspectDiff < 0.2) {
            bgNode.resize(targetWidth, targetHeight);
            setPositionInFrame(bgNode, frame, 0, 0);
          } else {
            scaleToFill(bgNode, targetWidth, targetHeight);
          }
        }
        if (bgNode.parent === frame) {
          try {
            if ((frame.children ?? []).indexOf(bgNode) > 0) frame.insertChild!(0, bgNode);
          } catch (_) {}
        }
      } catch (_) {}
    }
  }

  function isCenterAlignedInGuide(el: GuideElement): boolean {
    const left = el.left ?? 0;
    const wr = el.widthRatio ?? 0;
    const centerLeft = (1 - wr) / 2;
    return Math.abs(left - centerLeft) < 0.08;
  }

  for (const { el, slotType } of guideSlots) {
    if (slotType === 'background' && el.fill) continue;
    const list = byType.get(slotType);
    if (!list || list.length === 0) continue;
    const unused = list.filter(x => !used.has(x.node.id));
    if (unused.length === 0) continue;
    const candidate = unused.length === 1 ? unused[0] : (() => {
      const wr0 = el.widthRatio ?? 0;
      const hr0 = el.heightRatio ?? 0;
      const gx = (el.left ?? 0) + wr0 / 2;
      const gy = (el.top ?? 0) + hr0 / 2;
      let best = unused[0];
      let bestDist = Infinity;
      for (const item of unused) {
        const b = getBoundsInFrame(item.node, frame);
        const nx = (b.x + b.w / 2 - slotOx) / Math.max(slotPw, 1e-6);
        const ny = (b.y + b.h / 2 - slotOy) / Math.max(slotPh, 1e-6);
        const dist = (nx - gx) ** 2 + (ny - gy) ** 2;
        if (dist < bestDist) {
          bestDist = dist;
          best = item;
        }
      }
      return best;
    })();
    used.add(candidate.node.id);
    const node = candidate.node;

    if (el.widthRatio == null || el.heightRatio == null) {
      let frameX = slotOx + (el.left ?? 0) * slotPw;
      let frameY = slotOy + (el.top ?? 0) * slotPh;
      const nodeW = node.width;
      const nodeH = node.height;
      frameX = Math.max(slotOx, Math.min(frameX, slotOx + slotPw - nodeW));
      frameY = Math.max(slotOy, Math.min(frameY, slotOy + slotPh - nodeH));
      try { setPositionInFrame(node, frame, frameX, frameY); } catch (_) {}
      continue;
    }

    const guideW = Math.max(1, Math.round(el.widthRatio * slotPw));
    const guideH = Math.max(1, Math.round(el.heightRatio * slotPh));
    let frameX = slotOx + (el.left ?? 0) * slotPw;
    let frameY = slotOy + (el.top ?? 0) * slotPh;
    if (!opts?.exactPlacement && isCenterAlignedInGuide(el)) {
      frameX = slotOx + (slotPw - guideW) / 2;
    }
    frameX = Math.max(slotOx, Math.min(frameX, slotOx + slotPw - guideW));
    frameY = Math.max(slotOy, Math.min(frameY, slotOy + slotPh - guideH));
    try {
      setPositionInFrame(node, frame, frameX, frameY);
    } catch (_) {}

    if (node.type === NodeType.Text) {
      try {
        if (
          'textAlignHorizontal' in node &&
          !opts?.exactPlacement &&
          !el.rememberTextAlign
        ) {
          try {
            node.textAlignHorizontal = isCenterAlignedInGuide(el) ? 'CENTER' : 'LEFT';
          } catch (_) {}
        }
        const rememberSizedTextToSlot = await applyRememberToTextNode(
          node,
          el,
          targetWidth,
          targetHeight
        );
        if (!rememberSizedTextToSlot) {
          const cw = node.width;
          const ch = node.height;
          if (cw > 0 && ch > 0) {
            const scale = uniformScaleForLetterbox(cw, ch, guideW, guideH, 'contain');
            if (scale > 0 && scale !== 1) await scaleElement(node, scale, slotType, true);
          }
        }
        if (node.resize) {
          if (slotType === 'title' || slotType === 'description' || slotType === 'disclaimer') {
            await fitTextInSlotPreserveProportions(node, slotType, guideW, guideH);
          } else {
            node.resize(guideW, guideH);
          }
        }
      } catch (_) {}
      continue;
    }

    if (slotType === 'button') {
      const fit = getButtonFitSizeInFrame(node, frame);
      if (fit) {
        try {
          const scale = buttonUniformScaleForSlot(guideW, guideH, fit.cw, fit.ch, targetHeight);
          await scaleButtonFrameUniform(node, scale);
          if (node.type !== NodeType.Instance && node.type !== NodeType.Component) {
            applyRememberToShapeNode(node, el, targetWidth, targetHeight);
          }
          const bb = getBoundsInFrame(node, frame);
          const nw = Math.max(bb.w, 1);
          const nh = Math.max(bb.h, 1);
          let finalX = frameX;
          if (!opts?.exactPlacement && isCenterAlignedInGuide(el)) {
            finalX = slotOx + (slotPw - nw) / 2;
          }
          finalX = Math.max(slotOx, Math.min(finalX, slotOx + slotPw - nw));
          const finalY = Math.max(slotOy, Math.min(frameY, slotOy + slotPh - nh));
          setPositionInFrame(node, frame, finalX, finalY);
        } catch (_) {}
        continue;
      }
    }

    if ('resize' in node) {
      try {
        const cw = node.width;
        const ch = node.height;
        if (node.type === NodeType.Instance || node.type === NodeType.Component) {
          const u = uniformScaleForLetterbox(cw, ch, guideW, guideH, 'contain');
          if (u > 0 && Math.abs(u - 1) > 0.0001) {
            if (node.rescale) {
              node.rescale(u);
            } else {
              await scaleElement(node, u, slotType, false);
            }
          }
          const px = frameX + Math.max(0, (guideW - node.width) / 2);
          const py = frameY + Math.max(0, (guideH - node.height) / 2);
          const finalX = Math.max(slotOx, Math.min(px, slotOx + slotPw - node.width));
          const finalY = Math.max(slotOy, Math.min(py, slotOy + slotPh - node.height));
          setPositionInFrame(node, frame, finalX, finalY);
        } else if (opts?.afterUniformLetterbox) {
          const scaleFit = slotUniformScaleFit(
            node,
            slotType,
            guideW,
            guideH,
            cw,
            ch,
            targetWidth * targetHeight,
            targetWidth,
            targetHeight
          );
          const deep = node.type === NodeType.Frame || node.type === NodeType.Group;
          if (scaleFit > 0 && Math.abs(scaleFit - 1) > 0.0001) {
            if (typeof node.rescale === 'function') {
              try {
                node.rescale!(scaleFit);
              } catch (_) {
                await scaleElement(node, scaleFit, slotType, deep);
              }
            } else {
              await scaleElement(node, scaleFit, slotType, deep);
            }
          }
          applyRememberToShapeNode(node, el, targetWidth, targetHeight);
          const nw = node.width;
          const nh = node.height;
          let px = frameX + Math.max(0, (guideW - nw) / 2);
          const py = frameY + Math.max(0, (guideH - nh) / 2);
          if (!opts?.exactPlacement && isCenterAlignedInGuide(el)) {
            px = Math.max(slotOx, slotOx + (slotPw - nw) / 2);
          }
          const finalX = Math.max(slotOx, Math.min(px, slotOx + slotPw - nw));
          const finalY = Math.max(slotOy, Math.min(py, slotOy + slotPh - nh));
          setPositionInFrame(node, frame, finalX, finalY);
        } else {
          node.resize(guideW, guideH);
          applyRememberToShapeNode(node, el, targetWidth, targetHeight);
          const finalX = Math.max(slotOx, Math.min(frameX, slotOx + slotPw - node.width));
          const finalY = Math.max(slotOy, Math.min(frameY, slotOy + slotPh - node.height));
          setPositionInFrame(node, frame, finalX, finalY);
        }
      } catch (_) {}
    }
  }
}
