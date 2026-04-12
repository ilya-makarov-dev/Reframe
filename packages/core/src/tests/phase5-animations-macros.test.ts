/**
 * Phase 5 stress test — animations, macros, timeline export, replay integration.
 *
 * Run: npx tsx packages/core/src/tests/phase5-animations-macros.test.ts
 *
 * Covers:
 *   Animations:
 *     1. addPresetAnimation op creates a timeline on the graph
 *     2. addPresetAnimation replay-idempotent (same op twice → same timeline)
 *     3. addAnimation custom keyframes accepted
 *     4. addAnimation rejects payloads with <2 keyframes
 *     5. clearAnimations removes all animations for a node
 *     6. Unknown preset returns ok=false
 *     7. Animation survives serialize → deserialize
 *     8. Animation replay survives re-compile (via compileHtmlIntoProject)
 *     9. HTML exporter emits @keyframes + animation: rules
 *    10. React exporter emits :root + @keyframes block
 *    11. Node class includes the animation class name
 *    12. Multiple animations on same node coexist (stacked)
 *   Macros:
 *    13. saveMacro writes .macro.json file
 *    14. loadMacro returns the stored macro
 *    15. listMacros returns every registered macro
 *    16. deleteMacro removes the file
 *    17. Macro placeholder $role:button expands to a real node id
 *    18. Macro placeholder with index $role:heading[0] picks N-th match
 *    19. Macro with unknown role → op skipped with reason
 *    20. applyMacro appends ops to history log, not the live graph
 *    21. Replay of macro ops on next compile lands edits on the right nodes
 *    22. Macro with autoBindTokens (no nodeId) passes through unchanged
 *    23. Macro with literal nodeId survives when node still exists
 *    24. Corrupt macro file returns null from loadMacro
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  initProject,
  compileHtmlIntoProject,
  loadSceneFromProject,
  saveMacro,
  loadMacro,
  listMacros,
  deleteMacro,
  applyMacro,
  readOps,
  appendOp,
  nextOpId,
} from '../project/index.js';
import { importFromHtml } from '../importers/html.js';
import { applyOperation } from '../ops/apply.js';
import type { Operation } from '../ops/types.js';
import { exportToHtml } from '../exporters/html.js';
import { exportToReact } from '../exporters/react.js';
import { getStandaloneNode } from '../adapters/standalone/node.js';
import { serializeGraph, deserializeScene } from '../serialize.js';
import type { DesignSystem } from '../design-system/types.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; } else { failed++; console.error(`  FAIL: ${msg}`); }
}

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-phase5-'));
}
function cleanup(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function makeDS(): DesignSystem {
  return {
    brand: 'Phase5Test',
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
<div style="width:1200px;background:#ffffff;padding:48px">
  <h1 style="font-size:56px;color:#061b31;font-weight:300">Phase 5</h1>
  <h2 style="font-size:32px;color:#061b31;font-weight:300">Second</h2>
  <button style="padding:12px 24px;background:#533afd;color:#ffffff;border-radius:4px">CTA 1</button>
  <button style="padding:12px 24px;background:#ffffff;color:#533afd;border-radius:4px">CTA 2</button>
</div>
`;

async function main() {
  console.log('═══ PHASE 5: Animations + Macros Stress Test ═══\n');

  // ── 1-2. addPresetAnimation ─────────────────────────────────
  console.log('  1-2. addPresetAnimation + idempotent replay');
  {
    const { graph, rootId } = await importFromHtml(HTML, { stableIds: true });
    const button = [...graph.getAllNodes()].find(n => n.semanticRole === 'button')!;
    const op: Operation = {
      id: '1', timestamp: 't', type: 'addPresetAnimation',
      nodeId: button.id, preset: 'fadeIn', config: { duration: 500 },
    };
    const r1 = applyOperation(graph, op, { rootId });
    assert(r1.ok, 'first apply ok');
    assert((graph.timeline as any)?.animations?.length === 1, '1 animation after first apply');

    applyOperation(graph, op, { rootId });
    assert((graph.timeline as any).animations.length === 1, 'still 1 after second apply (idempotent)');
  }

  // ── 3-4. addAnimation custom + reject too few keyframes ────
  console.log('  3-4. addAnimation custom + validation');
  {
    const { graph, rootId } = await importFromHtml(HTML, { stableIds: true });
    const h1 = [...graph.getAllNodes()].find(n => (n as any).meta?.sourceTag === 'h1')!;

    const good: Operation = {
      id: '1', timestamp: 't', type: 'addAnimation',
      nodeId: h1.id,
      animation: {
        name: 'customReveal',
        duration: 800,
        keyframes: [
          { offset: 0, properties: { opacity: 0, y: -20 } },
          { offset: 1, properties: { opacity: 1, y: 0 } },
        ],
      },
    };
    const r1 = applyOperation(graph, good, { rootId });
    assert(r1.ok, 'custom anim ok');
    assert((graph.timeline as any)?.animations?.length === 1, '1 anim in timeline');

    const bad: Operation = {
      id: '2', timestamp: 't', type: 'addAnimation',
      nodeId: h1.id,
      animation: { name: 'tooFew', duration: 400, keyframes: [{ offset: 0, properties: {} }] },
    };
    const r2 = applyOperation(graph, bad, { rootId });
    assert(!r2.ok, 'rejects <2 keyframes');
  }

  // ── 5. clearAnimations ──────────────────────────────────────
  console.log('  5. clearAnimations removes per-node');
  {
    const { graph, rootId } = await importFromHtml(HTML, { stableIds: true });
    const button = [...graph.getAllNodes()].find(n => n.semanticRole === 'button')!;
    const h1 = [...graph.getAllNodes()].find(n => (n as any).meta?.sourceTag === 'h1')!;

    applyOperation(graph, { id: '1', timestamp: 't', type: 'addPresetAnimation', nodeId: button.id, preset: 'fadeIn' }, { rootId });
    applyOperation(graph, { id: '2', timestamp: 't', type: 'addPresetAnimation', nodeId: h1.id, preset: 'slideInUp' }, { rootId });
    assert((graph.timeline as any).animations.length === 2, '2 animations before clear');

    const r = applyOperation(graph, { id: '3', timestamp: 't', type: 'clearAnimations', nodeId: button.id }, { rootId });
    assert(r.ok, 'clear ok');
    assert((graph.timeline as any).animations.length === 1, '1 anim after clearing button');
    assert((graph.timeline as any).animations[0].nodeId === h1.id, 'h1 anim survives');
  }

  // ── 6. Unknown preset ───────────────────────────────────────
  console.log('  6. Unknown preset → ok=false');
  {
    const { graph, rootId } = await importFromHtml(HTML, { stableIds: true });
    const button = [...graph.getAllNodes()].find(n => n.semanticRole === 'button')!;
    const r = applyOperation(graph, { id: '1', timestamp: 't', type: 'addPresetAnimation', nodeId: button.id, preset: 'unicornFade' }, { rootId });
    assert(!r.ok, 'unknown preset → ok=false');
    assert(!!r.error && r.error.includes('unknown preset'), 'error mentions preset');
  }

  // ── 7. Timeline survives serialize/deserialize ───────────────
  console.log('  7. Timeline round-trip');
  {
    const { graph, rootId } = await importFromHtml(HTML, { stableIds: true });
    const button = [...graph.getAllNodes()].find(n => n.semanticRole === 'button')!;
    applyOperation(graph, { id: '1', timestamp: 't', type: 'addPresetAnimation', nodeId: button.id, preset: 'fadeIn' }, { rootId });

    const json = serializeGraph(graph, rootId, { compact: true, timeline: graph.timeline as any });
    const { graph: graph2, timeline: timeline2 } = deserializeScene(json);
    assert(!!timeline2, 'timeline present after deserialize');
    assert((timeline2 as any).animations.length === 1, '1 anim after round-trip');
    // io.ts hydrates graph.timeline on loadSceneFromProject; serializeGraph+deserializeScene
    // returns timeline separately — we just check it's there.
  }

  // ── 8. Animation replay via compileHtmlIntoProject ──────────
  console.log('  8. Animation replay on re-compile');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Anim Replay');
      const ds = makeDS();
      const first = await compileHtmlIntoProject(dir, HTML, { name: 'hero', designSystem: ds });
      const button = [...first.graph.getAllNodes()].find(n => n.semanticRole === 'button')!;

      appendOp(dir, 'hero', {
        id: nextOpId(), timestamp: new Date().toISOString(),
        type: 'addPresetAnimation', nodeId: button.id, preset: 'popIn', config: { duration: 600 },
      });

      const second = await compileHtmlIntoProject(dir, HTML, { name: 'hero', designSystem: ds });
      assert(second.replay?.applied === 1, `1 applied (got ${second.replay?.applied})`);
      assert(!!second.graph.timeline, 'timeline present after replay');
      const tl = second.graph.timeline as any;
      assert(tl.animations.length === 1, `1 animation in timeline (got ${tl?.animations?.length})`);
      assert(tl.animations[0].nodeId === button.id, 'correct node targeted');

      // Disk persistence — reload gives back the timeline
      const reloaded = loadSceneFromProject(dir, 'hero');
      assert(!!reloaded.graph.timeline, 'timeline persisted to disk');
      assert((reloaded.graph.timeline as any).animations.length === 1, 'reload preserves anim');
    } finally { cleanup(dir); }
  }

  // ── 9. HTML exporter emits @keyframes ────────────────────────
  console.log('  9. HTML exporter emits keyframes');
  {
    const { graph, rootId } = await importFromHtml(HTML, { stableIds: true });
    const button = [...graph.getAllNodes()].find(n => n.semanticRole === 'button')!;
    applyOperation(graph, { id: '1', timestamp: 't', type: 'addPresetAnimation', nodeId: button.id, preset: 'fadeIn', config: { duration: 500 } }, { rootId });

    const html = exportToHtml(graph, rootId, { fullDocument: false });
    assert(html.includes('@keyframes'), 'html has @keyframes');
    assert(html.includes('animation:'), 'html has animation: rule');
    assert(/rfa\d+_/.test(html), 'html has generated animation class name');
  }

  // ── 10. React exporter emits keyframes ───────────────────────
  console.log('  10. React exporter emits keyframes');
  {
    const { graph, rootId } = await importFromHtml(HTML, { stableIds: true });
    const button = [...graph.getAllNodes()].find(n => n.semanticRole === 'button')!;
    applyOperation(graph, { id: '1', timestamp: 't', type: 'addPresetAnimation', nodeId: button.id, preset: 'fadeIn' }, { rootId });

    const inode = getStandaloneNode(graph, rootId)!;
    const react = exportToReact(inode, {});
    assert(react.includes('@keyframes'), 'react has @keyframes');
    assert(react.includes('animation:'), 'react has animation: rule');
  }

  // ── 11. Node class includes anim class ───────────────────────
  console.log('  11. Node class attribute carries anim class');
  {
    const { graph, rootId } = await importFromHtml(HTML, { stableIds: true });
    const button = [...graph.getAllNodes()].find(n => n.semanticRole === 'button')!;
    applyOperation(graph, { id: '1', timestamp: 't', type: 'addPresetAnimation', nodeId: button.id, preset: 'fadeIn' }, { rootId });

    const html = exportToHtml(graph, rootId, { fullDocument: false });
    // Find the button line and check it has an rfa class token
    const buttonLine = html.split('\n').find(line => line.includes('<button')) ?? '';
    assert(/class="[^"]*rfa\d/.test(buttonLine), `button has anim class (line: ${buttonLine.slice(0, 120)})`);
  }

  // ── 12. Multiple animations on same node ─────────────────────
  console.log('  12. Stacked animations on same node');
  {
    const { graph, rootId } = await importFromHtml(HTML, { stableIds: true });
    const button = [...graph.getAllNodes()].find(n => n.semanticRole === 'button')!;
    applyOperation(graph, { id: '1', timestamp: 't', type: 'addPresetAnimation', nodeId: button.id, preset: 'fadeIn' }, { rootId });
    applyOperation(graph, { id: '2', timestamp: 't', type: 'addPresetAnimation', nodeId: button.id, preset: 'slideInUp' }, { rootId });
    const tl = graph.timeline as any;
    assert(tl.animations.length === 2, `2 animations (got ${tl.animations.length})`);
  }

  // ── 13-16. Macro CRUD ────────────────────────────────────────
  console.log('  13-16. Macro save/load/list/delete');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Macro CRUD');
      const ops: Operation[] = [
        { id: '1', timestamp: 't', type: 'setProps', nodeId: '$role:button', props: { name: 'CTA_STAR' } },
        { id: '2', timestamp: 't', type: 'addPresetAnimation', nodeId: '$role:button', preset: 'fadeIn' },
      ];
      const saved = saveMacro(dir, 'brand-cta', ops, 'Mark all buttons as CTA_STAR and fade them in');
      assert(saved.name === 'brand-cta', 'macro name');
      assert(saved.ops.length === 2, 'macro has 2 op templates');
      assert(fs.existsSync(path.join(dir, '.reframe', 'macros', 'brand-cta.macro.json')), 'file written');

      const loaded = loadMacro(dir, 'brand-cta');
      assert(!!loaded, 'loadMacro returns');
      assert(!!loaded?.description?.includes('CTA_STAR'), 'description preserved');

      const all = listMacros(dir);
      assert(all.length === 1, '1 macro listed');

      const ok = deleteMacro(dir, 'brand-cta');
      assert(ok, 'deleteMacro true');
      assert(listMacros(dir).length === 0, '0 after delete');
    } finally { cleanup(dir); }
  }

  // ── 17. Placeholder $role:button expands ─────────────────────
  console.log('  17-18. Macro placeholder expansion');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Placeholder');
      const ds = makeDS();
      await compileHtmlIntoProject(dir, HTML, { name: 'hero', designSystem: ds });

      saveMacro(dir, 'rename-all-cta', [
        { id: '1', timestamp: 't', type: 'setProps', nodeId: '$role:button', props: { name: 'ALL_CTA' } },
      ] as Operation[]);
      const result = applyMacro(dir, 'hero', 'rename-all-cta');
      // The HTML has 2 buttons — fan-out should produce 2 ops
      assert(result.appendedOps.length === 2, `2 ops appended (got ${result.appendedOps.length})`);
      assert(result.appendedOps.every(op => (op as any).nodeId.startsWith('h:')),
        'all appended ops have stable ids');

      // 18. Indexed placeholder
      saveMacro(dir, 'first-heading', [
        { id: '1', timestamp: 't', type: 'setProps', nodeId: '$role:heading[0]', props: { name: 'FIRST' } },
      ] as Operation[]);
      const r2 = applyMacro(dir, 'hero', 'first-heading');
      assert(r2.appendedOps.length === 1, 'index[0] → 1 op');
    } finally { cleanup(dir); }
  }

  // ── 19. Unknown role → skipped ───────────────────────────────
  console.log('  19. Unknown role → skipped');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Missing Role');
      const ds = makeDS();
      await compileHtmlIntoProject(dir, HTML, { name: 'hero', designSystem: ds });
      saveMacro(dir, 'ghost', [
        { id: '1', timestamp: 't', type: 'setProps', nodeId: '$role:unicorn', props: {} },
      ] as Operation[]);
      const r = applyMacro(dir, 'hero', 'ghost');
      assert(r.appendedOps.length === 0, '0 appended');
      assert(r.skipped.length === 1, '1 skipped');
      assert(r.skipped[0].reason.includes('unicorn'), 'reason mentions missing role');
    } finally { cleanup(dir); }
  }

  // ── 20-21. Macro → history → replay ──────────────────────────
  console.log('  20-21. Macro lands in history and replays on compile');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Macro Replay');
      const ds = makeDS();
      const first = await compileHtmlIntoProject(dir, HTML, { name: 'hero', designSystem: ds });
      const buttonIds = [...first.graph.getAllNodes()]
        .filter(n => n.semanticRole === 'button').map(n => n.id);
      assert(buttonIds.length === 2, '2 buttons in base');

      saveMacro(dir, 'cta-fade', [
        { id: '1', timestamp: 't', type: 'addPresetAnimation', nodeId: '$role:button', preset: 'fadeIn' },
      ] as Operation[]);
      applyMacro(dir, 'hero', 'cta-fade');

      // Macro should have appended 2 ops (one per button)
      const history = readOps(dir, 'hero');
      assert(history.length === 2, `2 ops in history (got ${history.length})`);

      // But the live graph from `first.graph` must NOT have timeline — macro
      // doesn't touch the in-memory graph, only the log.
      assert(!first.graph.timeline, 'live base graph untouched by macro');

      // Re-compile → replay
      const second = await compileHtmlIntoProject(dir, HTML, { name: 'hero', designSystem: ds });
      assert(second.replay?.applied === 2, `2 ops applied on replay (${second.replay?.applied})`);
      const tl = second.graph.timeline as any;
      assert(!!tl && tl.animations.length === 2, `2 anims in timeline (got ${tl?.animations?.length})`);
    } finally { cleanup(dir); }
  }

  // ── 22. Macro with autoBindTokens (no nodeId) ────────────────
  console.log('  22. Macro with no-nodeId op passes through');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Pass Through');
      const ds = makeDS();
      await compileHtmlIntoProject(dir, HTML, { name: 'hero', designSystem: ds });
      saveMacro(dir, 'autobind', [
        { id: '1', timestamp: 't', type: 'autoBindTokens' } as any,
      ]);
      const r = applyMacro(dir, 'hero', 'autobind');
      assert(r.appendedOps.length === 1, 'autoBindTokens appended');
      assert(r.skipped.length === 0, 'no skips');
    } finally { cleanup(dir); }
  }

  // ── 23. Literal stable id in macro ───────────────────────────
  console.log('  23. Literal stable id in macro');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Literal');
      const ds = makeDS();
      const first = await compileHtmlIntoProject(dir, HTML, { name: 'hero', designSystem: ds });
      const button = [...first.graph.getAllNodes()].find(n => n.semanticRole === 'button')!;

      saveMacro(dir, 'literal', [
        { id: '1', timestamp: 't', type: 'setProps', nodeId: button.id, props: { name: 'LIT' } },
      ] as Operation[]);
      const r = applyMacro(dir, 'hero', 'literal');
      assert(r.appendedOps.length === 1, 'literal id passed through');
      assert((r.appendedOps[0] as any).nodeId === button.id, 'same id preserved');

      // Now apply a macro with a literal id that's NOT in the scene → skipped
      saveMacro(dir, 'ghostId', [
        { id: '1', timestamp: 't', type: 'setProps', nodeId: 'h:deadbeef', props: {} },
      ] as Operation[]);
      const r2 = applyMacro(dir, 'hero', 'ghostId');
      assert(r2.appendedOps.length === 0, 'ghost id not appended');
      assert(r2.skipped.length === 1, 'ghost id skipped');
    } finally { cleanup(dir); }
  }

  // ── 24. Corrupt macro file ───────────────────────────────────
  console.log('  24. Corrupt macro file returns null');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Corrupt');
      const macroPath = path.join(dir, '.reframe', 'macros', 'bad.macro.json');
      fs.mkdirSync(path.dirname(macroPath), { recursive: true });
      fs.writeFileSync(macroPath, '{not valid json', 'utf-8');
      const got = loadMacro(dir, 'bad');
      assert(got === null, 'corrupt file → null');
      // listMacros should skip the corrupt one
      const all = listMacros(dir);
      assert(all.length === 0, 'listMacros ignores corrupt file');
    } finally { cleanup(dir); }
  }

  console.log(`\n═══ PHASE 5: ${passed} passed, ${failed} failed ═══`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('CRASH', e); process.exit(1); });
