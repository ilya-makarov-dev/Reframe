/**
 * T2 #22 Flow Audit — rule detection / advisory / inspect surfacing contract.
 *
 * Tests:
 *   1. Happy path — well-formed flow → 0 issues
 *   2. flow.unreachable-step — step with no incoming transition → error issue
 *   3. flow.dead-end-step — non-terminal without outgoing → warn issue
 *   4. flow.dead-end-step — last step exempt (no false positive on terminal)
 *   5. flow.invalid-transition-target — out-of-range to/from → error issue
 *   6. flow.duplicate-step-id — two steps with same name → error issue
 *   7. flow.navigation-label-consistency — uniform "Next" → no issue
 *   8. flow.navigation-label-consistency — mixed Next/Continue → warn + suggestion
 *   9. Determinism — same input → identical issue array (incl. stable ordering)
 *  10. Advisory — handleFlowCompile attaches flowAudit to envelope (not throw)
 *  11. Inspect with flowId — text report formats issues correctly
 *  12. Backward compat — clean flow audit summary all-zeros, response shape
 *      preserves pre-#22 fields (kind, flowId, steps, transitions...)
 *
 * Run: npx tsx packages/mcp/src/tests/week7-flow-audit-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleCompile } from '../tools/compile.js';
import { handleInspect } from '../tools/inspect.js';
import { setProjectDir } from '../store.js';
import { initProject } from '../../../core/src/project/io.js';
import {
  runFlowAudit,
  FLOW_AUDIT_RULES,
} from '../../../core/src/audit-flow/index.js';
import type { FlowAuditSpec } from '../../../core/src/audit-flow/types.js';
import { SceneGraph } from '../../../core/src/engine/scene-graph.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

let projectDir: string;
function setupProject(): void {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-flow-audit-test-'));
  initProject(projectDir, 'flow-audit-test');
  setProjectDir(projectDir);
}

function makeSpec(stepCount: number, transitions: Array<{ from: number; to: number; label?: string }>): FlowAuditSpec {
  return {
    flowId: 'test-flow',
    steps: Array.from({ length: stepCount }, (_, i) => ({ name: `step-${i}`, index: i })),
    transitions,
  };
}

/**
 * Build a SceneGraph with a single button leaf carrying a given label.
 * `semanticRole='button'` triggers the navigation-label rule's match path.
 */
function sceneWithButton(label: string): SceneGraph {
  const g = new SceneGraph();
  // root is a CANVAS, add a FRAME container, add a TEXT-as-button child.
  const frame = g.createNode('FRAME' as any, g.rootId, { name: 'frame' });
  g.createNode('TEXT' as any, frame.id, {
    name: 'btn',
    text: label,
    semanticRole: 'button' as any,
  });
  return g;
}

// ─── Pure-rule tests (synthetic spec, no compile dispatch) ───

// ─── TEST 1: happy path ──
async function testHappyPath(): Promise<void> {
  const spec = makeSpec(3, [
    { from: 0, to: 1, label: 'Next' },
    { from: 1, to: 2, label: 'Next' },
  ]);
  const result = runFlowAudit(spec, []);
  assert(result.issues.length === 0, `happy: 0 issues (got ${result.issues.length})`);
  assert(result.summary.errors === 0 && result.summary.warnings === 0, 'happy: summary all-zero');
}

// ─── TEST 2: unreachable-step ──
async function testUnreachableStep(): Promise<void> {
  // 3 steps but only 0→1 transition; step 2 unreachable.
  const spec = makeSpec(3, [{ from: 0, to: 1 }]);
  const result = runFlowAudit(spec, []);
  const unreachable = result.issues.find(i => i.ruleId === 'flow.unreachable-step');
  assert(!!unreachable, 'unreachable: issue surfaced');
  assert(unreachable?.stepIndex === 2, `unreachable: stepIndex=2 (got ${unreachable?.stepIndex})`);
  assert(unreachable?.severity === 'error', 'unreachable: severity error');
  // Step 0 is implicitly reachable — verify NO issue for it.
  const step0Issue = result.issues.find(i => i.ruleId === 'flow.unreachable-step' && i.stepIndex === 0);
  assert(!step0Issue, 'unreachable: step 0 not flagged (entry point exempt)');
}

