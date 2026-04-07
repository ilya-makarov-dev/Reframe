import { type INode, NodeType } from '../../host';
import { getHost } from '../../host/context';
import { BannerElementType, GuideElement } from '../contracts/types';
import type { ExactSessionGeometryOptions, ExactSessionPlacement } from './exact-session-types';
import { resolveExactSessionLayout } from './session-slots';
import { getCtaGroupWrapper } from './semantic-logo-cta';
import { collectAllDescendants, getBoundsInFrame, getLayoutBoundsInFrame } from './layout-utils';
import {
  buildCrossFrameSessionPlacements,
  resolveSourceNodeIdForCrossMasterSlot
} from './cross-frame-placements';
import { captureRememberFieldsFromNode } from './session-slots';

export { mergeGuideSlotElements, coalesceEllipseClusterPlacements } from './session-placement-merge';
export { buildCrossFrameSessionPlacements, resolveSourceNodeIdForCrossMasterSlot };

/** Remember rows (same shape as `oLD` SessionSlotLike). */
export interface SessionSlotLike {
  sourceNodeId: string;
  slotType: BannerElementType;
  element: GuideElement;
  /** Some call sites use `nodeId` instead of `sourceNodeId`. */
  nodeId?: string;
}

export function sortNodesByPositionInFrame(nodes: INode[], frame: INode): void {
  nodes.sort((a, b) => {
    const ab = getBoundsInFrame(a, frame);
    const bb = getBoundsInFrame(b, frame);
    if (Math.abs(ab.y - bb.y) > 10) return ab.y - bb.y;
    return ab.x - bb.x;
  });
}

export function collectDisclaimerCrossSourceNodes(
  frame: INode,
  slotMap: Map<string, BannerElementType>
): INode[] {
  const all = collectAllDescendants(frame);
  return all.filter(n => slotMap.get(n.id) === 'disclaimer');
}

export { layoutAspectSpread } from '../geometry/aspect';

/**
 * Intersection of layout-bounds with source frame; allow moderate bleed in coordinates,
 * otherwise background/decor slots collapse to 0.
 */
function clampLayoutBoundsWithBleed(
  b: { x: number; y: number; w: number; h: number },
  W: number,
  H: number
): { x: number; y: number; w: number; h: number } | null {
  /** Allow bleed up to 100% of frame size in any direction. */
  const marginW = W;
  const marginH = H;
  const x2 = Math.min(W + marginW, b.x + b.w);
  const y2 = Math.min(H + marginH, b.y + b.h);
  const x1 = Math.max(-marginW, b.x);
  const y1 = Math.max(-marginH, b.y);
  const w = x2 - x1;
  const h = y2 - y1;
  if (w <= 1e-6 || h <= 1e-6) return null;
  return { x: x1, y: y1, w, h };
}

/**
 * Fractions in frame coordinate system; with broken master/bounds left+widthRatio can exceed 1.
 * Now allows moderate overflow beyond [0, 1] to support bleed effects and decor.
 */
export function sanitizeGuideElementFractionsInFrame(el: GuideElement): GuideElement {
  if (el.left == null || el.top == null || el.widthRatio == null || el.heightRatio == null) {
    return el;
  }
  const widthRatio = Math.max(1e-9, Math.min(4, el.widthRatio));
  const heightRatio = Math.max(1e-9, Math.min(4, el.heightRatio));
  /** Allow coordinates from -2 to +3 to capture background bleeds. */
  let left = Math.max(-2, Math.min(3, el.left));
  let top = Math.max(-2, Math.min(3, el.top));
  if (left + widthRatio > 4) {
    left = Math.max(-2, 4 - widthRatio);
  }
  if (top + heightRatio > 4) {
    top = Math.max(-2, 4 - heightRatio);
  }
  return { ...el, left, top, widthRatio, heightRatio };
}

/**
 * Set pixel x,y,w,h for slots the same way as `applyExactSessionPostProcess` (letterbox / cluster),
 * so audit and logs match the actual placement after `rewriteCrossPlacementsFromSourceGeometry`.
 */
