/**
 * Phase 4 Brief 4a — Components Workbench foundation contract.
 *
 * Pins covered:
 *   #1 Workbench page route /platform/workbench/components + renderer
 *   #2 Catalog grid (master list + slot/instance badges + empty state)
 *   #3 ComponentsWorkbenchService — listComponents, loadComponent,
 *      listInstancesUsing, extractFromSelection, instantiate,
 *      editInstance, unlinkInstance, deleteComponent,
 *      skillInvocationContext (Phase 4d hook)
 *   #4 Workbench split-panel layout (Master / Slots / Instances /
 *      Skill actions sections + live preview iframe)
 *   #5 Inspector slot-overrides section appears when type === INSTANCE
 *   #6 Context menu Extract handler wired through workbench API
 *   #7 Insert component context-menu entry present
 *   #8 Dashboard card linking к /platform/workbench/components
 *   #10 Bundle 156-workbench-components.js exists with binder fn names
 *
 * Run: npx tsx packages/mcp/src/tests/week20-components-workbench-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { initProject } from '../../../core/src/project/io.js';
import { setProjectDir, clearScenes, storeScene, listScenes, getScene } from '../store.js';
import { SceneGraph } from '../../../core/src/engine/scene-graph.js';
import {
  saveComponentMaster,
  loadComponentMaster,
} from '../../../core/src/project/components.js';
import {
  listComponents,
  loadComponent,
  listInstancesUsing,
  extractFromSelection,
  instantiate,
  editInstance,
  unlinkInstance,
  deleteComponent,
  skillInvocationContext,
} from '../platform/api/components-workbench-service.js';
import { renderWorkbenchComponentsPage } from '../platform/pages/workbench-components.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const ROUTER_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'router.ts');
const NODE_EDIT_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'api', 'node-edit.ts');
const PROPERTIES_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '110-properties.js');
const CONTEXT_MENU_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '045-context-menu.js');
const SELECTION_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '020-selection.js');
const WORKBENCH_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '156-workbench-components.js');
const DASHBOARD_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'pages', 'dashboard.ts');
const CSS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'platform-ui.css');

function setupProject(): { dir: string; sceneId: string; nodeId: string; rootId: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-cw-test-'));
  initProject(dir, 'cw-test');
  setProjectDir(dir);
  clearScenes();

  // Build a minimal SceneGraph: page root with one FRAME child carrying a slot.
  const graph = new SceneGraph();
  const page = graph.addPage('test-page');
  const root = graph.createNode('FRAME', page.id, { name: 'root', width: 1440, height: 900 } as any);
  const frame = graph.createNode('FRAME', root.id, { name: 'card', width: 320, height: 200 } as any);
  graph.createNode('TEXT', frame.id, {
    name: 'title', text: 'Hello', slot: 'heading',
    width: 200, height: 24,
  } as any);

  // Persist into store as a session scene. storeScene returns the
  // generated sessionId.
  const sceneId = storeScene(graph, root.id, undefined, {
    slug: 'test-scene',
    name: 'Test scene',
  });

  return { dir, sceneId, nodeId: frame.id, rootId: root.id };
}

async function main(): Promise<void> {
  console.log('Phase 4 Brief 4a — Components Workbench foundation contract\n');
  const { dir, sceneId, nodeId, rootId } = setupProject();

  // ─── Pin #3 — service layer ────────────────────────────────
  console.log('Pin #3 — ComponentsWorkbenchService');
  {
    // Empty start.
    const empty = listComponents(dir);
    assert(Array.isArray(empty) && empty.length === 0, 'listComponents starts empty');

    // skillInvocationContext shape — Phase 4d foundation hook.
    const skillCtx = skillInvocationContext({
      componentSlug: 'card',
      scope: 'master',
      sceneId: 'test-scene',
      nodeId: 'n1',
    });
    assert(skillCtx.componentSlug === 'card', 'skill context carries component slug');
    assert(skillCtx.scope === 'master', 'skill context carries scope');
    assert(skillCtx.nodeId === 'n1', 'skill context carries node anchor');

    // Extract — wraps engine extractComponent op + saves master to disk.
    const extracted = await extractFromSelection({
      projectDir: dir,
      sceneId,
      nodeId,
      name: 'CardMaster',
      description: 'Reusable card subtree',
    });
    assert(extracted.slug === 'cardmaster', 'extract derives slug from name');
    assert(typeof extracted.instanceId === 'string' && extracted.instanceId.length > 0,
      'extract returns the placeholder instance id');

    // Master file exists on disk.
    const masterFile = loadComponentMaster(dir, 'cardmaster');
    assert(masterFile !== null, 'master file written to .reframe/components/');
    assert(!!masterFile && masterFile.name === 'CardMaster',
      'master carries the original name');
    assert(!!masterFile && (masterFile.slots ?? []).includes('heading'),
      'extracted master surfaces slots from data-reframe-slot');

    // listComponents shows the new entry with instance count = 1.
    const catalog = listComponents(dir);
    assert(catalog.length === 1, 'catalog has the extracted component');
    const entry = catalog[0];
    assert(entry.slug === 'cardmaster', 'catalog entry slug matches');
    assert(entry.instanceCount === 1, 'catalog reports 1 instance after extract');
    assert(entry.slots.includes('heading'), 'catalog surfaces slot list');

    // loadComponent returns full detail.
    const detail = loadComponent(dir, 'cardmaster');
    assert(detail !== null, 'loadComponent finds master');
    assert(!!detail && detail.revision === 1, 'first save is revision 1');

    // listInstancesUsing walks all scenes and finds the placeholder.
    const insts = listInstancesUsing(dir, 'cardmaster');
    assert(insts.length === 1, 'listInstancesUsing finds 1 instance');
    assert(insts[0].sceneId === sceneId, 'instance ref carries scene id');

    // Insert another instance via instantiate.
    const inserted = await instantiate({
      projectDir: dir,
      sceneId,
      parentId: rootId,
      componentSlug: 'cardmaster',
    });
    assert(typeof inserted.instanceId === 'string' && inserted.instanceId.length > 0,
      'instantiate returns new instance id');
    assert(listInstancesUsing(dir, 'cardmaster').length === 2,
      'second instance counted');

    // Edit slot override.
    const result = await editInstance({
      projectDir: dir,
      sceneId,
      nodeId: inserted.instanceId,
      patch: { heading: { text: 'Custom heading' } },
    });
    assert(result.overrides.heading?.text === 'Custom heading',
      'editInstance stores slot override');

    // Reset slot back to master default via null patch.
    const reset = await editInstance({
      projectDir: dir,
      sceneId,
      nodeId: inserted.instanceId,
      patch: { heading: null },
    });
    assert(!reset.overrides.heading, 'null patch clears slot override');

    // Unlink severs the instance from the master.
    await unlinkInstance({ projectDir: dir, sceneId, nodeId: inserted.instanceId });
    const stored = getScene(sceneId);
    const node = (stored as any).graph.getNode(inserted.instanceId);
    assert(node && node.type !== 'INSTANCE',
      'unlinkInstance changes type away from INSTANCE');

    // Delete master removes file from disk.
    const removed = deleteComponent(dir, 'cardmaster');
    assert(removed === true, 'deleteComponent returns true on success');
    assert(loadComponentMaster(dir, 'cardmaster') === null,
      'master file gone from disk');
    assert(deleteComponent(dir, 'cardmaster') === false,
      'second delete returns false (idempotent)');
  }

  // ─── Pin #1 + #2 + #4 — page renderer ──────────────────────
  console.log('\nPin #1 + #2 + #4 — page renderer');
  {
    // Seed a fresh master so catalog has content for the render assertions.
    const graph = new SceneGraph();
    const page = graph.addPage('master-page');
    const root = graph.createNode('FRAME', page.id, { name: 'r', width: 200, height: 100 } as any);
    graph.createNode('TEXT', root.id, { name: 'label', text: 'btn', slot: 'label' } as any);
    saveComponentMaster(dir, 'PrimaryButton', graph, root.id, {
      description: 'Brand-tier CTA',
    });

    // Catalog mode.
    const catalog = listComponents(dir);
    assert(catalog.length === 1, 'catalog has the seeded master');
    const catalogHtml = renderWorkbenchComponentsPage({ catalog });
    assert(catalogHtml.includes('Components workbench'), 'page title rendered');
    assert(catalogHtml.includes('cw-catalog-grid'), 'catalog grid mounted');
    assert(catalogHtml.includes('data-cw-filter'), 'search input rendered');
    assert(catalogHtml.includes('data-component-slug="primarybutton"'),
      'card carries slug');
    assert(catalogHtml.includes('PrimaryButton'), 'card shows display name');
    assert(/data-page="workbench-components"/.test(catalogHtml),
      'body carries data-page="workbench-components" for binder activation');

    // Workbench mode.
    const detail = loadComponent(dir, 'primarybutton');
    const wbHtml = renderWorkbenchComponentsPage({
      catalog,
      selectedSlug: 'primarybutton',
      selectedMaster: detail!,
      instances: [],
      availableScenes: [{ id: 's1', slug: 's1', name: 'Test' }],
    });
    assert(wbHtml.includes('← Back to catalog'), 'back link present');
    assert(/data-cw-slug="primarybutton"/.test(wbHtml),
      'workbench root carries selected slug');
    assert(wbHtml.includes('>Master</summary>'), 'Master section header rendered');
    assert(/>Slots\s*<span class="cw-section-meta"/.test(wbHtml),
      'Slots section header rendered');
    assert(/>Instances\s*<span class="cw-section-meta"/.test(wbHtml),
      'Instances section header rendered');
    assert(wbHtml.includes('Skill actions'), 'Skill actions section rendered');
    assert(wbHtml.includes('data-cw-instantiate'),
      'Insert-into-scene affordance rendered');
    assert(wbHtml.includes('data-cw-instantiate-modal'),
      'instantiate modal rendered');
    // Phase 4a foundation — chips render disabled until 4d.
    assert(/data-cw-skill="reframe-critic"[^>]*disabled/.test(wbHtml),
      'critic chip is disabled placeholder (Phase 4d wires it)');
    assert(/data-cw-skill="reframe-design"[^>]*disabled/.test(wbHtml),
      'design chip is disabled placeholder (Phase 4d wires it)');

    // Empty state.
    const emptyHtml = renderWorkbenchComponentsPage({ catalog: [] });
    assert(emptyHtml.includes('No components yet'),
      'empty catalog shows guidance text');
    assert(emptyHtml.includes('Extract component'),
      'empty state references the extract entry point');
  }

  // ─── Pin #1 — router wiring ────────────────────────────────
  console.log('\nPin #1 — router declares /platform/workbench/components');
  {
    const router = fs.readFileSync(ROUTER_TS, 'utf8');
    assert(router.includes('/platform/workbench/components'),
      'router has the workbench/components page route');
    assert(router.includes('renderWorkbenchComponentsPage'),
      'router imports the page renderer');
    assert(router.includes('listComponentsForWorkbench'),
      'router calls service-layer listComponents');
    assert(router.includes('listComponentInstances'),
      'router calls service-layer listInstancesUsing');
  }

  // ─── Pin #3 — API endpoints ───────────────────────────────
  console.log('\nPin #3 — workbench/components API endpoints');
  {
    const api = fs.readFileSync(NODE_EDIT_TS, 'utf8');
    assert(api.includes("'/platform/api/workbench/components/extract'"),
      'extract endpoint declared');
    assert(api.includes("'/platform/api/workbench/components/instantiate'"),
      'instantiate endpoint declared');
    assert(api.includes("'/platform/api/workbench/components/edit-instance'"),
      'edit-instance endpoint declared');
    assert(api.includes("'/platform/api/workbench/components/unlink'"),
      'unlink endpoint declared');
    assert(api.includes("'/platform/api/workbench/components/delete'"),
      'delete endpoint declared');
    assert(api.includes("type: 'component:extracted'"),
      'extracted event emitted on extract');
    assert(api.includes("type: 'component:instantiated'"),
      'instantiated event emitted on insert');
  }

  // ─── Pin #5 — inspector slot-overrides section ────────────
  console.log('\nPin #5 — inspector slot-overrides section');
  {
    const properties = fs.readFileSync(PROPERTIES_JS, 'utf8');
    assert(properties.includes('renderSlotOverridesSection'),
      'render fn exists in inspector bundle');
    assert(properties.includes('bindSlotOverrideEditors'),
      'bind fn exists in inspector bundle');
    assert(properties.includes("(props.type || '').toLowerCase() === 'instance'"),
      'INSTANCE-only gate present');
    assert(properties.includes('/platform/api/workbench/components/edit-instance'),
      'inspector commits via workbench edit-instance endpoint');
    assert(properties.includes('data-slot-input'),
      'per-slot input attr renders');
    assert(properties.includes('data-slot-reset'),
      'per-slot reset button attr renders');

    // node-edit.ts surfaces overrides + slots in /api/node/get for INSTANCE
    // nodes — the inspector reads them off props.slots / props.overrides.
    const api = fs.readFileSync(NODE_EDIT_TS, 'utf8');
    assert(api.includes("if (node.type === 'INSTANCE')"),
      'nodeToCssProps branch for INSTANCE');
    assert(/loadComponentMaster\([^)]*ctx\.projectDir/.test(api),
      'GET handler resolves master to attach slots[]');
  }

  // ─── Pin #6 + #7 — context menu wires ─────────────────────
  console.log('\nPin #6 + #7 — context menu wires');
  {
    const ctxMenu = fs.readFileSync(CONTEXT_MENU_JS, 'utf8');
    assert(ctxMenu.includes('data-ctx="extract">Extract component'),
      'extract entry remains in context menu');
    assert(ctxMenu.includes('data-ctx="insert-component">Insert component'),
      'insert-component entry added');

    const sel = fs.readFileSync(SELECTION_JS, 'utf8');
    assert(sel.includes('/platform/api/workbench/components/extract'),
      'selection extract handler calls workbench API');
    assert(sel.includes("case 'insert-component'"),
      'insert-component handler exists');
    assert(sel.includes('/platform/workbench/components'),
      'insert-component opens workbench page');
  }

  // ─── Pin #8 — dashboard card ──────────────────────────────
  console.log('\nPin #8 — dashboard card');
  {
    const dashboard = fs.readFileSync(DASHBOARD_TS, 'utf8');
    assert(dashboard.includes('/platform/workbench/components'),
      'dashboard links to components workbench');
    assert(dashboard.includes('Components workbench'),
      'dashboard card label matches');
    assert(dashboard.includes('dashboard-components-workbench'),
      'dashboard card carries data-testid for QA probes');
  }

  // ─── Pin #10 — bundle file structure ──────────────────────
  console.log('\nPin #10 — bundle 156-workbench-components.js');
  {
    const bundle = fs.readFileSync(WORKBENCH_JS, 'utf8');
    assert(bundle.includes('function bindComponentsWorkbench'),
      'main binder fn declared');
    assert(bundle.includes('function bindComponentsFilter'),
      'filter binder fn declared');
    assert(bundle.includes('function bindComponentsInstantiate'),
      'instantiate binder fn declared');
    assert(bundle.includes('function bindComponentsDelete'),
      'delete binder fn declared');
    assert(bundle.includes("'/platform/api/workbench/components/instantiate'"),
      'instantiate POST path baked in');
    assert(bundle.includes("'/platform/api/workbench/components/delete'"),
      'delete POST path baked in');
    assert(bundle.includes('data-page="workbench-components"'),
      'binder gates on page anchor selector');

    // CSS sanity.
    const css = fs.readFileSync(CSS, 'utf8');
    assert(css.includes('.cw-page'), 'cw-page CSS class shipped');
    assert(css.includes('.cw-catalog-grid'), 'catalog grid CSS shipped');
    assert(css.includes('.cw-workbench-body'), 'workbench split-panel CSS shipped');
    assert(css.includes('.cw-instantiate-modal'),
      'instantiate modal CSS shipped');
    assert(css.includes('.instance-overrides-section'),
      'inspector slot-override styling shipped');
  }

  // ─── Backward compat — sanity that store still sees the seeded scene
  console.log('\nBackward compat — store sanity');
  {
    const scenes = listScenes();
    assert(scenes.length === 1, 'one session scene present');
    assert(scenes[0].slug === 'test-scene', 'seeded scene slug intact');
    assert(scenes[0].id === sceneId, 'seeded scene sessionId resolved');
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
