/**
 * Markdown + JSON snapshot of one Scale run for offline analysis.
 */

import type { INode } from '../../host';
import { NodeType } from '../../host';
import { getHost } from '../../host/context';
import type { BannerElementType } from '../contracts/types';
import type {
  ExactSessionGeometryOptions,
  ExactSessionPlacement
} from '../postprocess/exact-session-types';
import { collectAllDescendants, getBoundsInFrame } from '../postprocess/layout-utils';
import { resolveExactSessionLayout } from '../postprocess/session-slots';

/** Keep in sync with `package.json` version (manual). */
export const PLUGIN_VERSION = '1.0.0';

/** Max nodes per tree in run log (full list still in JSON until this cap). */
export const TREE_LOG_MAX_NODES = 800;

export interface FrameTreeFlatRow {
  id: string;
  parentId: string | null;
  type: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  /** Full layer path for diagnostics, e.g. "Root > Group 1 > Text". */
  fullPath?: string;
}

export interface FrameTreeSnapshot {
  nodes: FrameTreeFlatRow[];
  /** Stopped early to stay within `TREE_LOG_MAX_NODES`. */
  truncated: boolean;
  /** Total nodes in subtree (including frame root). */
  totalNodesInTree: number;
}

export interface PlacementAuditPayload {
  rememberGeometry: Record<string, unknown>;
  rows: Array<{
    slotType: BannerElementType;
    resultNodeId: string;
    masterSourceNodeId?: string;
    isBackdrop?: boolean;
    expected: { x: number; y: number; w: number; h: number };
    actual: { x: number; y: number; w: number; h: number } | null;
    delta: { dx: number; dy: number; dw: number; dh: number } | null;
    status: 'ok' | 'missing';
    /**
     * false: post processes the slot differently from "engine rect" (e.g. background = cover letterbox with trustLetterbox).
     * Then a large delta with actual is not a slot bug, but different rect definitions.
     */
    comparableForAudit: boolean;
  }>;
  summary: {
    count: number;
    missing: number;
    /** Max |delta| only for slots with `comparableForAudit`. */
    maxAbsDelta: number;
    /** Quality category (for agent): 'PERFECT', 'TOLERABLE', 'BROKEN'. */
    health: 'PERFECT' | 'TOLERABLE' | 'BROKEN';
    /** Worst delta by x/y/w/h. */
    maxAbsDeltaRaw?: number;
    /** Expected rect with negative x or y (comparable slots only). */
    expectedRectNegativeXY: number;
    /** Expected rect extends beyond 0..target (comparable slots only). */
    expectedRectPartiallyOutsideFrame: number;
    /** Slots with `comparableForAudit === false` (usually background with trust letterbox). */
    nonComparableSlotCount?: number;
    /** Slots with comparable + ok (participate in "honest" max |delta|). */
    comparableSlotCount?: number;
    /**
     * Text slots (title/description/disclaimer/ageRating) where actual height < 12px --
     * typical sign: font not loaded before resize/fit or reflow failure.
     */
    suspectedCollapsedTextCount?: number;
    /** Up to 5 worst by max(|delta|) among comparable slots. */
    worstComparableSlots?: Array<{
      slotType: BannerElementType;
      resultNodeId: string;
      maxAbsDelta: number;
    }>;
  };
}

/** Master temp used for this run (snapshot before pipeline; strict/cross may update temp in session after). */
export interface TempCaptureLogSnapshot {
  id: string;
  label: string;
  rootFrameId: string;
  width: number;
  height: number;
  /** `temp.rootFrameId === sourceFrame.id` -- strict Remember on same banner. */
  sameRootAsSource: boolean;
  slotCount: number;
  slots: Array<{
    slotType: BannerElementType;
    sourceNodeId: string;
    left: number | null;
    top: number | null;
    widthRatio: number | null;
    heightRatio: number | null;
    name: string | null;
  }>;
}