export function syncPlacementPixelRectsFromElements(
  placements: ExactSessionPlacement[],
  geometry: ExactSessionGeometryOptions,
  targetWidth: number,
  targetHeight: number,
  forceLetterboxSourceBasis = false
): ExactSessionPlacement[] {
  // [Production Strategy: Coordinate Parity]
  // We MUST use the same basis calculation logic (ox, oy, u)
  // as the main post-process (resolveExactSessionLayout).
  // If they diverge — Health Check fails with Max Delta > 200px.
  const { Rw, Rh, ox, oy } = resolveExactSessionLayout(targetWidth, targetHeight, geometry, forceLetterboxSourceBasis);

  const clusterNativeRescale =
    geometry.clusterNativeRescale === true && geometry.mode === 'strict';

  const slotRw = clusterNativeRescale ? targetWidth : Rw;
  const slotRh = clusterNativeRescale ? targetHeight : Rh;
  /** u is already inside Rw/Rh; for expected-rect multiply fractions by slotRw/slotRh directly. */
  const slotU = 1;
  /** IMPORTANT: With Rw/Rh calculated above, slotU for 'expected' must be 1,
   * since u is already multiplied in Rw = Sw * u. */
  const slotOx = clusterNativeRescale ? 0 : ox;
  const slotOy = clusterNativeRescale ? 0 : oy;

  return placements.map(p => {
    const el = sanitizeGuideElementFractionsInFrame(p.element);
    if (el.left == null || el.top == null || el.widthRatio == null || el.heightRatio == null) {
      return p;
    }
    const guideW = Math.max(1, Math.round(el.widthRatio * slotRw * slotU));
    const guideH = Math.max(1, Math.round(el.heightRatio * slotRh * slotU));
    /**
     * Allow overflow beyond [0, target] (bleed / decor / groups).
     * Only clamp truly insane values (+/- 2 screens).
     */
    const limitX = targetWidth * 2;
    const limitY = targetHeight * 2;
    const frameX = Math.max(-limitX, Math.min((el.left ?? 0) * slotRw * slotU + slotOx, limitX));
    const frameY = Math.max(-limitY, Math.min((el.top ?? 0) * slotRh * slotU + slotOy, limitY));
    return { ...p, element: el, x: frameX, y: frameY, w: guideW, h: guideH };
  });
}

/**
 * Same pixels as slots after `syncPlacementPixelRectsFromElements`, using absolute bounds in live source.
 * Needed for hero/img and button groups without a slot: nested letterbox gives different rect than ox+fraction*Rw.
 * [Fix: Basis Sync] Can now accept pre-calculated layout (Rw, Rh, ox, oy)
 * to avoid recalculating it with forced letterbox.
 */
export function computePixelRectFromSourceLayoutBounds(
  b: { x: number; y: number; w: number; h: number },
  geometry: ExactSessionGeometryOptions,
  targetWidth: number,
  targetHeight: number,
  layoutOverride?: { Rw: number; Rh: number; u: number; ox: number; oy: number }
): { x: number; y: number; w: number; h: number } {
  if (layoutOverride) {
    const { Rw, Rh, ox, oy } = layoutOverride;
    const W = Math.max(1, geometry.sourceWidth ?? targetWidth);
    const H = Math.max(1, geometry.sourceHeight ?? targetHeight);

    const left = b.x / W;
    const top = b.y / H;
    const widthRatio = b.w / W;
    const heightRatio = b.h / H;

    const fw = Math.max(1, Math.round(widthRatio * Rw));
    const fh = Math.max(1, Math.round(heightRatio * Rh));
    const fx = ox + left * Rw;
    const fy = oy + top * Rh;

    return { x: fx, y: fy, w: fw, h: fh };
  }

  const W = Math.max(1, geometry.sourceWidth ?? targetWidth);
  const H = Math.max(1, geometry.sourceHeight ?? targetHeight);
  const synced = syncPlacementPixelRectsFromElements(
    [
      {
        resultNodeId: '__align__',
        slotType: 'description',
        element: {
          name: '_align',
          type: 'shape',
          fill: false,
          left: b.x / W,
          top: b.y / H,
          widthRatio: b.w / W,
          heightRatio: b.h / H
        },
        x: 0,
        y: 0,
        w: 0,
        h: 0
      }
    ],
    geometry,
    targetWidth,
    targetHeight,
    true // [Proportions Fix] Force source aspect ratio for non-slot images
  );
  const p = synced[0];
  return { x: p.x ?? 0, y: p.y ?? 0, w: p.w ?? 1, h: p.h ?? 1 };
}

/**
 * Rewrite slot fractions from live source — otherwise mixed master/source coords at strong spread.
 * [Production Guard]: In cross-mode, if master aspect (Cw/Ch) differs significantly from source (W/H),
 * we preserve master fractions if the node was successfully mapped 1-to-1.
 * This prevents content "sliding" to edges during Portrait -> Landscape transitions.
 */
