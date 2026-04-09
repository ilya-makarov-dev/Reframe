/**
 * INode Serialization — INode ↔ portable JSON
 *
 * Foundation for diff, versioning, storage.
 * Converts INode trees to clean JSON and back.
 *
 * Two levels of serialization:
 *   - serializeNode / deserializeNode — INode (host abstraction), basic properties
 *   - serializeGraph / deserializeToGraph — SceneGraph (full fidelity), all SceneNode fields
 *   - serializeGraph + deserializeScene — full SceneJSON envelope (root, images, timeline)
 *
 * For disk/MCP/HTTP round-trips with rasters and animation metadata, use **deserializeScene** on
 * the envelope; deserializeToGraph alone only rebuilds the node tree (normalizes fills/strokes/effects/styleRuns via applyImportedNodeLayoutProps).
 */

import { type INode, type IFontName, type IPaint, type IEffect, type IExportSettings, NodeType, MIXED } from './host';
import { SceneGraph } from './engine/scene-graph.js';
import { StandaloneNode } from './adapters/standalone/node.js';
import { StandaloneHost } from './adapters/standalone/adapter.js';
import { setHost } from './host/context.js';
import type {
  SceneNode,
  StyleRun,
  ComponentPropertyDefinition,
  VectorNetwork,
  ArcData,
  GridTrack,
  GridPosition,
  Fill,
  Color,
  Stroke,
  StrokeAlign,
  Effect,
  EffectType,
  Vector,
  CharacterStyleOverride,
} from './engine/types.js';
import type { ITimeline, ITimelineJSON } from './animation/types.js';

// ─── Format Version ──────────────────────────────────────────

/** Current serialization format version */
export const SERIALIZE_VERSION = 2;

// ─── Types ────────────────────────────────────────────────────

const MIXED_SENTINEL = '__MIXED__';

/** JSON-safe representation of an INode tree. No symbols, no circular refs, no methods. */
export interface INodeJSON {
  /** Format version — absent in v1, 2 for current */
  version?: number;

  id: string;
  name: string;
  type: string;

  // Geometry
  x: number;
  y: number;
  width: number;
  height: number;

  // Tree
  children?: INodeJSON[];

  // Layout
  layoutMode?: string;
  layoutPositioning?: string;
  constraints?: { horizontal: string; vertical: string };
  clipsContent?: boolean;
  primaryAxisAlign?: string;
  counterAxisAlign?: string;
  itemSpacing?: number;
  counterAxisSpacing?: number;
  layoutWrap?: string;
  layoutGrow?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  layoutAlignSelf?: string;
  primaryAxisSizing?: string;
  counterAxisSizing?: string;

  // Grid
  gridTemplateColumns?: GridTrack[];
  gridTemplateRows?: GridTrack[];
  gridColumnGap?: number;
  gridRowGap?: number;
  gridPosition?: GridPosition | null;
  counterAxisAlignContent?: string;
  itemReverseZIndex?: boolean;
  strokesIncludedInLayout?: boolean;

  // Size constraints
  minWidth?: number | null;
  maxWidth?: number | null;
  minHeight?: number | null;
  maxHeight?: number | null;

  // Visual
  fills?: (IPaint | string)[];
  strokes?: IPaint[];
  effects?: IEffect[];
  cornerRadius?: number | string;
  topLeftRadius?: number;
  topRightRadius?: number;
  bottomLeftRadius?: number;
  bottomRightRadius?: number;
  independentCorners?: boolean;
  cornerSmoothing?: number;
  strokeWeight?: number | string;
  opacity?: number;
  visible?: boolean;
  rotation?: number;
  blendMode?: string;
  locked?: boolean;
  flipX?: boolean;
  flipY?: boolean;

  // Stroke details
  strokeCap?: string;
  strokeJoin?: string;
  dashPattern?: number[];
  independentStrokeWeights?: boolean;
  borderTopWeight?: number;
  borderRightWeight?: number;
  borderBottomWeight?: number;
  borderLeftWeight?: number;
  strokeMiterLimit?: number;

  // Text
  fontSize?: number | string;
  fontName?: IFontName | string;
  fontWeight?: number;
  fontFamily?: string;
  characters?: string;
  text?: string;
  lineHeight?: number | { value: number; unit: string } | string | null;
  letterSpacing?: number | { value: number; unit: string } | string;
  textAutoResize?: string;
  textAlignHorizontal?: string;
  textAlignVertical?: string;
  textCase?: string;
  textDecoration?: string;
  italic?: boolean;
  maxLines?: number | null;
  textTruncation?: string;
  styleRuns?: StyleRun[];

  // Vector & geometry
  vectorNetwork?: VectorNetwork | null;
  arcData?: ArcData | null;

  // Mask
  isMask?: boolean;
  maskType?: string;

  // Special
  pointCount?: number;
  starInnerRadius?: number;

  // Components & variables
  componentId?: string | null;
  overrides?: Record<string, Record<string, unknown>>;
  variantProperties?: Record<string, string>;
  componentPropertyDefinitions?: ComponentPropertyDefinition[] | null;
  isDefaultVariant?: boolean;
  boundVariables?: Record<string, string>;
  internalOnly?: boolean;

  // Semantic
  semanticRole?: string | null;
  slot?: string | null;
  href?: string | null;
  contentSlots?: any[];

  // Behavior
  states?: Record<string, any>;
  responsive?: any[];

  // Export
  exportSettings?: IExportSettings[];

  // Timeline (attached animation)
  timeline?: ITimelineJSON;
}

/**
 * Envelope for full scene serialization with metadata (session, HTTP, disk, Studio).
 * Canonical contract (семантика полей, PUT, Studio): {@link ./spec/scene-envelope.ts}.
 */
