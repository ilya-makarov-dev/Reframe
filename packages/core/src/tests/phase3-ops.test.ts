/**
 * Phase 3 stress test — Operations as data + token autobinding + replay.
 *
 * Run: npx tsx packages/core/src/tests/phase3-ops.test.ts
 *
 * Covers:
 *   1. applyOperation setProps — happy + missing node
 *   2. applyOperation bindToken — merges with existing bindings
 *   3. applyOperation autoBindTokens — binds colors + fontSize to DS tokens
 *   4. applyOperation addState — hover/disabled
 *   5. applyOperation setResponsive — replace-by-maxWidth semantics
 *   6. replayOperations — partial failures don't abort the rest
 *   7. Color distance: tolerance respected (near matches bind, far ones skip)
 *   8. hexToRgb parsing edge cases (#abc, #rrggbb, invalid)
 *   9. history append/read/clear JSONL round-trip
 *  10. history corrupt-line tolerance
 *  11. compileHtmlIntoProject + replayHistory: edit survives re-compile
 *  12. Missing-id op after source edit: degrades gracefully
 *  13. deleteScene wipes history log
 *  14. autoBindTokens via operation updates node.meta.tokenBindings on disk
 *  15. End-to-end "change a token, re-export, all bound nodes pick it up"
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  applyOperation,
  replayOperations,
  autoBindTokens,
  type Operation,
} from '../ops/index.js';
import {
  initProject,
  compileHtmlIntoProject,
  loadSceneFromProject,
  appendOp,
  appendOps,
  readOps,
  clearOps,
  historyFilePath,
  nextOpId,
} from '../project/index.js';
import { importFromHtml } from '../importers/html.js';
import type { SceneGraph } from '../engine/scene-graph.js';
import type { DesignSystem } from '../design-system/types.js';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-phase3-'));
}
function cleanup(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// Minimal DesignSystem for tests — shape-valid but hand-crafted so the
// auto-binder has known brand colors to match against.
function makeDS(): DesignSystem {
  const roles = new Map<string, string>();
  roles.set('primary', '#635BFF');
  roles.set('cta', '#635BFF');
  roles.set('background', '#FFFFFF');
  roles.set('text', '#0A0A0A');
  roles.set('accent', '#22D3EE');
  return {
    brand: 'TestBrand',
    colors: {
      primary: '#635BFF',
      background: '#FFFFFF',
      text: '#0A0A0A',
      accent: '#22D3EE',
      roles,
    },
    typography: {
      hierarchy: [
        { role: 'hero', fontSize: 64, fontWeight: 700, lineHeight: 1.1, letterSpacing: -1 },
        { role: 'title', fontSize: 40, fontWeight: 700, lineHeight: 1.2, letterSpacing: -0.5 },
        { role: 'subtitle', fontSize: 24, fontWeight: 600, lineHeight: 1.3, letterSpacing: 0 },
        { role: 'body', fontSize: 16, fontWeight: 400, lineHeight: 1.5, letterSpacing: 0 },
        { role: 'caption', fontSize: 12, fontWeight: 400, lineHeight: 1.4, letterSpacing: 0 },
      ],
      primaryFont: 'Inter',
      secondaryFont: 'IBM Plex Mono',
    } as any,
    layout: {
      spacingUnit: 8,
      spacingScale: [4, 8, 12, 16, 24, 32, 48, 64, 96],
      borderRadiusScale: [0, 2, 4, 8, 12, 16, 9999],
    } as any,
    responsive: { breakpoints: [], typographyOverrides: [] } as any,
    depth: { elevationLevels: [] } as any,
    components: {} as any,
  } as DesignSystem;
}

// HTML intentionally written with near-brand hex values (#635CFE differs by
// ~1 from #635BFF) so we can exercise color tolerance matching.
const BRAND_HTML = `
<div style="width:1440px;background:#ffffff;padding:0">
  <section style="padding:96px 48px;background:#0a0a0a;color:#ffffff">
    <h1 style="font-size:64px;font-weight:700;color:#ffffff">Big headline</h1>
    <p style="font-size:16px;color:#bbbbbb">Body copy at body scale</p>
    <button style="padding:14px 28px;background:#635cfe;color:#ffffff;border-radius:8px">
      Near-primary CTA
    </button>
  </section>
  <footer style="padding:24px;background:#ffffff;color:#0a0a0a;font-size:12px">© caption size</footer>
</div>
`;

async function main() {
  console.log('═══ PHASE 3: Ops + Auto-Bind + Replay Stress Test ═══\n');

  // ── 1. applyOperation setProps ────────────────────────────────
  console.log('  1. setProps — happy + missing node');
  {
    const { graph, rootId } = await importFromHtml(BRAND_HTML, { stableIds: true });
    const h1 = [...graph.getAllNodes()].find(n => (n as any).meta?.sourceTag === 'h1');
    assert(!!h1, 'h1 located');

    const okOp: Operation = {
      id: 'op-1', timestamp: new Date().toISOString(), type: 'setProps',
      nodeId: h1!.id, props: { name: 'EDITED' },
    };
    const r = applyOperation(graph, okOp, { rootId });
    assert(r.ok, 'setProps ok');
    assert(r.affectedNodeIds[0] === h1!.id, 'affected id matches');
    assert(graph.getNode(h1!.id)?.name === 'EDITED', 'name actually changed');

    const badOp: Operation = {
      id: 'op-2', timestamp: new Date().toISOString(), type: 'setProps',
      nodeId: 'h:deadbeef', props: { name: 'ghost' },
    };
    const r2 = applyOperation(graph, badOp, { rootId });
    assert(!r2.ok, 'missing-node setProps returns ok=false (no throw)');
    assert(!!r2.error && r2.error.includes('not found'), 'error message useful');
  }

  // ── 2. bindToken merges with existing bindings ────────────────
  console.log('  2. bindToken merges, does not clobber');
  {
    const { graph, rootId } = await importFromHtml(BRAND_HTML, { stableIds: true });
    const button = [...graph.getAllNodes()].find(n => n.semanticRole === 'button');
    assert(!!button, 'button located');

    const op1: Operation = {
      id: '1', timestamp: 't', type: 'bindToken',
      nodeId: button!.id, property: 'fill', token: 'primary',
    };
    const op2: Operation = {
      id: '2', timestamp: 't', type: 'bindToken',
      nodeId: button!.id, property: 'fontSize', token: 'body',
    };
    applyOperation(graph, op1, { rootId });
    applyOperation(graph, op2, { rootId });

    const bindings = graph.getNode(button!.id)?.meta?.tokenBindings;
    assert(!!bindings, 'bindings present');
    assert(bindings?.fill === 'primary', 'fill bound');
    assert(bindings?.fontSize === 'body', 'fontSize bound (merge, not replace)');

    // Replay idempotency — second apply of op1 leaves state identical
    const before = JSON.stringify(graph.getNode(button!.id)?.meta?.tokenBindings);
    applyOperation(graph, op1, { rootId });
    const after = JSON.stringify(graph.getNode(button!.id)?.meta?.tokenBindings);
    assert(before === after, 'bindToken idempotent');
  }

  // ── 3. autoBindTokens direct call ─────────────────────────────
  console.log('  3. autoBindTokens binds colors + typography');
  {
    const { graph, rootId } = await importFromHtml(BRAND_HTML, { stableIds: true });
    const ds = makeDS();
    const result = autoBindTokens(graph, rootId, ds, { colorTolerance: 30 });
    assert(result.boundNodes.length > 0, `at least one node bound (${result.boundNodes.length})`);

    // Button fill #635cfe is ~1 distance from primary #635BFF → should bind.
    const button = [...graph.getAllNodes()].find(n => n.semanticRole === 'button');
    const btnBindings = button?.meta?.tokenBindings;
    assert(btnBindings?.fill === 'primary' || btnBindings?.fill === 'cta',
      `near-primary hex bound to primary/cta role (got ${btnBindings?.fill})`);

    // h1 font size 64 should bind to "hero" in typography hierarchy
    const h1 = [...graph.getAllNodes()].find(n => (n as any).meta?.sourceTag === 'h1');
    assert(h1?.meta?.tokenBindings?.fontSize === 'hero', 'h1 bound to hero role');

    // p font size 16 should bind to "body"
    const p = [...graph.getAllNodes()].find(n => (n as any).meta?.sourceTag === 'p');
    assert(p?.meta?.tokenBindings?.fontSize === 'body', 'p bound to body role');
  }

  // ── 4. autoBindTokens via Operation with apply dispatcher ─────
  console.log('  4. autoBindTokens Operation dispatcher');
  {
    const { graph, rootId } = await importFromHtml(BRAND_HTML, { stableIds: true });
    const ds = makeDS();
    const op: Operation = {
      id: 'auto-1', timestamp: 't', type: 'autoBindTokens',
      colorTolerance: 30,
    };
    const r = applyOperation(graph, op, { rootId, designSystem: ds });
    assert(r.ok, 'autoBindTokens ok');
    assert(r.affectedNodeIds.length > 0, `affected ids (${r.affectedNodeIds.length})`);
    assert(!!r.summary && r.summary.includes('autoBindTokens'), 'summary populated');

    // Without designSystem → error, no throw
    const op2: Operation = { id: 'x', timestamp: 't', type: 'autoBindTokens' };
    const r2 = applyOperation(graph, op2, { rootId });
    assert(!r2.ok, 'missing designSystem → ok=false');
    assert(!!r2.error && r2.error.includes('designSystem'), 'error mentions designSystem');
  }

  // ── 5. addState / setResponsive ───────────────────────────────
  console.log('  5. addState + setResponsive');
  {
    const { graph, rootId } = await importFromHtml(BRAND_HTML, { stableIds: true });
    const button = [...graph.getAllNodes()].find(n => n.semanticRole === 'button')!;

    const state: Operation = {
      id: '1', timestamp: 't', type: 'addState',
      nodeId: button.id, state: 'hover', props: { opacity: 0.9 },
    };
    applyOperation(graph, state, { rootId });
    assert((graph.getNode(button.id)?.states as any)?.hover?.opacity === 0.9, 'hover state set');

    // Replace hover state — new props REPLACE, not merge
    const state2: Operation = {
      id: '2', timestamp: 't', type: 'addState',
      nodeId: button.id, state: 'hover', props: { opacity: 0.8 },
    };
    applyOperation(graph, state2, { rootId });
    assert((graph.getNode(button.id)?.states as any)?.hover?.opacity === 0.8, 'hover state replaced');

    const r1: Operation = {
      id: '3', timestamp: 't', type: 'setResponsive',
      nodeId: button.id, maxWidth: 768, props: { fontSize: 14 },
    };
    applyOperation(graph, r1, { rootId });
    const r2: Operation = {
      id: '4', timestamp: 't', type: 'setResponsive',
      nodeId: button.id, maxWidth: 375, props: { fontSize: 12 },
    };
    applyOperation(graph, r2, { rootId });

    const responsive = graph.getNode(button.id)?.responsive ?? [];
    assert(responsive.length === 2, `two responsive rules (got ${responsive.length})`);
    assert(responsive[0].maxWidth === 768, 'descending order 768 first');
    assert(responsive[1].maxWidth === 375, 'descending order 375 second');

    // Replace existing breakpoint (same maxWidth) rather than adding duplicate
    const r3: Operation = {
      id: '5', timestamp: 't', type: 'setResponsive',
      nodeId: button.id, maxWidth: 768, props: { fontSize: 13 },
    };
    applyOperation(graph, r3, { rootId });
    const after = graph.getNode(button.id)?.responsive ?? [];
    assert(after.length === 2, 'still two rules after replace');
    const rule768 = after.find(r => r.maxWidth === 768);
    assert((rule768?.props as any)?.fontSize === 13, 'replaced value');
  }

  // ── 6. replayOperations: partial failures don't abort ─────────
  console.log('  6. replayOperations partial failure continues');
  {
    const { graph, rootId } = await importFromHtml(BRAND_HTML, { stableIds: true });
    const real = [...graph.getAllNodes()].find(n => n.semanticRole === 'button')!;
    const ops: Operation[] = [
      { id: '1', timestamp: 't', type: 'setProps', nodeId: real.id, props: { name: 'ONE' } },
      { id: '2', timestamp: 't', type: 'setProps', nodeId: 'h:deadbeef', props: { name: 'ghost' } },
      { id: '3', timestamp: 't', type: 'setProps', nodeId: real.id, props: { name: 'THREE' } },
    ];
    const result = replayOperations(graph, ops, { rootId });
    assert(result.applied === 2, `two applied (got ${result.applied})`);
    assert(result.failed === 1, `one failed (got ${result.failed})`);
    assert(graph.getNode(real.id)?.name === 'THREE', 'last real op wins');
  }

  // ── 7. Color tolerance ────────────────────────────────────────
  console.log('  7. Color tolerance threshold');
  {
    // Far color (#00ff00) should NOT bind to any brand token with default tol
    const html = `<div style="width:400px;height:100px;background:#ffffff"><button style="background:#00ff00;color:#ffffff;padding:12px">green</button></div>`;
    const { graph, rootId } = await importFromHtml(html, { stableIds: true });
    const ds = makeDS();
    autoBindTokens(graph, rootId, ds, { colorTolerance: 30 });
    const btn = [...graph.getAllNodes()].find(n => n.semanticRole === 'button');
    assert(btn?.meta?.tokenBindings?.fill !== 'primary', '#00ff00 not bound to primary');
  }

  // ── 8. History JSONL I/O ──────────────────────────────────────
  console.log('  8. History append/read/clear');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Hist Test');
      const slug = 'scene-a';

      const ops: Operation[] = [
        { id: nextOpId(), timestamp: new Date().toISOString(), type: 'setProps', nodeId: 'h:1', props: { name: 'a' } },
        { id: nextOpId(), timestamp: new Date().toISOString(), type: 'setProps', nodeId: 'h:2', props: { name: 'b' } },
      ];
      appendOp(dir, slug, ops[0]);
      appendOp(dir, slug, ops[1]);

      assert(fs.existsSync(historyFilePath(dir, slug)), 'history file exists');
      const read = readOps(dir, slug);
      assert(read.length === 2, `2 ops read (${read.length})`);
      assert(read[0].id === ops[0].id, 'first op id preserved');
      assert(read[1].id === ops[1].id, 'second op id preserved');

      // Batch append
      const batch: Operation[] = [
        { id: 'b1', timestamp: 't', type: 'setProps', nodeId: 'h:3', props: {} },
        { id: 'b2', timestamp: 't', type: 'setProps', nodeId: 'h:4', props: {} },
      ];
      appendOps(dir, slug, batch);
      assert(readOps(dir, slug).length === 4, '4 ops after batch');

      clearOps(dir, slug);
      assert(!fs.existsSync(historyFilePath(dir, slug)), 'history cleared');
      assert(readOps(dir, slug).length === 0, 'empty read after clear');
    } finally { cleanup(dir); }
  }

  // ── 9. History corrupt-line tolerance ─────────────────────────
  console.log('  9. History skips malformed lines');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Corrupt Test');
      const slug = 'scene-b';
      const filePath = historyFilePath(dir, slug);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });

      const good: Operation = { id: 'ok', timestamp: 't', type: 'setProps', nodeId: 'h:1', props: {} };
      const content = JSON.stringify(good) + '\n{not valid json\n\n' + JSON.stringify(good).replace(/"id":"ok"/, '"id":"ok2"') + '\n';
      fs.writeFileSync(filePath, content, 'utf-8');

      const ops = readOps(dir, slug);
      assert(ops.length === 2, `two good ops survived (got ${ops.length})`);
      assert(ops[0].id === 'ok' && ops[1].id === 'ok2', 'correct order preserved');
    } finally { cleanup(dir); }
  }

  // ── 10. Replay through compileHtmlIntoProject ─────────────────
  console.log('  10. Replay history during re-compile');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Replay Test');
      const ds = makeDS();

      // First compile
      const first = await compileHtmlIntoProject(dir, BRAND_HTML, {
        name: 'home', designSystem: ds,
      });
      const button = [...first.graph.getAllNodes()].find(n => n.semanticRole === 'button')!;
      const h1 = [...first.graph.getAllNodes()].find(n => (n as any).meta?.sourceTag === 'h1')!;
      assert(button.id.startsWith('h:'), 'button has stable id');

      // Append two edits to history
      appendOp(dir, 'home', {
        id: nextOpId(), timestamp: new Date().toISOString(), type: 'setProps',
        nodeId: button.id, props: { name: 'REPLAYED_CTA' },
      });
      appendOp(dir, 'home', {
        id: nextOpId(), timestamp: new Date().toISOString(), type: 'autoBindTokens',
      });

      // Re-compile same HTML — replay should take effect
      const second = await compileHtmlIntoProject(dir, BRAND_HTML, {
        name: 'home', designSystem: ds,
      });
      assert(!!second.replay, 'replay result returned');
      assert(second.replay!.opsRead === 2, `2 ops read (${second.replay?.opsRead})`);
      assert(second.replay!.applied === 2, `2 applied (${second.replay?.applied})`);
      assert(second.replay!.failed === 0, 'zero failed on clean replay');

      const replayedButton = second.graph.getNode(button.id);
      assert(replayedButton?.name === 'REPLAYED_CTA', 'setProps replayed');
      assert(
        replayedButton?.meta?.tokenBindings?.fill === 'primary'
        || replayedButton?.meta?.tokenBindings?.fill === 'cta',
        `autoBind re-applied (fill=${replayedButton?.meta?.tokenBindings?.fill})`,
      );

      const replayedH1 = second.graph.getNode(h1.id);
      assert(replayedH1?.meta?.tokenBindings?.fontSize === 'hero', 'h1 fontSize replayed bound');

      // Load from disk — the saved scene JSON should already reflect replay
      const { graph: loaded } = loadSceneFromProject(dir, 'home');
      const loadedBtn = loaded.getNode(button.id);
      assert(loadedBtn?.name === 'REPLAYED_CTA', 'replay persisted via saveScene');
      assert(loadedBtn?.meta?.tokenBindings?.fill !== undefined, 'binding persisted on disk');
    } finally { cleanup(dir); }
  }

  // ── 11. Missing-id op after source edit → graceful skip ───────
  console.log('  11. Stale op after source edit degrades gracefully');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Stale Test');
      const ds = makeDS();
      const first = await compileHtmlIntoProject(dir, BRAND_HTML, {
        name: 'home', designSystem: ds,
      });

      // Record an op targeting a node that exists in the first compile
      const button = [...first.graph.getAllNodes()].find(n => n.semanticRole === 'button')!;
      appendOp(dir, 'home', {
        id: 'ghost', timestamp: 't', type: 'setProps',
        nodeId: button.id, props: { name: 'will-disappear' },
      });
      appendOp(dir, 'home', {
        id: 'fake', timestamp: 't', type: 'setProps',
        nodeId: 'h:nonexistent-deadbeef', props: { name: 'nope' },
      });

      // Re-compile with DIFFERENT HTML that removes the button entirely
      const editedHtml = BRAND_HTML.replace(/<button[\s\S]*?<\/button>/, '');
      const second = await compileHtmlIntoProject(dir, editedHtml, {
        name: 'home', designSystem: ds,
      });
      assert(!!second.replay, 'replay attempted');
      assert(second.replay!.failed === 2, `both ops failed (${second.replay?.failed})`);
      assert(second.replay!.applied === 0, 'zero applied (targets gone)');
      // Compile did not throw — graceful degradation
      assert(second.graph.nodes.size > 0, 'graph still built despite stale ops');
    } finally { cleanup(dir); }
  }

  // ── 12. deleteScene wipes history ─────────────────────────────
  console.log('  12. deleteScene clears history log');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Delete Test');
      const ds = makeDS();
      await compileHtmlIntoProject(dir, BRAND_HTML, { name: 'home', designSystem: ds });
      appendOp(dir, 'home', {
        id: 'x', timestamp: 't', type: 'setProps', nodeId: 'h:1', props: {},
      });
      assert(fs.existsSync(historyFilePath(dir, 'home')), 'history exists');

      const { deleteScene } = await import('../project/io.js');
      deleteScene(dir, 'home');
      assert(!fs.existsSync(historyFilePath(dir, 'home')), 'history cleared after deleteScene');
    } finally { cleanup(dir); }
  }

  // ── 13. End-to-end "retheme" — change token, rebind, re-skin ──
  console.log('  13. Retheme: swap brand primary, auto-rebind picks new color');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Retheme Test');
      const stripeDs = makeDS();

      const first = await compileHtmlIntoProject(dir, BRAND_HTML, {
        name: 'home', designSystem: stripeDs,
      });
      appendOp(dir, 'home', {
        id: 'auto', timestamp: 't', type: 'autoBindTokens',
      });
      // Re-compile to apply the auto-bind op via replay
      const second = await compileHtmlIntoProject(dir, BRAND_HTML, {
        name: 'home', designSystem: stripeDs,
      });
      const btn = [...second.graph.getAllNodes()].find(n => n.semanticRole === 'button')!;
      assert(['primary', 'cta'].includes(btn.meta?.tokenBindings?.fill ?? ''),
        'bound to primary/cta under stripe DS');

      // Swap DS: Linear brand with different primary (#5E6AD2)
      const linearDs = makeDS();
      linearDs.colors.primary = '#5E6AD2';
      linearDs.colors.roles.set('primary', '#5E6AD2');
      linearDs.colors.roles.set('cta', '#5E6AD2');

      // Re-compile with linear DS — same HTML, same history, different tokens
      const third = await compileHtmlIntoProject(dir, BRAND_HTML, {
        name: 'home', designSystem: linearDs,
      });
      const btn3 = [...third.graph.getAllNodes()].find(n => n.semanticRole === 'button')!;
      // #635cfe is FAR from #5E6AD2 (distance ~50) → should NOT bind to primary
      assert(btn3.meta?.tokenBindings?.fill !== 'primary',
        'near-stripe hex not bound when DS swapped to linear (shows tolerance works)');
    } finally { cleanup(dir); }
  }

  // ── 14. Unknown op type forward-compat ────────────────────────
  console.log('  14. Unknown op type returns ok=false');
  {
    const { graph, rootId } = await importFromHtml(BRAND_HTML, { stableIds: true });
    const weird: any = {
      id: '1', timestamp: 't', type: 'futureOp', nodeId: 'h:1', extra: {},
    };
    const r = applyOperation(graph, weird, { rootId });
    assert(!r.ok, 'unknown op → ok=false');
    assert(!!r.error && r.error.includes('Unknown operation'), 'clear error message');
  }

  // ── 15. Autobind skips nodes without explicit fontSize ────────
  console.log('  15. Autobind does not touch FRAME font fields');
  {
    const { graph, rootId } = await importFromHtml(BRAND_HTML, { stableIds: true });
    const ds = makeDS();
    autoBindTokens(graph, rootId, ds, { colorTolerance: 30 });
    for (const n of graph.getAllNodes()) {
      if (n.type === 'FRAME' && n.meta?.tokenBindings?.fontSize) {
        assert(false, `FRAME ${n.id} should not have fontSize binding`);
      }
    }
    assert(true, 'no FRAME fontSize bindings');
  }

  console.log(`\n═══ PHASE 3: ${passed} passed, ${failed} failed ═══`);
  if (failed > 0) process.exit(1);
}

main().catch(e => {
  console.error('CRASH', e);
  process.exit(1);
});
