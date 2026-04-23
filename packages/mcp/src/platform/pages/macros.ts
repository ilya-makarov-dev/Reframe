/**
 * Platform page: Macros gallery (/platform/macros).
 *
 * Phase 4.3 — FULL self-hosted via the `macros-library` panel. Cards
 * fire an apply-macro gesture against the currentSceneSlug via the
 * MCP bridge (reframe_edit op=applyMacro, to be handled by the
 * agent-runtime tool registry in a future pass).
 */

import { renderShell, renderSidebar, type SidebarSceneItem, type SidebarComponentItem, type SidebarMacroItem } from '../layout.js';
import { renderPanel } from '../panels.js';

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

export function renderMacrosPage(data: MacrosData): string {
  const entries = data.macros.map(m => ({
    name: m.name,
    description: m.description ?? '—',
    meta: `${m.ops} op${m.ops === 1 ? '' : 's'}`,
    onClick: {
      tool: 'reframe_edit',
      args: {
        op: 'applyMacro',
        sceneId: data.currentSceneSlug ?? '',
        macroName: m.name,
      },
      fastPath: 'optimistic-ui' as const,
    },
  }));

  const lead = data.macros.length === 0
    ? 'A recipe is a saved sequence of transformations you can apply to any scene — "brutalize this", "appleify this", "give me the editorial treatment". Save one via reframe_project save_macro.'
    : `${data.macros.length} recipe${data.macros.length === 1 ? '' : 's'} available. Click a card to apply its transformation sequence to the current scene.`;

  const rendered = renderPanel('macros-library', {
    title: 'Recipes',
    lead,
    emptyText: 'No recipes yet. Save one via reframe_project save_macro to seed.',
    entries,
    width: 1280,
  }, {});

  return renderShell({
    title: 'reframe · macros',
    main: rendered.html,
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