export interface SceneJSON {
  version: number;
  root: INodeJSON;
  /** Omitted or null = no timeline (PUT uses explicit null to clear session animation). */
  timeline?: ITimelineJSON | null;
  images?: Record<string, string>;  // hash → base64
}

export interface SerializeOptions {
  /** Skip default values for compactness (default: true) */
  compact?: boolean;
  /**
   * When true, envelope always includes `timeline` — serialized object or JSON `null` if none.
   * Use for Studio↔MCP PUT/GET so missing animation clears server session instead of preserving a stale timeline.
   */
  explicitTimelineKey?: boolean;
}

// ─── Serialize (INode path — backward compat) ────────────────

function serializeValue(val: unknown): unknown {
  if (val === MIXED) return MIXED_SENTINEL;
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'object' && val !== null) {
    if (Array.isArray(val)) return val.map(v => serializeValue(v));
    // Skip Uint8Array (binary data — not JSON-safe)
    if (val instanceof Uint8Array) return undefined;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) {
      const sv = serializeValue(v);
      if (sv !== undefined) out[k] = sv;
    }
    return out;
  }
  return val;
}

/** Serialize an INode tree to a portable JSON object. */
export function serializeNode(node: INode, options?: SerializeOptions): INodeJSON {
  const compact = options?.compact ?? true;

  const json: INodeJSON = {
    id: node.id,
    name: node.name,
    type: node.type,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  };

  // Layout
  if (!compact || (node.layoutMode && node.layoutMode !== 'NONE')) json.layoutMode = node.layoutMode;
  if (!compact || (node.layoutPositioning && node.layoutPositioning !== 'AUTO')) json.layoutPositioning = node.layoutPositioning;
  if (node.constraints) json.constraints = node.constraints;
  if (!compact || node.clipsContent) json.clipsContent = node.clipsContent;
  if (node.primaryAxisAlign && node.primaryAxisAlign !== 'MIN') json.primaryAxisAlign = node.primaryAxisAlign;
  if (node.counterAxisAlign && node.counterAxisAlign !== 'MIN') json.counterAxisAlign = node.counterAxisAlign;
  if (node.itemSpacing) json.itemSpacing = node.itemSpacing;
  if (node.counterAxisSpacing) json.counterAxisSpacing = node.counterAxisSpacing;
  if (node.layoutWrap && node.layoutWrap !== 'NO_WRAP') json.layoutWrap = node.layoutWrap;
  if (node.layoutGrow) json.layoutGrow = node.layoutGrow;
  if (node.paddingTop) json.paddingTop = node.paddingTop;
  if (node.paddingRight) json.paddingRight = node.paddingRight;
  if (node.paddingBottom) json.paddingBottom = node.paddingBottom;
  if (node.paddingLeft) json.paddingLeft = node.paddingLeft;

  // Visual
  if (node.fills !== undefined) json.fills = serializeValue(node.fills) as INodeJSON['fills'];
  if (node.strokes?.length) json.strokes = serializeValue(node.strokes) as IPaint[];
  if (node.effects?.length) json.effects = serializeValue(node.effects) as IEffect[];
  if (node.cornerRadius !== undefined) json.cornerRadius = node.cornerRadius === MIXED ? MIXED_SENTINEL : node.cornerRadius as number;
  if (node.topLeftRadius) json.topLeftRadius = node.topLeftRadius;
  if (node.topRightRadius) json.topRightRadius = node.topRightRadius;
  if (node.bottomLeftRadius) json.bottomLeftRadius = node.bottomLeftRadius;
  if (node.bottomRightRadius) json.bottomRightRadius = node.bottomRightRadius;
  if (node.strokeWeight !== undefined) json.strokeWeight = node.strokeWeight === MIXED ? MIXED_SENTINEL : node.strokeWeight as number;
  if (!compact || (node.opacity !== undefined && node.opacity !== 1)) json.opacity = node.opacity;
  if (!compact || (node.visible !== undefined && node.visible !== true)) json.visible = node.visible;
  if (!compact || (node.rotation !== undefined && node.rotation !== 0)) json.rotation = node.rotation;
  if (node.blendMode) json.blendMode = node.blendMode;

  // Text
  if (node.fontSize !== undefined) json.fontSize = node.fontSize === MIXED ? MIXED_SENTINEL : node.fontSize as number;
  if (node.fontName !== undefined) json.fontName = node.fontName === MIXED ? MIXED_SENTINEL : node.fontName as IFontName;
  if (node.fontWeight) json.fontWeight = node.fontWeight;
  if (node.fontFamily) json.fontFamily = node.fontFamily;
  if (node.characters !== undefined) json.characters = node.characters;
  if (node.lineHeight !== undefined) json.lineHeight = node.lineHeight === MIXED ? MIXED_SENTINEL : serializeValue(node.lineHeight) as INodeJSON['lineHeight'];
  if (node.letterSpacing !== undefined) json.letterSpacing = node.letterSpacing === MIXED ? MIXED_SENTINEL : serializeValue(node.letterSpacing) as INodeJSON['letterSpacing'];
  if (node.textAutoResize) json.textAutoResize = node.textAutoResize;
  if (node.textAlignHorizontal) json.textAlignHorizontal = node.textAlignHorizontal;
  if (node.textAlignVertical) json.textAlignVertical = node.textAlignVertical;
  if (node.textCase && node.textCase !== 'ORIGINAL') json.textCase = node.textCase;
  if (node.textDecoration && node.textDecoration !== 'NONE') json.textDecoration = node.textDecoration;

  // Export settings
  if (node.exportSettings?.length) json.exportSettings = node.exportSettings;

  // Children (recursive)
  if (node.children && node.children.length > 0) {
    json.children = node.children
      .filter(c => !c.removed)
      .map(c => serializeNode(c, options));
  }

  return json;
}

