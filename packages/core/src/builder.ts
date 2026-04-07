/**
 * Reframe — INode Builder
 *
 * Fluent API for creating INode trees without touching SceneGraph internals.
 *
 *   const banner = frame({ width: 1080, height: 1080, fills: [solid('#FF0000')] },
 *     rect({ width: 1080, height: 1080, fills: [solid('#000000')] }),
 *     text('Hello World', { fontSize: 48, x: 40, y: 40 }),
 *   );
 *
 *   const tree = build(banner);  // → INode (root of the tree)
 */

import type { INode, IPaint, ISolidPaint, IGradientPaint, IImagePaint, IEffect } from './host/types';
import { SceneGraph } from './engine/scene-graph';
import { StandaloneNode } from './adapters/standalone/node';
import type { SceneNode, Fill, Effect, Color } from './engine/types';

// ─── Node Blueprint ────────────────────────────────────────────

/** Declarative description of a node — not yet materialized. */
export interface NodeBlueprint {
  readonly kind: string;
  readonly props: NodeProps;
  readonly children: readonly NodeBlueprint[];
}

/** Properties accepted by the builder (subset of SceneNode, human-friendly). */
export interface NodeProps {
  // Identity
  name?: string;

  // Geometry
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;

  // Visual
  fills?: IPaint[];
  strokes?: IPaint[];
  effects?: IEffect[];
  opacity?: number;
  visible?: boolean;
  cornerRadius?: number;
  topLeftRadius?: number;
  topRightRadius?: number;
  bottomRightRadius?: number;
  bottomLeftRadius?: number;
  independentCorners?: boolean;
  clipsContent?: boolean;
  blendMode?: string;
  dashPattern?: number[];
  independentStrokeWeights?: boolean;
  borderTopWeight?: number;
  borderRightWeight?: number;
  borderBottomWeight?: number;
  borderLeftWeight?: number;

  // Text
  characters?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  italic?: boolean;
  textAlignHorizontal?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  textAlignVertical?: 'TOP' | 'CENTER' | 'BOTTOM';
  textAutoResize?: 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE';
  textDecoration?: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';
  textCase?: 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE';
  letterSpacing?: number;
  lineHeight?: number;
  textTruncation?: 'DISABLED' | 'ENDING';
  maxLines?: number | null;

  // Layout
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  layoutPositioning?: 'AUTO' | 'ABSOLUTE';
  layoutAlignSelf?: 'AUTO' | 'MIN' | 'CENTER' | 'MAX' | 'STRETCH';
  primaryAxisSizing?: 'FIXED' | 'HUG' | 'FILL';
  counterAxisSizing?: 'FIXED' | 'HUG' | 'FILL';
  primaryAxisAlign?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  counterAxisAlign?: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'BASELINE';
  layoutGrow?: number;
  layoutWrap?: 'NO_WRAP' | 'WRAP';
  itemSpacing?: number;
  counterAxisSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;

  // Size constraints
  minWidth?: number | null;
  maxWidth?: number | null;
  minHeight?: number | null;
  maxHeight?: number | null;

  // Constraints
  horizontalConstraint?: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE';
  verticalConstraint?: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE';
}

// ─── Node Constructors ────────────────────────────────────────

function blueprint(kind: string, props: NodeProps, children: NodeBlueprint[]): NodeBlueprint {
  return { kind, props, children };
}

/** Frame node (container). */
export function frame(props: NodeProps, ...children: NodeBlueprint[]): NodeBlueprint {
  return blueprint('FRAME', props, children);
}

/** Rectangle node. */
export function rect(props: NodeProps = {}): NodeBlueprint {
  return blueprint('RECTANGLE', props, []);
}

/** Ellipse node. */
export function ellipse(props: NodeProps = {}): NodeBlueprint {
  return blueprint('ELLIPSE', props, []);
}

/** Text node. First arg is the string content. */
export function text(characters: string, props: NodeProps = {}): NodeBlueprint {
  return blueprint('TEXT', { ...props, characters }, []);
}

/** Group node (container without own visual). */
export function group(props: NodeProps, ...children: NodeBlueprint[]): NodeBlueprint {
  return blueprint('GROUP', props, children);
}

/** Component node. */
export function component(props: NodeProps, ...children: NodeBlueprint[]): NodeBlueprint {
  return blueprint('COMPONENT', props, children);
}

