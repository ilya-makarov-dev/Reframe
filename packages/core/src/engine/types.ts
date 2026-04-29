/**
 * Reframe Standalone Engine — Core Types
 *
 * Core type definitions for SceneNode and related types.
 *
 * Originally adapted from the OpenPencil project (https://github.com/open-pencil/open-pencil),
 * licensed under the MIT License. Substantial rework and additions for the reframe architecture
 * (semanticRole, states, responsive, meta, tokenBindings, contentSlots, fontFeatureSettings).
 * Reframe modifications licensed under AGPL-3.0-or-later; the original OpenPencil portions
 * remain under MIT — see `NOTICE` in the repository root.
 */

// ─── Node Types ─────────────────────────────────────────────────

export type NodeType =
  | 'CANVAS'
  | 'FRAME'
  | 'RECTANGLE'
  | 'ROUNDED_RECTANGLE'
  | 'ELLIPSE'
  | 'TEXT'
  | 'LINE'
  | 'STAR'
  | 'POLYGON'
  | 'VECTOR'
  | 'GROUP'
  | 'SECTION'
  | 'COMPONENT'
  | 'COMPONENT_SET'
  | 'INSTANCE'
  | 'CONNECTOR'
  | 'SHAPE_WITH_TEXT';

export const CONTAINER_TYPES = new Set<NodeType>([
  'CANVAS',
  'FRAME',
  'GROUP',
  'SECTION',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
]);

// ─── Color ──────────────────────────────────────────────────────

export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

// ─── Vector ─────────────────────────────────────────────────────