export interface ScaleRunLogPayload {
  ts: string;
  pluginVersion: string;
  /** Wall-clock duration of `handleScale` (ms). */
  runMeta: {
    durationMs: number;
    hostApiVersion: string;
  };
  /**
   * How the cluster pipeline was invoked (mirrors `cluster-scale` / `executeUniformLetterbox` args).
   * `uniformLetterbox` is set only when that path ran.
   */
  pipelineExecution: {
    uniformLetterbox: null | { letterboxFit: 'contain' | 'cover'; contentAwareLetterbox: boolean };
    /** Native rescale path: preserve flag passed to `execute()`. */
    clusterPreserve: boolean | null;
  };
  /** All Remember temps in UI session at run end (ids for repro / multi-master). */
  sessionContext: {
    temps: Array<{ id: string; label: string; slotCount: number; rootFrameId: string }>;
  };
  /** Host / file context (useful for repro). */
  pluginEnvironment: {
    editorType: string;
    pageId: string;
    pageName: string;
    /** Present when available from host. */
    fileKey: string | null;
  };
  /** Incoming `scale` message + how temp was chosen. */
  scaleRequest: {
    preserveProportions: boolean | undefined;
    useGuide: boolean | undefined;
    guideKey: string | undefined;
    useSessionGuide: boolean | undefined;
    tempCaptureId: string | null;
    /** User picked a temp chip explicitly (`tempCaptureId` set). */
    userExplicitTemp: boolean;
    /** `tempCaptures.length` at run time. */
    tempListCount: number;
  };
  /** Remember master for this run; `null` if no temp / no slots. */
  tempCapture: TempCaptureLogSnapshot | null;
  source: { id: string; name: string; w: number; h: number };
  /** Subtree stats on source frame (before clone). */
  sourceTree: { directChildren: number; descendantNodes: number; textNodes: number };
  target: { w: number; h: number };
  result: { id: string; name: string; w: number; h: number };
  /** Subtree stats on result root (clone output). */
  resultTree: { directChildren: number; descendantNodes: number; textNodes: number } | null;
  /** Full layout tree (local x/y/w/h, parent id, depth); truncated beyond `TREE_LOG_MAX_NODES`. */
  sourceTreeFlat: FrameTreeSnapshot;
  resultTreeFlat: FrameTreeSnapshot | null;
  /**
   * Remember exact-session: target rects from engine (`placement.x/y/w/h`) vs measured bounds after post.
   * `null` if no exact-session pass (e.g. guide-only).
   */
  placementAudit: PlacementAuditPayload | null;
  /**
   * Engine output before post (`applyExactSessionPostProcess`): rects + `element` per slot.
   * Same length as `placementAudit.rows` when Remember ran; `null` otherwise.
   */
  enginePlacements: ExactSessionPlacement[] | null;
  /**
   * Remember branch diagnostics (structural map fallback, cross spread / rewrite, strict temp drift).
   * `null` when session guide / Remember was not used.
   */
  rememberDiagnostics: null | {
    branch: 'strict' | 'cross' | 'none';
    structuralPathFallbackStrict?: boolean;
    structuralPathFallbackCross?: boolean;
    /** `aspectSpread(target, master)` when cross Remember ran. */
    crossTargetRememberSpread?: number;
    /**
     * Threshold for "strict" geometry (mode strict in exact-session with large spread).
     * Not to be confused with `rewriteCrossPlacementsFromSourceGeometry` -- that is always called for cross slots.
     */
    crossGeometryRewriteApplied?: boolean;
    /** cross: `true` -- always mix fractions from live source (rewrite). */
    crossLiveSourceFractionRewrite?: boolean;
    /** Strict: live source frame size vs stored temp capture when they differ enough to refresh slots. */
    strictLiveVsStoredTempDelta?: {
      sourceW: number;
      sourceH: number;
      storedW: number;
      storedH: number;
    } | null;
    /**
     * Actual `resolveExactSessionLayout` for post -- compare with `rewrite` (fractions from Sw x Sh) and pipeline.
     */
    exactSessionLayoutResolved?: {
      Rw: number;
      Rh: number;
      u: number;
      ox: number;
      oy: number;
      letterboxSrcW: number;
      letterboxSrcH: number;
      note: string;
    };
    /** cross: how much the master-temp aspect differs from live source (nonzero for 1:1 master vs 9:16 banner). */
    masterCaptureVsSourceSpread?: number;
  };
  pipeline: 'uniform-letterbox' | 'cluster-execute';
  /**
   * Which resize was applied (pipeline) and where the result ended up on canvas --
   * so that audit and tree can be read together with `placementAudit` (expected = rects after sync, before post).
   */
  resizeFrameContext: {
    sourceW: number;
    sourceH: number;
    targetW: number;
    targetH: number;
    uniformLetterbox: null | { letterboxFit: 'contain' | 'cover'; contentAwareLetterbox: boolean };
    clusterPreserve: boolean | null;
    /** Remember temp (master) for this run -- size of slot snapshot. */
    rememberMasterCapture: null | { width: number; height: number; rootFrameId: string };
    /** `absoluteBoundingBox` of result on page (if host API returned it). */
    resultAbsolute: null | { x: number; y: number; width: number; height: number };
    /** `x`/`y` relative to parent (often the page). */
    resultRelative: null | { x: number; y: number; width: number; height: number };
  };
  flags: {
    sessionHasSlots: boolean;
    wantStrictRemember: boolean;
    wantCrossRemember: boolean;
    useUniformLetterboxPipeline: boolean;
    preserveProportions: boolean;
    strictRememberUseClusterNative: boolean;
  };
  layoutProfile: null | {
    layoutClass: string;
    confidence: number;
    classifierVersion: number;
    hints: unknown;
    signals: unknown;
  };
  remember: null | {
    mode: 'strict' | 'cross';
    masterSlotCount: number;
    placementsTotal: number;
    slotCounts: Record<string, number>;
    placementRowsSample: Array<{
      slotType: BannerElementType;
      resultNodeId: string;
      masterSourceNodeId?: string;
    }>;
    crossRewrite?: boolean;
  };
  guide: null | {
    targetGuideKey: string | null;
    afterUniformLetterbox: boolean;
  };
  /**
   * Schematic layout for offline review (no raster): root child order, overlaps, SVG string.
   * `null` when no placement audit or not a FRAME.
   */
  layoutVisualSummary: null | LayoutVisualSummaryPayload;
  /**
   * Deep diagnostics from post-processing (Purge, Snap, Hoist details).
   */
  trace?: string[];
  /** Auto-detected issues from diagnostic engine (non-slot drift, coherence, fonts). */
  diagnosticReport: DiagnosticReport | null;
}

// ── Diagnostic report types ──

export interface DiagnosticIssue {
  severity: 'error' | 'warning' | 'info';
  category: 'non-slot-drift' | 'parent-child-gap' | 'font-ratio' | 'trace-suspect';
  message: string;
}

export interface NonSlotChildRow {
  name: string;
  type: string;
  id: string;
  actual: { x: number; y: number; w: number; h: number };
  master: { x: number; y: number; w: number; h: number } | null;
  driftPx: number;
  isSlot: boolean;
  flags: string[];
}

export interface DiagnosticReport {
  issues: DiagnosticIssue[];
  nonSlotChildren: NonSlotChildRow[];
  health: 'PERFECT' | 'TOLERABLE' | 'BROKEN';
}

/** Human + tool review: geometry-only (colors are slot-type labels, not host fills). */
export interface LayoutVisualSummaryPayload {
  /** `result.children` order (host API order = paint stack). */
  resultRootChildren: Array<{
    index: number;
    id: string;
    type: string;
    name: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }>;
  /**
   * Intersections of **actual** placement bounds (px^2), **slot-slot only**:
   * pairs where one side is `background` and the other is not are omitted (always true for full-bleed).
   */
  actualOverlapPairs: Array<{
    a: { slotType: BannerElementType; resultNodeId: string };
    b: { slotType: BannerElementType; resultNodeId: string };
    overlapAreaPx: number;
  }>;
  /** Same `name` on multiple direct children of the result root (often a red flag). */
  duplicateNameAtRoot: Array<{ name: string; ids: string[] }>;
  /** Inline SVG `viewBox` 0..W x 0..H -- rects from placement audit **actual** (stroke = slot type). */
  svgActualSlotsPreview: string;
}

const PLACEMENT_SAMPLE_MAX = 40;

