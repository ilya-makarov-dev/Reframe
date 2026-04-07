/**
 * Reframe Engine — Host Abstraction Layer
 *
 * All dependencies on the specific host (Figma, Canvas, Sketch, Headless...)
 * are reduced to these interfaces. The engine works ONLY through INode / IHost.
 */

// ─── Node Type Enum ──────────────────────────────────────────────

export enum NodeType {
  Frame       = 'FRAME',
  Group       = 'GROUP',
  Text        = 'TEXT',
  Rectangle   = 'RECTANGLE',
  Ellipse     = 'ELLIPSE',
  Star        = 'STAR',
  Polygon     = 'POLYGON',
  Vector      = 'VECTOR',
  Instance    = 'INSTANCE',
  Component   = 'COMPONENT',
  BooleanOp   = 'BOOLEAN_OPERATION',
  Line        = 'LINE',
  Slice       = 'SLICE',
  /** Catch-all for host-specific types the engine doesn't need to know about. */
  Other       = '__OTHER__',
}

// ─── Paint / Effect / Font ───────────────────────────────────────

export interface ISolidPaint {
  type: 'SOLID';
  color: { r: number; g: number; b: number };
  opacity?: number;
  visible?: boolean;
}

export interface IGradientPaint {
  type: 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'GRADIENT_DIAMOND';
  opacity?: number;
  visible?: boolean;
  gradientStops?: { color: { r: number; g: number; b: number; a: number }; position: number }[];
  gradientTransform?: { m00: number; m01: number; m02: number; m10: number; m11: number; m12: number };
}

export interface IImagePaint {
  type: 'IMAGE';
  scaleMode?: string;
  imageHash?: string | null;
  opacity?: number;
  visible?: boolean;
}

export type IPaint = ISolidPaint | IGradientPaint | IImagePaint | { type: string; [k: string]: unknown };

export interface IEffect {
  type: string;
  visible?: boolean;
  radius?: number;
  [k: string]: unknown;
}

export interface IFontName {
  family: string;
  style: string;
}

export interface IExportSettings {
  format: string;
  suffix?: string;
  constraint?: { type: string; value: number };
  [k: string]: unknown;
}

// ─── MIXED sentinel ──────────────────────────────────────────────

/**
 * Replaces `figma.mixed`. Host adapter must map its sentinel to this symbol.
 * Check: `if (node.fontSize === MIXED) { ... }`
 */
export const MIXED: unique symbol = Symbol.for('reframe.mixed');
export type Mixed = typeof MIXED;

// ─── Core Node Interface ─────────────────────────────────────────

/**
 * Unified scene node interface.
 *
 * Instead of separate FrameNode / TextNode / GroupNode, a single shape is used
 * with discriminant `type: NodeType`. Optional fields are present only
 * for relevant types (text fields — only on Text, children — on containers, etc.).
 *
 * The host adapter wraps the native node in this interface.
 */
export interface INode {
  // ── Identity ─────────────────────────────────
  readonly id: string;
  name: string;
  readonly type: NodeType;
  readonly removed: boolean;

  // ── Tree ─────────────────────────────────────
  readonly parent: INode | null;
  /** undefined for leaf nodes (TEXT, VECTOR, RECTANGLE, ELLIPSE, etc.) */
  readonly children?: readonly INode[];
  appendChild?(child: INode): void;
  insertChild?(index: number, child: INode): void;
  clone?(): INode;
  remove?(): void;
  findAll?(predicate: (node: INode) => boolean): INode[];
  findOne?(predicate: (node: INode) => boolean): INode | null;

  // ── Geometry ─────────────────────────────────
  x: number;
  y: number;
  readonly width: number;
  readonly height: number;
  resize(w: number, h: number): void;
  /** Proportional scale (like Figma's rescale). May not exist on all node types. */
  rescale?(scale: number): void;

  // ── Absolute transform (read-only) ──────────
  /** 2×3 affine matrix [[a,b,tx],[c,d,ty]]. Engine uses only tx/ty (translation). */
  readonly absoluteTransform?: [[number, number, number], [number, number, number]];
  readonly absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null;

