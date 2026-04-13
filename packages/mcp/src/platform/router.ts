/**
 * Platform router — dispatches `/platform/*` URLs to page renderers.
 *
 * Called from `http-server.ts` as the first handler for platform URLs. When
 * the URL doesn't match a known platform route, returns null and the sidecar
 * falls through to its legacy dashboard / scene preview handlers.
 *
 * Pages return an HTML string that the router writes as the response body.
 * API routes under `/platform/api/*` return JSON via the separate api
 * module — see api/intent.ts.
 *
 * Keep this file thin: routing logic only. Page renderers live in pages/,
 * API handlers in api/.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { PLATFORM_CSS } from './style.js';
import { PLATFORM_JS } from './scripts.js';
import { renderDashboard } from './pages/dashboard.js';
// renderScenePage was the old /platform/scene/:slug renderer — we now
// redirect that route to the project canvas and keep buildScenePage as
// a dead function (still referenced by nothing). Both stay in the file
// for backward compat with potential future re-introduction.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { renderScenePage as _renderScenePage } from './pages/scene.js';
void _renderScenePage;
import { renderProjectCanvas } from './pages/project-canvas.js';
import { findProjectBySlug } from './project-grouping.js';
import { renderComponentsPage } from './pages/components.js';
import { renderDesignSystemPage } from './pages/design-system.js';
import { renderMacrosPage } from './pages/macros.js';
import { handleIntentApi } from './api/intent.js';
import { handleGestureApi } from './api/gesture.js';
import { handleNodeEditApi } from './api/node-edit.js';
import { handleVariationsApi } from './api/variations.js';
import { renderShell, renderSidebar } from './layout.js';
import type { SidebarSceneItem, SidebarComponentItem, SidebarMacroItem } from './layout.js';
import { hydrateShell } from './hydrate.js';

// ─── Types ───────────────────────────────────────────────────

export interface PlatformContext {
  /** Open project dir (null when no project). */
  projectDir: string | null;
  /** Session scene list (from store). */
  sessionScenes: Array<{
    id: string;
    slug: string;
    name: string;
    size: string;
    nodes: number;
    width?: number;
    height?: number;
  }>;
  /** Lookup a scene by id/slug — returns { graph, rootId } if found. */
  getScene: (id: string) => { id: string; slug: string; graph: any; rootId: string; name?: string; brand?: string } | null;
  /** Read design system markdown (if any). */
  getDesignMd: () => string | null;
  /** Audit score of the active scene (if computed). */
  getAuditScore?: (sceneId: string) => number | undefined;
}

// ─── Main entry ─────────────────────────────────────────────

/**
 * Attempts to handle a /platform/... URL. Returns true when handled,
 * false when the caller should fall through to the next handler.
 */
