// Editor shell panel — FULL self-host of /platform/project/:slug.
//
// Phase 5.1 rewrites the 400+ line hand-HTML editor-shell-page into a
// single INode composition. The chrome — header, wordmark, crumb,
// macro dropdown buttons, export, theme toggle, sidebar labels,
// floating toolbar, panel placeholders — is all INode with gestures.
// Only three kinds of content stay dynamic (injected client-side into
// mountSlots named here):
//   - canvas-viewport — native <canvas> that the editor bundle drives
//   - layers-tree      — client-populated tree of INode layers
//   - bottom-chat-slot — chat pill
//
// Everything else (tool buttons, undo/redo, theme toggle, export) is
// composer-emitted with agent-operable gestures. Clicking "Export" in
// the header fires a browser.download; clicking a tool button fires a
// client-local toolbar event; clicking the theme toggle dispatches a
// theme-change gesture. The whole editor UI becomes addressable at the
// semantic-path level — which unlocks agent-driven QA (Phase 5.6).

import { SceneGraph } from '../engine/scene-graph';
import type { AgentGesture, NodeIntent, SceneNode } from '../engine/types';
import {
  PANEL_COLORS, buildPanel, solidFill, solidStroke, intent, gesture,
} from './helpers';

// Shell uses the Platform UI theme colors — warm paper + ink. Mirrors
// what the hand-HTML had as CSS vars. Kept separate from PANEL_COLORS
// (which is the dark-only panel palette) so the shell respects light /
// dark theme via CSS custom properties in the exported HTML layer.
const SHELL = {
  SURFACE:     { r: 0.949, g: 0.925, b: 0.855, a: 1 }, // #F2ECDA
  SURFACE_ELV: { r: 0.98,  g: 0.969, b: 0.941, a: 1 }, // #FAF7F0
  SURFACE_CAN: { r: 0.91,  g: 0.886, b: 0.816, a: 1 }, // #E8E2D0
  BORDER:      { r: 0.173, g: 0.149, b: 0.094, a: 0.12 }, // rgba(44,38,24,.12)
  BORDER_SUB:  { r: 0.173, g: 0.149, b: 0.094, a: 0.08 },
  TEXT_PRI:    { r: 0.173, g: 0.149, b: 0.094, a: 1 }, // #2C2618
  TEXT_SEC:    { r: 0.42,  g: 0.388, b: 0.329, a: 1 }, // #6B6354
  TEXT_MUT:    { r: 0.604, g: 0.565, b: 0.51,  a: 1 }, // #9A9082
  ACCENT:      { r: 0.914, g: 0.294, b: 0.102, a: 1 }, // #E94B1A
  ON_ACCENT:   { r: 1, g: 1, b: 1, a: 1 },
};

export interface EditorShellOptions {
  sceneSlug: string;
  /** Comma-separated list of scene session ids (for canvas data-project-scenes). */
  sceneIds: string;
  /** Page title — e.g. "reframe · editorial". */
  title?: string;
  /** Viewport width — default 1440. Shell is height: 100vh via CSS. */
  width?: number;
  /** Viewport height hint for layout computations (not CSS). */
  height?: number;
}

/**
 * Compose the editor shell SceneGraph. Expected to be rendered with
 * fullDocument: false then WRAPPED in a tiny boot-HTML shim that loads
 * theme-init.js, app.js, editor bundle, and populates the mount slots
 * (canvas-viewport, layers-tree, bottom-chat-slot).
 */
export function composeEditorShellPanel(opts: EditorShellOptions): SceneGraph {
  const width = opts.width ?? 1440;
  const height = opts.height ?? 900;
  const headerH = 52;
  const bodyH = height - headerH;
  const sidebarW = 220;
  const panelW = 320;
  const canvasW = width - sidebarW - panelW;

  const graph = new SceneGraph();
  const root = buildPanel(graph, {
    name: 'editor-shell',
    width,
    role: 'editor-shell/root',
    purpose: `Scene editor for ${opts.sceneSlug}`,
    background: SHELL.SURFACE,
    padding: 0,
    itemSpacing: 0,
    editableBy: 'locked',
  });

  composeHeader(graph, root, width, headerH, opts);
  composeBody(graph, root, width, bodyH, sidebarW, canvasW, panelW, opts);

  return graph;
}

