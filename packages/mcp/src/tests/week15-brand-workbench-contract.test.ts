/**
 * Phase 3 Brief 3a — Brand Workbench foundation contract.
 *
 * Pins covered:
 *   #1 Workbench page route /platform/workbench/brands + renderer
 *   #2 Catalog grid (cached brands + 5 directions tag)
 *   #3 BrandWorkbenchService — listBrandCatalog, loadBrandDS,
 *      getActiveBrandForScene, listScenesUsingBrand,
 *      skillInvocationContext (Phase 3.5 hook)
 *   #4 Workbench split-panel layout (palette / typography / vocab /
 *      components / skill-actions sections)
 *   #5 Live preview iframe wired to /api/render
 *   #6 Scoped SSE events (brand:applied + brand:edited) emitted
 *      alongside catch-all design-system:updated
 *   #7 Drawer Rebrand tab → redirect button to /platform/workbench/brands
 *   #8 Multi-brand UI fix — color picker rail + bottom chip read scene's brand
 *
 * Run: npx tsx packages/mcp/src/tests/week15-brand-workbench-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { initProject } from '../../../core/src/project/io.js';
import { setProjectDir, clearScenes } from '../store.js';
import {
  listBrandCatalog,
  loadBrandDS,
  getActiveBrandForScene,
  listScenesUsingBrand,
  skillInvocationContext,
  DIRECTION_SLUGS,
} from '../platform/api/brand-workbench-service.js';
import { renderWorkbenchBrandsPage } from '../platform/pages/workbench-brands.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const ROUTER_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'router.ts');
const NODE_EDIT_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'api', 'node-edit.ts');
const CORE_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '010-core.js');
const DRAWER_TABS_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '171-drawer-tabs.js');
const COLOR_RAIL_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '116-color-picker-rail.js');
const BOTTOM_CHAT_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '105-bottom-chat.js');
const WORKBENCH_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '155-workbench-brands.js');
const CSS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'platform-ui.css');

function setupProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-bw-test-'));
  initProject(dir, 'bw-test');
  // Seed two brand DESIGN.mds: one direction, one ordinary.
  const brandsDir = path.join(dir, '.reframe', 'brands');
  fs.mkdirSync(path.join(brandsDir, 'warm-soft'), { recursive: true });
  fs.writeFileSync(path.join(brandsDir, 'warm-soft', 'DESIGN.md'),
    `# Warm soft\n\n## Color Palette\n- primary: #cf6a5f\n- background: #fdf3e8\n- text: #221812\n\n## Typography\n- primary: Tiempos Headline\n`);
  fs.mkdirSync(path.join(brandsDir, 'stripe'), { recursive: true });
  fs.writeFileSync(path.join(brandsDir, 'stripe', 'DESIGN.md'),
    `# Stripe\n\n## Color Palette\n- primary: #635bff\n- background: #ffffff\n- text: #0a2540\n`);
  setProjectDir(dir);
  clearScenes();
  return dir;
}

function main(): void {
  console.log('Phase 3 Brief 3a — Brand Workbench foundation contract\n');
  const dir = setupProject();

  // ─── Pin #3 — service layer ────────────────────────────────
  console.log('Pin #3 — BrandWorkbenchService');
  {
    const catalog = listBrandCatalog(dir);
    assert(catalog.length === 2, 'catalog lists both seeded brands');
    const ws = catalog.find(c => c.slug === 'warm-soft');
    assert(!!ws, 'warm-soft entry found');
    assert(ws!.name === 'Warm soft', 'name parsed from DESIGN.md heading');
    assert(ws!.swatches.includes('#cf6a5f'), 'swatch list includes primary');
    assert(ws!.swatches.includes('#fdf3e8'), 'swatch list includes background');
    assert(ws!.isDirection === true, 'warm-soft tagged as Phase 2.5 direction');

    const stripe = catalog.find(c => c.slug === 'stripe');
    assert(stripe!.isDirection === false, 'stripe NOT tagged as direction');

    // Direction set is the canonical Phase 2.5 list.
    assert(DIRECTION_SLUGS.has('warm-soft'), 'DIRECTION_SLUGS includes warm-soft');
    assert(DIRECTION_SLUGS.size === 5, 'exactly 5 directions hard-coded');

    const loaded = loadBrandDS(dir, 'warm-soft');
    assert(!!loaded, 'loadBrandDS returns DS for known slug');
    assert(loadBrandDS(dir, 'nonexistent') === null,
      'loadBrandDS returns null for unknown slug');

    // Multi-brand resolver — null sceneId falls through to manifest.
    const resolved = getActiveBrandForScene(dir, null);
    assert(resolved === null || typeof resolved === 'string',
      'getActiveBrandForScene returns null or string (no scene, no default)');

    // Skill-bus invocation context (Phase 3.5 hook).
    const ctx = skillInvocationContext({
      brandSlug: 'warm-soft',
      activeSceneId: 's1',
      selectedTokens: ['primary', 'background'],
    });
    assert(ctx.brandSlug === 'warm-soft', 'skill context carries brand slug');
    assert(ctx.activeSceneId === 's1', 'skill context carries scene id');
    assert((ctx.selectedTokens ?? []).length === 2, 'skill context carries token list');

    assert(listScenesUsingBrand('warm-soft').length === 0,
      'listScenesUsingBrand starts empty (no scenes seeded)');
  }

  // ─── Pin #1+#4 — page renderer ─────────────────────────────
  console.log('\nPin #1 + #4 — page renderer');
  {
    const catalog = listBrandCatalog(dir);
    // Catalog mode
    const catalogHtml = renderWorkbenchBrandsPage({ catalog });
    assert(catalogHtml.includes('Brand workbench'), 'page title rendered');
    assert(catalogHtml.includes('bw-catalog-grid'), 'catalog grid mounted');
    assert(catalogHtml.includes('data-bw-filter'), 'search input rendered');
    assert(catalogHtml.includes('data-brand-slug="warm-soft"'),
      'warm-soft card present');
    assert(catalogHtml.includes('data-brand-slug="stripe"'),
      'stripe card present');
    assert((catalogHtml.match(/bw-card-tag">direction</g) ?? []).length === 1,
      'exactly one direction tag (warm-soft only)');
    assert(/data-page="workbench-brands"/.test(catalogHtml),
      'body carries data-page="workbench-brands" for binder activation');

    // Workbench mode
    const ws = loadBrandDS(dir, 'warm-soft');
    const wbHtml = renderWorkbenchBrandsPage({
      catalog,
      selectedSlug: 'warm-soft',
      selectedDS: ws!.ds,
      scenesUsing: [],
      activeSceneId: undefined,
    });
    assert(wbHtml.includes('← Back to catalog'), 'back link present');
    assert(/data-bw-slug="warm-soft"/.test(wbHtml),
      'workbench root carries selected slug');
    assert(wbHtml.includes('Palette'), 'palette section header rendered');
    assert(wbHtml.includes('Typography'), 'typography section header rendered');
    assert(wbHtml.includes('Vocab'), 'vocab section header rendered');
    assert(wbHtml.includes('Skill actions'), 'skill-actions section rendered');
    assert(/data-bw-apply-action="scene"/.test(wbHtml),
      'apply-to-scene action button rendered');
    assert(/data-bw-apply-action="project"/.test(wbHtml),
      'apply-as-project-default action rendered (virtualSlug routing)');
    assert(/data-bw-apply-action="global"/.test(wbHtml),
      'apply-as-global-default action rendered');
    // Phase 3.5 enabled the skill chips and wired them through the
    // bus invocation route. The 3a "disabled placeholder" assertion
    // becomes a "data-bw-skill data attr present" check — the chips
    // are now invocable by the bindWorkbenchSkillChips binder.
    assert(/data-bw-skill="reframe-brand"[^>]*>\/vocalise/.test(wbHtml),
      'vocalise chip wired to reframe-brand skill (Phase 3.5)');
  }

  // ─── Pin #1 — router wiring ────────────────────────────────
  console.log('\nPin #1 — router declares /platform/workbench/brands');
  {
    const router = fs.readFileSync(ROUTER_TS, 'utf8');
    assert(/'\/platform\/workbench\/brands' && req\.method === 'GET'/.test(router),
      'router declares workbench route');
    assert(/listBrandCatalog\(/.test(router), 'router calls service catalog');
    assert(/loadBrandDS\(/.test(router), 'router calls service DS load');
    assert(/listScenesUsingBrand\(/.test(router), 'router calls scenes-using helper');
    assert(/renderWorkbenchBrandsPage\(/.test(router), 'router calls renderer');
  }

  // ─── Pin #6 — scoped SSE events ────────────────────────────
  console.log('\nPin #6 — Scoped SSE events');
  {
    const ne = fs.readFileSync(NODE_EDIT_TS, 'utf8');
    assert(/emitEvent\(\{[\s\S]{0,80}'brand:edited'/.test(ne),
      '/brand/switch emits scoped brand:edited');
    assert(/emitEvent\(\{[\s\S]{0,80}'brand:applied'/.test(ne),
      '/brand/apply emits scoped brand:applied with sceneId');

    const core = fs.readFileSync(CORE_JS, 'utf8');
    assert(/case 'brand:applied':[\s\S]{0,200}case 'brand:edited':/.test(core),
      'UI core routes both scoped events');
    assert(/window\.__reframeBrandSubscribers/.test(core),
      'subscriber registry hooked into window');

    const wb = fs.readFileSync(WORKBENCH_JS, 'utf8');
    assert(/window\.__reframeBrandSubscribers\.push/.test(wb),
      'workbench page registers a scoped subscriber');
    assert(/'brand:edited' && ev\.slug === pageSlug/.test(wb),
      'subscriber filters by this workbench\'s slug');
  }

  // ─── Pin #7 — drawer Rebrand subsumed ──────────────────────
  console.log('\nPin #7 — Drawer Rebrand tab redirects to workbench');
  {
    const dt = fs.readFileSync(DRAWER_TABS_JS, 'utf8');
    assert(/data-bw-redirect/.test(dt),
      'Rebrand tab renders bw-redirect button');
    assert(/href="\/platform\/workbench\/brands"/.test(dt),
      'redirect href points at workbench page');
    assert(!/data-rebrand-select/.test(dt),
      'inline brand select dropdown removed');
    assert(!/data-rebrand-apply/.test(dt),
      'inline apply button removed');
    // Mode toggle (light/dark) stayed — it's not brand-scoped.
    assert(/data-mode-switch="light"/.test(dt),
      'Mode toggle survives subsumption');
  }

  // ─── Pin #8 — multi-brand UI fix ───────────────────────────
  console.log('\nPin #8 — Color picker rail + bottom chip read scene\'s brand');
  {
    const rail = fs.readFileSync(COLOR_RAIL_JS, 'utf8');
    // Rail must check scene-boot first, manifest fallback.
    const railFn = rail.match(/function getActiveBrandSlug[\s\S]*?\n  \}/);
    assert(railFn !== null, 'rail getActiveBrandSlug body extractable');
    assert(railFn !== null && /__REFRAME_BOOT__\.scenes/.test(railFn![0]),
      'rail consults scene boot record before manifest');
    assert(railFn !== null && /sceneBoot\.brand/.test(railFn![0]),
      'rail reads StoredScene.brand');

    const bc = fs.readFileSync(BOTTOM_CHAT_JS, 'utf8');
    assert(/__REFRAME_BOOT__\.scenes[\s\S]{0,400}sceneBoot\.brand/.test(bc),
      'bottom chip checks scene-boot brand before global label');
  }

  // ─── CSS polish ─────────────────────────────────────────────
  console.log('\nCSS — workbench styles');
  {
    const css = fs.readFileSync(CSS, 'utf8');
    assert(/\.bw-catalog-grid[\s\S]{0,200}grid-template-columns/.test(css),
      'catalog grid uses CSS grid');
    assert(/\.bw-card:hover[\s\S]{0,200}rgba\(43, 116, 255, 0\.08\)/.test(css),
      'card hover carries Phase 1 focus-ring identity');
    assert(/\.bw-search:focus[\s\S]{0,200}rgba\(43, 116, 255, 0\.15\)/.test(css),
      'search input focus carries Phase 1 identity');
    assert(/\.bw-btn--primary[\s\S]{0,80}#2b74ff/.test(css),
      'primary button uses focus-ring blue');
    assert(/\.bw-preview-frame/.test(css), 'live preview iframe styled');
  }

  // Cleanup
  fs.rmSync(dir, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
