import { type INode, type ISolidPaint, MIXED, type IPaint, NodeType } from '../../host';
import { GuideElement, BannerElementType } from '../contracts/types';
import type { ExactSessionGeometryOptions } from './exact-session-types';
import { collectAllDescendants, getBoundsInFrame, isTechnicalArtifactName } from './layout-utils';
import {
  assignSemanticTypes,
  getCtaGroupWrapper,
  sceneNodeToGuideElementType,
  slotOrderIndex
} from './semantic-classifier';
import { findDetachedCTARectTextPair } from './semantic-logo-cta';
import type { DesignSystem } from '../../design-system/types';
import { findTypographyForSlotAtWidth, snapToRadiusScale, getButtonBorderRadius } from '../../design-system/types';

export interface AutoSessionSlotRow {
  /** In plugin.ts this is often used as sourceNodeId */
  nodeId: string;
  sourceNodeId: string;
  slotType: BannerElementType;
  element: GuideElement;
}

export interface SessionSlotLike {
  nodeId: string;
  slotType: BannerElementType;
  element: GuideElement;
}

export interface SessionSlotSnapshot {
  nodeId: string;
  slotType: BannerElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  visualSignature?: any;
}

export function hasRememberTextFields(el: GuideElement): boolean {
  return !!(el.rememberFontPx || el.rememberTextAlign);
}

export function hasRememberShapeFields(el: GuideElement): boolean {
  return (
    el.rememberCornerRadiusRelMin != null ||
    el.rememberStrokeWeightRelMin != null ||
    el.rememberOpacity != null ||
    el.rememberPrimaryFillOpacity != null
  );
}

export function capturePrimarySolidFillOpacity(node: INode): number | undefined {
  if (node.fills === undefined) return undefined;
  const f = node.fills;
  if (f === MIXED || !Array.isArray(f) || f.length === 0) return undefined;
  const first = f[0];
  if (first.type === 'SOLID') return (first as ISolidPaint).opacity;
  return undefined;
}

export function applyPrimarySolidFillOpacity(node: INode, opacity: number): void {
  if (node.fills === undefined) return;
  const f = node.fills;
  if (f === MIXED || !Array.isArray(f) || f.length === 0) return;
  const newFills = f.map((fill: any, i: number) => {
    if (i === 0 && fill.type === 'SOLID') return { ...fill, opacity };
    return fill;
  });
  node.fills = newFills as IPaint[];
}

export function captureRememberFieldsFromNode(node: INode, W: number, H: number): Partial<GuideElement> {
  const el: Partial<GuideElement> = {};
  const minS = Math.min(Math.max(W, 1), Math.max(H, 1));
  if (node.type === NodeType.Text) {
    if (node.fontSize !== MIXED) el.rememberFontPx = node.fontSize as number;
  }
  /** Like `oLD/guide-scaler.ts`: number only, r>0; fraction of min side of the **banner** (W×H). */
  if (node.cornerRadius !== undefined && typeof node.cornerRadius === 'number') {
    const r = node.cornerRadius;
    if (r > 0) el.rememberCornerRadiusRelMin = r / minS;
  }
  if (node.strokeWeight !== undefined && typeof node.strokeWeight === 'number') {
    const sw = node.strokeWeight;
    if (sw > 0) el.rememberStrokeWeightRelMin = sw / minS;
  }
  if (node.opacity !== undefined && typeof node.opacity === 'number') {
    el.rememberOpacity = node.opacity;
  }
  const fillOp = capturePrimarySolidFillOpacity(node);
  if (fillOp != null) el.rememberPrimaryFillOpacity = fillOp;
  return el;
}

/**
 * Compute ideal font size for a slot using DesignSystem responsive rules.
 * Falls back to rememberFontPx (proportional scaling) if no DS or no matching rule.
 */
export function computeDsFontSize(
  slotType: BannerElementType,
  rememberFontPx: number | undefined,
  targetWidth: number,
  ds?: DesignSystem
): number | undefined {
  if (!ds || !rememberFontPx) return rememberFontPx;

  const rule = findTypographyForSlotAtWidth(ds, slotType, targetWidth);
  if (!rule) return rememberFontPx;

  // Use DS fontSize if it's within reasonable range of the remembered one.
  // If remembered font is wildly different, the design might be intentionally non-standard — trust remember.
  const ratio = rule.fontSize / rememberFontPx;
  if (ratio >= 0.3 && ratio <= 3) {
    return rule.fontSize;
  }
  return rememberFontPx;
}

