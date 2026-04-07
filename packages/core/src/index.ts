/**
 * Reframe Engine — Public API
 *
 * Usage (Figma):
 *   import { setHost, ClusterScalePipeline } from 'reframe';
 *   import { FigmaHost } from 'reframe/adapters/figma';
 *   setHost(new FigmaHost());
 *
 * Usage (Standalone):
 *   import { setHost } from 'reframe';
 *   import { SceneGraph } from 'reframe/engine';
 *   import { StandaloneHost } from 'reframe/adapters/standalone';
 *   const graph = new SceneGraph();
 *   setHost(new StandaloneHost(graph));
 */

// ── Host abstraction ──
export { setHost, getHost, resetHost } from './host/context';
export {
  NodeType,
  MIXED,
  type Mixed,
  type INode,
  type IHost,
  type IPaint,
  type ISolidPaint,
  type IGradientPaint,
  type IImagePaint,
  type IEffect,
  type IFontName,
  type IExportSettings,
} from './host/types';

// ── Geometry (pure math) ──
export {
  uniformScaleForLetterbox,
  uniformScaleToFitWidth,
  uniformScaleToFitHeight,
  centeredLetterboxOffsets,
  rectCenterLocal,
  translationToAlignCenters,
  layoutAspectSpread,
  aspectDeltaRelativeToTarget,
  type Rect,
  type Size,
  type Vec2,
  type LetterboxFit,
  type LetterboxOffsets,
} from './resize/geometry';

// ── Contracts ──
export type {
  ScaleParams,
  ScaleContext,
  ScaleModule,
  FrameAnalysis,
  NodeTransform,
  BannerElementType,
  GuideElement,
  GuideSize,
  GuidePreset,
  GuideData,
} from './resize/contracts/types';

// ── Layout Profile ──
export {
  resolveBannerLayoutProfile,
  resolveBannerLayoutProfileFromSignals,
  collectBannerLayoutSignals,
  mergeLayoutProfileIntoGeometry,
  BANNER_LAYOUT_CLASSIFIER_VERSION,
  type BannerLayoutClass,
  type BannerLayoutProfile,
  type BannerLayoutSignals,
  type EngineResizeHints,
  type MergeLayoutProfileContext,
} from './resize/layout-profile';

// ── Pipelines ──
export { ClusterScalePipeline, createClusterScalePipeline } from './resize/pipelines/cluster-scale';
export { analyzeFrame, findImageNodes, findTextNodes, findVectorNodes } from './resize/pipelines/analyzer';

// ── Scaling ──
export {
  scaleElement,
  freezeConstraintsSubtree,
  scaleButtonFrameUniform,
  finalizeButtonLabelLayout,
  stretchBackgroundToFill,
  stretchBackgroundNonUniformToFill,
  scaleToFill,
  calculateScale,
} from './resize/scaling/scaler';

// ── Constraints ──
export { applyConstraints, computeConstrainedPosition } from './engine/constraints';

// ── Template Engine ──
export { applyTemplate, extractTemplateVars } from './engine/template';
export type { TemplateData, TemplateResult } from './engine/template';
export type { ConstraintContext } from './engine/constraints';

// ── Importers ──
export { importFromFigma, importFromFigmaResponse } from './importers/figma-rest';
export type { FigmaImportOptions, FigmaImportResult } from './importers/figma-rest';
export { importFromSvg } from './importers/svg';
export type { SvgImportOptions, SvgImportResult } from './importers/svg';
export { importFromHtml } from './importers/html';
export type { HtmlImportOptions, HtmlImportResult } from './importers/html';

// ── Exporters ──
export { exportToSvg, exportSceneGraphToSvg } from './exporters/svg';
export type { SvgExportOptions } from './exporters/svg';
export { exportToRaster, initCanvasKit, isCanvasKitReady } from './exporters/raster';
export type { RasterExportOptions, RasterFormat } from './exporters/raster';
export { exportToHtml } from './exporters/html';
export type { HtmlExportOptions } from './exporters/html';

// ── Canva Adapter ──
export {
  CanvaHost,
  CanvaNodeAdapter,
  wrapCanvaElement,
  resetCanvaAdapterState,
  type CanvaSessionLike,
  type CanvaElementLike,
} from './adapters/canva';

// ── Design System ──
export {
  parseDesignMd,
  extractDesignSystemFromFrame,
  exportDesignMd,
  findTypographyForSlot,
  findTypographyForSlotAtWidth,
  getButtonBorderRadius,
  snapToRadiusScale,
  fontSizeMatchesRole,
  typographyRolesForSlot,
  slotForTypographyRole,
  type DesignSystem,
  type TypographyRule,
  type TypographyRole,
  type ButtonSpec,
  type ButtonStyle,
  type Breakpoint,
  type DesignSystemColors,
  type DesignSystemComponents,
  type DesignSystemLayout,
  type DesignSystemResponsive,
} from './design-system';

// ── Headless Adaptation ──
export {
  adapt,
  adaptFromGraph,
  type AdaptStrategy,
  type AdaptOptions,
  type AdaptResult,
} from './resize/adapt';

// ── Audit ──
export {
  audit, auditTransform, rule,
  textOverflow, nodeOverflow, minFontSize,
  fontInPalette, colorInPalette, contrastMinimum,
  noHiddenNodes, noEmptyText, noZeroSize,
  fontWeightCompliance, borderRadiusCompliance,
  spacingGridCompliance, fontSizeRoleMatch,
  visualHierarchy, contentDensity, visualBalance, ctaVisibility,
  exportFidelity,
  type AuditIssue,
  type AutoFix,
  type AuditRule,
  type AuditContext,
  type Severity,
} from './audit';

