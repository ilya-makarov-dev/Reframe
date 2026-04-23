// App shell panel — self-host of renderShell chrome for non-editor
// pages (/platform, /platform/components, /platform/macros,
// /platform/design-system). Top bar with wordmark + theme toggle +
// brand pill, left sidebar with nav links. Page main content slot.
//
// Distinct from editor-shell (canvas editor) because non-editor pages
// have different layout: no canvas viewport, no floating toolbar, no
// layers tree. Just header + sidebar + main. Pages render their panel
// into the `main` mount-slot via server-side hydration.

import { SceneGraph } from '../engine/scene-graph';
import type { SceneNode } from '../engine/types';
import {
  buildPanel, solidFill, solidStroke, intent, gesture,
} from './helpers';

const THEME = {
  SURFACE:     { r: 0.949, g: 0.925, b: 0.855, a: 1 },
  SURFACE_ELV: { r: 0.98,  g: 0.969, b: 0.941, a: 1 },
  BORDER:      { r: 0.173, g: 0.149, b: 0.094, a: 0.12 },
  BORDER_SUB:  { r: 0.173, g: 0.149, b: 0.094, a: 0.08 },
  TEXT_PRI:    { r: 0.173, g: 0.149, b: 0.094, a: 1 },
  TEXT_SEC:    { r: 0.42,  g: 0.388, b: 0.329, a: 1 },
  TEXT_MUT:    { r: 0.604, g: 0.565, b: 0.51,  a: 1 },
  ACCENT:      { r: 0.914, g: 0.294, b: 0.102, a: 1 },
};

export interface AppShellSidebarItem {
  label: string;
  href: string;
  /** Whether this nav item matches the current page. */
  current?: boolean;
  /** Optional glyph — single char. */
  glyph?: string;
}

export interface AppShellOptions {
  title?: string;
  /** Active brand slug shown as pill below nav. */
  activeBrand?: string;
  /** Nav items. Rendered in order; `current: true` gets accent styling. */
  sidebarItems: AppShellSidebarItem[];
  /** Overall width — default 1440. */
  width?: number;
  /** Overall height — default 900. */
  height?: number;
}

export function composeAppShellPanel(opts: AppShellOptions): SceneGraph {
  const width = opts.width ?? 1440;
  const height = opts.height ?? 900;
  const headerH = 56;
  const sidebarW = 220;
  const graph = new SceneGraph();
  const root = buildPanel(graph, {
    name: 'app-shell',
    width,
    role: 'app-shell/root',
    purpose: 'Platform UI chrome for non-editor pages',
    background: THEME.SURFACE,
    padding: 0,
    itemSpacing: 0,
    editableBy: 'locked',
  });

  composeHeader(graph, root, width, headerH);
  composeBody(graph, root, width, height - headerH, sidebarW, opts);

  return graph;
}

function composeHeader(graph: SceneGraph, parent: SceneNode, width: number, height: number): void {
  const header = graph.createNode('FRAME' as any, parent.id, {
    name: 'header',
    width, height,
    fills: solidFill(THEME.SURFACE),
    ...solidStroke(THEME.BORDER, 1),
    borderTopWeight: 0, borderLeftWeight: 0, borderRightWeight: 0,
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    counterAxisAlign: 'CENTER',
    paddingLeft: 24, paddingRight: 24,
    itemSpacing: 16,
    intent: intent('app-shell/header', 'Top bar', 'locked'),
  } as any);

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
    intent: intent('app-shell/wordmark', 'reframe home', 'both'),
  } as any);
  graph.createNode('TEXT' as any, wordmark.id, {
    name: 'wordmark-text',
    text: 'reframe',
    fontSize: 14, fontFamily: 'JetBrains Mono', fontWeight: 500,
    width: 80, height: 20,
    fills: solidFill(THEME.TEXT_PRI),
    intent: intent('app-shell/wordmark-text', 'reframe', 'locked'),
  } as any);

  graph.createNode('FRAME' as any, header.id, {
    name: 'spacer',
    fills: [],
    layoutGrow: 1, height: 1, width: 1,
    intent: intent('app-shell/spacer', '', 'locked'),
  } as any);

  const themeToggle = graph.createNode('FRAME' as any, header.id, {
    name: 'theme-toggle',
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
    onClick: gesture('ui.toggleTheme', {}, 'local-state'),
    intent: intent('app-shell/theme-toggle', 'Toggle light/dark theme', 'both'),
  } as any);
  graph.createNode('TEXT' as any, themeToggle.id, {
    name: 'theme-glyph',
    text: '◐',
    fontSize: 14, fontFamily: 'Inter', fontWeight: 400,
    width: 16, height: 16,
    textAlignHorizontal: 'CENTER',
    fills: solidFill(THEME.TEXT_SEC),
    intent: intent('app-shell/theme-glyph', '', 'locked'),
  } as any);
}

function composeBody(graph: SceneGraph, parent: SceneNode, width: number, height: number, sidebarW: number, opts: AppShellOptions): void {
  const body = graph.createNode('FRAME' as any, parent.id, {
    name: 'body',
    width, height,
    fills: [],
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    itemSpacing: 0,
    intent: intent('app-shell/body', 'Sidebar + main', 'locked'),
  } as any);

  composeSidebar(graph, body, sidebarW, height, opts);
  composeMain(graph, body, width - sidebarW, height);
}