export function buildTempCaptureSnapshot(
  cap: {
    id: string;
    label: string;
    rootFrameId: string;
    width: number;
    height: number;
    slots: ReadonlyArray<{
      sourceNodeId: string;
      slotType: BannerElementType;
      element: {
        name?: string;
        left?: number;
        top?: number;
        widthRatio?: number;
        heightRatio?: number;
      };
    }>;
  },
  sourceFrameId: string
): TempCaptureLogSnapshot {
  return {
    id: cap.id,
    label: cap.label,
    rootFrameId: cap.rootFrameId,
    width: cap.width,
    height: cap.height,
    sameRootAsSource: cap.rootFrameId === sourceFrameId,
    slotCount: cap.slots.length,
    slots: cap.slots.map(s => ({
      slotType: s.slotType,
      sourceNodeId: s.sourceNodeId,
      left: s.element.left ?? null,
      top: s.element.top ?? null,
      widthRatio: s.element.widthRatio ?? null,
      heightRatio: s.element.heightRatio ?? null,
      name: s.element.name ?? null
    }))
  };
}

export function buildFrameTreeStats(frame: INode): {
  directChildren: number;
  descendantNodes: number;
  textNodes: number;
} {
  const d = collectAllDescendants(frame);
  let textNodes = 0;
  for (const n of d) {
    if (n.type === NodeType.Text) textNodes++;
  }
  return {
    directChildren: frame.children?.length ?? 0,
    descendantNodes: Math.max(0, d.length - 1),
    textNodes
  };
}

function nodeDepthUnderFrame(n: INode, frame: INode): number {
  let d = 0;
  let p: INode | null = n.parent;
  while (p && p !== frame && p.type !== NodeType.Other) {
    d++;
    p = p.parent;
  }
  return d;
}

function parentIdForTreeLog(n: INode, frame: INode): string | null {
  const p = n.parent;
  if (!p) return null;
  if (p === frame) return frame.id;
  return p.id ?? null;
}

/**
 * DFS flat list: local x/y/w/h in parent, depth under `frame`, parent id.
 * Caps at `maxNodes` rows (truncated if tree is larger).
 */
export function buildFrameTreeFlat(
  frame: INode,
  maxNodes: number = TREE_LOG_MAX_NODES
): FrameTreeSnapshot {
  const all = collectAllDescendants(frame);
  const nodes: FrameTreeFlatRow[] = [];
  for (const n of all) {
    if (nodes.length >= maxNodes) break;
    if (n.removed) continue;
    const depth = nodeDepthUnderFrame(n, frame);
    const parentId = parentIdForTreeLog(n, frame);

    // Build full path
    const pathParts: string[] = [];
    let curr: INode | null = n;
    while (curr && curr !== frame && curr.type !== NodeType.Other) {
      pathParts.unshift(String(curr.name || curr.type));
      curr = curr.parent;
    }
    const fullPath = pathParts.join(' > ');

    const x = n.x;
    const y = n.y;
    const w = n.width;
    const h = n.height;
    nodes.push({
      id: n.id,
      parentId,
      type: n.type,
      name: String(n.name ?? ''),
      x,
      y,
      w,
      h,
      depth,
      fullPath
    });
  }
  const truncated = nodes.length >= maxNodes && all.length > maxNodes;
  return { nodes, truncated, totalNodesInTree: all.length };
}

/**
 * Snapshot of the same math that `applyExactSessionPostProcess` / `syncPlacementPixelRectsFromElements` uses.
 * In the JSON log you can see which Rw,u,ox the slots were computed with -- without this, debugging is blind.
 */
export function buildExactSessionLayoutSnapshot(
  targetWidth: number,
  targetHeight: number,
  geometry: ExactSessionGeometryOptions
): NonNullable<ScaleRunLogPayload['rememberDiagnostics']>['exactSessionLayoutResolved'] {
  const { Rw, Rh, u, ox, oy } = resolveExactSessionLayout(targetWidth, targetHeight, geometry);
  const Cw = Math.max(geometry.capture?.width ?? targetWidth, 1);
  const Ch = Math.max(geometry.capture?.height ?? targetHeight, 1);
  const Sw = Math.max(geometry.sourceWidth ?? Cw, 1);
  const Sh = Math.max(geometry.sourceHeight ?? Ch, 1);
  const note =
    geometry.mode === 'cross'
      ? 'cross: Rw/Rh = source x source letterbox basis (sourceWidth/Height); fractions after rewrite -- from Sw x Sh.'
      : 'strict: Rw/Rh = source/capture from geometry; clusterNativeRescale affects post.';
  return { Rw, Rh, u, ox, oy, letterboxSrcW: Sw, letterboxSrcH: Sh, note };
}

export function summarizeRememberGeometry(g: ExactSessionGeometryOptions): Record<string, unknown> {
  return {
    mode: g.mode,
    capture: g.capture,
    sourceWidth: g.sourceWidth,
    sourceHeight: g.sourceHeight,
    clusterNativeRescale: g.clusterNativeRescale,
    trustLetterboxBackgroundOverride: g.trustLetterboxBackgroundOverride,
    crossFrameSkipNearSquareOrdinalOverride: g.crossFrameSkipNearSquareOrdinalOverride,
    trustSyncedPlacementRects: g.trustSyncedPlacementRects,
    layoutClass: g.layoutClass,
    sourceFrameId: g.sourceFrameId,
    resultFrameId: g.resultFrameId
  };
}

/** For the log: which resize was applied and where the result sits on canvas (see `resizeFrameContext` in JSON). */
export function buildResizeFrameContext(
  sourceFrame: INode,
  targetW: number,
  targetH: number,
  result: INode,
  _pipeline: ScaleRunLogPayload['pipeline'],
  payload: {
    uniformLetterbox: null | { letterboxFit: 'contain' | 'cover'; contentAwareLetterbox: boolean };
    clusterPreserve: boolean | null;
    tempCapture: TempCaptureLogSnapshot | null;
  }
): ScaleRunLogPayload['resizeFrameContext'] {
  const abb = result.absoluteBoundingBox;
  return {
    sourceW: sourceFrame.width,
    sourceH: sourceFrame.height,
    targetW,
    targetH,
    uniformLetterbox: payload.uniformLetterbox,
    clusterPreserve: payload.clusterPreserve,
    rememberMasterCapture:
      payload.tempCapture != null
        ? {
            width: payload.tempCapture.width,
            height: payload.tempCapture.height,
            rootFrameId: payload.tempCapture.rootFrameId
          }
        : null,
    resultAbsolute:
      abb != null
        ? { x: abb.x, y: abb.y, width: abb.width, height: abb.height }
        : null,
    resultRelative: { x: result.x, y: result.y, width: result.width, height: result.height }
  };
}

