/**
 * Platform page: Macros gallery (/platform/macros).
 *
 * Phase 4.3 + 5.2 — fully self-hosted. Shell via app-shell composer.
 */

import { renderPanel } from '../panels.js';
import { renderPlatformShellPage } from './shell-boot.js';
import type { SidebarSceneItem, SidebarComponentItem, SidebarMacroItem } from '../layout.js';

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
    ? 'A recipe is a saved sequence of transformations — "brutalize this", "give me the editorial treatment". Save one via reframe_project save_macro.'
    : `${data.macros.length} recipe${data.macros.length === 1 ? '' : 's'}. Click a card to apply.`;

  const pageRendered = renderPanel('macros-library', {
    title: 'Recipes',
    lead,
    emptyText: 'No recipes yet. Save one via reframe_project save_macro.',
    entries,
    width: 1220,
  }, {});

  return renderPlatformShellPage({
    title: 'reframe · macros',
    current: 'macros',
    activeBrand: data.activeBrand,
    pageHtml: pageRendered.html,
  });
}