/**
 * Apply DesignSystem-informed corner radius to a shape node.
 */
export function applyDsCornerRadius(
  node: INode,
  el: GuideElement,
  targetWidth: number,
  targetHeight: number,
  ds?: DesignSystem
): void {
  if (!ds || !('cornerRadius' in node)) return;
  const minS = Math.min(targetWidth, targetHeight);
  const raw = el.rememberCornerRadiusRelMin != null
    ? el.rememberCornerRadiusRelMin * minS
    : typeof node.cornerRadius === 'number' ? node.cornerRadius : -1;
  if (raw < 0) return;
  node.cornerRadius = Math.round(snapToRadiusScale(ds, raw));
}

/**
 * Apply DesignSystem button border radius.
 */
export function applyDsButtonStyle(
  node: INode,
  ds?: DesignSystem
): void {
  if (!ds?.components.button || !('cornerRadius' in node)) return;
  const btn = ds.components.button;
  if (btn.style === 'pill') {
    node.cornerRadius = 9999;
  } else {
    node.cornerRadius = btn.borderRadius;
  }
}

/**
 * @returns true if explicit slot resize (nw/nh) is set — then guide-flow does not duplicate uniform scale.
 */
export async function applyRememberToTextNode(
  t: INode,
  el: GuideElement,
  targetWidth: number,
  targetHeight: number,
  nw?: number,
  nh?: number,
  ds?: DesignSystem,
  slotType?: BannerElementType
): Promise<boolean> {
  // DS-informed font size: prefer design system rule if available, fallback to remember
  const dsFontPx = computeDsFontSize(slotType ?? 'other', el.rememberFontPx, targetWidth, ds);
  const effectiveFontPx = dsFontPx ?? el.rememberFontPx;
  if (effectiveFontPx) {
    t.fontSize = Math.max(8, effectiveFontPx);
  }
  if (nw != null && nh != null) {
    /**
     * Set HEIGHT auto-resize so text reflows at fixed width.
     * After resize, if text overflows target height significantly, shrink fontSize to fit.
     */
    t.textAutoResize = 'HEIGHT';
    t.resize(Math.max(1, Math.round(nw)), Math.max(1, Math.round(nh)));

    // Shrink font if text reflowed taller than expected (cross-mode width change)
    const actualH = t.height ?? nh;
    const baseFontForShrink = effectiveFontPx ?? el.rememberFontPx;
    if (actualH > nh * 1.3 && baseFontForShrink && baseFontForShrink > 8) {
      const ratio = nh / Math.max(actualH, 1);
      const newFontPx = Math.max(8, Math.round(baseFontForShrink * ratio));
      t.fontSize = newFontPx;
      t.resize(Math.max(1, Math.round(nw)), Math.max(1, Math.round(nh)));
    }
    return true;
  }
  return false;
}

export function applyRememberToShapeNode(
  node: INode,
  el: GuideElement,
  targetWidth: number,
  targetHeight: number,
  nw?: number,
  nh?: number,
  ds?: DesignSystem,
  slotType?: BannerElementType
): void {
  const minS = Math.min(targetWidth, targetHeight);
  if (el.rememberCornerRadiusRelMin != null && node.cornerRadius !== undefined) {
    const rawRadius = Math.round(el.rememberCornerRadiusRelMin * minS);
    // DS-informed: snap to design system radius scale if available
    node.cornerRadius = ds ? Math.round(snapToRadiusScale(ds, rawRadius)) : rawRadius;
  }
  if (el.rememberStrokeWeightRelMin != null && node.strokeWeight !== undefined) {
    node.strokeWeight = Math.round(el.rememberStrokeWeightRelMin * minS);
  }
  if (el.rememberOpacity != null && node.opacity !== undefined) {
    node.opacity = el.rememberOpacity;
  }
  if (el.rememberPrimaryFillOpacity != null) {
    applyPrimarySolidFillOpacity(node, el.rememberPrimaryFillOpacity);
  }
  if (nw != null && nh != null && node.resize) {
    node.resize(Math.max(1, Math.round(nw)), Math.max(1, Math.round(nh)));
  }
}

/**
 * Main slot builder for 'Remember' mode.
 * Runs the semantic classifier and captures metrics from nodes.
 */