/** Serialize an INode tree to a JSON string. */
export function serializeToString(node: INode, options?: SerializeOptions & { indent?: number }): string {
  return JSON.stringify(serializeNode(node, options), null, options?.indent ?? 2);
}

// ─── Serialize (SceneGraph path — full fidelity) ─────────────

/** Default values from createDefaultNode — used to skip defaults in compact mode. */
const DEFAULTS: Partial<SceneNode> = {
  rotation: 0, flipX: false, flipY: false,
  opacity: 1, blendMode: 'PASS_THROUGH', visible: true, locked: false, clipsContent: false,
  cornerRadius: 0, topLeftRadius: 0, topRightRadius: 0, bottomRightRadius: 0, bottomLeftRadius: 0,
  independentCorners: false, cornerSmoothing: 0,
  strokeCap: 'NONE', strokeJoin: 'MITER', independentStrokeWeights: false, strokeMiterLimit: 4,
  borderTopWeight: 1, borderRightWeight: 1, borderBottomWeight: 1, borderLeftWeight: 1,
  italic: false, textAlignHorizontal: 'LEFT', textAlignVertical: 'TOP',
  textAutoResize: 'NONE', textCase: 'ORIGINAL', textDecoration: 'NONE',
  letterSpacing: 0, textTruncation: 'DISABLED',
  horizontalConstraint: 'MIN', verticalConstraint: 'MIN',
  layoutMode: 'NONE', layoutWrap: 'NO_WRAP', primaryAxisAlign: 'MIN', counterAxisAlign: 'MIN',
  primaryAxisSizing: 'FIXED', counterAxisSizing: 'FIXED',
  itemSpacing: 0, counterAxisSpacing: 0,
  paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
  layoutPositioning: 'AUTO', layoutGrow: 0, layoutAlignSelf: 'AUTO',
  gridColumnGap: 0, gridRowGap: 0, counterAxisAlignContent: 'AUTO',
  itemReverseZIndex: false, strokesIncludedInLayout: false,
  isMask: false, maskType: 'ALPHA', pointCount: 3, starInnerRadius: 0.5,
  expanded: false, autoRename: true, isDefaultVariant: false, internalOnly: false,
};

/** Check if a value equals its default (skip in compact mode). */
function isDefault(key: string, value: unknown): boolean {
  if (!(key in DEFAULTS)) return false;
  return value === (DEFAULTS as any)[key];
}

/** Check if an array-like value is empty. */
function isEmptyArray(val: unknown): boolean {
  return Array.isArray(val) && val.length === 0;
}

/** Check if an object is empty. */
function isEmptyObject(val: unknown): boolean {
  return val !== null && typeof val === 'object' && !Array.isArray(val) && Object.keys(val as object).length === 0;
}

/**
 * Serialize a SceneNode from a SceneGraph — full fidelity.
 * Captures ALL properties including components, vectors, style runs, masks.
 */
