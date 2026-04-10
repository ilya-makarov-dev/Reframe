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
import { storeScene, getScene, resolveScene, setTokenIndex, getTokenIndex, findSessionId, bumpSceneSessionRevision, getWorkspaceRoot } from '../store.js';
import { coreProjectIo } from '../project-io.js';
import { autoSaveScene } from './project.js';
import { exportScene, inspectScene } from '../engine.js';
import { getSession } from '../session.js';
import { parseDesignMd } from '../../../core/src/design-system/index.js';
import {
  tokenizeDesignSystem, resolveColorToken, resolveNumberToken,
  bindTokenToNode, autoBindTokensFromGraph, switchTokenMode, listTokens, colorToHex,
  rebuildTokenIndexFromGraph,
  type TokenIndex,
} from '../../../core/src/design-system/tokens.js';
import { autoDetectRoles, classifyScene } from '../../../core/src/semantic/index.js';
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

  // Update node(s) by semantic role — addresses content by meaning instead of nodeId.
  // Requires the scene to have been classified (compile auto-classifies; otherwise
  // updateSlot lazy-classifies on first call). Lookup walks the tree in DFS order
  // and matches every node whose semanticRole equals `role`. Optional `index` picks
  // the Nth match (zero-based); optional `textContains` filters to nodes whose text
  // contains the substring (case-insensitive). Without index/textContains, props
  // apply to ALL matching nodes — useful for bulk operations like "make every CTA
  // slightly smaller" or "raise contrast on every caption".
  z.object({
    op: z.literal('updateSlot'),
    sceneId: z.string().optional(),
    role: z.string().describe('Semantic role: heading | button | caption | section | hero | logo | nav | footer | cta | etc.'),
    index: z.number().int().nonnegative().optional()
      .describe('Pick the Nth match (zero-based). Omit to update all matches.'),
    textContains: z.string().optional()
      .describe('Filter to matches whose text contains this substring (case-insensitive).'),
    props: z.record(z.any()).describe('Properties to update (same shape as update.props)'),
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

/**
 * Find every node whose semanticRole matches `role`, in DFS order.
 *
 * Optional filters:
 *   - `textContains` — keep only nodes whose .text or first TEXT-child .text
 *      contains the substring (case-insensitive). Useful when several nodes
 *      share a role and the caller wants to disambiguate by content.
 *   - `index` — picks the Nth match (zero-based). Applied AFTER textContains.
 *
 * Returns a list because slot updates are bulk-friendly: omitting filters
 * means "all matches" (e.g. "raise contrast on every caption").
 */
/**
 * When updateSlot returns zero matches, scan the whole graph for the
 * textContains needle and return a histogram of the semantic roles that
 * actually contain it. The classifier sometimes flips a TEXT node between
 * two plausible roles (heading vs paragraph for a short line); instead of
 * making the agent retry each role by hand, show where the text really
 * lives so it can reissue the edit with the correct role.
 */
function rolesContainingText(
  graph: SceneGraph,
  rootId: string,
  needle: string,
): Map<string, number> {
  const n = needle.toLowerCase();
  const hits = new Map<string, number>();
  const walk = (id: string) => {
    const node = graph.getNode(id);
    if (!node) return;
    const role = (node as any).semanticRole as string | undefined;
    if (role) {
      const ownText = node.type === 'TEXT' ? (node.text ?? '') : '';
      let matched = ownText.toLowerCase().includes(n);
      if (!matched) {
        // Walk descendants looking for TEXT children with matching content.
        const inner = (cid: string): boolean => {
          const c = graph.getNode(cid);
          if (!c) return false;
          if (c.type === 'TEXT' && c.text && c.text.toLowerCase().includes(n)) return true;
          for (const gcid of c.childIds) {
            if (inner(gcid)) return true;
          }
          return false;
        };
        for (const cid of node.childIds) {
          if (inner(cid)) { matched = true; break; }
        }
      }
      if (matched) {
        hits.set(role, (hits.get(role) ?? 0) + 1);
      }
    }
    for (const cid of node.childIds) walk(cid);
  };
  walk(rootId);
  return hits;
}

function findBySlot(
  graph: SceneGraph,
  rootId: string,
  role: string,
  filters: { index?: number; textContains?: string } = {},
): SceneNode[] {
  const matches: SceneNode[] = [];
  const walk = (id: string) => {
    const n = graph.getNode(id);
    if (!n) return;
    if ((n as any).semanticRole === role) matches.push(n);
    for (const cid of n.childIds) walk(cid);
  };
  walk(rootId);

  let filtered = matches;
  if (filters.textContains) {
    const needle = filters.textContains.toLowerCase();
    filtered = filtered.filter(n => {
      const ownText = n.type === 'TEXT' ? n.text : null;
      if (ownText && ownText.toLowerCase().includes(needle)) return true;
      // Also try first TEXT descendant — slot is often a wrapper FRAME
      // tagged as 'button' with the label text inside.
      let found = false;
      const inner = (id: string) => {
        if (found) return;
        const c = graph.getNode(id);
        if (!c) return;
        if (c.type === 'TEXT' && c.text && c.text.toLowerCase().includes(needle)) {
          found = true; return;
        }
        for (const ccid of c.childIds) inner(ccid);
      };
      for (const cid of n.childIds) inner(cid);
      return found;
    });
  }
  if (filters.index !== undefined) {
    const picked = filtered[filters.index];
    filtered = picked ? [picked] : [];
  }
  return filtered;
}

/**
 * Apply an update-style props patch to a single node, with the same
 * sanitization, token resolution, fills shorthand, and semantic-role
 * mapping that the `update` op uses. Used by both `update` (single
 * target) and `updateSlot` (one or many targets).
 *
 * Returns the list of sanitisation warnings the caller can attach to
 * its result line. Mutates `propsCopy` in place during sanitisation —
 * pass a fresh copy per node when calling for multiple targets.
 */
function applyNodeUpdate(
  graph: SceneGraph,
  target: SceneNode,
  propsInput: Record<string, any>,
  tokenIdx: TokenIndex | undefined,
): { warnings: string[]; appliedKeys: string[] } {
  const changes: any = { ...propsInput };
  const sanitizeWarnings: string[] = [];
  const clampInPlace = (key: string, min: number, max: number) => {
    if (changes[key] === undefined || changes[key] === null) return;
    if (typeof changes[key] !== 'number' || !Number.isFinite(changes[key])) {
      sanitizeWarnings.push(`${key} must be a finite number`);
      delete changes[key];
      return;
    }
    if (changes[key] < min || changes[key] > max) {
      const original = changes[key];
      changes[key] = Math.min(Math.max(changes[key], min), max);
      sanitizeWarnings.push(`${key} ${original} → ${changes[key]} (clamped to [${min}, ${max}])`);
    }
  };
  clampInPlace('opacity', 0, 1);
  clampInPlace('rotation', -360, 360);
  clampInPlace('width', 0, 16384);
  clampInPlace('height', 0, 16384);
  clampInPlace('minWidth', 0, 16384);
  clampInPlace('minHeight', 0, 16384);
  clampInPlace('maxWidth', 0, 16384);
  clampInPlace('maxHeight', 0, 16384);
  for (const k of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'padding', 'itemSpacing', 'counterAxisSpacing']) {
    if (typeof changes[k] === 'number' && changes[k] < 0) {
      sanitizeWarnings.push(`${k} ${changes[k]} → 0 (negative spacing not allowed)`);
      changes[k] = 0;
    }
  }
  for (const k of ['cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius']) {
    if (typeof changes[k] === 'number' && changes[k] < 0) {
      sanitizeWarnings.push(`${k} ${changes[k]} → 0 (negative radius not allowed)`);
      changes[k] = 0;
    }
  }
  if (Array.isArray(changes.fills)) {
    for (const f of changes.fills) {
      if (f && typeof f === 'object' && f.color && typeof f.color === 'object') {
        for (const ch of ['r', 'g', 'b', 'a'] as const) {
          if (typeof f.color[ch] === 'number' && (f.color[ch] < 0 || f.color[ch] > 1)) {
            const orig = f.color[ch];
            f.color[ch] = Math.min(Math.max(f.color[ch], 0), 1);
            sanitizeWarnings.push(`fill.color.${ch} ${orig} → ${f.color[ch]} (clamped to [0,1])`);
          }
        }
      }
    }
  }

  if (changes.fills) {
    const { fills, tokenBindings } = parseFillsWithTokens(changes.fills, graph, tokenIdx);
    changes.fills = fills;
    for (const [idx, tokenName] of tokenBindings) {
      bindTokenToNode(graph, tokenIdx!, target.id, `fills[${idx}].color`, tokenName);
    }
  }

  const tokenNumFields = ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
    'cornerRadius', 'itemSpacing', 'counterAxisSpacing',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const;
  for (const field of tokenNumFields) {
    if (changes[field] !== undefined) {
      const { value, tokenName } = resolveTokenProp(changes[field], graph, tokenIdx);
      changes[field] = value;
      if (tokenName && tokenIdx) {
        bindTokenToNode(graph, tokenIdx, target.id, field, tokenName);
      }
    }
  }

  if (changes.padding !== undefined) {
    const { value, tokenName } = resolveTokenProp(changes.padding, graph, tokenIdx);
    changes.paddingTop = value;
    changes.paddingRight = value;
    changes.paddingBottom = value;
    changes.paddingLeft = value;
    if (tokenName && tokenIdx) {
      for (const side of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) {
        bindTokenToNode(graph, tokenIdx, target.id, side, tokenName);
      }
    }
    delete changes.padding;
  }

  if (changes.role !== undefined) {
    changes.semanticRole = changes.role;
    delete changes.role;
  }

  if (changes.states) {
    const states: Record<string, any> = {};
    for (const [stateName, stateProps] of Object.entries(changes.states as Record<string, any>)) {
      const parsed: any = { ...stateProps };
      if (parsed.fills) parsed.fills = parseFills(parsed.fills);
      states[stateName] = parsed;
    }
    changes.states = states;
  }

  graph.updateNode(target.id, changes);
  return { warnings: sanitizeWarnings, appliedKeys: Object.keys(propsInput) };
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

  // Use explicit designMd, or fall back to session brand, or last-resort to
  // project.json's activeBrand. The session singleton may be empty if the
  // process forked between extract and edit (MCP stdio harness behavior),
  // in which case the persisted brand on disk is the source of truth.
  let effectiveDesignMd = input.designMd ?? session.activeDesignMd ?? undefined;
  if (!effectiveDesignMd) {
    try {
      const projectDir = getWorkspaceRoot();
      const manifest = coreProjectIo().loadProject(projectDir);
      if (manifest.activeBrand) {
        const loaded = coreProjectIo().loadBrandFromProject(projectDir, manifest.activeBrand);
        if (loaded) {
          effectiveDesignMd = loaded.content;
          const ds2 = session.getOrParseDesignMd(loaded.content, parseDesignMd);
          session.setBrand(manifest.activeBrand, loaded.content, ds2);
        }
      }
    } catch { /* best-effort */ }
  }
  const ds = effectiveDesignMd
    ? session.getOrParseDesignMd(effectiveDesignMd, parseDesignMd)
    : undefined;

  const results: string[] = [];
  let lastSceneId: string | undefined;
  const touchedScenes = new Set<string>();
  /** Resize ops record their final dims here so the post-audit sync can re-pin
   *  stored.width/height from the explicit user value, ignoring whatever Yoga
   *  recomputed during ensureSceneLayout / runAutoFixLoop. */
  const resizedScenes = new Map<string, { width: number; height: number }>();

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
        const { warnings, appliedKeys } = applyNodeUpdate(stored.graph, target, op.props, tokenIdx);
        touchedScenes.add(sceneId);
        const warnSuffix = warnings.length > 0 ? ` [sanitized: ${warnings.join('; ')}]` : '';
        results.push(`UPDATE "${target.name}" — ${appliedKeys.join(', ')}${warnSuffix}`);
        break;
      }

      case 'updateSlot': {
        const sceneId = op.sceneId ?? lastSceneId;
        if (!sceneId) { results.push('UPDATE_SLOT ERROR: no scene'); break; }
        const stored = getScene(sceneId);
        if (!stored) { results.push(`UPDATE_SLOT ERROR: scene "${sceneId}" not found`); break; }

        // Text-prop routing helper. The matched slot is often a wrapper FRAME
        // (button, card, hero) whose visible text lives on an inner TEXT node.
        // When the agent passes text-only props like `text` or `fontSize`, we
        // re-route those to the first TEXT descendant and keep container-only
        // props on the wrapper. Without this, "updateSlot button text='Buy'"
        // would silently land `text: 'Buy'` on a div that doesn't render text.
        const TEXT_ONLY_PROPS = new Set([
          'text', 'characters', 'fontSize', 'fontFamily', 'fontWeight',
          'fontName', 'lineHeight', 'letterSpacing', 'italic',
          'textAlignHorizontal', 'textAlignVertical', 'textCase', 'textDecoration',
          'textTruncation', 'maxLines',
        ]);
        const findFirstTextDescendant = (graph: SceneGraph, nodeId: string): SceneNode | null => {
          const seen = new Set<string>();
          const stack = [nodeId];
          while (stack.length > 0) {
            const id = stack.pop()!;
            if (seen.has(id)) continue;
            seen.add(id);
            const n = graph.getNode(id);
            if (!n) continue;
            if (n.id !== nodeId && n.type === 'TEXT') return n;
            for (const cid of n.childIds) stack.push(cid);
          }
          return null;
        };
        const splitProps = (props: Record<string, any>) => {
          const textProps: Record<string, any> = {};
          const containerProps: Record<string, any> = {};
          for (const [k, v] of Object.entries(props)) {
            if (TEXT_ONLY_PROPS.has(k)) textProps[k] = v;
            else containerProps[k] = v;
          }
          return { textProps, containerProps };
        };

        // Make sure scene has been classified. If readSemanticSkeleton finds
        // nothing tagged we lazy-classify so updateSlot works on imported
        // scenes that bypassed reframe_compile. This is the same lazy path
        // inspect uses; safe to call repeatedly (idempotent).
        const probe = findBySlot(stored.graph, stored.rootId, op.role, {});
        if (probe.length === 0) {
          try {
            await classifyScene(stored.graph, stored.rootId, {
              designSystem: ds as any,
              multiSlot: true,
            });
          } catch (err: any) {
            results.push(`UPDATE_SLOT ERROR: classification failed — ${err?.message ?? err}`);
            break;
          }
        }

        const matches = findBySlot(stored.graph, stored.rootId, op.role, {
          index: op.index,
          textContains: op.textContains,
        });

        if (matches.length === 0) {
          // Be helpful: list which roles ARE present so the agent can correct.
          const roleHistogram = new Map<string, number>();
          const walk = (id: string) => {
            const n = stored.graph.getNode(id);
            if (!n) return;
            if ((n as any).semanticRole) {
              roleHistogram.set((n as any).semanticRole, (roleHistogram.get((n as any).semanticRole) ?? 0) + 1);
            }
            for (const cid of n.childIds) walk(cid);
          };
          walk(stored.rootId);
          const available = [...roleHistogram].map(([r, n]) => `${r}=${n}`).join(', ');
          const filterDesc = [
            op.textContains ? `textContains="${op.textContains}"` : null,
            op.index !== undefined ? `index=${op.index}` : null,
          ].filter(Boolean).join(', ');
          // If the caller passed textContains, tell them which role actually
          // has that text so they can retry with the right slot name.
          let hint = '';
          if (op.textContains) {
            const hits = rolesContainingText(stored.graph, stored.rootId, op.textContains);
            if (hits.size > 0) {
              const parts = [...hits].map(([r, n]) => `${r}=${n}`).join(', ');
              hint = `. Text "${op.textContains}" found in: ${parts}`;
            } else {
              hint = `. Text "${op.textContains}" not found in any tagged node`;
            }
          }
          results.push(
            `UPDATE_SLOT ERROR: no nodes match role="${op.role}"` +
            (filterDesc ? ` (${filterDesc})` : '') +
            (available ? `. Available roles: ${available}` : '. Scene has no semantic tags — run reframe_compile first.') +
            hint
          );
          break;
        }

        const tokenIdx = getActiveTokenIndex(sceneId);
        const allWarnings: string[] = [];
        const updatedNames: string[] = [];
        const { textProps, containerProps } = splitProps(op.props);
        const hasTextProps = Object.keys(textProps).length > 0;
        const hasContainerProps = Object.keys(containerProps).length > 0;

        for (const target of matches) {
          // For text-only props, route to the matched node directly if it
          // already IS a TEXT node, otherwise to its first TEXT descendant.
          // For container props, always apply to the matched node itself.
          if (hasTextProps) {
            const textTarget = target.type === 'TEXT'
              ? target
              : findFirstTextDescendant(stored.graph, target.id);
            if (textTarget) {
              const { warnings } = applyNodeUpdate(stored.graph, textTarget, { ...textProps }, tokenIdx);
              allWarnings.push(...warnings);
            } else {
              allWarnings.push(`no TEXT descendant under "${target.name}" — text props skipped`);
            }
          }
          if (hasContainerProps) {
            const { warnings } = applyNodeUpdate(stored.graph, target, { ...containerProps }, tokenIdx);
            allWarnings.push(...warnings);
          }
          updatedNames.push(target.name ?? target.id);
        }
        touchedScenes.add(sceneId);
        const filterDesc = [
          op.textContains ? `text~"${op.textContains}"` : null,
          op.index !== undefined ? `[${op.index}]` : null,
        ].filter(Boolean).join(' ');
        const warnSuffix = allWarnings.length > 0 ? ` [sanitized: ${allWarnings.join('; ')}]` : '';
        const targetSummary = matches.length === 1
          ? `"${updatedNames[0]}"`
          : `${matches.length} matches: ${updatedNames.slice(0, 3).map(n => `"${n}"`).join(', ')}${matches.length > 3 ? ` …` : ''}`;
        results.push(`UPDATE_SLOT [${op.role}${filterDesc ? ' ' + filterDesc : ''}] ${targetSummary} — ${Object.keys(op.props).join(', ')}${warnSuffix}`);
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

        // Guard against nonsense values: negatives, zero, and DoS-sized dims.
        const MIN = 1;
        const MAX = 16384;
        const w = typeof op.width === 'number' ? op.width : NaN;
        const h = typeof op.height === 'number' ? op.height : NaN;
        if (!Number.isFinite(w) || !Number.isFinite(h)) {
          results.push(`RESIZE ERROR: width and height must be finite numbers (got ${op.width}×${op.height})`);
          break;
        }
        if (w < MIN || h < MIN) {
          results.push(`RESIZE ERROR: width/height must be >= ${MIN} (got ${w}×${h})`);
          break;
        }
        const cw = Math.min(w, MAX);
        const ch = Math.min(h, MAX);
        // Force FIXED sizing on the root so the post-audit Yoga pass cannot
        // shrink the user's explicit canvas back to the natural content size.
        // Without this, resizing a HUG-sized imported scene from 1440 → 16384
        // updates the graph node, but ensureSceneLayout immediately runs Yoga
        // which computes the HUG width from children (= 1440) and writes it
        // back via applyFrameSize → graph.updateNode. The Active footer reads
        // a stale snapshot and reports 16384, while listScenes' next call
        // reads the post-Yoga graph and reports 1440. Pinning sizing fixes
        // both views consistently.
        stored.graph.updateNode(stored.rootId, {
          width: cw,
          height: ch,
          primaryAxisSizing: 'FIXED',
          counterAxisSizing: 'FIXED',
        });
        // Sync the StoredScene's cached dimensions so listScenes / session
        // overview / project event consumers see the new size.
        stored.width = cw;
        stored.height = ch;
        stored.sessionRevision = (stored.sessionRevision ?? 0) + 1;
        const sessId = findSessionId(sceneId) ?? sceneId;
        try { bumpSceneSessionRevision(sessId); } catch {}
        try { session.trackImport(sessId, stored.name, cw, ch, !!ds); } catch {}
        // Mark this scene as having been hard-resized so the post-loop sync
        // can rewrite stored.width from cw rather than reading the graph
        // (which the auto-audit may have re-run Yoga on).
        resizedScenes.set(sceneId, { width: cw, height: ch });
        touchedScenes.add(sceneId);
        const clamped = (cw !== w || ch !== h) ? ` (clamped from ${w}×${h})` : '';
        results.push(`RESIZE ${sceneId} → ${cw}×${ch}${clamped}`);
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
        if (node.id === newParent.id) {
          results.push(`MOVE ERROR: cannot reparent "${node.name}" into itself`);
          break;
        }
        if (node.id === stored.rootId) {
          results.push('MOVE ERROR: cannot move the scene root');
          break;
        }
        // Cycle detection — refuse if newParent is a descendant of node.
        // Without this `move A→B; move B→A` silently invalidates the tree
        // (B is now under A, then A becomes child of B → orphan cycle).
        const isDescendantOfNode = (() => {
          let c: SceneNode | undefined = newParent;
          while (c) {
            if (c.id === node.id) return true;
            c = c.parentId ? stored.graph.getNode(c.parentId) : undefined;
          }
          return false;
        })();
        if (isDescendantOfNode) {
          results.push(`MOVE ERROR: would create cycle ("${newParent.name}" is a descendant of "${node.name}")`);
          break;
        }

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
        // Order: per-op explicit → call-level explicit → resolved effective
        // (session + project.json fallback computed at top of handler).
        const designMdStr = op.designMd ?? input.designMd ?? effectiveDesignMd ?? session.activeDesignMd;
        if (!designMdStr) { results.push('DEFINE_TOKENS ERROR: designMd required (load with reframe_design first)'); break; }

        const parsedDs = session.getOrParseDesignMd(designMdStr, parseDesignMd);
        const tokenIndex = tokenizeDesignSystem(stored.graph, parsedDs, { darkMode: op.darkMode ?? false });
        const sessId = findSessionId(sceneId);
        if (sessId) setTokenIndex(sessId, tokenIndex);

        // Auto-bind every node property whose value matches a token. Without
        // this defineTokens registers tokens but no node references them, so
        // a subsequent setMode call walks an empty bindings table and reports
        // "0 properties updated" — defeating the entire token system.
        const boundCount = autoBindTokensFromGraph(stored.graph, stored.rootId, tokenIndex);

        const tokenList = listTokens(stored.graph, tokenIndex);
        const colorCount = tokenList.filter(t => t.type === 'COLOR').length;
        const numCount = tokenList.filter(t => t.type === 'FLOAT').length;
        const strCount = tokenList.filter(t => t.type === 'STRING').length;
        const modeCount = stored.graph.variableCollections.get(tokenIndex.collectionId)?.modes.length ?? 1;

        touchedScenes.add(sceneId);
        results.push(`DEFINE_TOKENS ${tokenList.length} tokens (${colorCount} colors, ${numCount} numbers, ${strCount} strings, ${modeCount} mode(s)) — ${boundCount} bindings`);
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

        // Lookup order:
        //   1. In-memory sidecar TokenIndex from the current session.
        //   2. Rebuild from `graph.variableCollections` — works when
        //      the graph's variables survived serialization (currently
        //      they don't, but this is the right place for the future
        //      format upgrade that includes them).
        //   3. Auto-run `defineTokens` from the active design system —
        //      this is the path that actually unblocks MCP sessions
        //      where scenes got rehydrated without their token sidecar.
        //      The call is idempotent (same DS → same tokens) so it
        //      doesn't harm re-invocations.
        let tokenIdx = getActiveTokenIndex(sceneId);
        if (!tokenIdx) {
          tokenIdx = rebuildTokenIndexFromGraph(stored.graph);
        }
        if (!tokenIdx) {
          const designMdStr = input.designMd ?? effectiveDesignMd ?? session.activeDesignMd;
          if (designMdStr) {
            try {
              const parsedDs = session.getOrParseDesignMd(designMdStr, parseDesignMd);
              tokenIdx = tokenizeDesignSystem(stored.graph, parsedDs, { darkMode: true });
              autoBindTokensFromGraph(stored.graph, stored.rootId, tokenIdx);
            } catch { /* best-effort */ }
          }
        }
        if (tokenIdx) {
          const sessId = findSessionId(sceneId);
          if (sessId) setTokenIndex(sessId, tokenIdx);
        }
        if (!tokenIdx) { results.push('SET_MODE ERROR: no tokens defined (run defineTokens first, or pass designMd / activate a brand)'); break; }

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

  // Re-pin user-resized scenes after the auto-audit. The audit's runAutoFixLoop
  // re-runs Yoga internally, which on a HUG-rooted scene reverts the explicit
  // resize back to the natural content size. Since the user explicitly asked
  // for this canvas, force-write both the cached metadata and the live graph
  // node to the requested dimensions one last time.
  for (const [sceneId, dims] of resizedScenes) {
    const stored = getScene(sceneId);
    if (!stored) continue;
    stored.graph.updateNode(stored.rootId, {
      width: dims.width,
      height: dims.height,
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
    });
    stored.width = dims.width;
    stored.height = dims.height;
  }

  for (const sceneId of touchedScenes) {
    bumpSceneSessionRevision(sceneId);
  }

  // Persist every mutated scene to .reframe/scenes/<slug>.scene.json so the
  // edits survive across MCP transport process boundaries. The stdio harness
  // can fork a fresh interpreter per request, in which case the next call
  // re-loads scenes from disk via loadProjectScenes — without an explicit
  // save here, every resize/update/move/clone vanishes the moment the
  // session ends.
  for (const sceneId of touchedScenes) {
    try { autoSaveScene(sceneId); } catch { /* best-effort */ }
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