export async function handlePlatformRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PlatformContext,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  // ── Static assets ────────────────────
  // Cache aggressively: the HTML embeds a version token on every asset
  // URL (?v=<timestamp>), so each new sidecar start produces fresh URLs
  // and the browser treats them as different resources. That means we
  // can safely tell the browser "cache this forever" — no revalidation
  // cost per page load. This is the single biggest performance win
  // (was: re-downloading 160KB of CSS+JS on every navigation).
  const STATIC_CACHE = 'public, max-age=604800, immutable';
  if (pathname === '/platform/style.css' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': STATIC_CACHE,
    });
    res.end(PLATFORM_CSS);
    return true;
  }
  if (pathname === '/platform/app.js' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': STATIC_CACHE,
    });
    res.end(PLATFORM_JS);
    return true;
  }
  // Tiny theme-init script — reads localStorage and applies data-theme
  // to <html> BEFORE body renders, preventing a flash of wrong palette.
  // Served as an external file (not inlined) so strict CSP doesn't
  // block it.
  if (pathname === '/platform/theme-init.js' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': STATIC_CACHE,
    });
    res.end(`(function(){try{var t=localStorage.getItem('reframe-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(_){}})();`);
    return true;
  }

  // ── API ──────────────────────────────
  if (pathname.startsWith('/platform/api/')) {
    // Direct node editing + undo + audit + brands — the design tool backbone.
    if (pathname.startsWith('/platform/api/node/') ||
        pathname.startsWith('/platform/api/scene/') ||
        pathname === '/platform/api/undo' ||
        pathname === '/platform/api/audit' ||
        pathname.startsWith('/platform/api/audit/') ||
        pathname === '/platform/api/brands' ||
        pathname === '/platform/api/brand/switch' ||
        pathname === '/platform/api/ops' ||
        pathname.startsWith('/platform/api/history/') ||
        pathname === '/platform/api/scene/tree' ||
        pathname === '/platform/api/project/health' ||
        pathname === '/platform/api/publish-shell' ||
        pathname === '/platform/api/import') {
      return handleNodeEditApi(req, res, ctx);
    }
    // Gesture + annotations endpoints handled by the gesture module.
    if (pathname === '/platform/api/gesture' ||
        pathname === '/platform/api/annotate-transition' ||
        pathname.startsWith('/platform/api/annotations/') ||
        pathname.startsWith('/platform/api/threads/')) {
      return handleGestureApi(req, res, ctx);
    }
    // Rebrand + variations (design space explorer) endpoints
    if (pathname === '/platform/api/rebrand/apply' ||
        pathname.startsWith('/platform/api/variations/')) {
      return handleVariationsApi(req, res, ctx);
    }
    return handleIntentApi(req, res, ctx);
  }

  // ── Pages (compiled scene → hydrate, fallback → TypeScript renderer) ──
  const forceFallback = url.searchParams.get('fallback') === '1';

  if (pathname === '/platform' || pathname === '/platform/') {
    // Always use the TS renderer — the pre-compiled hydrateShell path
    // served stale HTML from before project grouping + variations were
    // added, and bypassing our new render logic silently broke the UI.
    const data = buildDashboardData(ctx);
    const html = renderDashboard(data);
    send(res, 200, 'text/html', html);
    return true;
  }

  // Project canvas — /platform/project/:slug
  // Figma-style infinite canvas rendering all variants of a project
  // (all scenes grouped under one common parent/prefix). Pan/zoom UX
  // is provided by client-side scripts; server just emits absolutely-
  // positioned iframe placeholders.
  if (pathname.startsWith('/platform/project/')) {
    const slug = decodeURIComponent(pathname.slice('/platform/project/'.length));
    if (!slug) {
      send(res, 404, 'text/plain', 'Project slug required');
      return true;
    }
    const data = buildDashboardData(ctx);
    const project = findProjectBySlug(data.projects ?? [], slug);
    if (!project) {
      send(res, 404, 'text/html', '<h1>Project not found</h1><p><a href="/platform">Back to dashboard</a></p>');
      return true;
    }
    const html = renderProjectCanvas({
      project,
      allScenesCount: data.scenes.length,
      activeBrand: data.activeBrand,
      brands: data.brands,
    });
    send(res, 200, 'text/html', html);
    return true;
  }

  if (pathname === '/platform/components') {
    const data = buildComponentsData(ctx);
    if (!forceFallback) {
      const hydrated = hydrateShell(ctx.projectDir, 'components', {
        'page-title': 'Components',
        'page-lead': data.components.length === 0
          ? 'No components registered yet.'
          : `${data.components.length} component master${data.components.length === 1 ? '' : 's'}`,
        'component-grid': data.components.map((c: any) =>
          `<a class="spec-card" id="${esc(c.slug)}" href="#${esc(c.slug)}"><div class="name">${esc(c.name)}</div><div class="desc">${esc(c.description ?? '—')}</div><div class="meta">rev ${c.revision} · ${(c.slots || []).length} slot${(c.slots || []).length === 1 ? '' : 's'}</div></a>`
        ).join(''),
      });
      if (hydrated) { send(res, 200, 'text/html', hydrated); return true; }
    }
    const html = renderComponentsPage(data);
    send(res, 200, 'text/html', html);
    return true;
  }

  if (pathname === '/platform/design-system') {
    if (!forceFallback) {
      const hydrated = hydrateShell(ctx.projectDir, 'design-system', {});
      if (hydrated) { send(res, 200, 'text/html', hydrated); return true; }
    }
    const html = renderDesignSystemPage(buildDesignSystemData(ctx));
    send(res, 200, 'text/html', html);
    return true;
  }

  if (pathname === '/platform/macros') {
    const data = buildMacrosData(ctx);
    if (!forceFallback) {
      const hydrated = hydrateShell(ctx.projectDir, 'macros', {
        'page-title': 'Macros',
        'page-lead': data.macros.length === 0
          ? 'No macros saved.'
          : `${data.macros.length} macro${data.macros.length === 1 ? '' : 's'}`,
        'macro-grid': data.macros.map((m: any) =>
          `<button class="spec-card macro-apply-btn" data-macro="${esc(m.slug)}" data-macro-current-scene="${esc((data as any).currentSceneSlug ?? '')}"><div class="name">${esc(m.name)}</div><div class="desc">${esc(m.description ?? '—')}</div><div class="meta">${m.ops} op${m.ops === 1 ? '' : 's'}</div></button>`
        ).join(''),
      });
      if (hydrated) { send(res, 200, 'text/html', hydrated); return true; }
    }
    const html = renderMacrosPage(data);
    send(res, 200, 'text/html', html);
    return true;
  }

  if (pathname === '/platform/api-docs') {
    const apiDocsHtml = renderShell({
      title: 'API Explorer',
      sidebar: renderSidebar({ current: 'home' as any }),
      main: `
        <div style="padding:32px 40px;max-width:1000px">
          <h1 class="t-title" style="font-size:28px;font-weight:700;margin:0 0 8px">Headless API</h1>
          <p class="t-body" style="color:var(--text-muted);margin:0 0 32px">REST endpoints for programmatic design rendering. Base URL: <code style="background:var(--surface-sunken);padding:2px 6px;border-radius:4px">http://localhost:4100/api</code></p>
          ${[
            { method: 'GET', path: '/api/render/{sceneId}', params: 'format, brand, width, height, scale, mode', desc: 'Render a scene to any format with optional brand/viewport' },
            { method: 'POST', path: '/api/render/batch', params: 'sceneId, formats[], brands[], viewports[]', desc: 'Cartesian product batch — N brands \u00D7 M viewports \u00D7 K formats' },
            { method: 'GET', path: '/api/tokens/{sceneId}', params: 'format=dtcg', desc: 'Export design tokens in W3C DTCG 2025.10 format' },
            { method: 'POST', path: '/api/tokens/{sceneId}', params: 'DTCG JSON body', desc: 'Import tokens from DTCG JSON' },
            { method: 'GET', path: '/api/audit/{sceneId}', params: 'aesthetic=true', desc: 'Run 30+ audit rules + aesthetic quality scoring' },
            { method: 'GET', path: '/api/blocks', params: 'category', desc: 'Browse block library (20+ section templates)' },
            { method: 'POST', path: '/api/blocks/instantiate', params: 'name, slots, brand', desc: 'Create scene from block template' },
            { method: 'GET', path: '/api/scenes', params: '', desc: 'List all session scenes' },
            { method: 'GET', path: '/thumbnail/{sceneId}.png', params: 'scale', desc: 'Raster thumbnail via CanvasKit' },
          ].map(ep => `
            <div style="padding:16px;border:1px solid var(--border);border-radius:8px;margin-bottom:12px">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                <span style="background:${ep.method === 'GET' ? '#22c55e' : '#3b82f6'};color:white;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;font-family:var(--mono)">${ep.method}</span>
                <code style="font-family:var(--mono);font-size:14px">${ep.path}</code>
              </div>
              <div class="t-body" style="color:var(--text-muted);font-size:13px">${ep.desc}</div>
              ${ep.params ? `<div style="margin-top:6px;font-size:12px;color:var(--text-muted)">Params: <code>${ep.params}</code></div>` : ''}
            </div>
          `).join('')}
        </div>
      `,
    });
    send(res, 200, 'text/html', apiDocsHtml);
    return true;
  }

  if (pathname === '/platform/quality') {
    const scenes = ctx.sessionScenes ?? [];
    const qualityHtml = renderShell({
      title: 'Quality Dashboard',
      sidebar: renderSidebar({ current: 'home' as any }),
      main: `
        <div style="padding:32px 40px;max-width:1000px">
          <h1 class="t-title" style="font-size:28px;font-weight:700;margin:0 0 8px">Quality Dashboard</h1>
          <p class="t-body" style="color:var(--text-muted);margin:0 0 32px">Aesthetic quality scores across all scenes. Click "Analyze All" to compute.</p>
          <button data-quality-all class="btn-primary" style="padding:10px 24px;background:var(--accent);color:var(--on-accent);border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:24px"
            onclick="this.textContent='Analyzing...';this.disabled=true;Promise.all(${JSON.stringify(scenes.map((s: any) => s.id))}.map(function(id){return fetch('/platform/api/aesthetic/'+id).then(function(r){return r.json()})})).then(function(results){var el=document.querySelector('[data-quality-grid]');if(!el)return;el.innerHTML=results.map(function(r,i){if(!r.ok)return '';return '<div style=\\'padding:16px;border:1px solid var(--border);border-radius:8px\\'><div style=\\'font-weight:600\\'>'+${JSON.stringify(scenes.map((s: any) => s.name))}[i]+'</div><div style=\\'font-size:48px;font-weight:800;color:var(--accent);margin:8px 0\\'>'+r.overall+'%</div><div style=\\'color:var(--text-muted);font-size:13px\\'>'+r.overallRating+'</div></div>'}).join('')}).catch(function(){}).finally(function(){var btn=document.querySelector('[data-quality-all]');if(btn){btn.textContent='Re-analyze';btn.disabled=false}})">
            Analyze All
          </button>
          <div data-quality-grid style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px">
            ${scenes.length === 0 ? '<div class="t-body" style="color:var(--text-muted)">No scenes. Compile a design first.</div>' : '<div class="t-body" style="color:var(--text-muted)">Click "Analyze All" to compute scores.</div>'}
          </div>
        </div>
      `,
    });
    send(res, 200, 'text/html', qualityHtml);
    return true;
  }

  if (pathname === '/platform/batch') {
    const { renderBatchPage } = await import('./pages/batch.js');
    const scenes = ctx.sessionScenes.map((s: any) => ({ id: s.id, slug: s.slug, name: s.name }));
    const brands = (ctx as any).brands ?? [];
    send(res, 200, 'text/html', renderBatchPage({ scenes, brands }));
    return true;
  }

  if (pathname === '/platform/blocks') {
    // Block library page — server-rendered list of available blocks
    try {
      const blocksModule = await import('../../../core/src/blocks/index.js');
      if (blocksModule.blockCount() === 0) blocksModule.registerStarterBlocks();
      const categoryFilter = url.searchParams.get('category') ?? undefined;
      const blocks: any[] = blocksModule.listBlocks(categoryFilter as any);
      const categories = [...new Set(blocks.map((b: any) => b.category))].sort();

      const categoryNav = categories.map((c: string) => {
        const isActive = c === categoryFilter ? ' style="font-weight:700;color:var(--accent)"' : '';
        return `<a href="/platform/blocks?category=${c}" class="t-body"${isActive}>${c} (${blocks.filter((b: any) => b.category === c).length})</a>`;
      }).join(' \u00b7 ');

      const blockCards = blocks.map((b: any) =>
        `<div class="spec-card" style="padding:16px;cursor:pointer;position:relative" data-block-name="${esc(b.name)}">
          <div class="name" style="font-weight:600">${esc(b.name)}</div>
          <div class="desc" style="font-size:13px;color:var(--text-muted);margin-top:4px">${esc(b.description)}</div>
          <div class="meta" style="font-size:12px;color:var(--text-muted);margin-top:8px">${b.slots.length} slot${b.slots.length === 1 ? '' : 's'} \u00b7 ${esc(b.category)}${b.tags ? ' \u00b7 ' + b.tags.join(', ') : ''}</div>
          <button onclick="event.stopPropagation();fetch('/api/blocks/instantiate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'${esc(b.name)}'})}).then(r=>r.json()).then(d=>{if(d.sceneId)window.location='/platform/project/'+encodeURIComponent('${esc(b.name)}')}).catch(e=>alert('Error: '+e.message))"
            style="margin-top:12px;padding:6px 16px;background:var(--accent);color:var(--on-accent);border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;width:100%">
            Add to page
          </button>
        </div>`
      ).join('\n');

      const pageHtml = renderShell({
        title: 'Block Library',
        sidebar: renderSidebar({
          current: 'blocks',
        }),
        main: `
          <div style="padding:32px 40px;max-width:1200px">
            <h1 class="t-title" style="font-size:28px;font-weight:700;margin:0 0 8px">Block Library</h1>
            <p class="t-body" style="color:var(--text-muted);margin:0 0 24px">${blocks.length} blocks across ${categories.length} categories.</p>
            <div style="margin-bottom:24px">${categoryNav}${categoryFilter ? ' \u00b7 <a href="/platform/blocks" class="t-body">All</a>' : ''}</div>
            <div class="component-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
              ${blockCards || '<div class="t-body" style="color:var(--text-muted)">No blocks found.</div>'}
            </div>
          </div>
        `,
        rightPanel: '',
      });
      send(res, 200, 'text/html', pageHtml);
    } catch (err: any) {
      send(res, 500, 'text/plain', `Block library error: ${err.message}`);
    }
    return true;
  }

  // ── Legacy scene route → canvas redirect ─────────────────
  // The isolated-scene page (/platform/scene/:slug) used to be the
  // primary edit surface, but we consolidated everything onto the
  // project canvas. Scene slugs either match a project (owner slug =
  // project slug) or belong to a project as a variant/member. Either
  // way, the project canvas is where editing happens now — redirect
  // permanently so bookmarks still work.
  const sceneMatch = pathname.match(/^\/platform\/scene\/([^/]+)$/);
  if (sceneMatch) {
    const slug = decodeURIComponent(sceneMatch[1]);
    const data = buildDashboardData(ctx);
    // Try direct project slug match first (owner slug)
    let targetSlug = data.projects?.find(p => p.slug === slug)?.slug;
    // Fall back to searching project members for the slug
    if (!targetSlug && data.projects) {
      for (const p of data.projects) {
        if (p.members.some(m => m.slug === slug)) {
          targetSlug = p.slug;
          break;
        }
      }
    }
    if (targetSlug) {
      res.writeHead(302, { Location: `/platform/project/${encodeURIComponent(targetSlug)}` });
      res.end();
      return true;
    }
    // Unknown slug — send them home
    res.writeHead(302, { Location: '/platform' });
    res.end();
    return true;
  }

  return false;
}