export function serializeSceneNode(
  graph: SceneGraph,
  nodeId: string,
  options?: SerializeOptions,
): INodeJSON {
  const node = graph.getNode(nodeId);
  if (!node) throw new Error(`Node "${nodeId}" not found`);

  const compact = options?.compact ?? true;
  const json: INodeJSON = {
    id: node.id,
    name: node.name,
    type: node.type,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  };

  // ── Layout ──────────────────────────────────────
  if (!compact || !isDefault('layoutMode', node.layoutMode)) json.layoutMode = node.layoutMode;
  if (!compact || !isDefault('layoutPositioning', node.layoutPositioning)) json.layoutPositioning = node.layoutPositioning;
  if (!compact || !isDefault('layoutGrow', node.layoutGrow)) json.layoutGrow = node.layoutGrow;
  if (!compact || !isDefault('layoutAlignSelf', node.layoutAlignSelf)) json.layoutAlignSelf = node.layoutAlignSelf;
  if (!compact || !isDefault('primaryAxisAlign', node.primaryAxisAlign)) json.primaryAxisAlign = node.primaryAxisAlign;
  if (!compact || !isDefault('counterAxisAlign', node.counterAxisAlign)) json.counterAxisAlign = node.counterAxisAlign;
  if (!compact || !isDefault('primaryAxisSizing', node.primaryAxisSizing)) json.primaryAxisSizing = node.primaryAxisSizing;
  if (!compact || !isDefault('counterAxisSizing', node.counterAxisSizing)) json.counterAxisSizing = node.counterAxisSizing;
  if (!compact || !isDefault('itemSpacing', node.itemSpacing)) json.itemSpacing = node.itemSpacing;
  if (!compact || !isDefault('counterAxisSpacing', node.counterAxisSpacing)) json.counterAxisSpacing = node.counterAxisSpacing;
  if (!compact || !isDefault('layoutWrap', node.layoutWrap)) json.layoutWrap = node.layoutWrap;
  if (!compact || !isDefault('clipsContent', node.clipsContent)) json.clipsContent = node.clipsContent;
  if (!compact || !isDefault('paddingTop', node.paddingTop)) json.paddingTop = node.paddingTop;
  if (!compact || !isDefault('paddingRight', node.paddingRight)) json.paddingRight = node.paddingRight;
  if (!compact || !isDefault('paddingBottom', node.paddingBottom)) json.paddingBottom = node.paddingBottom;
  if (!compact || !isDefault('paddingLeft', node.paddingLeft)) json.paddingLeft = node.paddingLeft;

  // Constraints
  json.constraints = { horizontal: node.horizontalConstraint, vertical: node.verticalConstraint };
  if (compact && json.constraints.horizontal === 'MIN' && json.constraints.vertical === 'MIN') {
    delete json.constraints;
  }

  // Grid
  if (!isEmptyArray(node.gridTemplateColumns)) json.gridTemplateColumns = node.gridTemplateColumns;
  if (!isEmptyArray(node.gridTemplateRows)) json.gridTemplateRows = node.gridTemplateRows;
  if (!compact || !isDefault('gridColumnGap', node.gridColumnGap)) json.gridColumnGap = node.gridColumnGap;
  if (!compact || !isDefault('gridRowGap', node.gridRowGap)) json.gridRowGap = node.gridRowGap;
  if (node.gridPosition !== null) json.gridPosition = node.gridPosition;
  if (!compact || !isDefault('counterAxisAlignContent', node.counterAxisAlignContent)) json.counterAxisAlignContent = node.counterAxisAlignContent;
  if (!compact || !isDefault('itemReverseZIndex', node.itemReverseZIndex)) json.itemReverseZIndex = node.itemReverseZIndex;
  if (!compact || !isDefault('strokesIncludedInLayout', node.strokesIncludedInLayout)) json.strokesIncludedInLayout = node.strokesIncludedInLayout;

  // Size constraints
  if (node.minWidth !== null) json.minWidth = node.minWidth;
  if (node.maxWidth !== null) json.maxWidth = node.maxWidth;
  if (node.minHeight !== null) json.minHeight = node.minHeight;
  if (node.maxHeight !== null) json.maxHeight = node.maxHeight;

  // ── Visual ──────────────────────────────────────
  if (node.fills.length > 0) json.fills = serializeValue(node.fills) as INodeJSON['fills'];
  if (node.strokes.length > 0) json.strokes = serializeValue(node.strokes) as IPaint[];
  if (node.effects.length > 0) json.effects = serializeValue(node.effects) as IEffect[];
  if (!compact || !isDefault('cornerRadius', node.cornerRadius)) json.cornerRadius = node.cornerRadius;
  if (!compact || !isDefault('topLeftRadius', node.topLeftRadius)) json.topLeftRadius = node.topLeftRadius;
  if (!compact || !isDefault('topRightRadius', node.topRightRadius)) json.topRightRadius = node.topRightRadius;
  if (!compact || !isDefault('bottomLeftRadius', node.bottomLeftRadius)) json.bottomLeftRadius = node.bottomLeftRadius;
  if (!compact || !isDefault('bottomRightRadius', node.bottomRightRadius)) json.bottomRightRadius = node.bottomRightRadius;
  if (!compact || !isDefault('independentCorners', node.independentCorners)) json.independentCorners = node.independentCorners;
  if (!compact || !isDefault('cornerSmoothing', node.cornerSmoothing)) json.cornerSmoothing = node.cornerSmoothing;
  if (node.strokes.length > 0) json.strokeWeight = node.strokes[0]?.weight ?? 0;
  if (!compact || !isDefault('opacity', node.opacity)) json.opacity = node.opacity;
  if (!compact || !isDefault('visible', node.visible)) json.visible = node.visible;
  if (!compact || !isDefault('rotation', node.rotation)) json.rotation = node.rotation;
  if (!compact || !isDefault('blendMode', node.blendMode)) json.blendMode = node.blendMode;
  if (!compact || !isDefault('locked', node.locked)) json.locked = node.locked;
  if (!compact || !isDefault('flipX', node.flipX)) json.flipX = node.flipX;
  if (!compact || !isDefault('flipY', node.flipY)) json.flipY = node.flipY;

  // Stroke details
  if (!compact || !isDefault('strokeCap', node.strokeCap)) json.strokeCap = node.strokeCap;
  if (!compact || !isDefault('strokeJoin', node.strokeJoin)) json.strokeJoin = node.strokeJoin;
  if (!isEmptyArray(node.dashPattern)) json.dashPattern = node.dashPattern;
  if (!compact || !isDefault('independentStrokeWeights', node.independentStrokeWeights)) json.independentStrokeWeights = node.independentStrokeWeights;
  if (node.independentStrokeWeights) {
    json.borderTopWeight = node.borderTopWeight;
    json.borderRightWeight = node.borderRightWeight;
    json.borderBottomWeight = node.borderBottomWeight;
    json.borderLeftWeight = node.borderLeftWeight;
  }
  if (!compact || !isDefault('strokeMiterLimit', node.strokeMiterLimit)) json.strokeMiterLimit = node.strokeMiterLimit;

  // ── Text ────────────────────────────────────────
  if (node.text) json.text = node.text;
  if (node.type === 'TEXT' || node.text) {
    json.fontSize = node.fontSize;
    json.fontFamily = node.fontFamily;
    if (!compact || !isDefault('fontWeight', node.fontWeight)) json.fontWeight = node.fontWeight;
    if (!compact || !isDefault('italic', node.italic)) json.italic = node.italic;
    if (!compact || !isDefault('textAlignHorizontal', node.textAlignHorizontal)) json.textAlignHorizontal = node.textAlignHorizontal;
    if (!compact || !isDefault('textAlignVertical', node.textAlignVertical)) json.textAlignVertical = node.textAlignVertical;
    if (!compact || !isDefault('textAutoResize', node.textAutoResize)) json.textAutoResize = node.textAutoResize;
    if (!compact || !isDefault('textCase', node.textCase)) json.textCase = node.textCase;
    if (!compact || !isDefault('textDecoration', node.textDecoration)) json.textDecoration = node.textDecoration;
    if (!compact || !isDefault('textTruncation', node.textTruncation)) json.textTruncation = node.textTruncation;
    if (node.lineHeight !== null) json.lineHeight = node.lineHeight;
    if (!compact || !isDefault('letterSpacing', node.letterSpacing)) json.letterSpacing = node.letterSpacing;
    if (node.maxLines !== null) json.maxLines = node.maxLines;
  }

  // Style runs (rich text)
  if (node.styleRuns.length > 0) {
    json.styleRuns = JSON.parse(JSON.stringify(node.styleRuns));
  }

  // ── Vector & geometry ───────────────────────────
  if (node.vectorNetwork !== null) json.vectorNetwork = JSON.parse(JSON.stringify(node.vectorNetwork));
  if (node.arcData !== null) json.arcData = JSON.parse(JSON.stringify(node.arcData));
  // Note: fillGeometry/strokeGeometry contain Uint8Array (commandsBlob) — not JSON-safe.
  // They are regenerated from vectorNetwork on import if needed.

  // ── Mask ────────────────────────────────────────
  if (!compact || !isDefault('isMask', node.isMask)) json.isMask = node.isMask;
  if (!compact || !isDefault('maskType', node.maskType)) json.maskType = node.maskType;

  // ── Special ─────────────────────────────────────
  if (!compact || !isDefault('pointCount', node.pointCount)) json.pointCount = node.pointCount;
  if (!compact || !isDefault('starInnerRadius', node.starInnerRadius)) json.starInnerRadius = node.starInnerRadius;

  // ── Components & variables ──────────────────────
  if (node.componentId !== null) json.componentId = node.componentId;
  if (!isEmptyObject(node.overrides)) json.overrides = JSON.parse(JSON.stringify(node.overrides));
  if (!isEmptyObject(node.variantProperties)) json.variantProperties = { ...node.variantProperties };
  if (node.componentPropertyDefinitions !== null) {
    json.componentPropertyDefinitions = JSON.parse(JSON.stringify(node.componentPropertyDefinitions));
  }
  if (!compact || !isDefault('isDefaultVariant', node.isDefaultVariant)) json.isDefaultVariant = node.isDefaultVariant;
  if (!isEmptyObject(node.boundVariables)) json.boundVariables = { ...node.boundVariables };
  if (!compact || !isDefault('internalOnly', node.internalOnly)) json.internalOnly = node.internalOnly;

  // ── Semantic ───────────────────────────────────
  if (node.semanticRole !== null) json.semanticRole = node.semanticRole;
  if (node.slot !== null) json.slot = node.slot;
  if (node.href) json.href = node.href;
  if (node.contentSlots.length > 0) json.contentSlots = JSON.parse(JSON.stringify(node.contentSlots));

  // ── Behavior ───────────────────────────────────
  if (!isEmptyObject(node.states)) json.states = JSON.parse(JSON.stringify(node.states));
  if (node.responsive.length > 0) json.responsive = JSON.parse(JSON.stringify(node.responsive));

  // Export settings — not on SceneNode (INode-only concept via StandaloneNode)

  // ── Children (recursive) ────────────────────────
  if (node.childIds.length > 0) {
    json.children = node.childIds
      .map(cid => serializeSceneNode(graph, cid, options));
  }

  return json;
}