export interface Vector {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─── Fill ───────────────────────────────────────────────────────

export type FillType =
  | 'SOLID'
  | 'GRADIENT_LINEAR'
  | 'GRADIENT_RADIAL'
  | 'GRADIENT_ANGULAR'
  | 'GRADIENT_DIAMOND'
  | 'IMAGE';

export interface GradientStop {
  color: Color;
  position: number;
}

export interface GradientTransform {
  m00: number; m01: number; m02: number;
  m10: number; m11: number; m12: number;
}

export type ImageScaleMode = 'FILL' | 'FIT' | 'CROP' | 'TILE';

export interface Fill {
  type: FillType;
  color: Color;
  opacity: number;
  visible: boolean;
  gradientStops?: GradientStop[];
  gradientTransform?: GradientTransform;
  imageHash?: string;
  imageScaleMode?: ImageScaleMode;
  imageTransform?: GradientTransform;
  colorVariableBinding?: string;
}

// ─── Stroke ─────────────────────────────────────────────────────

export type StrokeAlign = 'INSIDE' | 'CENTER' | 'OUTSIDE';
export type StrokeCap = 'NONE' | 'ROUND' | 'SQUARE' | 'ARROW_LINES' | 'ARROW_EQUILATERAL';
export type StrokeJoin = 'MITER' | 'BEVEL' | 'ROUND';

export interface Stroke {
  color: Color;
  weight: number;
  opacity: number;
  visible: boolean;
  align: StrokeAlign;
  cap?: StrokeCap;
  join?: StrokeJoin;
  dashPattern?: number[];
}

// ─── Effect ─────────────────────────────────────────────────────

export type EffectType =
  | 'DROP_SHADOW'
  | 'INNER_SHADOW'
  | 'LAYER_BLUR'
  | 'BACKGROUND_BLUR'
  | 'FOREGROUND_BLUR';

export interface Effect {
  type: EffectType;
  color: Color;
  offset: Vector;
  radius: number;
  spread: number;
  visible: boolean;
  blendMode?: string;
}

// ─── Text ───────────────────────────────────────────────────────

export type TextAlignHorizontal = 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
export type TextAlignVertical = 'TOP' | 'CENTER' | 'BOTTOM';
export type TextAutoResize = 'NONE' | 'HEIGHT' | 'WIDTH_AND_HEIGHT' | 'TRUNCATE';
export type TextCase = 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE';
export type TextDecoration = 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';
export type TextTruncation = 'DISABLED' | 'ENDING';

export interface CharacterStyleOverride {
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  italic?: boolean;
  letterSpacing?: number;
  lineHeight?: number | null;
  textDecoration?: TextDecoration;
  textCase?: TextCase;
  fillColor?: Color;
}

export interface StyleRun {
  start: number;
  length: number;
  style: CharacterStyleOverride;
}

// ─── Layout ─────────────────────────────────────────────────────

export type LayoutMode = 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID';
export type LayoutWrap = 'NO_WRAP' | 'WRAP';
export type LayoutAlign = 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN' | 'SPACE_AROUND';
export type LayoutCounterAlign = 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'BASELINE';
export type LayoutSizing = 'FIXED' | 'HUG' | 'FILL';
export type LayoutAlignSelf = 'AUTO' | 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'BASELINE';
export type LayoutPositioning = 'AUTO' | 'ABSOLUTE';

export type ConstraintType = 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE';

export interface GridTrack {
  type: 'FIXED' | 'FR' | 'AUTO';
  value: number;
}

export interface GridPosition {
  column: number;
  row: number;
  columnSpan: number;
  rowSpan: number;
}

// ─── Vector Network ─────────────────────────────────────────────

export type HandleMirroring = 'NONE' | 'ANGLE' | 'ANGLE_AND_LENGTH';
export type WindingRule = 'EVENODD' | 'NONZERO';

export interface VectorVertex {
  x: number;
  y: number;
  strokeCap?: StrokeCap;
  strokeJoin?: StrokeJoin;
  cornerRadius?: number;
  handleMirroring?: HandleMirroring;
}

export interface VectorSegment {
  start: number;
  end: number;
  tangentStart: Vector;
  tangentEnd: Vector;
}

export interface VectorRegion {
  windingRule: WindingRule;
  loops: number[][];
}

export interface VectorNetwork {
  vertices: VectorVertex[];
  segments: VectorSegment[];
  regions: VectorRegion[];
}

export interface GeometryPath {
  commandsBlob: Uint8Array;
  windingRule: WindingRule;
}

// ─── Arc Data ───────────────────────────────────────────────────

export interface ArcData {
  startingAngle: number;
  endingAngle: number;
  innerRadius: number;
}

// ─── Mask ───────────────────────────────────────────────────────

export type MaskType = 'ALPHA' | 'VECTOR' | 'LUMINANCE';

// ─── Blend Mode ─────────────────────────────────────────────────

export type BlendMode =
  | 'PASS_THROUGH' | 'NORMAL'
  | 'DARKEN' | 'MULTIPLY' | 'COLOR_BURN' | 'LINEAR_BURN'
  | 'LIGHTEN' | 'SCREEN' | 'COLOR_DODGE' | 'LINEAR_DODGE'
  | 'OVERLAY' | 'SOFT_LIGHT' | 'HARD_LIGHT'
  | 'DIFFERENCE' | 'EXCLUSION'
  | 'HUE' | 'SATURATION' | 'COLOR' | 'LUMINOSITY';

// ─── SceneNode ──────────────────────────────────────────────────

export interface SceneNode {
  // Identity
  id: string;
  type: NodeType;
  name: string;
  parentId: string | null;
  childIds: string[];

  // Transform
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;

  // Visual
  fills: Fill[];
  strokes: Stroke[];
  effects: Effect[];
  opacity: number;
  blendMode: BlendMode;
  visible: boolean;
  /**
   * @editorState — **UI lock flag**, NOT part of the design AST.
   * Editor-only: "prevent accidental selection / drag on canvas" — has
   * no effect on layout, rendering, or export. Serializer/exporters drop
   * it via `EDITOR_STATE_KEYS` (see `engine/editor-state.ts`). Long-term
   * this field moves off `SceneNode` into `WorkspaceState.lockedIds`.
   */
  locked: boolean;
  clipsContent: boolean;

  // Corner radius
  cornerRadius: number;
  topLeftRadius: number;
  topRightRadius: number;
  bottomRightRadius: number;
  bottomLeftRadius: number;
  independentCorners: boolean;
  cornerSmoothing: number;

