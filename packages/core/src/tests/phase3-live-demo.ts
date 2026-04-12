/**
 * Phase 3 live demo — real filesystem, real brand, full round-trip with replay.
 * Run: npx tsx packages/core/src/tests/phase3-live-demo.ts
 *
 * Scenario: an agent compiles a Stripe-themed hero, auto-binds tokens, saves
 * an op to history, re-compiles from the edited source, and the binding +
 * edits all survive. Output is printed as a chronological narrative so you
 * can read it top-to-bottom and see exactly what happens.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  initProject,
  compileHtmlIntoProject,
  appendOp,
  readOps,
  loadSceneFromProject,
  historyFilePath,
  nextOpId,
} from '../project/index.js';
import type { DesignSystem } from '../design-system/types.js';
import type { Operation } from '../ops/types.js';

function makeStripeDS(): DesignSystem {
  const roles = new Map<string, string>();
  roles.set('primary', '#533afd');
  roles.set('cta', '#533afd');
  roles.set('background', '#ffffff');
  roles.set('text', '#061b31');
  roles.set('brand-dark', '#1c1e54');
  roles.set('body', '#64748d');
  return {
    brand: 'Stripe',
    colors: {
      primary: '#533afd',
      background: '#ffffff',
      text: '#061b31',
      accent: '#ea2261',
      roles,
    },
    typography: {
      hierarchy: [
        { role: 'hero', fontSize: 56, fontWeight: 300, lineHeight: 1.03, letterSpacing: -1.4 },
        { role: 'title', fontSize: 48, fontWeight: 300, lineHeight: 1.15, letterSpacing: -0.96 },
        { role: 'subtitle', fontSize: 32, fontWeight: 300, lineHeight: 1.1, letterSpacing: -0.64 },
        { role: 'body', fontSize: 16, fontWeight: 300, lineHeight: 1.4, letterSpacing: 0 },
        { role: 'caption', fontSize: 14, fontWeight: 400, lineHeight: 1.0, letterSpacing: 0 },
      ],
      primaryFont: 'sohne-var',
    } as any,
    layout: {
      spacingUnit: 8,
      borderRadiusScale: [0, 2, 4, 6, 8],
    } as any,
    responsive: { breakpoints: [], typographyOverrides: [] } as any,
    depth: { elevationLevels: [] } as any,
    components: {} as any,
  } as DesignSystem;
}

const HERO = `
<div style="width:1440px;background:#ffffff;padding:0">
  <section style="padding:96px 48px;background:#ffffff">
    <h1 style="font-size:56px;font-weight:300;color:#061b31;letter-spacing:-1.4px">Phase 3 is live</h1>
    <p style="font-size:16px;font-weight:300;color:#64748d">Operations survive re-compile.</p>
    <button style="padding:14px 28px;background:#533afd;color:#ffffff;border-radius:4px;font-size:16px;font-weight:400;min-height:48px">Primary CTA</button>
  </section>
  <footer style="padding:24px 48px;background:#1c1e54;color:#ffffff;font-size:14px">© phase3</footer>
</div>
`;

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-live-'));
  console.log(`\n[1] sandbox: ${dir}`);

  // Step 1: init project
  initProject(dir, 'Phase 3 Live Demo');
  const ds = makeStripeDS();
  console.log(`[2] initProject ✓  design-system: Stripe-alike`);

  // Step 2: first compile
  const first = await compileHtmlIntoProject(dir, HERO, {
    name: 'hero',
    designSystem: ds,
  });
  console.log(`[3] compile #1: ${first.entry.nodes} nodes, rev=${first.entry.revision}, rootId=${first.rootId}`);

  // Show the first few stable ids
  const ids = [...first.graph.getAllNodes()].filter(n => n.id.startsWith('h:')).map(n => n.id);
  console.log(`    stable ids: ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? ' ...' : ''}`);

  const button = [...first.graph.getAllNodes()].find(n => n.semanticRole === 'button')!;
  const h1 = [...first.graph.getAllNodes()].find(n => (n as any).meta?.sourceTag === 'h1')!;
  console.log(`[4] located button ${button.id}, h1 ${h1.id}`);

  // Step 3: append TWO ops to history
  const op1: Operation = {
    id: nextOpId(), timestamp: new Date().toISOString(),
    type: 'autoBindTokens', label: 'Auto-bind entire scene',
  };
  const op2: Operation = {
    id: nextOpId(), timestamp: new Date().toISOString(),
    type: 'setProps', nodeId: button.id, props: { name: 'STAR_CTA' },
    label: 'Rename CTA for analytics',
  };
  appendOp(dir, 'hero', op1);
  appendOp(dir, 'hero', op2);
  console.log(`[5] appended 2 ops to ${path.relative(dir, historyFilePath(dir, 'hero'))}`);

  // Step 4: re-compile from same source
  const second = await compileHtmlIntoProject(dir, HERO, {
    name: 'hero',
    designSystem: ds,
  });
  console.log(`[6] compile #2: rev=${second.entry.revision}, replay=${second.replay?.opsRead} read, ${second.replay?.applied} applied, ${second.replay?.failed} failed`);

  // Verify autoBindTokens took effect
  const btn2 = second.graph.getNode(button.id)!;
  const h1After = second.graph.getNode(h1.id)!;
  console.log(`[7] button.name="${btn2.name}" (expected STAR_CTA)`);
  console.log(`    button.meta.tokenBindings = ${JSON.stringify(btn2.meta?.tokenBindings)}`);
  console.log(`    h1.meta.tokenBindings = ${JSON.stringify(h1After.meta?.tokenBindings)}`);

  // Step 5: reload from disk — verify saveScene persisted replay state
  const { graph: reloaded } = loadSceneFromProject(dir, 'hero');
  const btnDisk = reloaded.getNode(button.id);
  console.log(`[8] reloaded from disk: button.name="${btnDisk?.name}" tokenBindings=${JSON.stringify(btnDisk?.meta?.tokenBindings)}`);

  // Step 6: retheme — swap DS primary to Linear purple, same HTML+history
  const linear = makeStripeDS();
  linear.colors.primary = '#5E6AD2';
  linear.colors.roles.set('primary', '#5E6AD2');
  linear.colors.roles.set('cta', '#5E6AD2');
  const third = await compileHtmlIntoProject(dir, HERO, {
    name: 'hero',
    designSystem: linear,
  });
  const btn3 = third.graph.getNode(button.id)!;
  console.log(`[9] retheme (Linear DS): button.fill binding = ${btn3.meta?.tokenBindings?.fill ?? 'NONE (beyond tolerance)'}`);

  // Step 7: summary
  console.log(`\n[10] history file size: ${fs.statSync(historyFilePath(dir, 'hero')).size} bytes`);
  console.log(`     total ops in log: ${readOps(dir, 'hero').length}`);
  console.log(`\n✓ Phase 3 live demo complete. Sandbox kept at:\n  ${dir}`);
}

main().catch(e => { console.error('CRASH', e); process.exit(1); });