// ─── Data builders ──────────────────────────────────────────

function esc(s: string | undefined | null): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function send(res: ServerResponse, code: number, contentType: string, body: string): void {
  res.writeHead(code, {
    'Content-Type': `${contentType}; charset=utf-8`,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  });
  res.end(body);
}

function buildDashboardData(ctx: PlatformContext) {
  const scenes = ctx.sessionScenes.map(s => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    width: s.width ?? 1440,
    height: s.height ?? 900,
    nodes: s.nodes,
  }));
  const sidebarScenes = ctx.sessionScenes.map<SidebarSceneItem>(s => ({
    slug: s.slug, name: s.name,
  }));
  const sidebarComponents = buildSidebarComponents(ctx);
  const sidebarMacros = buildSidebarMacros(ctx);
  const brands = buildBrandsList(ctx);

  // Group scenes into projects using variantOf metadata + common prefix.
  // Dashboard shows one card per project; click → canvas view with all
  // variants. Resolver reaches into the scene store to read meta.variantOf.
  const { groupScenesIntoProjects } = require('./project-grouping.js') as
    typeof import('./project-grouping.js');
  const projects = groupScenesIntoProjects(scenes, (sceneId: string) => {
    const ref = ctx.getScene(sceneId);
    if (!ref) return undefined;
    return (ref as any).meta?.variantOf;
  });

  return {
    scenes,
    projects,
    sidebarScenes,
    sidebarComponents,
    sidebarMacros,
    brands,
    activeBrand: getActiveBrand(ctx),
  };
}