// ─── Header ──────────────────────────────────────────────────

function composeHeader(graph: SceneGraph, parent: SceneNode, width: number, height: number, opts: EditorShellOptions): SceneNode {
  const header = graph.createNode('FRAME' as any, parent.id, {
    name: 'header',
    width,
    height,
    fills: solidFill(SHELL.SURFACE_ELV),
    ...solidStroke(SHELL.BORDER, 1),
    borderTopWeight: 0, borderLeftWeight: 0, borderRightWeight: 0, // bottom only
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    counterAxisAlign: 'CENTER',
    paddingLeft: 16, paddingRight: 16,
    itemSpacing: 12,
    intent: intent('editor-shell/header', 'Top bar', 'locked'),
  } as any);

  // Wordmark "reframe" → link home.
  const wordmark = graph.createNode('FRAME' as any, header.id, {
    name: 'wordmark',
    fills: [],
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    semanticRole: 'link',
    focusable: true,
    href: '/platform',
    onClick: gesture('browser.navigate', { url: '/platform' }, 'local-state'),
    intent: intent('editor-shell/wordmark', 'Go to dashboard', 'both'),
  } as any);
  graph.createNode('TEXT' as any, wordmark.id, {
    name: 'wordmark-text',
    text: 'reframe',
    fontSize: 13,
    fontFamily: 'JetBrains Mono',
    fontWeight: 500,
    width: 70, height: 18,
    fills: solidFill(SHELL.TEXT_PRI),
    intent: intent('editor-shell/wordmark-text', 'reframe', 'locked'),
  } as any);

  // Separator.
  composeSeparator(graph, header, 16);

  // Crumb — scene name.
  const crumbText = (opts.title ?? 'reframe').replace('reframe · ', '') || opts.sceneSlug;
  graph.createNode('TEXT' as any, header.id, {
    name: 'crumb',
    text: crumbText,
    fontSize: 12,
    fontFamily: 'Inter',
    fontWeight: 500,
    width: 200, height: 18,
    fills: solidFill(SHELL.TEXT_SEC),
    intent: intent('editor-shell/crumb', `Active scene ${crumbText}`, 'locked'),
  } as any);

  // Macro-dropdowns slot — filled by client (complex dropdown behavior
  // stays hand-wired via existing platform-ui.js binders). Empty slot
  // placeholder with stable name.
  graph.createNode('FRAME' as any, header.id, {
    name: 'macro-dropdowns-slot',
    width: 420, height: 36,
    fills: [],
    mountSlot: { name: 'macro-dropdowns', accepts: [] },
    intent: intent('editor-shell/macro-dropdowns-slot', 'Generate/Modify/Preview/More dropdowns', 'locked'),
  } as any);

  // Spacer (flex-grow).
  graph.createNode('FRAME' as any, header.id, {
    name: 'spacer',
    fills: [],
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    layoutGrow: 1,
    height: 1,
    width: 1,
    intent: intent('editor-shell/spacer', '', 'locked'),
  } as any);

  // Export button (primary).
  const exportBtn = graph.createNode('FRAME' as any, header.id, {
    name: 'export-button',
    width: 80, height: 32,
    cornerRadius: 6,
    fills: solidFill(SHELL.ACCENT),
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'CENTER',
    semanticRole: 'button',
    focusable: true,
    onClick: gesture('reframe_ui', { action: 'mount', panel: 'brand-gallery', config: { brandSlug: '' } }, 'local-state'),
    intent: intent('editor-shell/export', 'Open export surface', 'both'),
  } as any);
  graph.createNode('TEXT' as any, exportBtn.id, {
    name: 'export-label',
    text: 'Export',
    fontSize: 12, fontFamily: 'Inter', fontWeight: 500,
    width: 60, height: 18,
    textAlignHorizontal: 'CENTER',
    fills: solidFill(SHELL.ON_ACCENT),
    intent: intent('editor-shell/export-label', 'Export', 'locked'),
  } as any);

  composeSeparator(graph, header, 12);

  // Theme toggle.
  const themeToggle = graph.createNode('FRAME' as any, header.id, {
    name: 'theme-toggle',
    width: 32, height: 32,
    cornerRadius: 6,
    fills: solidFill(SHELL.SURFACE),
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'CENTER',
    semanticRole: 'button',
    focusable: true,
    onClick: gesture('ui.toggleTheme', {}, 'local-state'),
    intent: intent('editor-shell/theme-toggle', 'Toggle light/dark theme', 'both'),
  } as any);
  graph.createNode('TEXT' as any, themeToggle.id, {
    name: 'theme-glyph',
    text: '◐',
    fontSize: 14, fontFamily: 'Inter', fontWeight: 400,
    width: 16, height: 16,
    textAlignHorizontal: 'CENTER',
    fills: solidFill(SHELL.TEXT_SEC),
    intent: intent('editor-shell/theme-glyph', '', 'locked'),
  } as any);

  return header;
}

