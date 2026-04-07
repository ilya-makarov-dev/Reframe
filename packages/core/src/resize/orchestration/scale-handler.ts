/**
 * Orchestration — Scale Handler
 *
 * Central orchestrator: decides which pipeline to run and applies
 * post-processing (Remember, guide, layout profile).
 * Host-agnostic through IHost/INode — no Figma dependency.
 *
 * Ported from BFS plugin-scale-handler.ts, all figma.* calls
 * replaced with getHost() / INode operations.
 */

import { getHost } from '../../host/context';
import { NodeType, type INode } from '../../host/types';
import { engineLog } from '../logging';
import { sessionLog } from '../logging';
import { createClusterScalePipeline } from '../pipelines/cluster-scale';
import {
  applyGuidePostProcess,
  applyExactSessionPostProcess,
  getSemanticTypesForResultFrame,
  buildSourceToResultNodeIdMapWithMeta,
  refreshSessionCaptureAfterScale,
  buildCrossFrameSessionPlacements,
  rewriteCrossPlacementsFromSourceGeometry,
  buildStrictPlacementsWithLiveGeometry,
  syncPlacementPixelRectsFromElements,
} from '../postprocess/guide-scaler';
import { layoutGuide } from '../data/guides';
import { syncFrameExportConstraintsToFrameSize } from '../utils/frame-export-sync';
import { pickBestGuideKeyForDimensions } from './guide-picker';
import { layoutAspectSpread, layoutAspectSpread as aspectSpread } from '../geometry/aspect';
import {
  getTempCaptures,
  getActiveCapture,
  ASPECT_MISMATCH_AUTO_STRICT,
  TARGET_MATCHES_REMEMBER_ASPECT,
  pickBestSameRootCapture,
  syncTempCaptureLabel,
  pickCaptureMatchingTargetAspect,
  pickCaptureMatchingSourceAspect,
  setActiveTempId,
  setSuppressTempSync,
  tempSlotsAllUnderFrame,
  bindTempToFrame,
} from './session-state';
import { resolveBannerLayoutProfile, mergeLayoutProfileIntoGeometry } from '../layout-profile';
import type { ExactSessionGeometryOptions, ExactSessionPlacement } from '../postprocess/exact-session-types';
import {
  PLUGIN_VERSION,
  buildExactSessionLayoutSnapshot,
  buildFrameTreeFlat,
  buildFrameTreeStats,
  buildLayoutVisualSummary,
  buildPlacementAudit,
  buildDiagnosticReport,
  buildSlotCounts,
  buildResizeFrameContext,
  buildTempCaptureSnapshot,
  formatScaleRunLogMarkdown,
  samplePlacementRows,
  scaleRunLogFilename,
  type ScaleRunLogPayload,
} from '../utils/scale-run-log';
import { ensureUniqueDirectChildNames } from '../postprocess/dedupe-root-child-names';
import { tryResolveNodeById } from '../postprocess/figma-node-resolve';

/** Strict Remember via uniform letterbox (like oLD). */
const STRICT_REMEMBER_USE_CLUSTER_NATIVE = false;

export interface ScaleOptions {
  preserveProportions?: boolean;
  useGuide?: boolean;
  guideKey?: string;
  useSessionGuide?: boolean;
  tempCaptureId?: string;
  /** Optional design system for brand-aware adaptation. */
  designSystem?: import('../../design-system/types').DesignSystem;
}

export interface ScaleResult {
  success: boolean;
  message: string;
  resultNode?: INode;
  runLogMarkdown?: string;
  runLogFilename?: string;
}

/**
 * Main scale orchestrator.
 * Reads current selection, decides pipeline, applies post-processing.
 * Returns result — caller handles UI notification.
 */