  // Stroke details
  strokeCap: StrokeCap;
  strokeJoin: StrokeJoin;
  dashPattern: number[];
  borderTopWeight: number;
  borderRightWeight: number;
  borderBottomWeight: number;
  borderLeftWeight: number;
  independentStrokeWeights: boolean;
  strokeMiterLimit: number;

  // Text
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  italic: boolean;
  textAlignHorizontal: TextAlignHorizontal;
  textAlignVertical: TextAlignVertical;
  textAutoResize: TextAutoResize;
  textCase: TextCase;
  textDecoration: TextDecoration;
  lineHeight: number | null;
  letterSpacing: number;
  maxLines: number | null;
  styleRuns: StyleRun[];
  textTruncation: TextTruncation;
  /**
   * @runtimeCache — pre-rasterized glyph picture from CanvasKit.
   * Figma-inherited perf hack; no semantic meaning, never persisted
   * (serializer skips because Uint8Array ≠ JSON-safe). Moves to
   * `graph.runtimeCache.textPictures: Map<nodeId, Uint8Array>` in the
   * eventual runtime-cache extraction pass. See `engine/editor-state.ts`
   * for `RUNTIME_CACHE_KEYS` registry.
   */
  textPicture: Uint8Array | null;
  /** OpenType font feature settings: ['ss01', 'tnum', 'cv01'] → font-feature-settings: "ss01", "tnum", "cv01" */
  fontFeatureSettings: string[];

  // Constraints
  horizontalConstraint: ConstraintType;
  verticalConstraint: ConstraintType;

  // Layout (Auto Layout / Flex)
  layoutMode: LayoutMode;
  layoutWrap: LayoutWrap;
  primaryAxisAlign: LayoutAlign;
  counterAxisAlign: LayoutCounterAlign;
  primaryAxisSizing: LayoutSizing;
  counterAxisSizing: LayoutSizing;
  itemSpacing: number;
  counterAxisSpacing: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;

  // Layout self (child-specific)
  layoutPositioning: LayoutPositioning;
  layoutGrow: number;
  layoutAlignSelf: LayoutAlignSelf;

  // Grid
  gridTemplateColumns: GridTrack[];
  gridTemplateRows: GridTrack[];
  /**
   * Parsed CSS grid-template-areas matrix — each row is an array of
   * area-name cells, with `.` marking an empty cell. The importer fills
   * this on the PARENT when it sees `grid-template-areas`; children that
   * specify `grid-area: <name>` then look up the bounding box of that
   * name in this matrix to derive their gridPosition (col/row/span).
   * Empty array when the grid uses only track counts (no named areas).
   */
  gridTemplateAreas: string[][];
  gridColumnGap: number;
  gridRowGap: number;
  /**
   * Implicit track size for rows/columns created beyond the explicit
   * `gridTemplateRows`/`gridTemplateColumns`. Populated from CSS
   * `grid-auto-rows` / `grid-auto-columns`. When only columns are
   * declared but children span multiple rows, the layout engine uses
   * this track as the template for every implicit row — otherwise the
   * grid collapses to content height (one `FR` row split evenly)
   * because `gridTemplateRows` is empty. Typical value:
   * `{ type: 'FIXED', value: 200 }` for a Bento-style grid with
   * `grid-auto-rows: 200px`.
   */
  gridAutoRows: GridTrack | null;
  gridAutoColumns: GridTrack | null;
  gridPosition: GridPosition | null;
  counterAxisAlignContent: 'AUTO' | 'SPACE_BETWEEN';
  itemReverseZIndex: boolean;
  strokesIncludedInLayout: boolean;

  // Sizing constraints
  minWidth: number | null;
  maxWidth: number | null;
  minHeight: number | null;
  maxHeight: number | null;

  // Vector & Geometry
  vectorNetwork: VectorNetwork | null;
  /**
   * @runtimeCache — rasterized fill path commands.
   * Recomputable from `vectorNetwork` / node shape; never persisted
   * (serializer comments this explicitly — contains non-JSON Uint8Array
   * `commandsBlob`). Figma-inherited optimization. Moves to
   * `graph.runtimeCache.fillGeometry` in the eventual extraction.
   */
  fillGeometry: GeometryPath[];
  /** @runtimeCache — stroke path commands, same rationale as `fillGeometry`. */
  strokeGeometry: GeometryPath[];
  arcData: ArcData | null;