function composeSeparator(graph: SceneGraph, parent: SceneNode, height: number): void {
  graph.createNode('FRAME' as any, parent.id, {
    name: 'sep',
    width: 1, height,
    fills: solidFill(SHELL.BORDER),
    intent: intent('editor-shell/sep', '', 'locked'),
  } as any);
}

// ─── Body (sidebar + canvas + right panel) ──────────────────

function composeBody(
  graph: SceneGraph, parent: SceneNode,
  width: number, height: number,
  sidebarW: number, canvasW: number, panelW: number,
  opts: EditorShellOptions,
): SceneNode {
  const body = graph.createNode('FRAME' as any, parent.id, {
    name: 'body',
    width, height,
    fills: [],
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    itemSpacing: 0,
    intent: intent('editor-shell/body', 'Sidebar + canvas + right panel', 'locked'),
  } as any);

  composeSidebar(graph, body, sidebarW, height);
  composeCanvasArea(graph, body, canvasW, height, opts);
  composeRightPanel(graph, body, panelW, height);

  return body;
}

// ─── Sidebar (Layers) ───────────────────────────────────────

function composeSidebar(graph: SceneGraph, parent: SceneNode, width: number, height: number): SceneNode {
  const sidebar = graph.createNode('FRAME' as any, parent.id, {
    name: 'sidebar',
    width, height,
    fills: solidFill(SHELL.SURFACE),
    ...solidStroke(SHELL.BORDER, 1),
    borderTopWeight: 0, borderBottomWeight: 0, borderLeftWeight: 0, // right only
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    itemSpacing: 0,
    intent: intent('editor-shell/sidebar', 'Left rail — layers', 'locked'),
  } as any);

  // Sidebar head "Layers".
  const head = graph.createNode('FRAME' as any, sidebar.id, {
    name: 'sidebar-head',
    width, height: 36,
    fills: [],
    ...solidStroke(SHELL.BORDER_SUB, 1),
    borderTopWeight: 0, borderLeftWeight: 0, borderRightWeight: 0,
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    counterAxisAlign: 'CENTER',
    paddingLeft: 12, paddingRight: 12,
    intent: intent('editor-shell/sidebar-head', 'Layers heading', 'locked'),
  } as any);
  graph.createNode('TEXT' as any, head.id, {
    name: 'sidebar-head-text',
    text: 'Layers',
    fontSize: 11, fontFamily: 'JetBrains Mono', fontWeight: 600,
    width: 60, height: 14,
    textCase: 'UPPER',
    letterSpacing: 0.5,
    fills: solidFill(SHELL.TEXT_MUT),
    intent: intent('editor-shell/sidebar-head-text', 'Layers', 'locked'),
  } as any);

  // Layers tree slot — populated by client from scene graph via
  // existing platform-ui.js layers binder.
  graph.createNode('FRAME' as any, sidebar.id, {
    name: 'layer-tree',
    width, height: height - 36,
    fills: [],
    mountSlot: { name: 'layers-tree', accepts: [] },
    intent: intent('editor-shell/layers-tree-slot', 'Populated client-side from scene graph', 'locked'),
  } as any);

  return sidebar;
}