/**
 * After `applyExactSessionPostProcess`: engine target rects (`placement`) vs measured bounds in result frame.
 */
function maxAbsFromDelta(d: { dx: number; dy: number; dw: number; dh: number }): number {
  return Math.max(Math.abs(d.dx), Math.abs(d.dy), Math.abs(d.dw), Math.abs(d.dh));
}

/**
 * Slots where "expected" from the engine is not compared with actual 1:1 in audit (different post semantics).
 */
function isPlacementComparableForAudit(
  trustBg: boolean,
  slotType: BannerElementType,
  p: ExactSessionPlacement,
  tw: number,
  th: number
): boolean {
  if (trustBg && slotType === 'background') return false;
  if (slotType === 'other') {
    const ew = Math.max(0, p.w);
    const eh = Math.max(0, p.h);
    const areaF = Math.max(tw * th, 1e-6);
    const areaRatio = (ew * eh) / areaF;
    const maxSideCover = Math.max(ew / Math.max(tw, 1e-6), eh / Math.max(th, 1e-6));
    /** Clip/full-bleed in master -> huge rect; post = letterbox/cover -- like background, delta is not a "slot bug". */
    if (areaRatio >= 0.85 || maxSideCover >= 0.95) return false;
  }
  return true;
}

export function buildPlacementAudit(
  resultFrame: INode,
  placements: ExactSessionPlacement[],
  geometry: ExactSessionGeometryOptions
): PlacementAuditPayload {
  const rememberGeometry = summarizeRememberGeometry(geometry);
  const trustBg = geometry.trustLetterboxBackgroundOverride === true;
  const tw0 = resultFrame.width;
  const th0 = resultFrame.height;
  const rows: PlacementAuditPayload['rows'] = [];
  for (const p of placements) {
    const comparableForAudit = isPlacementComparableForAudit(trustBg, p.slotType, p, tw0, th0);
    const expected = { x: p.x, y: p.y, w: p.w, h: p.h };
    let actual: { x: number; y: number; w: number; h: number } | null = null;
    let delta: { dx: number; dy: number; dw: number; dh: number } | null = null;
    let status: 'ok' | 'missing' = 'missing';
    const raw = getHost().getNodeById(p.resultNodeId);
    if (raw && !raw.removed) {
      try {
        actual = getBoundsInFrame(raw, resultFrame);
        delta = {
          dx: actual.x - p.x,
          dy: actual.y - p.y,
          dw: actual.w - p.w,
          dh: actual.h - p.h
        };
        status = 'ok';
      } catch {
        status = 'missing';
      }
    }
    rows.push({
      slotType: p.slotType,
      resultNodeId: p.resultNodeId,
      masterSourceNodeId: p.masterSourceNodeId,
      isBackdrop: p.isBackdrop,
      expected,
      actual,
      delta,
      status,
      comparableForAudit
    });
  }
  const deltasAll = rows.map(r => r.delta).filter((d): d is NonNullable<typeof d> => d != null);
  const maxAbsDeltaRaw =
    deltasAll.length === 0 ? 0 : Math.max(...deltasAll.map(maxAbsFromDelta));

  const deltasComparable = rows
    .filter(r => r.comparableForAudit && r.delta != null)
    .map(r => r.delta!);
  const maxAbsDelta =
    deltasComparable.length === 0
      ? 0
      : Math.max(...deltasComparable.map(maxAbsFromDelta));

  const tw = tw0;
  const th = th0;
  const eps = 1;
  let expectedRectNegativeXY = 0;
  let expectedRectPartiallyOutsideFrame = 0;
  for (const r of rows) {
    if (!r.comparableForAudit) continue;
    const e = r.expected;
    if (e.x < -eps || e.y < -eps) expectedRectNegativeXY += 1;
    if (
      e.x < -eps ||
      e.y < -eps ||
      e.x + e.w > tw + eps ||
      e.y + e.h > th + eps
    ) {
      expectedRectPartiallyOutsideFrame += 1;
    }
  }
  const nonComparableSlotCount = rows.filter(r => !r.comparableForAudit).length;
  const comparableSlotCount = rows.filter(r => r.comparableForAudit && r.status === 'ok').length;

  const TEXT_LIKE: readonly BannerElementType[] = ['title', 'description', 'disclaimer', 'ageRating'];
  let suspectedCollapsedTextCount = 0;
  for (const r of rows) {
    if (!r.comparableForAudit || r.status !== 'ok' || r.actual == null) continue;
    if (!TEXT_LIKE.includes(r.slotType)) continue;
    const h = r.actual.h;
    if (h > 0 && h < 12) suspectedCollapsedTextCount += 1;
  }

  const worstComparableSlots = rows
    .filter(r => r.comparableForAudit && r.delta != null && r.status === 'ok')
    .map(r => ({
      slotType: r.slotType,
      resultNodeId: r.resultNodeId,
      maxAbsDelta: maxAbsFromDelta(r.delta!)
    }))
    .sort((a, b) => b.maxAbsDelta - a.maxAbsDelta)
    .slice(0, 5);

  return {
    rememberGeometry,
    rows,
    summary: {
      count: rows.length,
      missing: rows.filter(r => r.status === 'missing').length,
      maxAbsDelta,
      health: maxAbsDelta < 1.5 ? 'PERFECT' : (maxAbsDelta < 15 ? 'TOLERABLE' : 'BROKEN'),
      maxAbsDeltaRaw,
      expectedRectNegativeXY,
      expectedRectPartiallyOutsideFrame,
      nonComparableSlotCount,
      comparableSlotCount,
      suspectedCollapsedTextCount,
      worstComparableSlots
    }
  };
}

export function buildSlotCounts(
  placements: ReadonlyArray<{ slotType: BannerElementType }>
): Record<string, number> {
  const m: Record<string, number> = {};
  for (const p of placements) {
    const k = p.slotType;
    m[k] = (m[k] ?? 0) + 1;
  }
  return m;
}