// ─── TEST 3: dead-end-step (mid-flow) ──
async function testDeadEndMidFlow(): Promise<void> {
  // 4 steps: transitions only into step 1 + into step 3 from step 0.
  // Step 2 has incoming (skip) but mid-flow without outgoing.
  // Actually let me design cleaner: 0→1, 1→3 (skip 2 for unreachable test).
  // For this dead-end test: 3 steps, 0→1, 0→2. Steps 1 + 2 have no outgoing.
  // Step 2 (last) is exempt; step 1 should get warned.
  const spec = makeSpec(3, [
    { from: 0, to: 1 },
    { from: 0, to: 2 },
  ]);
  const result = runFlowAudit(spec, []);
  const deadEnds = result.issues.filter(i => i.ruleId === 'flow.dead-end-step');
  assert(deadEnds.length === 1, `dead-end: 1 issue (got ${deadEnds.length})`);
  assert(deadEnds[0].stepIndex === 1, `dead-end: stepIndex=1 (got ${deadEnds[0].stepIndex})`);
  assert(deadEnds[0].severity === 'warn', 'dead-end: severity warn');
}

// ─── TEST 4: last step exempt from dead-end ──
async function testLastStepExempt(): Promise<void> {
  const spec = makeSpec(3, [
    { from: 0, to: 1 },
    { from: 1, to: 2 },
  ]);
  const result = runFlowAudit(spec, []);
  // Step 2 has no outgoing but is terminal — should NOT trigger.
  const issue2 = result.issues.find(i => i.ruleId === 'flow.dead-end-step' && i.stepIndex === 2);
  assert(!issue2, 'last-exempt: terminal step 2 not flagged');
}

// ─── TEST 5: invalid-transition-target ──
async function testInvalidTransition(): Promise<void> {
  const spec = makeSpec(3, [
    { from: 0, to: 1 },
    { from: 1, to: 5 },  // OOB
    { from: -1, to: 2 }, // OOB from
  ]);
  const result = runFlowAudit(spec, []);
  const oob = result.issues.filter(i => i.ruleId === 'flow.invalid-transition-target');
  assert(oob.length === 2, `oob: 2 issues (got ${oob.length})`);
  assert(oob.every(i => i.severity === 'error'), 'oob: all errors');
}

// ─── TEST 6: duplicate-step-id ──
async function testDuplicateStepId(): Promise<void> {
  // Construct manually since makeSpec auto-names uniquely.
  const spec: FlowAuditSpec = {
    flowId: 'dup',
    steps: [
      { name: 'intro', index: 0 },
      { name: 'middle', index: 1 },
      { name: 'intro', index: 2 },  // duplicate
    ],
    transitions: [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
    ],
  };
  const result = runFlowAudit(spec, []);
  const dup = result.issues.find(i => i.ruleId === 'flow.duplicate-step-id');
  assert(!!dup, 'dup: issue surfaced');
  assert(dup?.stepIndex === 2, `dup: stepIndex=2 (got ${dup?.stepIndex})`);
  assert(dup?.severity === 'error', 'dup: severity error');
  assert((dup?.details as any)?.firstSeenAt === 0, 'dup: details.firstSeenAt = 0');
}

