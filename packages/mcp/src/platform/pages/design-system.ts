/**
 * Platform page: Design System (/platform/design-system).
 *
 * Phase 3.1 + 5.2 — fully self-hosted. Shell via app-shell composer,
 * page content via brand-gallery composer. Zero hand-written HTML.
 */

import { renderPanel } from '../panels.js';
import { renderPlatformShellPage } from './shell-boot.js';
import type { SidebarSceneItem, SidebarComponentItem, SidebarMacroItem } from '../layout.js';

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
  const pageRendered = renderPanel('brand-gallery', {
    brandSlug: data.brandSlug ?? data.activeBrand ?? data.brand,
  }, { projectDir: data.projectDir });

  return renderPlatformShellPage({
    title: 'reframe · design system',
    current: 'design-system',
    activeBrand: data.activeBrand ?? data.brand,
    pageHtml: pageRendered.html,
  });
}
