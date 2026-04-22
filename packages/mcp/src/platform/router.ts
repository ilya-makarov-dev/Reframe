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

  // ── Editor bundle (CanvasKit + @open-pencil/core + reframe editor) ──
  if (pathname === '/platform/viewport.js' && req.method === 'GET') {
    const { readFileSync, existsSync } = await import('fs');
    const { join } = await import('path');
    // Find the bundle — log which path we use for debugging
    const candidates = [
      join(process.cwd(), 'packages', 'mcp', 'src', 'platform', 'editor-bundle.js'),
      join(process.cwd(), 'packages', 'mcp', 'dist', 'mcp', 'src', 'platform', 'editor-bundle.js'),
      join(__dirname, 'editor-bundle.js'),
    ];
    let bundleContent: string | null = null;
    for (const p of candidates) {
      if (existsSync(p)) { bundleContent = readFileSync(p, 'utf8'); break; }
    }
    if (bundleContent) {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(bundleContent);
    } else {
      const { VIEWPORT_CANVAS_JS } = await import('./viewport-canvas.js');
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(VIEWPORT_CANVAS_JS);
    }
    return true;
  }

  // ── Clean canvas test — NO old platform UI, just CanvasKit ──
  if (pathname === '/platform/canvas-test' && req.method === 'GET') {
    const scenes = ctx.sessionScenes || [];
    const sceneId = scenes.length > 0 ? scenes[0].id : '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CanvasKit Test</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #111; overflow: hidden; height: 100vh; }
    #reframe-viewport { width: 100vw; height: 100vh; display: block; }
  </style>
  <script type="importmap">{"imports":{"canvaskit-wasm":"/platform/vendor/canvaskit-shim.js","canvaskit-wasm/full":"/platform/vendor/canvaskit-shim.js"}}</script>
</head>
<body>
  <canvas id="reframe-viewport" data-project-scenes="${sceneId}"></canvas>
  <script type="module" src="/platform/viewport-init.js"></script>
</body>
</html>`);
    return true;
  }

  // ── Viewport init — external module script (CSP-safe) ──
  if (pathname === '/platform/viewport-init.js' && req.method === 'GET') {
    // Pass version token through to viewport.js import to bust cache
    const v = url.searchParams.get('v') || '';
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': STATIC_CACHE,
    });
    res.end(`import{initPlatformViewport}from'/platform/viewport.js?v=${v}';initPlatformViewport().catch(e=>console.warn('[reframe] Viewport:',e.message));`);
    return true;
  }

  // ── CanvasKit ESM shim ──
  if (pathname === '/platform/vendor/canvaskit-shim.js' && req.method === 'GET') {
    // Inline the shim — it's tiny, no need for a file read
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': STATIC_CACHE,
    });
    res.end(`// CanvasKit ESM shim — wraps UMD, forces correct WASM path
const s=document.createElement('script');
s.src='/platform/vendor/canvaskit/canvaskit.js';
const r=new Promise((ok,no)=>{s.onload=ok;s.onerror=()=>no(new Error('CanvasKit load failed'))});
document.head.appendChild(s);
export default async function(o){
  await r;
  const i=globalThis.CanvasKitInit;
  if(!i)throw new Error('CanvasKitInit missing');
  const opts=Object.assign({},o||{},{locateFile:function(f){return'/platform/vendor/canvaskit/'+f}});
  return i(opts);
};
`);
    return true;
  }

  // ── Vendor assets: CanvasKit WASM + @open-pencil/core ──
  if (pathname.startsWith('/platform/vendor/') && req.method === 'GET') {
    const { readFileSync, existsSync } = await import('fs');
    const { join } = await import('path');
    const vendorPath = pathname.replace('/platform/vendor/', '');

    // Map vendor paths to node_modules
    let filePath: string | null = null;
    if (vendorPath.startsWith('canvaskit/')) {
      filePath = join(process.cwd(), 'node_modules', 'canvaskit-wasm', 'bin', vendorPath.replace('canvaskit/', ''));
    } else if (vendorPath.startsWith('open-pencil-core/')) {
      filePath = join(process.cwd(), 'node_modules', '@open-pencil', 'core', 'dist', vendorPath.replace('open-pencil-core/', ''));
    }

    if (filePath && existsSync(filePath)) {
      const ext = filePath.split('.').pop() ?? '';
      const mimeTypes: Record<string, string> = {
        js: 'application/javascript',
        mjs: 'application/javascript',
        wasm: 'application/wasm',
        json: 'application/json',
      };
      res.writeHead(200, {
        'Content-Type': mimeTypes[ext] || 'application/octet-stream',
        'Cache-Control': STATIC_CACHE,
      });
      res.end(readFileSync(filePath));
      return true;
    }
  }

  // ── API ──────────────────────────────
  if (pathname.startsWith('/platform/api/')) {
    // Reload-safe shims: after a hard reload of /platform/project/<slug>,
    // StoreSync.pullFromMCP and a few boot-time callers fire before the
    // editor's currentSceneId is hydrated, producing:
    //   /platform/api/audit        → 400 (no sceneId)
    //   /platform/api/manifest?slug=X  → 404 (route never existed)
    //   /platform/api/project?slug=X   → 404 (route never existed)
    // Resolve the project via the Referer (or ?slug=) and either rewrite
    // the sceneId or return a thin JSON payload so the reload path is silent.
    const resolveSlug = (): string | null => {
      const qSlug = url.searchParams.get('slug');
      if (qSlug) return qSlug;
      const ref = (req.headers.referer || req.headers.referrer) as string | undefined;
      if (!ref) return null;
      const m = /\/platform\/project\/([^/?#]+)/.exec(ref);
      return m ? decodeURIComponent(m[1]) : null;
    };
    if (pathname === '/platform/api/audit' && req.method === 'GET' && !url.searchParams.get('sceneId')) {
      const slug = resolveSlug();
      if (slug) {
        const proj = findProjectBySlug(buildDashboardData(ctx).projects ?? [], slug);
        const sid = proj?.members?.[0]?.id;
        if (sid) {
          url.searchParams.set('sceneId', sid);
          // Downstream handler re-parses req.url, so rewrite it in place.
          req.url = `${pathname}?${url.searchParams.toString()}`;
        }
      }
    }
    if (pathname === '/platform/api/manifest' || pathname === '/platform/api/project') {
      const slug = resolveSlug();
      const proj = slug ? findProjectBySlug(buildDashboardData(ctx).projects ?? [], slug) : null;
      if (!proj) { sendJson(res, 404, { ok: false, error: 'project not found' }); return true; }
      sendJson(res, 200, {
        ok: true,
        slug: proj.slug,
        name: proj.name,
        activeSceneId: proj.members[0]?.id ?? null,
        scenes: proj.members.map(m => ({ id: m.id, slug: m.slug, name: m.name })),
        activeBrand: getActiveBrand(ctx, proj.slug) ?? null,
      });
      return true;
    }
    // Direct node editing + undo + audit + brands — the design tool backbone.
    if (pathname.startsWith('/platform/api/node/') ||
        pathname.startsWith('/platform/api/scene/') ||
        pathname === '/platform/api/undo' ||
        pathname === '/platform/api/audit' ||
        pathname.startsWith('/platform/api/audit/') ||
        pathname === '/platform/api/brands' ||
        pathname === '/platform/api/brand/switch' ||
        pathname === '/platform/api/brand/apply' ||
        pathname === '/platform/api/ops' ||
        pathname.startsWith('/platform/api/history/') ||
        pathname === '/platform/api/scene/tree' ||
        pathname === '/platform/api/project/health' ||
        pathname === '/platform/api/publish-shell' ||
        pathname === '/platform/api/import' ||
        // Tokens endpoint (used by Properties color popover for brand-aware
        // chips). Defined in api/node-edit.ts but was missing from the
        // router whitelist → fell through to "unknown api route".
        pathname.startsWith('/platform/api/tokens/') ||
        pathname === '/platform/api/aesthetic' ||
        pathname.startsWith('/platform/api/aesthetic/')) {
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
    // Self-heal: re-sync scenes from disk before rendering. The
    // dashboard's in-memory source of truth (sessionScenes) can get
    // out of sync when a spawned agent crashes mid-compile, when the
    // sidecar restarts while the browser is still open, or when a
    // scene was created in another process. Running the refresh on
    // every dashboard GET is cheap (a handful of JSON reads) and
    // guarantees the user always sees what's on disk.
    if (ctx.projectDir) {
      try {
        const store = await import('../store.js');
        store.refreshScenesFromDisk(ctx.projectDir);
        // The refresh above may have added new scenes to the in-memory
        // store. Rebuild the PlatformContext so buildDashboardData sees
        // them — the `ctx` we were passed was snapshotted before the
        // refresh.
        const httpMod = await import('../http-server.js');
        ctx = httpMod.buildPlatformContext();
      } catch { /* best-effort */ }
    }
    const data = buildDashboardData(ctx);
    const html = renderDashboard(data);
    send(res, 200, 'text/html', html);
    return true;
  }

  // Project editor — /platform/project/:slug
  // Serves the editor shell (CanvasKit + @open-pencil/core) as a standalone SPA.
  // The editor bundle handles scene loading, rendering, interaction.
  if (pathname.startsWith('/platform/project/')) {
    const slug = decodeURIComponent(pathname.slice('/platform/project/'.length));
    if (!slug) {
      send(res, 404, 'text/plain', 'Project slug required');
      return true;
    }
    // Same self-heal as dashboard — a user navigating directly to a
    // project by URL (bookmark, agent-generated link) still wants the
    // in-memory store to reflect disk reality before we look up the
    // slug. Otherwise a scene that exists on disk but not yet in memory
    // would 404 "Project not found" until a dashboard visit refreshed.
    if (ctx.projectDir) {
      try {
        const store = await import('../store.js');
        store.refreshScenesFromDisk(ctx.projectDir);
        const httpMod = await import('../http-server.js');
        ctx = httpMod.buildPlatformContext();
      } catch { /* best-effort */ }
    }
    const data = buildDashboardData(ctx);
    const project = findProjectBySlug(data.projects ?? [], slug);
    if (!project) {
      send(res, 404, 'text/html', '<h1>Project not found</h1><p><a href="/platform">Back to dashboard</a></p>');
      return true;
    }
    const sceneIds = project.members.map(m => m.id).join(',');
    const activeSceneId = project.members[0]?.id ?? null;
    const { renderEditorShell } = await import('./pages/editor-shell-page.js');
    const { buildEditorBoot } = await import('./boot-payload.js');
    const boot = await buildEditorBoot(ctx, activeSceneId, project.slug);
    // Fall back to the project slug when the INode root name is a generic
    // structural tag ("Row", "Stack", "div", etc.) — those are auto-inferred
    // by the HTML importer and read as implementation detail in the header
    // breadcrumb. Same list as dashboard.ts `GENERIC_TAGS`.
    const GENERIC_ROOT_NAMES = new Set([
      'div', 'span', 'section', 'main', 'header', 'footer', 'article', 'aside', 'nav',
      'stack', 'row', 'column', 'group', 'frame', 'canvas', 'body', 'html',
    ]);
    const projectLabel = GENERIC_ROOT_NAMES.has((project.name || '').toLowerCase())
      ? project.slug
      : project.name;
    const html = renderEditorShell({
      title: `reframe \u00B7 ${projectLabel}`,
      sceneIds,
      sceneSlug: project.slug,
      editorJsPath: '/platform/viewport-init.js',
      fontsLink: '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">',
      boot,
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

function sendJson(res: ServerResponse, code: number, data: unknown): void {
  send(res, code, 'application/json', JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
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
    activeBrand: getActiveBrand(ctx, slug),
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

function getActiveBrand(ctx: PlatformContext, virtualProjectSlug?: string): string | undefined {
  if (!ctx.projectDir) return undefined;
  // Previously: no cache — read project.json from disk on every request.
  // This was the #2 hot-path filesystem call after PlatformContext build.
  // Cache key now includes the virtual project slug so per-project overrides
  // don't alias each other.
  const cacheKey = virtualProjectSlug ? `${ctx.projectDir}::${virtualProjectSlug}` : ctx.projectDir;
  const cached = memoActiveBrand.get(cacheKey);
  if (cached && Date.now() - cached.at <= MEMO_TTL_MS) return cached.value;
  try {
    const manifest = projectIoMod.loadProject?.(ctx.projectDir);
    if (!manifest) {
      memoActiveBrand.set(cacheKey, { value: undefined, at: Date.now() });
      return undefined;
    }
    // Prefer the per-project override, fall back to the global activeBrand.
    const perProject = virtualProjectSlug
      ? (manifest.activeBrandPerProject as Record<string, string> | undefined)?.[virtualProjectSlug]
      : undefined;
    const active = perProject ?? (manifest.activeBrand as string | undefined);
    memoActiveBrand.set(cacheKey, { value: active, at: Date.now() });
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