/**
 * Serialize a full scene from a SceneGraph.
 * Returns a SceneJSON envelope with version, root tree, optional timeline, and images.
 */
export function serializeGraph(
  graph: SceneGraph,
  rootId: string,
  options?: SerializeOptions & { timeline?: ITimeline },
): SceneJSON {
  const root = serializeSceneNode(graph, rootId, options);
  root.version = SERIALIZE_VERSION;

  const result: SceneJSON = {
    version: SERIALIZE_VERSION,
    root,
  };

  // Timeline
  if (options?.explicitTimelineKey) {
    result.timeline = options.timeline != null ? serializeTimeline(options.timeline) : null;
  } else if (options?.timeline) {
    result.timeline = serializeTimeline(options.timeline);
  }

  // Images (base64-encode any stored image data)
  if (graph.images.size > 0) {
    result.images = {};
    for (const [hash, data] of graph.images) {
      result.images[hash] = bufferToBase64(data);
    }
  }

  return result;
}

/**
 * Serialize a SceneGraph to a JSON string (full fidelity).
 */
export function serializeGraphToString(
  graph: SceneGraph,
  rootId: string,
  options?: SerializeOptions & { indent?: number; timeline?: ITimeline },
): string {
  return JSON.stringify(serializeGraph(graph, rootId, options), null, options?.indent ?? 2);
}

// ─── Deserialize ──────────────────────────────────────────────

function deserializeValue(val: unknown): unknown {
  if (val === MIXED_SENTINEL) return MIXED;
  if (val === undefined || val === null) return val;
  if (typeof val === 'object' && val !== null) {
    if (Array.isArray(val)) return val.map(v => deserializeValue(v));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = deserializeValue(v);
    }
    return out;
  }
  return val;
}

function hexStringToColor(hex: string): { r: number; g: number; b: number; a: number } {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return {
    r: Number.isFinite(r) ? r : 0,
    g: Number.isFinite(g) ? g : 0,
    b: Number.isFinite(b) ? b : 0,
    a: Number.isFinite(a) ? a : 1,
  };
}

/**
 * Normalize JSON `fills` (e.g. `"#rrggbb"` shorthand or loose objects) to engine {@link Fill}[].
 * Used by SceneGraph import so HTTP PUT and disk JSON match Studio tolerance.
 */
