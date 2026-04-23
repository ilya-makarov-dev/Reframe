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

// ─── Agent-Operable Block A ─────────────────────────────────────
// Substrate extensions that let agents operate on INode the same way
// they operate on code: stable addressing, interaction primitives,
// intent annotations, mount slots. Same primitives that compose user
// designs also compose reframe's own UI surfaces — INode describes
// itself.

export interface NodeIntent {
  /** Canonical role string in namespace convention — e.g. 'brand-palette/swatch', 'panel/close', 'token-editor/hex-input'. Agents use this to reason about node purpose. */
  role: string;
  /** Human-readable why this node exists. Passed to agents as reasoning context. */
  purpose?: string;
  /** Who may mutate this node. 'locked' rejects all gesture + MCP edits; audit enforces. */
  editableBy: 'agent' | 'user' | 'both' | 'locked';
  /** Lifecycle state from the agent's perspective. Advisory — does not block edits. */
  agentState?: 'placeholder' | 'generating' | 'ready' | 'user-edited';
}

export interface AgentGesture {
  /** MCP tool name (e.g. 'reframe_edit', 'reframe_ui'). */
  tool: string;
  /**
   * Tool args template. String values may contain {placeholders}:
   *   {value} — current input value (onInput only)
   *   {path}  — this node's semanticPath
   *   {id}    — this node's id
   * Substitution happens at gesture dispatch time, not at render time.
   */
  args: Record<string, unknown>;
  /**
   * Latency hint. 'local-state' = apply to local store without roundtrip,
   * 'optimistic-ui' = patch DOM before roundtrip confirms, null = fully synchronous.
   * Exporters emit this as a data attribute for the runtime dispatcher.
   */
  fastPath?: 'local-state' | 'optimistic-ui' | null;
}

export interface DragHandleSpec {
  /** Which bounding box the drag moves. */
  scope: 'self' | 'parent' | 'scene';
  /** Constrained axis; both when omitted. */
  axis?: 'x' | 'y' | 'both';
}

export interface KeybindingSpec {
  /** Human-readable combo: 'cmd+z', 'shift+/', 'escape'. Modifier order flexible, case-insensitive. */
  combo: string;
  /** MCP tool name fired on combo match. */
  tool: string;
  args: Record<string, unknown>;
  /** When true, bound globally regardless of focus. Default = bound only while this node or descendant is focused. */
  global?: boolean;
}

export interface MountSlotSpec {
  /** Slot name unique within a scene — e.g. 'right-panel', 'inspector', 'toolbar'. */
  name: string;
  /** Panel kinds this slot accepts; empty = any. Used by agent to filter valid mount targets. */
  accepts: string[];
}

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
  slot: string | null;                            // content slot name (component instances)
  /** URL or slug for link-like nodes (semantic HTML export). */
  href: string | null;
  contentSlots: ContentSlot[];                    // what slots this node exposes

  // Agent-Operable (Block A)
  /**
   * Stable dot-separated path from scene root, computed on compile from
   * nodeName (with sibling index when names collide under same parent:
   * `home/features/card:2`). Survives id regeneration across recompiles
   * — agents reference by path in gesture bindings and patch ops so their
   * instructions stay valid through the edit cycle. null on the root node
   * and transiently during graph mutation (recomputed by
   * `computeSemanticPaths(graph)` after every structural change).
   */
  semanticPath: string | null;
  /** Intent metadata: role, purpose, editableBy, agentState. See NodeIntent. */
  intent: NodeIntent | null;
  /** Click gesture — exporter emits data-gesture-click; delegator routes to MCP tool. */
  onClick: AgentGesture | null;
  /** Input-value gesture for text/number/slider inputs — fires on change with {value} substitution. */
  onInput: AgentGesture | null;
  /** Keyboard-focusable marker. Maps to HTML tabindex="0". */
  focusable: boolean;
  /** Drag handle descriptor — canvas drag system handles without agent roundtrip. */
  dragHandle: DragHandleSpec | null;
  /** Keybinding — global or scoped to this node's focus subtree. */
  keybinding: KeybindingSpec | null;
  /**
   * App-shell mount slot — this node is a named drop zone for
   * agent-rendered panel manifests. Distinct from `slot` which is
   * component-content slot; this one is for whole-panel mounting via
   * reframe_ui action=mount.
   */
  mountSlot: MountSlotSpec | null;

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

