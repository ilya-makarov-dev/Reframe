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
export { setHost, getHost, resetHost, runWithHost, runWithHostAsync } from './host/context';
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
  // DTCG Token Interop
  exportToDTCG,
  importFromDTCG,
  designSystemToDTCG,
  type DTCGToken,
  type DTCGGroup,
  type DTCGFile,
  type DTCGImportOptions,
} from './design-system';

// ── Aesthetic Scoring ──
export {
  computeAestheticScore,
  measureAlignment,
  measureWhitespace,
  measureHarmony,
  measureProportion,
  measureRhythm,
  measureReadability,
  scoreToRating,
  AESTHETIC_WEIGHTS,
  type AestheticScore,
} from './aesthetic';

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
  fontFeaturesCompliance, spacingScaleCompliance,
  componentSpecCompliance, stateCompleteness,
  visualHierarchy, contentDensity, visualBalance, ctaVisibility,
  exportFidelity,
  type AuditIssue,
  type AutoFix,
  type AuditRule,
  type AuditContext,
  type Severity,
} from './audit';
export {
  buildInspectAuditRules,
  type InspectAuditRuleOptions,
} from './inspect-audit-rules';

// ── Semantic Layer ──
export {
  detectSemanticRole,
  autoDetectRoles,
  semanticTag,
  ariaRole,
  headingLevel,
  classifyScene,
  readSemanticSkeleton,
} from './semantic';
export type {
  ClassifyOptions,
  ClassifyResult,
  SemanticSlot,
  DetectedRole,
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

// -- Deserialize errors (HTTP / tools) --
export {
  REFRAME_DESERIALIZE_KIND,
  deserializeErrorHttpJson,
} from './deserialize-error';
export type { DeserializeErrorBody, DeserializeErrorCode } from './deserialize-error';

// -- Scene envelope (canonical doc; types re-exported from serialize) --
export type { SceneEnvelope } from './spec/scene-envelope';
export { SCENE_NODE_CHANGE_CHECKLIST } from './spec/scene-envelope';

// -- Serialize --
export {
  serializeNode, serializeToString, deserializeNode, deserializeFromString,
  serializeSceneNode, serializeGraph, serializeGraphToString,
  deserializeToGraph, deserializeScene, hydrateSceneImagesBase64,
  serializeTimeline, deserializeTimeline,
  migrateScene, migrateSceneJSON,
  SERIALIZE_VERSION,
  normalizeImportFills,
  normalizeImportStrokes,
  normalizeImportEffects,
  normalizeImportStyleRuns,
  applyImportedNodeLayoutProps,
  importSceneNodeFallback,
} from './serialize';
export type { INodeJSON, SceneJSON, SerializeOptions } from './serialize';

// -- Diff --
export { diffTrees, formatDiff } from './diff';
export type { DiffEntry, DiffResult, DiffOptions, DiffType, PropertyChange, FormatDiffOptions } from './diff';

// -- React Export --
export {
  exportToReact,
  exportToReactModule,
  exportToReactTree,
} from './exporters/react';
export type {
  ReactExportOptions,
  ReactExportResult,
  ReactTreeOptions,
  ReactTreeResult,
  ReactTreeManifest,
  ReactTreeTarget,
} from './exporters/react';

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
export { timelineToWaapi, type WaapiOutput, type WaapiNodeAnimation } from './animation/to-waapi';

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

// -- Content (Markdown Control Layer) --
export { extractContent } from './content/index';
export { applyContent, formatApplyResult } from './content/index';
export type {
  ContentProjection, ContentElement, ContentEdit, ContentApplyResult, BackReference,
} from './content/index';

// -- Brand Fidelity --
export { computeBrandFidelity, formatBrandFidelity } from './brand-fidelity';
export type { BrandFidelityResult, BrandFidelityBreakdown } from './brand-fidelity';

// -- Pattern Detection (Emergent Design System) --
export { detectPatterns, detectPatternsFromGraphs, formatPatternDetection } from './pattern-detection';
export type { PatternCandidate, PatternInstance, InferredProp, PatternDetectionResult, PatternDetectionOptions } from './pattern-detection';

// -- Project Audit (Multi-Scene Intelligence) --
export { auditProject, formatProjectAudit } from './project-audit';
export type { ProjectAuditResult, SceneAuditSummary, CrossSceneIssue, ProjectAuditOptions } from './project-audit';

// -- Config / Build System --
export { buildAll } from './config/build';
export { testAll } from './config/test';
export { findConfig, loadConfigJson, resolveDesignMd } from './config/loader';
export type { ReframeConfig, BuildOutput, TestOutput } from './config/types';

// -- Variations (design space explorer) --
export {
  scaleSpacing,
  scaleRadius,
  scaleShadows,
  rotateColors,
  applyTypographyPreset,
  generateVariationGrid,
} from './variations/index';
export type {
  ScaleSpacingOptions,
  RadiusStrategy,
  ShadowStrategy,
  ColorRotation,
  TypographyPreset,
  VariationAxes,
  VariationRecipe,
} from './variations/index';

// ── Scene graph + standalone adapter (for CLI and downstream consumers) ──
export { SceneGraph } from './engine/scene-graph';
export type { SceneNode } from './engine/types';
export type {
  NodeIntent,
  AgentGesture,
  DragHandleSpec,
  KeybindingSpec,
  MountSlotSpec,
} from './engine/types';
export {
  computeSemanticPaths,
  findNodeByPath,
  substituteGestureArgs,
} from './engine/semantic-path';

// ── Agent-operable reference panels (Phase 0 + 2A) ──
export {
  composeBrandPalettePanel,
  type PaletteEntry,
  type BrandPaletteOptions,
} from './panels/brand-palette';
export {
  composeVariantPickerPanel,
  type VariantEntry,
  type VariantPickerOptions,
} from './panels/variant-picker';
export { StandaloneHost } from './adapters/standalone/adapter';
export { StandaloneNode } from './adapters/standalone/node';

// ── Engine layout + fonts + yoga init ──
export {
  computeLayout,
  computeAllLayouts,
  ensureSceneLayout,
  configureMultiColumn,
  setTextMeasurer,
} from './engine/layout';
export {
  loadFont,
  ensureNodeFont,
  collectFontKeys,
  setFontRegistrar,
} from './engine/fonts';
export { initYoga, setLayoutBackend, getLayoutBackend, type LayoutBackend } from './engine/yoga-init';

// ── Config types (CLI logger interfaces) ──
export type { BuildLogger } from './config/build';
export type { TestLogger } from './config/test';
