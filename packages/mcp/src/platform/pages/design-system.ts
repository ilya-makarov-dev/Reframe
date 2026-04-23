/**
 * Platform page: Design System (/platform/design-system).
 *
 * Phase 3.1 — fully self-hosted through INode. The `main` slot is
 * rendered by the `brand-gallery` panel composer (see
 * packages/core/src/panels/brand-gallery.ts) via the panel registry.
 * Zero hand-written HTML remains in this file — the only decision left
 * here is how to shape the Data → PanelConfig mapping + which sidebar
 * items to surface alongside.
 *
 * Live-repaint: nodes carry meta.tokenBindings.fill roles, so every
 * swatch emits `background: var(--color-<role>)`. A brand.setToken
 * gesture broadcasts token:changed over SSE → client dispatcher patches
 * --color-<role> on documentElement → the entire gallery recolors
 * without re-render.
 *
 * Export DTCG: the Export button is an INode with
 * `onClick: { tool: 'browser.download', args: { url: '/api/tokens/<slug>?format=dtcg' } }`
 * — the client runtime dispatcher resolves browser.* locally and fires
 * an `<a href download>` click. No MCP roundtrip, no server mutation.
 */

import { renderShell, renderSidebar, type SidebarSceneItem, type SidebarComponentItem, type SidebarMacroItem } from '../layout.js';
import { renderPanel } from '../panels.js';

interface DesignSystemData {
  brand?: string;
  brandSlug?: string;
  sidebarScenes?: SidebarSceneItem[];
  sidebarComponents?: SidebarComponentItem[];
  sidebarMacros?: SidebarMacroItem[];
  activeBrand?: string;
  projectDir?: string;
}

export function renderDesignSystemPage(data: DesignSystemData): string {
  // Compose the entire main content as an INode panel. Panel composer
  // reads the brand's DESIGN.md from disk via projectDir + slug, parses
  // it, and emits a SceneGraph that gets exportToHtml'd with CSS vars.
  const rendered = renderPanel('brand-gallery', {
    brandSlug: data.brandSlug ?? data.activeBrand ?? data.brand,
  }, { projectDir: data.projectDir });

  return renderShell({
    title: 'reframe · design system',
    main: rendered.html,
    sidebar: renderSidebar({
      current: 'design-system',
      scenes: data.sidebarScenes ?? [],
      components: data.sidebarComponents ?? [],
      macros: data.sidebarMacros ?? [],
    }),
    activeBrand: data.activeBrand ?? data.brand,
    agentStatus: 'idle',
  });
}