  // Mask
  isMask: boolean;
  maskType: MaskType;

  // Special
  pointCount: number;
  starInnerRadius: number;
  /**
   * @editorState — **LAYERS panel expand/collapse state**, NOT design data.
   * Whether a node's children are visible in the left-rail tree has zero
   * bearing on the rendered scene. Target for extraction into
   * `WorkspaceState.expandedIds`. Serializer/exporters drop it.
   */
  expanded: boolean;
  /**
   * @editorState — **editor rename-on-type heuristic**, NOT design data.
   * "Should the editor auto-regenerate this node's name when its type
   * changes?" — pure UX toggle. Drop from persistence + export.
   */
  autoRename: boolean;

  // Semantic
  semanticRole: SemanticRole | null;
  slot: string | null;                            // content slot name
  /** URL or slug for link-like nodes (semantic HTML export). */
  href: string | null;
  contentSlots: ContentSlot[];                    // what slots this node exposes

  // Behavior
  states: Partial<Record<InteractionState, StateOverride>>;
  responsive: ResponsiveRule[];

  // Components & Variables
  componentId: string | null;
  overrides: Record<string, Record<string, unknown>>;  // path → { prop: value }
  variantProperties: Record<string, string>;            // e.g. { size: 'lg', state: 'hover' }
  componentPropertyDefinitions: ComponentPropertyDefinition[] | null;
  isDefaultVariant: boolean;
  /**
   * Figma-compatible **variable bindings** — field path → variable id.
   *
   * Keys: full field paths like `'fills[0].color'`, `'cornerRadius'`.
   * Values: ids into `graph.variables` (arbitrary user-defined vars).
   *
   * **Different concept from `meta.tokenBindings`**, which holds DS-role
   * bindings (`fill`/`stroke`/`fontSize`) → role name like `'primary'`.
   * The two coexist because they solve different indirections:
   *  - `boundVariables` — "this field = this Figma Variable I created"
   *  - `meta.tokenBindings` — "this field = the current brand's <role>"
   *
   * Exporters read BOTH and emit CSS custom properties. If a field has
   * bindings in both maps, the `meta.tokenBindings` wins (exporter order
   * — DS-role binding is usually the stronger designer intent, applied
   * by auto-bind/rebrand ops, whereas `boundVariables` is a static
   * per-variable reference). See `exporters/html.ts` collection passes.
   */
  boundVariables: Record<string, string>;
  /**
   * @editorState — **"hide from publish" flag**, NOT design data.
   * Component-system bookkeeping: node is internal to a master and should
   * not surface to instances. Editor/compiler concern. Target for move
   * into component-master metadata, not per-node.
   */
  internalOnly: boolean;

  // Source provenance — tracks where this node came from (HTML tag, class, etc.)
  // Populated by importers so agents, audits, exporters can reason about original intent.
  meta: NodeMeta;
}

/**
 * Source provenance for a SceneNode. Empty object `{}` when the node has no origin metadata.
 * Populated by importers (HTML, SVG, Figma) to preserve the author's original intent
 * through the compile → edit → export pipeline.
 */
export interface NodeMeta {
  /** Original source tag — e.g. 'button', 'section', 'h1'. Set by HTML importer. */
  sourceTag?: string;
  /** Space-separated class attribute from source. */
  sourceClass?: string;
  /** id attribute from source. */
  sourceId?: string;
  /** The stable DOM path used to derive a deterministic node id, e.g. 'body/div[0]/section[2]/h1[0]'. */
  sourcePath?: string;
  /** Arbitrary data-* attributes preserved verbatim. Excludes internal reframe bookkeeping attrs. */
  sourceData?: Record<string, string>;
  /** Semantic variant hint (e.g. 'primary', 'outline') — from class name or data-reframe-variant. */
  variant?: string;
  /** True when this node was created synthetically by the importer (e.g. promoted wrapper frame). */
  synthetic?: boolean;
  /**
   * Design token bindings discovered by autoBindTokens. Keys are SceneNode
   * properties (fill, stroke, fontSize, fontFamily, cornerRadius), values are
   * DesignSystem token paths ("primary", "heading", "accent"). When present,
   * exporters can emit `var(--color-primary)` instead of the hardcoded hex —
   * changing a single DESIGN.md token then re-skins the entire project.
   */
  tokenBindings?: TokenBindings;