// ─── Canvas area ────────────────────────────────────────────

function composeCanvasArea(graph: SceneGraph, parent: SceneNode, width: number, height: number, opts: EditorShellOptions): SceneNode {
  const canvasArea = graph.createNode('FRAME' as any, parent.id, {
    name: 'canvas-area',
    width, height,
    fills: solidFill(SHELL.SURFACE_CAN),
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    clipsContent: true,
    intent: intent('editor-shell/canvas-area', 'Canvas viewport + floating toolbar', 'locked'),
  } as any);

  // Canvas viewport slot — client injects the native <canvas> element.
  graph.createNode('FRAME' as any, canvasArea.id, {
    name: 'canvas-viewport',
    width, height,
    fills: [],
    mountSlot: { name: 'canvas-viewport', accepts: [] },
    intent: intent('editor-shell/canvas-viewport-slot', `Native <canvas> for scene ${opts.sceneSlug}`, 'locked'),
  } as any);

  // Floating toolbar is absolute-positioned — layout via mountSlot
  // (absolute pos lives in the shell CSS; INode chrome defines the
  // declarative shape, CSS positions it).
  composeFloatingToolbar(graph, canvasArea);

  return canvasArea;
}

function composeFloatingToolbar(graph: SceneGraph, parent: SceneNode): SceneNode {
  const toolbar = graph.createNode('FRAME' as any, parent.id, {
    name: 'float-toolbar',
    layoutPositioning: 'ABSOLUTE',
    cornerRadius: 10,
    fills: solidFill(SHELL.SURFACE_ELV),
    ...solidStroke(SHELL.BORDER, 1),
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    counterAxisAlign: 'CENTER',
    paddingTop: 4, paddingBottom: 4, paddingLeft: 6, paddingRight: 6,
    itemSpacing: 2,
    intent: intent('editor-shell/float-toolbar', 'Tool + undo/redo bar', 'locked'),
  } as any);

  const tools = [
    { t: 'SELECT', g: 'M3 1l9 6.5-4.5 1.5-2 4.5L3 1z', title: 'Select (V)' },
    { t: 'FRAME',  g: null, title: 'Frame (F)' },
    { t: 'RECTANGLE', g: null, title: 'Rectangle (R)' },
    { t: 'ELLIPSE', g: null, title: 'Ellipse (O)' },
    { t: 'TEXT', g: null, title: 'Text (T)' },
    { t: 'PEN', g: null, title: 'Pen (P)' },
    { t: 'HAND', g: null, title: 'Hand (H)' },
  ];
  for (const tool of tools) {
    composeToolButton(graph, toolbar, tool.t, tool.title);
  }

  // Separator.
  graph.createNode('FRAME' as any, toolbar.id, {
    name: 'tb-sep',
    width: 1, height: 20,
    fills: solidFill(SHELL.BORDER),
    intent: intent('editor-shell/tb-sep', '', 'locked'),
  } as any);

  composeUndoRedo(graph, toolbar);

  return toolbar;
}