/** Line node. */
export function line(props: NodeProps = {}): NodeBlueprint {
  return blueprint('LINE', props, []);
}

/** Star node. */
export function star(props: NodeProps = {}): NodeBlueprint {
  return blueprint('STAR', props, []);
}

/** Polygon node. */
export function polygon(props: NodeProps = {}): NodeBlueprint {
  return blueprint('POLYGON', props, []);
}

/** Vector node. */
export function vector(props: NodeProps = {}): NodeBlueprint {
  return blueprint('VECTOR', props, []);
}

// ─── Paint Helpers ─────────────────────────────────────────────

/** Parse hex color string to {r, g, b} (0–1 range). */
function parseHex(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const n = h.length === 3
    ? parseInt(h[0]+h[0]+h[1]+h[1]+h[2]+h[2], 16)
    : parseInt(h, 16);
  return {
    r: ((n >> 16) & 0xFF) / 255,
    g: ((n >> 8) & 0xFF) / 255,
    b: (n & 0xFF) / 255,
  };
}

type ColorInput = string | { r: number; g: number; b: number };

function resolveColor(c: ColorInput): { r: number; g: number; b: number } {
  return typeof c === 'string' ? parseHex(c) : c;
}

/** Solid color fill. Accepts hex string or {r,g,b}. */
export function solid(color: ColorInput, opacity = 1): ISolidPaint {
  return { type: 'SOLID', color: resolveColor(color), opacity, visible: true };
}

/** Linear gradient fill. */
export function linearGradient(
  stops: Array<{ color: ColorInput; position: number }>,
  opacity = 1,
): IGradientPaint {
  return {
    type: 'GRADIENT_LINEAR',
    opacity,
    visible: true,
    gradientStops: stops.map(s => ({
      color: { ...resolveColor(s.color), a: 1 },
      position: s.position,
    })),
  };
}

/** Radial gradient fill. */
export function radialGradient(
  stops: Array<{ color: ColorInput; position: number }>,
  opacity = 1,
): IGradientPaint {
  return {
    type: 'GRADIENT_RADIAL',
    opacity,
    visible: true,
    gradientStops: stops.map(s => ({
      color: { ...resolveColor(s.color), a: 1 },
      position: s.position,
    })),
  };
}

/** Image fill. */
export function image(imageHash: string, scaleMode: string = 'FILL', opacity = 1): IImagePaint {
  return { type: 'IMAGE', imageHash, scaleMode, opacity, visible: true };
}

// ─── Effect Helpers ────────────────────────────────────────────

/** Drop shadow effect. */
export function dropShadow(
  opts: { color?: ColorInput; offset?: { x: number; y: number }; radius?: number; spread?: number } = {},
): IEffect {
  const c = resolveColor(opts.color ?? '#000000');
  return {
    type: 'DROP_SHADOW',
    visible: true,
    radius: opts.radius ?? 4,
    offset: opts.offset ?? { x: 0, y: 2 },
    color: { ...c, a: 0.25 },
    spread: opts.spread ?? 0,
  };
}

/** Inner shadow effect. */
export function innerShadow(
  opts: { color?: ColorInput; offset?: { x: number; y: number }; radius?: number } = {},
): IEffect {
  const c = resolveColor(opts.color ?? '#000000');
  return {
    type: 'INNER_SHADOW',
    visible: true,
    radius: opts.radius ?? 4,
    offset: opts.offset ?? { x: 0, y: 2 },
    color: { ...c, a: 0.25 },
  };
}

/** Blur effect. */
export function blur(radius = 4): IEffect {
  return { type: 'LAYER_BLUR', visible: true, radius };
}

// ─── Build ─────────────────────────────────────────────────────

/**
 * Convert IPaint → engine Fill.
 */
