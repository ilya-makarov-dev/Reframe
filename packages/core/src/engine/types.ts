/**
 * Reframe Standalone Engine — Core Types
 *
 * Core type definitions for SceneNode and related types.
 * Based on OpenPencil, adapted for the reframe architecture.
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
export type LayoutAlign = 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
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
  gridColumnGap: number;
  gridRowGap: number;
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
  fillGeometry: GeometryPath[];
  strokeGeometry: GeometryPath[];
  arcData: ArcData | null;

  // Mask
  isMask: boolean;
  maskType: MaskType;

  // Special
  pointCount: number;
  starInnerRadius: number;
  expanded: boolean;
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
  boundVariables: Record<string, string>;
  internalOnly: boolean;
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
