/**
 * reframe_edit — INode creation and editing via operations.
 *
 * Agents describe designs in INode vocabulary — no HTML intermediate.
 * Supports: create scenes, add/update/delete/clone/move nodes, resize scenes.
 * Every call auto-audits and auto-fixes. Returns scene state + context.
 *
 * This is the INode-native path. HTML import (produce/from_html) remains
 * for importing existing websites, but draw is the primary creation tool.
 */

import { z } from 'zod';
import { NodeType } from '../../../core/src/host/types.js';
import type { SceneGraph } from '../../../core/src/engine/scene-graph.js';
import type { SceneNode } from '../../../core/src/engine/types.js';
import { StandaloneNode } from '../../../core/src/adapters/standalone/node.js';
import { StandaloneHost } from '../../../core/src/adapters/standalone/adapter.js';
import { setHost } from '../../../core/src/host/context.js';
import { storeScene, getScene, resolveScene, setTokenIndex, getTokenIndex, findSessionId, bumpSceneSessionRevision } from '../store.js';
import { exportScene, inspectScene } from '../engine.js';
import { getSession } from '../session.js';
import { parseDesignMd } from '../../../core/src/design-system/index.js';
import {
  tokenizeDesignSystem, resolveColorToken, resolveNumberToken,
  bindTokenToNode, switchTokenMode, listTokens, colorToHex,
  type TokenIndex,
} from '../../../core/src/design-system/tokens.js';
import { autoDetectRoles } from '../../../core/src/semantic.js';
import { adaptFromGraph } from '../../../core/src/resize/adapt.js';
import { ComponentRegistry } from '../../../core/src/engine/component-registry.js';
import { resolveBlueprint } from '../../../core/src/ui/blueprint.js';
import { fromDesignMd } from '../../../core/src/ui/theme.js';
import { build as buildBlueprint } from '../../../core/src/builder.js';
import { ensureSceneLayout } from '../../../core/src/engine/layout.js';
import { runAutoFixLoop } from './_auto-fix.js';
import { audit } from '../../../core/src/audit.js';
import { buildInspectAuditRules } from '../../../core/src/inspect-audit-rules.js';
import { MCP_LIMITS } from '../limits.js';

// ─── Color helper ────────────────────────────────────────────

function hexToColor(hex: string): { r: number; g: number; b: number; a: number } {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  if (h.length === 4) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2]+h[3]+h[3];
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
    a: h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  };
}

/**
 * Parse fills with shorthand support.
 * Returns { fills, tokenBindings } where tokenBindings maps fill indices to token names.
 */
function parseFillsWithTokens(fills: any[], graph?: SceneGraph, tokenIndex?: TokenIndex): { fills: any[]; tokenBindings: Map<number, string> } {
  const tokenBindings = new Map<number, string>();
  const parsed = fills.map((f, idx) => {
    if (typeof f === 'string') {
      const c = hexToColor(f);
      return { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b, a: 1 }, opacity: c.a, visible: true };
    }
    // Token reference: { token: 'color.primary' }
    if (f.token && graph && tokenIndex) {
      const color = resolveColorToken(graph, tokenIndex, f.token);
      if (color) {
        tokenBindings.set(idx, f.token);
        return { type: 'SOLID', color: { r: color.r, g: color.g, b: color.b, a: 1 }, opacity: color.a, visible: true };
      }
      // Token not found — fall through, treat as no-op fill
      return { type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5, a: 1 }, opacity: 1, visible: true };
    }
    if (f.color && typeof f.color === 'string') {
      const c = hexToColor(f.color);
      return { type: f.type ?? 'SOLID', color: { r: c.r, g: c.g, b: c.b, a: 1 }, opacity: f.opacity ?? c.a, visible: true };
    }
    return f;
  });
  return { fills: parsed, tokenBindings };
}

function parseFills(fills: any[]): any[] {
  return parseFillsWithTokens(fills).fills;
}

/**
 * Resolve a property value that might be a token reference.
 * Token format: { token: 'type.hero.size' } → resolves to number.
 * Returns the resolved value and optionally the token name for binding.
 */
function resolveTokenProp(
  value: any,
  graph?: SceneGraph,
  tokenIndex?: TokenIndex,
): { value: any; tokenName?: string } {
  if (value && typeof value === 'object' && value.token && graph && tokenIndex) {
    const resolved = resolveNumberToken(graph, tokenIndex, value.token);
    if (resolved !== undefined) {
      return { value: resolved, tokenName: value.token };
    }
    return { value: 0 }; // token not found
  }
  return { value };
}

// ─── Node type mapping ───────────────────────────────────────

const TYPE_MAP: Record<string, string> = {
  frame: 'FRAME', text: 'TEXT', rect: 'RECTANGLE', ellipse: 'ELLIPSE',
  group: 'GROUP', component: 'COMPONENT', line: 'LINE',
  star: 'STAR', polygon: 'POLYGON', vector: 'VECTOR',
  FRAME: 'FRAME', TEXT: 'TEXT', RECTANGLE: 'RECTANGLE', ELLIPSE: 'ELLIPSE',
  GROUP: 'GROUP', COMPONENT: 'COMPONENT', LINE: 'LINE',
  STAR: 'STAR', POLYGON: 'POLYGON', VECTOR: 'VECTOR',
};

// ─── Schema ──────────────────────────────────────────────────