export async function handleScale(
  newWidth: number,
  newHeight: number,
  options?: ScaleOptions,
): Promise<ScaleResult> {
  const host = getHost();
  const selection = host.getSelection();

  if (selection.length !== 1 || selection[0]!.type !== NodeType.Frame) {
    return { success: false, message: 'Please select a single Frame' };
  }

  const sourceFrame = selection[0]!;
  engineLog.startRun();
  const scaleRunT0 = Date.now();
  const tempCaptures = getTempCaptures();
  const userExplicitTemp = options?.tempCaptureId != null;

  let cap =
    (options?.tempCaptureId
      ? tempCaptures.find(c => c.id === options.tempCaptureId)
      : null) ?? getActiveCapture();

  // ── Auto-select best temp for cross-aspect ──

  const crossCapBeforeAspectFix =
    options?.useGuide === true &&
    options?.useSessionGuide === true &&
    cap != null &&
    cap.slots.length > 0 &&
    cap.rootFrameId !== sourceFrame.id &&
    !userExplicitTemp
      ? cap
      : null;

  if (crossCapBeforeAspectFix) {
    const c = crossCapBeforeAspectFix;
    const aspectSpreadVal = aspectSpread(c.width, c.height, sourceFrame.width, sourceFrame.height);
    const targetAlignsWithSelectedMaster =
      aspectSpread(newWidth, newHeight, c.width, c.height) <= TARGET_MATCHES_REMEMBER_ASPECT;

    if (aspectSpreadVal > ASPECT_MISMATCH_AUTO_STRICT && !targetAlignsWithSelectedMaster) {
      const sameRoot = pickBestSameRootCapture(sourceFrame.id, sourceFrame.width, sourceFrame.height);
      if (sameRoot) {
        cap = sameRoot;
        setActiveTempId(sameRoot.id);
        host.notify(
          `reframe: template ${Math.round(c.width)}×${Math.round(c.height)} has a different aspect than this frame — using Remember from this frame (${Math.round(sameRoot.width)}×${Math.round(sameRoot.height)}).`,
          { timeout: 9000 },
        );
      } else {
        host.notify(
          'reframe: template aspect ≠ this frame. Pick a temp that matches your target size to use that master\'s slot layout.',
          { timeout: 9000 },
        );
      }
    }
  }

  const tempLockedToThisBanner =
    cap != null &&
    (cap.rootFrameId === sourceFrame.id || tempSlotsAllUnderFrame(cap, sourceFrame.id));

  if (
    !tempLockedToThisBanner &&
    cap != null &&
    cap.slots.length > 0 &&
    options?.useGuide === true &&
    options?.useSessionGuide === true &&
    !userExplicitTemp
  ) {
    const targetAR = newWidth / Math.max(newHeight, 1e-6);
    const targetNearSquare = Math.abs(targetAR - 1) < 0.15;
    const chosenCap = targetNearSquare
      ? pickCaptureMatchingTargetAspect(newWidth, newHeight) ??
        pickCaptureMatchingSourceAspect(sourceFrame.width, sourceFrame.height)
      : pickCaptureMatchingTargetAspect(newWidth, newHeight);
    if (chosenCap != null && chosenCap.id !== cap.id) {
      cap = chosenCap;
      setActiveTempId(chosenCap.id);
      host.notify(
        `reframe: using master "${chosenCap.label}" for cross-format placement.`,
        { timeout: 7000 },
      );
    }
  }

  // ── Pipeline decision ──

  const tempCaptureSnapshot =
    cap != null ? buildTempCaptureSnapshot(cap, sourceFrame.id) : null;
  const sourceTreeStats = buildFrameTreeStats(sourceFrame);

  const pipeline = createClusterScalePipeline();
  let sessionMasterPromoted = false;
  let rememberRun: ScaleRunLogPayload['remember'] = null;
  let guideRun: ScaleRunLogPayload['guide'] = null;
  let finalPlacements: ExactSessionPlacement[] | null = null;
  let rememberGeometryForLog: ExactSessionGeometryOptions | null = null;
  let structuralPathFallbackStrict = false;
  let structuralPathFallbackCross = false;
  let crossTargetRememberSpreadLogged: number | undefined;
  let crossGeometryRewriteLogged = false;
  let strictLiveVsStoredTempDelta: {
    sourceW: number; sourceH: number; storedW: number; storedH: number;
  } | null = null;

  const preserve = options?.preserveProportions !== false;
  const sessionHasSlots =
    options?.useSessionGuide === true && cap != null && cap.slots.length > 0;

  engineLog.info('scale-handler', `source=${sourceFrame.name} ${sourceFrame.width}x${sourceFrame.height} → target=${newWidth}x${newHeight}`, {
    preserve, sessionHasSlots, useGuide: options?.useGuide, tempId: cap?.id ?? null,
  });

  const wantStrictRemember =
    sessionHasSlots &&
    (cap!.rootFrameId === sourceFrame.id || tempSlotsAllUnderFrame(cap!, sourceFrame.id));
  const wantCrossRemember = sessionHasSlots && !wantStrictRemember;
  const uniformSessionLikeOldSnapshot = sessionHasSlots && !STRICT_REMEMBER_USE_CLUSTER_NATIVE;
  const useUniformForGuideOnly = options?.useGuide === true && !sessionHasSlots;
  const useUniformLetterboxPipeline =
    uniformSessionLikeOldSnapshot ||
    wantCrossRemember ||
    useUniformForGuideOnly ||
    (options?.useGuide === true &&
      (preserve || sessionHasSlots) &&
      !(sessionHasSlots && wantStrictRemember));

  // ── Execute pipeline ──

  engineLog.info('scale-handler', `pipeline=${useUniformLetterboxPipeline ? 'uniform-letterbox' : 'cluster-execute'}`, {
    wantStrictRemember, wantCrossRemember, useUniformLetterboxPipeline,
  });

  const result = useUniformLetterboxPipeline
    ? await pipeline.executeUniformLetterbox(sourceFrame, newWidth, newHeight, {
        letterboxFit: 'contain',
        contentAwareLetterbox: false,
      })
    : await pipeline.execute(sourceFrame, newWidth, newHeight, preserve, false);

  // ── Layout profile ──

  engineLog.info('pipeline', `result: ${result.type} "${result.name}" ${result.width}x${result.height}`);

  let layoutProfile: ReturnType<typeof resolveBannerLayoutProfile> | null = null;
  if (result.type === NodeType.Frame) {
    layoutProfile = resolveBannerLayoutProfile(result);
    engineLog.info('layout-profile', `class=${layoutProfile.layoutClass} conf=${Math.round(layoutProfile.confidence * 100)}%`);
    if (sessionHasSlots) {
      host.notify(
        `reframe · layout: ${layoutProfile.layoutClass} (${Math.round(layoutProfile.confidence * 100)}% conf)`,
        { timeout: 5000 },
      );
    }
  }

  // ── Post-processing (Remember / Guide) ──

  if (options?.useGuide || sessionHasSlots) {
    const sessionOk = options!.useSessionGuide === true && cap != null && cap.slots.length > 0;
    const wantStrictSession =
      sessionOk &&
      (cap!.rootFrameId === sourceFrame.id || tempSlotsAllUnderFrame(cap!, sourceFrame.id));
    const wantCrossMasterSession = sessionOk && !wantStrictSession;

    if (wantStrictSession) {
      // ── Strict Remember ──
      engineLog.info('remember', 'strict Remember path — same frame or all slots under frame');
      const { map: sourceToResult, usedStructuralFallback } =
        await buildSourceToResultNodeIdMapWithMeta(sourceFrame, result);
      structuralPathFallbackStrict = usedStructuralFallback;

      if (usedStructuralFallback) {
        host.notify(
          'reframe: layers matched by tree path (clone DFS order differed — Remember slots fixed).',
          { timeout: 5000 },
        );
      }

      const srcW = sourceFrame.width;
      const srcH = sourceFrame.height;
      const capW = cap!.width;
      const capH = cap!.height;
      if (Math.abs(capW - srcW) > 1.5 || Math.abs(capH - srcH) > 1.5) {
        strictLiveVsStoredTempDelta = { sourceW: srcW, sourceH: srcH, storedW: capW, storedH: capH };
        host.notify(
          `reframe: live frame ${Math.round(srcW)}×${Math.round(srcH)} ≠ stored temp ${Math.round(capW)}×${Math.round(capH)} — slot geometry refreshed.`,
          { timeout: 7000 },
        );
      }

      const placements = buildStrictPlacementsWithLiveGeometry(sourceFrame, cap!.slots, sourceToResult);
      finalPlacements = placements;
      rememberRun = {
        mode: 'strict',
        masterSlotCount: cap!.slots.length,
        placementsTotal: placements.length,
        slotCounts: buildSlotCounts(placements),
        placementRowsSample: samplePlacementRows(placements),
      };

      if (placements.length > 0) {
        const strictGeometryBase = {
          mode: 'strict' as const,
          capture: { width: Math.round(srcW), height: Math.round(srcH) },
          sourceWidth: srcW,
          sourceHeight: srcH,
          sourceFrameId: sourceFrame.id,
          clusterNativeRescale: wantStrictRemember && STRICT_REMEMBER_USE_CLUSTER_NATIVE,
        };
        const strictGeometry = layoutProfile
          ? mergeLayoutProfileIntoGeometry(
              strictGeometryBase,
              layoutProfile,
              { wantStrictRemember, strictRememberUseClusterNativeGlobal: STRICT_REMEMBER_USE_CLUSTER_NATIVE },
            )
          : strictGeometryBase;
        rememberGeometryForLog = strictGeometry;
        await applyExactSessionPostProcess(result, newWidth, newHeight, placements, strictGeometry, {
          designSystem: options?.designSystem,
        });
      }

      // Rebind temp to output
      cap!.rootFrameId = result.id;
      cap!.width = Math.round(result.width);
      cap!.height = Math.round(result.height);
      syncTempCaptureLabel(cap!);
      cap!.slots = refreshSessionCaptureAfterScale(result, cap!.slots, sourceToResult);

    } else if (wantCrossMasterSession) {
      // ── Cross Remember ──
      engineLog.info('remember', `cross Remember — master ${cap!.width}x${cap!.height} (${cap!.label})`);
      const masterSnapshots = cap!.slots.map(s => ({
        sourceNodeId: s.sourceNodeId,
        slotType: s.slotType,
        element: { ...s.element },
      }));

      const { map: crossSourceToResult, usedStructuralFallback: crossStructuralFb } =
        await buildSourceToResultNodeIdMapWithMeta(sourceFrame, result);
      structuralPathFallbackCross = crossStructuralFb;

      if (crossStructuralFb) {
        host.notify(
          'reframe: clone tree order differed — cross layout used structural path match.',
          { timeout: 5000 },
        );
      }

      const crossGeometryMerged =
        layoutProfile && result.type === NodeType.Frame
          ? mergeLayoutProfileIntoGeometry(
              {
                mode: 'cross',
                capture: { width: cap!.width, height: cap!.height },
                sourceWidth: sourceFrame.width,
                sourceHeight: sourceFrame.height,
              },
              layoutProfile,
              { wantStrictRemember: false, strictRememberUseClusterNativeGlobal: STRICT_REMEMBER_USE_CLUSTER_NATIVE },
            )
          : null;

      const sessionMasterNode = tryResolveNodeById(cap!.rootFrameId);
      const sessionMasterFrame: INode | null =
        sessionMasterNode &&
        sessionMasterNode.type === NodeType.Frame &&
        !sessionMasterNode.removed
          ? sessionMasterNode
          : null;

      let placements = buildCrossFrameSessionPlacements(
        masterSnapshots,
        result,
        { width: cap!.width, height: cap!.height },
        {
          sourceFrame,
          sourceToResult: crossSourceToResult,
          masterFrame: sessionMasterFrame,
          skipNearSquareTextOrdinalOverride:
            crossGeometryMerged?.crossFrameSkipNearSquareOrdinalOverride === true,
        },
      );

      const targetRememberSpread = aspectSpread(newWidth, newHeight, cap!.width, cap!.height);
      const CROSS_GEOMETRY_REWRITE_SPREAD = 0.35;
      const rewritePlacementsToSourceGeometry = targetRememberSpread > CROSS_GEOMETRY_REWRITE_SPREAD;
      crossTargetRememberSpreadLogged = targetRememberSpread;
      crossGeometryRewriteLogged = rewritePlacementsToSourceGeometry;

      if (placements.length > 0) {
        const rewriteMode = rewritePlacementsToSourceGeometry ? 'strict' : 'cross';
        placements = rewriteCrossPlacementsFromSourceGeometry(
          placements,
          sourceFrame,
          crossSourceToResult,
          {
            mode: rewriteMode,
            capture: { width: cap!.width, height: cap!.height },
            sourceWidth: sourceFrame.width,
            sourceHeight: sourceFrame.height,
          },
          sessionMasterFrame,
          newWidth,
          newHeight,
        );
      }

      if (placements.length === 0) {
        finalPlacements = [];
        rememberRun = {
          mode: 'cross',
          masterSlotCount: masterSnapshots.length,
          placementsTotal: 0,
          slotCounts: {},
          placementRowsSample: [],
        };
        host.notify('Master layout: no slots matched on this frame (run Remember on it?)', { error: true });
      } else {
        const crossMode = rewritePlacementsToSourceGeometry ? ('strict' as const) : ('cross' as const);
        const crossGeometryFinal =
          crossGeometryMerged != null
            ? { ...crossGeometryMerged, mode: crossMode, trustSyncedPlacementRects: true }
            : {
                mode: crossMode,
                capture: { width: cap!.width, height: cap!.height },
                sourceWidth: sourceFrame.width,
                sourceHeight: sourceFrame.height,
                trustSyncedPlacementRects: true,
              };
        rememberGeometryForLog = crossGeometryFinal;
        placements = syncPlacementPixelRectsFromElements(
          placements,
          crossGeometryFinal,
          newWidth,
          newHeight,
        ).map(p => ({ ...p, element: { ...p.element } }));

        finalPlacements = placements;
        rememberRun = {
          mode: 'cross',
          masterSlotCount: masterSnapshots.length,
          placementsTotal: placements.length,
          slotCounts: buildSlotCounts(placements),
          placementRowsSample: samplePlacementRows(placements),
          crossRewrite: rewritePlacementsToSourceGeometry,
        };

        await applyExactSessionPostProcess(result, newWidth, newHeight, placements, crossGeometryFinal, {
          trustSyncedPlacementRects: true,
          crossSourceLayoutAlign: { sourceFrame, sourceToResult: crossSourceToResult },
          designSystem: options?.designSystem,
        });

        host.notify(
          'Master layout: scaled to target size first, then slots from your Remember temp.',
          { timeout: 9000 },
        );
        sessionMasterPromoted = true;
      }

    } else if (options?.useGuide) {
      // ── JSON Guide (no Remember) ──
      engineLog.info('guide', 'JSON guide path (no Remember)');
      let targetGuideKey = options?.guideKey;
      if (!targetGuideKey) {
        targetGuideKey = pickBestGuideKeyForDimensions(newWidth, newHeight, layoutGuide.guides);
      }
      const targetGuide = targetGuideKey ? layoutGuide.guides[targetGuideKey] : undefined;
      if (targetGuide) {
        const sw = sourceFrame.width;
        const sh = sourceFrame.height;
        const sourceGuideKey = pickBestGuideKeyForDimensions(sw, sh, layoutGuide.guides);
        const gSrc = sourceGuideKey ? layoutGuide.guides[sourceGuideKey] : undefined;
        const sourceGuideScore = gSrc
          ? Math.abs(gSrc.width - sw) + Math.abs(gSrc.height - sh)
          : Number.POSITIVE_INFINITY;
        const sourceGuide = sourceGuideKey && sourceGuideScore <= 280 ? gSrc : undefined;
        const semanticMap = await getSemanticTypesForResultFrame(sourceFrame, result, sourceGuide);
        await applyGuidePostProcess(result, newWidth, newHeight, targetGuide, semanticMap, {
          afterUniformLetterbox: useUniformForGuideOnly,
        });
        guideRun = {
          targetGuideKey: targetGuideKey ?? null,
          afterUniformLetterbox: useUniformForGuideOnly,
        };
      }
    }
  }

  // ── Finalize ──

  if (result.type === NodeType.Frame) {
    const dup = ensureUniqueDirectChildNames(result);
    if (dup > 0) {
      host.notify(
        `Renamed ${dup} duplicate root layer name(s) → "Name (1)"…`,
        { timeout: 4500 },
      );
    }
    const rw = Math.round(result.width);
    const rh = Math.round(result.height);
    result.name = `${rw}x${rh} (resized)`;
    syncFrameExportConstraintsToFrameSize(result);
  }

  if (options?.useSessionGuide === true && cap != null && cap.slots.length > 0) {
    bindTempToFrame(result.id, cap.id);
  }

  setSuppressTempSync(true);
  // Select and focus result — host-agnostic
  // Note: host may not support setSelection; caller can handle this.
  host.focusView?.([result]);
  setSuppressTempSync(false);

  host.notify(
    sessionMasterPromoted
      ? `Scaled ${newWidth}×${newHeight} — template bound to this output (chain next size here)`
      : `Scaled to ${newWidth}×${newHeight}`,
  );

  // ── Build run log ──

  const ts = new Date().toISOString();
  const pipelineName: ScaleRunLogPayload['pipeline'] = useUniformLetterboxPipeline
    ? 'uniform-letterbox'
    : 'cluster-execute';

  const layoutProfilePayload =
    layoutProfile != null
      ? {
          layoutClass: layoutProfile.layoutClass,
          confidence: layoutProfile.confidence,
          classifierVersion: layoutProfile.classifierVersion,
          hints: layoutProfile.hints,
          signals: layoutProfile.signals,
        }
      : null;

  const resultTreeStats = result.type === NodeType.Frame ? buildFrameTreeStats(result) : null;
  const sourceTreeFlat = buildFrameTreeFlat(sourceFrame);
  const resultTreeFlat = result.type === NodeType.Frame ? buildFrameTreeFlat(result) : null;

  const placementAudit =
    result.type === NodeType.Frame &&
    finalPlacements != null &&
    finalPlacements.length > 0 &&
    rememberGeometryForLog != null
      ? buildPlacementAudit(result, finalPlacements, rememberGeometryForLog)
      : null;

  if (placementAudit) {
    const h = placementAudit.summary.health;
    engineLog.info('audit', `health=${h} maxDelta=${placementAudit.summary.maxAbsDelta.toFixed(1)}px slots=${placementAudit.summary.count}`);
    if (h === 'BROKEN') {
      engineLog.warn('audit', 'BROKEN placement — check slot matching and geometry', placementAudit.summary);
    }
  }

  const layoutVisualSummary =
    result.type === NodeType.Frame && placementAudit != null
      ? buildLayoutVisualSummary(result, placementAudit, resultTreeFlat)
      : null;

  // ── Diagnostic report: non-slot audit, coherence, font, trace suspects ──
  let diagnosticReport: ScaleRunLogPayload['diagnosticReport'] = null;
  if (result.type === NodeType.Frame) {
    const masterFrameForDiag = tempCaptureSnapshot
      ? host.getNodeById(tempCaptureSnapshot.rootFrameId)
      : null;
    diagnosticReport = buildDiagnosticReport(
      result,
      finalPlacements,
      masterFrameForDiag,
      newWidth,
      newHeight,
      engineLog.getTraceStrings(),
      placementAudit,
    );
    if (diagnosticReport.health !== 'PERFECT') {
      engineLog.warn('diagnostic', `health=${diagnosticReport.health} issues=${diagnosticReport.issues.length}`);
    }
  }

  let rememberDiagnostics: ScaleRunLogPayload['rememberDiagnostics'] = rememberRun
    ? {
        branch: rememberRun.mode,
        ...(rememberRun.mode === 'strict'
          ? { structuralPathFallbackStrict, strictLiveVsStoredTempDelta }
          : {}),
        ...(rememberRun.mode === 'cross'
          ? {
              structuralPathFallbackCross,
              crossTargetRememberSpread: crossTargetRememberSpreadLogged,
              crossGeometryRewriteApplied: crossGeometryRewriteLogged,
              crossLiveSourceFractionRewrite:
                rememberRun.mode === 'cross' &&
                finalPlacements != null &&
                finalPlacements.length > 0,
            }
          : {}),
      }
    : null;

  if (rememberDiagnostics != null && rememberGeometryForLog != null) {
    const g = rememberGeometryForLog;
    const snap = buildExactSessionLayoutSnapshot(newWidth, newHeight, g);
    rememberDiagnostics = {
      ...rememberDiagnostics,
      exactSessionLayoutResolved: snap,
      ...(g.mode === 'cross' && g.capture
        ? {
            masterCaptureVsSourceSpread: layoutAspectSpread(
              g.capture.width,
              g.capture.height,
              Math.max(g.sourceWidth ?? g.capture.width, 1),
              Math.max(g.sourceHeight ?? g.capture.height, 1),
            ),
          }
        : {}),
    };
  }

  const resizeFrameContext =
    result.type === NodeType.Frame
      ? buildResizeFrameContext(sourceFrame, newWidth, newHeight, result, pipelineName, {
          uniformLetterbox: useUniformLetterboxPipeline
            ? { letterboxFit: 'contain' as const, contentAwareLetterbox: false }
            : null,
          clusterPreserve: useUniformLetterboxPipeline ? null : preserve,
          tempCapture: tempCaptureSnapshot,
        })
      : {
          sourceW: sourceFrame.width,
          sourceH: sourceFrame.height,
          targetW: newWidth,
          targetH: newHeight,
          uniformLetterbox: useUniformLetterboxPipeline
            ? { letterboxFit: 'contain' as const, contentAwareLetterbox: false }
            : null,
          clusterPreserve: useUniformLetterboxPipeline ? null : preserve,
          rememberMasterCapture: tempCaptureSnapshot
            ? {
                width: tempCaptureSnapshot.width,
                height: tempCaptureSnapshot.height,
                rootFrameId: tempCaptureSnapshot.rootFrameId,
              }
            : null,
          resultAbsolute: null,
          resultRelative: null,
        };

  const runLogPayload: ScaleRunLogPayload = {
    ts,
    pluginVersion: PLUGIN_VERSION,
    runMeta: {
      durationMs: Math.max(0, Date.now() - scaleRunT0),
      hostApiVersion: host.getEditorType?.() ?? 'unknown',
    },
    pipelineExecution: {
      uniformLetterbox: useUniformLetterboxPipeline
        ? { letterboxFit: 'contain' as const, contentAwareLetterbox: false }
        : null,
      clusterPreserve: useUniformLetterboxPipeline ? null : preserve,
    },
    sessionContext: {
      temps: tempCaptures.map(c => ({
        id: c.id,
        label: c.label,
        slotCount: c.slots.length,
        rootFrameId: c.rootFrameId,
      })),
    },
    pluginEnvironment: {
      editorType: host.getEditorType?.() ?? 'unknown',
      pageId: '',
      pageName: '',
      fileKey: host.getFileKey?.() ?? null,
    },
    scaleRequest: {
      preserveProportions: options?.preserveProportions,
      useGuide: options?.useGuide,
      guideKey: options?.guideKey,
      useSessionGuide: options?.useSessionGuide,
      tempCaptureId: options?.tempCaptureId ?? null,
      userExplicitTemp,
      tempListCount: tempCaptures.length,
    },
    tempCapture: tempCaptureSnapshot,
    source: {
      id: sourceFrame.id,
      name: sourceFrame.name,
      w: sourceFrame.width,
      h: sourceFrame.height,
    },
    sourceTree: sourceTreeStats,
    target: { w: newWidth, h: newHeight },
    result: {
      id: result.id,
      name: result.type === NodeType.Frame ? result.name : String(result.type),
      w: result.type === NodeType.Frame ? result.width : 0,
      h: result.type === NodeType.Frame ? result.height : 0,
    },
    resultTree: resultTreeStats,
    sourceTreeFlat,
    resultTreeFlat,
    enginePlacements: finalPlacements != null ? finalPlacements.map(p => ({ ...p })) : null,
    placementAudit,
    layoutVisualSummary,
    rememberDiagnostics,
    trace: engineLog.getTraceStrings(),
    diagnosticReport,
    pipeline: pipelineName,
    resizeFrameContext,
    flags: {
      sessionHasSlots,
      wantStrictRemember,
      wantCrossRemember,
      useUniformLetterboxPipeline,
      preserveProportions: preserve,
      strictRememberUseClusterNative: STRICT_REMEMBER_USE_CLUSTER_NATIVE,
    },
    layoutProfile: layoutProfilePayload,
    remember: rememberRun,
    guide: guideRun,
  };

  const runLogMarkdown = formatScaleRunLogMarkdown(runLogPayload);
  const runLogFilenameStr = scaleRunLogFilename(ts);
  const runSnapshot = engineLog.endRun();

  // Accumulate into engine-level session log
  sessionLog.pushRun({
    ts,
    markdown: runLogMarkdown,
    filename: runLogFilenameStr,
    eventLog: runSnapshot,
  });

  engineLog.info('scale-handler', `run complete — session has ${sessionLog.count} run(s)`);

  return {
    success: true,
    message: `Created frame "${result.name}"`,
    resultNode: result,
    runLogMarkdown,
    runLogFilename: runLogFilenameStr,
  };
}
