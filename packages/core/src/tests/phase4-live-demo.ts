/**
 * Phase 4 live demo — end-to-end multi-view variants over the MCP handler path.
 *
 * Scenario: agent builds a landing page at 1440, then says "give me tablet and
 * mobile variants". Then edits the base via reframe_edit (simulated via op
 * append). On re-compile, all variants auto-refresh from the new base state.
 * Finally we print the list with revisions so you can see propagation.
 *
 * Run: npx tsx packages/core/src/tests/phase4-live-demo.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  initProject,
  compileHtmlIntoProject,
  generateVariant,
  listVariants,
  refreshVariants,
  appendOp,
  nextOpId,
  loadSceneWithVariants,
  loadProject,
} from '../project/index.js';
import { exportToHtml } from '../exporters/html.js';
import type { DesignSystem } from '../design-system/types.js';
import type { Operation } from '../ops/types.js';

function makeDS(): DesignSystem {
  return {
    brand: 'Phase4Demo',
    colors: {
      primary: '#533afd',
      background: '#ffffff',
      text: '#061b31',
      roles: new Map([['primary', '#533afd'], ['background', '#ffffff'], ['text', '#061b31']]),
    },
    typography: {
      hierarchy: [
        { role: 'hero', fontSize: 56, fontWeight: 300, lineHeight: 1.03, letterSpacing: -1.4 },
        { role: 'title', fontSize: 32, fontWeight: 300, lineHeight: 1.15, letterSpacing: -0.64 },
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

const HTML = `
<div style="width:1440px;background:#ffffff">
  <nav style="padding:20px 48px;background:#ffffff">
    <div class="logo" style="font-size:20px;color:#061b31">reframe</div>
  </nav>
  <section class="hero" style="padding:96px 48px;background:#ffffff">
    <h1 style="font-size:56px;color:#061b31;font-weight:300;letter-spacing:-1.4px">Responsive by construction</h1>
    <p style="font-size:16px;color:#64748d">One base, many viewports. Resize does the heavy lifting.</p>
    <button style="padding:14px 28px;background:#533afd;color:#ffffff;border-radius:4px;font-size:16px">Get started</button>
  </section>
</div>
`;

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase4-live-'));
  console.log(`\n[1] sandbox: ${dir}`);

  initProject(dir, 'Phase 4 Live');
  const ds = makeDS();

  // Base compile
  const first = await compileHtmlIntoProject(dir, HTML, {
    name: 'hero',
    width: 1440,
    height: 900,
    designSystem: ds,
  });
  console.log(`[2] base compile: slug=${first.entry.slug} rev=${first.entry.revision} nodes=${first.entry.nodes}`);

  // Create three variants
  const v1 = await generateVariant(dir, 'hero', { name: 'tablet', width: 768, height: 1024 }, { designSystem: ds });
  const v2 = await generateVariant(dir, 'hero', { name: 'mobile', width: 375, height: 812 }, { designSystem: ds });
  const v3 = await generateVariant(dir, 'hero', { name: 'ultrawide', width: 2560, height: 1080 }, { designSystem: ds });
  console.log(`[3] generated 3 variants:`);
  for (const v of [v1, v2, v3]) {
    console.log(`    ${v.slug}  ${v.width}×${v.height}  rev=${v.revision}  nodes=${v.nodes}`);
  }

  // Simulate an agent edit via op append.
  // Two ops: rename the CTA + auto-bind the whole scene to the DS. Both are
  // replayed on every re-compile, so variants inherit both behaviors.
  const button = [...first.graph.getAllNodes()].find(n => n.semanticRole === 'button')!;
  appendOp(dir, 'hero', {
    id: nextOpId(), timestamp: new Date().toISOString(), type: 'setProps',
    nodeId: button.id, props: { name: 'LIVE_CTA' }, label: 'rename CTA live',
  });
  appendOp(dir, 'hero', {
    id: nextOpId(), timestamp: new Date().toISOString(), type: 'autoBindTokens',
    label: 'bind all fills/typography to DS tokens',
  });
  console.log(`[4] appended 2 ops: setProps + autoBindTokens`);

  // Re-compile: replay + auto-refresh variants
  const second = await compileHtmlIntoProject(dir, HTML, {
    name: 'hero', designSystem: ds,
  });
  console.log(`[5] re-compile:`);
  console.log(`    replay: ${second.replay?.opsRead} read / ${second.replay?.applied} applied / ${second.replay?.failed} failed`);
  console.log(`    variantRefresh: ${second.variantRefresh?.refreshed} refreshed, ${second.variantRefresh?.errors.length} errors`);

  // List variants — check revisions bumped
  const variantsAfter = listVariants(dir, 'hero');
  console.log(`[6] variants after re-compile:`);
  for (const v of variantsAfter) {
    console.log(`    ${v.slug}  ${v.width}×${v.height}  rev=${v.revision}`);
  }

  // Manual refresh once more (should bump again)
  const manual = await refreshVariants(dir, 'hero', { designSystem: ds });
  console.log(`[7] manual refresh: ${manual.refreshed.length} refreshed, ${manual.errors.length} errors`);
  const variantsFinal = listVariants(dir, 'hero');
  for (const v of variantsFinal) {
    console.log(`    ${v.slug}  rev=${v.revision}`);
  }

  // loadSceneWithVariants bundle
  const bundle = loadSceneWithVariants(dir, 'hero');
  console.log(`[8] bundle: base "${bundle.base.entry.name}" + ${bundle.variants.length} variants`);

  // Export each variant to HTML — each file has different dims
  console.log(`[9] HTML export per variant:`);
  for (const v of bundle.variants) {
    const html = exportToHtml(v.graph, v.rootId, { designSystem: ds, fullDocument: false });
    const root = v.graph.getNode(v.rootId)!;
    console.log(`    ${v.entry.slug}  root.width=${root.width}  html size=${html.length}b  has :root=${html.includes(':root {')}  has var(--color-primary)=${html.includes('var(--color-primary)')}`);
  }

  // Final manifest sanity
  const manifest = loadProject(dir);
  const baseCount = manifest.scenes.filter(s => !s.variantOf).length;
  const variantCount = manifest.scenes.filter(s => s.variantOf).length;
  console.log(`[10] manifest: ${baseCount} base(s) + ${variantCount} variant(s)`);

  // Contract assertions
  const allRefreshed = variantsFinal.every(v => (v.revision ?? 0) >= 3); // 1 create + 1 autorefresh + 1 manual
  console.log(`\n${allRefreshed ? '✓' : '✗'} Phase 4 live demo ${allRefreshed ? 'complete' : 'FAILED'}.`);
  console.log(`  Sandbox kept at: ${dir}`);
  if (!allRefreshed) process.exit(1);
}

main().catch(e => { console.error('CRASH', e); process.exit(1); });
