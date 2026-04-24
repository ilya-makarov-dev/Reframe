/**
 * Week 2 Flow compile + spec/state persistence contracts.
 *
 * Mirrors week 1 variants-contract coverage:
 *   - input-mode-conflict, missing-id, too-few-steps
 *   - brand-mismatch, custom-designMd, duplicate-name throws
 *   - happy path: response envelope + flow.json + state.json on disk
 *
 * Run: npx tsx packages/mcp/src/tests/week2-flow-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'fs';
import * as path from 'path';
import { handleCompile } from '../tools/compile.js';
import { getWorkspaceRoot } from '../store.js';
import {
  flowSpecPath,
  flowStatePath,
  readFlowSpec,
  readFlowState,
  deleteFlow,
} from '../../../core/src/project/flow-store.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

function extractError(result: any): { code?: string; message?: string; details?: any } | null {
  if (!result?.isError) return null;
  const jsonText = result.content?.[1]?.text;
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText);
    if (parsed.kind === 'reframe.toolError') {
      return { code: parsed.code, message: parsed.message, details: parsed.details };
    }
  } catch { /* not structured */ }
  return null;
}

const minimalHtml = (label: string) =>
  `<div style="width:200px;height:100px;background:#fff;color:#000">${label}</div>`;

// ─── TEST 1: missing flowId ────────────────────────────────
async function testMissingId(): Promise<void> {
  const result = await handleCompile({
    flow: {
      flowId: '',
      steps: [
        { html: minimalHtml('a'), name: 'a', audit: false },
        { html: minimalHtml('b'), name: 'b', audit: false },
      ],
    },
  } as any);
  const err = extractError(result);
  assert(err !== null, 'missing flowId: result should be isError');
  assert(err?.code === 'compile.flow.missing_id', `missing flowId: code was ${err?.code}`);
}

// ─── TEST 2: too few steps ─────────────────────────────────
async function testTooFewSteps(): Promise<void> {
  const result = await handleCompile({
    flow: {
      flowId: 'contract-too-few',
      steps: [{ html: minimalHtml('only'), name: 'only', audit: false }],
    },
  } as any);
  const err = extractError(result);
  assert(err !== null, 'too few: result should be isError');
  assert(err?.code === 'compile.flow.too_few_steps', `too few: code was ${err?.code}`);
}

// ─── TEST 3: brand mismatch ────────────────────────────────
async function testBrandMismatch(): Promise<void> {
  const result = await handleCompile({
    flow: {
      flowId: 'contract-brand-mismatch',
      steps: [
        { html: minimalHtml('a'), name: 'a', brand: 'stripe', audit: false },
        { html: minimalHtml('b'), name: 'b', brand: 'linear', audit: false },
      ],
    },
  } as any);
  const err = extractError(result);
  assert(err !== null, 'brand mismatch: result should be isError');
  assert(err?.code === 'compile.flow.brand_mismatch', `brand mismatch: code was ${err?.code}`);
}

// ─── TEST 4: custom per-step designMd ──────────────────────
async function testCustomDesignMd(): Promise<void> {
  const result = await handleCompile({
    flow: {
      flowId: 'contract-custom-dmd',
      steps: [
        { html: minimalHtml('a'), name: 'a', audit: false },
        { html: minimalHtml('b'), name: 'b', designMd: '# Custom', audit: false },
      ],
    },
  } as any);
  const err = extractError(result);
  assert(err !== null, 'custom designMd: result should be isError');
  assert(err?.code === 'compile.flow.custom_designmd_unsupported', `custom designMd: code was ${err?.code}`);
}

// ─── TEST 5: duplicate name ────────────────────────────────
async function testDuplicateName(): Promise<void> {
  const result = await handleCompile({
    flow: {
      flowId: 'contract-dup',
      steps: [
        { html: minimalHtml('a'), name: 'step', audit: false },
        { html: minimalHtml('b'), name: 'step', audit: false },
      ],
    },
  } as any);
  const err = extractError(result);
  assert(err !== null, 'dup name: result should be isError');
  assert(err?.code === 'compile.flow.duplicate_name', `dup name: code was ${err?.code}`);
}

