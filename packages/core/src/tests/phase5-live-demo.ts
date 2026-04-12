/**
 * Phase 5 live demo — end-to-end: compile → macro with animations → replay →
 * variants auto-refresh with animations → HTML + React export with @keyframes.
 *
 * This is the "one call, everything wires together" demo that shows Phase 1–5
 * co-operating on a real filesystem project.
 *
 * Run: npx tsx packages/core/src/tests/phase5-live-demo.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  initProject,
  compileHtmlIntoProject,
  generateVariant,
  saveMacro,
  applyMacro,
  loadSceneFromProject,
  loadSceneWithVariants,
  readOps,
} from '../project/index.js';
import { exportToHtml } from '../exporters/html.js';
import { exportToReact } from '../exporters/react.js';
import { getStandaloneNode } from '../adapters/standalone/node.js';
import type { DesignSystem } from '../design-system/types.js';
import type { Operation } from '../ops/types.js';

function makeDS(): DesignSystem {
  return {
    brand: 'Phase5Demo',
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

const HTML = `
<div style="width:1440px;background:#ffffff;padding:0">
  <nav style="padding:20px 48px;background:#ffffff;border-bottom:1px solid #e5edf5">
    <div class="logo" style="font-size:20px;color:#061b31">reframe</div>
  </nav>
  <section class="hero" style="padding:96px 48px;background:#ffffff">
    <h1 style="font-size:56px;font-weight:300;color:#061b31">Phase 5 ships</h1>
    <p style="font-size:16px;color:#64748d">Animations, macros, variants, CSS vars — one compile, everything in sync.</p>
    <button style="padding:14px 28px;background:#533afd;color:#ffffff;border-radius:4px">Get started</button>
    <button style="padding:14px 28px;background:#ffffff;color:#533afd;border-radius:4px;border:1px solid #b9b9f9">Docs</button>
  </section>
</div>
`;

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase5-live-'));
  console.log(`\n[1] sandbox: ${dir}`);

  initProject(dir, 'Phase 5 Live');
  const ds = makeDS();
  console.log(`[2] initProject ✓`);

  // Base compile
  const first = await compileHtmlIntoProject(dir, HTML, {
    name: 'hero', width: 1440, height: 900, designSystem: ds,
  });
  console.log(`[3] compile #1: ${first.entry.nodes} nodes rev=${first.entry.revision}`);

  // Generate responsive variants — mix of tree-preserving (ultrawide, close
  // aspect) and reflow-triggering (mobile portrait) so we can see the
  // animation propagation contract in both modes.
  await generateVariant(dir, 'hero', { name: 'mobile', width: 375, height: 812 }, { designSystem: ds });
  await generateVariant(dir, 'hero', { name: 'tablet', width: 768, height: 1024 }, { designSystem: ds });
  await generateVariant(dir, 'hero', { name: 'ultrawide', width: 2560, height: 900 }, { designSystem: ds });
  console.log(`[4] generated 3 variants (mobile, tablet, ultrawide)`);

  // Save a macro: "animate all CTAs with staggered fadeIn"
  // Uses $role:button placeholders so the same macro works on any scene.
  const macroOps: Operation[] = [
    { id: '1', timestamp: 't', type: 'autoBindTokens' },
    { id: '2', timestamp: 't', type: 'addPresetAnimation',
      nodeId: '$role:button', preset: 'fadeIn', config: { duration: 600 } },
    { id: '3', timestamp: 't', type: 'addPresetAnimation',
      nodeId: '$role:heading', preset: 'slideInUp', config: { duration: 700, distance: 40 } },
  ];
  saveMacro(dir, 'live-reveal', macroOps as any, 'Bind tokens + fade in CTAs + slide up headings');
  console.log(`[5] saved macro "live-reveal" with ${macroOps.length} ops`);

  // Apply macro → it appends resolved ops to hero's history log
  const applied = applyMacro(dir, 'hero', 'live-reveal');
  console.log(`[6] applyMacro: ${applied.appendedOps.length} ops appended, ${applied.skipped.length} skipped`);

  const historyNow = readOps(dir, 'hero');
  console.log(`    history log now has ${historyNow.length} ops on disk`);

  // Re-compile → replay all macro ops → auto-refresh variants
  const second = await compileHtmlIntoProject(dir, HTML, {
    name: 'hero', designSystem: ds,
  });
  console.log(`[7] compile #2:`);
  console.log(`    replay: ${second.replay?.opsRead} read / ${second.replay?.applied} applied / ${second.replay?.failed} failed`);
  console.log(`    variants refreshed: ${second.variantRefresh?.refreshed ?? 0}`);
  const tl = second.graph.timeline as any;
  console.log(`    base timeline: ${tl?.animations?.length ?? 0} animations`);

  // Export base HTML — check for all Phase 5 output artifacts
  const htmlOut = exportToHtml(second.graph, second.rootId, { designSystem: ds, fullDocument: false });
  const htmlHasRoot = htmlOut.includes(':root {');
  const htmlHasVar = htmlOut.includes('var(--color-primary)');
  const htmlHasKeyframes = htmlOut.includes('@keyframes');
  const htmlHasAnim = /animation:\s*rfa\d/.test(htmlOut);
  console.log(`[8] HTML export (${htmlOut.length} chars):`);
  console.log(`    :root block: ${htmlHasRoot}`);
  console.log(`    var(--color-primary): ${htmlHasVar}`);
  console.log(`    @keyframes: ${htmlHasKeyframes}`);
  console.log(`    animation: rules: ${htmlHasAnim}`);

  // Export base React
  const rootInode = getStandaloneNode(second.graph, second.rootId)!;
  const reactOut = exportToReact(rootInode, { designSystem: ds });
  const reactHasKeyframes = reactOut.includes('@keyframes');
  const reactHasVar = reactOut.includes("'var(--color-primary)'");
  console.log(`[9] React export (${reactOut.length} chars):`);
  console.log(`    has 'var(--color-primary)': ${reactHasVar}`);
  console.log(`    has @keyframes: ${reactHasKeyframes}`);

  // Inspect variants. Contract: when adapt()'s reflow pipeline rebuilds the
  // tree (portrait mobile, extreme aspect ratio changes), the variant's
  // orphan base-tree animations are intentionally dropped — otherwise the
  // exported CSS would reference stale node ids. Variants that preserve the
  // tree keep animations. Both outcomes are correct; we print both to make
  // the behaviour visible in the transcript.
  const bundle = loadSceneWithVariants(dir, 'hero');
  console.log(`[10] Variants after macro replay (animations drop when reflow rebuilds the tree):`);
  for (const v of bundle.variants) {
    const vtl = v.graph.timeline as any;
    const vhtml = exportToHtml(v.graph, v.rootId, { designSystem: ds, fullDocument: false });
    const vkf = vhtml.includes('@keyframes');
    const vRoot = vhtml.includes(':root {');
    const vVar = vhtml.includes('var(--color-primary)');
    const note = !vkf ? ' (reflow rebuilt tree → animations intentionally dropped)' : '';
    console.log(`    ${v.entry.slug} ${v.entry.width}x${v.entry.height} rev=${v.entry.revision} ` +
                `timeline=${vtl?.animations?.length ?? 0} @keyframes=${vkf} :root=${vRoot} tokens=${vVar}${note}`);
  }

  // Final contract check
  const ok =
    htmlHasRoot && htmlHasVar && htmlHasKeyframes && htmlHasAnim &&
    reactHasKeyframes && reactHasVar &&
    (second.replay?.applied ?? 0) > 0 &&
    (tl?.animations?.length ?? 0) > 0;

  console.log(`\n${ok ? '✓' : '✗'} Phase 5 live demo ${ok ? 'complete' : 'FAILED'}.`);
  console.log(`  Sandbox kept at: ${dir}`);
  if (!ok) process.exit(1);
}

main().catch(e => { console.error('CRASH', e); process.exit(1); });
