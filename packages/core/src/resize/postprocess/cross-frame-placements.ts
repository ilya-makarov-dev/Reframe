/**
 * Cross-master slot matching -- port of `oLD/.../guide-scaler.ts:buildCrossFrameSessionPlacements`
 * (candidates by geometry, ordinal Y for strong aspect spread, `other` by visual signature, guard for button/logo).
 */
import { type INode, NodeType, MIXED } from '../../host';
import { getHost } from '../../host/context';

import type { BannerElementType, GuideElement } from '../contracts/types';
import { layoutAspectSpread } from '../geometry/aspect';
import { centeredLetterboxOffsets } from '../geometry/fit';
import type { ExactSessionPlacement } from './exact-session-types';
import { tryResolveNodeById } from './figma-node-resolve';
import { collectAllDescendants, getBoundsInFrame } from './layout-utils';
import {
  assignSemanticTypes,
  collectAgePatternTextNodesInFrame,
  scoreAgeLabelSourceVsMasterSlot,
  subtreeHasVisibleImageFill
} from './semantic-classifier';
import {
  logoCornerDistanceNorm,
  logoInstanceStructuralBoost,
  logoLockupStructureBoost,
  looksLikeButtonHitRectBounds,
  looksLikeCtaLabelText,
  looksLikeLogoTypographyText,
  subtreeHasCtaRectTextOverlapStack
} from './semantic-logo-cta';
import { getStructuralPathKey } from './node-id-mapper';
import { captureRememberFieldsFromNode, type SessionSlotSnapshot } from './session-slots';
import {
  visualSigFromAnyDecorNode,
  visualSigFromMasterOtherRow,
  visualSignatureDistance
} from './cross-frame-visual-signature';
import { coalesceEllipseClusterPlacements } from './session-placement-merge';
import {
  compareExactSessionStableOrder,
  EXACT_SESSION_STABLE_ORDER_PRIORITY
} from './session-placement-order';
import { isDescendantOfFrameForAuto } from './semantic-slot-geometry';

const CROSS_OTHER_ASPECT_SPREAD_THRESH = 0.06;
const CROSS_OTHER_POS_AUX_WEIGHT = 0.08;
const CROSS_ORDINAL_MATCH_ASPECT_SPREAD = 0.12;

const CROSS_ORDINAL_SLOT_TYPES: readonly BannerElementType[] = [
  'title',
  'description',
  'disclaimer',
  'ageRating',
  'button',
  'logo'
];

const CROSS_TEXT_FALLBACK_TYPES: ReadonlySet<BannerElementType> = new Set([
  'title',
  'description',
  'disclaimer',
  'ageRating'
]);

type CrossMasterRow = {
  sourceNodeId: string;
  slotType: BannerElementType;
  element: GuideElement;
  visualSignature?: unknown;
};

function logoGraphicCandidateScoreCross(
  node: INode,
  corner: number,
  area: number,
  areaFrame: number
): number {
  const lock = logoLockupStructureBoost(node, area, areaFrame);
  const inst = logoInstanceStructuralBoost(node, area, areaFrame);
  let s = inst + lock;
  s +=
    node.type === NodeType.Instance ? 500 : node.type === NodeType.Component ? 480 : node.type === NodeType.Group ? 260 : 140;
  const frac = Math.max(area / Math.max(areaFrame, 1), 1e-9);
  const ideal = 0.045;
  s -= Math.min(420, Math.abs(Math.log(frac / ideal)) * 200);
  if (inst === 0 && lock === 0) {
    s -= Math.max(0, corner - 0.14) * 95;
  }
  return s;
}

function sortNodesByYThenX(nodes: INode[], frame: INode): void {
  nodes.sort((a, b) => {
    const ba = getBoundsInFrame(a, frame);
    const bb = getBoundsInFrame(b, frame);
    return ba.y - bb.y || ba.x - bb.x;
  });
}

