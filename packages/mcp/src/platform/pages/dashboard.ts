/**
 * Platform page: Dashboard (/platform).
 *
 * Phase 4.2 — FULL self-hosted through INode. The `main` slot is
 * rendered by the `dashboard` panel composer via the panel registry.
 * Zero hand-written dashboard HTML remains in this file.
 *
 * The router's buildDashboardData populates { greeting, sceneCount,
 * projects } and the panel does the rest.
 */

import {
  renderShell,
  renderSidebar,
  type SidebarSceneItem,
  type SidebarComponentItem,
  type SidebarMacroItem,
} from '../layout.js';
import type { ProjectGroup } from '../project-grouping.js';
import { renderPanel } from '../panels.js';

interface DashboardData {
  scenes: Array<{
    id: string;
    slug: string;
    name: string;
    width: number;
    height: number;
    nodes: number;
  }>;
  projects: ProjectGroup[];
  sidebarScenes: SidebarSceneItem[];
  sidebarComponents: SidebarComponentItem[];
  sidebarMacros: SidebarMacroItem[];
  brands: string[];
  activeBrand?: string;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5)  return 'Still up.';
  if (h < 12) return 'Good morning.';
  if (h < 18) return 'Good afternoon.';
  return 'Good evening.';
}

// Generic tag names the importer emits for unnamed-structural nodes.
// When a project's header-name hits one of these, fall back to the slug
// so cards read "qa-landing" instead of "Stack".
const GENERIC_TAGS = new Set([
  'div', 'span', 'section', 'main', 'header', 'footer', 'article', 'aside', 'nav',
  'stack', 'row', 'column', 'group', 'frame', 'canvas', 'body', 'html',
]);

export function renderDashboard(data: DashboardData): string {
  const projects = (data.projects ?? []).map(p => {
    const owner = p.members[0];
    const displayName = GENERIC_TAGS.has((p.name || '').toLowerCase()) ? p.slug : p.name;
    const totalNodes = p.members.reduce((sum, m) => sum + (m.nodes ?? 0), 0);
    return {
      slug: p.slug,
      name: displayName,
      ownerSceneId: owner.id,
      variantCount: p.variantCount,
      totalNodes,
      width: owner.width ?? 0,
      height: owner.height ?? 0,
      thumbnailUrl: `/thumbnail/${owner.id}.png?scale=1`,
      coverUrl: `/cover/${owner.id}.svg?variants=${p.members.length}`,
    };
  });

  const rendered = renderPanel('dashboard', {
    greeting: greeting(),
    sceneCount: data.scenes.length,
    projects,
    width: 1280,
  }, {});

  return renderShell({
    title: 'reframe',
    main: rendered.html,
    sidebar: renderSidebar({
      current: 'home',
      activeBrand: data.activeBrand,
    }),
    activeBrand: data.activeBrand,
  });
}