export function normalizeImportFills(value: unknown): Fill[] {
  if (!Array.isArray(value)) return [];
  const out: Fill[] = [];
  for (const f of value) {
    if (!f) continue;
    if (typeof f === 'string' && f.startsWith('#')) {
      const c = hexStringToColor(f);
      out.push({
        type: 'SOLID',
        color: { r: c.r, g: c.g, b: c.b, a: 1 },
        opacity: c.a,
        visible: true,
      });
      continue;
    }
    if (typeof f === 'object' && !Array.isArray(f)) {
      const o = f as Record<string, unknown>;
      const type = (typeof o.type === 'string' ? o.type : 'SOLID') as Fill['type'];
      const col = o.color;
      const color: Color =
        col && typeof col === 'object' && col !== null && 'r' in col
          ? {
              r: Number((col as Color).r ?? 0),
              g: Number((col as Color).g ?? 0),
              b: Number((col as Color).b ?? 0),
              a: Number((col as Color).a ?? 1),
            }
          : { r: 0, g: 0, b: 0, a: 1 };
      out.push({
        ...o,
        type,
        color,
        opacity: typeof o.opacity === 'number' ? o.opacity : 1,
        visible: o.visible !== false,
      } as Fill);
    }
  }
  return out;
}

/**
 * Normalize JSON `strokes` (e.g. `"#rrggbb"` entries or hex {@link Color} strings) to engine {@link Stroke}[].
 */
export function normalizeImportStrokes(value: unknown): Stroke[] {
  if (!Array.isArray(value)) return [];
  const out: Stroke[] = [];
  for (const s of value) {
    if (!s) continue;
    if (typeof s === 'string' && s.startsWith('#')) {
      const c = hexStringToColor(s);
      out.push({
        color: { r: c.r, g: c.g, b: c.b, a: 1 },
        weight: 1,
        opacity: c.a,
        visible: true,
        align: 'INSIDE',
      });
      continue;
    }
    if (typeof s === 'object' && !Array.isArray(s)) {
      const o = s as Record<string, unknown>;
      const colRaw = o.color;
      let color: Color;
      let opacityDefault = 1;
      if (typeof colRaw === 'string' && colRaw.startsWith('#')) {
        const c = hexStringToColor(colRaw);
        color = { r: c.r, g: c.g, b: c.b, a: 1 };
        opacityDefault = c.a;
      } else if (colRaw && typeof colRaw === 'object' && colRaw !== null && 'r' in colRaw) {
        color = {
          r: Number((colRaw as Color).r ?? 0),
          g: Number((colRaw as Color).g ?? 0),
          b: Number((colRaw as Color).b ?? 0),
          a: Number((colRaw as Color).a ?? 1),
        };
      } else {
        color = { r: 0, g: 0, b: 0, a: 1 };
      }
      const align = (typeof o.align === 'string' ? o.align : 'INSIDE') as StrokeAlign;
      out.push({
        ...o,
        color,
        weight: typeof o.weight === 'number' ? o.weight : 1,
        opacity: typeof o.opacity === 'number' ? o.opacity : opacityDefault,
        visible: o.visible !== false,
        align,
      } as Stroke);
    }
  }
  return out;
}

/**
 * Normalize JSON `effects` (e.g. `color: "#404040"`) to engine {@link Effect}[].
 */
export function normalizeImportEffects(value: unknown): Effect[] {
  if (!Array.isArray(value)) return [];
  const out: Effect[] = [];
  for (const e of value) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    const o = e as Record<string, unknown>;
    const type = (typeof o.type === 'string' ? o.type : 'DROP_SHADOW') as EffectType;
    const colRaw = o.color;
    let color: Color;
    if (typeof colRaw === 'string' && colRaw.startsWith('#')) {
      const c = hexStringToColor(colRaw);
      color = { r: c.r, g: c.g, b: c.b, a: c.a };
    } else if (colRaw && typeof colRaw === 'object' && colRaw !== null && 'r' in colRaw) {
      color = {
        r: Number((colRaw as Color).r ?? 0),
        g: Number((colRaw as Color).g ?? 0),
        b: Number((colRaw as Color).b ?? 0),
        a: Number((colRaw as Color).a ?? 1),
      };
    } else {
      color = { r: 0, g: 0, b: 0, a: 1 };
    }
    const rawOff = o.offset;
    const offset: Vector =
      rawOff && typeof rawOff === 'object' && rawOff !== null && 'x' in rawOff
        ? {
            x: Number((rawOff as Vector).x ?? 0),
            y: Number((rawOff as Vector).y ?? 0),
          }
        : { x: 0, y: 0 };
    out.push({
      ...o,
      type,
      color,
      offset,
      radius: typeof o.radius === 'number' ? o.radius : 0,
      spread: typeof o.spread === 'number' ? o.spread : 0,
      visible: o.visible !== false,
      blendMode: typeof o.blendMode === 'string' ? o.blendMode : undefined,
    } as Effect);
  }
  return out;
}

/**
 * Normalize `styleRuns[].style.fillColor` hex strings to {@link Color} objects.
 */
