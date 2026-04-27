/**
 * Week 3 #25 Sampler — compile/store/persistence contract.
 *
 * 10 tests:
 *   1. happy path — 6-cell sampler, response envelope, sampler.json on disk
 *   2. too_few_cells throws (< 4)
 *   3. brand_mismatch throws
 *   4. duplicate_name throws on resolved namespaced names
 *   5. custom_designmd_unsupported throws
 *   6. invalid_grid throws (columns: 0)
 *   7. invalid_grid throws (rows × columns < cells.length)
 *   8. input_mode_conflict throws (sampler + html)
 *   9. invalid_id throws (regex fail) + reserved_id throws
 *  10. cross-sampler determinism — distinct cellSceneIds per sampler
 *
 * Run: npx tsx packages/mcp/src/tests/week3-sampler-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleCompile } from '../tools/compile.js';
import { setProjectDir } from '../store.js';
import { initProject } from '../../../core/src/project/io.js';
import { readSamplerSpec } from '../../../core/src/project/sampler-store.js';

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

function extractEnvelope(result: any): any {
  const txt = result?.content?.[0]?.text ?? '';
  try { return JSON.parse(txt); } catch { return null; }
}

let projectDir: string;
function setupProject(): void {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-sampler-test-'));
  initProject(projectDir, 'sampler-test');
  setProjectDir(projectDir);
}

const cellHtml = (label: string) =>
  '<div style="width:400px;padding:32px;background:#fff;color:#000;font-family:Inter,sans-serif">' +
    `<h1 style="font-size:32px;margin:0">${label}</h1>` +
    '<p style="margin-top:16px">Body</p>' +
    '<button style="margin-top:24px;padding:12px 20px;min-height:44px">Action</button>' +
  '</div>';

function makeCell(name: string, brand?: string) {
  return { html: cellHtml(name), name, brand, audit: false, exports: [] as string[] };
}

// ─── TEST 1: happy path ──
async function testHappyPath(): Promise<void> {
  setupProject();
  const samplerId = 'happy-sampler';
  const result = await handleCompile({
    sampler: {
      samplerId,
      name: 'Happy',
      cells: [
        { html: cellHtml('A'), audit: false, exports: [] },
        { html: cellHtml('B'), audit: false, exports: [] },
        { html: cellHtml('C'), audit: false, exports: [] },
        { html: cellHtml('D'), audit: false, exports: [] },
        { html: cellHtml('E'), audit: false, exports: [] },
        { html: cellHtml('F'), audit: false, exports: [] },
      ],
      grid: { columns: 3, rows: 2, gap: 16 },
    },
  } as any);
  assert(!(result as any).isError, 'happy: not isError');
  const env = extractEnvelope(result);
  assert(env?.kind === 'sampler', `happy: kind=sampler (got ${env?.kind})`);
  assert(env?.samplerId === samplerId, 'happy: samplerId roundtrips');
  assert(env?.cellCount === 6, `happy: cellCount=6 (got ${env?.cellCount})`);
  assert(env?.cellSceneIds?.length === 6, 'happy: cellSceneIds length 6');
  assert(env?.cellSceneIds[0] === `${samplerId}-cell-0`, `happy: cell 0 namespaced (got ${env?.cellSceneIds[0]})`);
  assert(env?.cellSceneIds[5] === `${samplerId}-cell-5`, 'happy: cell 5 namespaced');

  const spec = readSamplerSpec(projectDir, samplerId);
  assert(spec !== null, 'happy: sampler.json on disk');
  assert(spec?.cellSceneIds.length === 6, 'happy: spec carries 6 cellSceneIds');
  assert(spec?.grid.columns === 3, 'happy: spec.grid.columns = 3');
}

// ─── TEST 2: too_few_cells ──
async function testTooFewCells(): Promise<void> {
  setupProject();
  const result = await handleCompile({
    sampler: {
      samplerId: 'too-few',
      cells: [
        { html: cellHtml('A'), audit: false, exports: [] },
        { html: cellHtml('B'), audit: false, exports: [] },
        { html: cellHtml('C'), audit: false, exports: [] },
      ],
      grid: { columns: 3 },
    },
  } as any);
  const err = extractError(result);
  assert(err?.code === 'compile.sampler.too_few_cells', `too_few: code = ${err?.code}`);
}

// ─── TEST 3: brand_mismatch ──
async function testBrandMismatch(): Promise<void> {
  setupProject();
  const result = await handleCompile({
    sampler: {
      samplerId: 'brand-mismatch',
      cells: [
        makeCell('A', 'stripe'),
        makeCell('B', 'stripe'),
        makeCell('C', 'linear'), // mismatch
        makeCell('D', 'stripe'),
      ],
      grid: { columns: 2 },
    },
  } as any);
  const err = extractError(result);
  assert(err?.code === 'compile.sampler.brand_mismatch', `brand_mismatch: code = ${err?.code}`);
}

// ─── TEST 4: duplicate_name on resolved namespaced names ──
async function testDuplicateName(): Promise<void> {
  setupProject();
  const samplerId = 'dup-sampler';
  // cells[0] auto-fills to "dup-sampler-cell-0"
  // cells[1] explicit name same as auto-fill
  const result = await handleCompile({
    sampler: {
      samplerId,
      cells: [
        { html: cellHtml('A'), audit: false, exports: [] },
        { html: cellHtml('B'), name: `${samplerId}-cell-0`, audit: false, exports: [] },
        { html: cellHtml('C'), audit: false, exports: [] },
        { html: cellHtml('D'), audit: false, exports: [] },
      ],
      grid: { columns: 2 },
    },
  } as any);
  const err = extractError(result);
  assert(err?.code === 'compile.sampler.duplicate_name', `duplicate_name: code = ${err?.code}`);
}

// ─── TEST 5: custom_designmd_unsupported ──
async function testCustomDesignMd(): Promise<void> {
  setupProject();
  const result = await handleCompile({
    sampler: {
      samplerId: 'custom-md',
      cells: [
        { html: cellHtml('A'), audit: false, exports: [] },
        { html: cellHtml('B'), audit: false, exports: [], designMd: '# Brand\n' }, // explicit
        { html: cellHtml('C'), audit: false, exports: [] },
        { html: cellHtml('D'), audit: false, exports: [] },
      ],
      grid: { columns: 2 },
    },
  } as any);
  const err = extractError(result);
  assert(err?.code === 'compile.sampler.custom_designmd_unsupported', `custom_designmd: code = ${err?.code}`);
}

// ─── TEST 6: invalid_grid (columns < 1) ──
async function testInvalidGridColumns(): Promise<void> {
  setupProject();
  const result = await handleCompile({
    sampler: {
      samplerId: 'invalid-cols',
      cells: [
        { html: cellHtml('A'), audit: false, exports: [] },
        { html: cellHtml('B'), audit: false, exports: [] },
        { html: cellHtml('C'), audit: false, exports: [] },
        { html: cellHtml('D'), audit: false, exports: [] },
      ],
      grid: { columns: 0 },
    },
  } as any);
  const err = extractError(result);
  assert(err?.code === 'compile.sampler.invalid_grid', `invalid_grid (cols): code = ${err?.code}`);
}

// ─── TEST 7: invalid_grid (rows × columns < cells.length) ──
async function testInvalidGridShape(): Promise<void> {
  setupProject();
  const result = await handleCompile({
    sampler: {
      samplerId: 'invalid-shape',
      cells: [
        { html: cellHtml('A'), audit: false, exports: [] },
        { html: cellHtml('B'), audit: false, exports: [] },
        { html: cellHtml('C'), audit: false, exports: [] },
        { html: cellHtml('D'), audit: false, exports: [] },
        { html: cellHtml('E'), audit: false, exports: [] },
      ],
      grid: { columns: 2, rows: 2 }, // 2×2 = 4 < 5 cells
    },
  } as any);
  const err = extractError(result);
  assert(err?.code === 'compile.sampler.invalid_grid', `invalid_grid (shape): code = ${err?.code}`);
}

// ─── TEST 8: input_mode_conflict (sampler + html) ──
async function testInputModeConflict(): Promise<void> {
  setupProject();
  const result = await handleCompile({
    html: '<div style="width:200px">x</div>',
    sampler: {
      samplerId: 'conflict',
      cells: [
        { html: cellHtml('A'), audit: false, exports: [] },
        { html: cellHtml('B'), audit: false, exports: [] },
        { html: cellHtml('C'), audit: false, exports: [] },
        { html: cellHtml('D'), audit: false, exports: [] },
      ],
      grid: { columns: 2 },
    },
  } as any);
  const err = extractError(result);
  assert(err?.code === 'compile.input_mode_conflict', `input_mode_conflict: code = ${err?.code}`);
}

// ─── TEST 9: invalid_id (regex) + reserved_id ──
async function testInvalidAndReservedId(): Promise<void> {
  setupProject();
  const fourCells = [
    { html: cellHtml('A'), audit: false, exports: [] as string[] },
    { html: cellHtml('B'), audit: false, exports: [] as string[] },
    { html: cellHtml('C'), audit: false, exports: [] as string[] },
    { html: cellHtml('D'), audit: false, exports: [] as string[] },
  ];

  // Bad chars (underscore is excluded by regex)
  const r1 = await handleCompile({
    sampler: { samplerId: 'bad_id', cells: fourCells, grid: { columns: 2 } },
  } as any);
  const e1 = extractError(r1);
  assert(e1?.code === 'compile.sampler.invalid_id', `invalid_id (underscore): code = ${e1?.code}`);

  const r2 = await handleCompile({
    sampler: { samplerId: 'foo bar', cells: fourCells, grid: { columns: 2 } },
  } as any);
  const e2 = extractError(r2);
  assert(e2?.code === 'compile.sampler.invalid_id', `invalid_id (space): code = ${e2?.code}`);

  // Reserved: ends with -cell
  const r3 = await handleCompile({
    sampler: { samplerId: 'foo-cell', cells: fourCells, grid: { columns: 2 } },
  } as any);
  const e3 = extractError(r3);
  assert(e3?.code === 'compile.sampler.reserved_id', `reserved_id (-cell suffix): code = ${e3?.code}`);

  // Reserved: cell-N pattern
  const r4 = await handleCompile({
    sampler: { samplerId: 'cell-7', cells: fourCells, grid: { columns: 2 } },
  } as any);
  const e4 = extractError(r4);
  assert(e4?.code === 'compile.sampler.reserved_id', `reserved_id (cell-7): code = ${e4?.code}`);
}

// ─── TEST 10: cross-sampler determinism ──
async function testCrossSamplerDeterminism(): Promise<void> {
  setupProject();
  const cells = [
    { html: cellHtml('A'), audit: false, exports: [] as string[] },
    { html: cellHtml('B'), audit: false, exports: [] as string[] },
    { html: cellHtml('C'), audit: false, exports: [] as string[] },
    { html: cellHtml('D'), audit: false, exports: [] as string[] },
  ];

  const rA = await handleCompile({
    sampler: { samplerId: 'sampler-a', cells, grid: { columns: 2 } },
  } as any);
  const rB = await handleCompile({
    sampler: { samplerId: 'sampler-b', cells, grid: { columns: 2 } },
  } as any);

  const envA = extractEnvelope(rA);
  const envB = extractEnvelope(rB);
  assert(envA?.cellSceneIds?.length === 4, `cross-sampler A: 4 cells (got ${envA?.cellSceneIds?.length})`);
  assert(envB?.cellSceneIds?.length === 4, `cross-sampler B: 4 cells (got ${envB?.cellSceneIds?.length})`);

  // All 4 + 4 distinct, no counter suffixes appended.
  const all = [...envA.cellSceneIds, ...envB.cellSceneIds];
  const distinct = new Set(all);
  assert(distinct.size === 8, `cross-sampler: 8 distinct cellSceneIds (got ${distinct.size}: ${all.join(',')})`);
  for (const id of envA.cellSceneIds) {
    assert(id.startsWith('sampler-a-cell-'), `cross-sampler A: id "${id}" namespaced`);
    assert(!/-cell-\d+-\d+$/.test(id), `cross-sampler A: id "${id}" has no counter suffix`);
  }
  for (const id of envB.cellSceneIds) {
    assert(id.startsWith('sampler-b-cell-'), `cross-sampler B: id "${id}" namespaced`);
    assert(!/-cell-\d+-\d+$/.test(id), `cross-sampler B: id "${id}" has no counter suffix`);
  }

  // Re-compile sampler-a — same spec, same slugs (no drift).
  const rA2 = await handleCompile({
    sampler: { samplerId: 'sampler-a', cells, grid: { columns: 2 } },
  } as any);
  const envA2 = extractEnvelope(rA2);
  assert(JSON.stringify(envA2.cellSceneIds) === JSON.stringify(envA.cellSceneIds), 'cross-sampler: re-compile of same spec yields identical cellSceneIds');
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Week 3 #25 Sampler contract\n');

  const tests: Array<[string, () => Promise<void>]> = [
    ['happy path — 6-cell sampler + sampler.json on disk', testHappyPath],
    ['too_few_cells throws (< 4)', testTooFewCells],
    ['brand_mismatch throws', testBrandMismatch],
    ['duplicate_name throws on resolved namespaced names', testDuplicateName],
    ['custom_designmd_unsupported throws', testCustomDesignMd],
    ['invalid_grid (columns: 0) throws', testInvalidGridColumns],
    ['invalid_grid (rows × columns < cells.length) throws', testInvalidGridShape],
    ['input_mode_conflict (sampler + html) throws', testInputModeConflict],
    ['invalid_id (regex) + reserved_id throws', testInvalidAndReservedId],
    ['cross-sampler determinism — distinct cellSceneIds, no counter suffixes', testCrossSamplerDeterminism],
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