export function rewriteCrossPlacementsFromSourceGeometry(
  placements: ExactSessionPlacement[],
  sourceFrame: INode,
  sourceToResult: Map<string, string>,
  options: ExactSessionGeometryOptions,
  masterFrame?: INode | null,
  targetWidth?: number,
  targetHeight?: number
): ExactSessionPlacement[] {
  const resultToSource = new Map<string, string>();
  for (const [s, r] of sourceToResult) {
    resultToSource.set(r, s);
  }
  const W = Math.max(sourceFrame.width, 1e-6);
  const H = Math.max(sourceFrame.height, 1e-6);
  const byId = new Map<string, INode>();
  for (const n of collectAllDescendants(sourceFrame)) {
    byId.set(n.id, n);
  }

  const capW = options.capture?.width ?? W;
  const capH = options.capture?.height ?? H;
  const captureAR = capW / Math.max(capH, 1e-6);
  const sourceAR = W / H;

  const targetW = targetWidth ?? capW;
  const targetH = targetHeight ?? capH;
  const targetAR = targetW / Math.max(targetH, 1e-6);

  /**
   * [Production Strategy: Geometric Authority]
   * If target shape matches Master (Remember snapshot), we MUST
   * use Master fractions — user already configured layout for this aspect.
   * Ignore source proportions (9:16) to avoid "squishing".
   */
  const crossKeepMasterFractions =
    options.mode === 'cross' &&
    (Math.abs(captureAR - sourceAR) <= 0.02 || Math.abs(targetAR - captureAR) <= 0.02);

  return placements.map(p => {
    /**
     * [Production Strategy: Master Supremacy / Final Lock]
     * Cross + same aspect template<->live: trust master fractions. If aspects diverged (1081^2 vs 1081x1921),
     * below we blend in live geometry — otherwise slots and ALIGN(img/groups) diverge.
     */
    if (options.mode === 'cross' && p.masterSourceNodeId && crossKeepMasterFractions) {
      /**
       * [Production Guard: Insane Fraction Rejection]
       * Master capture can contain duplicate slots from deeply nested transformed copies
       * with wildly negative fractions (e.g. left=-15, top=-28). Even after sanitize clamps
       * to [-2, 3], these produce positions thousands of px outside the frame.
       * When fractions are clearly insane (outside [-0.5, 1.5] for non-background slots),
       * fall through to live-geometry rewrite instead of trusting master fractions.
       */
      const el = p.element;
      const isBg = p.slotType === 'background';
      const fractionsInsane = !isBg && (
        el.left != null && (el.left < -0.5 || el.left > 1.5) ||
        el.top != null && (el.top < -0.5 || el.top > 1.5)
      );
      if (!fractionsInsane) {
        return { ...p, element: sanitizeGuideElementFractionsInFrame(p.element) };
      }
      /**
       * [Production Guard: Master Duplicate Resolution]
       * The matched master node has insane fractions (from a nested transformed copy).
       * Search the master frame for a different node with the same name+type that has
       * sane fractions — that's the "real" design element with correct portrait positions.
       * This preserves the master's intended layout instead of falling back to source geometry.
       */
      if (masterFrame) {
        try {
          const badNode = getHost().getNodeById(p.masterSourceNodeId) as INode | null;
          const nodeName = badNode && 'name' in badNode ? String(badNode.name) : '';
          if (nodeName) {
            const mW = Math.max(masterFrame.width, 1e-6);
            const mH = Math.max(masterFrame.height, 1e-6);
            let bestLeft = -Infinity;
            let bestTop = -Infinity;
            let bestWR = 0;
            let bestHR = 0;
            let found = false;
            for (const mn of collectAllDescendants(masterFrame)) {
              if (mn === masterFrame || mn.id === p.masterSourceNodeId) continue;
              if (!('name' in mn) || mn.name !== nodeName) continue;
              const mb = getBoundsInFrame(mn, masterFrame);
              const l = mb.x / mW;
              const t = mb.y / mH;
              if (l < -0.5 || l > 1.5 || t < -0.5 || t > 1.5) continue;
              if (mb.w < 1 || mb.h < 1) continue;
              bestLeft = l;
              bestTop = t;
              bestWR = mb.w / mW;
              bestHR = mb.h / mH;
              found = true;
              break;
            }
            if (found) {
              return {
                ...p,
                element: sanitizeGuideElementFractionsInFrame({
                  ...el,
                  left: bestLeft,
                  top: bestTop,
                  widthRatio: bestWR,
                  heightRatio: bestHR
                })
              };
            }
          }
        } catch (_) { /* fallback to source geometry below */ }
      }
      // Fall through to live-geometry rewrite for insane fractions
    }

    let sid: string | undefined;
    if (p.masterSourceNodeId) {
      sid = resolveSourceNodeIdForCrossMasterSlot(
        p.masterSourceNodeId,
        sourceFrame,
        sourceToResult,
        masterFrame ?? null
      );
    }
    if (sid == null) sid = resultToSource.get(p.resultNodeId);

    if (!sid) return { ...p, element: sanitizeGuideElementFractionsInFrame(p.element) };
    const node = byId.get(sid);
    if (!node) return { ...p, element: sanitizeGuideElementFractionsInFrame(p.element) };
    const raw = getLayoutBoundsInFrame(node, sourceFrame);
    if (raw.w <= 0 || raw.h <= 0) return { ...p, element: sanitizeGuideElementFractionsInFrame(p.element) };
    const b = clampLayoutBoundsWithBleed(raw, W, H);
    if (!b) {
      return { ...p, element: sanitizeGuideElementFractionsInFrame(p.element) };
    }
    return {
      ...p,
      element: sanitizeGuideElementFractionsInFrame({
        ...p.element,
        left: b.x / W,
        top: b.y / H,
        widthRatio: b.w / W,
        heightRatio: b.h / H
      })
    };
  });
}

