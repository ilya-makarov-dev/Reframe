/**
 * Platform — Project Overview (/platform).
 *
 * NOT a "hello, no scenes" page anymore. This is the PROJECT MAP —
 * a live overview of every scene with metadata (audit score, brand,
 * variants, AI threads). Scenes are cards with thumbnails. Variants
 * are nested sub-cards. Project health bar at the bottom.
 *
 * When the project is empty → cosmos welcome (the one serif moment).
 * When there are scenes → overview map.
 *
 * Click a card → navigates to scene view (with scale-in animation).
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

const GENERIC_TAGS = new Set(['div', 'span', 'section', 'main', 'header', 'footer', 'article', 'aside', 'nav']);

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

    return `<div class="overview-card-wrap" data-project-slug="${escape(p.slug)}" data-scene-id="${escape(owner.id)}" data-project-name="${escape(displayName)}">
      <a class="overview-card" href="/platform/project/${escape(p.slug)}">
        <div class="overview-thumb">
          <iframe src="/preview/${escape(owner.id)}" loading="lazy" tabindex="-1"></iframe>
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
    <div class="overview-actions">
      <button class="btn btn-secondary btn-sm empty-path" data-kind="describe">+ Describe</button>
      <button class="btn btn-secondary btn-sm empty-path" data-kind="url">+ Import URL</button>
      <button class="btn btn-secondary btn-sm empty-path" data-kind="brand">+ From brand</button>
      <button class="btn btn-secondary btn-sm empty-path" data-kind="html">+ Paste HTML</button>
    </div>
    <div class="overview-grid">${cards}</div>
  </div>`;
}

function renderEmpty(): string {
  return `<div class="cosmos">
    ${renderStarField()}
    <div class="content">
      <h1 class="headline">${greeting()}<br/>No scenes yet.</h1>
      <p class="body">Describe what you want to build, drop in HTML, or start from one of the 60+ brands in the catalog.</p>
      <div class="actions">
        <button class="btn btn-primary empty-path" data-kind="describe">Describe a scene</button>
        <button class="btn btn-secondary empty-path" data-kind="url">Import URL</button>
        <button class="btn btn-secondary empty-path" data-kind="brand">From a brand</button>
        <button class="btn btn-secondary empty-path" data-kind="html">Paste HTML</button>
      </div>
    </div>
  </div>`;
}

function renderStarField(): string {
  let seed = 0x12345678;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xFFFFFFFF; };
  const stars: string[] = [];
  const w = 1600, h = 900;
  for (let i = 0; i < 180; i++) stars.push(`<circle cx="${Math.round(rand()*w)}" cy="${Math.round(rand()*h)}" r="0.5" opacity="0.25"/>`);
  for (let i = 0; i < 90; i++) stars.push(`<circle cx="${Math.round(rand()*w)}" cy="${Math.round(rand()*h)}" r="0.8" opacity="0.5"/>`);
  for (let i = 0; i < 30; i++) stars.push(`<circle cx="${Math.round(rand()*w)}" cy="${Math.round(rand()*h)}" r="1.4" opacity="0.85"/>`);
  for (let i = 0; i < 6; i++) stars.push(`<circle cx="${Math.round(rand()*w)}" cy="${Math.round(rand()*h)}" r="2" opacity="1"/>`);
  return `<svg class="starfield" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${stars.join('')}</svg>`;
}
