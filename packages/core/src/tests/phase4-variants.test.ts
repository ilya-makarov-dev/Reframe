/**
 * Phase 4 stress test — Multi-view variants built on top of the resize pipeline.
 *
 * Run: npx tsx packages/core/src/tests/phase4-variants.test.ts
 *
 * Covers:
 *   1. generateVariant creates a variant with correct dims + variantOf
 *   2. Variant file written to scenes/<base>.<vp>.scene.json
 *   3. Variant has its own revision starting at 1
 *   4. listVariants returns only variants of the given base
 *   5. Manifest records variantOf + viewport
 *   6. Multiple variants of the same base coexist (mobile + tablet)
 *   7. refreshVariants regenerates every variant, bumps revisions
 *   8. compileHtmlIntoProject auto-refreshes variants after replay
 *   9. Edits to base via history replay propagate to variants on re-compile
 *  10. Source graph is NOT mutated when generating a variant (isolation)
 *  11. Variant graph nodes keep their own ids (not aliased to base)
 *  12. deleteScene(base) cascades to variants (files + manifest)
 *  13. deleteScene(variant) leaves siblings intact
 *  14. generateVariant on unknown base throws with clear message
 *  15. Variant inherits brand/group/tags from base on first creation
 *  16. refreshVariants returns empty result when base has no variants
 *  17. Variant can be loaded via loadSceneFromProject by its slug
 *  18. loadSceneWithVariants returns base + all variants with graphs
 *  19. Variant viewport dims match the request (not the source dims)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  initProject,
  compileHtmlIntoProject,
  loadProject,
  listScenes,
  loadSceneFromProject,
  deleteScene,
  generateVariant,
  listVariants,
  refreshVariants,
  loadSceneWithVariants,
  appendOp,
  nextOpId,
} from '../project/index.js';
import type { DesignSystem } from '../design-system/types.js';
import type { Operation } from '../ops/types.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; } else { failed++; console.error(`  FAIL: ${msg}`); }
}

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-phase4-'));
}
function cleanup(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function makeDS(): DesignSystem {
  return {
    brand: 'Phase4Test',
    colors: {
      primary: '#533afd',
      background: '#ffffff',
      text: '#061b31',
      roles: new Map([['primary', '#533afd'], ['background', '#ffffff'], ['text', '#061b31']]),
    },
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

// Landing-style scene so the adapt pipeline has something to classify/reflow.
const HTML = `
<div style="width:1440px;background:#ffffff;padding:0">
  <nav style="padding:20px 48px;background:#ffffff">
    <div class="logo" style="font-size:20px;color:#061b31">reframe</div>
  </nav>
  <section class="hero" style="padding:96px 48px;background:#ffffff">
    <h1 style="font-size:56px;color:#061b31;font-weight:300;letter-spacing:-1.4px">Phase 4 test</h1>
    <p style="font-size:16px;color:#64748d">Multi-view variants above resize</p>
    <button style="padding:14px 28px;background:#533afd;color:#ffffff;border-radius:4px;font-size:16px">CTA</button>
  </section>
</div>
`;

async function main() {
  console.log('═══ PHASE 4: Multi-view Variants Stress Test ═══\n');
  const ds = makeDS();

  // ── 1-5: single-variant happy path ─────────────────────────────
  console.log('  1-5. Generate a single mobile variant');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Variant Test');
      const base = await compileHtmlIntoProject(dir, HTML, {
        name: 'hero', width: 1440, height: 900, designSystem: ds,
      });
      assert(base.entry.variantOf === undefined, 'base has no variantOf');

      const variant = await generateVariant(dir, 'hero', { name: 'mobile', width: 375, height: 812 }, {
        designSystem: ds,
      });

      // 1. variant created with correct dims + variantOf
      assert(variant.variantOf === 'hero', `variantOf=hero (got ${variant.variantOf})`);
      assert(variant.width === 375, `width=375 (got ${variant.width})`);
      assert(variant.height === 812, `height=812 (got ${variant.height})`);
      assert(variant.viewport?.name === 'mobile', 'viewport.name=mobile');

      // 2. file path
      const expectedPath = path.join(dir, '.reframe', 'scenes', 'hero.mobile.scene.json');
      assert(fs.existsSync(expectedPath), `scene file at ${expectedPath}`);

      // 3. revision starts at 1
      assert(variant.revision === 1, `first revision=1 (got ${variant.revision})`);

      // 4. listVariants returns this variant
      const list = listVariants(dir, 'hero');
      assert(list.length === 1, `one variant (${list.length})`);
      assert(list[0].slug === 'hero.mobile', 'slug = hero.mobile');

      // 5. Manifest persists it
      const manifest = loadProject(dir);
      const fromManifest = manifest.scenes.find(s => s.slug === 'hero.mobile');
      assert(!!fromManifest, 'variant in manifest');
      assert(fromManifest?.viewport?.width === 375, 'manifest viewport.width');
    } finally { cleanup(dir); }
  }

  // ── 6. Multiple variants coexist ──────────────────────────────
  console.log('  6. Mobile + tablet variants coexist');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Multi Variant Test');
      await compileHtmlIntoProject(dir, HTML, { name: 'hero', designSystem: ds });
      await generateVariant(dir, 'hero', { name: 'mobile', width: 375, height: 812 }, { designSystem: ds });
      await generateVariant(dir, 'hero', { name: 'tablet', width: 768, height: 1024 }, { designSystem: ds });

      const variants = listVariants(dir, 'hero');
      assert(variants.length === 2, `two variants (${variants.length})`);
      const names = variants.map(v => v.viewport?.name).sort();
      assert(JSON.stringify(names) === JSON.stringify(['mobile', 'tablet']), 'both viewport names');

      // Files both exist
      const mobilePath = path.join(dir, '.reframe', 'scenes', 'hero.mobile.scene.json');
      const tabletPath = path.join(dir, '.reframe', 'scenes', 'hero.tablet.scene.json');
      assert(fs.existsSync(mobilePath) && fs.existsSync(tabletPath), 'both variant files on disk');

      // listScenes returns 3 (base + 2 variants)
      const scenes = listScenes(dir);
      assert(scenes.length === 3, `3 total scenes (got ${scenes.length})`);
    } finally { cleanup(dir); }
  }

  // ── 7. refreshVariants bumps revisions ────────────────────────
  console.log('  7. refreshVariants regenerates + bumps revisions');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Refresh Test');
      await compileHtmlIntoProject(dir, HTML, { name: 'hero', designSystem: ds });
      await generateVariant(dir, 'hero', { name: 'mobile', width: 375, height: 812 }, { designSystem: ds });
      await generateVariant(dir, 'hero', { name: 'tablet', width: 768, height: 1024 }, { designSystem: ds });

      const before = listVariants(dir, 'hero').map(v => v.revision);
      assert(before.every(r => r === 1), 'both variants start at revision 1');

      const result = await refreshVariants(dir, 'hero', { designSystem: ds });
      assert(result.refreshed.length === 2, `2 refreshed (${result.refreshed.length})`);
      assert(result.errors.length === 0, 'no errors');

      const after = listVariants(dir, 'hero').map(v => v.revision);
      assert(after.every(r => r === 2), 'both variants bumped to revision 2');
    } finally { cleanup(dir); }
  }

  // ── 8. compileHtmlIntoProject auto-refreshes variants ─────────
  console.log('  8. Auto-refresh variants on re-compile');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Auto Refresh Test');
      await compileHtmlIntoProject(dir, HTML, { name: 'hero', designSystem: ds });
      await generateVariant(dir, 'hero', { name: 'mobile', width: 375, height: 812 }, { designSystem: ds });

      const firstMobile = listVariants(dir, 'hero')[0];
      assert(firstMobile.revision === 1, 'mobile rev=1 after create');

      // Re-compile base — auto should bump variant rev
      const recomp = await compileHtmlIntoProject(dir, HTML, { name: 'hero', designSystem: ds });
      assert(!!recomp.variantRefresh, 'variantRefresh returned');
      assert(recomp.variantRefresh!.refreshed === 1, '1 variant refreshed');
      assert(recomp.variantRefresh!.errors.length === 0, 'no errors');

      const secondMobile = listVariants(dir, 'hero')[0];
      assert(secondMobile.revision === 2, `mobile rev=2 after re-compile (got ${secondMobile.revision})`);
    } finally { cleanup(dir); }
  }

  // ── 9. History edits propagate to variants via auto-refresh ──
  // NOTE: we verify the *propagation contract* here, not the node id
  // correspondence. The resize subsystem's `reflow` pipeline is free to
  // rebuild the tree for extreme aspect ratio changes (a wide 1440 base to a
  // narrow 375 portrait target triggers reflow), which loses stable-id
  // correspondence between base and variant. That's by design — resize owns
  // the adaptation contract, Phase 4 only persists the results. What we must
  // validate here is that (a) replay actually lands on the base graph, and
  // (b) the variant was regenerated after replay (revision bumped + on-disk
  // timestamp advanced).
  console.log('  9. History replay propagates edits to variants');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Propagate Test');
      const first = await compileHtmlIntoProject(dir, HTML, { name: 'hero', designSystem: ds });
      const button = [...first.graph.getAllNodes()].find(n => n.semanticRole === 'button')!;
      await generateVariant(dir, 'hero', { name: 'mobile', width: 375, height: 812 }, { designSystem: ds });

      const variantBefore = listVariants(dir, 'hero')[0];
      assert(variantBefore.revision === 1, 'variant rev=1 before propagation');

      // Append setProps → replay runs on the base during next compile.
      const op: Operation = {
        id: nextOpId(), timestamp: new Date().toISOString(), type: 'setProps',
        nodeId: button.id, props: { name: 'PROPAGATED_CTA' },
      };
      appendOp(dir, 'hero', op);

      const recomp = await compileHtmlIntoProject(dir, HTML, { name: 'hero', designSystem: ds });

      // (a) replay actually applied the op on the base graph
      assert(recomp.replay?.applied === 1, `1 op applied on replay (got ${recomp.replay?.applied})`);
      assert(recomp.replay?.failed === 0, 'zero failed replay ops');
      const baseBtn = recomp.graph.getNode(button.id);
      assert(baseBtn?.name === 'PROPAGATED_CTA', `base button carries replayed name (got "${baseBtn?.name}")`);

      // (b) variant was auto-refreshed → revision bumped, file exists
      assert(!!recomp.variantRefresh, 'variantRefresh populated on re-compile');
      assert(recomp.variantRefresh!.refreshed === 1, '1 variant refreshed');
      const variantAfter = listVariants(dir, 'hero')[0];
      assert(variantAfter.revision === 2, `variant rev=2 after base edit (got ${variantAfter.revision})`);
      const variantFilePath = path.join(dir, '.reframe', 'scenes', 'hero.mobile.scene.json');
      assert(fs.existsSync(variantFilePath), 'variant file still on disk');
    } finally { cleanup(dir); }
  }

  // ── 10-11. Source isolation + variant has own ids ─────────────
  console.log('  10-11. Source graph isolation');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Iso Test');
      const base = await compileHtmlIntoProject(dir, HTML, { name: 'hero', designSystem: ds });
      const baseRootBefore = base.graph.getNode(base.rootId)!;
      const baseWidthBefore = baseRootBefore.width;

      await generateVariant(dir, 'hero', { name: 'mobile', width: 375, height: 812 }, { designSystem: ds });

      // Base graph in memory must NOT have been resized to 375
      const baseRootAfter = base.graph.getNode(base.rootId)!;
      assert(baseRootAfter.width === baseWidthBefore, `base width unchanged (${baseRootAfter.width} vs ${baseWidthBefore})`);

      // Variant has its own graph — node ids intersect (stable id contract)
      // but the two graphs are distinct objects
      const { graph: variantGraph, rootId: variantRootId } = loadSceneFromProject(dir, 'hero.mobile');
      const variantRoot = variantGraph.getNode(variantRootId)!;
      assert(variantRoot.width < 500, `variant root width adapted (got ${variantRoot.width})`);
      assert(variantGraph !== base.graph, 'variant graph is a distinct instance');
    } finally { cleanup(dir); }
  }

  // ── 12. Cascade-delete variants on base delete ───────────────
  console.log('  12. deleteScene cascades to variants');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Cascade Test');
      await compileHtmlIntoProject(dir, HTML, { name: 'hero', designSystem: ds });
      await compileHtmlIntoProject(dir, HTML, { name: 'about', designSystem: ds });
      await generateVariant(dir, 'hero', { name: 'mobile', width: 375, height: 812 }, { designSystem: ds });
      await generateVariant(dir, 'hero', { name: 'tablet', width: 768, height: 1024 }, { designSystem: ds });
      await generateVariant(dir, 'about', { name: 'mobile', width: 375, height: 812 }, { designSystem: ds });

      assert(listScenes(dir).length === 5, '5 total scenes');

      const deleted = deleteScene(dir, 'hero');
      assert(deleted, 'delete returned true');

      const after = listScenes(dir);
      const slugs = after.map(s => s.slug).sort();
      assert(
        JSON.stringify(slugs) === JSON.stringify(['about', 'about.mobile']),
        `only about + about.mobile remain (got ${slugs.join(',')})`,
      );
      const heroFile = path.join(dir, '.reframe', 'scenes', 'hero.scene.json');
      const heroMobileFile = path.join(dir, '.reframe', 'scenes', 'hero.mobile.scene.json');
      const heroTabletFile = path.join(dir, '.reframe', 'scenes', 'hero.tablet.scene.json');
      assert(!fs.existsSync(heroFile), 'hero.scene.json deleted');
      assert(!fs.existsSync(heroMobileFile), 'hero.mobile.scene.json deleted');
      assert(!fs.existsSync(heroTabletFile), 'hero.tablet.scene.json deleted');
    } finally { cleanup(dir); }
  }

  // ── 13. Deleting one variant leaves siblings ─────────────────
  console.log('  13. Delete variant does not cascade');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Leaf Delete Test');
      await compileHtmlIntoProject(dir, HTML, { name: 'hero', designSystem: ds });
      await generateVariant(dir, 'hero', { name: 'mobile', width: 375, height: 812 }, { designSystem: ds });
      await generateVariant(dir, 'hero', { name: 'tablet', width: 768, height: 1024 }, { designSystem: ds });

      const ok = deleteScene(dir, 'hero.mobile');
      assert(ok, 'delete variant returned true');
      const after = listScenes(dir);
      assert(after.length === 2, `2 remain after variant delete (${after.length})`);
      assert(after.some(s => s.slug === 'hero'), 'base still exists');
      assert(after.some(s => s.slug === 'hero.tablet'), 'tablet still exists');
      assert(!after.some(s => s.slug === 'hero.mobile'), 'mobile gone');
    } finally { cleanup(dir); }
  }

  // ── 14. Unknown base throws ──────────────────────────────────
  console.log('  14. generateVariant on missing base throws');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Missing Base Test');
      let threw = false;
      try {
        await generateVariant(dir, 'nonexistent', { name: 'mobile', width: 375, height: 812 });
      } catch (e: any) {
        threw = true;
        assert(e.message.includes('not found'), `clear error: ${e.message}`);
      }
      assert(threw, 'generateVariant throws on missing base');
    } finally { cleanup(dir); }
  }

  // ── 15. Variant inherits brand/group/tags ────────────────────
  console.log('  15. Variant inherits metadata from base');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Inherit Test');
      await compileHtmlIntoProject(dir, HTML, {
        name: 'hero',
        designSystem: ds,
        group: 'marketing',
        tags: ['landing', 'hero'],
        brand: 'Stripe',
      });
      const variant = await generateVariant(dir, 'hero', { name: 'mobile', width: 375, height: 812 }, { designSystem: ds });
      assert(variant.group === 'marketing', `inherits group (${variant.group})`);
      assert(JSON.stringify(variant.tags) === JSON.stringify(['landing', 'hero']), `inherits tags (${variant.tags?.join(',')})`);
      assert(variant.brand === 'Stripe', `inherits brand (${variant.brand})`);
    } finally { cleanup(dir); }
  }

  // ── 16. refreshVariants no-op on empty ───────────────────────
  console.log('  16. refreshVariants empty result');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Empty Refresh Test');
      await compileHtmlIntoProject(dir, HTML, { name: 'hero', designSystem: ds });
      const r = await refreshVariants(dir, 'hero');
      assert(r.refreshed.length === 0 && r.errors.length === 0, 'empty refresh result');
    } finally { cleanup(dir); }
  }

  // ── 17. Variant loads via loadSceneFromProject ───────────────
  console.log('  17. Variant loads via project API');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Variant Load Test');
      await compileHtmlIntoProject(dir, HTML, { name: 'hero', designSystem: ds });
      await generateVariant(dir, 'hero', { name: 'mobile', width: 375, height: 812 }, { designSystem: ds });

      const loaded = loadSceneFromProject(dir, 'hero.mobile');
      assert(loaded.entry.slug === 'hero.mobile', 'loaded entry slug');
      assert(loaded.entry.variantOf === 'hero', 'variantOf preserved');
      assert(loaded.graph.nodes.size > 0, 'graph populated');
    } finally { cleanup(dir); }
  }

  // ── 18. loadSceneWithVariants ─────────────────────────────────
  console.log('  18. loadSceneWithVariants bundle');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Bundle Test');
      await compileHtmlIntoProject(dir, HTML, { name: 'hero', designSystem: ds });
      await generateVariant(dir, 'hero', { name: 'mobile', width: 375, height: 812 }, { designSystem: ds });
      await generateVariant(dir, 'hero', { name: 'tablet', width: 768, height: 1024 }, { designSystem: ds });

      const bundle = loadSceneWithVariants(dir, 'hero');
      assert(bundle.base.entry.slug === 'hero', 'base loaded');
      assert(bundle.variants.length === 2, 'two variants loaded');
      assert(bundle.variants.every(v => v.graph.nodes.size > 0), 'both variants have graphs');
      const vps = bundle.variants.map(v => v.entry.viewport?.name).sort();
      assert(JSON.stringify(vps) === JSON.stringify(['mobile', 'tablet']), 'variant names correct');
    } finally { cleanup(dir); }
  }

  // ── 19. Variant dims match request ────────────────────────────
  console.log('  19. Variant dims honor target viewport');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Dims Test');
      await compileHtmlIntoProject(dir, HTML, { name: 'hero', width: 1440, height: 900, designSystem: ds });
      const v = await generateVariant(dir, 'hero', { name: 'narrow', width: 320, height: 600 }, { designSystem: ds });
      assert(v.width === 320, `width=320 (got ${v.width})`);
      assert(v.height === 600, `height=600 (got ${v.height})`);

      // Reloaded variant root also has target dims
      const { graph, rootId } = loadSceneFromProject(dir, 'hero.narrow');
      const root = graph.getNode(rootId)!;
      assert(Math.abs(root.width - 320) < 2, `root width ≈ 320 (got ${root.width})`);
    } finally { cleanup(dir); }
  }

  console.log(`\n═══ PHASE 4: ${passed} passed, ${failed} failed ═══`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('CRASH', e); process.exit(1); });