/**
 * Strict Remember: slot fractions from **live** sourceFrame (`getLayoutBoundsInFrame`), as in
 * `oLD (bun unstuble)/src/postprocess/guide-scaler.ts:buildStrictPlacementsWithLiveGeometry`.
 * Don't filter by structural path and don't require `getNodeById` on result — otherwise some slots
 * drop out and layout "breaks entirely".
 */
export function buildStrictPlacementsWithLiveGeometry(
  sourceFrame: INode,
  slots: ReadonlyArray<SessionSlotLike>,
  sourceToResult: Map<string, string>
): ExactSessionPlacement[] {
  const W = Math.max(sourceFrame.width, 1e-6);
  const H = Math.max(sourceFrame.height, 1e-6);
  const byId = new Map<string, INode>();
  for (const n of collectAllDescendants(sourceFrame)) {
    byId.set(n.id, n);
  }
  const out: ExactSessionPlacement[] = [];

  for (const s of slots) {
    const sid = (s.sourceNodeId ?? s.nodeId) as string | undefined;
    if (!sid) continue;
    const resultNodeId = sourceToResult.get(sid);
    if (!resultNodeId) continue;
    const node = byId.get(sid);
    let element: GuideElement = { ...s.element };
    let x = 0;
    let y = 0;
    let w = 0;
    let h = 0;
    if (node) {
      const b = getLayoutBoundsInFrame(node, sourceFrame);
      if (b.w > 0 && b.h > 0) {
        element = {
          ...s.element,
          left: b.x / W,
          top: b.y / H,
          widthRatio: b.w / W,
          heightRatio: b.h / H
        };
        x = b.x;
        y = b.y;
        w = b.w;
        h = b.h;
      }
    }
    /**
     * [Production Guard: Insane Fraction Rejection — Strict]
     * Master captures can include duplicate slots from nested transformed copies
     * with wildly negative positions (e.g. x=-16222). These are NOT real layout slots.
     * Skip non-background placements whose fractions are clearly outside the frame.
     */
    const isBg = s.slotType === 'background';
    if (!isBg && element.left != null && element.top != null) {
      const insane =
        element.left < -0.5 || element.left > 1.5 ||
        element.top < -0.5 || element.top > 1.5;
      if (insane) continue;
    }
    out.push({ resultNodeId, slotType: s.slotType, element, x, y, w, h });
  }
  return out;
}

/** Like `oLD`: don't position text inside button as a separate slot (double scale). */
export function filterPlacementsSkipInsideButtonFrames(
  placements: ExactSessionPlacement[],
  frame: INode,
  nodeById: Map<string, INode>
): ExactSessionPlacement[] {
  const byId = new Map(placements.map(p => [p.resultNodeId, p] as const));
  const buttonFrameIds = new Set<string>();
  for (const p of placements) {
    if (p.slotType !== 'button') continue;
    buttonFrameIds.add(p.resultNodeId);
    const n = nodeById.get(p.resultNodeId);
    if (!n) continue;
    try {
      const cta = getCtaGroupWrapper(n, frame);
      if (cta) buttonFrameIds.add(cta.id);
    } catch (_) {}
  }
  return placements.filter(p => {
    if (p.slotType === 'button') return true;
    const node = nodeById.get(p.resultNodeId);
    if (!node) return true;
    let q: INode | null = node.parent;
    while (q && q !== frame) {
      if (buttonFrameIds.has(q.id)) return false;
      const anc = byId.get(q.id);
      if (anc?.slotType === 'button') return false;
      q = q.parent;
    }
    return true;
  });
}

export function filterExactSessionPlacements(
  frame: INode,
  placements: ExactSessionPlacement[]
): ExactSessionPlacement[] {
  const allNodes = collectAllDescendants(frame).slice(1);
  const nodeById = new Map<string, INode>();
  for (const n of allNodes) nodeById.set(n.id, n);
  return filterPlacementsSkipInsideButtonFrames(placements, frame, nodeById);
}


export function enrichCrossPlacementElementFromMasterLive(
  el: GuideElement,
  masterNode: INode,
  masterFrameW: number,
  masterFrameH: number
): GuideElement {
  const cap = captureRememberFieldsFromNode(masterNode, masterFrameW, masterFrameH);
  return { ...el, ...cap };
}