function buildScenePage(ctx: PlatformContext, slug: string) {
  const matching = ctx.sessionScenes.find(s => s.slug === slug);
  if (!matching) return null;
  const sceneRef = ctx.getScene(matching.id);
  if (!sceneRef) return null;

  const sidebarScenes = ctx.sessionScenes.map<SidebarSceneItem>(s => ({
    slug: s.slug,
    name: s.name,
    active: s.slug === slug,
  }));
  const sidebarComponents = buildSidebarComponents(ctx);
  const sidebarMacros = buildSidebarMacros(ctx);
  const brands = buildBrandsList(ctx);

  return {
    slug,
    sessionId: matching.id,
    name: matching.name,
    width: matching.width ?? 1440,
    height: matching.height ?? 900,
    sidebarScenes,
    sidebarComponents,
    sidebarMacros,
    intents: loadIntentsSafe(ctx),
    draftIntent: null,
    brands,
    activeBrand: getActiveBrand(ctx),
    auditScore: ctx.getAuditScore?.(matching.id) ?? 92,
    totalOps: 0,
  };
}

function buildCommonSidebar(ctx: PlatformContext) {
  return {
    sidebarScenes: ctx.sessionScenes.map<SidebarSceneItem>(s => ({
      slug: s.slug, name: s.name,
    })),
    sidebarComponents: buildSidebarComponents(ctx),
    sidebarMacros: buildSidebarMacros(ctx),
    activeBrand: getActiveBrand(ctx),
  };
}

