// Inspector panel — third skill-panel + first genuinely
// brand-locked editor. For the selected scene node shows:
//   - Semantic path (stable address, copy-able)
//   - Intent metadata (role / purpose / editableBy / agentState)
//   - Type + current name (editable inline via onInput)
//   - Token bindings (fill / stroke / fontSize / etc — swap role via
//     onClick pill row)
//   - Geometry summary (xywh read-only; brand-locked so not editable)
//   - Action row (rename, clone, delete) via onClick → MCP bridge
//
// Distinction from Figma-style property panels: **no color picker,
// no font picker, no spacing slider**. Every visual property on a
// node is already token-bound (Phase 3b exporter), so changing a
// swatch/type/spacing happens at brand level in brand-palette, not
// per-node. Inspector is for STRUCTURAL + SEMANTIC edits — things
// that don't touch the brand contract.

import { SceneGraph } from '../engine/scene-graph';
import type { AgentGesture, NodeIntent, SceneNode } from '../engine/types';

export interface InspectorAuditIssue {
  severity: 'error' | 'warning' | 'info';
  rule: string;
  message: string;
}

export interface InspectorTokenBinding {
  field: 'fill' | 'stroke' | 'fontSize' | 'fontFamily' | 'cornerRadius';
  role: string;
}

export interface InspectorTarget {
  /** Stable semantic path like `home/hero/cta`. */
  semanticPath: string;
  /** Node id (engine-internal; opaque to agents). */
  id: string;
  /** Display name. */
  name: string;
  /** NodeType enum value. */
  type: string;
  /** semanticRole if set (button, link, heading, ...). */
  semanticRole?: string | null;
  intent?: NodeIntent | null;
  /** Geometry bbox — read-only. */
  bbox?: { x: number; y: number; width: number; height: number };
  /** Current token bindings on this node. */
  tokenBindings?: InspectorTokenBinding[];
  /** Audit issues tied to this node. */
  auditIssues?: InspectorAuditIssue[];
}

export interface InspectorOptions {
  /** Target node — when null/undefined the panel renders an empty state. */
  target?: InspectorTarget | null;
  /** Available brand roles to swap token bindings against. */
  availableRoles?: string[];
  /** Panel width in px. Default 320 (right-panel). */
  width?: number;
  /** Scene id — used in action gestures so the bridge can locate the graph. */
  sceneId?: string;
}

const SURFACE_BG = { r: 0.066, g: 0.066, b: 0.078, a: 1 };
const SURFACE = { r: 0.086, g: 0.086, b: 0.102, a: 1 };
const BORDER = { r: 0.172, g: 0.172, b: 0.204, a: 1 };
const BORDER_SUBTLE = { r: 0.12, g: 0.12, b: 0.14, a: 1 };
const TEXT_PRIMARY = { r: 0.98, g: 0.98, b: 0.98, a: 1 };
const TEXT_SECONDARY = { r: 0.72, g: 0.72, b: 0.76, a: 1 };
const TEXT_TERTIARY = { r: 0.52, g: 0.52, b: 0.56, a: 1 };
const DANGER = { r: 0.82, g: 0.35, b: 0.35, a: 1 };
const ACCENT = { r: 0.388, g: 0.357, b: 1.0, a: 1 };

