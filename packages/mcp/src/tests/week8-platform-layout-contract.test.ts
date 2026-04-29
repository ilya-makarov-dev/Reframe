/**
 * Phase 1 UI-1 — Two-pane resizable layout contract.
 *
 * Tests assert against the SHIPPING ARTIFACTS:
 *   - layout.ts (renderShell output) — DOM structure, ARIA roles,
 *     toast element, collapse toggle present
 *   - platform-ui.css — Grid template columns, collapsed override,
 *     narrow-viewport toast rules, sidebar collapse button styling
 *   - bundled platform-ui.js (concatenated ui/*.js) — v1 storage
 *     key + bounds + collapse toggle wiring + viewport guard
 *
 * No HTTP / Playwright spin-up. The shell + CSS + JS are static
 * files; reading them as fixtures is the most direct contract surface.
 * Live behavior in a real browser is covered by the manual probes
 * documented in the brief (Probe A/B/C).
 *
 * Run: npx tsx packages/mcp/src/tests/week8-platform-layout-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import { renderShell } from '../platform/layout.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PLATFORM_CSS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'platform-ui.css');
const VIEWPORT_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '070-viewport.js');
const INIT_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '160-init.js');

let cssText = '';
let viewportJs = '';
let initJs = '';

function loadFixtures(): void {
  cssText = fs.readFileSync(PLATFORM_CSS, 'utf-8');
  viewportJs = fs.readFileSync(VIEWPORT_JS, 'utf-8');
  initJs = fs.readFileSync(INIT_JS, 'utf-8');
}

function renderEditorShell(): string {
  return renderShell({
    title: 'Test',
    sceneSlug: 'test-scene',
    main: '<div class="canvas-region">canvas</div>',
    sidebar: '<nav class="side-nav"><a>Home</a></nav>',
    rightPanel: '<div class="props">props</div>',
  });
}

// ─── TEST 1: DOM structure & ARIA ──
async function testDomStructure(): Promise<void> {
  loadFixtures();
  const html = renderEditorShell();
  // Three regions present
  assert(html.includes('<aside class="sidebar">'), 'dom: left aside.sidebar present');
  assert(html.includes('<main class="main">'), 'dom: center main present');
  assert(html.includes('<aside class="right">'), 'dom: right aside present');
  // Resize handles emitted when sidebar+rightPanel both present
  assert(html.includes('data-panel-resize="sidebar"'), 'dom: sidebar resize handle present');
  assert(html.includes('data-panel-resize="right"'), 'dom: right resize handle present');
  // Collapse toggle present in sidebar
  assert(html.includes('data-sidebar-collapse-toggle'), 'dom: sidebar collapse toggle present');
  assert(html.includes('aria-expanded="true"'), 'dom: collapse toggle ARIA aria-expanded initial');
  // Narrow-viewport toast element
  assert(html.includes('data-narrow-viewport-toast'), 'dom: narrow-viewport toast element present');
  assert(html.includes('role="status"'), 'dom: toast has role=status');
}

// ─── TEST 2: CSS Grid template columns ──
async function testCssGridColumns(): Promise<void> {
  // Default grid template
  assert(/\.body\s*\{[^}]*grid-template-columns:\s*var\(--sidebar-w\)\s+1fr/s.test(cssText),
    'css: default grid is sidebar + main');
  // With right panel
  assert(/\.body\.with-right\s*\{[^}]*grid-template-columns:\s*var\(--sidebar-w\)\s+1fr\s+var\(--right-w\)/s.test(cssText),
    'css: with-right adds right column');
  // Default widths match brief
  assert(/--sidebar-w:\s*320px/.test(cssText), 'css: default sidebar 320px');
  assert(/--right-w:\s*360px/.test(cssText), 'css: default right 360px');
  // Collapsed-rail width var
  assert(/--sidebar-collapsed-w:\s*48px/.test(cssText), 'css: collapsed rail width 48px');
}

// ─── TEST 3: Collapsed-state CSS ──
async function testCollapsedState(): Promise<void> {
  // Collapsed grid override
  assert(/\.body\[data-left-collapsed="true"\]\s*\{[^}]*grid-template-columns:\s*var\(--sidebar-collapsed-w\)\s+1fr/s.test(cssText),
    'css: collapsed override grid');
  // Collapsed + with-right combination
  assert(/\.body\.with-right\[data-left-collapsed="true"\]/.test(cssText),
    'css: collapsed + with-right combination rule present');
  // Resize handle hidden while collapsed
  assert(/\.body\[data-left-collapsed="true"\]\s+\.panel-resize-sidebar\s*\{[^}]*display:\s*none/s.test(cssText),
    'css: sidebar resize handle hidden when collapsed');
  // Sidebar inner content hidden except for the collapse toggle
  assert(/\.body\[data-left-collapsed="true"\]\s+\.sidebar\s*>\s*:not\(\.sidebar-collapse-toggle\)/.test(cssText),
    'css: sidebar children hidden except collapse toggle');
}

// ─── TEST 4: Narrow-viewport toast rules ──
async function testNarrowViewportToast(): Promise<void> {
  assert(cssText.includes('.reframe-narrow-viewport-toast'), 'css: toast selector present');
  assert(/body\.reframe-viewport-narrow\s+\.reframe-narrow-viewport-toast\s*\{[^}]*display:\s*flex/s.test(cssText),
    'css: toast becomes flex when body.reframe-viewport-narrow');
  assert(/body\.reframe-viewport-narrow\s+\.app\s*\{[^}]*pointer-events:\s*none/s.test(cssText),
    'css: app suppressed (pointer-events:none) when narrow');
  // The old hide-asides media query has been removed — toast now
  // owns the narrow-viewport surface.
  assert(!/@media\s*\(\s*max-width:\s*1024px\s*\)\s*\{[^}]*display:\s*none\s*!important/s.test(cssText),
    'css: legacy below-1024 hide-asides media query removed');
}

// ─── TEST 5: v1 storage shape ──
async function testStorageShape(): Promise<void> {
  assert(viewportJs.includes("'reframe-platform-ui-layout-v1'"), 'js: v1 storage key present');
  // Default values
  assert(/leftPanelWidth:\s*320/.test(viewportJs), 'js: default leftPanelWidth=320');
  assert(/rightPanelWidth:\s*360/.test(viewportJs), 'js: default rightPanelWidth=360');
  assert(/leftPanelCollapsed:\s*false/.test(viewportJs), 'js: default leftPanelCollapsed=false');
  // Brief bounds
  assert(/SIDEBAR_MIN\s*=\s*240/.test(viewportJs), 'js: sidebar min 240');
  assert(/SIDEBAR_MAX\s*=\s*600/.test(viewportJs), 'js: sidebar max 600');
  assert(/RIGHT_MIN\s*=\s*280/.test(viewportJs), 'js: right min 280');
  assert(/RIGHT_MAX\s*=\s*560/.test(viewportJs), 'js: right max 560');
  // Read + write helpers
  assert(viewportJs.includes('function readLayoutPrefs'), 'js: readLayoutPrefs helper');
  assert(viewportJs.includes('function writeLayoutPrefs'), 'js: writeLayoutPrefs helper');
  // Soft migration from old keys
  assert(viewportJs.includes("'reframe.panel.sidebar'") && viewportJs.includes("'reframe.panel.right'"),
    'js: legacy keys read for soft migration');
}

// ─── TEST 6: collapse toggle wiring ──
async function testCollapseToggleWiring(): Promise<void> {
  assert(viewportJs.includes('function bindSidebarCollapse'), 'js: bindSidebarCollapse function present');
  assert(viewportJs.includes('data-sidebar-collapse-toggle'), 'js: toggle selector referenced');
  // Toggle flips the leftPanelCollapsed pref and re-applies
  assert(/leftPanelCollapsed\s*=\s*!current\.leftPanelCollapsed/.test(viewportJs),
    'js: toggle inverts leftPanelCollapsed');
  // applyLayoutPrefs sets/clears the data attr
  assert(/setAttribute\(['"]data-left-collapsed['"]\s*,\s*['"]true['"]/.test(viewportJs),
    'js: data-left-collapsed=true set on collapse');
  assert(/removeAttribute\(['"]data-left-collapsed['"]/.test(viewportJs),
    'js: data-left-collapsed cleared on expand');
  // Sidebar resize is suppressed when collapsed
  assert(/data-left-collapsed['"]\)\s*===\s*['"]true['"]/.test(viewportJs),
    'js: resize bail-out when collapsed');
  // Wired into init lifecycle
  assert(initJs.includes('bindSidebarCollapse'), 'init: bindSidebarCollapse called from init');
}

// ─── TEST 7: narrow-viewport guard wiring ──
async function testNarrowViewportGuard(): Promise<void> {
  assert(viewportJs.includes('function bindNarrowViewportGuard'), 'js: bindNarrowViewportGuard function present');
  assert(/NARROW_VIEWPORT_BREAKPOINT\s*=\s*1024/.test(viewportJs), 'js: 1024px breakpoint constant');
  assert(viewportJs.includes("classList.toggle('reframe-viewport-narrow'"),
    'js: toggles body class on resize');
  assert(viewportJs.includes("addEventListener('resize'"), 'js: listens to window resize');
  assert(initJs.includes('bindNarrowViewportGuard'), 'init: bindNarrowViewportGuard called from init');
}

// ─── TEST 8: backward compat — wide / no-sidebar shells ──
async function testBackwardCompatShells(): Promise<void> {
  // wide=true should produce a solo body with no asides — no resize
  // handles, no collapse toggle.
  const wideHtml = renderShell({
    title: 'Dashboard',
    main: '<div>main</div>',
    wide: true,
  });
  assert(!wideHtml.includes('<aside class="sidebar">'), 'wide: no sidebar emitted');
  assert(!wideHtml.includes('<aside class="right">'), 'wide: no right emitted');
  assert(!wideHtml.includes('data-panel-resize'), 'wide: no resize handles');
  assert(!wideHtml.includes('data-sidebar-collapse-toggle'), 'wide: no collapse toggle');
  // Toast still present (shell-level concern, not panel-dependent)
  assert(wideHtml.includes('data-narrow-viewport-toast'), 'wide: toast still present (global guard)');

  // Sidebar-only — no right panel → no right resize handle
  const sidebarOnlyHtml = renderShell({
    title: 'Brand',
    main: '<div>main</div>',
    sidebar: '<nav>nav</nav>',
  });
  assert(sidebarOnlyHtml.includes('data-panel-resize="sidebar"'), 'sidebar-only: sidebar handle present');
  assert(!sidebarOnlyHtml.includes('data-panel-resize="right"'), 'sidebar-only: no right handle');
  assert(sidebarOnlyHtml.includes('data-sidebar-collapse-toggle'), 'sidebar-only: collapse toggle present');
}

// ─── TEST 9: existing route compatibility ──
async function testExistingRoutes(): Promise<void> {
  // The grid-based body class taxonomy is preserved — variants /
  // flow / sampler routes mount through the same shell, relying on
  // the same .body / .body.with-right grid surface.
  const html = renderEditorShell();
  // Body class taxonomy intact (with-right when both panels present)
  assert(/<div class="body with-right"/.test(html), 'routes: body has with-right when both panels mounted');
  // Resize handles still inside .body (existing position assumption)
  const bodyMatch = html.match(/<div class="body[^"]*">([\s\S]*?)<\/div>\s*(?:<!--|$)/);
  // The shell wraps panels and handles in the body div; verify the
  // shell still emits handles inside the body region (positioned
  // absolute relative to .body — broken layout otherwise).
  assert(html.indexOf('data-panel-resize="sidebar"') > html.indexOf('<div class="body'),
    'routes: handles emitted inside body region');
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Phase 1 UI-1 Two-pane layout contract\n');
  loadFixtures();

  const tests: Array<[string, () => Promise<void>]> = [
    ['DOM structure & ARIA — three regions, resize handles, toast, collapse toggle', testDomStructure],
    ['CSS Grid template columns — defaults 320/360, collapsed-rail 48px var', testCssGridColumns],
    ['Collapsed-state CSS — grid override + sidebar children hidden + handle hidden', testCollapsedState],
    ['Narrow-viewport toast rules — display + app suppression + legacy media query removed', testNarrowViewportToast],
    ['v1 storage shape — single key, bounds, defaults, soft migration from old keys', testStorageShape],
    ['Collapse toggle wiring — inverts pref, sets data attr, suppresses resize, init', testCollapseToggleWiring],
    ['Narrow-viewport guard — 1024px breakpoint, body class toggle, resize listener, init', testNarrowViewportGuard],
    ['Backward compat — wide / sidebar-only shells render correctly', testBackwardCompatShells],
    ['Existing routes — body-class taxonomy + handle positioning preserved', testExistingRoutes],
  ];

  for (const [name, fn] of tests) {
    console.log(`▸ ${name}`);
    try { await fn(); }
    catch (err: any) {
      failed++;
      console.error(`  UNEXPECTED ERROR: ${err?.message ?? err}`);
      if (err?.stack) console.error(err.stack.split('\n').slice(0, 6).join('\n'));
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