function buildComponentsData(ctx: PlatformContext) {
  const common = buildCommonSidebar(ctx);
  if (!ctx.projectDir) return { components: [], ...common };
  try {
    // Defer import to avoid loading components module when no project.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../../../core/src/project/components.js');
    const comps = mod.listComponents(ctx.projectDir) ?? [];
    return {
      components: comps.map((c: any) => ({
        name: c.name,
        slug: c.slug,
        description: c.description,
        revision: c.revision ?? 1,
        slots: c.slots ?? [],
      })),
      ...common,
    };
  } catch {
    return { components: [], ...common };
  }
}

function buildMacrosData(ctx: PlatformContext) {
  const common = buildCommonSidebar(ctx);
  if (!ctx.projectDir) return { macros: [], ...common };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../../../core/src/project/macros.js');
    const list = mod.listMacros(ctx.projectDir) ?? [];
    return {
      macros: list.map((m: any) => ({
        name: m.name,
        slug: m.slug,
        description: m.description,
        ops: (m.ops ?? []).length,
      })),
      currentSceneSlug: ctx.sessionScenes[0]?.slug,
      ...common,
    };
  } catch {
    return { macros: [], ...common };
  }
}

function buildDesignSystemData(ctx: PlatformContext) {
  const common = buildCommonSidebar(ctx);
  const md = ctx.getDesignMd();
  if (!md) return { brand: undefined, ...common };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../../../core/src/design-system/index.js');
    const ds = mod.parseDesignMd(md);
    const colors: Array<{ name: string; hex: string }> = [];
    if (ds.colors?.primary) colors.push({ name: 'primary', hex: ds.colors.primary });
    if (ds.colors?.background) colors.push({ name: 'background', hex: ds.colors.background });
    if (ds.colors?.text) colors.push({ name: 'text', hex: ds.colors.text });
    if (ds.colors?.accent) colors.push({ name: 'accent', hex: ds.colors.accent });
    if (ds.colors?.roles) {
      for (const [name, hex] of ds.colors.roles) {
        if (!colors.find(c => c.name === name)) colors.push({ name, hex });
      }
    }
    const typography = (ds.typography?.hierarchy ?? []).map((t: any) => ({
      role: t.role,
      fontSize: t.fontSize,
      fontWeight: t.fontWeight,
      fontFamily: t.fontFamily,
    }));
    return {
      brand: ds.brand,
      colors,
      typography,
      primaryFont: ds.typography?.primaryFont,
      secondaryFont: ds.typography?.secondaryFont,
      radiusScale: ds.layout?.borderRadiusScale,
      ...common,
    };
  } catch {
    return { brand: undefined, ...common };
  }
}