const nodeDescSchema: z.ZodType<any> = z.lazy(() => z.object({
  type: z.string().describe('Node type: frame, text, rect, ellipse, group, component, line, star, polygon, vector'),
  name: z.string().optional().describe('Node name (used for path-based updates)'),

  // Geometry
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  rotation: z.number().optional(),

  // Visual
  fills: z.array(z.any()).optional().describe('Fills array. Shorthand: ["#FF0000"] or [{color:"#FF0000"}] or full IPaint objects'),
  opacity: z.number().optional(),
  cornerRadius: z.number().optional(),
  topLeftRadius: z.number().optional(),
  topRightRadius: z.number().optional(),
  bottomRightRadius: z.number().optional(),
  bottomLeftRadius: z.number().optional(),
  visible: z.boolean().optional(),
  locked: z.boolean().optional(),
  blendMode: z.string().optional().describe('Blend mode: NORMAL, MULTIPLY, SCREEN, OVERLAY, DARKEN, LIGHTEN, etc.'),

  // Strokes
  strokes: z.array(z.any()).optional(),
  strokeWeight: z.number().optional(),
  dashPattern: z.array(z.number()).optional().describe('Dash pattern [dash, gap] e.g. [5, 3]'),
  strokeCap: z.enum(['NONE', 'ROUND', 'SQUARE', 'ARROW_LINES', 'ARROW_EQUILATERAL']).optional(),
  strokeJoin: z.enum(['MITER', 'BEVEL', 'ROUND']).optional(),
  borderTopWeight: z.number().optional(),
  borderRightWeight: z.number().optional(),
  borderBottomWeight: z.number().optional(),
  borderLeftWeight: z.number().optional(),

  // Effects
  effects: z.array(z.any()).optional(),

  // Transform
  flipX: z.boolean().optional().describe('Horizontal flip'),
  flipY: z.boolean().optional().describe('Vertical flip'),

  // Text (both "characters" and "text" accepted — same field)
  characters: z.string().optional().describe('Text content (for type "text"). Alias: "text"'),
  text: z.string().optional().describe('Text content — alias for characters'),
  fontSize: z.number().optional(),
  fontFamily: z.string().optional(),
  fontWeight: z.number().optional(),
  italic: z.boolean().optional(),
  textAlignHorizontal: z.enum(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED']).optional(),
  textAlignVertical: z.enum(['TOP', 'CENTER', 'BOTTOM']).optional(),
  lineHeight: z.any().optional(),
  letterSpacing: z.any().optional(),
  textCase: z.enum(['ORIGINAL', 'UPPER', 'LOWER', 'TITLE']).optional(),
  textDecoration: z.enum(['NONE', 'UNDERLINE', 'STRIKETHROUGH']).optional(),
  textTruncation: z.enum(['DISABLED', 'ENDING']).optional(),
  maxLines: z.number().optional().describe('Max lines before truncation'),
  textAutoResize: z.enum(['NONE', 'HEIGHT', 'WIDTH_AND_HEIGHT', 'TRUNCATE']).optional(),
  styleRuns: z.array(z.object({
    start: z.number(),
    length: z.number(),
    style: z.record(z.any()),
  })).optional().describe('Rich text: per-range style overrides [{start, length, style: {fontWeight, fontSize, italic, ...}}]'),

  // Layout
  layoutMode: z.enum(['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID']).optional(),
  layoutWrap: z.enum(['NO_WRAP', 'WRAP']).optional(),
  primaryAxisAlign: z.enum(['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN']).optional(),
  counterAxisAlign: z.enum(['MIN', 'CENTER', 'MAX', 'STRETCH', 'BASELINE']).optional(),
  itemSpacing: z.number().optional(),
  counterAxisSpacing: z.number().optional(),
  paddingTop: z.number().optional(),
  paddingRight: z.number().optional(),
  paddingBottom: z.number().optional(),
  paddingLeft: z.number().optional(),
  padding: z.number().optional().describe('Uniform padding shorthand (sets all 4 sides)'),
  layoutGrow: z.number().optional(),
  layoutAlignSelf: z.enum(['AUTO', 'MIN', 'CENTER', 'MAX', 'STRETCH']).optional(),
  layoutPositioning: z.enum(['AUTO', 'ABSOLUTE']).optional().describe('Child positioning: AUTO (flow) or ABSOLUTE'),
  primaryAxisSizing: z.enum(['FIXED', 'HUG', 'FILL']).optional().describe('Primary axis sizing: FIXED, HUG (wrap content), FILL (stretch)'),
  counterAxisSizing: z.enum(['FIXED', 'HUG', 'FILL']).optional().describe('Counter axis sizing'),
  horizontalConstraint: z.enum(['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE']).optional(),
  verticalConstraint: z.enum(['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE']).optional(),
  clipsContent: z.boolean().optional(),

  // Size constraints
  minWidth: z.number().optional(),
  maxWidth: z.number().optional(),
  minHeight: z.number().optional(),
  maxHeight: z.number().optional(),

  // Grid layout
  gridTemplateColumns: z.array(z.object({ type: z.enum(['FIXED', 'FR', 'AUTO']), value: z.number() })).optional()
    .describe('Grid columns: [{type: "FIXED", value: 200}, {type: "FR", value: 1}]'),
  gridTemplateRows: z.array(z.object({ type: z.enum(['FIXED', 'FR', 'AUTO']), value: z.number() })).optional(),
  gridColumnGap: z.number().optional(),
  gridRowGap: z.number().optional(),
  gridPosition: z.object({
    column: z.number(), row: z.number(),
    columnSpan: z.number().optional().default(1),
    rowSpan: z.number().optional().default(1),
  }).optional().describe('Grid child position: {column: 1, row: 1, columnSpan: 2}'),

  // Mask
  isMask: z.boolean().optional().describe('Use this node as a mask for subsequent siblings'),
  maskType: z.enum(['ALPHA', 'VECTOR', 'LUMINANCE']).optional(),

  // Semantic
  role: z.string().optional().describe('Semantic role: button, heading, card, nav, hero, cta, section, badge, avatar, etc.'),
  slot: z.string().optional().describe('Content slot name (marks node as bindable placeholder)'),

  // Behavior — interaction states
  states: z.record(z.string(), z.record(z.any())).optional()
    .describe('Interaction states: { hover: { fills: ["#333"], opacity: 0.9 }, disabled: { opacity: 0.5 } }'),

  // Behavior — responsive rules
  responsive: z.array(z.object({
    maxWidth: z.number(),
    props: z.record(z.any()),
  })).optional().describe('Responsive breakpoints: [{ maxWidth: 768, props: { fontSize: 28 } }]'),

  // Children
  children: z.array(z.lazy(() => nodeDescSchema)).optional(),
}).passthrough());

const operationSchema = z.discriminatedUnion('op', [
  // Create scene from node tree
  z.object({
    op: z.literal('create'),
    name: z.string().optional().describe('Scene name'),
    width: z.number().describe('Scene width'),
    height: z.number().describe('Scene height'),
    root: nodeDescSchema.describe('Root node description with children'),
  }),

  // Add node to existing scene
  z.object({
    op: z.literal('add'),
    sceneId: z.string().optional().describe('Target scene (default: last created)'),
    parent: z.string().optional().describe('Parent node path/name (default: root)'),
    after: z.string().optional().describe('Insert after this sibling name'),
    node: nodeDescSchema.describe('Node to add (with optional children)'),
  }),

  // Update existing node(s)
  z.object({
    op: z.literal('update'),
    sceneId: z.string().optional(),
    path: z.string().describe('Node path: "NodeName" or "Parent/Child" or node ID'),
    props: z.record(z.any()).describe('Properties to update (any INode properties)'),
  }),

  // Delete node
  z.object({
    op: z.literal('delete'),
    sceneId: z.string().optional(),
    path: z.string().describe('Node path or ID to delete'),
  }),

  // Clone scene
  z.object({
    op: z.literal('clone'),
    source: z.string().describe('Source scene ID or slug to clone'),
    name: z.string().optional().describe('Name for cloned scene'),
  }),

  // Resize scene root
  z.object({
    op: z.literal('resize'),
    sceneId: z.string().optional(),
    width: z.number().describe('New width'),
    height: z.number().describe('New height'),
  }),

  // Move/reparent node
  z.object({
    op: z.literal('move'),
    sceneId: z.string().optional(),
    path: z.string().describe('Node to move'),
    newParent: z.string().describe('New parent node path'),
    index: z.number().optional().describe('Insert index in new parent'),
  }),

  // Define tokens from DESIGN.md or inline
  z.object({
    op: z.literal('defineTokens'),
    sceneId: z.string().optional().describe('Target scene (default: last created)'),
    designMd: z.string().optional().describe('DESIGN.md to generate tokens from'),
    darkMode: z.boolean().optional().describe('Create a dark mode variant (default: false)'),
  }),

  // Switch token mode (light/dark)
  z.object({
    op: z.literal('setMode'),
    sceneId: z.string().optional(),
    mode: z.string().describe('Mode name: "light" or "dark"'),
  }),
]);

export const editInputSchema = {
  operations: z
    .array(operationSchema)
    .max(MCP_LIMITS.editOperationsMax)
    .describe(
      'Array of operations to execute. Operations run in sequence. ' +
        'Types: create (new scene), add (node to scene), update (node props), ' +
        'delete (node), clone (scene), resize (scene root), move (reparent node).'
    ),

  designMd: z.string().optional().describe('DESIGN.md for brand compliance audit after operations'),

  audit: z.union([
    z.boolean(),
    z.object({
      autoFix: z.boolean().optional().default(true),
      maxPasses: z.number().optional().default(3),
      minFontSize: z.number().optional().default(8),
      minContrast: z.number().optional().default(3),
    }),
  ]).optional().default(true).describe('Auto-audit after operations. true = audit+fix, false = skip.'),
};

// ─── Node resolution ─────────────────────────────────────────

/** Find a node by name path (e.g. "Hero/Title") or by ID. */
function findNode(graph: SceneGraph, rootId: string, path: string): SceneNode | undefined {
  // Try direct ID first
  const byId = graph.getNode(path);
  if (byId) return byId;

  const root = graph.getNode(rootId);
  if (!root) return undefined;

  // If path matches root node's name (exact or partial), return root itself
  const parts = path.split('/');
  if (parts[0] === root.name || root.name?.includes(parts[0])) {
    if (parts.length === 1) return root;
    // "Root/Child" → start from root, skip first part
    parts.shift();
  }

  // Path-based: walk children by name
  let current: SceneNode | undefined = root;
  for (const part of parts) {
    if (!current) return undefined;
    const children = graph.getChildren(current.id);
    const match = children.find(c => c.name === part);
    if (!match) {
      // Try partial match in direct children
      const partial = children.find(c => c.name?.includes(part));
      if (partial) { current = partial; continue; }

      // Single-segment path: deep search entire tree
      if (parts.length === 1) {
        const deep = findDeep(graph, root.id, part);
        if (deep) return deep;
      }
      return undefined;
    }
    current = match;
  }
  return current;
}

/** Recursive depth-first search by exact name. */
function findDeep(graph: SceneGraph, nodeId: string, name: string): SceneNode | undefined {
  const node = graph.getNode(nodeId);
  if (!node) return undefined;
  if (node.name === name) return node;
  for (const childId of node.childIds) {
    const found = findDeep(graph, childId, name);
    if (found) return found;
  }
  return undefined;
}

// ─── Build node tree into graph ──────────────────────────────

/** Deferred token binding: node ID + field + token name. */
interface DeferredBinding {
  nodeId: string;
  field: string;
  tokenName: string;
}

function buildNodeIntoGraph(
  graph: SceneGraph,
  parentId: string,
  desc: any,
  tokenIndex?: TokenIndex,
): SceneNode {
  const nodeType = TYPE_MAP[desc.type] ?? 'FRAME';
  const overrides: Record<string, any> = {};
  const bindings: DeferredBinding[] = [];

  // Identity
  if (desc.name) overrides.name = desc.name;

  // Geometry
  if (desc.x !== undefined) overrides.x = desc.x;
  if (desc.y !== undefined) overrides.y = desc.y;
  if (desc.width !== undefined) overrides.width = desc.width;
  if (desc.height !== undefined) overrides.height = desc.height;
  if (desc.rotation !== undefined) overrides.rotation = desc.rotation;

  // Visual — fills with token support
  if (desc.fills) {
    const { fills, tokenBindings } = parseFillsWithTokens(desc.fills, graph, tokenIndex);
    overrides.fills = fills;
    // Defer token bindings (need node ID first)
    for (const [idx, tokenName] of tokenBindings) {
      bindings.push({ nodeId: '', field: `fills[${idx}].color`, tokenName });
    }
  }
  if (desc.opacity !== undefined) overrides.opacity = desc.opacity;
  if (desc.visible !== undefined) overrides.visible = desc.visible;
  if (desc.strokes) overrides.strokes = desc.strokes;
  if (desc.strokeWeight !== undefined) overrides.strokeWeight = desc.strokeWeight;
  if (desc.dashPattern) overrides.dashPattern = desc.dashPattern;
  if (desc.strokeCap) overrides.strokeCap = desc.strokeCap;
  if (desc.strokeJoin) overrides.strokeJoin = desc.strokeJoin;
  if (desc.borderTopWeight !== undefined) {
    overrides.borderTopWeight = desc.borderTopWeight;
    overrides.independentStrokeWeights = true;
  }
  if (desc.borderRightWeight !== undefined) overrides.borderRightWeight = desc.borderRightWeight;
  if (desc.borderBottomWeight !== undefined) overrides.borderBottomWeight = desc.borderBottomWeight;
  if (desc.borderLeftWeight !== undefined) overrides.borderLeftWeight = desc.borderLeftWeight;
  if (desc.effects) overrides.effects = desc.effects;

  // Transforms
  if (desc.flipX !== undefined) overrides.flipX = desc.flipX;
  if (desc.flipY !== undefined) overrides.flipY = desc.flipY;

  // Corner radius (token-aware)
  if (desc.cornerRadius !== undefined) {
    const { value, tokenName } = resolveTokenProp(desc.cornerRadius, graph, tokenIndex);
    overrides.cornerRadius = value;
    if (tokenName) bindings.push({ nodeId: '', field: 'cornerRadius', tokenName });
  }
  if (desc.topLeftRadius !== undefined) {
    overrides.topLeftRadius = desc.topLeftRadius;
    overrides.independentCorners = true;
  }
  if (desc.topRightRadius !== undefined) overrides.topRightRadius = desc.topRightRadius;
  if (desc.bottomRightRadius !== undefined) overrides.bottomRightRadius = desc.bottomRightRadius;
  if (desc.bottomLeftRadius !== undefined) overrides.bottomLeftRadius = desc.bottomLeftRadius;

  if (desc.locked !== undefined) overrides.locked = desc.locked;
  if (desc.blendMode) overrides.blendMode = desc.blendMode;

  // Text — accept both "characters" (INode convention) and "text" (SceneNode convention)
  const textValue = desc.characters ?? desc.text;
  if (textValue !== undefined) overrides.text = textValue;
  if (desc.italic !== undefined) overrides.italic = desc.italic;
  if (desc.textAlignHorizontal) overrides.textAlignHorizontal = desc.textAlignHorizontal;
  if (desc.textAlignVertical) overrides.textAlignVertical = desc.textAlignVertical;
  if (desc.textCase) overrides.textCase = desc.textCase;
  if (desc.textDecoration) overrides.textDecoration = desc.textDecoration;
  if (desc.textTruncation) overrides.textTruncation = desc.textTruncation;
  if (desc.maxLines !== undefined) overrides.maxLines = desc.maxLines;
  if (desc.textAutoResize) overrides.textAutoResize = desc.textAutoResize;
  if (desc.styleRuns) overrides.styleRuns = desc.styleRuns;

  // Token-aware numeric text properties
  const tokenNumProps = ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'] as const;
  for (const prop of tokenNumProps) {
    if (desc[prop] !== undefined) {
      const { value, tokenName } = resolveTokenProp(desc[prop], graph, tokenIndex);
      overrides[prop] = value;
      if (tokenName) bindings.push({ nodeId: '', field: prop, tokenName });
    }
  }

  // Font family (token-aware string)
  if (desc.fontFamily !== undefined) {
    if (typeof desc.fontFamily === 'object' && desc.fontFamily.token && tokenIndex) {
      const varId = tokenIndex.tokens.get(desc.fontFamily.token);
      if (varId) {
        const val = graph.resolveVariable(varId);
        if (typeof val === 'string') {
          overrides.fontFamily = val;
          bindings.push({ nodeId: '', field: 'fontFamily', tokenName: desc.fontFamily.token });
        }
      }
    } else {
      overrides.fontFamily = desc.fontFamily;
    }
  }

  // Auto-estimate text dimensions
  if (nodeType === 'TEXT' && textValue) {
    const fontSize = overrides.fontSize ?? 16;
    const lines = textValue.split('\n');
    const maxLineLen = Math.max(...lines.map((l: string) => l.length));
    if (!desc.width) overrides.width = Math.ceil(maxLineLen * fontSize * 0.55);
    if (!desc.height) overrides.height = Math.ceil(lines.length * fontSize * 1.3);
  }

  // Layout
  if (desc.layoutMode) overrides.layoutMode = desc.layoutMode;
  if (desc.primaryAxisAlign) overrides.primaryAxisAlign = desc.primaryAxisAlign;
  if (desc.counterAxisAlign) overrides.counterAxisAlign = desc.counterAxisAlign;
  if (desc.clipsContent !== undefined) overrides.clipsContent = desc.clipsContent;
  if (desc.layoutGrow !== undefined) overrides.layoutGrow = desc.layoutGrow;
  if (desc.layoutWrap) overrides.layoutWrap = desc.layoutWrap;
  if (desc.layoutAlignSelf) overrides.layoutAlignSelf = desc.layoutAlignSelf;
  if (desc.layoutPositioning) overrides.layoutPositioning = desc.layoutPositioning;
  if (desc.primaryAxisSizing) overrides.primaryAxisSizing = desc.primaryAxisSizing;
  if (desc.counterAxisSizing) overrides.counterAxisSizing = desc.counterAxisSizing;
  if (desc.horizontalConstraint) overrides.horizontalConstraint = desc.horizontalConstraint;
  if (desc.verticalConstraint) overrides.verticalConstraint = desc.verticalConstraint;

  // Size constraints
  if (desc.minWidth !== undefined) overrides.minWidth = desc.minWidth;
  if (desc.maxWidth !== undefined) overrides.maxWidth = desc.maxWidth;
  if (desc.minHeight !== undefined) overrides.minHeight = desc.minHeight;
  if (desc.maxHeight !== undefined) overrides.maxHeight = desc.maxHeight;

  // Grid layout
  if (desc.gridTemplateColumns) overrides.gridTemplateColumns = desc.gridTemplateColumns;
  if (desc.gridTemplateRows) overrides.gridTemplateRows = desc.gridTemplateRows;
  if (desc.gridColumnGap !== undefined) overrides.gridColumnGap = desc.gridColumnGap;
  if (desc.gridRowGap !== undefined) overrides.gridRowGap = desc.gridRowGap;
  if (desc.gridPosition) overrides.gridPosition = {
    column: desc.gridPosition.column,
    row: desc.gridPosition.row,
    columnSpan: desc.gridPosition.columnSpan ?? 1,
    rowSpan: desc.gridPosition.rowSpan ?? 1,
  };

  // Mask
  if (desc.isMask !== undefined) overrides.isMask = desc.isMask;
  if (desc.maskType) overrides.maskType = desc.maskType;

  // Token-aware spacing properties
  const spacingProps = ['itemSpacing', 'counterAxisSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const;
  for (const prop of spacingProps) {
    if (desc[prop] !== undefined) {
      const { value, tokenName } = resolveTokenProp(desc[prop], graph, tokenIndex);
      overrides[prop] = value;
      if (tokenName) bindings.push({ nodeId: '', field: prop, tokenName });
    }
  }

  // Padding uniform shorthand (token-aware)
  if (desc.padding !== undefined) {
    const { value, tokenName } = resolveTokenProp(desc.padding, graph, tokenIndex);
    overrides.paddingTop = value;
    overrides.paddingRight = value;
    overrides.paddingBottom = value;
    overrides.paddingLeft = value;
    if (tokenName) {
      bindings.push({ nodeId: '', field: 'paddingTop', tokenName });
      bindings.push({ nodeId: '', field: 'paddingRight', tokenName });
      bindings.push({ nodeId: '', field: 'paddingBottom', tokenName });
      bindings.push({ nodeId: '', field: 'paddingLeft', tokenName });
    }
  }

  // Semantic
  if (desc.role) overrides.semanticRole = desc.role;
  if (desc.slot) overrides.slot = desc.slot;

  // Behavior — interaction states
  if (desc.states) {
    const states: Record<string, any> = {};
    for (const [stateName, stateProps] of Object.entries(desc.states as Record<string, any>)) {
      const parsed: any = { ...stateProps };
      if (parsed.fills) parsed.fills = parseFills(parsed.fills);
      states[stateName] = parsed;
    }
    overrides.states = states;
  }

  // Behavior — responsive rules
  if (Array.isArray(desc.responsive)) {
    overrides.responsive = desc.responsive.map((rule: any) => ({
      maxWidth: rule.maxWidth,
      props: { ...rule.props },
    }));
  }

  // Validate node type
  const validType = TYPE_MAP[nodeType] ?? nodeType;
  const node = graph.createNode(validType as any, parentId, overrides);

  // Apply deferred token bindings (now we have the node ID)
  if (tokenIndex) {
    for (const b of bindings) {
      bindTokenToNode(graph, tokenIndex, node.id, b.field, b.tokenName);
    }
  }

  // Recursively build children
  if (desc.children) {
    for (const child of desc.children) {
      buildNodeIntoGraph(graph, node.id, child, tokenIndex);
    }
  }

  return node;
}

// ─── Handler ─────────────────────────────────────────────────

export async function handleEdit(input: {
  operations: any[];
  designMd?: string;
  audit?: boolean | { autoFix?: boolean; maxPasses?: number; minFontSize?: number; minContrast?: number };
}) {
  const session = getSession();
  session.recordToolCall('edit');

  // Use explicit designMd, or fall back to session brand
  const effectiveDesignMd = input.designMd ?? session.activeDesignMd ?? undefined;
  const ds = effectiveDesignMd
    ? session.getOrParseDesignMd(effectiveDesignMd, parseDesignMd)
    : undefined;

  const results: string[] = [];
  let lastSceneId: string | undefined;
  const touchedScenes = new Set<string>();

  /** Get token index for the current scene context. */
  function getActiveTokenIndex(sceneId?: string): TokenIndex | undefined {
    const id = sceneId ?? lastSceneId;
    if (!id) return undefined;
    return getTokenIndex(id);
  }

  for (const op of input.operations) {
    switch (op.op) {
      case 'create': {
        // Check if root uses blueprint vocabulary (UI lib types like 'page', 'stack', 'heading')
        const rootType = op.root?.type ?? op.blueprint?.type ?? 'frame';
        const isBlueprintType = !TYPE_MAP[rootType]; // If not in raw INode type map, it's a blueprint type

        if (isBlueprintType || op.blueprint) {
          // ── Blueprint path: resolve UI lib types → build → store ──
          const theme = ds ? fromDesignMd(input.designMd!) : undefined;
          const bpNode = op.blueprint ?? op.root ?? { type: 'page' };
          // Ensure dimensions — default to 1440×900 if not specified
          bpNode.w = op.width ?? bpNode.w ?? bpNode.width ?? 1440;
          bpNode.h = op.height ?? bpNode.h ?? bpNode.height ?? 900;

          let blueprint;
          try {
            blueprint = resolveBlueprint(bpNode, theme);
          } catch (err: any) {
            results.push(`CREATE ERROR: blueprint resolution failed — ${err.message}`);
            break;
          }
          const built = buildBlueprint(blueprint);
          const graph = built.graph;
          const rootId = built.root.id;
          setHost(new StandaloneHost(graph));
          ensureSceneLayout(graph, rootId);

          const root = graph.getNode(rootId)!;
          const sceneName = op.name ?? root.name ?? 'Scene';
          const sceneId = storeScene(graph, rootId, undefined, { name: sceneName });
          lastSceneId = sceneId;
          touchedScenes.add(sceneId);

          const nodeCount = countNodes(graph, rootId);
          session.trackImport(sceneId, sceneName, root.width, root.height, !!ds);
          results.push(`CREATE **${sceneId}** "${sceneName}" ${Math.round(root.width)}×${Math.round(root.height)} — ${nodeCount} nodes (blueprint)`);
        } else {
          // ── Raw INode path (original) ──
          const { SceneGraph: SG } = await import('../../../core/src/engine/scene-graph.js');
          const graph = new SG();
          const page = graph.addPage('Scene');

          let tokenIndex: TokenIndex | undefined;
          if (ds) {
            tokenIndex = tokenizeDesignSystem(graph, ds, { darkMode: false });
          }

          const rootDesc = {
            type: 'frame',
            name: op.name ?? op.root?.name ?? 'Root',
            width: op.width,
            height: op.height,
            ...op.root,
          };
          rootDesc.width = op.width;
          rootDesc.height = op.height;

          const rootNode = buildNodeIntoGraph(graph, page.id, rootDesc, tokenIndex);
          autoDetectRoles(graph, rootNode.id);

          const sceneId = storeScene(graph, rootNode.id, undefined, { name: rootDesc.name });
          if (tokenIndex) setTokenIndex(sceneId, tokenIndex);
          const slug = getScene(sceneId)?.slug ?? sceneId;
          lastSceneId = sceneId;
          touchedScenes.add(sceneId);

          const nodeCount = countNodes(graph, rootNode.id);
          const tokenInfo = tokenIndex ? ` + ${tokenIndex.tokens.size} tokens` : '';
          session.trackImport(sceneId, rootDesc.name, op.width, op.height, !!ds);
          results.push(`CREATE **${sceneId}** (${slug}) "${rootDesc.name}" ${op.width}×${op.height} — ${nodeCount} nodes${tokenInfo}`);
        }
        break;
      }

      case 'add': {
        const sceneId = op.sceneId ?? lastSceneId;
        if (!sceneId) { results.push('ADD ERROR: no scene (create one first)'); break; }
        const stored = getScene(sceneId);
        if (!stored) { results.push(`ADD ERROR: scene "${sceneId}" not found`); break; }

        const parentNode = op.parent
          ? findNode(stored.graph, stored.rootId, op.parent)
          : stored.graph.getNode(stored.rootId);
        if (!parentNode) { results.push(`ADD ERROR: parent "${op.parent}" not found`); break; }

        const newNode = buildNodeIntoGraph(stored.graph, parentNode.id, op.node, getActiveTokenIndex(sceneId));

        // Reorder if 'after' specified
        if (op.after) {
          const siblings = stored.graph.getChildren(parentNode.id);
          const afterIdx = siblings.findIndex(s => s.name === op.after);
          if (afterIdx >= 0) {
            stored.graph.reorderChild(newNode.id, parentNode.id, afterIdx + 1);
          }
        }

        touchedScenes.add(sceneId);
        const childCount = countNodes(stored.graph, newNode.id);
        results.push(`ADD "${newNode.name ?? newNode.type}" to ${op.parent ?? 'root'} — ${childCount} node(s)`);
        break;
      }

      case 'update': {
        const sceneId = op.sceneId ?? lastSceneId;
        if (!sceneId) { results.push('UPDATE ERROR: no scene'); break; }
        const stored = getScene(sceneId);
        if (!stored) { results.push(`UPDATE ERROR: scene "${sceneId}" not found`); break; }

        const target = findNode(stored.graph, stored.rootId, op.path);
        if (!target) { results.push(`UPDATE ERROR: "${op.path}" not found`); break; }

        const tokenIdx = getActiveTokenIndex(sceneId);
        const changes: any = { ...op.props };

        // Handle fills shorthand with token support
        if (changes.fills) {
          const { fills, tokenBindings } = parseFillsWithTokens(changes.fills, stored.graph, tokenIdx);
          changes.fills = fills;
          for (const [idx, tokenName] of tokenBindings) {
            bindTokenToNode(stored.graph, tokenIdx!, target.id, `fills[${idx}].color`, tokenName);
          }
        }

        // Handle token-aware numeric properties
        const tokenNumFields = ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
          'cornerRadius', 'itemSpacing', 'counterAxisSpacing',
          'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const;
        for (const field of tokenNumFields) {
          if (changes[field] !== undefined) {
            const { value, tokenName } = resolveTokenProp(changes[field], stored.graph, tokenIdx);
            changes[field] = value;
            if (tokenName && tokenIdx) {
              bindTokenToNode(stored.graph, tokenIdx, target.id, field, tokenName);
            }
          }
        }

        // Handle padding shorthand
        if (changes.padding !== undefined) {
          const { value, tokenName } = resolveTokenProp(changes.padding, stored.graph, tokenIdx);
          changes.paddingTop = value;
          changes.paddingRight = value;
          changes.paddingBottom = value;
          changes.paddingLeft = value;
          if (tokenName && tokenIdx) {
            for (const side of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) {
              bindTokenToNode(stored.graph, tokenIdx, target.id, side, tokenName);
            }
          }
          delete changes.padding;
        }

        // Handle semantic role
        if (changes.role !== undefined) {
          changes.semanticRole = changes.role;
          delete changes.role;
        }

        // Handle interaction states
        if (changes.states) {
          const states: Record<string, any> = {};
          for (const [stateName, stateProps] of Object.entries(changes.states as Record<string, any>)) {
            const parsed: any = { ...stateProps };
            if (parsed.fills) parsed.fills = parseFills(parsed.fills);
            states[stateName] = parsed;
          }
          changes.states = states;
        }

        stored.graph.updateNode(target.id, changes);
        touchedScenes.add(sceneId);
        results.push(`UPDATE "${target.name}" — ${Object.keys(op.props).join(', ')}`);
        break;
      }

      case 'delete': {
        const sceneId = op.sceneId ?? lastSceneId;
        if (!sceneId) { results.push('DELETE ERROR: no scene'); break; }
        const stored = getScene(sceneId);
        if (!stored) { results.push(`DELETE ERROR: scene "${sceneId}" not found`); break; }

        const target = findNode(stored.graph, stored.rootId, op.path);
        if (!target) { results.push(`DELETE ERROR: "${op.path}" not found`); break; }
        if (target.id === stored.rootId) { results.push('DELETE ERROR: cannot delete root'); break; }

        stored.graph.deleteNode(target.id);
        touchedScenes.add(sceneId);
        results.push(`DELETE "${target.name ?? op.path}"`);
        break;
      }

      case 'clone': {
        const sourceScene = getScene(op.source);
        if (!sourceScene) { results.push(`CLONE ERROR: source "${op.source}" not found`); break; }

        // Deep clone by creating new graph and importing
        const { SceneGraph: SG } = await import('../../../core/src/engine/scene-graph.js');
        const newGraph = new SG();
        const page = newGraph.addPage('Scene');
        deepCloneTree(sourceScene.graph, sourceScene.rootId, newGraph, page.id);
        const newRoot = newGraph.getChildren(page.id)[0];
        if (!newRoot) { results.push('CLONE ERROR: failed'); break; }

        const name = op.name ?? `${sourceScene.name}-copy`;
        newGraph.updateNode(newRoot.id, { name });
        const sceneId = storeScene(newGraph, newRoot.id, undefined, { name });
        const slug = getScene(sceneId)?.slug ?? sceneId;
        lastSceneId = sceneId;
        touchedScenes.add(sceneId);
        session.trackImport(sceneId, name, newRoot.width, newRoot.height, !!ds);
        results.push(`CLONE **${sceneId}** (${slug}) "${name}" from "${op.source}"`);
        break;
      }

      case 'resize': {
        const sceneId = op.sceneId ?? lastSceneId;
        if (!sceneId) { results.push('RESIZE ERROR: no scene'); break; }
        const stored = getScene(sceneId);
        if (!stored) { results.push(`RESIZE ERROR: scene "${sceneId}" not found`); break; }

        stored.graph.updateNode(stored.rootId, { width: op.width, height: op.height });
        touchedScenes.add(sceneId);
        results.push(`RESIZE ${sceneId} → ${op.width}×${op.height}`);
        break;
      }

      case 'move': {
        const sceneId = op.sceneId ?? lastSceneId;
        if (!sceneId) { results.push('MOVE ERROR: no scene'); break; }
        const stored = getScene(sceneId);
        if (!stored) { results.push(`MOVE ERROR: scene "${sceneId}" not found`); break; }

        const node = findNode(stored.graph, stored.rootId, op.path);
        const newParent = findNode(stored.graph, stored.rootId, op.newParent);
        if (!node) { results.push(`MOVE ERROR: "${op.path}" not found`); break; }
        if (!newParent) { results.push(`MOVE ERROR: parent "${op.newParent}" not found`); break; }

        stored.graph.reparentNode(node.id, newParent.id);
        if (op.index !== undefined) {
          stored.graph.reorderChild(node.id, newParent.id, op.index);
        }
        touchedScenes.add(sceneId);
        results.push(`MOVE "${node.name}" → "${newParent.name}"`);
        break;
      }

      case 'defineTokens': {
        const sceneId = op.sceneId ?? lastSceneId;
        if (!sceneId) { results.push('DEFINE_TOKENS ERROR: no scene'); break; }
        const stored = getScene(sceneId);
        if (!stored) { results.push(`DEFINE_TOKENS ERROR: scene "${sceneId}" not found`); break; }

        // Parse DESIGN.md (use op-level or input-level)
        const designMdStr = op.designMd ?? input.designMd ?? session.activeDesignMd;
        if (!designMdStr) { results.push('DEFINE_TOKENS ERROR: designMd required (load with reframe_design first)'); break; }

        const parsedDs = session.getOrParseDesignMd(designMdStr, parseDesignMd);
        const tokenIndex = tokenizeDesignSystem(stored.graph, parsedDs, { darkMode: op.darkMode ?? false });
        const sessId = findSessionId(sceneId);
        if (sessId) setTokenIndex(sessId, tokenIndex);

        const tokenList = listTokens(stored.graph, tokenIndex);
        const colorCount = tokenList.filter(t => t.type === 'COLOR').length;
        const numCount = tokenList.filter(t => t.type === 'FLOAT').length;
        const strCount = tokenList.filter(t => t.type === 'STRING').length;
        const modeCount = stored.graph.variableCollections.get(tokenIndex.collectionId)?.modes.length ?? 1;

        results.push(`DEFINE_TOKENS ${tokenList.length} tokens (${colorCount} colors, ${numCount} numbers, ${strCount} strings, ${modeCount} mode(s))`);
        break;
      }

      case 'adapt': {
        const sceneId = op.sceneId ?? op.source ?? lastSceneId;
        if (!sceneId) { results.push('ADAPT ERROR: no scene'); break; }
        const stored = getScene(sceneId);
        if (!stored) { results.push(`ADAPT ERROR: scene "${sceneId}" not found`); break; }
        const tw = op.width ?? op.targetWidth;
        const th = op.height ?? op.targetHeight;
        if (!tw || !th) { results.push('ADAPT ERROR: width and height required'); break; }
        const strategy = op.strategy ?? 'smart';
        const sceneName = op.name ?? `${stored.name}-${tw}x${th}`;
        try {
          // Smart resize engine: semantic classification → layout profile → cluster scale → guide postprocess
          // Returns { root: INode, graph: SceneGraph, semanticTypes, layoutProfile, stats }
          const adapted = await adaptFromGraph(stored.graph, stored.rootId, tw, th, {
            strategy: strategy as any,
            designSystem: ds ?? undefined,
            preserveProportions: true,
          });
          const newId = storeScene(adapted.graph, adapted.root.id, undefined, { name: sceneName });
          lastSceneId = newId;
          touchedScenes.add(newId);
          const guide = adapted.stats.usedGuide ? `, guide: ${adapted.stats.guideKey}` : '';
          const layout = adapted.layoutProfile ? `, layout: ${adapted.layoutProfile.layoutClass}` : '';
          results.push(`ADAPT → **${newId}** "${sceneName}" ${tw}×${th} (${strategy}${guide}${layout}, ${adapted.stats.durationMs}ms)`);
        } catch (err: any) {
          results.push(`ADAPT ERROR: ${err.message}`);
        }
        break;
      }

      case 'component': {
        const sceneId = op.sceneId ?? lastSceneId;
        if (!sceneId) { results.push('COMPONENT ERROR: no scene'); break; }
        const stored = getScene(sceneId);
        if (!stored) { results.push(`COMPONENT ERROR: scene "${sceneId}" not found`); break; }
        const registry = new ComponentRegistry(stored.graph);
        const action = op.action ?? op.componentAction;
        switch (action) {
          case 'define': {
            if (!op.nodeId) { results.push('COMPONENT ERROR: nodeId required'); break; }
            const compId = registry.defineComponent(op.nodeId, op.name);
            const compNode = stored.graph.getNode(compId);
            results.push(`COMPONENT → defined "${compNode?.name ?? op.name}" (${compId})`);
            break;
          }
          case 'instantiate': {
            const cId = op.componentId ?? (op.componentName ? registry.getComponentByName(op.componentName)?.id : undefined);
            if (!cId) { results.push('COMPONENT ERROR: componentId or componentName required'); break; }
            const instId = registry.createInstance(cId, op.parentId ?? stored.rootId, {
              variant: op.variant, x: op.x, y: op.y,
            });
            const instNode = stored.graph.getNode(instId);
            results.push(`COMPONENT → instance "${instNode?.name ?? 'Instance'}" (${instId})`);
            break;
          }
          case 'override': {
            if (!op.nodeId || !op.overrides) { results.push('COMPONENT ERROR: nodeId + overrides required'); break; }
            registry.setOverrides(op.nodeId, op.overrides);
            results.push(`COMPONENT → overrides applied to ${op.nodeId}`);
            break;
          }
          case 'propagate': {
            if (!op.componentId) { results.push('COMPONENT ERROR: componentId required'); break; }
            const count = registry.propagateChanges(op.componentId);
            results.push(`COMPONENT → propagated to ${count} instance(s)`);
            break;
          }
          case 'detach': {
            if (!op.nodeId) { results.push('COMPONENT ERROR: nodeId required'); break; }
            registry.detachInstance(op.nodeId);
            results.push(`COMPONENT → detached ${op.nodeId}`);
            break;
          }
          case 'list': {
            const comps = registry.listComponents();
            results.push(`COMPONENT → ${comps.length} components: ${comps.map(c => c.name).join(', ') || 'none'}`);
            break;
          }
          default:
            results.push(`COMPONENT ERROR: unknown action "${action}"`);
        }
        touchedScenes.add(sceneId);
        break;
      }

      case 'setMode': {
        const sceneId = op.sceneId ?? lastSceneId;
        if (!sceneId) { results.push('SET_MODE ERROR: no scene'); break; }
        const stored = getScene(sceneId);
        if (!stored) { results.push(`SET_MODE ERROR: scene "${sceneId}" not found`); break; }

        const tokenIdx = getActiveTokenIndex(sceneId);
        if (!tokenIdx) { results.push('SET_MODE ERROR: no tokens defined (run defineTokens first)'); break; }

        const modeId = switchTokenMode(stored.graph, tokenIdx, op.mode);
        if (!modeId) {
          const collection = stored.graph.variableCollections.get(tokenIdx.collectionId);
          const available = collection?.modes.map(m => m.name).join(', ') ?? 'none';
          results.push(`SET_MODE ERROR: mode "${op.mode}" not found. Available: ${available}`);
          break;
        }

        // Re-resolve all token-bound properties on all nodes
        const reResolved = reResolveTokenBindings(stored.graph, stored.rootId, tokenIdx);
        touchedScenes.add(sceneId);
        results.push(`SET_MODE → "${op.mode}" — ${reResolved} properties updated`);
        break;
      }
    }
  }

  // ── Yoga layout — without this, nodes keep default 100×100 and Studio HTML preview collapses
  for (const sceneId of touchedScenes) {
    const stored = getScene(sceneId);
    if (!stored) continue;
    ensureSceneLayout(stored.graph, stored.rootId);
  }

  // ── Auto-audit touched scenes ──────────────────────────────
  const auditConfig = input.audit;
  const auditResults: string[] = [];

  if (auditConfig !== false) {
    const opts = typeof auditConfig === 'object' ? auditConfig : {};

    for (const sceneId of touchedScenes) {
      const stored = getScene(sceneId);
      if (!stored) continue;

      const minFS = opts.minFontSize ?? 8;
      const minCR = opts.minContrast ?? 3;
      const rules = buildInspectAuditRules(ds as any, { minFontSize: minFS, minContrast: minCR });

      const { finalIssues, allFixed, passCount } = runAutoFixLoop(
        stored.graph, stored.rootId,
        () => {
          setHost(new StandaloneHost(stored.graph));
          const root = new StandaloneNode(stored.graph, stored.graph.getNode(stored.rootId)!);
          // Pass token-bound fields to audit for auto-pass on palette checks
          const tokenIdx = getActiveTokenIndex(sceneId);
          const tokenOpts = tokenIdx ? {
            getTokenBoundFields: (nodeId: string) => {
              const node = stored.graph.getNode(nodeId);
              if (!node || Object.keys(node.boundVariables).length === 0) return undefined;
              const fields = new Set<string>();
              for (const [field, varId] of Object.entries(node.boundVariables)) {
                const v = stored.graph.variables.get(varId);
                if (v && v.collectionId === tokenIdx.collectionId) fields.add(field);
              }
              return fields.size > 0 ? fields : undefined;
            },
          } : undefined;
          return audit(root, rules, ds as any, tokenOpts);
        },
        { autoFix: opts.autoFix !== false, maxPasses: opts.maxPasses ?? 3 },
      );

      const passed = finalIssues.filter(i => i.severity === 'error').length === 0;
      session.recordAudit({
        sceneId,
        sceneName: stored.name,
        timestamp: Date.now(),
        issueCount: finalIssues.length,
        fixCount: allFixed.length,
        passed,
        rules: finalIssues.map(i => i.rule),
      });

      if (allFixed.length > 0 || finalIssues.length > 0) {
        const fixInfo = allFixed.length > 0 ? `${allFixed.length} auto-fixed` : '';
        const issueInfo = finalIssues.length > 0 ? `${finalIssues.length} remaining` : '';
        const parts = [fixInfo, issueInfo].filter(Boolean).join(', ');
        auditResults.push(`  ${sceneId}: ${passed ? 'PASS' : 'ISSUES'} (${parts})`);
        for (const issue of finalIssues) {
          auditResults.push(`    [${issue.severity}] ${issue.rule}: ${issue.message}`);
        }
      } else {
        auditResults.push(`  ${sceneId}: PASS (${rules.length} rules, clean)`);
      }
    }
  }

  for (const sceneId of touchedScenes) {
    bumpSceneSessionRevision(sceneId);
  }

  // ── Build response with context ────────────────────────────
  const lines: string[] = [];

  lines.push(`## Draw — ${input.operations.length} operation(s)`);
  lines.push('');
  for (const r of results) lines.push(`- ${r}`);

  if (auditResults.length > 0) {
    lines.push('');
    lines.push('### Audit');
    for (const r of auditResults) lines.push(r);
  }

  // Context footer — scene state + recommendations
  lines.push('');
  lines.push('---');
  const scenes = [...touchedScenes].map(id => {
    const s = getScene(id);
    if (!s) return null;
    const root = s.graph.getNode(s.rootId);
    return `**${id}** (${s.slug}) "${s.name}" ${root ? Math.round(root.width) + '×' + Math.round(root.height) : '?'}`;
  }).filter(Boolean);
  if (scenes.length > 0) {
    lines.push(`Active: ${scenes.join(' | ')}`);
  }

  if (lastSceneId) {
    lines.push(`Next: reframe_inspect({ sceneId: "${lastSceneId}" })`);
  }

  return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
}

// ─── Helpers ─────────────────────────────────────────────────

function countNodes(graph: SceneGraph, id: string): number {
  const node = graph.getNode(id);
  if (!node) return 0;
  let count = 1;
  for (const childId of node.childIds) count += countNodes(graph, childId);
  return count;
}

/**
 * Re-resolve all token bindings in a subtree after a mode switch.
 * Updates node properties to match the new active mode values.
 */
function reResolveTokenBindings(graph: SceneGraph, rootId: string, tokenIndex: TokenIndex): number {
  let count = 0;

  function walk(nodeId: string) {
    const node = graph.getNode(nodeId);
    if (!node) return;

    for (const [field, varId] of Object.entries(node.boundVariables)) {
      const variable = graph.variables.get(varId);
      if (!variable || variable.collectionId !== tokenIndex.collectionId) continue;

      const value = graph.resolveVariable(varId);
      if (value === undefined) continue;

      // Apply resolved value to the node
      if (field.startsWith('fills[') && field.includes('.color')) {
        // Color binding → update fill
        const match = field.match(/fills\[(\d+)\]/);
        if (match && typeof value === 'object' && 'r' in value) {
          const idx = parseInt(match[1], 10);
          const fills = [...(node.fills || [])];
          if (fills[idx]) {
            fills[idx] = { ...fills[idx], color: value as any };
            graph.updateNode(nodeId, { fills });
            count++;
          }
        }
      } else if (typeof value === 'number') {
        graph.updateNode(nodeId, { [field]: value });
        count++;
      } else if (typeof value === 'string') {
        graph.updateNode(nodeId, { [field]: value });
        count++;
      }
    }

    for (const childId of node.childIds) walk(childId);
  }

  walk(rootId);
  return count;
}

function deepCloneTree(src: SceneGraph, srcId: string, dest: SceneGraph, destParentId: string): void {
  const node = src.getNode(srcId);
  if (!node) return;

  const overrides: any = {};
  // Copy all properties except structural ones
  for (const [k, v] of Object.entries(node)) {
    if (['id', 'parentId', 'childIds'].includes(k)) continue;
    overrides[k] = v;
  }

  const cloned = dest.createNode(node.type as any, destParentId, overrides);
  for (const childId of node.childIds) {
    deepCloneTree(src, childId, dest, cloned.id);
  }
}
