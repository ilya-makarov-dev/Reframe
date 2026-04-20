/**
 * Platform — Project Overview (/platform).
 *
 * Two states:
 * - Empty → entry funnel: two primary paths (Design from brief,
 *   Build from sections) + three secondary (Rebrand, Audit, API)
 *   + brand strip showcasing 60+ design systems.
 * - Has scenes → project card grid with thumbnails, quick action bar.
 *
 * Click a card → navigates to project canvas view.
 */

import {
  renderShell,
  renderSidebar,
  type SidebarSceneItem,
  type SidebarComponentItem,
  type SidebarMacroItem,
} from '../layout.js';
import type { ProjectGroup } from '../project-grouping.js';

interface DashboardData {
  scenes: Array<{
    id: string;
    slug: string;
    name: string;
    width: number;
    height: number;
    nodes: number;
  }>;
  /** Scenes grouped into projects via project-grouping.ts */
  projects: ProjectGroup[];
  // Kept for API compat with the router (which always builds these);
  // dashboard doesn't render a sidebar anymore, but scene pages do.
  sidebarScenes: SidebarSceneItem[];
  sidebarComponents: SidebarComponentItem[];
  sidebarMacros: SidebarMacroItem[];
  brands: string[];
  activeBrand?: string;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5)  return 'Still up.';
  if (h < 12) return 'Good morning.';
  if (h < 18) return 'Good afternoon.';
  return 'Good evening.';
}

// Includes both generic HTML tags (Linkedom lands here when no class/role
// stands out) and the auto-inferred INode names produced by the importer
// ("Stack" for column flex, "Row" for row flex, "Group"/"Frame"/"Canvas"
// for structural nodes). Falling back to the project slug keeps the card
// header readable ("qa-landing") instead of implementation detail ("Stack").
const GENERIC_TAGS = new Set([
  'div', 'span', 'section', 'main', 'header', 'footer', 'article', 'aside', 'nav',
  'stack', 'row', 'column', 'group', 'frame', 'canvas', 'body', 'html',
]);

export function renderDashboard(data: DashboardData): string {
  const main = data.scenes.length === 0
    ? renderEmpty()
    : renderOverview(data);

  return renderShell({
    title: 'reframe',
    main,
    sidebar: renderSidebar({
      current: 'home',
      activeBrand: data.activeBrand,
    }),
    activeBrand: data.activeBrand,
  });
}

// Project grouping happens server-side in router.ts via
// project-grouping.ts — the dashboard no longer classifies individual
// scenes into scenario buckets. Variants/brands/drafts navigation now
// lives on the project canvas page (/platform/project/:slug).