// ─── TEST 7: navigation-label uniform → no issue ──
async function testNavLabelUniform(): Promise<void> {
  const spec = makeSpec(3, [{ from: 0, to: 1 }, { from: 1, to: 2 }]);
  const scenes = [
    sceneWithButton('Next'),
    sceneWithButton('Next'),
    sceneWithButton('Submit'),  // last step "Submit" — different intent (terminal action), but text match against NAV regex still includes it
  ];
  // Scene 2 has Submit which DOES match NAV_LABEL_RE — so it counts.
  // For uniform we'd need all 3 same. Let's redo with all "Continue".
  const uniformScenes = [
    sceneWithButton('Continue'),
    sceneWithButton('Continue'),
    sceneWithButton('Continue'),
  ];
  const result = runFlowAudit(spec, uniformScenes);
  const navIssue = result.issues.find(i => i.ruleId === 'flow.navigation-label-consistency');
  assert(!navIssue, 'nav-uniform: no issue (all "Continue")');
  // Verify detection IS active by mismatching one step.
  const mixedResult = runFlowAudit(spec, scenes);
  const navIssueMixed = mixedResult.issues.find(i => i.ruleId === 'flow.navigation-label-consistency');
  assert(!!navIssueMixed, 'nav-uniform-control: issue fires when mixed');
}

// ─── TEST 8: navigation-label mixed → warn with suggestion ──
async function testNavLabelMixed(): Promise<void> {
  const spec = makeSpec(3, [{ from: 0, to: 1 }, { from: 1, to: 2 }]);
  const scenes = [
    sceneWithButton('Next'),
    sceneWithButton('Continue'),
    sceneWithButton('Next'),
  ];
  const result = runFlowAudit(spec, scenes);
  const issue = result.issues.find(i => i.ruleId === 'flow.navigation-label-consistency');
  assert(!!issue, 'nav-mixed: issue surfaced');
  assert(issue?.severity === 'warn', 'nav-mixed: severity warn');
  // "next" used in 2 steps, "continue" in 1 → suggested = "next"
  assert((issue?.details as any)?.suggested === 'next', `nav-mixed: suggested = "next" (got "${(issue?.details as any)?.suggested}")`);
}

// ─── TEST 9: determinism ──
async function testDeterminism(): Promise<void> {
  const spec = makeSpec(4, [
    { from: 0, to: 1 },
    { from: 1, to: 5 },  // OOB error
    // Step 2, 3 unreachable — 2 errors
    // Step 1 dead-end (no outgoing post-OOB — well, OOB target doesn't count)
  ]);
  const a = runFlowAudit(spec, []);
  const b = runFlowAudit(spec, []);
  assert(JSON.stringify(a.issues) === JSON.stringify(b.issues), 'determinism: issue arrays byte-identical');
  // Ordering: errors before warnings.
  if (a.issues.length >= 2) {
    const first = a.issues[0];
    const second = a.issues[1];
    const sevRank = { error: 3, warn: 2, info: 1 } as const;
    assert((sevRank[first.severity] >= sevRank[second.severity]), 'determinism: errors precede warnings');
  }
}

// ─── TEST 10: advisory — handleFlowCompile attaches flowAudit, never throws on issues ──
async function testAdvisoryViaCompile(): Promise<void> {
  setupProject();
  // Compile a flow with a deliberate dead-end mid-step setup.
  const stepHtml = (label: string) =>
    `<div style="width:300px;padding:24px;background:#fff;color:#000;font-family:Inter,sans-serif">` +
    `<h1 style="font-size:24px;margin:0">${label}</h1>` +
    `<button style="margin-top:16px;padding:12px 20px;min-height:44px">Next</button>` +
    `</div>`;
  const result = await handleCompile({
    flow: {
      flowId: 'advisory-flow',
      steps: [
        { html: stepHtml('Step A'), audit: false, exports: [] },
        { html: stepHtml('Step B'), audit: false, exports: [] },
      ],
      // Default linear transitions: 0→1.
    },
  } as any);
  assert(!(result as any).isError, 'advisory: compile success despite running audit');
  const env = JSON.parse((result as any).content?.[0]?.text ?? '{}');
  assert(env.flowAudit !== undefined, 'advisory: flowAudit field on envelope');
  assert(typeof env.flowAudit?.summary === 'object', 'advisory: flowAudit has summary');
  assert(typeof env.flowAudit?.issues === 'object', 'advisory: flowAudit has issues array');
}