function rectOverlapArea(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function filterNodesForCrossSemantics(frame: INode, nodes: INode[]): INode[] {
  const W = Math.max(frame.width, 1);
  const H = Math.max(frame.height, 1);
  const margin = 1.2 * Math.max(W, H);
  return nodes.filter(n => {
    if (n.removed) return false;
    try {
      const b = getBoundsInFrame(n, frame);
      if (b.w <= 0 || b.h <= 0) return false;
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      return cx >= -margin && cx <= W + margin && cy >= -margin && cy <= H + margin;
    } catch {
      return false;
    }
  });
}

function textIsInsidePillButtonShellHierarchy(t: INode, frame: INode): boolean {
  const W = Math.max(frame.width, 1);
  const H = Math.max(frame.height, 1);
  let cur: INode | null = t.parent;
  while (cur && cur !== frame) {
    if (cur.type === NodeType.Frame || cur.type === NodeType.Group || cur.type === NodeType.Component) {
      const pb = getBoundsInFrame(cur as INode, frame);
      if (looksLikeButtonHitRectBounds(pb, W, H)) return true;
    }
    cur = cur.parent;
  }
  return false;
}

function buildSemanticByType(nodes: INode[], frame: INode): Map<BannerElementType, INode[]> {
  const semanticMap = assignSemanticTypes(nodes, frame);
  const byType = new Map<BannerElementType, INode[]>();
  for (const node of nodes) {
    const t = semanticMap.get(node.id);
    if (t == null) continue;
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(node);
  }
  for (const list of byType.values()) sortNodesByYThenX(list, frame);
  return byType;
}

function collectDisclaimerCrossSourceNodes(
  byTypeSource: Map<BannerElementType, INode[]>,
  srcFrame: INode
): INode[] {
  const W = Math.max(srcFrame.width, 1);
  const H = Math.max(srcFrame.height, 1);
  const ar = W / H;
  const ultraWide = ar >= 2.0;
  const shortBanner = H < 420;
  const minCenterY = ultraWide || shortBanner ? 0.56 : 0.66;
  const minChars = ultraWide ? 18 : 28;
  const maxFs = ultraWide ? 21 : 19;

  const out: INode[] = [];
  const seen = new Set<string>();
  const pushIf = (n: INode) => {
    if (seen.has(n.id) || n.type !== NodeType.Text) return;
    const b = getBoundsInFrame(n, srcFrame);
    const cy = (b.y + b.h / 2) / H;
    const len = (n.characters ?? '').length;
    const fs = typeof n.fontSize === 'number' ? n.fontSize : 12;
    if (cy >= minCenterY && len >= minChars && fs <= maxFs) {
      seen.add(n.id);
      out.push(n);
    }
  };
  for (const n of byTypeSource.get('disclaimer') ?? []) pushIf(n);
  for (const n of byTypeSource.get('description') ?? []) pushIf(n);
  out.sort((a, b) => {
    const ba = getBoundsInFrame(a, srcFrame);
    const bb = getBoundsInFrame(b, srcFrame);
    return ba.y - bb.y || ba.x - bb.x;
  });
  return out;
}

function crossOtherDecorMatchDistance(
  row: CrossMasterRow,
  s: INode,
  srcFrame: INode,
  masterRw: number,
  masterRh: number
): number {
  const wr = row.element.widthRatio ?? 0;
  const hr = row.element.heightRatio ?? 0;
  const masterNx = row.element.left != null ? row.element.left + wr / 2 : 0.5;
  const masterNy = row.element.top != null ? row.element.top + hr / 2 : 0.5;
  const sW = Math.max(srcFrame.width, 1e-6);
  const sH = Math.max(srcFrame.height, 1e-6);
  const sb = getBoundsInFrame(s, srcFrame);
  const srcNx = (sb.x + sb.w / 2) / sW;
  const srcNy = (sb.y + sb.h / 2) / sH;
  const posD = (masterNx - srcNx) ** 2 + (masterNy - srcNy) ** 2;
  const sigM = visualSigFromMasterOtherRow(row as unknown as SessionSlotSnapshot, masterRw, masterRh);
  const sigS = visualSigFromAnyDecorNode(s, srcFrame);
  if (!sigM || !sigS) return 500 + CROSS_OTHER_POS_AUX_WEIGHT * Math.min(posD, 3);
  const visD = visualSignatureDistance(sigM, sigS);
  return visD + CROSS_OTHER_POS_AUX_WEIGHT * Math.min(posD, 3);
}

function enrichCrossPlacementElementFromMasterLive(
  el: GuideElement,
  masterSourceNodeId: string,
  masterFrameW: number,
  masterFrameH: number
): GuideElement {
  const n = tryResolveNodeById(masterSourceNodeId);
  if (!n || (n.removed)) return { ...el };
  const cap = captureRememberFieldsFromNode(n, masterFrameW, masterFrameH);
  return { ...el, ...cap };
}

export function resolveSourceNodeIdForCrossMasterSlot(
  masterSourceNodeId: string,
  sourceFrame: INode,
  sourceToResult: Map<string, string>,
  masterFrame: INode | null | undefined
): string | undefined {
  if (sourceToResult.has(masterSourceNodeId)) return masterSourceNodeId;

  const mf = masterFrame;
  if (!mf) return undefined;

  const mn = tryResolveNodeById(masterSourceNodeId);
  if (!mn || (mn.removed)) return undefined;
  if (mn === mf) return undefined;
  if (!isDescendantOfFrameForAuto(mn as INode, mf)) return undefined;

  const masterName = 'name' in mn ? String((mn as INode & { name: string }).name) : '';
  const mW = Math.max(mf.width, 1e-6);
  const mH = Math.max(mf.height, 1e-6);
  const mb = getBoundsInFrame(mn as INode, mf);
  const mcx = (mb.x + mb.w / 2) / mW;
  const mcy = (mb.y + mb.h / 2) / mH;

  const src = sourceFrame;
  const sW = Math.max(src.width, 1e-6);
  const sH = Math.max(src.height, 1e-6);

  let bestSid: string | undefined;
  let bestD = Infinity;

  for (const sn of collectAllDescendants(src)) {
    if (sn === src) continue;
    if (sn.removed) continue;
    if (sn.type !== mn.type) continue;
    const snName = 'name' in sn ? String((sn as INode & { name: string }).name) : '';
    if (snName !== masterName) continue;
    if (!sourceToResult.has(sn.id)) continue;
    const sb = getBoundsInFrame(sn, src);
    const scx = (sb.x + sb.w / 2) / sW;
    const scy = (sb.y + sb.h / 2) / sH;
    const d = (mcx - scx) ** 2 + (mcy - scy) ** 2;
    if (d < bestD) {
      bestD = d;
      bestSid = sn.id;
    }
  }

  return bestSid;
}

function resolveCrossMasterPinnedResultId(
  row: CrossMasterRow,
  opts: {
    sourceFrame: INode;
    sourceToResult: Map<string, string>;
    masterFrame: INode | null | undefined;
  }
): string | undefined {
  const sid = resolveSourceNodeIdForCrossMasterSlot(
    row.sourceNodeId,
    opts.sourceFrame,
    opts.sourceToResult,
    opts.masterFrame
  );
  return sid ? opts.sourceToResult.get(sid) : undefined;
}

export function buildCrossFrameSessionPlacements(
  masterSlots: CrossMasterRow[],
  resultFrame: INode,
  captureSize: { width: number; height: number } | null | undefined,
  opts: {
    sourceFrame: INode;
    sourceToResult: Map<string, string>;
    validateStructuralPath?: boolean;
    skipNearSquareTextOrdinalOverride?: boolean;
    masterFrame?: INode | null;
  }
): ExactSessionPlacement[] {
  const validateStructuralPath = opts.validateStructuralPath === true;

  const resultNodes = filterNodesForCrossSemantics(
    resultFrame,
    collectAllDescendants(resultFrame).slice(1)
  );
  const byTypeResult = buildSemanticByType(resultNodes, resultFrame);

  const isButtonCandidateCache = new Map<string, boolean>();
  const isLogoCandidateCache = new Map<string, boolean>();
  const Wres = Math.max(resultFrame.width, 1);
  const Hres = Math.max(resultFrame.height, 1);
  const rectAreaRes = Math.max(1, resultFrame.width * resultFrame.height);

  function isButtonCandidate(n: INode): boolean {
    const hit = isButtonCandidateCache.get(n.id);
    if (hit != null) return hit;
    const b = getBoundsInFrame(n, resultFrame);
    if (!looksLikeButtonHitRectBounds(b, Wres, Hres)) {
      isButtonCandidateCache.set(n.id, false);
      return false;
    }
    const ok = !subtreeHasVisibleImageFill(n);
    isButtonCandidateCache.set(n.id, ok);
    return ok;
  }

  function isLogoCandidate(n: INode): boolean {
    const hit = isLogoCandidateCache.get(n.id);
    if (hit != null) return hit;
    if (n.type === NodeType.Text) {
      if (textIsInsidePillButtonShellHierarchy(n, resultFrame)) {
        isLogoCandidateCache.set(n.id, false);
        return false;
      }
      if (looksLikeCtaLabelText(n, resultFrame)) {
        isLogoCandidateCache.set(n.id, false);
        return false;
      }
    }
    const b = getBoundsInFrame(n, resultFrame);
    if (looksLikeButtonHitRectBounds(b, Wres, Hres)) {
      isLogoCandidateCache.set(n.id, false);
      return false;
    }
    if (subtreeHasVisibleImageFill(n)) {
      isLogoCandidateCache.set(n.id, false);
      return false;
    }
    if (subtreeHasCtaRectTextOverlapStack(n, resultFrame)) {
      isLogoCandidateCache.set(n.id, false);
      return false;
    }
    let hasLogoTypography = false;
    for (const d of collectAllDescendants(n)) {
      if (d.type === NodeType.Text && looksLikeLogoTypographyText(d)) {
        hasLogoTypography = true;
        break;
      }
    }
    if (hasLogoTypography) {
      isLogoCandidateCache.set(n.id, true);
      return true;
    }
    const area = Math.max(1, b.w * b.h);
    const corner = logoCornerDistanceNorm(b, Wres, Hres);
    const lock = logoLockupStructureBoost(n, area, rectAreaRes);
    const inst = logoInstanceStructuralBoost(n, area, rectAreaRes);
    const score = inst + lock + logoGraphicCandidateScoreCross(n, corner, area, rectAreaRes) * 0.02;
    const ok = score >= 280;
    isLogoCandidateCache.set(n.id, ok);
    return ok;
  }

  const useSourceMap =
    opts?.sourceFrame != null &&
    opts.sourceToResult != null &&
    opts.sourceToResult.size > 0;
  const sourceNodes = useSourceMap
    ? filterNodesForCrossSemantics(opts.sourceFrame, collectAllDescendants(opts.sourceFrame).slice(1))
    : [];
  const byTypeSource = useSourceMap ? buildSemanticByType(sourceNodes, opts.sourceFrame) : null;

  const resultNodeById = new Map<string, INode>();
  for (const n of collectAllDescendants(resultFrame)) resultNodeById.set(n.id, n);

  const cap = captureSize ?? { width: resultFrame.width, height: resultFrame.height };
  const capW = Math.max(cap.width, 1);
  const capH = Math.max(cap.height, 1);
  const srcW = opts?.sourceFrame ? Math.max(opts.sourceFrame.width, 1) : capW;
  const srcH = opts?.sourceFrame ? Math.max(opts.sourceFrame.height, 1) : capH;
  const { u: uCap, offX: oxCap, offY: oyCap } = centeredLetterboxOffsets(
    capW,
    capH,
    resultFrame.width,
    resultFrame.height,
    'contain'
  );

  const targetAR = resultFrame.width / Math.max(resultFrame.height, 1e-6);
  const targetNearSquare = Math.abs(targetAR - 1) < 0.15;
  const sourceNearSquare =
    opts?.sourceFrame != null
      ? Math.abs(opts.sourceFrame.width / Math.max(opts.sourceFrame.height, 1e-6) - 1) < 0.15
      : false;

  const used = new Set<string>();
  const placements: ExactSessionPlacement[] = [];
  let backgroundPickBounds: { x: number; y: number; w: number; h: number } | null = null;

  const slotCandidateFilter = (n: INode, slotType: BannerElementType): boolean => {
    if (slotType === 'other') {
      const b = getBoundsInFrame(n, resultFrame);
      const W = resultFrame.width;
      const H = resultFrame.height;
      const areaF = W * H;
      const ar = (b.w * b.h) / Math.max(areaF, 1e-6);
      const wx = b.w / Math.max(W, 1e-6);
      const hy = b.h / Math.max(H, 1e-6);
      if (ar >= 0.85) return false;
      if (Math.max(wx, hy) >= 0.95) return false;
      if (backgroundPickBounds != null) {
        const bg = backgroundPickBounds;
        const inter = rectOverlapArea(b, bg);
        const aSelf = Math.max(b.w * b.h, 1e-6);
        if (inter / aSelf > 0.55) return false;
      }
    }
    if (slotType === 'button') {
      const b = getBoundsInFrame(n, resultFrame);
      if (!looksLikeButtonHitRectBounds(b, resultFrame.width, resultFrame.height)) return false;
      if (subtreeHasVisibleImageFill(n)) return false;
      return true;
    }
    if (slotType === 'logo') {
      const b = getBoundsInFrame(n, resultFrame);
      if (looksLikeButtonHitRectBounds(b, resultFrame.width, resultFrame.height)) return false;
      if (n.type === NodeType.Text) {
        if (looksLikeCtaLabelText(n, resultFrame)) return false;
        if (textIsInsidePillButtonShellHierarchy(n, resultFrame)) return false;
      }
    }
    return true;
  };

  const sortedMaster = [...masterSlots].sort((a, b) => {
    const pa = EXACT_SESSION_STABLE_ORDER_PRIORITY[a.slotType] ?? 50;
    const pb = EXACT_SESSION_STABLE_ORDER_PRIORITY[b.slotType] ?? 50;
    if (pa !== pb) return pa - pb;
    const at = a.element.top ?? 0;
    const bt = b.element.top ?? 0;
    if (at !== bt) return at - bt;
    const al = a.element.left ?? 0;
    const bl = b.element.left ?? 0;
    if (al !== bl) return al - bl;
    return compareExactSessionStableOrder(
      { slotType: a.slotType, element: a.element },
      { slotType: b.slotType, element: b.element }
    );
  });

  let capSrcSpread = 0;
  if (useSourceMap && opts?.sourceFrame) {
    capSrcSpread = layoutAspectSpread(capW, capH, srcW, srcH);
  }

  const orderedSourceByTypeOrdinal = new Map<BannerElementType, INode[]>();
  const nextOrdinalPick = new Map<BannerElementType, number>();
  if (
    useSourceMap &&
    byTypeSource &&
    opts?.sourceFrame &&
    capSrcSpread > CROSS_ORDINAL_MATCH_ASPECT_SPREAD &&
    !targetNearSquare &&
    !sourceNearSquare
  ) {
    const srcFr = opts.sourceFrame;
    for (const t of CROSS_ORDINAL_SLOT_TYPES) {
      let arr: INode[];
      if (t === 'disclaimer') {
        arr = collectDisclaimerCrossSourceNodes(byTypeSource, srcFr);
      } else {
        arr = [...(byTypeSource.get(t) ?? [])];
        if (t === 'logo') {
          const W = Math.max(srcFr.width, 1);
          const H = Math.max(srcFr.height, 1);
          arr.sort((a, b) => {
            const ba = getBoundsInFrame(a, srcFr);
            const bb = getBoundsInFrame(b, srcFr);
            const da = logoCornerDistanceNorm(ba, W, H);
            const db = logoCornerDistanceNorm(bb, W, H);
            if (da !== db) return da - db;
            return ba.w * ba.h - bb.w * bb.h;
          });
        } else {
          sortNodesByYThenX(arr, srcFr);
        }
        if (t === 'ageRating') arr.reverse();
      }
      orderedSourceByTypeOrdinal.set(t, arr);
      nextOrdinalPick.set(t, 0);
    }
  }

  const TEXT_ORDINAL_SLOT_TYPES: readonly BannerElementType[] = ['title', 'description', 'disclaimer', 'ageRating'];
  const targetRememberSpread = layoutAspectSpread(capW, capH, resultFrame.width, resultFrame.height);
  const enableNearSquareTextOrdinalOverride =
    !opts.skipNearSquareTextOrdinalOverride &&
    useSourceMap &&
    byTypeSource &&
    opts?.sourceFrame &&
    (targetNearSquare || sourceNearSquare) &&
    capSrcSpread > CROSS_ORDINAL_MATCH_ASPECT_SPREAD &&
    targetRememberSpread > 0.06;

  const orderedSourceByTypeOrdinalText = new Map<BannerElementType, INode[]>();
  const nextOrdinalPickText = new Map<BannerElementType, number>();
  if (enableNearSquareTextOrdinalOverride) {
    const srcFr = opts.sourceFrame!;
    for (const t of TEXT_ORDINAL_SLOT_TYPES) {
      let arr: INode[];
      if (t === 'disclaimer') {
        arr = collectDisclaimerCrossSourceNodes(byTypeSource!, srcFr);
      } else {
        arr = [...(byTypeSource!.get(t) ?? [])];
        sortNodesByYThenX(arr, srcFr);
        if (t === 'ageRating') arr.reverse();
      }
      orderedSourceByTypeOrdinalText.set(t, arr);
      nextOrdinalPickText.set(t, 0);
    }
  }

  for (const row of sortedMaster) {
    const pinnedRid =
      useSourceMap && opts?.sourceToResult && row.sourceNodeId && opts.sourceFrame
        ? resolveCrossMasterPinnedResultId(row, {
            sourceFrame: opts.sourceFrame,
            sourceToResult: opts.sourceToResult,
            masterFrame: opts.masterFrame
          })
        : undefined;
    const pinnedNode = pinnedRid ? resultNodeById.get(pinnedRid) : null;
    const pinSlotToSourceMap =
      pinnedRid != null &&
      pinnedNode != null &&
      !(pinnedNode.removed) &&
      !used.has(pinnedRid);

    const wr = row.element.widthRatio ?? 0;
    const hr = row.element.heightRatio ?? 0;
    const gx =
      row.element.left != null && row.element.top != null
        ? (row.element.left + wr / 2) * capW * uCap + oxCap
        : null;
    const gy =
      row.element.left != null && row.element.top != null
        ? (row.element.top + hr / 2) * capH * uCap + oyCap
        : null;

    type Cand = { resultId: string; dist: number };
    const cands: Cand[] = [];

    if (useSourceMap && opts?.sourceFrame && row.slotType === 'ageRating') {
      const srcFrame = opts.sourceFrame;
      const masterNx = row.element.left != null ? row.element.left + wr / 2 : 0.5;
      const masterNy = row.element.top != null ? row.element.top + hr / 2 : 0.5;
      for (const s of collectAgePatternTextNodesInFrame(srcFrame)) {
        const rid = opts.sourceToResult!.get(s.id);
        if (!rid || used.has(rid)) continue;
        const rnode = resultNodeById.get(rid);
        if (!rnode || rnode.removed) continue;
        cands.push({
          resultId: rid,
          dist: scoreAgeLabelSourceVsMasterSlot(s, srcFrame, masterNx, masterNy)
        });
      }
    }

    const pushFromResultNodes = (nodes: INode[]) => {
      for (const n of nodes) {
        if (used.has(n.id)) continue;
        if (!slotCandidateFilter(n, row.slotType)) continue;
        const b = getBoundsInFrame(n, resultFrame);
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        const d = gx != null && gy != null ? (cx - gx) ** 2 + (cy - gy) ** 2 : 0;
        cands.push({ resultId: n.id, dist: d });
      }
    };

    if (useSourceMap && byTypeSource) {
      if (row.slotType === 'other' && capSrcSpread > CROSS_OTHER_ASPECT_SPREAD_THRESH) {
        const srcFrame = opts.sourceFrame!;
        for (const s of byTypeSource.get('other') ?? []) {
          const rid = opts.sourceToResult!.get(s.id);
          if (!rid || used.has(rid)) continue;
          const rnode = resultNodeById.get(rid);
          if (!rnode || rnode.removed) continue;
          if (!slotCandidateFilter(rnode, 'other')) continue;
          cands.push({
            resultId: rid,
            dist: crossOtherDecorMatchDistance(row, s, srcFrame, capW, capH)
          });
        }
      }
      if (cands.length === 0) {
        const srcFrame = opts.sourceFrame!;
        const sW = Math.max(srcFrame.width, 1e-6);
        const sH = Math.max(srcFrame.height, 1e-6);
        const masterNx = row.element.left != null ? row.element.left + wr / 2 : 0.5;
        const masterNy = row.element.top != null ? row.element.top + hr / 2 : 0.5;
        const uniqueById = <T extends INode>(arr: T[]): T[] => {
          const seen = new Set<string>();
          const out: T[] = [];
          for (const x of arr) {
            if (seen.has(x.id)) continue;
            seen.add(x.id);
            out.push(x);
          }
          return out;
        };

        let srcList =
          row.slotType === 'disclaimer'
            ? collectDisclaimerCrossSourceNodes(byTypeSource, srcFrame)
            : (byTypeSource.get(row.slotType) ?? []);

        if (row.slotType === 'logo') {
          const textLogo = sourceNodes.filter(
            n => n.type === NodeType.Text && looksLikeLogoTypographyText(n)
          );
          srcList = uniqueById([...srcList, ...textLogo]);
        }

        if (row.slotType === 'button') {
          const bgIds = new Set((byTypeSource.get('background') ?? []).map(n => n.id));
          const buttonShapes = sourceNodes.filter(n => {
            if (bgIds.has(n.id)) return false;
            if (n.type === NodeType.Text) return false;
            const b = getBoundsInFrame(n, srcFrame);
            if (b.w <= 0 || b.h <= 0) return false;
            return looksLikeButtonHitRectBounds(b, sW, sH);
          });
          srcList = uniqueById([...srcList, ...buttonShapes]);
        }

        for (const s of srcList) {
          const rid = opts.sourceToResult!.get(s.id);
          if (!rid || used.has(rid)) continue;
          const rnode = resultNodeById.get(rid);
          if (!rnode || rnode.removed) continue;
          if (!slotCandidateFilter(rnode, row.slotType)) continue;
          if (
            row.slotType === 'disclaimer' &&
            s.type === NodeType.Text &&
            textIsInsidePillButtonShellHierarchy(s, srcFrame)
          ) {
            continue;
          }

          if (validateStructuralPath && getStructuralPathKey(srcFrame, s) !== getStructuralPathKey(resultFrame, rnode)) {
            continue;
          }

          if (s.type === NodeType.Text && row.slotType !== 'ageRating') {
            const trimmed = (s.characters ?? '').trim();
            const looksAge = /^\d{1,2}\+$/.test(trimmed);
            if (looksAge) continue;
            if (row.slotType !== 'button' && looksLikeCtaLabelText(s, srcFrame)) continue;
          }

          const sb = getBoundsInFrame(s, srcFrame);
          const srcNx = (sb.x + sb.w / 2) / sW;
          const srcNy = (sb.y + sb.h / 2) / sH;
          let d = (masterNx - srcNx) ** 2 + (masterNy - srcNy) ** 2;
          if (row.slotType === 'ageRating' && s.type === NodeType.Text) {
            const trimmed = (s.characters ?? '').trim();
            const looksAge = /^\d{1,2}\+$/.test(trimmed);
            d = 1.2 * (masterNx - srcNx) ** 2 + (masterNy - srcNy) ** 2;
            if (!looksAge) d += 0.55;
            if (trimmed.length > 10) d += (trimmed.length - 10) * 0.04;
            if (srcNx < 0.58) d += 0.35;
          }
          if (row.slotType === 'other' && capSrcSpread <= CROSS_OTHER_ASPECT_SPREAD_THRESH) {
            const sigM = visualSigFromMasterOtherRow(row as unknown as SessionSlotSnapshot, capW, capH);
            const sigS = visualSigFromAnyDecorNode(s, srcFrame);
            if (sigM && sigS) {
              d += 0.52 * visualSignatureDistance(sigM, sigS);
            }
          }
          cands.push({ resultId: rid, dist: d });
        }
      }
      if (
        cands.length === 0 &&
        capSrcSpread > CROSS_ORDINAL_MATCH_ASPECT_SPREAD &&
        CROSS_ORDINAL_SLOT_TYPES.includes(row.slotType) &&
        !sourceNearSquare &&
        !targetNearSquare
      ) {
        const list = orderedSourceByTypeOrdinal.get(row.slotType) ?? [];
        const start = nextOrdinalPick.get(row.slotType) ?? 0;
        for (let j = start; j < list.length; j++) {
          const s = list[j]!;
          if (
            row.slotType === 'disclaimer' &&
            s.type === NodeType.Text &&
            textIsInsidePillButtonShellHierarchy(s, opts.sourceFrame!)
          ) {
            continue;
          }
          const rid = opts.sourceToResult!.get(s.id);
          if (!rid || used.has(rid)) continue;
          const rnode = resultNodeById.get(rid);
          if (!rnode || rnode.removed) continue;
          if (!slotCandidateFilter(rnode, row.slotType)) continue;
          if (validateStructuralPath && getStructuralPathKey(opts.sourceFrame!, s) !== getStructuralPathKey(resultFrame, rnode)) {
            continue;
          }
          cands.push({ resultId: rid, dist: 0 });
          nextOrdinalPick.set(row.slotType, j + 1);
          break;
        }
      }
      if (cands.length === 0 && CROSS_TEXT_FALLBACK_TYPES.has(row.slotType)) {
        const srcFrame = opts.sourceFrame!;
        const sW = Math.max(srcFrame.width, 1e-6);
        const sH = Math.max(srcFrame.height, 1e-6);
        const masterNy = row.element.top != null ? row.element.top + hr / 2 : 0.5;
        const masterNxFb = row.element.left != null ? row.element.left + wr / 2 : 0.5;
        for (const altType of CROSS_TEXT_FALLBACK_TYPES) {
          if (altType === row.slotType) continue;
          for (const s of byTypeSource.get(altType) ?? []) {
            const rid = opts.sourceToResult!.get(s.id);
            if (!rid || used.has(rid)) continue;
            const rnode = resultNodeById.get(rid);
            if (!rnode || rnode.removed) continue;
            if (validateStructuralPath && getStructuralPathKey(srcFrame, s) !== getStructuralPathKey(resultFrame, rnode)) {
              continue;
            }
            if (row.slotType === 'disclaimer' && s.type === NodeType.Text) {
              if (looksLikeCtaLabelText(s, srcFrame)) continue;
              if (textIsInsidePillButtonShellHierarchy(s, srcFrame)) continue;
            }
            const sb = getBoundsInFrame(s, srcFrame);
            const srcNy = (sb.y + sb.h / 2) / sH;
            let d: number;
            if (row.slotType === 'disclaimer') {
              const vertical = (masterNy - srcNy) ** 2;
              const bottomPen = Math.max(0, 0.62 - srcNy) * 1.5;
              const len = s.type === NodeType.Text ? (s.characters ?? '').length : 0;
              const shortPen = len < 24 ? 0.4 : 0;
              d = vertical + bottomPen + shortPen;
            } else if (row.slotType === 'ageRating') {
              const srcNx = (sb.x + sb.w / 2) / sW;
              const len = s.type === NodeType.Text ? (s.characters ?? '').length : 99;
              const looks =
                s.type === NodeType.Text && /^\s*\d{1,2}\+\s*$/.test((s.characters ?? '').trim());
              d = (masterNy - srcNy) ** 2 + 0.55 * (masterNxFb - srcNx) ** 2;
              if (!looks) d += 0.5;
              if (len > 8) d += (len - 8) * 0.035;
              if (srcNx < 0.55) d += 0.42;
            } else {
              d = (masterNy - srcNy) ** 2 + 0.15;
            }
            cands.push({ resultId: rid, dist: d });
          }
        }
      }
    }

    if (
      enableNearSquareTextOrdinalOverride &&
      TEXT_ORDINAL_SLOT_TYPES.includes(row.slotType) &&
      !(row.slotType === 'disclaimer' && cands.length > 0) &&
      !pinSlotToSourceMap
    ) {
      const list = orderedSourceByTypeOrdinalText.get(row.slotType) ?? [];
      const start = nextOrdinalPickText.get(row.slotType) ?? 0;
      for (let j = start; j < list.length; j++) {
        const s = list[j]!;
        if (
          row.slotType === 'disclaimer' &&
          s.type === NodeType.Text &&
          textIsInsidePillButtonShellHierarchy(s, opts.sourceFrame!)
        ) {
          continue;
        }
        const rid = opts.sourceToResult!.get(s.id);
        if (!rid || used.has(rid)) continue;
        cands.length = 0;
        cands.push({ resultId: rid, dist: -1e12 });
        nextOrdinalPickText.set(row.slotType, j + 1);
        break;
      }
    }

    if (cands.length === 0) {
      pushFromResultNodes(byTypeResult.get(row.slotType) ?? []);
    }

    if (
      (row.slotType === 'title' ||
        row.slotType === 'description' ||
        row.slotType === 'disclaimer' ||
        row.slotType === 'ageRating') &&
      cands.length > 0
    ) {
      const looksAge = (n: INode): boolean => {
        if (n.type !== NodeType.Text) return false;
        return /^\d{1,2}\+$/.test((n.characters ?? '').trim());
      };
      const filtered = cands.filter(c => {
        const rn = resultNodeById.get(c.resultId);
        if (!rn || (rn.removed)) return false;
        if (
          row.slotType !== 'button' &&
          rn.type === NodeType.Text &&
          looksLikeCtaLabelText(rn, resultFrame)
        ) {
          return false;
        }
        if (
          row.slotType === 'disclaimer' &&
          rn.type === NodeType.Text &&
          textIsInsidePillButtonShellHierarchy(rn, resultFrame)
        ) {
          return false;
        }
        if (row.slotType === 'ageRating') return rn.type === NodeType.Text && looksAge(rn);
        return !(rn.type === NodeType.Text && looksAge(rn));
      });
      if (filtered.length > 0) {
        cands.length = 0;
        cands.push(...filtered);
      }
    }

    if (cands.length === 0) continue;

    if (row.slotType === 'button') {
      const masterButtonNode = tryResolveNodeById(row.sourceNodeId);
      if (masterButtonNode?.type === NodeType.Instance) {
        const instOnly = cands.filter(c => resultNodeById.get(c.resultId)?.type === NodeType.Instance);
        if (instOnly.length > 0) {
          cands.length = 0;
          cands.push(...instOnly);
        }
      }
    }

    if (row.slotType === 'button') {
      const before = cands.length;
      const preGeomCands = cands.slice();
      cands.splice(
        0,
        cands.length,
        ...cands.filter(c => {
          const rn = resultNodeById.get(c.resultId);
          return rn ? isButtonCandidate(rn) : false;
        })
      );
      if (cands.length === 0 && before > 0) {
        for (const n of resultNodes) {
          if (used.has(n.id)) continue;
          if (!isButtonCandidate(n)) continue;
          const b = getBoundsInFrame(n, resultFrame);
          const cx = b.x + b.w / 2;
          const cy = b.y + b.h / 2;
          const d = gx != null && gy != null ? (cx - gx) ** 2 + (cy - gy) ** 2 : 0;
          cands.push({ resultId: n.id, dist: d });
        }
      }
      if (cands.length === 0 && preGeomCands.length > 0) {
        const safeBtn = preGeomCands.filter(c => {
          const rn = resultNodeById.get(c.resultId);
          return rn && isButtonCandidate(rn);
        });
        if (safeBtn.length > 0) cands.push(...safeBtn);
      }
    } else if (row.slotType === 'logo') {
      const before = cands.length;
      const preGeomCands = cands.slice();
      cands.splice(
        0,
        cands.length,
        ...cands.filter(c => {
          const rn = resultNodeById.get(c.resultId);
          return rn ? isLogoCandidate(rn) && !isButtonCandidate(rn) : false;
        })
      );
      if (cands.length === 0 && before > 0) {
        for (const n of resultNodes) {
          if (used.has(n.id)) continue;
          if (!isLogoCandidate(n) || isButtonCandidate(n)) continue;
          const b = getBoundsInFrame(n, resultFrame);
          const cx = b.x + b.w / 2;
          const cy = b.y + b.h / 2;
          const d = gx != null && gy != null ? (cx - gx) ** 2 + (cy - gy) ** 2 : 0;
          cands.push({ resultId: n.id, dist: d });
        }
      }
      if (cands.length === 0 && preGeomCands.length > 0) {
        const safe = preGeomCands.filter(c => {
          const rn = resultNodeById.get(c.resultId);
          return rn && !isButtonCandidate(rn) && isLogoCandidate(rn);
        });
        if (safe.length > 0) cands.push(...safe);
      }
    }

    if (
      pinSlotToSourceMap &&
      pinnedRid &&
      pinnedNode &&
      slotCandidateFilter(pinnedNode, row.slotType) &&
      !cands.some(c => c.resultId === pinnedRid)
    ) {
      cands.unshift({ resultId: pinnedRid, dist: -1e15 });
    }

    if (cands.length === 0) continue;

    cands.sort((a, b) => {
      const da = a.dist - b.dist;
      if (row.slotType === 'disclaimer' && Math.abs(da) < 1e-6) {
        const na = resultNodeById.get(a.resultId);
        const nb = resultNodeById.get(b.resultId);
        const la = na?.type === NodeType.Text ? (na.characters ?? '').length : 0;
        const lb = nb?.type === NodeType.Text ? (nb.characters ?? '').length : 0;
        return lb - la;
      }
      return da;
    });
    if (pinSlotToSourceMap && pinnedRid) {
      const ix = cands.findIndex(c => c.resultId === pinnedRid);
      if (ix > 0) {
        const [picked] = cands.splice(ix, 1);
        cands.unshift(picked);
      }
    }
    const best = cands[0]!;
    used.add(best.resultId);
    if (row.slotType === 'background') {
      const bn = resultNodeById.get(best.resultId);
      if (bn && !(bn.removed)) {
        backgroundPickBounds = getBoundsInFrame(bn, resultFrame);
      }
    }

    const skipMasterVisual = row.slotType === 'background' && row.element.fill === true;
    const elementOut =
      useSourceMap && !skipMasterVisual
        ? enrichCrossPlacementElementFromMasterLive(row.element, row.sourceNodeId, capW, capH)
        : { ...row.element };
    const bestNode = resultNodeById.get(best.resultId);
    const bb =
      bestNode && !(bestNode.removed)
        ? getBoundsInFrame(bestNode, resultFrame)
        : { x: 0, y: 0, w: 0, h: 0 };
    placements.push({
      resultNodeId: best.resultId,
      slotType: row.slotType,
      element: elementOut,
      masterSourceNodeId: row.sourceNodeId,
      x: bb.x,
      y: bb.y,
      w: bb.w,
      h: bb.h
    });
  }

  return coalesceEllipseClusterPlacements(resultFrame, placements);
}