// ── Semantic Layer ──
export {
  detectSemanticRole,
  autoDetectRoles,
  semanticTag,
  ariaRole,
  headingLevel,
} from './semantic';

// ── Pipes ──
export {
  pipe, concat, when, forEach, tap, transform,
  type Transform,
  type Pipeline,
  type PipeContext,
  type PipeResult,
  type TraceEntry,
} from './resize/pipe';

export {
  analyze,
  classify,
  scaleTo, scaleBy, freezeConstraints,
  withDesignSystem, parseDesignRules, extractDesignRules,
  applyTemplateData,
  dedupeNames,
  setProp, removeWhere,
  snapshot,
} from './resize/transforms';

// ── Builder ──
export {
  build,
  buildInto,
  frame, rect, ellipse, text, group, component, line, star, polygon, vector,
  solid, linearGradient, radialGradient, image,
  dropShadow, innerShadow, blur,
  type NodeBlueprint,
  type NodeProps,
  type BuildResult,
} from './builder';

// ── Data ──
export { layoutGuide } from './resize/data/guides';

// ── Logging ──
export {
  engineLog,
  sessionLog,
  type LogLevel,
  type LogEntry,
  type RunLogSnapshot,
  type SessionRunRecord,
} from './resize/logging';

// ── Orchestration (high-level pipeline) ──
export {
  handleScale,
  type ScaleOptions,
  type ScaleResult,
  rememberAutoLayout,
  type RememberResult,
  buildSelectionChangedMessage,
  type SelectionNotifyOptions,
  getTempCaptures,
  getActiveTempId,
  getSuppressTempSync,
  setActiveTempId,
  setSuppressTempSync,
  resetSessionCaptures,
  getActiveCapture,
  pickBestGuideKeyForDimensions,
  type SessionSlotRow,
  type TempCapture,
} from './resize/orchestration';

// -- Serialize --
export {
  serializeNode, serializeToString, deserializeNode, deserializeFromString,
  serializeSceneNode, serializeGraph, serializeGraphToString,
  deserializeToGraph, deserializeScene,
  serializeTimeline, deserializeTimeline,
  migrateScene, migrateSceneJSON,
  SERIALIZE_VERSION,
} from './serialize';
export type { INodeJSON, SceneJSON, SerializeOptions } from './serialize';

// -- Diff --
export { diffTrees, formatDiff } from './diff';
export type { DiffEntry, DiffResult, DiffOptions, DiffType, PropertyChange } from './diff';

// -- React Export --
export { exportToReact } from './exporters/react';
export type { ReactExportOptions } from './exporters/react';

// -- Assertions --
export { assertDesign, formatAssertions, DesignAssertionError } from './assert';
export type { AssertionResult } from './assert';

// -- Animation --
export {
  resolveEasing, easingToCss,
  computeDuration, validateTimeline, interpolateProperties, sampleAnimation, sampleTimeline,
  presets, getPreset, listPresets, stagger,
  fadeIn, fadeOut, slideInLeft, slideInRight, slideInUp, slideInDown,
  scaleIn, scaleOut, popIn, revealLeft, revealUp,
  pulse, shake, bounce, typewriter, colorShift, blurIn,
} from './animation';
export type {
  Easing, EasingPreset, CubicBezier, SpringConfig,
  AnimatableProperties, AnimatableProperty,
  IKeyframe, INodeAnimation, ITimeline,
  FillMode, PlayDirection, AnimationPreset, ITimelineJSON,
} from './animation';

// -- Project --
export {
  PROJECT_VERSION,
  initProject,
  loadProject,
  projectExists,
  saveScene as saveProjectScene,
  loadSceneFromProject,
  listScenes as listProjectScenes,
  deleteScene as deleteProjectScene,
  saveDesignSystem,
  loadDesignSystem,
  readSceneJson,
  writeSceneJson,
  createManifest,
  createSceneEntry,
} from './project/index.js';
export type { ProjectManifest, SceneEntry, ProjectEvent } from './project/index.js';

// -- Animated Exporters --
export { exportToAnimatedHtml } from './exporters/animated-html';
export type { AnimatedHtmlExportOptions } from './exporters/animated-html';
export { exportToLottie, exportToLottieString } from './exporters/lottie';
export type { LottieExportOptions } from './exporters/lottie';

// -- UI Standard Library --
export { render, renderAll } from './ui/render';
export { createTheme, themed, fromDesignMd, fromDesignSystem, landing, reframe } from './ui/theme';
export type { ReframeConfig as ReframeUIConfig } from './ui/theme';
export type { Theme, ThemeColors, ThemeInput, LandingConfig } from './ui/theme';
export { resolveBlueprint, BLUEPRINT_TYPES } from './ui/blueprint';
export type { BlueprintNode } from './ui/blueprint';

// -- Compiler --
export { compileTemplate, autoPickLayout } from './compiler/index';
export type { CompileOptions, CompileContent, LayoutStyle } from './compiler/types';

// -- Config / Build System --
export { buildAll } from './config/build';
export { testAll } from './config/test';
export { findConfig, loadConfigJson, resolveDesignMd } from './config/loader';
export type { ReframeConfig, BuildOutput, TestOutput } from './config/types';
