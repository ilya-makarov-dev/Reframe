/**
 * Platform page: Components gallery (/platform/components).
 *
 * Phase 4.3 — FULL self-hosted via the `components-library` panel.
 * Card entries link to #<slug> anchors (preserves the legacy deep-link
 * behavior). Router still builds the {components} list; this file just
 * maps it into LibraryEntry shape and hands to the panel registry.
 */

import { renderShell, renderSidebar, type SidebarSceneItem, type SidebarComponentItem, type SidebarMacroItem } from '../layout.js';
import { renderPanel } from '../panels.js';

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
    ? 'Your reusable design pieces — headers, cards, pricing blocks, anything you drop into scenes without rebuilding. Extract a subtree from a scene to add it here.'
    : `${data.components.length} reusable piece${data.components.length === 1 ? '' : 's'} in this project. Drop any of them into a scene with the instantiate intent — they keep their master reference so updates propagate automatically.`;

  const rendered = renderPanel('components-library', {
    title: 'Library',
    lead,
    emptyText: 'No components yet. Extract one from any scene to seed the library.',
    entries,
    width: 1280,
  }, {});

  return renderShell({
    title: 'reframe · library',
    main: rendered.html,
    sidebar: renderSidebar({
      current: 'components',
      scenes: data.sidebarScenes ?? [],
      components: data.sidebarComponents ?? [],
      macros: data.sidebarMacros ?? [],
    }),
    activeBrand: data.activeBrand,
    agentStatus: 'idle',
  });
}
