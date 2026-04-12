/**
 * Phase 3b live demo — full MCP-style pipeline through real handlers.
 *
 * Goal: prove the full contract end-to-end against the filesystem:
 *   1. compileHtmlIntoProject writes source + scene + replays nothing (first run)
 *   2. An explicit setProps op is appended to history via the engine API
 *   3. Re-compile replays the op (simulating a source-edit + recompile)
 *   4. autoBindTokens op in history → all nodes gain tokenBindings on replay
 *   5. Export to HTML emits :root CSS vars and var(--color-primary) for button
 *   6. Export to React emits the same set + inline var() substitutions
 *   7. Retheme DS → same history, same HTML, different primary → different :root
 *
 * Run: npx tsx packages/core/src/tests/phase3b-live-demo.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  initProject,
  compileHtmlIntoProject,
  appendOp,
  readOps,
  nextOpId,
  historyFilePath,
  loadSceneFromProject,
} from '../project/index.js';
import { exportToHtml } from '../exporters/html.js';
import { exportToReact } from '../exporters/react.js';
import { getStandaloneNode } from '../adapters/standalone/node.js';
import type { Operation } from '../ops/types.js';
import type { DesignSystem } from '../design-system/types.js';

function makeDS(overrides: Partial<{ primary: string }> = {}): DesignSystem {
  const primary = overrides.primary ?? '#533afd';
  return {
    brand: 'Phase3bLive',
    colors: {
      primary,
      background: '#ffffff',
      text: '#061b31',
      accent: '#ea2261',
      roles: new Map([
        ['primary', primary],
        ['background', '#ffffff'],
        ['text', '#061b31'],
      ]),
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
    <h1 style="font-size:56px;font-weight:300;color:#061b31;letter-spacing:-1.4px">Phase 3b</h1>
    <p style="font-size:16px;color:#64748d">Operations + auto-bind + CSS vars</p>
    <button style="padding:14px 28px;background:#533afd;color:#ffffff;border-radius:4px;font-size:16px">CTA</button>
  </section>
  <footer style="padding:32px 48px;background:#1c1e54;color:#ffffff">© 2026</footer>
</div>
`;

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3b-live-'));
  console.log(`\n[1] sandbox: ${dir}`);

  initProject(dir, 'Phase 3b Live Demo');
  const ds = makeDS();
  console.log(`[2] initProject ✓`);

  // ─── Step 1: first compile ───────────────────────────────
  const first = await compileHtmlIntoProject(dir, HTML, {
    name: 'hero',
    designSystem: ds,
  });
  console.log(`[3] compile #1: ${first.entry.nodes} nodes, rev=${first.entry.revision}, replay=${first.replay ? 'none' : 'n/a'}`);
  const button = [...first.graph.getAllNodes()].find(n => n.semanticRole === 'button')!;
  const h1 = [...first.graph.getAllNodes()].find(n => (n as any).meta?.sourceTag === 'h1')!;
  console.log(`    button.id=${button.id}  h1.id=${h1.id}`);

  // ─── Step 2: append ops to history (simulates reframe_edit) ──
  const op1: Operation = {
    id: nextOpId(), timestamp: new Date().toISOString(), type: 'setProps',
    nodeId: button.id, props: { name: 'HERO_CTA' },
    label: 'rename CTA for analytics',
  };
  const op2: Operation = {
    id: nextOpId(), timestamp: new Date().toISOString(), type: 'autoBindTokens',
    label: 'auto-bind entire scene',
  };
  appendOp(dir, 'hero', op1);
  appendOp(dir, 'hero', op2);
  const opsOnDisk = readOps(dir, 'hero');
  console.log(`[4] appended 2 ops, file=${path.relative(dir, historyFilePath(dir, 'hero'))}, total on disk=${opsOnDisk.length}`);

  // ─── Step 3: re-compile, replay ops ──────────────────────
  const second = await compileHtmlIntoProject(dir, HTML, {
    name: 'hero',
    designSystem: ds,
  });
  console.log(`[5] compile #2: rev=${second.entry.revision}, replay=${second.replay?.opsRead} read, ${second.replay?.applied} applied`);

  const btn2 = second.graph.getNode(button.id)!;
  console.log(`    button.name="${btn2.name}" (expected HERO_CTA)`);
  console.log(`    button.meta.tokenBindings=${JSON.stringify(btn2.meta?.tokenBindings)}`);

  // ─── Step 4: re-load from disk, verify persist ──────────
  const { graph: disk, rootId: diskRoot } = loadSceneFromProject(dir, 'hero');
  const btnDisk = disk.getNode(button.id)!;
  console.log(`[6] reloaded from disk: button.name="${btnDisk.name}"  bindings=${JSON.stringify(btnDisk.meta?.tokenBindings)}`);

  // ─── Step 5: export HTML with CSS vars ──────────────────
  const htmlOut = exportToHtml(disk, diskRoot, { designSystem: ds, fullDocument: false });
  const htmlHasPrimary = htmlOut.includes('var(--color-primary)');
  const htmlHasRoot = /:root\s*\{[^}]*--color-primary:\s*#533afd/.test(htmlOut);
  console.log(`[7] HTML export (${htmlOut.length} chars):`);
  console.log(`    includes var(--color-primary): ${htmlHasPrimary}`);
  console.log(`    has :root --color-primary: #533afd: ${htmlHasRoot}`);

  // ─── Step 6: export React ───────────────────────────────
  const rootInode = getStandaloneNode(disk, diskRoot)!;
  const reactOut = exportToReact(rootInode, { designSystem: ds });
  const reactHasVar = reactOut.includes("'var(--color-primary)'");
  const reactHasRoot = /:root\s*\{[^}]*--color-primary:\s*#533afd/.test(reactOut);
  console.log(`[8] React export (${reactOut.length} chars):`);
  console.log(`    includes 'var(--color-primary)': ${reactHasVar}`);
  console.log(`    has :root --color-primary: #533afd: ${reactHasRoot}`);

  // ─── Step 7: retheme ─────────────────────────────────────
  const linear = makeDS({ primary: '#5e6ad2' });
  const htmlLinear = exportToHtml(disk, diskRoot, { designSystem: linear, fullDocument: false });
  const reactLinear = exportToReact(rootInode, { designSystem: linear });
  const htmlReThemed = htmlLinear.includes('--color-primary: #5e6ad2');
  const reactReThemed = reactLinear.includes('--color-primary: #5e6ad2');
  console.log(`[9] Retheme → Linear primary (#5e6ad2):`);
  console.log(`    html :root has new primary: ${htmlReThemed}`);
  console.log(`    react :root has new primary: ${reactReThemed}`);

  // ─── Final validation ────────────────────────────────────
  const ok =
    btn2.name === 'HERO_CTA' &&
    btn2.meta?.tokenBindings?.fill === 'primary' &&
    btnDisk.name === 'HERO_CTA' &&
    htmlHasPrimary &&
    htmlHasRoot &&
    reactHasVar &&
    reactHasRoot &&
    htmlReThemed &&
    reactReThemed;

  console.log(`\n${ok ? '✓' : '✗'} Phase 3b live demo ${ok ? 'complete' : 'FAILED'}.`);
  console.log(`  Sandbox kept at: ${dir}`);
  if (!ok) process.exit(1);
}

main().catch(e => { console.error('CRASH', e); process.exit(1); });