export function composeInspectorPanel(opts: InspectorOptions): SceneGraph {
  const width = opts.width ?? 320;
  const graph = new SceneGraph();
  const root = graph.getNode(graph.rootId);
  if (!root) throw new Error('SceneGraph root missing');

  graph.updateNode(root.id, {
    name: 'inspector-panel',
    type: 'FRAME' as any,
    width,
    fills: [{ type: 'SOLID', color: SURFACE_BG, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    paddingTop: 16,
    paddingBottom: 16,
    paddingLeft: 16,
    paddingRight: 16,
    itemSpacing: 16,
    mountSlot: { name: 'right-panel', accepts: ['inspector'] },
    intent: intentOf('inspector/panel', 'Selected node inspector', 'both'),
  } as any);

  composeHeader(graph, root.id, width - 32);

  if (!opts.target) {
    composeEmptyState(graph, root.id, width - 32);
    return graph;
  }

  composeIdentity(graph, root.id, width - 32, opts.target);
  composeIntent(graph, root.id, width - 32, opts.target);
  composeGeometry(graph, root.id, width - 32, opts.target);
  composeTokenBindings(graph, root.id, width - 32, opts.target, opts.availableRoles ?? [], opts.sceneId);
  composeAuditIssues(graph, root.id, width - 32, opts.target);
  composeActions(graph, root.id, width - 32, opts.target, opts.sceneId);

  return graph;
}

// ─── Header ──────────────────────────────────────────────────────

function composeHeader(graph: SceneGraph, parentId: string, width: number): void {
  const header = graph.createNode('FRAME' as any, parentId, {
    name: 'header',
    width,
    height: 28,
    fills: [],
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    primaryAxisAlign: 'SPACE_BETWEEN' as any,
    counterAxisAlign: 'CENTER' as any,
    intent: intentOf('inspector/header', 'Panel title + close', 'locked'),
  } as any);

  graph.createNode('TEXT' as any, header.id, {
    name: 'title',
    text: 'Inspector',
    fontSize: 14,
    fontFamily: 'Inter',
    fontWeight: 600,
    width: width - 40,
    height: 20,
    fills: [{ type: 'SOLID', color: TEXT_PRIMARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('inspector/title', 'Panel title', 'locked'),
  } as any);

  const close = graph.createNode('FRAME' as any, header.id, {
    name: 'close-button',
    width: 24,
    height: 24,
    cornerRadius: 6,
    fills: [{ type: 'SOLID', color: SURFACE, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    semanticRole: 'button',
    focusable: true,
    onClick: gesture('reframe_ui', { action: 'unmount', panel: 'inspector' }, 'local-state'),
    keybinding: { combo: 'escape', tool: 'reframe_ui', args: { action: 'unmount', panel: 'inspector' } },
    intent: intentOf('inspector/close', 'Dismiss panel', 'both'),
  } as any);
  graph.createNode('TEXT' as any, close.id, {
    name: 'close-glyph',
    text: '×',
    fontSize: 16,
    fontFamily: 'Inter',
    fontWeight: 400,
    width: 24,
    height: 24,
    textAlignHorizontal: 'CENTER' as any,
    textAlignVertical: 'CENTER' as any,
    fills: [{ type: 'SOLID', color: TEXT_SECONDARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('inspector/close-glyph', 'Close glyph', 'locked'),
  } as any);
}

// ─── Empty state ─────────────────────────────────────────────────

function composeEmptyState(graph: SceneGraph, parentId: string, width: number): void {
  const empty = graph.createNode('FRAME' as any, parentId, {
    name: 'empty-state',
    width,
    height: 120,
    fills: [],
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    primaryAxisAlign: 'CENTER' as any,
    counterAxisAlign: 'CENTER' as any,
    itemSpacing: 8,
    intent: intentOf('inspector/empty-state', 'No selection', 'locked'),
  } as any);
  graph.createNode('TEXT' as any, empty.id, {
    name: 'empty-title',
    text: 'No selection',
    fontSize: 13,
    fontFamily: 'Inter',
    fontWeight: 500,
    width,
    height: 18,
    textAlignHorizontal: 'CENTER' as any,
    fills: [{ type: 'SOLID', color: TEXT_SECONDARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('inspector/empty-title', '', 'locked'),
  } as any);
  graph.createNode('TEXT' as any, empty.id, {
    name: 'empty-hint',
    text: 'Click a node on the canvas to inspect.',
    fontSize: 11,
    fontFamily: 'Inter',
    fontWeight: 400,
    width,
    height: 16,
    textAlignHorizontal: 'CENTER' as any,
    fills: [{ type: 'SOLID', color: TEXT_TERTIARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('inspector/empty-hint', '', 'locked'),
  } as any);
}

// ─── Identity (type + name editable) ─────────────────────────────

function composeIdentity(graph: SceneGraph, parentId: string, width: number, t: InspectorTarget): void {
  const section = graph.createNode('FRAME' as any, parentId, {
    name: 'identity',
    width,
    fills: [],
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    itemSpacing: 6,
    intent: intentOf('inspector/section', 'Identity', 'locked'),
  } as any);

  graph.createNode('TEXT' as any, section.id, {
    name: 'identity-caption',
    text: t.type + (t.semanticRole ? ` · ${t.semanticRole}` : ''),
    fontSize: 10,
    fontFamily: 'JetBrains Mono',
    fontWeight: 500,
    width,
    height: 14,
    fills: [{ type: 'SOLID', color: TEXT_TERTIARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('inspector/type-caption', 'Node type + role', 'locked'),
  } as any);

  // Name row — contenteditable via onInput gesture that fires rename.
  graph.createNode('TEXT' as any, section.id, {
    name: 'name-input',
    text: t.name,
    fontSize: 16,
    fontFamily: 'Inter',
    fontWeight: 600,
    width,
    height: 24,
    fills: [{ type: 'SOLID', color: TEXT_PRIMARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    semanticRole: 'input',
    focusable: true,
    onInput: gesture('reframe_edit', {
      op: 'rename',
      sceneId: '{path}',   // placeholder — will be substituted by dispatcher
      targetPath: t.semanticPath,
      name: '{value}',
    }, 'local-state'),
    intent: intentOf('inspector/name-input', 'Rename this node', 'both'),
  } as any);

  // Semantic path — monospace, copyable look.
  graph.createNode('TEXT' as any, section.id, {
    name: 'semantic-path',
    text: t.semanticPath,
    fontSize: 11,
    fontFamily: 'JetBrains Mono',
    fontWeight: 400,
    width,
    height: 16,
    fills: [{ type: 'SOLID', color: TEXT_TERTIARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('inspector/path', 'Stable semantic path', 'locked'),
  } as any);
}

// ─── Intent (role / editableBy / agentState) ─────────────────────

function composeIntent(graph: SceneGraph, parentId: string, width: number, t: InspectorTarget): void {
  if (!t.intent) return;
  const section = graph.createNode('FRAME' as any, parentId, {
    name: 'intent',
    width,
    cornerRadius: 8,
    fills: [{ type: 'SOLID', color: SURFACE, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    strokes: [{ type: 'SOLID', color: BORDER_SUBTLE, visible: true, opacity: 1 } as any],
    borderTopWeight: 1,
    borderRightWeight: 1,
    borderBottomWeight: 1,
    borderLeftWeight: 1,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    paddingTop: 10,
    paddingBottom: 10,
    paddingLeft: 12,
    paddingRight: 12,
    itemSpacing: 6,
    intent: intentOf('inspector/intent-section', 'Intent metadata', 'locked'),
  } as any);

  sectionLabel(graph, section.id, width - 24, 'Intent');
  kv(graph, section.id, width - 24, 'role', t.intent.role);
  if (t.intent.purpose) kv(graph, section.id, width - 24, 'purpose', t.intent.purpose);
  kv(graph, section.id, width - 24, 'editableBy', t.intent.editableBy);
  if (t.intent.agentState) kv(graph, section.id, width - 24, 'agentState', t.intent.agentState);
}

// ─── Geometry (read-only) ────────────────────────────────────────

function composeGeometry(graph: SceneGraph, parentId: string, width: number, t: InspectorTarget): void {
  if (!t.bbox) return;
  const section = graph.createNode('FRAME' as any, parentId, {
    name: 'geometry',
    width,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    fills: [],
    itemSpacing: 6,
    intent: intentOf('inspector/geometry-section', 'Geometry read-only', 'locked'),
  } as any);
  sectionLabel(graph, section.id, width, 'Geometry');
  kv(graph, section.id, width, 'x', String(Math.round(t.bbox.x)));
  kv(graph, section.id, width, 'y', String(Math.round(t.bbox.y)));
  kv(graph, section.id, width, 'w', String(Math.round(t.bbox.width)));
  kv(graph, section.id, width, 'h', String(Math.round(t.bbox.height)));
}

// ─── Token bindings (swap role via onClick pill row) ─────────────

function composeTokenBindings(
  graph: SceneGraph,
  parentId: string,
  width: number,
  t: InspectorTarget,
  availableRoles: string[],
  sceneId: string | undefined,
): void {
  const bindings = t.tokenBindings ?? [];
  if (bindings.length === 0 && availableRoles.length === 0) return;

  const section = graph.createNode('FRAME' as any, parentId, {
    name: 'token-bindings',
    width,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    fills: [],
    itemSpacing: 10,
    intent: intentOf('inspector/token-bindings-section', 'Token bindings editor', 'locked'),
  } as any);

  sectionLabel(graph, section.id, width, 'Token bindings');

  for (const b of bindings) {
    composeBindingRow(graph, section.id, width, b, availableRoles, t, sceneId);
  }

  if (bindings.length === 0) {
    graph.createNode('TEXT' as any, section.id, {
      name: 'no-bindings',
      text: 'No token bindings on this node.',
      fontSize: 11,
      fontFamily: 'Inter',
      fontWeight: 400,
      width,
      height: 16,
      fills: [{ type: 'SOLID', color: TEXT_TERTIARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
      intent: intentOf('inspector/no-bindings', '', 'locked'),
    } as any);
  }
}

function composeBindingRow(
  graph: SceneGraph,
  parentId: string,
  width: number,
  binding: InspectorTokenBinding,
  availableRoles: string[],
  t: InspectorTarget,
  sceneId: string | undefined,
): void {
  const row = graph.createNode('FRAME' as any, parentId, {
    name: `binding-${binding.field}`,
    width,
    fills: [],
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    itemSpacing: 6,
    intent: intentOf('inspector/binding-row', `${binding.field} ← ${binding.role}`, 'locked'),
  } as any);
  graph.createNode('TEXT' as any, row.id, {
    name: 'field-label',
    text: binding.field,
    fontSize: 10,
    fontFamily: 'JetBrains Mono',
    fontWeight: 500,
    width,
    height: 14,
    fills: [{ type: 'SOLID', color: TEXT_TERTIARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('inspector/field-label', binding.field, 'locked'),
  } as any);

  const pills = graph.createNode('FRAME' as any, row.id, {
    name: 'pills',
    width,
    fills: [],
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'HUG',
    layoutWrap: 'WRAP' as any,
    itemSpacing: 6,
    counterAxisSpacing: 6,
    intent: intentOf('inspector/pill-row', 'Available roles', 'locked'),
  } as any);

  const roles = availableRoles.length > 0 ? availableRoles : [binding.role];
  for (const role of roles) {
    const isActive = role === binding.role;
    const pill = graph.createNode('FRAME' as any, pills.id, {
      name: `pill-${role}`,
      height: 26,
      cornerRadius: 13,
      fills: [{ type: 'SOLID', color: isActive ? ACCENT : SURFACE, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
      strokes: [{ type: 'SOLID', color: isActive ? ACCENT : BORDER_SUBTLE, visible: true, opacity: 1 } as any],
      borderTopWeight: 1,
      borderRightWeight: 1,
      borderBottomWeight: 1,
      borderLeftWeight: 1,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'FIXED',
      primaryAxisAlign: 'CENTER' as any,
      counterAxisAlign: 'CENTER' as any,
      paddingLeft: 10,
      paddingRight: 10,
      semanticRole: 'button',
      focusable: true,
      onClick: isActive ? null as any : gesture('reframe_edit', {
        op: 'setTokenBinding',
        sceneId: sceneId ?? '',
        targetPath: t.semanticPath,
        field: binding.field,
        role,
      }, 'optimistic-ui'),
      intent: intentOf('inspector/token-pill', `${binding.field} ← ${role}${isActive ? ' (active)' : ''}`, isActive ? 'locked' : 'both'),
    } as any);
    graph.createNode('TEXT' as any, pill.id, {
      name: 'pill-text',
      text: role,
      fontSize: 11,
      fontFamily: 'Inter',
      fontWeight: isActive ? 600 : 500,
      width: 80,
      height: 16,
      textAlignHorizontal: 'CENTER' as any,
      fills: [{ type: 'SOLID', color: isActive ? { r: 1, g: 1, b: 1, a: 1 } : TEXT_SECONDARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
      intent: intentOf('inspector/pill-label', role, 'locked'),
    } as any);
  }
}

// ─── Audit issues ────────────────────────────────────────────────

function composeAuditIssues(graph: SceneGraph, parentId: string, width: number, t: InspectorTarget): void {
  const issues = t.auditIssues ?? [];
  if (issues.length === 0) return;
  const section = graph.createNode('FRAME' as any, parentId, {
    name: 'audit-issues',
    width,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    fills: [],
    itemSpacing: 8,
    intent: intentOf('inspector/audit-section', `${issues.length} audit issue${issues.length > 1 ? 's' : ''}`, 'locked'),
  } as any);
  sectionLabel(graph, section.id, width, `Audit · ${issues.length}`);
  for (const issue of issues) {
    const row = graph.createNode('FRAME' as any, section.id, {
      name: `issue-${issue.rule}`,
      width,
      cornerRadius: 6,
      fills: [{ type: 'SOLID', color: SURFACE, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'HUG',
      paddingTop: 8,
      paddingBottom: 8,
      paddingLeft: 10,
      paddingRight: 10,
      itemSpacing: 8,
      intent: intentOf('inspector/issue', `${issue.severity}: ${issue.rule}`, 'locked'),
    } as any);
    graph.createNode('FRAME' as any, row.id, {
      name: 'dot',
      width: 8,
      height: 8,
      cornerRadius: 4,
      fills: [{ type: 'SOLID', color: issue.severity === 'error' ? DANGER : issue.severity === 'warning' ? { r: 0.96, g: 0.62, b: 0.04, a: 1 } : TEXT_TERTIARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
      intent: intentOf('inspector/issue-dot', issue.severity, 'locked'),
    } as any);
    graph.createNode('TEXT' as any, row.id, {
      name: 'issue-text',
      text: issue.message,
      fontSize: 11,
      fontFamily: 'Inter',
      fontWeight: 400,
      width: width - 40,
      height: 32,
      maxLines: 2,
      fills: [{ type: 'SOLID', color: TEXT_SECONDARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
      intent: intentOf('inspector/issue-text', issue.rule, 'locked'),
    } as any);
  }
}

// ─── Actions (clone / delete) ────────────────────────────────────

function composeActions(
  graph: SceneGraph,
  parentId: string,
  width: number,
  t: InspectorTarget,
  sceneId: string | undefined,
): void {
  const row = graph.createNode('FRAME' as any, parentId, {
    name: 'actions',
    width,
    fills: [],
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'HUG',
    itemSpacing: 8,
    paddingTop: 8,
    intent: intentOf('inspector/actions-row', 'Clone, delete', 'locked'),
  } as any);
  actionButton(graph, row.id, 'Clone', gesture('reframe_edit', {
    op: 'clone',
    sceneId: sceneId ?? '',
    targetPath: t.semanticPath,
  }, 'optimistic-ui'), false);
  actionButton(graph, row.id, 'Delete', gesture('reframe_edit', {
    op: 'delete',
    sceneId: sceneId ?? '',
    targetPath: t.semanticPath,
  }, 'optimistic-ui'), true);
}

function actionButton(
  graph: SceneGraph,
  parentId: string,
  label: string,
  onClick: AgentGesture,
  danger: boolean,
): void {
  const btn = graph.createNode('FRAME' as any, parentId, {
    name: label.toLowerCase(),
    height: 32,
    cornerRadius: 6,
    fills: [{ type: 'SOLID', color: SURFACE, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    strokes: [{ type: 'SOLID', color: danger ? DANGER : BORDER, visible: true, opacity: 1 } as any],
    borderTopWeight: 1,
    borderRightWeight: 1,
    borderBottomWeight: 1,
    borderLeftWeight: 1,
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    primaryAxisAlign: 'CENTER' as any,
    counterAxisAlign: 'CENTER' as any,
    paddingLeft: 12,
    paddingRight: 12,
    semanticRole: 'button',
    focusable: true,
    onClick,
    intent: intentOf(`inspector/action-${label.toLowerCase()}`, label, 'both'),
  } as any);
  graph.createNode('TEXT' as any, btn.id, {
    name: 'action-label',
    text: label,
    fontSize: 12,
    fontFamily: 'Inter',
    fontWeight: 500,
    width: 60,
    height: 18,
    textAlignHorizontal: 'CENTER' as any,
    fills: [{ type: 'SOLID', color: danger ? DANGER : TEXT_PRIMARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('inspector/action-label', label, 'locked'),
  } as any);
}

// ─── Helpers ─────────────────────────────────────────────────────

function sectionLabel(graph: SceneGraph, parentId: string, width: number, text: string): SceneNode {
  return graph.createNode('TEXT' as any, parentId, {
    name: 'section-label',
    text,
    fontSize: 10,
    fontFamily: 'JetBrains Mono',
    fontWeight: 600,
    width,
    height: 14,
    textCase: 'UPPER' as any,
    letterSpacing: 0.5,
    fills: [{ type: 'SOLID', color: TEXT_TERTIARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('inspector/section-label', text, 'locked'),
  } as any);
}

function kv(graph: SceneGraph, parentId: string, width: number, k: string, v: string): void {
  const row = graph.createNode('FRAME' as any, parentId, {
    name: `kv-${k}`,
    width,
    fills: [],
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'HUG',
    primaryAxisAlign: 'SPACE_BETWEEN' as any,
    itemSpacing: 8,
    intent: intentOf('inspector/kv', `${k}: ${v}`, 'locked'),
  } as any);
  graph.createNode('TEXT' as any, row.id, {
    name: 'k',
    text: k,
    fontSize: 11,
    fontFamily: 'JetBrains Mono',
    fontWeight: 400,
    width: 80,
    height: 16,
    fills: [{ type: 'SOLID', color: TEXT_TERTIARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('inspector/kv-key', k, 'locked'),
  } as any);
  graph.createNode('TEXT' as any, row.id, {
    name: 'v',
    text: v,
    fontSize: 11,
    fontFamily: 'JetBrains Mono',
    fontWeight: 500,
    width: width - 96,
    height: 16,
    textAlignHorizontal: 'RIGHT' as any,
    fills: [{ type: 'SOLID', color: TEXT_SECONDARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('inspector/kv-value', v, 'locked'),
  } as any);
}

function intentOf(role: string, purpose: string, editableBy: NodeIntent['editableBy']): NodeIntent {
  return { role, purpose, editableBy };
}

function gesture(
  tool: string,
  args: Record<string, unknown>,
  fastPath?: AgentGesture['fastPath'],
): AgentGesture {
  return fastPath ? { tool, args, fastPath } : { tool, args };
}
