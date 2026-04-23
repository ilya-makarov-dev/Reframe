/**
 * Platform page: Dashboard (/platform).
 *
 * Phase 4.2 + 5.2 — FULL self-hosted through INode. Both the shell
 * (header + sidebar + chrome) AND the main content (project grid)
 * are now composer-emitted. Zero hand-written HTML remains in this
 * file — it's purely data mapping + two renderPanel calls + server-
 * side slot hydration.
 */

import type { ProjectGroup } from '../project-grouping.js';
import { renderPanel } from '../panels.js';
import { escape as esc, renderPlatformShellPage } from './shell-boot.js';
import type { SidebarSceneItem, SidebarComponentItem, SidebarMacroItem } from '../layout.js';

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

  const pageRendered = renderPanel('dashboard', {
    greeting: greeting(),
    sceneCount: data.scenes.length,
    projects,
    width: 1220,
  }, {});

  return renderPlatformShellPage({
    title: 'reframe',
    current: 'home',
    activeBrand: data.activeBrand,
    pageHtml: pageRendered.html,
  });
}
