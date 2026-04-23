/**
 * Platform page: Components gallery (/platform/components).
 *
 * Phase 4.3 + 5.2 — fully self-hosted. Shell via app-shell composer.
 */

import { renderPanel } from '../panels.js';
import { renderPlatformShellPage } from './shell-boot.js';
import type { SidebarSceneItem, SidebarComponentItem, SidebarMacroItem } from '../layout.js';

interface ComponentsData {
  components: Array<{
    name: string;
    slug: string;
    description?: string;
    revision: number;
    slots: string[];
  }>;
  sidebarScenes?: SidebarSceneItem[];
  sidebarComponents?: SidebarComponentItem[];
  sidebarMacros?: SidebarMacroItem[];
  activeBrand?: string;
}

export function renderComponentsPage(data: ComponentsData): string {
  const entries = data.components.map(c => ({
    name: c.name,
    description: c.description ?? '—',
    meta: `rev ${c.revision} · ${c.slots.length} slot${c.slots.length === 1 ? '' : 's'}`,
    href: `#${c.slug}`,
  }));

  const lead = data.components.length === 0
    ? 'Reusable design pieces — headers, cards, pricing blocks. Extract a subtree from a scene to add it here.'
    : `${data.components.length} reusable piece${data.components.length === 1 ? '' : 's'} in this project. Drop any into a scene with the instantiate intent.`;

  const pageRendered = renderPanel('components-library', {
    title: 'Library',
    lead,
    emptyText: 'No components yet. Extract one from any scene to seed the library.',
    entries,
    width: 1220,
  }, {});

  return renderPlatformShellPage({
    title: 'reframe · library',
    current: 'components',
    activeBrand: data.activeBrand,
    pageHtml: pageRendered.html,
  });
}