function composeSidebar(graph: SceneGraph, parent: SceneNode, width: number, height: number, opts: AppShellOptions): void {
  const sidebar = graph.createNode('FRAME' as any, parent.id, {
    name: 'sidebar',
    width, height,
    fills: solidFill(THEME.SURFACE),
    ...solidStroke(THEME.BORDER, 1),
    borderTopWeight: 0, borderBottomWeight: 0, borderLeftWeight: 0,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    paddingTop: 20, paddingBottom: 20, paddingLeft: 16, paddingRight: 16,
    itemSpacing: 4,
    intent: intent('app-shell/sidebar', 'Left nav', 'locked'),
  } as any);

  for (const item of opts.sidebarItems) {
    composeSidebarItem(graph, sidebar, item, width - 32);
  }

  if (opts.activeBrand) {
    graph.createNode('FRAME' as any, sidebar.id, {
      name: 'sidebar-spacer',
      fills: [],
      height: 16, width: 1,
      intent: intent('app-shell/sidebar-spacer', '', 'locked'),
    } as any);
    composeBrandPill(graph, sidebar, opts.activeBrand, width - 32);
  }
}

function composeSidebarItem(graph: SceneGraph, parent: SceneNode, item: AppShellSidebarItem, width: number): void {
  const isCurrent = !!item.current;
  const row = graph.createNode('FRAME' as any, parent.id, {
    name: item.href.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'nav-item',
    width, height: 32,
    cornerRadius: 6,
    fills: isCurrent ? solidFill(THEME.SURFACE_ELV) : [],
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    counterAxisAlign: 'CENTER',
    paddingLeft: 10, paddingRight: 10,
    itemSpacing: 8,
    semanticRole: 'link',
    focusable: true,
    href: item.href,
    onClick: gesture('browser.navigate', { url: item.href }, 'local-state'),
    intent: intent('app-shell/nav-item', `Navigate to ${item.label}`, 'both'),
  } as any);

  if (item.glyph) {
    graph.createNode('TEXT' as any, row.id, {
      name: 'glyph',
      text: item.glyph,
      fontSize: 14, fontFamily: 'Inter', fontWeight: 400,
      width: 16, height: 18,
      textAlignHorizontal: 'CENTER',
      fills: solidFill(isCurrent ? THEME.TEXT_PRI : THEME.TEXT_SEC),
      intent: intent('app-shell/nav-glyph', item.glyph, 'locked'),
    } as any);
  }

  graph.createNode('TEXT' as any, row.id, {
    name: 'label',
    text: item.label,
    fontSize: 13, fontFamily: 'Inter', fontWeight: isCurrent ? 500 : 400,
    width: width - 40, height: 18,
    fills: solidFill(isCurrent ? THEME.TEXT_PRI : THEME.TEXT_SEC),
    intent: intent('app-shell/nav-label', item.label, 'locked'),
  } as any);
}

function composeBrandPill(graph: SceneGraph, parent: SceneNode, brand: string, width: number): void {
  const pill = graph.createNode('FRAME' as any, parent.id, {
    name: 'brand-pill',
    width, height: 36,
    cornerRadius: 8,
    fills: [],
    ...solidStroke(THEME.BORDER_SUB, 1),
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    counterAxisAlign: 'CENTER',
    primaryAxisAlign: 'SPACE_BETWEEN',
    paddingLeft: 10, paddingRight: 10,
    itemSpacing: 8,
    intent: intent('app-shell/brand-pill', `Active brand ${brand}`, 'locked'),
  } as any);

  const left = graph.createNode('FRAME' as any, pill.id, {
    name: 'brand-left',
    fills: [],
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    counterAxisAlign: 'CENTER',
    itemSpacing: 8,
    intent: intent('app-shell/brand-left', '', 'locked'),
  } as any);

  graph.createNode('FRAME' as any, left.id, {
    name: 'brand-dot',
    width: 6, height: 6,
    cornerRadius: 3,
    fills: solidFill(THEME.ACCENT),
    intent: intent('app-shell/brand-dot', '', 'locked'),
  } as any);

  graph.createNode('TEXT' as any, left.id, {
    name: 'brand-label',
    text: brand,
    fontSize: 12, fontFamily: 'Inter', fontWeight: 500,
    width: 100, height: 18,
    fills: solidFill(THEME.TEXT_PRI),
    intent: intent('app-shell/brand-label', brand, 'locked'),
  } as any);

  const switchBtn = graph.createNode('FRAME' as any, pill.id, {
    name: 'brand-switch',
    cornerRadius: 4,
    fills: [],
    ...solidStroke(THEME.BORDER_SUB, 1),
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    height: 20,
    paddingLeft: 6, paddingRight: 6,
    counterAxisAlign: 'CENTER',
    semanticRole: 'button',
    focusable: true,
    onClick: gesture('ui.switchBrand', {}, 'local-state'),
    intent: intent('app-shell/brand-switch', 'Switch active brand', 'both'),
  } as any);
  graph.createNode('TEXT' as any, switchBtn.id, {
    name: 'switch-label',
    text: 'switch',
    fontSize: 9, fontFamily: 'JetBrains Mono', fontWeight: 500,
    width: 40, height: 12,
    textCase: 'UPPER',
    letterSpacing: 0.8,
    fills: solidFill(THEME.TEXT_MUT),
    intent: intent('app-shell/switch-label', 'switch', 'locked'),
  } as any);
}

function composeMain(graph: SceneGraph, parent: SceneNode, width: number, height: number): void {
  graph.createNode('FRAME' as any, parent.id, {
    name: 'main',
    width, height,
    fills: [],
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    mountSlot: { name: 'app-main', accepts: [] },
    intent: intent('app-shell/main', 'Page content slot', 'both'),
  } as any);
}