function iPaintToFill(paint: IPaint): Fill {
  if (paint.type === 'SOLID') {
    const s = paint as ISolidPaint;
    return {
      type: 'SOLID',
      color: { r: s.color.r, g: s.color.g, b: s.color.b, a: 1 },
      opacity: s.opacity ?? 1,
      visible: s.visible ?? true,
    };
  }
  if (paint.type === 'IMAGE') {
    const img = paint as IImagePaint;
    return {
      type: 'IMAGE',
      color: { r: 0, g: 0, b: 0, a: 1 },
      opacity: img.opacity ?? 1,
      visible: img.visible ?? true,
      imageHash: img.imageHash ?? undefined,
      imageScaleMode: (img.scaleMode as any) ?? 'FILL',
    };
  }
  // Gradient
  const g = paint as IGradientPaint;
  return {
    type: g.type as any,
    color: { r: 0, g: 0, b: 0, a: 1 },
    opacity: g.opacity ?? 1,
    visible: g.visible ?? true,
    gradientStops: g.gradientStops?.map(s => ({
      color: s.color,
      position: s.position,
    })),
    gradientTransform: g.gradientTransform,
  };
}

/**
 * Convert IEffect → engine Effect.
 */
function iEffectToEngine(e: IEffect): Effect {
  return {
    type: (e.type ?? 'DROP_SHADOW') as any,
    color: (e as any).color ?? { r: 0, g: 0, b: 0, a: 0.25 },
    offset: (e as any).offset ?? { x: 0, y: 0 },
    radius: e.radius ?? 0,
    spread: (e as any).spread ?? 0,
    visible: e.visible ?? true,
  };
}

/**
 * Recursively materialize a NodeBlueprint into the SceneGraph.
 */
function materialize(
  graph: SceneGraph,
  bp: NodeBlueprint,
  parentId: string,
): SceneNode {
  const p = bp.props;

  const overrides: Partial<SceneNode> = {};

  // Identity
  if (p.name !== undefined) overrides.name = p.name;

  // Geometry
  if (p.x !== undefined) overrides.x = p.x;
  if (p.y !== undefined) overrides.y = p.y;
  if (p.width !== undefined) overrides.width = p.width;
  if (p.height !== undefined) overrides.height = p.height;
  if (p.rotation !== undefined) overrides.rotation = p.rotation;

  // Visual
  if (p.fills) overrides.fills = p.fills.map(iPaintToFill);
  if (p.strokes) {
    overrides.strokes = p.strokes.map(paint => {
      const f = iPaintToFill(paint);
      return {
        color: f.color,
        weight: (paint as any).weight ?? 1,
        opacity: f.opacity,
        visible: f.visible,
        align: ((paint as any).align ?? 'INSIDE') as 'INSIDE' | 'CENTER' | 'OUTSIDE',
      };
    });
    if (p.dashPattern) overrides.dashPattern = p.dashPattern;
  }
  if (p.effects) overrides.effects = p.effects.map(iEffectToEngine);
  if (p.opacity !== undefined) overrides.opacity = p.opacity;
  if (p.visible !== undefined) overrides.visible = p.visible;
  if (p.cornerRadius !== undefined) overrides.cornerRadius = p.cornerRadius;
  if (p.topLeftRadius !== undefined) overrides.topLeftRadius = p.topLeftRadius;
  if (p.topRightRadius !== undefined) overrides.topRightRadius = p.topRightRadius;
  if (p.bottomRightRadius !== undefined) overrides.bottomRightRadius = p.bottomRightRadius;
  if (p.bottomLeftRadius !== undefined) overrides.bottomLeftRadius = p.bottomLeftRadius;
  if (p.independentCorners !== undefined) overrides.independentCorners = p.independentCorners;
  if (p.clipsContent !== undefined) overrides.clipsContent = p.clipsContent;
  if (p.blendMode !== undefined) overrides.blendMode = p.blendMode as any;
  if (p.dashPattern !== undefined) overrides.dashPattern = p.dashPattern;
  if (p.independentStrokeWeights !== undefined) overrides.independentStrokeWeights = p.independentStrokeWeights;
  if (p.borderTopWeight !== undefined) overrides.borderTopWeight = p.borderTopWeight;
  if (p.borderRightWeight !== undefined) overrides.borderRightWeight = p.borderRightWeight;
  if (p.borderBottomWeight !== undefined) overrides.borderBottomWeight = p.borderBottomWeight;
  if (p.borderLeftWeight !== undefined) overrides.borderLeftWeight = p.borderLeftWeight;

  // Text
  if (p.characters !== undefined) overrides.text = p.characters;
  if (p.fontSize !== undefined) overrides.fontSize = p.fontSize;
  if (p.fontFamily !== undefined) overrides.fontFamily = p.fontFamily;
  if (p.fontWeight !== undefined) overrides.fontWeight = p.fontWeight;
  if (p.italic !== undefined) overrides.italic = p.italic;
  if (p.textAlignHorizontal !== undefined) overrides.textAlignHorizontal = p.textAlignHorizontal;
  if (p.textAlignVertical !== undefined) overrides.textAlignVertical = p.textAlignVertical;
  if (p.textAutoResize !== undefined) overrides.textAutoResize = p.textAutoResize;
  if (p.textDecoration !== undefined) overrides.textDecoration = p.textDecoration;
  if (p.textCase !== undefined) overrides.textCase = p.textCase;
  if (p.letterSpacing !== undefined) overrides.letterSpacing = p.letterSpacing;
  if (p.lineHeight !== undefined) overrides.lineHeight = p.lineHeight;
  if (p.textTruncation !== undefined) overrides.textTruncation = p.textTruncation;
  if (p.maxLines !== undefined) overrides.maxLines = p.maxLines;

  // Layout
  if (p.layoutMode !== undefined) overrides.layoutMode = p.layoutMode;
  if (p.layoutPositioning !== undefined) overrides.layoutPositioning = p.layoutPositioning;
  if (p.layoutAlignSelf !== undefined) overrides.layoutAlignSelf = p.layoutAlignSelf;
  if (p.primaryAxisSizing !== undefined) overrides.primaryAxisSizing = p.primaryAxisSizing;
  if (p.counterAxisSizing !== undefined) overrides.counterAxisSizing = p.counterAxisSizing;
  if (p.primaryAxisAlign !== undefined) overrides.primaryAxisAlign = p.primaryAxisAlign;
  if (p.counterAxisAlign !== undefined) overrides.counterAxisAlign = p.counterAxisAlign as any;
  if (p.layoutGrow !== undefined) overrides.layoutGrow = p.layoutGrow;
  if (p.layoutWrap !== undefined) overrides.layoutWrap = p.layoutWrap;
  if (p.itemSpacing !== undefined) overrides.itemSpacing = p.itemSpacing;
  if (p.counterAxisSpacing !== undefined) overrides.counterAxisSpacing = p.counterAxisSpacing;
  if (p.paddingTop !== undefined) overrides.paddingTop = p.paddingTop;
  if (p.paddingRight !== undefined) overrides.paddingRight = p.paddingRight;
  if (p.paddingBottom !== undefined) overrides.paddingBottom = p.paddingBottom;
  if (p.paddingLeft !== undefined) overrides.paddingLeft = p.paddingLeft;

  // Constraints
  if (p.horizontalConstraint !== undefined) overrides.horizontalConstraint = p.horizontalConstraint;
  if (p.verticalConstraint !== undefined) overrides.verticalConstraint = p.verticalConstraint;

  const node = graph.createNode(bp.kind as any, parentId, overrides);

  // Recursively materialize children
  for (const child of bp.children) {
    materialize(graph, child, node.id);
  }

  return node;
}