// ─── TTL memoization ──────────────────────────────────────
// Rapid navigation between /platform/* pages hammers the disk for the
// same sidebar data (scenes/components/macros). None of it changes
// within a few seconds of user interaction, so caching with a short
// TTL per projectDir cuts page render time by ~50% on follow-up loads.
// Invalidation happens implicitly via TTL; SSE events could push
// bigger invalidation in a future pass, but 1.5s is short enough that
// users don't notice staleness.
// TTL bumped to 3s — no user perceives staleness at this timescale and it
// halves the cache miss rate on bursts of navigation. Sidebar lists rarely
// change without an explicit SSE invalidation.
const MEMO_TTL_MS = 3000;
interface MemoEntry<T> { value: T; at: number; }
const memoComponents = new Map<string, MemoEntry<SidebarComponentItem[]>>();
const memoMacros = new Map<string, MemoEntry<SidebarMacroItem[]>>();
const memoBrands = new Map<string, MemoEntry<string[]>>();
const memoActiveBrand = new Map<string, MemoEntry<string | undefined>>();

// Top-level static imports — dynamic `require()` per-request forced Node to
// walk the CJS cache each call. Hoisting them eliminates that overhead and
// ties evaluation to module load (once per process).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const componentsMod = require('../../../core/src/project/components.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const macrosMod = require('../../../core/src/project/macros.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const projectIoMod = require('../../../core/src/project/io.js');

