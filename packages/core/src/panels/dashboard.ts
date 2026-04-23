// Dashboard panel — FULL self-host of /platform.
//
// Replaces the hand-written dashboard.ts HTML. Shows greeting + project
// card grid with thumbnails (background-image via meta.backgroundImage),
// plus Create Canvas action. Every project card is a click-to-navigate
// gesture to /platform/project/<slug>.
//
// Built entirely with buildPanel/buildSection/buildCard helpers —
// proves the Phase 4.5 helpers scale to a more complex page.

import { SceneGraph } from '../engine/scene-graph';
import type { AgentGesture, NodeIntent } from '../engine/types';
import {
  PANEL_COLORS, buildPanel, buildSection, buildGrid, buildText,
  solidFill, solidStroke, intent, gesture,
} from './helpers';

export interface DashboardProjectEntry {
  slug: string;
  /** Display name (after generic-tag fallback). */
  name: string;
  /** First scene's id — used for thumbnail URL. */
  ownerSceneId: string;
  /** Count of variants (>= 0). */
  variantCount: number;
  /** Total nodes across all variants. */
  totalNodes: number;
  /** Primary variant size. */
  width: number;
  height: number;
  /** Thumbnail URL — public PNG endpoint. */
  thumbnailUrl?: string;
  /** SVG cover fallback URL. */
  coverUrl?: string;
}

export interface DashboardOptions {
  greeting: string;
  sceneCount: number;
  projects: DashboardProjectEntry[];
  /** Panel width — typically 1280 (page.main for dashboard). */
  width?: number;
}

export function composeDashboardPanel(opts: DashboardOptions): SceneGraph {
  const width = opts.width ?? 1280;
  const graph = new SceneGraph();
  const root = buildPanel(graph, {
    name: 'dashboard',
    width,
    role: 'dashboard/root',
    purpose: 'Project overview',
    background: { r: 0.98, g: 0.965, b: 0.94 }, // matches Platform light bg
    padding: 40,
    itemSpacing: 32,
  });

  // ─── Greeting + counts ─────────────────────────
  const header = buildSection(graph, {
    parent: root,
    name: 'header',
    width: width - 80,
    role: 'dashboard/header',
    itemSpacing: 8,
  });
  buildText(graph, {
    parent: header,
    name: 'greeting',
    text: opts.greeting,
    style: 'title',
    width: width - 80,
    role: 'dashboard/greeting',
    color: 'SURFACE_BG',
  });
  const subtitleText = opts.projects.length === 0
    ? 'Nothing yet — create your first design below.'
    : opts.projects.length === 1 && opts.sceneCount === 1
      ? '1 project'
      : `${opts.projects.length} project${opts.projects.length === 1 ? '' : 's'} · ${opts.sceneCount} scene${opts.sceneCount === 1 ? '' : 's'}`;
  buildText(graph, {
    parent: header,
    name: 'subtitle',
    text: subtitleText,
    style: 'body',
    width: width - 80,
    role: 'dashboard/subtitle',
    color: 'TEXT_SECONDARY',
  });

  // ─── Create button ─────────────────────────────
  const actions = graph.createNode('FRAME' as any, root.id, {
    name: 'actions',
    width: width - 80,
    fills: [],
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'HUG',
    itemSpacing: 8,
    intent: intent('dashboard/actions-row', 'Primary actions', 'locked'),
  } as any);
  const createBtn = graph.createNode('FRAME' as any, actions.id, {
    name: 'create-canvas',
    height: 44,
    cornerRadius: 8,
    fills: solidFill({ r: 0.12, g: 0.12, b: 0.14 }),
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'CENTER',
    paddingLeft: 20,
    paddingRight: 20,
    semanticRole: 'button',
    focusable: true,
    onClick: gesture('browser.navigate', { url: '/platform/project/new' }, 'local-state'),
    intent: intent('dashboard/create-canvas', 'Create a new canvas', 'both'),
  } as any);
  graph.createNode('TEXT' as any, createBtn.id, {
    name: 'create-label',
    text: '+ Create Canvas',
    fontSize: 13,
    fontFamily: 'Inter',
    fontWeight: 500,
    width: 140,
    height: 20,
    textAlignHorizontal: 'CENTER',
    fills: solidFill({ r: 1, g: 1, b: 1, a: 1 }),
    intent: intent('dashboard/create-label', 'Create', 'locked'),
  } as any);

  // ─── Project card grid ─────────────────────────
  if (opts.projects.length > 0) {
    const gridSection = buildSection(graph, {
      parent: root,
      name: 'projects',
      width: width - 80,
      role: 'dashboard/projects-section',
      itemSpacing: 20,
    });
    const grid = buildGrid(graph, {
      parent: gridSection,
      name: 'project-grid',
      width: width - 80,
      role: 'dashboard/project-grid',
      itemSpacing: 16,
      counterAxisSpacing: 16,
    });
    for (const p of opts.projects) {
      composeProjectCard(graph, grid, p);
    }
  }

  return graph;
}