// ─── TEST 6: input mode conflict ───────────────────────────
async function testInputModeConflict(): Promise<void> {
  const result = await handleCompile({
    html: minimalHtml('outer'),
    flow: {
      flowId: 'contract-conflict',
      steps: [
        { html: minimalHtml('a'), name: 'a', audit: false },
        { html: minimalHtml('b'), name: 'b', audit: false },
      ],
    },
  } as any);
  const err = extractError(result);
  assert(err !== null, 'input mode conflict: result should be isError');
  assert(err?.code === 'compile.input_mode_conflict', `input mode conflict: code was ${err?.code}`);
}

// ─── TEST 7: happy path — envelope + disk ─────────────────
async function testHappyPath(): Promise<void> {
  const flowId = 'contract-happy-flow';
  const projectDir = getWorkspaceRoot();

  // Clean any leftover from prior runs so disk assertions are meaningful.
  deleteFlow(projectDir, flowId);

  const result = await handleCompile({
    flow: {
      flowId,
      name: 'Happy Test Flow',
      steps: [
        { html: minimalHtml('step-a'), name: 'happy-a', audit: false, exports: ['html'] },
        { html: minimalHtml('step-b'), name: 'happy-b', audit: false, exports: ['html'] },
        { html: minimalHtml('step-c'), name: 'happy-c', audit: false, exports: ['html'] },
      ],
    },
  } as any);

  assert(!(result as any).isError, 'happy: result should NOT be isError');
  const text = (result as any).content?.[0]?.text;
  let parsed: any;
  try { parsed = JSON.parse(text); }
  catch { assert(false, 'happy: content[0].text should parse as JSON'); return; }

  assert(parsed?.kind === 'flow', `happy: envelope kind was ${parsed?.kind}`);
  assert(parsed?.flowId === flowId, `happy: flowId roundtrips`);
  assert(parsed?.name === 'Happy Test Flow', `happy: name roundtrips`);
  assert(
    Array.isArray(parsed?.stepSceneIds) && parsed.stepSceneIds.length === 3,
    `happy: stepSceneIds length=${parsed?.stepSceneIds?.length ?? 0}`,
  );
  assert(
    Array.isArray(parsed?.transitions) && parsed.transitions.length === 2,
    `happy: auto-linear transitions length=${parsed?.transitions?.length ?? 0} (expected 2 for 3 steps)`,
  );
  assert(
    parsed?.transitions?.[0]?.from === 0 && parsed?.transitions?.[0]?.to === 1 && parsed?.transitions?.[0]?.label === 'Next',
    'happy: first transition 0→1 with Next label',
  );

  // Disk: flow.json + state.json written to .reframe/flows/<flowId>/
  assert(fs.existsSync(flowSpecPath(projectDir, flowId)), 'happy: flow.json exists on disk');
  assert(fs.existsSync(flowStatePath(projectDir, flowId)), 'happy: state.json exists on disk');

  const spec = readFlowSpec(projectDir, flowId);
  assert(spec?.stepSceneIds?.length === 3, 'happy: disk spec stepSceneIds length 3');
  assert(spec?.transitions?.length === 2, 'happy: disk spec transitions length 2');

  const state = readFlowState(projectDir, flowId);
  assert(state.currentStep === 0, 'happy: initial state currentStep = 0');
  assert(Array.isArray(state.visitedSteps) && state.visitedSteps.includes(0), 'happy: initial visited includes 0');
  assert(typeof state.updatedAt === 'string' && state.updatedAt.length > 0, 'happy: updatedAt populated');

  // Cleanup so repeated runs stay clean.
  deleteFlow(projectDir, flowId);
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Week 2 flow-compile contract\n');

  const tests: Array<[string, () => Promise<void>]> = [
    ['missing flowId', testMissingId],
    ['too few steps', testTooFewSteps],
    ['brand mismatch', testBrandMismatch],
    ['custom per-step designMd', testCustomDesignMd],
    ['duplicate step name', testDuplicateName],
    ['input mode conflict (flow + html)', testInputModeConflict],
    ['happy path — envelope + disk spec + disk state', testHappyPath],
  ];

  for (const [name, fn] of tests) {
    console.log(`▸ ${name}`);
    try { await fn(); }
    catch (err: any) {
      failed++;
      console.error(`  UNEXPECTED ERROR: ${err?.message ?? err}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