export function normalizeImportStyleRuns(value: unknown): StyleRun[] {
  if (!Array.isArray(value)) return [];
  const out: StyleRun[] = [];
  for (const r of value) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const o = r as Record<string, unknown>;
    const start = typeof o.start === 'number' ? o.start : 0;
    const length = typeof o.length === 'number' ? o.length : 0;
    const styleRaw = o.style;
    if (!styleRaw || typeof styleRaw !== 'object' || Array.isArray(styleRaw)) {
      out.push({ start, length, style: {} });
      continue;
    }
    const st = { ...(styleRaw as Record<string, unknown>) };
    const fc = st.fillColor;
    if (typeof fc === 'string' && fc.startsWith('#')) {
      const c = hexStringToColor(fc);
      st.fillColor = { r: c.r, g: c.g, b: c.b, a: c.a };
    } else if (fc && typeof fc === 'object' && fc !== null && 'r' in fc) {
      st.fillColor = {
        r: Number((fc as Color).r ?? 0),
        g: Number((fc as Color).g ?? 0),
        b: Number((fc as Color).b ?? 0),
        a: Number((fc as Color).a ?? 1),
      };
    }
    out.push({ start, length, style: st as CharacterStyleOverride });
  }
  return out;
}

/**
 * Normalize layout-related fields on node import: `constraints` → axis fields, `characters` → `text`,
 * shorthand `fills` / `strokes` / `effects` / `styleRuns`. Mutates `props` in place (call after copying JSON fields onto `props`).
 */
export function applyImportedNodeLayoutProps(props: Record<string, unknown>): void {
  const raw = props.constraints;
  if (raw && typeof raw === 'object' && raw !== null && 'horizontal' in raw && 'vertical' in raw) {
    const c = raw as { horizontal: string; vertical: string };
    props.horizontalConstraint = c.horizontal;
    props.verticalConstraint = c.vertical;
    delete props.constraints;
  }
  if ('characters' in props && !('text' in props)) {
    props.text = props.characters;
    delete props.characters;
  }
  if (props.fills !== undefined) {
    props.fills = normalizeImportFills(props.fills);
  }
  if (props.strokes !== undefined) {
    props.strokes = normalizeImportStrokes(props.strokes);
  }
  if (props.effects !== undefined) {
    props.effects = normalizeImportEffects(props.effects);
  }
  if (props.styleRuns !== undefined) {
    props.styleRuns = normalizeImportStyleRuns(props.styleRuns);
  }
}

/**
 * Last-resort recursive import when {@link deserializeToGraph} throws (very loose JSON).
 * Uses {@link applyImportedNodeLayoutProps} — keep in sync with Studio envelope fallback.
 * @see {@link ./spec/scene-envelope.ts}
 */
export function importSceneNodeFallback(graph: SceneGraph, parentId: string, json: unknown): string {
  const migrated = migrateScene(json as INodeJSON);
  const overrides: Record<string, unknown> = {};
  const skip = new Set(['type', 'children', 'name', 'id', 'version', 'timeline', 'strokeWeight']);
  for (const [key, value] of Object.entries(migrated as Record<string, unknown>)) {
    if (skip.has(key) || value === undefined) continue;
    overrides[key] = value;
  }
  applyImportedNodeLayoutProps(overrides);
  const m = migrated as INodeJSON;
  const node = graph.createNode((m.type ?? 'FRAME') as any, parentId, {
    name: m.name ?? m.type ?? 'Node',
    ...overrides,
  });
  if (m.children) {
    for (const child of m.children) {
      importSceneNodeFallback(graph, node.id, child);
    }
  }
  return node.id;
}

// ─── Deserialize (INode path — backward compat) ──────────────

function importNodeJson(graph: SceneGraph, parentId: string, json: INodeJSON): string {
  const overrides: Record<string, unknown> = {};

  // Map all properties
  const skip = new Set(['id', 'type', 'children', 'name', 'version', 'timeline']);
  for (const [key, value] of Object.entries(json)) {
    if (skip.has(key) || value === undefined) continue;
    overrides[key] = deserializeValue(value);
  }

  applyImportedNodeLayoutProps(overrides);

  // Map INode type string to engine type
  const engineType = json.type === 'BOOLEAN_OPERATION' ? 'VECTOR' : json.type;

  const node = graph.createNode(engineType as any, parentId, {
    name: json.name ?? json.type ?? 'Node',
    ...overrides,
  });

  if (json.children) {
    for (const child of json.children) {
      importNodeJson(graph, node.id, child);
    }
  }

  return node.id;
}

/** Deserialize an INodeJSON tree back to an INode. */
export function deserializeNode(json: INodeJSON): INode {
  const graph = new SceneGraph();
  const host = new StandaloneHost(graph);
  setHost(host);
  const page = graph.addPage('Deserialized');
  const rootId = importNodeJson(graph, page.id, json);
  const rawRoot = graph.getNode(rootId)!;
  return new StandaloneNode(graph, rawRoot);
}

/** Deserialize a JSON string to an INode tree. */
export function deserializeFromString(jsonStr: string): INode {
  return deserializeNode(JSON.parse(jsonStr));
}

// ─── Deserialize (SceneGraph path — full fidelity) ───────────

/**
 * Import an INodeJSON tree into a SceneGraph with full fidelity.
 * Handles:
 *   - All SceneNode properties
 *   - Component relationships (componentId → instance index)
 *   - Constraint mapping (constraints → horizontalConstraint/verticalConstraint)
 *   - Text field normalization (characters → text)
 */
function importNodeToGraph(graph: SceneGraph, parentId: string, json: INodeJSON): string {
  const props: Record<string, unknown> = {};

  // Skip meta fields — handled separately
  const skip = new Set(['id', 'type', 'children', 'name', 'version', 'timeline', 'strokeWeight']);

  for (const [key, value] of Object.entries(json)) {
    if (skip.has(key) || value === undefined) continue;
    props[key] = deserializeValue(value);
  }

  applyImportedNodeLayoutProps(props);

  // Map type
  const engineType = json.type === 'BOOLEAN_OPERATION' ? 'VECTOR' : json.type;

  const node = graph.createNode(engineType as any, parentId, {
    name: json.name ?? json.type ?? 'Node',
    ...props,
  });

  // Recurse children
  if (json.children) {
    for (const child of json.children) {
      importNodeToGraph(graph, node.id, child);
    }
  }

  return node.id;
}