function composeProjectCard(graph: SceneGraph, parent: any, p: DashboardProjectEntry): void {
  const cardWidth = 280;
  const cardHeight = 220;
  const thumbHeight = 140;

  const card = graph.createNode('FRAME' as any, parent.id, {
    name: p.slug,
    width: cardWidth,
    height: cardHeight,
    cornerRadius: 12,
    fills: solidFill({ r: 1, g: 1, b: 1, a: 1 }),
    ...solidStroke({ r: 0.89, g: 0.88, b: 0.84 }, 1),
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    clipsContent: true,
    semanticRole: 'link',
    focusable: true,
    href: `/platform/project/${p.slug}`,
    onClick: gesture('browser.navigate', { url: `/platform/project/${p.slug}` }, 'local-state'),
    intent: intent('dashboard/project-card', `Open ${p.name}`, 'both'),
  } as any);

  // Thumbnail — background image via meta.backgroundImage.
  graph.createNode('FRAME' as any, card.id, {
    name: 'thumbnail',
    width: cardWidth,
    height: thumbHeight,
    fills: solidFill({ r: 0.94, g: 0.93, b: 0.91 }),
    intent: intent('dashboard/project-thumb', `Preview of ${p.name}`, 'locked'),
    meta: p.thumbnailUrl ? { backgroundImage: p.thumbnailUrl } : {},
  } as any);

  // Meta row — name + dims.
  const meta = graph.createNode('FRAME' as any, card.id, {
    name: 'meta',
    width: cardWidth,
    fills: [],
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    paddingTop: 12,
    paddingBottom: 12,
    paddingLeft: 14,
    paddingRight: 14,
    itemSpacing: 4,
    intent: intent('dashboard/project-meta', '', 'locked'),
  } as any);
  graph.createNode('TEXT' as any, meta.id, {
    name: 'project-name',
    text: p.name,
    fontSize: 14,
    fontFamily: 'Inter',
    fontWeight: 600,
    width: cardWidth - 28,
    height: 20,
    fills: solidFill({ r: 0.1, g: 0.1, b: 0.12 }),
    intent: intent('dashboard/project-name', p.name, 'locked'),
  } as any);
  const variantsLabel = p.variantCount === 0
    ? 'single scene'
    : `${p.variantCount} variant${p.variantCount === 1 ? '' : 's'}`;
  graph.createNode('TEXT' as any, meta.id, {
    name: 'project-dims',
    text: `${p.width}×${p.height} · ${variantsLabel} · ${p.totalNodes} nodes`,
    fontSize: 11,
    fontFamily: 'JetBrains Mono',
    fontWeight: 400,
    width: cardWidth - 28,
    height: 14,
    fills: solidFill({ r: 0.45, g: 0.43, b: 0.4 }),
    intent: intent('dashboard/project-dims', `${p.totalNodes} nodes`, 'locked'),
  } as any);
}