export function buildAutoSessionSlotsFromFrame(frame: INode, ds?: DesignSystem): AutoSessionSlotRow[] {
  const W = frame.width;
  const H = frame.height;
  const areaFrame = W * H;

  const allNodesForSemantic = collectAllDescendants(frame).slice(1);
  const semanticMap = assignSemanticTypes(allNodesForSemantic, frame, ds);

  // Additional heuristic for buttons and age ratings
  const slotValues = Array.from(semanticMap.values());
  if (!slotValues.includes('button')) {
    const pair = findDetachedCTARectTextPair(frame, areaFrame);
    if (pair && !semanticMap.has(pair.rect.id)) {
      semanticMap.set(pair.rect.id, 'button');
    }
  }

  const nodeById = new Map<string, INode>();
  for (const n of collectAllDescendants(frame)) {
    nodeById.set(n.id, n);
  }

  const out: AutoSessionSlotRow[] = [];
  for (const [id, slotType] of semanticMap) {
    let node = nodeById.get(id);
    if (!node || node.removed || node === frame) continue;

    let sourceNodeId = id;
    // For buttons use the wrapper (Cluster) if available
    if (slotType === 'button') {
      const wrap = getCtaGroupWrapper(node, frame);
      if (wrap && wrap.parent === frame) {
        node = wrap;
        sourceNodeId = wrap.id;
      }
    }

    const b = getBoundsInFrame(node, frame);
    if (b.w < 0.5 || b.h < 0.5) continue;

    // Skip nodes that are clearly outside the frame bounds (e.g. duplicate decor far off-canvas)
    const relL = b.x / W;
    const relT = b.y / H;
    const relR = (b.x + b.w) / W;
    const relB = (b.y + b.h) / H;
    if (slotType !== 'background' && (relR < -0.1 || relL > 1.1 || relB < -0.1 || relT > 1.1)) continue;

    const rememberPartial = captureRememberFieldsFromNode(node, W, H);
    const element: GuideElement = {
      name: 'name' in node ? node.name : slotType,
      type: sceneNodeToGuideElementType(node),
      slotType,
      fill: slotType === 'background',
      left: b.x / W,
      top: b.y / H,
      widthRatio: b.w / W,
      heightRatio: b.h / H,
      ...rememberPartial
    };

    out.push({
      nodeId: sourceNodeId,
      sourceNodeId,
      slotType,
      element
    });
  }

  out.sort((a, b) => slotOrderIndex(a.slotType) - slotOrderIndex(b.slotType));
  return out;
}

/** Compatibility alias in case someone calls the '2' version */
export const buildAutoSessionSlotsFromFrame2 = buildAutoSessionSlotsFromFrame;

export function refreshSessionCaptureAfterScale(
  resultFrame: INode,
  slots: { sourceNodeId: string; slotType: BannerElementType; element: GuideElement }[],
  sourceToResult: Map<string, string>
): { sourceNodeId: string; slotType: BannerElementType; element: GuideElement }[] {
  const W = resultFrame.width;
  const H = resultFrame.height;
  const allNodes = collectAllDescendants(resultFrame).slice(1);
  const nodeById = new Map<string, INode>();
  for (const n of allNodes) nodeById.set(n.id, n);

  return slots.map(s => {
    const newId = sourceToResult.get(s.sourceNodeId) ?? s.sourceNodeId;
    const node = nodeById.get(newId);
    if (!node) return { ...s, sourceNodeId: newId };

    const b = getBoundsInFrame(node, resultFrame);
    return {
      sourceNodeId: newId,
      slotType: s.slotType,
      element: {
        ...s.element,
        name: node.name,
        left: b.x / W,
        top: b.y / H,
        widthRatio: b.w / W,
        heightRatio: b.h / H
      }
    };
  });
}

export function rebuildSessionSlotsFromPlacements(_placements: any[]): AutoSessionSlotRow[] {
  return [];
}

/**
 * [Production Zero-Tolerance Strategy]
 * Maps slots via pipeline letterbox or breakout (1:1).
 */
