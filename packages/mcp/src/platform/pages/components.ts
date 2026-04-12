/**
 * Platform page: Components gallery (/platform/components).
 *
 * Read-only view of the project's component registry. Each card shows the
 * master's name, description, slot count, and revision. Reuses .spec-card
 * from the shared CSS for consistency with other gallery pages.
 */

import { renderShell, renderSidebar, type SidebarSceneItem, type SidebarComponentItem, type SidebarMacroItem } from '../layout.js';

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

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderComponentsPage(data: ComponentsData): string {
  const main = data.components.length === 0
    ? `<div class="page">
        <h1 class="page-title">Library</h1>
        <p class="page-lead">Your reusable design pieces — headers, cards, pricing blocks, whatever you want to drop into scenes without rebuilding. Extract any subtree from a scene to add it here.</p>
      </div>`
    : `<div class="page">
        <h1 class="page-title">Library</h1>
        <p class="page-lead">${data.components.length} reusable piece${data.components.length === 1 ? '' : 's'} in this project. Drop any of them into a scene with the <code>instantiate</code> intent — they keep their master reference so updates propagate automatically.</p>
        <div class="card-grid">
          ${data.components.map(c => `<a class="spec-card" id="${escape(c.slug)}" href="#${escape(c.slug)}">
            <div class="name">${escape(c.name)}</div>
            <div class="desc">${escape(c.description ?? '—')}</div>
            <div class="meta">rev ${c.revision} · ${c.slots.length} slot${c.slots.length === 1 ? '' : 's'}</div>
          </a>`).join('')}
        </div>
      </div>`;

  return renderShell({
    title: 'reframe · library',
    main,
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
