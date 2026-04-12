/**
 * Platform page: Macros gallery (/platform/macros).
 *
 * Lists every macro in the project with description and op count.
 * Clicking a card creates an `apply-macro` intent on the current scene
 * via the platform API — user then commits it from the stream.
 */

import { renderShell, renderSidebar, type SidebarSceneItem, type SidebarComponentItem, type SidebarMacroItem } from '../layout.js';

interface MacrosData {
  macros: Array<{
    name: string;
    slug?: string;
    description?: string;
    ops: number;
  }>;
  currentSceneSlug?: string;
  sidebarScenes?: SidebarSceneItem[];
  sidebarComponents?: SidebarComponentItem[];
  sidebarMacros?: SidebarMacroItem[];
  activeBrand?: string;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderMacrosPage(data: MacrosData): string {
  const main = data.macros.length === 0
    ? `<div class="page">
        <h1 class="page-title">Recipes</h1>
        <p class="page-lead">A recipe is a saved sequence of transformations you can apply to any scene — "brutalize this", "appleify this", "give me the editorial treatment". Placeholders (<code>$role:button</code>, <code>$role:heading[0]</code>) let one recipe work on any scene. Save one via <code>reframe_project save_macro</code>.</p>
      </div>`
    : `<div class="page" data-macro-current-scene="${escape(data.currentSceneSlug ?? '')}">
        <h1 class="page-title">Recipes</h1>
        <p class="page-lead">${data.macros.length} recipe${data.macros.length === 1 ? '' : 's'} available. Click a card to apply its transformation sequence to the current scene.</p>
        <div class="card-grid">
          ${data.macros.map(m => `<button class="spec-card macro-apply-btn" data-macro="${escape(m.name)}" type="button">
            <div class="name">${escape(m.name)}</div>
            <div class="desc">${escape(m.description ?? '—')}</div>
            <div class="meta">${m.ops} op${m.ops === 1 ? '' : 's'}</div>
          </button>`).join('')}
        </div>
      </div>`;

  return renderShell({
    title: 'reframe · macros',
    main,
    sidebar: renderSidebar({
      current: 'macros',
      scenes: data.sidebarScenes ?? [],
      components: data.sidebarComponents ?? [],
      macros: data.sidebarMacros ?? [],
    }),
    activeBrand: data.activeBrand,
    agentStatus: 'idle',
  });
}