export function resolveExactSessionLayout(
  targetWidth: number,
  targetHeight: number,
  geom: ExactSessionGeometryOptions,
  forceLetterboxSourceBasis = false
): { Rw: number; Rh: number; u: number; ox: number; oy: number } {
  const Cw = geom.capture?.width ?? targetWidth;
  const Ch = geom.capture?.height ?? targetHeight;
  const targetAR = targetWidth / Math.max(targetHeight, 1e-6);
  const captureAR = Cw / Math.max(Ch, 1e-6);

  // [Hardcore Hardening: Zero-Tolerance Square Lock]
  // Round AR to 2 decimal places so minor Figma noise (1.0001 vs 1.0)
  // doesn't break the Square-to-Square optimization (ox=0).
  const targetAR2 = Math.round(targetAR * 100) / 100;
  const captureAR2 = Math.round(captureAR * 100) / 100;

  if (!forceLetterboxSourceBasis && Math.abs(captureAR2 - targetAR2) < 0.01) {
    // When master AR ≈ target AR, master fractions are kept (crossKeepMasterFractions=true in
    // rewriteCrossPlacementsFromSourceGeometry). Using source dimensions here would project
    // those fractions into source-space (e.g. 0.926 × 1921 − 420 = 1358px in a 1081px frame).
    // Use target dimensions directly — same as strict mode — so fractions map to target pixels.
    const u = targetWidth / Math.max(Cw, 1);
    return { Rw: targetWidth, Rh: targetHeight, u, ox: 0, oy: 0 };
  }

  if (geom.mode === 'cross') {
    const Sw = geom.sourceWidth ?? Cw;
    const Sh = geom.sourceHeight ?? Ch;
    const u = Math.min(targetWidth / Sw, targetHeight / Sh);
    const Rw = Sw * u;
    const Rh = Sh * u;
    const ox = (targetWidth - Rw) / 2;
    const oy = (targetHeight - Rh) / 2;
    return { Rw, Rh, u, ox, oy };
  }

  const u = Math.min(targetWidth / Cw, targetHeight / Ch);
  const Rw = Cw * u;
  const Rh = Ch * u;
  const ox = (targetWidth - Rw) / 2;
  const oy = (targetHeight - Rh) / 2;
  return { Rw, Rh, u, ox, oy };
}

/**
 * Source-dimensional basis for the ALIGN phase of non-slot visual elements (img, bg vectors).
 * Unlike resolveExactSessionLayout (which uses target dims for correct slot fraction mapping),
 * ALIGN needs source dims so background elements "zoom/crop" into the frame at full resolution
 * rather than being scaled down proportionally (which would leave visible white gaps).
 *
 * For cross mode with captureAR ≈ targetAR (e.g. master 1:1 → target 1:1, source 9:16):
 *   Rw=1081, Rh=1921, u=1.0, ox=0, oy=-420
 * → img stays at (174,-259,775,1759) covering the frame via the center-crop of the source.
 */
export function resolveAlignSourceBasis(
  targetWidth: number,
  targetHeight: number,
  geom: ExactSessionGeometryOptions
): { Rw: number; Rh: number; u: number; ox: number; oy: number } {
  if (geom.mode !== 'cross' || !geom.sourceWidth || !geom.sourceHeight) {
    return resolveExactSessionLayout(targetWidth, targetHeight, geom);
  }
  const Cw = geom.capture?.width ?? targetWidth;
  const Sw = geom.sourceWidth;
  const Sh = geom.sourceHeight;
  const u = targetWidth / Math.max(Cw, 1);
  const Rw = Sw * u;
  const Rh = Sh * u;
  const ox = (targetWidth - Rw) / 2;
  const oy = (targetHeight - Rh) / 2;
  return { Rw, Rh, u, ox, oy };
}

/**
 * Remember / uniform letterbox often produces a chain Frame→Group→...→layer.
 * Hoist slot to a direct child of the banner, PRESERVING THE DESIGNER'S GROUP.
 */
export function hoistSessionSlotToBannerRoot(node: INode, frame: INode, _slotType: BannerElementType): string {
  if (node === frame) return node.id;
  if (node.removed) return node.id;

  let logicalTop: INode = node;
  let cur: INode | null = node.parent;
  while (cur && cur !== frame) {
    if (cur.type === NodeType.Group || cur.type === NodeType.Frame || cur.type === NodeType.Component || cur.type === NodeType.Instance) {
      const name = cur.name;
      if (!isTechnicalArtifactName(name)) {
        logicalTop = cur;
      }
    }
    // Cannot extract children from an instance — it would break Figma.
    if (cur.type === NodeType.Instance) break;
    cur = cur.parent;
  }

  // If we found a node to hoist, OR if the parent is still technical — move to root.
  const pName = logicalTop.parent?.name ?? '';
  const parentIsTechnical = isTechnicalArtifactName(pName);

  if (logicalTop.parent !== frame || parentIsTechnical) {
    const b = getBoundsInFrame(logicalTop, frame);
    // [Direct Root] Move directly to banner root
    frame.appendChild!(logicalTop);

    // After appendChild (parent change) reset coordinates
    logicalTop.x = Math.round(b.x);
    logicalTop.y = Math.round(b.y);
  }

  return logicalTop.id;
}
