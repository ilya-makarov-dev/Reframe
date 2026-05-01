/**
 * Phase 4 Brief 4c — Flow + Overlay wizards + renderer storage-backed
 * dispatch contract.
 *
 * Pins covered:
 *   #1 Renderer storage-backed dispatch — variants slug detection in
 *      platform-bootstrap.ts; CompositionDescriptor accepts hostIds[];
 *      wizard live preview points к multi-cell URL для variants.
 *   #2 Flow wizard page + sequence editor (renderConfigForm dispatch
 *      to flow + per-step row management).
 *   #3 Overlay wizard page + layer config (≤3 layer cap enforced
 *      both в UI binder + в /api/overlay POST).
 *   #4 Catalog ships 4 active cards (no SOON badges) — Flow + Overlay
 *      no longer in coming-soon state.
 *   #5 Skill chips for flow + overlay carry data-skill-pending.
 *
 * Run: npx tsx packages/mcp/src/tests/week22-flow-overlay-wizards-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { initProject } from '../../../core/src/project/io.js';
import { setProjectDir, clearScenes } from '../store.js';
import { renderWorkbenchWizardsPage } from '../platform/pages/workbench-wizards.js';
import { renderWizardFlowPage } from '../platform/pages/wizard-flow.js';
import { renderWizardOverlayPage } from '../platform/pages/wizard-overlay.js';
import {
  writeFlowSpec,
  readFlowSpec,
  listFlows,
  type FlowSpec,
} from '../../../core/src/project/flow-store.js';
import {
  writeOverlaySpec,
  readOverlaySpec,
  listOverlays,
  type OverlaySpec,
} from '../../../core/src/project/overlay-store.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const ROUTER_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'router.ts');
const FLOW_API_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'api', 'flow-api.ts');
const OVERLAY_API_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'api', 'overlay-api.ts');
const WIZARD_SHARED_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '157-wizard-shared.js');
const PLATFORM_BOOTSTRAP_TS = path.join(REPO_ROOT, 'packages', 'editor', 'src', 'app', 'platform-bootstrap.ts');
const COMPOSITION_RENDERER_TS = path.join(REPO_ROOT, 'packages', 'editor', 'src', 'canvas-dom', 'composition-renderer.ts');
const INIT_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '160-init.js');
const CSS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'platform-ui.css');

function setupProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-4c-test-'));
  initProject(dir, '4c-test');
  setProjectDir(dir);
  clearScenes();
  return dir;
}

function main(): void {
  console.log('Phase 4 Brief 4c — Flow + Overlay wizards + renderer\n');
  const dir = setupProject();

  // ─── Pin #1 — renderer storage-backed dispatch ────────────
  console.log('Pin #1 — renderer storage-backed dispatch');
  {
    const bootstrap = fs.readFileSync(PLATFORM_BOOTSTRAP_TS, 'utf8');
    assert(bootstrap.includes('SLUG_RE'),
      'platform-bootstrap defines slug regex for variants storage detect');
    assert(/SLUG_RE\.test\(variantsParam\)/.test(bootstrap),
      'variants param tested against slug regex before fetch');
    assert(bootstrap.includes('/platform/api/variants/'),
      'storage-backed variants fetch wired');
    assert(bootstrap.includes('storedVariantIds'),
      'storage-backed variants ids tracked separately from CSV');
    assert(bootstrap.includes('variantHostIds'),
      'synthesised hostIds for storage-backed variants');
    assert(bootstrap.includes('expandCells') || bootstrap.includes('recurse'),
      'axis Cartesian unroll present for cell labels');

    // CompositionDescriptor accepts hostIds[]
    const renderer = fs.readFileSync(COMPOSITION_RENDERER_TS, 'utf8');
    assert(renderer.includes('hostIds?:'),
      'CompositionDescriptor adds hostIds optional field');
    assert(renderer.includes("composition.hostIds?.[i] ?? sceneId"),
      'composition-renderer uses hostId override when provided');

    // Flow / Sampler / Overlay already storage-backed (regression guard).
    assert(bootstrap.includes('/platform/api/flow/'),
      'flow URL still fetches storage spec');
    assert(bootstrap.includes('/platform/api/sampler/'),
      'sampler URL still fetches storage spec');
    assert(bootstrap.includes('overlayId: overlayParam'),
      'overlay URL still passes id к mountOverlayRenderer');
  }

  // ─── Pin #2 — flow wizard page + flow API POST ────────────
  console.log('\nPin #2 — Flow wizard');
  {
    const flowHtml = renderWizardFlowPage({ scenes: [{ id: 's1', slug: 's1', name: 'Scene 1', nodes: 5 }] });
    assert(flowHtml.includes('Flow wizard'), 'flow page title rendered');
    assert(/data-page="wizard-flow"/.test(flowHtml),
      'flow body anchor for binder activation');
    assert(/data-wz-host data-wz-kind="flow"/.test(flowHtml),
      'flow wizard host with kind attr');
    assert(/data-wz-skill="reframe-design"/.test(flowHtml),
      'flow page mounts design skill chip');
    assert(/data-wz-skill="reframe-critic"/.test(flowHtml),
      'flow page mounts critic skill chip');

    // Shared primitive renders flow config form.
    const bundle = fs.readFileSync(WIZARD_SHARED_JS, 'utf8');
    assert(bundle.includes("kind === 'flow'"),
      'renderConfigForm dispatches on flow kind');
    assert(bundle.includes('renderFlowConfig'),
      'flow config form renderer declared');
    assert(bundle.includes('TRANSITIONS = ['),
      'transition kinds enumerated (cut/crossfade/etc.)');
    assert(bundle.includes('data-wz-step-add'),
      'add step button present');
    assert(bundle.includes('data-wz-step-up'),
      'move step up button present');
    assert(bundle.includes('data-wz-step-down'),
      'move step down button present');
    assert(bundle.includes('data-wz-step-remove'),
      'remove step button present');
    assert(bundle.includes('function bindFlowWizard'),
      'flow wizard binder fn declared');
    assert(/'\/platform\/api\/flow'/.test(bundle),
      'flow binder POSTs к bare /api/flow path');

    // API POST endpoint.
    const flowApi = fs.readFileSync(FLOW_API_TS, 'utf8');
    assert(flowApi.includes("'/platform/api/flow'") && flowApi.includes("req.method === 'POST'"),
      'flow-api adds bare-path POST handler');
    assert(flowApi.includes("'composition:created:flow'"),
      'flow create event emitted');
    assert(flowApi.includes('writeFlowSpec'),
      'flow POST calls engine writeFlowSpec');

    // Engine round-trip via store helpers (decouples from HTTP layer).
    const spec: FlowSpec = {
      flowId: 'onboarding',
      name: 'Onboarding',
      stepSceneIds: ['s1', 's2', 's3'],
      transitions: [
        { from: 0, to: 1, label: 'crossfade' },
        { from: 1, to: 2, label: 'slide-left' },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeFlowSpec(dir, spec);
    const file = path.join(dir, '.reframe', 'flows', 'onboarding', 'flow.json');
    assert(fs.existsSync(file), 'flow.json written to disk');
    const loaded = readFlowSpec(dir, 'onboarding');
    assert(!!loaded && loaded.stepSceneIds.length === 3, 'flow round-trip preserves stepSceneIds');
    assert(listFlows(dir).includes('onboarding'), 'listFlows returns onboarding id');
  }

  // ─── Pin #3 — overlay wizard page + overlay API POST ──────
  console.log('\nPin #3 — Overlay wizard');
  {
    const overlayHtml = renderWizardOverlayPage({ scenes: [{ id: 's1', slug: 's1', name: 'Scene 1', nodes: 5 }] });
    assert(overlayHtml.includes('Overlay wizard'), 'overlay page title rendered');
    assert(/data-page="wizard-overlay"/.test(overlayHtml),
      'overlay body anchor for binder activation');
    assert(/data-wz-host data-wz-kind="overlay"/.test(overlayHtml),
      'overlay wizard host with kind attr');

    const bundle = fs.readFileSync(WIZARD_SHARED_JS, 'utf8');
    assert(bundle.includes("kind === 'overlay'"),
      'renderConfigForm dispatches on overlay kind');
    assert(bundle.includes('renderOverlayConfig'),
      'overlay config form renderer declared');
    assert(bundle.includes('BLEND_MODES = ['),
      'blend modes enumerated');
    assert(bundle.includes('LAYER_TYPES = ['),
      'layer types enumerated');
    assert(bundle.includes('data-wz-layer-add'),
      'add layer button present');
    assert(bundle.includes('atMax'),
      '≤3-layer cap UI guard present');
    assert(bundle.includes('function bindOverlayWizard'),
      'overlay wizard binder fn declared');
    assert(/'\/platform\/api\/overlay'/.test(bundle),
      'overlay binder POSTs к bare /api/overlay path');

    // API POST endpoint with cap enforcement.
    const overlayApi = fs.readFileSync(OVERLAY_API_TS, 'utf8');
    assert(overlayApi.includes("'/platform/api/overlay'") && overlayApi.includes("req.method === 'POST'"),
      'overlay-api adds bare-path POST handler');
    assert(/layers\.length > 3/.test(overlayApi),
      'overlay POST enforces ≤3 layer cap');
    assert(overlayApi.includes("'composition:created:overlay'"),
      'overlay create event emitted');

    // Engine round-trip.
    const spec: OverlaySpec = {
      overlayId: 'dust-overlay',
      name: 'Dust',
      baseSceneId: 's1',
      layers: [
        { id: 'l1', type: 'noise-grain', config: { opacity: 0.3 }, blendMode: 'multiply' as any, zIndex: 1 } as any,
        { id: 'l2', type: 'shader-glow', config: { opacity: 0.5 }, blendMode: 'screen' as any, zIndex: 2 } as any,
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeOverlaySpec(dir, spec);
    const file = path.join(dir, '.reframe', 'overlays', 'dust-overlay', 'overlay.json');
    assert(fs.existsSync(file), 'overlay.json written to disk');
    const loaded = readOverlaySpec(dir, 'dust-overlay');
    assert(!!loaded && loaded.layers.length === 2, 'overlay round-trip preserves layers');
    assert(listOverlays(dir).includes('dust-overlay'), 'listOverlays returns id');
  }

  // ─── Pin #4 — catalog ships 4 active cards ────────────────
  console.log('\nPin #4 — Catalog 4 active cards');
  {
    const html = renderWorkbenchWizardsPage({
      cards: [
        { kind: 'variants', name: 'Variants', description: 'd', iconSvgPath: '<rect x="0" y="0" width="1" height="1"/>', existing: [], shipping: true },
        { kind: 'sampler', name: 'Sampler', description: 'd', iconSvgPath: '<rect x="0" y="0" width="1" height="1"/>', existing: [], shipping: true },
        { kind: 'flow', name: 'Flow', description: 'd', iconSvgPath: '<rect x="0" y="0" width="1" height="1"/>', existing: [], shipping: true },
        { kind: 'overlay', name: 'Overlay', description: 'd', iconSvgPath: '<rect x="0" y="0" width="1" height="1"/>', existing: [], shipping: true },
      ],
    });
    assert((html.match(/wzc-cta--disabled/g) ?? []).length === 0,
      'no disabled CTAs when all 4 ship');
    assert((html.match(/wzc-soon-badge/g) ?? []).length === 0,
      'no coming-soon badges when all 4 ship');
    assert(/data-testid="wizard-flow-cta"/.test(html),
      'flow CTA testid present');
    assert(/data-testid="wizard-overlay-cta"/.test(html),
      'overlay CTA testid present');

    // Router declares both new routes + reads existing storage lists.
    const router = fs.readFileSync(ROUTER_TS, 'utf8');
    assert(router.includes("'/platform/workbench/wizards/flow'"),
      'router has flow wizard route');
    assert(router.includes("'/platform/workbench/wizards/overlay'"),
      'router has overlay wizard route');
    assert(router.includes('listFlows') && router.includes('readFlowSpec'),
      'router populates flow Existing list from disk');
    assert(router.includes('listOverlays') && router.includes('readOverlaySpec'),
      'router populates overlay Existing list from disk');
    assert(router.includes('flowsExisting') && router.includes('overlaysExisting'),
      'wizards catalog data carries flow + overlay existing lists');
  }

  // ─── Pin #5 — skill chips foundation ──────────────────────
  console.log('\nPin #5 — skill chip foundation hooks');
  {
    const flowHtml = renderWizardFlowPage({ scenes: [] });
    assert(/data-skill-pending="phase-4d"/.test(flowHtml),
      'flow chips carry data-skill-pending="phase-4d"');
    assert(/disabled title="Phase 4d wires/.test(flowHtml),
      'flow chips render disabled with Phase 4d tooltip');

    const overlayHtml = renderWizardOverlayPage({ scenes: [] });
    assert(/data-skill-pending="phase-4d"/.test(overlayHtml),
      'overlay chips carry data-skill-pending="phase-4d"');

    const init = fs.readFileSync(INIT_JS, 'utf8');
    assert(init.includes('reframeBindFlowWizard'),
      'init invokes flow wizard binder');
    assert(init.includes('reframeBindOverlayWizard'),
      'init invokes overlay wizard binder');
  }

  // ─── Pin #1+#7 — live preview multi-cell URL для variants ─
  console.log('\nPin #1 — wizard live preview points к storage URL');
  {
    const bundle = fs.readFileSync(WIZARD_SHARED_JS, 'utf8');
    assert(bundle.includes("'/platform/project/'") && bundle.includes("'?variants='"),
      'variants live preview builds /platform/project URL with ?variants= param');
    assert(/cells\s*>=\s*2/.test(bundle),
      'variants preview gated on cells >= 2');
    assert(bundle.includes('previewMode'),
      'preview mode label tracked for UI hint');
  }

  // ─── CSS sanity ────────────────────────────────────────────
  console.log('\nCSS sanity');
  {
    const css = fs.readFileSync(CSS, 'utf8');
    assert(css.includes('.wz-flow-step'), 'flow step row CSS shipped');
    assert(css.includes('.wz-overlay-layer'), 'overlay layer row CSS shipped');
    assert(css.includes('.wz-icon-btn'), 'icon button CSS shipped');
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Passed: ${passed}    Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main();
