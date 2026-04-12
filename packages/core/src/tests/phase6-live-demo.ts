/**
 * Phase 6 live demo — component registry in a realistic agent flow.
 *
 *   1. Compile a base scene that contains a subtree the agent wants reusable
 *   2. Extract that subtree as a component master (via op)
 *   3. Instantiate the component in a DIFFERENT scene with slot overrides
 *   4. Re-compile both scenes → instances hydrate from master automatically
 *   5. Update the master → re-compile → all consumers reflect the new master
 *   6. Export an HTML snapshot of one instance to show CSS vars still work
 *      (Phase 3b integration continues to hold)
 *
 * Run: npx tsx packages/core/src/tests/phase6-live-demo.ts
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
  createInstancePlaceholder,
  appendOp,
  nextOpId,
} from '../project/index.js';
import { importFromHtml } from '../importers/html.js';
import { exportToHtml } from '../exporters/html.js';
import { autoBindTokens } from '../ops/auto-bind-tokens.js';
import type { DesignSystem } from '../design-system/types.js';
import type { Operation } from '../ops/types.js';

function makeDS(): DesignSystem {
  return {
    brand: 'P6Live',
    colors: {
      primary: '#533afd', background: '#ffffff', text: '#061b31',
      roles: new Map([['primary', '#533afd'], ['background', '#ffffff'], ['text', '#061b31'], ['cta', '#533afd']]),
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

// Component author HTML — a single pricing card with slots.
const CARD_HTML = `
<div style="width:320px;background:#fff;border:1px solid #e5edf5;border-radius:8px;padding:24px">
  <div data-reframe-slot="title" style="font-size:24px;color:#061b31;font-weight:300">Title</div>
  <div data-reframe-slot="price" style="font-size:48px;color:#061b31;font-weight:300">$0</div>
  <div data-reframe-slot="features" style="font-size:16px;color:#64748d">All features</div>
  <div data-reframe-slot="cta" style="padding:12px 20px;background:#533afd;color:#fff;border-radius:4px;font-size:14px">Choose plan</div>
</div>`;

// Landing page that uses the component 3 times with different overrides.
const LANDING_HTML = `
<div style="width:1200px;background:#ffffff;padding:64px">
  <h1 style="font-size:56px;color:#061b31;font-weight:300;text-align:center">Pricing that scales</h1>
  <p style="font-size:16px;color:#64748d;text-align:center">Three tiers. Clear value.</p>
  <div style="display:flex;gap:24px;padding:48px 0">
    <div data-reframe-component="PricingCard" data-reframe-props='{"title":{"text":"Starter"},"price":{"text":"$9"},"features":{"text":"5 projects"}}'></div>
    <div data-reframe-component="PricingCard" data-reframe-props='{"title":{"text":"Pro"},"price":{"text":"$29"},"features":{"text":"Unlimited projects"}}'></div>
    <div data-reframe-component="PricingCard" data-reframe-props='{"title":{"text":"Enterprise"},"price":{"text":"$99"},"features":{"text":"Custom SLA"}}'></div>
  </div>
</div>`;

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase6-live-'));
  console.log(`\n[1] sandbox: ${dir}`);
  initProject(dir, 'Phase 6 Live');
  const ds = makeDS();

  // ─── Step A: Seed the component master ────────────────
  // Agent authors a reusable card by importing it and saving as a master.
  console.log(`[2] import card source + saveComponentMaster`);
  const cardImport = await importFromHtml(CARD_HTML, { stableIds: true });
  const cardRoot = cardImport.graph.getNode(cardImport.rootId)!;
  // Pre-bind tokens on the master subtree BEFORE saving. Clones will
  // inherit the bindings through serialization, so every page consuming
  // this component ships CSS vars out of the box without a per-scene
  // autoBindTokens op.
  autoBindTokens(cardImport.graph, cardRoot.id, ds);
  const master = saveComponentMaster(dir, 'PricingCard', cardImport.graph, cardRoot.id, {
    description: 'Reusable pricing card with title/price/features/cta slots',
  });
  console.log(`    master saved: rev=${master.revision} slots=[${master.slots?.join(', ')}]`);

  // ─── Step B: Compile the landing page ─────────────────
  console.log(`[3] compile landing page (uses data-reframe-component × 3)`);
  const landing = await compileHtmlIntoProject(dir, LANDING_HTML, {
    name: 'pricing', designSystem: ds,
  });
  const instances = [...landing.graph.getAllNodes()].filter(n => n.type === 'INSTANCE');
  console.log(`    ${instances.length} INSTANCE nodes created, all hydrated:`);
  for (const inst of instances) {
    const title = [...landing.graph.getAllNodes()].find(n =>
      n.id.startsWith(inst.id) && (n as any).slot === 'title',
    );
    const price = [...landing.graph.getAllNodes()].find(n =>
      n.id.startsWith(inst.id) && (n as any).slot === 'price',
    );
    console.log(`      ${inst.id}: title="${title?.text}" price="${price?.text}" childCount=${inst.childIds.length}`);
  }

  // ─── Step C: Read scene on disk — should be COLLAPSED ──
  console.log(`[4] disk scene JSON should store placeholders, not hydrated trees`);
  const sceneRaw = JSON.parse(fs.readFileSync(
    path.join(dir, '.reframe/scenes/pricing.scene.json'), 'utf-8',
  ));
  function countInstances(n: any): number {
    if (!n) return 0;
    let c = n.type === 'INSTANCE' ? 1 : 0;
    for (const ch of n.children ?? []) c += countInstances(ch);
    return c;
  }
  function countAllNodes(n: any): number {
    if (!n) return 0;
    let c = 1;
    for (const ch of n.children ?? []) c += countAllNodes(ch);
    return c;
  }
  const diskInstances = countInstances(sceneRaw.root);
  const diskNodes = countAllNodes(sceneRaw.root);
  console.log(`    disk has ${diskInstances} INSTANCE placeholders, ${diskNodes} total nodes`);
  console.log(`    (if components were expanded, diskNodes would be ~${3 * 5 + 3} not ${diskNodes})`);

  // ─── Step D: Reload and verify hydration works ────────
  console.log(`[5] reload scene → expand runs, instances re-hydrated`);
  const reloaded = loadSceneFromProject(dir, 'pricing');
  const reloadedInstances = [...reloaded.graph.getAllNodes()].filter(n => n.type === 'INSTANCE');
  console.log(`    reloaded instances: ${reloadedInstances.length}`);
  for (const i of reloadedInstances) {
    console.log(`      ${i.id}: ${i.childIds.length} children after reload`);
  }

  // ─── Step E: Update master → recompile → propagation ─
  console.log(`[6] update master (add hover ring to cta) → recompile`);
  // Edit master: re-import the card HTML with a new CTA border
  const CARD_V2 = CARD_HTML.replace('border-radius:4px', 'border-radius:4px;box-shadow:0 0 0 2px rgba(83,58,253,0.2)');
  const cardV2 = await importFromHtml(CARD_V2, { stableIds: true });
  autoBindTokens(cardV2.graph, cardV2.rootId, ds);
  saveComponentMaster(dir, 'PricingCard', cardV2.graph, cardV2.rootId);
  const m2 = loadComponentMaster(dir, 'PricingCard');
  console.log(`    master bumped: rev=${m2?.revision}`);

  // Append an autoBindTokens op so the next compile also runs Phase 3 binding.
  // Without this, the scene exports with hardcoded hex colours — the
  // tokens integration only fires when node.meta.tokenBindings exists.
  appendOp(dir, 'pricing', {
    id: nextOpId(), timestamp: new Date().toISOString(),
    type: 'autoBindTokens',
  } as Operation);

  const recompiled = await compileHtmlIntoProject(dir, LANDING_HTML, {
    name: 'pricing', designSystem: ds,
  });
  const recompInstances = [...recompiled.graph.getAllNodes()].filter(n => n.type === 'INSTANCE');
  console.log(`    ${recompInstances.length} instances re-hydrated from v2 master`);

  // ─── Step F: HTML export still emits CSS vars + keyframes path ──
  console.log(`[7] HTML export — Phase 3b tokens + Phase 6 components integrate`);
  const html = exportToHtml(recompiled.graph, recompiled.rootId, {
    designSystem: ds, fullDocument: false,
  });
  console.log(`    html size: ${html.length} bytes`);
  console.log(`    has :root tokens: ${html.includes(':root {')}`);
  console.log(`    has var(--color-primary): ${html.includes('var(--color-primary)')}`);
  // Count visible cards
  const cardMatches = html.match(/Choose plan/g);
  console.log(`    "Choose plan" CTAs rendered: ${cardMatches?.length ?? 0}`);

  // ─── Step G: listComponents via public API ────────────
  console.log(`[8] listComponents`);
  const all = listComponents(dir);
  for (const c of all) {
    console.log(`    ${c.name} (${c.slug}) rev${c.revision} slots=[${c.slots.join(', ')}]`);
  }

  // ─── Final contract assertions ───────────────────────
  const ok =
    diskInstances === 3 &&
    diskNodes < 20 && // placeholders are tiny — roughly 1 FRAME + 3 INSTANCE + hero text + p text
    reloadedInstances.length === 3 &&
    reloadedInstances.every(i => i.childIds.length > 0) &&
    recompInstances.length === 3 &&
    html.includes(':root {') &&
    html.includes('var(--color-primary)') &&
    (cardMatches?.length ?? 0) === 3 &&
    all.length === 1 &&
    all[0].revision === 2;

  console.log(`\n${ok ? '✓' : '✗'} Phase 6 live demo ${ok ? 'complete' : 'FAILED'}.`);
  console.log(`  Sandbox kept at: ${dir}`);
  if (!ok) process.exit(1);
}

main().catch(e => { console.error('CRASH', e); process.exit(1); });