function composeToolButton(graph: SceneGraph, parent: SceneNode, toolKind: string, title: string): void {
  const btn = graph.createNode('FRAME' as any, parent.id, {
    name: `tool-${toolKind.toLowerCase()}`,
    width: 32, height: 32,
    cornerRadius: 6,
    fills: [],
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'CENTER',
    semanticRole: 'button',
    focusable: true,
    onClick: gesture('ui.selectTool', { tool: toolKind }, 'local-state'),
    intent: intent(`editor-shell/tool-${toolKind.toLowerCase()}`, title, 'both'),
  } as any);
  // One-letter glyph — replaces complex SVG. Semantic paths + tool name
  // make the function clear without icon fidelity.
  const glyph = { SELECT: '▲', FRAME: '▢', RECTANGLE: '▭', ELLIPSE: '○', TEXT: 'T', PEN: '✎', HAND: '✋' }[toolKind] ?? '?';
  graph.createNode('TEXT' as any, btn.id, {
    name: 'tool-glyph',
    text: glyph,
    fontSize: 14, fontFamily: 'Inter', fontWeight: 400,
    width: 16, height: 16,
    textAlignHorizontal: 'CENTER',
    fills: solidFill(SHELL.TEXT_SEC),
    intent: intent(`editor-shell/tool-${toolKind.toLowerCase()}-glyph`, '', 'locked'),
  } as any);
}

function composeUndoRedo(graph: SceneGraph, parent: SceneNode): void {
  for (const op of ['undo', 'redo'] as const) {
    const btn = graph.createNode('FRAME' as any, parent.id, {
      name: `btn-${op}`,
      width: 32, height: 32,
      cornerRadius: 6,
      fills: [],
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      primaryAxisAlign: 'CENTER',
      counterAxisAlign: 'CENTER',
      semanticRole: 'button',
      focusable: true,
      onClick: gesture('ui.' + op, {}, 'local-state'),
      keybinding: op === 'undo'
        ? { combo: 'ctrl+z', tool: 'ui.undo', args: {} }
        : { combo: 'ctrl+shift+z', tool: 'ui.redo', args: {} },
      intent: intent(`editor-shell/${op}`, op === 'undo' ? 'Undo (Ctrl+Z)' : 'Redo (Ctrl+Shift+Z)', 'both'),
    } as any);
    graph.createNode('TEXT' as any, btn.id, {
      name: `${op}-glyph`,
      text: op === 'undo' ? '↶' : '↷',
      fontSize: 16, fontFamily: 'Inter', fontWeight: 400,
      width: 16, height: 20,
      textAlignHorizontal: 'CENTER',
      fills: solidFill(SHELL.TEXT_SEC),
      intent: intent(`editor-shell/${op}-glyph`, '', 'locked'),
    } as any);
  }
}

// ─── Right panel ────────────────────────────────────────────

function composeRightPanel(graph: SceneGraph, parent: SceneNode, width: number, height: number): SceneNode {
  const panel = graph.createNode('FRAME' as any, parent.id, {
    name: 'right-panel',
    width, height,
    fills: solidFill(SHELL.SURFACE),
    ...solidStroke(SHELL.BORDER, 1),
    borderTopWeight: 0, borderBottomWeight: 0, borderRightWeight: 0, // left only
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    mountSlot: { name: 'right-panel', accepts: ['inspector', 'brand-palette', 'variant-picker', 'brand-calibration'] },
    intent: intent('editor-shell/right-panel', 'Right panel — inspector / mount target', 'both'),
  } as any);

  // Empty-state placeholder when no panel mounted.
  const empty = graph.createNode('FRAME' as any, panel.id, {
    name: 'right-panel-empty',
    width, height: 120,
    fills: [],
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'CENTER',
    intent: intent('editor-shell/right-panel-empty', 'No panel mounted', 'locked'),
  } as any);
  graph.createNode('TEXT' as any, empty.id, {
    name: 'empty-hint',
    text: 'Select a node to inspect',
    fontSize: 12, fontFamily: 'Inter', fontWeight: 400,
    width: width - 24, height: 18,
    textAlignHorizontal: 'CENTER',
    fills: solidFill(SHELL.TEXT_MUT),
    intent: intent('editor-shell/empty-hint', 'Select a node to inspect', 'locked'),
  } as any);

  return panel;
}