  // ── Mouse-reactive interactive (T2 #27) ───────────────────
  /**
   * Per-element interactive runtime behavior — mouse-tilt / mouse-glow /
   * combined. Stored under `meta` (not as a top-level SceneNode field)
   * because:
   *   (a) the existing meta serializer round-trips arbitrary keys via
   *       JSON.parse(JSON.stringify(meta)) — zero plumbing
   *   (b) interactive is "source-attached behavior", same shape as
   *       `sourceData` / `sourceTag` / `tokenBindings` already living
   *       here
   *   (c) keeps SceneNode.* focused on layout + visual data; runtime
   *       behavior aggregates under one roof
   *
   * Importer populates from `data-reframe-interactive` attribute (with
   * companion `data-reframe-{tilt,glow}-*` config attrs). Exporter
   * round-trips back to data-* attrs and emits the runtime IIFE once
   * per scene.
   */
  interactive?: INodeInteractive;

  // ── Text entrance animation (T2 #32) ──────────────────────
  /**
   * Per-text-node entrance animation triggered when the element scrolls
   * into viewport (IntersectionObserver). Same metadata-on-meta pattern
   * as `interactive` — auto round-trips via the existing meta serializer.
   *
   * Four types cover the canonical text-entrance vocabulary:
   *   streaming    — characters fade in sequentially (default 15ms stagger)
   *   typing       — characters reveal char-by-char with steps(1) easing
   *                  + blinking caret pseudo-element (50ms stagger)
   *   word-reveal  — words fade-translate up sequentially (80ms stagger)
   *   fade-up      — whole text fades + translates up as one block
   *
   * Splitting (per-char / per-word) happens at runtime mount, not at
   * import — keeps source HTML clean + designer-editable without
   * pre-split spans bloating the markup.
   */
  entrance?: INodeEntrance;

  // ── Narrative loop (T3 #30) ───────────────────────────────
  /**
   * Element-level looping sprite-sheet animation. Designer attaches
   * `data-reframe-narrative="sprite"` plus companion sprite-url / frame
   * data attrs; importer populates this typed structure; exporter emits
   * scoped CSS keyframes (background-position with `steps()` timing) +
   * a single runtime IIFE that wires viewport / mount / hover triggers.
   *
   * Same metadata-on-meta pattern as `interactive` / `entrance` / `hero`
   * — auto round-trips via the shared meta serializer.
   *
   * Phase 0 ships single-row sprite sheets (frames laid out left-to-right
   * in one row). Multi-row grid support is reserved as future signal —
   * tall sprite sheets are uncommon in real designs and the column
   * stride math complicates the keyframe emitter without obvious payoff.
   */
  narrative?: INodeNarrative;

  // ── Hero mode (T3 #23) ────────────────────────────────────
  /**
   * Section-level full-bleed escape (T3 #23). When set, the exporter
   * emits a CSS class that breaks the section out of its container to
   * the viewport edges, paints the brand primary color, and centers
   * inner content with a max-width.
   *
   * Phase 0 ships single mode 'full-bleed-brand'. Mode is an extensible
   * enum so future variants (centered / split / asymmetric) add values
   * without touching the field shape. Designer authors via
   * `data-reframe-hero="full-bleed-brand"` on a section/container.
   *
   * Same metadata-on-meta pattern as interactive / entrance — auto-
   * round-trips via the existing meta serializer.
   */
  hero?: HeroSpec;

  // ── Project-as-INode metadata ──────────────────────────────
  // Used when the project manifest itself is stored as a SceneGraph.
  // Scene-ref nodes in the project graph carry these fields.