export function samplePlacementRows(
  placements: ReadonlyArray<{
    slotType: BannerElementType;
    resultNodeId: string;
    masterSourceNodeId?: string;
  }>
): NonNullable<ScaleRunLogPayload['remember']>['placementRowsSample'] {
  return placements.slice(0, PLACEMENT_SAMPLE_MAX).map(p => ({
    slotType: p.slotType,
    resultNodeId: p.resultNodeId,
    masterSourceNodeId: p.masterSourceNodeId
  }));
}

function slotTypeStrokeColor(slot: BannerElementType): string {
  switch (slot) {
    case 'title':
      return '#1a73e8';
    case 'description':
      return '#0f9d58';
    case 'background':
      return '#9e9e9e';
    case 'logo':
      return '#f9ab00';
    case 'button':
      return '#c5221f';
    case 'other':
      return '#7b1fa2';
    case 'disclaimer':
      return '#5f6368';
    case 'ageRating':
      return '#607d8b';
    default:
      return '#333333';
  }
}

function rectIntersectionArea(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);
  return w * h;
}

function buildSvgDriftOverlay(
  W: number,
  H: number,
  rows: PlacementAuditPayload['rows']
): string {
  const w0 = Math.max(1, W);
  const h0 = Math.max(1, H);

  let minX = 0;
  let minY = 0;
  let maxX = w0;
  let maxY = h0;

  for (const r of rows) {
    [r.expected, r.actual].forEach(rect => {
      if (!rect) return;
      minX = Math.min(minX, rect.x);
      minY = Math.min(minY, rect.y);
      maxX = Math.max(maxX, rect.x + rect.w);
      maxY = Math.max(maxY, rect.y + rect.h);
    });
  }

  const span = Math.max(maxX - minX, maxY - minY, 1);
  const pad = Math.max(16, 0.05 * span);
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = maxX - minX + 2 * pad;
  const vbH = maxY - minY + 2 * pad;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="100%" height="auto" style="max-width:800px;background:#f8f9fa;border-radius:8px;border:1px solid #dee2e6">`);

  // Frame background
  parts.push(`<rect x="0" y="0" width="${w0}" height="${h0}" fill="#ffffff" stroke="#ced4da" stroke-width="2"/>`);
  parts.push(`<text x="4" y="${h0 - 6}" font-size="10" fill="#adb5bd" font-family="monospace">${w0}x${h0}</text>`);

  rows.forEach(r => {
    const col = slotTypeStrokeColor(r.slotType);
    const exp = r.expected;
    const act = r.actual;

    // 1. Draw Expected (Ghost)
    parts.push(`<rect x="${exp.x}" y="${exp.y}" width="${exp.w}" height="${exp.h}" fill="none" stroke="${col}" stroke-width="1.5" stroke-dasharray="4,2" opacity="0.4"/>`);

    if (act && r.status === 'ok') {
      // 2. Draw Actual (Solid)
      parts.push(`<rect x="${act.x}" y="${act.y}" width="${act.w}" height="${act.h}" fill="${col}" fill-opacity="0.1" stroke="${col}" stroke-width="2" rx="1"/>`);

      // 3. Draw Drift Vector (Arrow) if significant
      const dx = act.x - exp.x;
      const dy = act.y - exp.y;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        const cxE = exp.x + exp.w / 2;
        const cyE = exp.y + exp.h / 2;
        const cxA = act.x + act.w / 2;
        const cyA = act.y + act.h / 2;
        parts.push(`<line x1="${cxE}" y1="${cyE}" x2="${cxA}" y2="${cyA}" stroke="#e03131" stroke-width="1.5" marker-end="url(#arrowhead)"/>`);
      }
    }
  });

  // Symbols for markers
  parts.push(`<defs><marker id="arrowhead" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto"><polygon points="0 0, 6 2, 0 4" fill="#e03131"/></marker></defs>`);
  parts.push(`</svg>`);
  return parts.join('');
}

export function buildLayoutVisualSummary(
  resultFrame: INode,
  audit: PlacementAuditPayload,
  flat: FrameTreeSnapshot | null
): LayoutVisualSummaryPayload {
  const W = Math.max(1, resultFrame.width);
  const H = Math.max(1, resultFrame.height);
  const resultRootChildren: LayoutVisualSummaryPayload['resultRootChildren'] = [];
  const children = resultFrame.children ?? [];
  for (let i = 0; i < children.length; i++) {
    const ch = children[i];
    if (ch.removed) continue;
    resultRootChildren.push({
      index: i,
      id: ch.id,
      type: ch.type,
      name: String(ch.name ?? ''),
      x: ch.x,
      y: ch.y,
      w: ch.width,
      h: ch.height
    });
  }

  const actualOverlapPairs: LayoutVisualSummaryPayload['actualOverlapPairs'] = [];
  const withActual = audit.rows.filter(
    (r): r is typeof r & { actual: { x: number; y: number; w: number; h: number } } =>
      r.actual != null && r.status === 'ok' && r.actual.w > 0 && r.actual.h > 0
  );
  for (let i = 0; i < withActual.length; i++) {
    for (let j = i + 1; j < withActual.length; j++) {
      const a = withActual[i]!;
      const b = withActual[j]!;
      const area = rectIntersectionArea(a.actual, b.actual);
      if (area > 0.5) {
        const aBg = a.slotType === 'background';
        const bBg = b.slotType === 'background';
        if (aBg !== bBg) continue;
        actualOverlapPairs.push({
          a: { slotType: a.slotType, resultNodeId: a.resultNodeId },
          b: { slotType: b.slotType, resultNodeId: b.resultNodeId },
          overlapAreaPx: area
        });
      }
    }
  }

  const duplicateNameAtRoot: LayoutVisualSummaryPayload['duplicateNameAtRoot'] = [];
  if (flat != null) {
    const rootId = resultFrame.id;
    const byName = new Map<string, string[]>();
    for (const row of flat.nodes) {
      if (row.parentId !== rootId || row.depth !== 0) continue;
      const nm = row.name.trim();
      if (!nm) continue;
      if (!byName.has(nm)) byName.set(nm, []);
      byName.get(nm)!.push(row.id);
    }
    for (const [name, ids] of byName) {
      if (ids.length > 1) duplicateNameAtRoot.push({ name, ids: [...new Set(ids)] });
    }
  }

  const svgActualSlotsPreview = buildSvgDriftOverlay(W, H, audit.rows);

  return {
    resultRootChildren,
    actualOverlapPairs,
    duplicateNameAtRoot,
    svgActualSlotsPreview
  };
}

