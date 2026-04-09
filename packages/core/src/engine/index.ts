/**
 * Reframe Standalone Engine — Public API
 *
 * The complete standalone engine: scene graph, layout, fonts,
 * text, geometry, rendering — all without Figma dependencies.
 */

// ── Scene Graph ───────────────────────────────────
export { SceneGraph, generateId, resetIdCounter, createDefaultNode } from './scene-graph';

// ── Types ─────────────────────────────────────────
export type {
  SceneNode,
  NodeType,
  SceneGraphEvents,
  Color, Vector, Rect,
  Fill, FillType, GradientStop, GradientTransform, ImageScaleMode,
  Stroke, StrokeAlign, StrokeCap, StrokeJoin,
  Effect, EffectType,
  TextAlignHorizontal, TextAlignVertical, TextAutoResize,
  TextCase, TextDecoration, TextTruncation,
  CharacterStyleOverride, StyleRun,
  LayoutMode, LayoutWrap, LayoutAlign, LayoutCounterAlign,
  LayoutSizing, LayoutAlignSelf, LayoutPositioning,
  ConstraintType, GridTrack, GridPosition,
  VectorNetwork, VectorVertex, VectorSegment, VectorRegion,
  GeometryPath, ArcData,
  HandleMirroring, WindingRule, MaskType, BlendMode,
  Variable, VariableCollection, VariableType, VariableValue, VariableMode,
} from './types';
export { CONTAINER_TYPES } from './types';

// ── Geometry ──────────────────────────────────────
export {
  degToRad, radToDeg,
  rotatePoint, rotatedCorners, rotatedBBox,
  computeAbsolutePosition, computeAbsoluteBounds,
  buildAffineTransform,
  type AffineMatrix, type RotatedBBox,
} from './geometry';

// ── Layout ────────────────────────────────────────
export {
  setYoga, getYoga,
  setTextMeasurer,
  computeLayout, computeAllLayouts, ensureSceneLayout,
  type YogaInstance, type YogaNode, type TextMeasurer,
} from './layout';

// ── Yoga WASM Init ───────────────────────────────
export { initYoga } from './yoga-init';

// ── Template Engine ──────────────────────────────
export {
  applyTemplate,
  extractTemplateVars,
} from './template';
export type { TemplateData, TemplateResult } from './template';

// ── Text Measurement ─────────────────────────────
export {
  initTextMeasurer,
  createTextMeasurer,
  loadFontForMeasurement,
  loadFontFile,
  getLoadedFontCount,
  isOpentypeAvailable,
} from './text-measure';

// ── Fonts ─────────────────────────────────────────
export {
  setFontRegistrar,
  loadFont, ensureNodeFont,
  isFontLoaded, getLoadedFontData, markFontLoaded,
  styleToWeight, weightToStyle, styleToVariant, normalizeFontFamily,
  isVariableFont,
  queryFonts, listFamilies,
  collectFontKeys,
  getCJKFallbackFamily, setCJKFallbackFamily, ensureCJKFallback,
  registerBundledFont,
  type FontRegistrar, type FontInfo,
} from './fonts';

// ── Style Runs ────────────────────────────────────
export {
  getStyleAt,
  applyStyleToRange, removeStyleFromRange,
  selectionHasStyle,
  adjustRunsForInsert, adjustRunsForDelete,
  toggleBoldInRange, toggleItalicInRange, toggleDecorationInRange,
} from './style-runs';

// ── Renderer ──────────────────────────────────────
export {
  Renderer,
  EffectCache,
  applyFill, applySolidFill, applyLinearGradient, applyRadialGradient, applySweepGradient, applyImageFill,
  configureStrokePaint, drawStrokeWithAlign,
  makeNodeShapePath, makeRRect, nodeRect, hasRadius,
  buildParagraph, measureTextNode, renderText,
  type ICanvasKit, type IRPaint, type IRCanvas, type IRSurface, type IRPath,
  type IRImage, type IRParagraph, type Viewport,
} from './renderer';