/**
 * Rebuild the instance index after importing a tree.
 * SceneGraph._trackInstance is called by createNode when componentId is set,
 * but we also need to handle the case where componentId was set via overrides.
 */
function rebuildInstanceIndex(graph: SceneGraph): void {
  for (const node of graph.nodes.values()) {
    if (node.type === 'INSTANCE' && node.componentId) {
      // Force re-track by calling the public API
      (graph as any)._trackInstance?.(node.componentId, node.id);
    }
  }
}

/**
 * Deserialize an INodeJSON tree to a SceneGraph with full fidelity.
 * Returns the graph and root node ID.
 */
export function deserializeToGraph(json: INodeJSON): { graph: SceneGraph; rootId: string } {
  const graph = new SceneGraph();
  const page = graph.addPage('Deserialized');
  const rootId = importNodeToGraph(graph, page.id, json);

  // Rebuild instance index for component relationships
  rebuildInstanceIndex(graph);

  return { graph, rootId };
}

/** Merge base64-encoded raster payloads from SceneJSON `images` into `graph.images` (hash → bytes). */
export function hydrateSceneImagesBase64(
  graph: SceneGraph,
  images: Record<string, unknown> | null | undefined,
): void {
  if (!images || typeof images !== 'object') return;
  for (const [hash, b64] of Object.entries(images)) {
    if (typeof b64 === 'string') graph.images.set(hash, base64ToBuffer(b64));
  }
}

/**
 * Deserialize a SceneJSON envelope to a SceneGraph.
 * Restores images, timeline, and full node tree.
 */
export function deserializeScene(scene: SceneJSON): {
  graph: SceneGraph;
  rootId: string;
  timeline?: ITimeline;
} {
  // Always run per-node migration so envelope v2 with legacy-shaped root matches `importScene` + `migrateScene`.
  const { graph, rootId } = deserializeToGraph(migrateScene(scene.root) as INodeJSON);

  hydrateSceneImagesBase64(graph, scene.images);

  // Restore timeline
  const timeline = scene.timeline ? deserializeTimeline(scene.timeline) : undefined;

  return { graph, rootId, timeline };
}

// ─── Timeline Serialization ──────────────────────────────────

/** Serialize an ITimeline to JSON-safe format. */
export function serializeTimeline(timeline: ITimeline): ITimelineJSON {
  return JSON.parse(JSON.stringify(timeline));
}

/** Deserialize a timeline JSON back to ITimeline. */
export function deserializeTimeline(json: ITimelineJSON): ITimeline {
  return JSON.parse(JSON.stringify(json));
}

// ─── Binary Helpers ──────────────────────────────────────────

function bufferToBase64(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ─── Migration ───────────────────────────────────────────────

/**
 * Migrate a node JSON tree from any version to the current format.
 * Handles:
 *   - v1 (or no version): legacy format from CLI/MCP engine.ts
 *   - v2: current full-fidelity format (no-op)
 *
 * Always safe to call — returns the input unchanged if already current.
 */
export function migrateScene(nodeJson: any): any {
  if (!nodeJson || typeof nodeJson !== 'object') return nodeJson;

  const version = nodeJson.version ?? 1;

  if (version >= SERIALIZE_VERSION) return nodeJson;

  // v1 → v2 migration
  if (version <= 1) {
    return migrateV1ToV2(nodeJson);
  }

  return nodeJson;
}

/**
 * Migrate a SceneJSON envelope from any version to current.
 */
export function migrateSceneJSON(scene: any): SceneJSON {
  if (!scene || typeof scene !== 'object') throw new Error('Invalid scene JSON');

  const version = scene.version ?? 1;

  if (version >= SERIALIZE_VERSION) return scene as SceneJSON;

  return {
    version: SERIALIZE_VERSION,
    root: migrateScene(scene.root ?? scene),
    timeline: scene.timeline,
    images: scene.images,
  };
}

/**
 * v1 → v2: Normalize field names and add missing defaults.
 *
 * v1 differences:
 *   - No `version` field on nodes
 *   - `horizontalConstraint`/`verticalConstraint` at node level (v2 uses `constraints` in JSON)
 *   - No component fields (componentId, overrides, variantProperties)
 *   - `text` field sometimes stored as `characters`
 *   - `fills` may be raw engine Fill objects (with `a` in color) or IPaint objects
 */
function migrateV1ToV2(node: any): any {
  if (!node || typeof node !== 'object') return node;

  const result = { ...node };

  // Ensure constraints wrapper if engine-style fields present
  if (result.horizontalConstraint || result.verticalConstraint) {
    if (!result.constraints) {
      result.constraints = {
        horizontal: result.horizontalConstraint ?? 'MIN',
        vertical: result.verticalConstraint ?? 'MIN',
      };
    }
    delete result.horizontalConstraint;
    delete result.verticalConstraint;
  }

  // Normalize text field — v1 might use either
  // (keep both for now — deserializer handles the mapping)

  // Ensure component defaults for INSTANCE/COMPONENT types
  if (result.type === 'INSTANCE' && !result.componentId) {
    result.componentId = null;
  }
  if (result.type === 'INSTANCE' && !result.overrides) {
    result.overrides = {};
  }
  if (result.type === 'INSTANCE' && !result.variantProperties) {
    result.variantProperties = {};
  }

  // Recurse children
  if (Array.isArray(result.children)) {
    result.children = result.children.map(migrateV1ToV2);
  }

  return result;
}