  // ── Layout ───────────────────────────────────
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  layoutPositioning?: 'ABSOLUTE' | 'AUTO';
  constraints?: { horizontal: string; vertical: string };
  clipsContent?: boolean;
  /** Flex/auto-layout: primary axis alignment. */
  primaryAxisAlign?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  /** Flex/auto-layout: counter axis alignment. */
  counterAxisAlign?: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'BASELINE';
  /** Flex/auto-layout: gap between items along primary axis. */
  itemSpacing?: number;
  /** Flex/auto-layout: gap along counter axis (wrap mode). */
  counterAxisSpacing?: number;
  /** Flex/auto-layout: wrap mode. */
  layoutWrap?: 'NO_WRAP' | 'WRAP';
  /** Flex/auto-layout: child grow factor. */
  layoutGrow?: number;
  /** Flex/auto-layout: child align-self override. */
  layoutAlignSelf?: 'AUTO' | 'MIN' | 'CENTER' | 'MAX' | 'STRETCH';
  /** Padding — per-side. */
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;

  // ── Visual ───────────────────────────────────
  fills?: IPaint[] | Mixed;
  strokes?: IPaint[];
  effects?: IEffect[];
  cornerRadius?: number | Mixed;
  /** Per-corner radii (when corners differ). */
  topLeftRadius?: number;
  topRightRadius?: number;
  bottomLeftRadius?: number;
  bottomRightRadius?: number;
  strokeWeight?: number | Mixed;
  /** Per-side stroke weights (when sides differ). */
  independentStrokeWeights?: boolean;
  borderTopWeight?: number;
  borderRightWeight?: number;
  borderBottomWeight?: number;
  borderLeftWeight?: number;
  opacity?: number;
  visible?: boolean;
  rotation?: number;
  blendMode?: string;

  // ── Text-specific ────────────────────────────
  fontSize?: number | Mixed;
  fontName?: IFontName | Mixed;
  /** Direct font weight (numeric: 100-900). Avoids fontName.style parsing. */
  fontWeight?: number;
  /** Direct font family name. Avoids fontName.family access. */
  fontFamily?: string;
  readonly characters?: string;
  lineHeight?: number | { value: number; unit: string } | Mixed;
  letterSpacing?: number | { value: number; unit: string } | Mixed;
  textAutoResize?: 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE';
  textAlignHorizontal?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  textAlignVertical?: 'TOP' | 'CENTER' | 'BOTTOM';
  italic?: boolean;
  textCase?: 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE';
  textDecoration?: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';
  textTruncation?: 'DISABLED' | 'ENDING';
  maxLines?: number | null;
  getRangeFontSize?(start: number, end: number): number;
  setRangeFontSize?(start: number, end: number, size: number): void;
  getRangeFontName?(start: number, end: number): IFontName;
  setRangeFontName?(start: number, end: number, font: IFontName): void;
  getRangeAllFontNames?(start: number, end: number): IFontName[];

  // ── Semantic ─────────────────────────────────
  /** Semantic role (button, heading, card, nav, etc.) — enables semantic HTML export + a11y */
  semanticRole?: string;
  /** Content slot name — marks this node as a bindable content placeholder */
  slot?: string;

  /** Navigation target — URL or page slug (e.g. '#features', '/pricing', 'https://...') */
  href?: string;

  // ── Behavior ────────────────────────────────
  /** Interaction state overrides (hover, active, focus, disabled) */
  states?: Record<string, Record<string, unknown>>;
  /** Responsive breakpoint rules — property overrides at different widths */
  responsive?: Array<{ maxWidth: number; props: Record<string, unknown> }>;

  // ── Export ───────────────────────────────────
  exportSettings?: IExportSettings[];
}

// ─── Host Interface ──────────────────────────────────────────────

/**
 * Contract with the host (Figma / Canvas / Headless / ...).
 * The engine calls ONLY these methods — nothing else is needed from the host.
 */
export interface IHost {
  /** The MIXED sentinel of this host (adapter maps to our MIXED symbol). */
  readonly MIXED: Mixed;

  // ── Node access ──────────────────────────────
  getNodeById(id: string): INode | null;
  getNodeByIdAsync?(id: string): Promise<INode | null>;

  // ── Mutation helpers ─────────────────────────
  loadFont(font: IFontName): Promise<void>;
  /**
   * Group nodes under a parent. Returns the new group node.
   * `insertIndex` — position in parent's children (optional).
   */
  groupNodes(nodes: INode[], parent: INode, insertIndex?: number): INode;

  // ── UI / Notifications ──
  notify(message: string, options?: { error?: boolean; timeout?: number }): void;
  getSelection(): INode[];
  focusView?(nodes: INode[]): void;

  // ── Metadata (optional) ──────────────────────
  getEditorType?(): string;
  getFileKey?(): string;
}