function memoGet<T>(map: Map<string, MemoEntry<T>>, key: string): T | null {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > MEMO_TTL_MS) {
    map.delete(key);
    return null;
  }
  return hit.value;
}
function memoSet<T>(map: Map<string, MemoEntry<T>>, key: string, value: T): T {
  map.set(key, { value, at: Date.now() });
  return value;
}

/** Invalidate all sidebar memoization (called from SSE event handler
 *  when state that could affect these lists changes). */
export function invalidateSidebarCaches(): void {
  memoComponents.clear();
  memoMacros.clear();
  memoBrands.clear();
  memoActiveBrand.clear();
}

function buildSidebarComponents(ctx: PlatformContext): SidebarComponentItem[] {
  if (!ctx.projectDir) return [];
  const cached = memoGet(memoComponents, ctx.projectDir);
  if (cached) return cached;
  try {
    const comps = componentsMod.listComponents(ctx.projectDir) ?? [];
    return memoSet(memoComponents, ctx.projectDir, comps.map((c: any) => ({ slug: c.slug, name: c.name })));
  } catch {
    return [];
  }
}

function buildSidebarMacros(ctx: PlatformContext): SidebarMacroItem[] {
  if (!ctx.projectDir) return [];
  const cached = memoGet(memoMacros, ctx.projectDir);
  if (cached) return cached;
  try {
    const list = macrosMod.listMacros(ctx.projectDir) ?? [];
    return memoSet(memoMacros, ctx.projectDir, list.map((m: any) => ({ slug: m.name, name: m.name })));
  } catch {
    return [];
  }
}

function buildBrandsList(ctx: PlatformContext): string[] {
  if (!ctx.projectDir) return [];
  const cached = memoGet(memoBrands, ctx.projectDir);
  if (cached) return cached;
  try {
    const brands = projectIoMod.listRegisteredBrands?.(ctx.projectDir) ?? [];
    return memoSet(memoBrands, ctx.projectDir, brands.map((b: any) => b.slug));
  } catch {
    return [];
  }
}

function getActiveBrand(ctx: PlatformContext): string | undefined {
  if (!ctx.projectDir) return undefined;
  // Previously: no cache — read project.json from disk on every request.
  // This was the #2 hot-path filesystem call after PlatformContext build.
  const cached = memoActiveBrand.get(ctx.projectDir);
  if (cached && Date.now() - cached.at <= MEMO_TTL_MS) return cached.value;
  try {
    const manifest = projectIoMod.loadProject?.(ctx.projectDir);
    const active = manifest?.activeBrand as string | undefined;
    memoActiveBrand.set(ctx.projectDir, { value: active, at: Date.now() });
    return active;
  } catch {
    return undefined;
  }
}

function loadIntentsSafe(ctx: PlatformContext): any[] {
  if (!ctx.projectDir) return [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../../../core/src/project/intents/index.js');
    return mod.listIntents(ctx.projectDir, { limit: 20 }) ?? [];
  } catch {
    return [];
  }
}