// ── Diagnostic report builder ──

export function buildDiagnosticReport(
  resultFrame: INode,
  placements: ReadonlyArray<ExactSessionPlacement> | null,
  masterFrame: INode | null,
  targetWidth: number,
  targetHeight: number,
  traceStrings: string[],
  placementAudit: PlacementAuditPayload | null,
): DiagnosticReport {
  const issues: DiagnosticIssue[] = [];
  const nonSlotChildren: NonSlotChildRow[] = [];

  const slotNodeIds = new Set(placements?.map(p => p.resultNodeId) ?? []);

  // ── 1. Build master bounds by name (scaled to target) ──
  const masterBounds = new Map<string, { x: number; y: number; w: number; h: number }>();
  if (masterFrame) {
    const mW = Math.max(masterFrame.width, 1);
    const mH = Math.max(masterFrame.height, 1);
    const mChildren = masterFrame.children ?? [];
    for (const mc of mChildren) {
      if (mc.removed) continue;
      const name = String(mc.name ?? '').trim();
      if (!name || masterBounds.has(name)) continue;
      const mb = getBoundsInFrame(mc, masterFrame);
      if (mb.w < 1 || mb.h < 1) continue;
      masterBounds.set(name, {
        x: (mb.x / mW) * targetWidth,
        y: (mb.y / mH) * targetHeight,
        w: (mb.w / mW) * targetWidth,
        h: (mb.h / mH) * targetHeight,
      });
    }
  }

  // ── 2. Non-slot children audit ──
  const children = resultFrame.children ?? [];
  for (const ch of children) {
    if (ch.removed) continue;
    const isSlot = slotNodeIds.has(ch.id);
    const name = String(ch.name ?? '').trim();
    const bounds = getBoundsInFrame(ch, resultFrame);
    const master = masterBounds.get(name) ?? null;

    let driftPx = 0;
    const flags: string[] = [];

    if (master) {
      const dx = Math.abs(bounds.x - master.x);
      const dy = Math.abs(bounds.y - master.y);
      driftPx = Math.round(Math.max(dx, dy));
      if (driftPx > 20 && !isSlot) {
        flags.push(`DRIFT ${driftPx}px from master`);
        issues.push({
          severity: driftPx > 100 ? 'error' : 'warning',
          category: 'non-slot-drift',
          message: `"${name}" (${ch.type}) at (${Math.round(bounds.x)},${Math.round(bounds.y)}) — master (${Math.round(master.x)},${Math.round(master.y)}) drift ${driftPx}px`,
        });
      }
    }

    // Check if extends above/left of frame
    if (bounds.y < -5) flags.push(`extends ${Math.round(-bounds.y)}px above frame`);
    if (bounds.x < -5) flags.push(`extends ${Math.round(-bounds.x)}px left of frame`);

    // ── 3. Parent-child coherence (groups containing slots) ──
    // Gap threshold is relative to group size: padding within 15% of group span is normal.
    if ((ch.type === NodeType.Group || ch.type === NodeType.Frame) && ch.children) {
      const groupSpan = Math.max(bounds.w, bounds.h, 1);
      for (const grandchild of ch.children) {
        if (slotNodeIds.has(grandchild.id)) {
          const gcBounds = getBoundsInFrame(grandchild, resultFrame);
          const gap = Math.max(
            Math.abs(bounds.x - gcBounds.x),
            Math.abs(bounds.y - gcBounds.y),
          );
          const relGap = gap / groupSpan;
          if (relGap > 0.25) {
            flags.push(`child slot "${grandchild.name}" ${Math.round(gap)}px (${Math.round(relGap * 100)}%) from group origin`);
            issues.push({
              severity: relGap > 0.5 ? 'error' : 'warning',
              category: 'parent-child-gap',
              message: `GROUP "${name}" origin (${Math.round(bounds.x)},${Math.round(bounds.y)}) — slot child "${grandchild.name}" at (${Math.round(gcBounds.x)},${Math.round(gcBounds.y)}) gap ${Math.round(gap)}px (${Math.round(relGap * 100)}% of group span)`,
            });
          }
        }
      }
    }

    nonSlotChildren.push({
      name,
      type: ch.type,
      id: ch.id,
      actual: { x: Math.round(bounds.x), y: Math.round(bounds.y), w: Math.round(bounds.w), h: Math.round(bounds.h) },
      master,
      driftPx,
      isSlot,
      flags,
    });
  }

  // ── 4. Font audit (text slots) ──
  if (placements) {
    const minSide = Math.min(targetWidth, targetHeight);
    for (const p of placements) {
      if (p.slotType === 'background' || p.slotType === 'other') continue;
      const node = getHost().getNodeById(p.resultNodeId);
      if (!node || node.type !== NodeType.Text) continue;
      const fs = typeof node.fontSize === 'number' ? node.fontSize : null;
      if (fs == null) continue;
      const ratio = fs / minSide;
      if (ratio > 0.12) {
        issues.push({
          severity: 'warning',
          category: 'font-ratio',
          message: `"${node.name}" fontSize ${fs}px = ${(ratio * 100).toFixed(1)}% of ${minSide}px min-side (>12% threshold)`,
        });
      }
    }
  }

  // ── 5. Trace suspects ──
  for (const line of traceStrings) {
    if (/SKIP sibling.*displacement.*exceeds threshold/i.test(line)) {
      issues.push({ severity: 'info', category: 'trace-suspect', message: line.replace(/^\[Trace\]\s*/, '') });
    }
  }

  // ── Overall health ──
  const slotHealth = placementAudit?.summary.health ?? 'PERFECT';
  const hasError = issues.some(i => i.severity === 'error');
  const hasWarning = issues.some(i => i.severity === 'warning');
  const health: DiagnosticReport['health'] =
    hasError || slotHealth === 'BROKEN' ? 'BROKEN'
    : hasWarning || slotHealth === 'TOLERABLE' ? 'TOLERABLE'
    : 'PERFECT';

  return { issues, nonSlotChildren, health };
}

