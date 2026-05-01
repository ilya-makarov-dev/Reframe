/**
 * Phase 4 Brief 4b — Composition wizards + thread panel bus contract.
 *
 * Pins covered:
 *   #1 Variants storage engine — read/write/list/delete + validation
 *   #2 Shared wizard primitive — renderer exports, step navigation,
 *      state-preserving back nav
 *   #3 Variants wizard page — route + body anchor + skill chips
 *   #4 Sampler wizard page  — route + body anchor + skill chip
 *   #5 Wizards catalog page — route + 4 cards (2 shipping, 2 soon)
 *   #6 Skill chip foundation — disabled + Phase 4d tooltip + data attr
 *   #7 Thread panel bus migration — slash-command parser + bus invoke
 *      + Phase 3.5 result rendering library
 *   #8 Dashboard wizards card — link к /platform/workbench/wizards
 *   #10 Bundle 157-wizard-shared.js exports + binder fns
 *
 * Run: npx tsx packages/mcp/src/tests/week21-wizards-thread-bus-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { initProject } from '../../../core/src/project/io.js';
import { setProjectDir, clearScenes } from '../store.js';
import {
  writeVariantsSpec,
  readVariantsSpec,
  listVariants,
  deleteVariants,
  expandCells,
  defaultGrid,
} from '../../../core/src/project/variants-store.js';
import { renderWorkbenchWizardsPage } from '../platform/pages/workbench-wizards.js';
import { renderWizardVariantsPage } from '../platform/pages/wizard-variants.js';
import { renderWizardSamplerPage } from '../platform/pages/wizard-sampler.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const ROUTER_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'router.ts');
const SAMPLER_API_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'api', 'sampler-api.ts');
const VARIANTS_API_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'api', 'variants-api.ts');
const WIZARD_SHARED_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '157-wizard-shared.js');
const ANNOTATIONS_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '040-annotations.js');
const INIT_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '160-init.js');
const DASHBOARD_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'pages', 'dashboard.ts');
const CSS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'platform-ui.css');

function setupProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-wz-test-'));
  initProject(dir, 'wz-test');
  setProjectDir(dir);
  clearScenes();
  return dir;
}

function main(): void {
  console.log('Phase 4 Brief 4b — Wizards + thread bus contract\n');
  const dir = setupProject();

  // ─── Pin #1 — variants storage ─────────────────────────────
  console.log('Pin #1 — variants storage');
  {
    assert(listVariants(dir).length === 0, 'listVariants empty initially');

    const spec = writeVariantsSpec(dir, {
      variantsId: 'density-grid',
      name: 'Density grid',
      sceneId: 's1',
      axes: [
        { name: 'density', values: ['compact', 'default', 'dense'] },
        { name: 'radius', values: ['sharp', 'soft'] },
      ],
      grid: { columns: 3, rows: 2 },
      brand: 'stripe',
    });
    assert(spec.variantsId === 'density-grid', 'write returns spec with id');
    assert(typeof spec.createdAt === 'string', 'createdAt set on write');
    assert(typeof spec.updatedAt === 'string', 'updatedAt set on write');

    const file = path.join(dir, '.reframe', 'variants', 'density-grid', 'variants.json');
    assert(fs.existsSync(file), 'variants.json written to disk');

    const loaded = readVariantsSpec(dir, 'density-grid');
    assert(loaded !== null, 'readVariantsSpec finds the spec');
    assert(!!loaded && loaded.axes.length === 2, 'two axes round-tripped');
    assert(!!loaded && loaded.brand === 'stripe', 'brand override round-tripped');

    const cells = expandCells(loaded!);
    assert(cells.length === 6, 'expandCells produces 3*2 = 6 cells');
    assert(cells[0].density === 'compact' && cells[0].radius === 'sharp',
      'first cell carries first axis values');

    const grid = defaultGrid(loaded!);
    assert(grid.columns === 3 && grid.rows === 2, 'defaultGrid honors explicit grid');

    // Validation rejects bad input.
    let threwBadId = false;
    try { writeVariantsSpec(dir, { variantsId: 'BAD CASE', sceneId: 's1', axes: [{ name: 'a', values: ['1'] }] }); }
    catch { threwBadId = true; }
    assert(threwBadId, 'invalid id (uppercase + space) rejected');

    let threwNoAxes = false;
    try { writeVariantsSpec(dir, { variantsId: 'no-axes', sceneId: 's1', axes: [] }); }
    catch { threwNoAxes = true; }
    assert(threwNoAxes, 'empty axes rejected');

    assert(listVariants(dir).includes('density-grid'), 'list includes the new id');
    assert(deleteVariants(dir, 'density-grid') === true, 'delete returns true');
    assert(readVariantsSpec(dir, 'density-grid') === null, 'spec gone after delete');
  }

  // ─── Pin #1 — variants API endpoint declarations ──────────
  console.log('\nPin #1 — variants-api routes declared');
  {
    const api = fs.readFileSync(VARIANTS_API_TS, 'utf8');
    assert(/req\.method === 'GET'/.test(api), 'GET branch present');
    assert(/req\.method === 'POST'/.test(api), 'POST branch present');
    assert(/req\.method === 'DELETE'/.test(api), 'DELETE branch present');
    assert(api.includes("'composition:created:variants'"),
      'create event emitted on POST');
    assert(api.includes("'composition:deleted:variants'"),
      'delete event emitted on DELETE');

    const router = fs.readFileSync(ROUTER_TS, 'utf8');
    assert(router.includes("/platform/api/variants"),
      'router whitelists variants API path');
    assert(router.includes('handleVariantsApi'),
      'router imports the handler');
  }

  // ─── Pin #4 — sampler POST endpoint added ─────────────────
  console.log('\nPin #4 — sampler-api POST added');
  {
    const api = fs.readFileSync(SAMPLER_API_TS, 'utf8');
    assert(/req\.method === 'POST'/.test(api),
      'sampler-api now has POST branch');
    assert(api.includes("'composition:created:sampler'"),
      'sampler create event emitted on POST');
    assert(api.includes('writeSamplerSpec'),
      'sampler POST calls writeSamplerSpec');
  }

  // ─── Pin #2 — shared wizard primitive ─────────────────────
  console.log('\nPin #2 — shared wizard primitive');
  {
    const bundle = fs.readFileSync(WIZARD_SHARED_JS, 'utf8');
    assert(bundle.includes('window.reframeRenderScenePicker'),
      'renderScenePicker exported');
    assert(bundle.includes('window.reframeRenderConfigForm'),
      'renderConfigForm exported');
    assert(bundle.includes('window.reframeRenderLivePreview'),
      'renderLivePreview exported');
    assert(bundle.includes('window.reframeRenderCommitStep'),
      'renderCommitStep exported');
    assert(bundle.includes('window.reframeRenderWizardBreadcrumb'),
      'renderWizardBreadcrumb exported');
    assert(bundle.includes('window.reframeBindWizardActions'),
      'bindWizardActions exported');
    assert(bundle.includes('window.reframeMountWizard'),
      'mountWizard exported');
    assert(bundle.includes('function bindVariantsWizard'),
      'variants binder fn declared');
    assert(bundle.includes('function bindSamplerWizard'),
      'sampler binder fn declared');
    assert(bundle.includes("'/platform/api/variants'"),
      'variants binder POSTs к variants endpoint');
    assert(/'\/platform\/api\/sampler\/'/.test(bundle),
      'sampler binder POSTs к sampler endpoint');

    // Init wires the per-kind binders.
    const init = fs.readFileSync(INIT_JS, 'utf8');
    assert(init.includes('reframeBindVariantsWizard'),
      'init invokes variants wizard binder');
    assert(init.includes('reframeBindSamplerWizard'),
      'init invokes sampler wizard binder');
  }

  // ─── Pin #3 + #4 — wizard pages render ────────────────────
  console.log('\nPin #3 + #4 — wizard pages render');
  {
    const variantsHtml = renderWizardVariantsPage({ scenes: [{ id: 's1', slug: 's1', name: 'Scene 1', nodes: 5 }] });
    assert(variantsHtml.includes('Variants wizard'),
      'variants page title rendered');
    assert(/data-page="wizard-variants"/.test(variantsHtml),
      'body anchor for binder activation');
    assert(/data-wz-host data-wz-kind="variants"/.test(variantsHtml),
      'wizard host element with kind attr');
    assert(/data-wz-scenes-json/.test(variantsHtml),
      'scenes JSON injected as data attr');
    assert(/data-wz-skill="reframe-design"/.test(variantsHtml),
      'design skill chip present');
    assert(/data-wz-skill="reframe-critic"/.test(variantsHtml),
      'critic skill chip present');

    const samplerHtml = renderWizardSamplerPage({ scenes: [{ id: 's1', slug: 's1', name: 'Scene 1', nodes: 5 }] });
    assert(samplerHtml.includes('Sampler wizard'),
      'sampler page title rendered');
    assert(/data-page="wizard-sampler"/.test(samplerHtml),
      'sampler body anchor for binder activation');
    assert(/data-wz-host data-wz-kind="sampler"/.test(samplerHtml),
      'sampler wizard host with kind attr');
  }

  // ─── Pin #5 — wizards catalog page ────────────────────────
  console.log('\nPin #5 — wizards catalog page');
  {
    const html = renderWorkbenchWizardsPage({
      cards: [
        { kind: 'variants', name: 'Variants', description: 'd', iconSvgPath: '<rect x="0" y="0" width="1" height="1"/>', existing: [], shipping: true },
        { kind: 'sampler', name: 'Sampler', description: 'd', iconSvgPath: '<rect x="0" y="0" width="1" height="1"/>', existing: [], shipping: true },
        { kind: 'flow', name: 'Flow', description: 'd', iconSvgPath: '<rect x="0" y="0" width="1" height="1"/>', existing: [], shipping: false },
        { kind: 'overlay', name: 'Overlay', description: 'd', iconSvgPath: '<rect x="0" y="0" width="1" height="1"/>', existing: [], shipping: false },
      ],
    });
    assert(html.includes('Composition wizards'),
      'catalog page title rendered');
    assert(/data-page="workbench-wizards"/.test(html),
      'body anchor for catalog page');
    assert(/data-testid="wizard-variants-cta"/.test(html),
      'variants card CTA testid');
    assert(/data-testid="wizard-sampler-cta"/.test(html),
      'sampler card CTA testid');
    assert(/data-testid="wizard-flow-cta"/.test(html),
      'flow card CTA testid (placeholder)');
    assert(/data-testid="wizard-overlay-cta"/.test(html),
      'overlay card CTA testid (placeholder)');
    assert((html.match(/wzc-cta--disabled/g) ?? []).length === 2,
      'two disabled CTAs (flow + overlay coming-soon)');
    assert((html.match(/wzc-soon-badge/g) ?? []).length === 2,
      'two coming-soon badges');
  }

  // ─── Pin #5 — router declares wizard routes ───────────────
  console.log('\nPin #5 — router wizard routes');
  {
    const router = fs.readFileSync(ROUTER_TS, 'utf8');
    assert(router.includes("'/platform/workbench/wizards'"),
      'router has catalog route');
    assert(router.includes("'/platform/workbench/wizards/variants'"),
      'router has variants wizard route');
    assert(router.includes("'/platform/workbench/wizards/sampler'"),
      'router has sampler wizard route');
    assert(router.includes('renderWorkbenchWizardsPage'),
      'router imports catalog renderer');
    assert(router.includes('renderWizardVariantsPage'),
      'router imports variants renderer');
    assert(router.includes('renderWizardSamplerPage'),
      'router imports sampler renderer');
  }

  // ─── Pin #6 — skill chips foundation ──────────────────────
  console.log('\nPin #6 — skill chips foundation hooks');
  {
    const variantsHtml = renderWizardVariantsPage({ scenes: [] });
    assert(/data-skill-pending="phase-4d"/.test(variantsHtml),
      'variants chips carry data-skill-pending="phase-4d"');
    assert(/disabled title="Phase 4d wires/.test(variantsHtml),
      'variants chips render disabled with Phase 4d tooltip');

    const samplerHtml = renderWizardSamplerPage({ scenes: [] });
    assert(/data-skill-pending="phase-4d"/.test(samplerHtml),
      'sampler chip carries data-skill-pending="phase-4d"');
  }

  // ─── Pin #7 — thread panel bus migration ─────────────────
  console.log('\nPin #7 — thread panel bus migration');
  {
    const ann = fs.readFileSync(ANNOTATIONS_JS, 'utf8');
    assert(ann.includes('parseSlashCommand'),
      'parseSlashCommand fn declared');
    assert(ann.includes('SKILL_BY_VERB'),
      'verb→skill mapping table declared');
    assert(ann.includes("'critic':"),
      'critic verb mapping present');
    assert(ann.includes("'design':"),
      'design verb mapping present');
    assert(ann.includes('/platform/api/skill-bus/invoke'),
      'thread reply routes к bus invoke endpoint');
    assert(ann.includes('mountThreadBusEntry'),
      'mountThreadBusEntry fn declared');
    assert(ann.includes('renderSkillProgress'),
      'uses 152-skill-result-render renderSkillProgress');
    assert(ann.includes('renderSkillResult'),
      'uses 152-skill-result-render renderSkillResult');
    assert(ann.includes('__reframeSkillBusSubscribers'),
      'subscribes к Phase 3.5 sibling registry');
  }

  // ─── Pin #8 — dashboard card ──────────────────────────────
  console.log('\nPin #8 — dashboard wizards card');
  {
    const dashboard = fs.readFileSync(DASHBOARD_TS, 'utf8');
    assert(dashboard.includes('/platform/workbench/wizards'),
      'dashboard links к wizards catalog');
    assert(dashboard.includes('Composition wizards'),
      'dashboard card label matches');
    assert(dashboard.includes('dashboard-wizards'),
      'dashboard card carries data-testid');
  }

  // ─── Pin #10 — CSS sanity ─────────────────────────────────
  console.log('\nPin #10 — CSS sanity');
  {
    const css = fs.readFileSync(CSS, 'utf8');
    assert(css.includes('.wzc-page'), 'wzc-page CSS class shipped');
    assert(css.includes('.wz-page'), 'wz-page CSS class shipped');
    assert(css.includes('.wz-breadcrumb'), 'wizard breadcrumb CSS shipped');
    assert(css.includes('.wz-step-panel'), 'step panel CSS shipped');
    assert(css.includes('.wz-preview-frame'), 'preview iframe CSS shipped');
    assert(css.includes('.thread-bus-entry'), 'thread bus entry CSS shipped');
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main();