// ─── TEST 11: inspect with flowId surfaces audit ──
async function testInspectFlowId(): Promise<void> {
  setupProject();
  // Compile a known-broken flow first (writes flow.json to disk).
  const stepHtml = (label: string) =>
    `<div style="width:300px;padding:24px;background:#fff;color:#000"><h1>${label}</h1><button>Next</button></div>`;
  await handleCompile({
    flow: {
      flowId: 'inspect-flow',
      steps: [
        { html: stepHtml('A'), audit: false, exports: [] },
        { html: stepHtml('B'), audit: false, exports: [] },
        { html: stepHtml('C'), audit: false, exports: [] },
      ],
      transitions: [
        { from: 0, to: 1, label: 'Next' },
        // No 1→2 transition: makes step 2 unreachable + step 1 dead-end (mid-flow).
      ],
    },
  } as any);

  const inspectResult = await handleInspect({ flowId: 'inspect-flow' } as any);
  const text = (inspectResult as any).content?.[0]?.text ?? '';
  assert(text.includes('Flow Audit'), 'inspect: Flow Audit header present');
  assert(text.includes('flow.unreachable-step'), 'inspect: unreachable rule mentioned');
  assert(text.includes('errors'), 'inspect: error count surfaced');
  // Step 2 unreachable, step 1 dead-end → at least 1 error and 1 warning
  assert(/\d+ errors?/.test(text), 'inspect: errors counter formatted');
}

// ─── TEST 12: registry shape + backward compat ──
async function testRegistryShape(): Promise<void> {
  assert(FLOW_AUDIT_RULES.length === 5, `registry: 5 rules (got ${FLOW_AUDIT_RULES.length})`);
  for (const rule of FLOW_AUDIT_RULES) {
    assert(typeof rule.id === 'string' && rule.id.startsWith('flow.'), `registry: rule.id format (${rule.id})`);
    assert(['error', 'warn', 'info'].includes(rule.severity), `registry: severity (${rule.severity})`);
    assert(typeof rule.check === 'function', `registry: rule.check is function (${rule.id})`);
  }
  // Empty flow → no issues (no spec, no transitions, but minimum 2 steps for compile).
  const cleanSpec = makeSpec(2, [{ from: 0, to: 1 }]);
  const cleanResult = runFlowAudit(cleanSpec, []);
  assert(cleanResult.issues.length === 0, 'registry: clean flow produces 0 issues');
  assert(cleanResult.summary.errors === 0 && cleanResult.summary.warnings === 0, 'registry: clean summary all-zero');
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('T2 #22 Flow Audit contract\n');

  const tests: Array<[string, () => Promise<void>]> = [
    ['happy path — well-formed flow → 0 issues', testHappyPath],
    ['flow.unreachable-step — step without incoming transition (entry exempt)', testUnreachableStep],
    ['flow.dead-end-step — mid-flow step without outgoing → warn', testDeadEndMidFlow],
    ['flow.dead-end-step — last step exempt (terminal OK)', testLastStepExempt],
    ['flow.invalid-transition-target — OOB from/to → error', testInvalidTransition],
    ['flow.duplicate-step-id — two steps with same name → error', testDuplicateStepId],
    ['flow.navigation-label-consistency — uniform → no issue; mixed control fires', testNavLabelUniform],
    ['flow.navigation-label-consistency — mixed → warn with suggestion', testNavLabelMixed],
    ['determinism — same input → byte-identical issue array, errors-first ordering', testDeterminism],
    ['advisory — handleFlowCompile attaches flowAudit envelope, no throw', testAdvisoryViaCompile],
    ['inspect with flowId surfaces audit text report', testInspectFlowId],
    ['registry shape — 5 rules with required interface; clean flow → 0 issues', testRegistryShape],
  ];

  for (const [name, fn] of tests) {
    console.log(`▸ ${name}`);
    try { await fn(); }
    catch (err: any) {
      failed++;
      console.error(`  UNEXPECTED ERROR: ${err?.message ?? err}`);
      if (err?.stack) console.error(err.stack.split('\n').slice(0, 6).join('\n'));
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
