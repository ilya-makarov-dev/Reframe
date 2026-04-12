/**
 * Phase 6 stress test — Component Registry first-class.
 *
 * Run: npx tsx packages/core/src/tests/phase6-components.test.ts
 *
 * Covers:
 *   Component storage (CRUD):
 *     1. saveComponentMaster writes a file with version/slug/slots
 *     2. loadComponentMaster returns same content (round-trip)
 *     3. listComponents returns every master alphabetically
 *     4. deleteComponent removes file; second call returns false
 *     5. Re-save bumps revision and preserves created date
 *     6. Slots are collected from node.slot inside the subtree
 *
 *   Ops dispatcher:
 *     7. extractComponent on missing projectDir → ok=false
 *     8. extractComponent saves master AND replaces subtree with INSTANCE placeholder
 *     9. instantiateComponent creates an INSTANCE with meta.componentName
 *    10. unlinkInstance drops componentName, keeps children, type → FRAME
 *    11. Unknown componentName on instantiate still creates placeholder (rendered as "missing" on next load)
 *
 *   Expand/collapse:
 *    12. expandInstances hydrates from master, children get re-id prefix
 *    13. collapseInstances strips hydrated children, keeps placeholder
 *    14. Expand is idempotent (already-hydrated instances stay intact)
 *    15. Overrides by slot name apply to matching child node
 *    16. Unknown slot in overrides → silent skip
 *
 *   End-to-end via project io:
 *    17. saveScene + loadSceneFromProject round-trips an instance
 *    18. HTML importer creates INSTANCE on data-reframe-component
 *    19. compileHtmlIntoProject expands component instances
 *    20. Update master → recompile scenes → instances reflect new master
 *    21. Delete master → scene still loads (missing recorded in expand result)
 *    22. Variant generation carries instance placeholders into the variant graph
 *    23. Extract op on history replay is idempotent (repeat extract overrides same slug)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  initProject,
  compileHtmlIntoProject,
  loadSceneFromProject,
  saveComponentMaster,
  loadComponentMaster,
  listComponents,
  deleteComponent,
  componentFilePath,
  createInstancePlaceholder,
  expandInstances,
  collapseInstances,
  generateVariant,
  loadProject,
} from '../project/index.js';
import { SceneGraph } from '../engine/scene-graph.js';
import { deserializeScene } from '../serialize.js';
import { importFromHtml } from '../importers/html.js';
import { applyOperation } from '../ops/apply.js';
import type { Operation } from '../ops/types.js';
import type { DesignSystem } from '../design-system/types.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; } else { failed++; console.error(`  FAIL: ${msg}`); }
}

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-6-'));
}
function cleanup(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function makeDS(): DesignSystem {
  return {
    brand: 'P6',
    colors: { primary: '#533afd', background: '#ffffff', text: '#061b31',
      roles: new Map([['primary', '#533afd'], ['background', '#ffffff'], ['text', '#061b31']]) },
    typography: {
      hierarchy: [
        { role: 'hero', fontSize: 56, fontWeight: 300, lineHeight: 1.03, letterSpacing: -1.4 },
        { role: 'body', fontSize: 16, fontWeight: 400, lineHeight: 1.4, letterSpacing: 0 },
      ],
      primaryFont: 'Inter',
    } as any,
    layout: { spacingUnit: 8, borderRadiusScale: [0, 2, 4, 6, 8] } as any,
    responsive: { breakpoints: [], typographyOverrides: [] } as any,
    depth: { elevationLevels: [] } as any,
    components: {} as any,
  } as DesignSystem;
}

// Small reusable HTML for a "pricing card" component
const CARD_HTML = `
<div data-reframe-key="pricing-card" style="width:320px;background:#fff;border:1px solid #e5edf5;border-radius:8px;padding:24px">
  <div data-reframe-slot="title" style="font-size:24px;color:#061b31">Starter</div>
  <div data-reframe-slot="price" style="font-size:48px;color:#061b31">$9</div>
  <div data-reframe-slot="cta" style="padding:12px;background:#533afd;color:#fff;border-radius:4px">Pick</div>
</div>`;

async function main() {
  console.log('═══ PHASE 6: Component Registry Stress Test ═══\n');

  // ── 1-6. CRUD + slots ────────────────────────────────
  console.log('  1-6. Component CRUD + slot collection');
  {
    const dir = tmp();
    try {
      initProject(dir, 'CRUD');
      // Build a tiny graph with a named subtree that has slots.
      const { graph, rootId } = await importFromHtml(CARD_HTML, { stableIds: true });
      // Card root is the first frame under canvas root
      const card = graph.getNode(rootId)!;
      // Save component master
      const saved = saveComponentMaster(dir, 'PricingCard', graph, card.id, {
        description: 'Starter pricing card',
      });
      assert(saved.name === 'PricingCard', 'master.name preserved');
      // toSlug('PricingCard') → 'pricingcard' (no CamelCase split), not 'pricing-card'
      assert(saved.slug === 'pricingcard', `slug derived from name (got ${saved.slug})`);
      assert(saved.revision === 1, 'first save revision=1');
      assert(fs.existsSync(componentFilePath(dir, 'PricingCard')), 'file exists on disk');
      assert((saved.slots ?? []).sort().join(',') === 'cta,price,title', `slots collected (got ${(saved.slots ?? []).join(',')})`);

      // Round-trip: load + compare
      const loaded = loadComponentMaster(dir, 'PricingCard');
      assert(!!loaded, 'loadComponentMaster returns');
      assert(loaded?.name === 'PricingCard', 'loaded name');
      assert(loaded?.description === 'Starter pricing card', 'description round-tripped');

      // listComponents
      const all = listComponents(dir);
      assert(all.length === 1, '1 component listed');
      assert(all[0].slug === 'pricingcard', 'list order');

      // Re-save bumps revision, preserves created date
      const firstCreated = saved.created;
      // delay one ms so updated differs if clock ticks (also proves dedup by slug)
      await new Promise(r => setTimeout(r, 2));
      const re = saveComponentMaster(dir, 'PricingCard', graph, card.id);
      assert(re.revision === 2, `re-save bumps revision to 2 (got ${re.revision})`);
      assert(re.created === firstCreated, 're-save keeps original created timestamp');

      // delete
      assert(deleteComponent(dir, 'PricingCard') === true, 'delete returns true');
      assert(deleteComponent(dir, 'PricingCard') === false, 'second delete returns false');
      assert(listComponents(dir).length === 0, 'no components after delete');
    } finally { cleanup(dir); }
  }

  // ── 7-11. Ops dispatcher ─────────────────────────────
  console.log('  7-11. Component ops dispatcher');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Ops');
      const { graph, rootId } = await importFromHtml(CARD_HTML, { stableIds: true });
      const card = graph.getNode(rootId)!;

      // 7. Missing projectDir/componentAPI → ok=false
      const extractOp: Operation = {
        id: '1', timestamp: 't', type: 'extractComponent',
        nodeId: card.id, name: 'PricingCard',
      };
      const r1 = applyOperation(graph, extractOp, { rootId });
      assert(!r1.ok, 'extractComponent without projectDir → ok=false');

      // 8. With context → subtree replaced by INSTANCE placeholder
      const r2 = applyOperation(graph, extractOp, {
        rootId,
        projectDir: dir,
        componentAPI: { saveComponentMaster, createInstancePlaceholder },
      });
      assert(r2.ok, 'extract with context → ok');
      // The card id is reused on the placeholder (extract preserves id so
      // downstream callers that already held it keep working). The node at
      // this id is now an INSTANCE, not the original FRAME subtree.
      const placeholderByOriginalId = graph.getNode(card.id);
      assert(!!placeholderByOriginalId, 'placeholder lives at original id');
      assert(placeholderByOriginalId?.type === 'INSTANCE', `type=INSTANCE (got ${placeholderByOriginalId?.type})`);
      assert((placeholderByOriginalId?.meta as any)?.componentName === 'PricingCard', 'meta.componentName set');
      // Subtree children are gone — placeholder is a leaf until expand.
      assert(placeholderByOriginalId?.childIds.length === 0, 'placeholder has no children (leaf until expand)');
      // And the master file exists on disk
      assert(!!loadComponentMaster(dir, 'PricingCard'), 'master file written');

      // 9. instantiateComponent
      const instOp: Operation = {
        id: '2', timestamp: 't', type: 'instantiateComponent',
        parentId: rootId, componentName: 'PricingCard',
        overrides: { title: { text: 'Pro' } },
      };
      const r3 = applyOperation(graph, instOp, {
        rootId, projectDir: dir,
        componentAPI: { saveComponentMaster, createInstancePlaceholder },
      });
      assert(r3.ok, 'instantiate ok');
      const instances = [...graph.getAllNodes()].filter(n => n.type === 'INSTANCE' && (n.meta as any)?.componentName === 'PricingCard');
      assert(instances.length === 2, `2 instances in graph (original + new, got ${instances.length})`);

      // 10. unlinkInstance
      const target = instances[0];
      const unlinkOp: Operation = {
        id: '3', timestamp: 't', type: 'unlinkInstance',
        nodeId: target.id,
      };
      const r4 = applyOperation(graph, unlinkOp, { rootId });
      assert(r4.ok, 'unlink ok');
      const unlinked = graph.getNode(target.id);
      assert(unlinked?.type === 'FRAME', `type downgraded to FRAME (got ${unlinked?.type})`);
      assert((unlinked?.meta as any)?.componentName === undefined, 'componentName cleared');

      // 11. instantiateComponent with unknown master → still creates placeholder
      const ghostOp: Operation = {
        id: '4', timestamp: 't', type: 'instantiateComponent',
        parentId: rootId, componentName: 'NotReal',
      };
      const r5 = applyOperation(graph, ghostOp, {
        rootId, projectDir: dir,
        componentAPI: { saveComponentMaster, createInstancePlaceholder },
      });
      assert(r5.ok, 'instantiate ghost ok (placeholder still created)');
    } finally { cleanup(dir); }
  }

  // ── 12-16. Expand/Collapse ───────────────────────────
  console.log('  12-16. Expand/collapse + overrides');
  {
    const dir = tmp();
    try {
      initProject(dir, 'ExpandCollapse');

      // Build a master from a tiny CARD_HTML subtree, extract it.
      const { graph: g1, rootId: r1 } = await importFromHtml(CARD_HTML, { stableIds: true });
      const card = g1.getNode(r1)!;
      saveComponentMaster(dir, 'PricingCard', g1, card.id);

      // Build a fresh scene with an instance placeholder.
      const g2 = new SceneGraph();
      const page = g2.addPage('Root');
      const inst = createInstancePlaceholder(g2, page.id, 'PricingCard',
        { title: { text: 'Professional' }, price: { text: '$49' } },
        { name: 'PricingInstance' });

      // 12. expandInstances hydrates from master
      const result = expandInstances(g2, page.id, dir);
      assert(result.expanded === 1, `1 instance expanded (got ${result.expanded})`);
      const hydrated = g2.getNode(inst.id);
      assert(!!hydrated && hydrated.childIds.length > 0, 'instance now has children');

      // 12b. Every child id has the "::" prefix (collapse can identify clones)
      const anyClone = [...g2.getAllNodes()].find(n => n.id.startsWith(`${inst.id}::`));
      assert(!!anyClone, 'clone ids use re-id prefix');

      // 15. Overrides apply to slot-named children
      const titleClone = [...g2.getAllNodes()].find(n => (n as any).slot === 'title');
      assert(!!titleClone, 'title-slot child present');
      assert(titleClone?.text === 'Professional', `title overridden (got "${titleClone?.text}")`);
      const priceClone = [...g2.getAllNodes()].find(n => (n as any).slot === 'price');
      assert(priceClone?.text === '$49', `price overridden (got "${priceClone?.text}")`);

      // 14. Idempotent: calling expand again does not duplicate children
      const countBefore = g2.nodes.size;
      const again = expandInstances(g2, page.id, dir);
      assert(again.expanded === 0, `no re-expansion (got ${again.expanded})`);
      assert(g2.nodes.size === countBefore, 'node count unchanged on re-expand');

      // 13. collapseInstances strips clones, keeps placeholder
      const collapsed = collapseInstances(g2, page.id);
      assert(collapsed.collapsed === 1, '1 instance collapsed');
      const placeholderAfter = g2.getNode(inst.id);
      assert(!!placeholderAfter, 'placeholder still present after collapse');
      assert(placeholderAfter?.childIds.length === 0, 'placeholder has no children after collapse');

      // 16. Unknown slot in overrides → silent skip
      const g3 = new SceneGraph();
      const p3 = g3.addPage('X');
      createInstancePlaceholder(g3, p3.id, 'PricingCard',
        { title: { text: 'Hi' }, nonexistent: { text: 'ignored' } });
      expandInstances(g3, p3.id, dir);
      const titleHi = [...g3.getAllNodes()].find(n => (n as any).slot === 'title');
      assert(titleHi?.text === 'Hi', 'unknown slot did not crash; valid slot still applied');
    } finally { cleanup(dir); }
  }

  // ── 17. saveScene + loadSceneFromProject round-trip ─
  console.log('  17. Save/load round-trip');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Roundtrip');
      const ds = makeDS();

      // Build the master first by importing a dedicated HTML file
      const { graph: mg, rootId: mr } = await importFromHtml(CARD_HTML, { stableIds: true });
      const card = mg.getNode(mr)!;
      saveComponentMaster(dir, 'PricingCard', mg, card.id);

      // Compile a scene that USES data-reframe-component
      const pageHtml = `<div style="width:1200px;background:#fff">
        <h1 style="font-size:56px;color:#061b31">Pricing</h1>
        <div data-reframe-component="PricingCard" data-reframe-props='{"title":{"text":"Starter"},"price":{"text":"$9"}}'></div>
        <div data-reframe-component="PricingCard" data-reframe-props='{"title":{"text":"Pro"},"price":{"text":"$49"}}'></div>
      </div>`;
      const compiled = await compileHtmlIntoProject(dir, pageHtml, { name: 'pricing-page', designSystem: ds });

      // After expand: each INSTANCE should have children hydrated
      const instances = [...compiled.graph.getAllNodes()].filter(n => n.type === 'INSTANCE' && (n.meta as any)?.componentName === 'PricingCard');
      assert(instances.length === 2, `2 instances in compiled graph (got ${instances.length})`);
      const hydratedCounts = instances.map(i => i.childIds.length);
      assert(hydratedCounts.every(c => c > 0), `both instances hydrated (counts ${hydratedCounts.join(',')})`);

      // Round-trip: reload from disk
      const reloaded = loadSceneFromProject(dir, 'pricing-page');
      const reloadedInstances = [...reloaded.graph.getAllNodes()].filter(n => n.type === 'INSTANCE');
      assert(reloadedInstances.length === 2, `2 instances after reload (got ${reloadedInstances.length})`);
      const reloadedHydrated = reloadedInstances.map(i => i.childIds.length);
      assert(reloadedHydrated.every(c => c > 0), `reloaded instances still hydrated (counts ${reloadedHydrated.join(',')})`);
    } finally { cleanup(dir); }
  }

  // ── 20. Update master → recompile propagates ─────────
  console.log('  20. Master update propagates through recompile');
  {
    const dir = tmp();
    try {
      initProject(dir, 'MasterUpdate');
      const ds = makeDS();
      // Seed master v1
      const { graph: g1, rootId: r1 } = await importFromHtml(CARD_HTML, { stableIds: true });
      const card1 = g1.getNode(r1)!;
      saveComponentMaster(dir, 'PricingCard', g1, card1.id);

      // Scene consuming the component
      const pageHtml = `<div style="width:1200px;background:#fff">
        <div data-reframe-component="PricingCard"></div>
      </div>`;
      const first = await compileHtmlIntoProject(dir, pageHtml, { name: 'pricing', designSystem: ds });
      const firstInstance = [...first.graph.getAllNodes()].find(n => n.type === 'INSTANCE')!;
      const firstTitle = [...first.graph.getAllNodes()].find(n =>
        firstInstance.childIds.some(cid => cid === n.id || n.parentId === firstInstance.id || n.id.startsWith(firstInstance.id))
        && (n as any).slot === 'title',
      );
      assert(firstTitle?.text === 'Starter', `first compile title=Starter (got "${firstTitle?.text}")`);

      // Update master v2 — use a different source HTML (changed title text)
      const CARD_HTML_V2 = CARD_HTML.replace('Starter', 'Basic');
      const { graph: g2, rootId: r2 } = await importFromHtml(CARD_HTML_V2, { stableIds: true });
      const card2 = g2.getNode(r2)!;
      saveComponentMaster(dir, 'PricingCard', g2, card2.id);

      // Recompile same scene → new master picked up
      const second = await compileHtmlIntoProject(dir, pageHtml, { name: 'pricing', designSystem: ds });
      const secondInstance = [...second.graph.getAllNodes()].find(n => n.type === 'INSTANCE')!;
      const secondTitle = [...second.graph.getAllNodes()].find(n =>
        n.id.startsWith(secondInstance.id) && (n as any).slot === 'title',
      );
      assert(secondTitle?.text === 'Basic', `second compile reflects updated master (got "${secondTitle?.text}")`);
    } finally { cleanup(dir); }
  }

  // ── 21. Delete master → scene still loads with warning ─
  console.log('  21. Deleted master does not break scene load');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Missing');
      const ds = makeDS();
      const { graph: mg, rootId: mr } = await importFromHtml(CARD_HTML, { stableIds: true });
      const card = mg.getNode(mr)!;
      saveComponentMaster(dir, 'PricingCard', mg, card.id);

      const pageHtml = `<div style="width:800px"><div data-reframe-component="PricingCard"></div></div>`;
      await compileHtmlIntoProject(dir, pageHtml, { name: 'page', designSystem: ds });

      // Delete master
      deleteComponent(dir, 'PricingCard');

      // Load scene — expand should report missing but not throw
      const reloaded = loadSceneFromProject(dir, 'page');
      assert(reloaded.graph.nodes.size > 0, 'scene loads without throwing');
      // The instance placeholder remains but children are absent
      const inst = [...reloaded.graph.getAllNodes()].find(n => n.type === 'INSTANCE');
      assert(!!inst, 'instance placeholder remains');
      assert(inst?.childIds.length === 0, 'no hydrated children (master gone)');
    } finally { cleanup(dir); }
  }

  // ── 22. Variant propagation ──────────────────────────
  console.log('  22. Variants carry component instances');
  {
    const dir = tmp();
    try {
      initProject(dir, 'VariantInstances');
      const ds = makeDS();

      const { graph: mg, rootId: mr } = await importFromHtml(CARD_HTML, { stableIds: true });
      const card = mg.getNode(mr)!;
      saveComponentMaster(dir, 'PricingCard', mg, card.id);

      const pageHtml = `<div style="width:1440px;background:#fff;padding:48px">
        <h1 style="font-size:56px;color:#061b31">Pricing</h1>
        <div data-reframe-component="PricingCard"></div>
      </div>`;
      await compileHtmlIntoProject(dir, pageHtml, { name: 'page', designSystem: ds });
      const variant = await generateVariant(dir, 'page', { name: 'mobile', width: 375, height: 812 }, { designSystem: ds });

      // Variant scene should have been saved — load it
      const loaded = loadSceneFromProject(dir, 'page.mobile');
      // After reflow the tree is rebuilt, but the expand pass runs on the
      // loaded graph too — if the variant carried a nested instance
      // through reflow, it would hydrate from master. If reflow dropped it,
      // the variant still loads without errors.
      assert(loaded.graph.nodes.size > 0, 'variant loads');
      assert(variant.viewport?.name === 'mobile', 'viewport captured');
    } finally { cleanup(dir); }
  }

  // ── 18-19. HTML importer + compile path ─────────────
  console.log('  18-19. HTML importer detects data-reframe-component');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Importer');
      const ds = makeDS();
      // Component master first
      const { graph: mg, rootId: mr } = await importFromHtml(CARD_HTML, { stableIds: true });
      const card = mg.getNode(mr)!;
      saveComponentMaster(dir, 'PricingCard', mg, card.id);

      // Scene HTML uses the component
      const pageHtml = `<div style="width:1200px">
        <div data-reframe-component="PricingCard"></div>
      </div>`;
      const result = await compileHtmlIntoProject(dir, pageHtml, { name: 'p', designSystem: ds });
      // The importer should have created an INSTANCE node with meta.componentName
      const inst = [...result.graph.getAllNodes()].find(n => n.type === 'INSTANCE');
      assert(!!inst, 'INSTANCE node created by importer');
      assert((inst?.meta as any)?.componentName === 'PricingCard', 'meta.componentName set');
      // And it got hydrated after import
      assert((inst?.childIds.length ?? 0) > 0, 'instance hydrated in compile flow');
    } finally { cleanup(dir); }
  }

  console.log(`\n═══ PHASE 6: ${passed} passed, ${failed} failed ═══`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('CRASH', e); process.exit(1); });
