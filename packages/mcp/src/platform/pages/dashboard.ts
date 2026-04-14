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
          <img src="/thumbnail/${escape(owner.id)}.png?scale=1" loading="lazy" alt="${escape(displayName)}" style="width:100%;height:100%;object-fit:cover" onerror="this.onerror=null;this.parentNode.innerHTML='<iframe src=/preview/${escape(owner.id)} loading=lazy tabindex=-1></iframe>'">
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
      <button class="btn btn-secondary btn-sm empty-path" data-kind="describe" style="display:flex;align-items:center;gap:6px"><span style="font-size:14px">🎨</span> Design</button>
      <a href="/platform/blocks" class="btn btn-secondary btn-sm" style="display:flex;align-items:center;gap:6px;text-decoration:none"><span style="font-size:14px">🧱</span> Build from blocks</a>
      <button class="btn btn-secondary btn-sm empty-path" data-kind="html" style="display:flex;align-items:center;gap:6px"><span style="font-size:14px">🔄</span> Rebrand</button>
      <button class="btn btn-secondary btn-sm empty-path" data-kind="audit" style="display:flex;align-items:center;gap:6px"><span style="font-size:14px">📊</span> Audit</button>
      <a href="/platform/batch" class="btn btn-secondary btn-sm" style="display:flex;align-items:center;gap:6px;text-decoration:none"><span style="font-size:14px">📦</span> Batch export</a>
    </div>
    <div class="overview-grid">${cards}</div>
  </div>`;
}

function renderEmpty(): string {
  return `<div class="cosmos">
    ${renderStarField()}
    <div class="content">
      <h1 class="headline" style="font-size:36px;line-height:1.2;margin-bottom:12px">${greeting()}</h1>
      <p class="body" style="font-size:18px;opacity:0.7;margin-bottom:48px">What do you want to create?</p>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;max-width:720px;margin:0 auto 48px">
        <button class="empty-path" data-kind="describe" style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:32px 20px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;cursor:pointer;color:var(--text-primary);transition:all 0.2s">
          <span style="font-size:32px">🎨</span>
          <span style="font-size:15px;font-weight:600">Design</span>
          <span style="font-size:12px;opacity:0.5;text-align:center">AI writes full page<br>from your brief</span>
        </button>
        <button class="empty-path" data-kind="blocks" style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:32px 20px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;cursor:pointer;color:var(--text-primary);transition:all 0.2s"
          onclick="window.location='/platform/blocks'">
          <span style="font-size:32px">🧱</span>
          <span style="font-size:15px;font-weight:600">Build</span>
          <span style="font-size:12px;opacity:0.5;text-align:center">Pick sections from<br>block library</span>
        </button>
        <button class="empty-path" data-kind="html" style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:32px 20px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;cursor:pointer;color:var(--text-primary);transition:all 0.2s">
          <span style="font-size:32px">🔄</span>
          <span style="font-size:15px;font-weight:600">Rebrand</span>
          <span style="font-size:12px;opacity:0.5;text-align:center">Paste HTML, apply<br>any brand</span>
        </button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;max-width:480px;margin:0 auto">
        <button class="empty-path" data-kind="audit" style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:24px 20px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;cursor:pointer;color:var(--text-primary);transition:all 0.2s">
          <span style="font-size:24px">📊</span>
          <span style="font-size:14px;font-weight:600">Quality Audit</span>
          <span style="font-size:11px;opacity:0.5">Check any design</span>
        </button>
        <a href="/platform/api-docs" style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:24px 20px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;cursor:pointer;color:var(--text-primary);transition:all 0.2s;text-decoration:none">
          <span style="font-size:24px">🔌</span>
          <span style="font-size:14px;font-weight:600">API Pipeline</span>
          <span style="font-size:11px;opacity:0.5">REST + batch export</span>
        </a>
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