function renderOverview(data: DashboardData): string {
  // Projects are the first-class unit now. Each card represents a
  // group of related scenes (one "project" in Figma parlance — like a
  // file with multiple artboards). Clicking a project opens the canvas
  // view with all variants visible side-by-side.

  const projects = data.projects ?? [];

  const cards = projects.map(p => {
    const owner = p.members[0];
    const displayName = GENERIC_TAGS.has((p.name || '').toLowerCase()) ? p.slug : p.name;
    const totalNodes = p.members.reduce((sum, m) => sum + (m.nodes ?? 0), 0);
    const variantsLabel = p.variantCount === 0
      ? 'single scene'
      : `${p.variantCount} variant${p.variantCount === 1 ? '' : 's'}`;

    // The cover SVG is set as the thumb's background, so it shows
    // instantly and keeps showing if the raster PNG 404/500s (CanvasKit
    // cold-start, scene too large, etc). The PNG layers on top when it
    // loads; on error we simply hide the <img> and the cover remains.
    const coverUrl = `/cover/${escape(owner.id)}.svg?variants=${p.members.length}`;
    return `<div class="overview-card-wrap" data-project-slug="${escape(p.slug)}" data-scene-id="${escape(owner.id)}" data-project-name="${escape(displayName)}" data-testid="project-card">
      <a class="overview-card" data-testid="project-card-link" href="/platform/project/${escape(p.slug)}">
        <div class="overview-thumb" style="background-image:url('${coverUrl}');background-size:cover;background-position:center">
          <img src="/thumbnail/${escape(owner.id)}.png?scale=1" loading="lazy" alt="${escape(displayName)}" style="width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 240ms ease" onload="this.style.opacity=1" onerror="this.remove()">
          ${p.variantCount > 0 ? `<div class="overview-variant-badge">${p.members.length} scenes</div>` : ''}
        </div>
        <div class="overview-meta">
          <div class="overview-name">${escape(displayName)}</div>
          <div class="overview-dims">${owner.width ?? '?'}\u00D7${owner.height ?? '?'} \u00B7 ${variantsLabel} \u00B7 ${totalNodes} nodes</div>
        </div>
      </a>
      <button class="overview-card-delete" data-action="delete-project" data-project-slug="${escape(p.slug)}" title="Delete project (and all variants)" aria-label="Delete project ${escape(displayName)}">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M3 4h8M5.5 4V2.5h3V4M4 4l.5 8h5L10 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>`;
  }).join('');

  // Subtitle: show project + scene count without mentioning "this
  // project" (there is no enclosing project — this IS the project list)
  // and without the brand chip (brand lives in the sidebar).
  const subtitleText = projects.length === 0
    ? 'Nothing yet — create your first design below.'
    : projects.length === 1 && data.scenes.length === 1
      ? '1 project'
      : `${projects.length} project${projects.length === 1 ? '' : 's'} \u00B7 ${data.scenes.length} scene${data.scenes.length === 1 ? '' : 's'}`;

  return `<div class="overview">
    <div class="overview-header">
      <div class="overview-header-text">
        <h1 class="overview-title">${greeting()}</h1>
        <p class="overview-subtitle">${subtitleText}</p>
      </div>
    </div>
    <div class="overview-actions" style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm empty-path" data-kind="create-canvas" style="display:flex;align-items:center;gap:6px">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        Create Canvas
      </button>
    </div>
    <div class="overview-grid">${cards}</div>
  </div>`;
}

function renderEmpty(): string {
  return `<div class="dash-empty">
    <div class="dash-empty-inner">
      <h1 class="dash-greeting">${greeting()}</h1>

      <!-- PRIMARY: single clear entry point -->
      <div class="dash-primary-row">
        <button class="dash-primary-card empty-path" data-kind="create-canvas">
          <div class="dash-card-icon">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <rect x="3" y="3" width="22" height="22" rx="4" stroke="currentColor" stroke-width="1.6"/>
              <path d="M9 14h10M14 9v10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="dash-card-text">
            <span class="dash-card-title">Create Canvas</span>
            <span class="dash-card-desc">Start with an empty frame. Design directly, add sections, or let the agent build for you.</span>
          </div>
          <svg class="dash-card-arrow" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>

      </div>

      <!-- BRAND STRIP -->
      <div class="dash-brand-strip">
        <span class="dash-brand-label">60+ brand systems available</span>
        <div class="dash-brand-chips" data-brand-picker>
          ${[
            ['Stripe', 'stripe'], ['Linear', 'linear'], ['Vercel', 'vercel'],
            ['Notion', 'notion'], ['Spotify', 'spotify'], ['Airbnb', 'airbnb'],
            ['GitHub', 'github'], ['Figma', 'figma'], ['Arc', 'arc'],
            ['Supabase', 'supabase'], ['Raycast', 'raycast'], ['Loom', 'loom'],
          ].map(([label, slug]) =>
            `<button class="dash-brand-chip" data-brand-apply="${escape(slug)}" type="button">${escape(label)}</button>`
          ).join('')}
          <a class="dash-brand-chip dash-brand-more" href="/platform/design-system">Browse all</a>
        </div>
      </div>
    </div>
  </div>`;
}