/** Result of build(): the root INode and the backing SceneGraph. */
export interface BuildResult {
  /** Root INode of the built tree. */
  root: INode;
  /** Backing SceneGraph (for advanced use, export, template binding, etc.). */
  graph: SceneGraph;
}

/**
 * Materialize a blueprint into a live INode tree.
 *
 * Creates a fresh SceneGraph under the hood. Returns the root INode
 * and the graph (for export, template binding, or passing to pipelines).
 *
 * @example
 *   const { root, graph } = build(
 *     frame({ width: 1080, height: 1080, fills: [solid('#FFFFFF')] },
 *       rect({ x: 0, y: 0, width: 1080, height: 1080, fills: [solid('#000')] }),
 *       text('Hello', { fontSize: 48, x: 40, y: 40 }),
 *     )
 *   );
 */
export function build(blueprint: NodeBlueprint): BuildResult {
  const graph = new SceneGraph();
  const page = graph.addPage('Builder');
  const raw = materialize(graph, blueprint, page.id);
  const root = new StandaloneNode(graph, raw);
  return { root, graph };
}

/**
 * Materialize a blueprint into an existing SceneGraph under a given parent.
 *
 * Useful when you want to add builder-created subtrees into an existing scene.
 */
export function buildInto(
  graph: SceneGraph,
  parentId: string,
  bp: NodeBlueprint,
): INode {
  const raw = materialize(graph, bp, parentId);
  return new StandaloneNode(graph, raw);
}