export function formatScaleRunLogMarkdown(payload: ScaleRunLogPayload): string {
  const lines: string[] = [];
  // Marker in .md: grep `bs-log:v1` or delete `logs/bs-log-*.md` when cleaning up.
  lines.push('<!-- bs-log:v1 glob=logs/bs-log-*.md -->');
  lines.push('');
  lines.push('# Banner Scaler — run log');
  lines.push('');
  lines.push(`- **Time (ISO):** ${payload.ts}`);
  lines.push(`- **Pipeline:** \`${payload.pipeline}\` · **Version:** \`${payload.pluginVersion}\``);
  lines.push(`- **Duration:** \`${payload.runMeta.durationMs}ms\``);

  if (payload.placementAudit) {
    const h = payload.placementAudit.summary.health;
    const icon = h === 'PERFECT' ? 'OK' : (h === 'TOLERABLE' ? 'WARN' : 'ERROR');
    lines.push(`- **Health Check:** ${icon} **${h}** (Max delta: ${payload.placementAudit.summary.maxAbsDelta.toFixed(1)}px)`);
  }
  // ── Diagnostic report (top of log for fast analysis) ──
  if (payload.diagnosticReport) {
    const dr = payload.diagnosticReport;
    lines.push(`- **Diagnostic health:** **${dr.health}** (${dr.issues.length} issue${dr.issues.length !== 1 ? 's' : ''})`);
    lines.push('');
    if (dr.issues.length > 0) {
      lines.push('## Diagnostic issues');
      lines.push('');
      for (const iss of dr.issues) {
        const icon = iss.severity === 'error' ? '❌' : iss.severity === 'warning' ? '⚠️' : 'ℹ️';
        lines.push(`${icon} **[${iss.category}]** ${iss.message}`);
      }
      lines.push('');
    }
    if (dr.nonSlotChildren.length > 0) {
      lines.push('## Non-slot children audit');
      lines.push('');
      lines.push('| z | type | name | actual | master | drift | slot | flags |');
      lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
      for (let i = 0; i < dr.nonSlotChildren.length; i++) {
        const r = dr.nonSlotChildren[i]!;
        const act = `${r.actual.x},${r.actual.y} ${r.actual.w}×${r.actual.h}`;
        const mas = r.master ? `${Math.round(r.master.x)},${Math.round(r.master.y)} ${Math.round(r.master.w)}×${Math.round(r.master.h)}` : '—';
        const fl = r.flags.length > 0 ? r.flags.join('; ') : '✓';
        lines.push(`| ${i} | \`${r.type}\` | ${r.name.slice(0, 30)} | ${act} | ${mas} | ${r.driftPx} | ${r.isSlot ? 'yes' : '—'} | ${fl} |`);
      }
      lines.push('');
    }
  }

  {
    const r = payload.resizeFrameContext;
    lines.push(`- **Scale:** ${Math.round(r.sourceW)}x${Math.round(r.sourceH)} → ${Math.round(r.targetW)}x${Math.round(r.targetH)} · temps: ${payload.scaleRequest.tempListCount}`);
    if (r.rememberMasterCapture) {
      const m = r.rememberMasterCapture;
      lines.push(`- **Master:** ${Math.round(m.width)}x${Math.round(m.height)} · root \`${m.rootFrameId}\``);
    }
  }
  lines.push('');
  if (payload.tempCapture) {
    const t = payload.tempCapture;
    lines.push('## Temp capture');
    lines.push('');
    lines.push(`- \`${t.label}\` · root \`${t.rootFrameId}\` · ${Math.round(t.width)}x${Math.round(t.height)} · sameRoot=${t.sameRootAsSource} · ${t.slotCount} slots`);
    lines.push('');
    if (t.slots.length > 0) {
      lines.push('| # | type | source node | name | left | top | w% | h% |');
      lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
      t.slots.forEach((s, i) => {
        lines.push(
          `| ${i + 1} | \`${s.slotType}\` | \`${s.sourceNodeId}\` | ${s.name ?? '—'} | ${s.left ?? '—'} | ${s.top ?? '—'} | ${s.widthRatio ?? '—'} | ${s.heightRatio ?? '—'} |`
        );
      });
      lines.push('');
    }
  }

  if (payload.trace && payload.trace.length > 0) {
    lines.push('## Post-processing trace');
    lines.push('');
    lines.push('```text');
    lines.push(...payload.trace);
    lines.push('```');
    lines.push('');
  }

  lines.push(`- **Source:** \`${payload.source.id}\` ${Math.round(payload.source.w)}x${Math.round(payload.source.h)} (${payload.sourceTree.descendantNodes} nodes) · **Result:** \`${payload.result.id}\` ${Math.round(payload.result.w)}x${Math.round(payload.result.h)}${payload.resultTree ? ` (${payload.resultTree.descendantNodes} nodes)` : ''}`);
  lines.push('');
  if (payload.rememberDiagnostics) {
    const rd = payload.rememberDiagnostics;
    lines.push('## Remember diagnostics');
    lines.push('');
    lines.push(`- **Branch:** \`${rd.branch}\``);
    const parts: string[] = [];
    if (rd.structuralPathFallbackStrict !== undefined) parts.push(`strictFallback=${rd.structuralPathFallbackStrict}`);
    if (rd.structuralPathFallbackCross !== undefined) parts.push(`crossFallback=${rd.structuralPathFallbackCross}`);
    if (rd.crossTargetRememberSpread !== undefined) parts.push(`AR-spread=${rd.crossTargetRememberSpread.toFixed(4)}`);
    if (rd.crossGeometryRewriteApplied !== undefined) parts.push(`crossRewrite=${rd.crossGeometryRewriteApplied}`);
    if (rd.crossLiveSourceFractionRewrite !== undefined) parts.push(`srcFractionRewrite=${rd.crossLiveSourceFractionRewrite}`);
    if (rd.masterCaptureVsSourceSpread !== undefined) parts.push(`masterSpread=${rd.masterCaptureVsSourceSpread.toFixed(4)}`);
    if (parts.length > 0) lines.push(`- ${parts.join(' · ')}`);
    if (rd.strictLiveVsStoredTempDelta != null) {
      const d = rd.strictLiveVsStoredTempDelta;
      lines.push(`- **Live vs stored:** src ${Math.round(d.sourceW)}x${Math.round(d.sourceH)} · stored ${Math.round(d.storedW)}x${Math.round(d.storedH)}`);
    }
    if (rd.exactSessionLayoutResolved != null) {
      const L = rd.exactSessionLayoutResolved;
      lines.push(`- **Layout:** Rw=${L.Rw.toFixed(1)} Rh=${L.Rh.toFixed(1)} u=${L.u.toFixed(4)} ox=${L.ox.toFixed(1)} oy=${L.oy.toFixed(1)} · _${L.note}_`);
    }
    lines.push('');
  }
  if (payload.enginePlacements && payload.enginePlacements.length > 0) {
    lines.push('## Engine placements');
    lines.push('');
    lines.push('| slot | result id | master src | x | y | w | h | backdrop |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const p of payload.enginePlacements) {
      lines.push(
        `| \`${p.slotType}\` | \`${p.resultNodeId}\` | ${p.masterSourceNodeId ? `\`${p.masterSourceNodeId}\`` : '—'} | ${p.x.toFixed(1)} | ${p.y.toFixed(1)} | ${p.w.toFixed(1)} | ${p.h.toFixed(1)} | ${p.isBackdrop === true ? 'yes' : '—'} |`
      );
    }
    lines.push('');
  } else if (payload.enginePlacements && payload.enginePlacements.length === 0) {
    lines.push('## Engine placements');
    lines.push('');
    lines.push('- _(Remember ran but produced zero placements -- see JSON `enginePlacements`: [])_');
    lines.push('');
  }
  if (payload.placementAudit) {
    lines.push('## Placement audit');
    lines.push('');
    const sum = payload.placementAudit.summary;
    lines.push(`- ${sum.count} slots · missing=${sum.missing} · max|Δ|=${sum.maxAbsDelta.toFixed(1)}px · negXY=${sum.expectedRectNegativeXY} · outside=${sum.expectedRectPartiallyOutsideFrame}${sum.suspectedCollapsedTextCount ? ` · collapsed=${sum.suspectedCollapsedTextCount}` : ''}`);
    lines.push('');
    lines.push('| Slot | Status | Expected | Actual | Delta Max | Vector |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const r of payload.placementAudit.rows) {
      const e = r.expected;
      const a = r.actual;
      const maxD = r.delta ? Math.max(Math.abs(r.delta.dx), Math.abs(r.delta.dy), Math.abs(r.delta.dw), Math.abs(r.delta.dh)) : 0;
      const icon = maxD < 1.5 ? 'OK' : (maxD < 15 ? 'WARN' : 'ERROR');
      const status = r.status === 'missing' ? 'MISSING' : icon;

      let vector = '—';
      if (r.delta) {
        const { dx, dy } = r.delta;
        const vx = dx > 0 ? '->' : (dx < 0 ? '<-' : '');
        const vy = dy > 0 ? 'v' : (dy < 0 ? '^' : '');
        vector = `\`${vx}${vy} ${Math.sqrt(dx*dx + dy*dy).toFixed(0)}px\``;
      }

      const slotCell = r.comparableForAudit ? `\`${r.slotType}\`` : `\`${r.slotType}\`*`;
      lines.push(
        `| ${slotCell} | ${status} | \`${e.x.toFixed(0)},${e.y.toFixed(0)}\` \`${e.w.toFixed(0)}x${e.h.toFixed(0)}\` | ${a ? `\`${a.x.toFixed(0)},${a.y.toFixed(0)}\` \`${a.w.toFixed(0)}x${a.h.toFixed(0)}\`` : '—'} | **${maxD.toFixed(1)}** | ${vector} |`
      );
    }
    lines.push('');
  }
  if (payload.layoutVisualSummary?.duplicateNameAtRoot?.length) {
    lines.push(`- **Duplicate root names:** ${payload.layoutVisualSummary.duplicateNameAtRoot.map(d => `\`${d.name.slice(0, 40)}\`(${d.ids.length})`).join(', ')}`);
    lines.push('');
  }
  {
    const flagStr = Object.entries(payload.flags).map(([k, v]) => `${k}=${v}`).join(' · ');
    lines.push(`- **Flags:** ${flagStr}`);
    lines.push('');
  }

  if (payload.layoutProfile) {
    lines.push(`- **Layout:** \`${payload.layoutProfile.layoutClass}\` ${Math.round(payload.layoutProfile.confidence * 100)}% · hints: \`${JSON.stringify(payload.layoutProfile.hints)}\``);
    lines.push('');
  }

  if (payload.remember) {
    const rm = payload.remember;
    lines.push(`- **Remember:** mode=\`${rm.mode}\` · ${rm.masterSlotCount} master slots · ${rm.placementsTotal} placements${rm.crossRewrite !== undefined ? ` · crossRewrite=${rm.crossRewrite}` : ''} · slots: \`${JSON.stringify(rm.slotCounts)}\``);
    lines.push('');
  }

  if (payload.guide) {
    lines.push(`- **Guide:** key=\`${payload.guide.targetGuideKey ?? '—'}\` · afterLetterbox=${payload.guide.afterUniformLetterbox}`);
    lines.push('');
  }

  // Full JSON omitted from markdown — use bs-log-debug.json if needed.

  return lines.join('\n');
}

/**
 * Single-run markdown already contains `<!-- bs-log:v1 -->` and `# Banner Scaler — run log`.
 * When merging multiple runs into one session file, strip that prefix from each chunk
 * to avoid duplicate headers and markers.
 */
export function stripScaleRunLogHeaderForSessionMerge(md: string): string {
  return md.replace(
    /^<!-- bs-log:v1[^\r\n]*\r?\n\r?\n# Banner Scaler — run log\r?\n\r?\n/,
    ''
  );
}

/** Stable prefix for filenames + bulk delete / grep (`logs/bs-log-*.md`). */
export const BS_LOG_FILE_PREFIX = 'bs-log';

export function scaleRunLogFilename(_isoTs: string): string {
  return `${BS_LOG_FILE_PREFIX}-universal.md`;
}

/** One file with all successful Scale runs since engine start (UI session buffer). */
export function scaleSessionLogFilename(): string {
  return `${BS_LOG_FILE_PREFIX}-session.md`;
}