  /** Scene slug (filesystem-safe persistent key). */
  slug?: string;
  /** Monotonic revision counter. */
  revision?: number;
  /** Source HTML path relative to .reframe/ (e.g. "src/home.html"). */
  source?: string;
  /** Brand slug this scene was compiled against. */
  brand?: string;
  /** DESIGN.md content hash at last compile. */
  brandHash?: string;
  /** Organizational group (e.g. "site", "app", "email"). */
  group?: string;
  /** Arbitrary tags for filtering. */
  tags?: string[];
  /** Node count in the referenced scene. */
  nodeCount?: number;
  /** When set, this is a responsive variant of another scene. */
  variantOf?: string;
  /** Brand registry label. */
  brandLabel?: string;
  /** ISO date for registry entries. */
  registeredAt?: string;
  /**
   * Raw SVG markup preserved from the HTML importer. Set on VECTOR nodes
   * imported from `<svg>` elements so HTML/React exporters can emit the
   * real icon instead of a fallback rect. Rasterizers that don't know
   * how to render full SVG (CanvasKit only understands path `d` strings)
   * still fall back to the bbox.
   */
  svgMarkup?: string;
}

/**
 * Hero section presentation mode (T3 #23).
 *
 * Phase 0 ships a single value, `'full-bleed-brand'` — section extends
 * to viewport edges via `width:100vw` + `margin-left: calc(50% - 50vw)`,
 * paints brand primary color (CSS var with hardcoded fallback), inner
 * content centered with max-width 1024px.
 *
 * ─── Known edge cases (Phase 0) ─────────────────────────────
 *
 * The 100vw + margin escape pattern has two well-known limitations
 * the exporter does NOT auto-fix:
 *
 *   1. **Parent with `overflow: hidden`** — escape clipped at parent
 *      bounds; section appears container-bound rather than full-bleed.
 *      Recommend hero on root level (not nested under overflow:hidden
 *      ancestors).
 *   2. **Windows scrollbar accounted for in 100vw** — produces a small
 *      horizontal scroll on systems where vertical scrollbar takes
 *      visible width. Not flagged in real-world usage where designs are
 *      typically reviewed in scrollbar-overlay modes (macOS, Chrome with
 *      "Always show scrollbars" off).
 *
 * Real-fix variants — CSS `@scope`, container queries, or `100svw`
 * (small-viewport-width unit) — are reserved as future signal when
 * designer flows surface them as friction.
 */
export type HeroMode = 'full-bleed-brand';

export interface HeroSpec {
  mode: HeroMode;
}

/**
 * Mouse-reactive interactive behavior (T2 #27).
 *
 * Designer authors via HTML data-* attrs:
 *   <div data-reframe-interactive="mouse-tilt-glow"
 *        data-reframe-tilt-strength="12"
 *        data-reframe-glow-color="rgba(99,91,255,0.15)">...</div>
 *
 * Importer parses → INodeInteractive. Exporter emits attrs back +
 * inline runtime IIFE (once per scene if any interactive nodes exist).
 *
 * Three behavior types cover the canonical Linear-style effects.
 * Adding a new type = extend union, add runtime branch in
 * MOUSE_REACTIVE_RUNTIME_SOURCE, document config shape here.
 */
export type InteractiveType = 'mouse-tilt' | 'mouse-glow' | 'mouse-tilt-glow';

export interface INodeInteractive {
  type: InteractiveType;
  config: InteractiveConfig;
}

/**
 * Text entrance animation (T2 #32) — declarative metadata, runtime
 * splits + animates on viewport entry.
 *
 * Caps (enforced by runtime, not validate): per-char types fall back
 * to fade-up when text exceeds 200 chars; word-reveal falls back at
 * >50 words. Cap exists to protect frame budget — N spans × M frames
 * each starts to thrash compositing past those thresholds.
 *
 * Unicode notes (Phase 0):
 *   - splitting uses Array.from(text) so surrogate-pair codepoints
 *     (most emoji, CJK extension blocks) iterate as one unit instead
 *     of fragmenting into 2 chars
 *   - combining marks (e.g. Devanagari conjuncts, accented chars in
 *     decomposed normalization) still split at codepoint boundaries —
 *     not grapheme cluster boundaries. Visible misalignment can occur
 *     for those scripts. Future: Intl.Segmenter when its Safari
 *     support stabilizes.
 *   - RTL text: spans render LTR; explicit `dir="rtl"` on the parent
 *     element doesn't reverse splitting order. Future signal.
 */
export type EntranceType = 'streaming' | 'typing' | 'word-reveal' | 'fade-up';

export interface INodeEntrance {
  type: EntranceType;
  config: EntranceConfig;
}

export interface EntranceConfig {
  /** Total animation duration ms (whole element). Default per-type. */
  duration?: number;
  /** Pre-trigger delay ms (added on top of viewport entry). Default 0. */
  delay?: number;
  /** Per-char or per-word stagger ms. Default per-type. Ignored for fade-up. */
  stagger?: number;
  /** CSS easing string. Default 'ease-out'. */
  easing?: string;
  /** Animate once and disconnect observer (default true) vs replay on each viewport re-entry. */
  once?: boolean;
}

/**
 * Narrative loop sprite animation (T3 #30).
 *
 * Looping element animation driven by a sprite sheet. Exporter emits
 * `@keyframes` with `steps(N)` timing function so frame transitions are
 * sharp (no smooth interpolation between adjacent frames). Runtime IIFE
 * handles trigger logic (viewport / mount / hover) — animation itself
 * is pure CSS, GPU-accelerated.
 *
 * Phase 0 ships single-row sprite sheets. Multi-row grids are a future
 * signal once tall sheets show up in real designer flows.
 *
 * Sprite URL flows through the existing #3 bundle inliner — exported
 * bundles inline the sprite as a data: URI alongside other images. No
 * narrative-specific bundle code.
 */
export type NarrativeKind = 'sprite';

export type NarrativeLoopMode = 'forward' | 'reverse' | 'pingpong' | 'once';

export type NarrativeTrigger = 'viewport' | 'mount' | 'hover';

export interface INodeNarrative {
  kind: NarrativeKind;
  spriteUrl: string;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  /**
   * Optional override for grid columns. Phase 0 only honors `frameCount`
   * (single-row layout). Reserved for future multi-row support — held in
   * the type so existing consumers don't break when the runtime grows.
   */
  columns?: number;
  /** Frames per second. Default 12. */
  frameRate?: number;
  /** Default 'forward'. */
  loopMode?: NarrativeLoopMode;
  /** Default 'viewport'. */
  trigger?: NarrativeTrigger;
}

export interface InteractiveConfig {
  /** Max tilt degrees on each axis. Default 8. Read by mouse-tilt + mouse-tilt-glow. */
  tiltStrength?: number;
  /**
   * RAF interpolation factor (0..1) — fraction of remaining distance to
   * close per frame. Higher = snappier follow, lower = lazier follow.
   * Default 0.15 (smooth, ~10-frame settle). Read by mouse-tilt +
   * mouse-tilt-glow.
   */
  tiltDamping?: number;
  /**
   * CSS perspective px applied to the parent — controls how dramatic the
   * 3D effect reads. Default 800. Lower = more pronounced; higher =
   * subtler. Read by mouse-tilt + mouse-tilt-glow.
   */
  perspective?: number;
  /**
   * Glow CSS color (hex / rgba / named). Default 'rgba(255,255,255,0.1)'.
   * Read by mouse-glow + mouse-tilt-glow. Drawn via CSS pseudo-element
   * radial-gradient anchored at cursor position.
   */
  glowColor?: string;
  /** Glow radius px. Default 200. Read by mouse-glow + mouse-tilt-glow. */
  glowRadius?: number;
}

export interface TokenBindings {
  /** Solid fill → color role ("primary", "background", "cta", ...). */
  fill?: string;
  /** Stroke → color role. */
  stroke?: string;
  /** Text fontSize → typography hierarchy role ("hero", "title", "body", ...). */
  fontSize?: string;
  /** Text fontFamily → "primary" | "secondary". */
  fontFamily?: string;
  /** cornerRadius → index in designSystem.layout.borderRadiusScale (stringified). */
  cornerRadius?: string;
}

// ─── Semantic Layer ────────────────────────────────────────────

export type SemanticRole =
  | 'button' | 'link' | 'input' | 'checkbox' | 'radio' | 'select'  // interactive
  | 'heading' | 'paragraph' | 'label' | 'caption'          // text
  | 'card' | 'badge' | 'tag' | 'avatar' | 'divider'        // components
  | 'nav' | 'header' | 'footer' | 'sidebar' | 'main'       // structure
  | 'hero' | 'section' | 'list' | 'listItem'               // layout
  | 'image' | 'icon' | 'logo'                               // media
  | 'cta' | 'toast' | 'modal' | 'tooltip' | 'dropdown';    // patterns

export interface ContentSlot {
  /** Slot name (e.g. 'title', 'description', 'cta-label') */
  name: string;
  /** Expected content type */
  type: 'text' | 'image' | 'node';
  /** Is this slot required? */
  required?: boolean;
  /** Default content */
  defaultValue?: string;
}

// ─── Behavior Layer ───────────────────────────────────────────

export type InteractionState = 'hover' | 'active' | 'focus' | 'disabled' | 'selected' | 'loading';

/** Partial property overrides for a state. Only visual+text props, not structural. */
export interface StateOverride {
  fills?: Fill[];
  strokes?: Stroke[];
  effects?: Effect[];
  opacity?: number;
  cornerRadius?: number;
  fontSize?: number;
  fontWeight?: number;
  letterSpacing?: number;
  /** CSS transition duration in ms (default 150) */
  transition?: number;
}

export interface ResponsiveRule {
  /** Max width breakpoint in px */
  maxWidth: number;
  /** Property overrides at this breakpoint */
  props: Partial<Pick<SceneNode,
    | 'width' | 'height' | 'x' | 'y'
    | 'layoutMode' | 'primaryAxisAlign' | 'counterAxisAlign'
    | 'itemSpacing' | 'paddingTop' | 'paddingRight' | 'paddingBottom' | 'paddingLeft'
    | 'fontSize' | 'fontWeight' | 'lineHeight' | 'letterSpacing'
    | 'visible' | 'opacity'
  >>;
}

// ─── Component System ──────────────────────────────────────────

export interface ComponentPropertyDefinition {
  name: string;
  type: 'VARIANT' | 'BOOLEAN' | 'TEXT' | 'INSTANCE_SWAP';
  defaultValue: string | boolean;
  variantOptions?: string[];
}

export interface ComponentInfo {
  id: string;
  name: string;
  type: 'COMPONENT' | 'COMPONENT_SET';
  variantCount: number;
  instanceCount: number;
  propertyDefinitions: ComponentPropertyDefinition[];
}

export interface ResolvedInstance {
  instanceId: string;
  componentId: string;
  variantKey: string;
  overriddenPaths: string[];
  childCount: number;
}

// ─── Scene Graph Events ─────────────────────────────────────────

export interface SceneGraphEvents {
  [key: string]: (...args: any[]) => void;
  'node:created': (node: SceneNode) => void;
  'node:updated': (id: string, changes: Partial<SceneNode>) => void;
  'node:deleted': (id: string) => void;
  'node:reparented': (nodeId: string, oldParentId: string | null, newParentId: string) => void;
  'node:reordered': (nodeId: string, parentId: string, index: number) => void;
}

// ─── Variable System ────────────────────────────────────────────

export type VariableType = 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
export type VariableValue = Color | number | string | boolean | { aliasId: string };

export interface Variable {
  id: string;
  name: string;
  type: VariableType;
  collectionId: string;
  valuesByMode: Record<string, VariableValue>;
  description: string;
  hiddenFromPublishing: boolean;
}

export interface VariableMode {
  modeId: string;
  name: string;
}

export interface VariableCollection {
  id: string;
  name: string;
  modes: VariableMode[];
  defaultModeId: string;
  variableIds: string[];
}

