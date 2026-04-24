/**
 * Phase 0 exit test — variants-compile handler contracts + breakGrid
 * composition guard in reframe_edit.
 *
 * Covers both surfaces that ship wired in Phase 0:
 *   - packages/mcp/src/tools/compile.ts::handleVariantsCompile (backend
 *     composition compile, MCP/CLI-accessible). UI pilot is parked —
 *     see composition-renderer.ts header for activation triggers.
 *   - packages/mcp/src/tools/edit.ts::handleEdit composition guard
 *     (refuses ops carrying compositionId).
 *
 * These contracts must hold regardless of UI surface existing today.
 * Future consumers (site-loop, critic multi-scene, sampler) will reuse
 * handleVariantsCompile through the MCP tool surface; the throw paths
 * are the promise that silent-overwrite bugs (the #26 class we spent
 * the planning phase cutting) can't reach them.
 *
 * Run: npx tsx packages/mcp/src/tests/phase0-variants-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import { handleCompile } from '../tools/compile.js';
import { handleEdit } from '../tools/edit.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

// ─── Helpers ────────────────────────────────────────────────

/** Tool response has isError + content[1] carries the JSON payload. */
function extractError(result: any): { code?: string; message?: string; details?: any } | null {
  if (!result?.isError) return null;
  const jsonText = result.content?.[1]?.text;
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText);
    if (parsed.kind === 'reframe.toolError') {
      return { code: parsed.code, message: parsed.message, details: parsed.details };
    }
  } catch { /* not a structured error */ }
  return null;
}

const minimalHtml = '<div style="width:200px;height:100px;background:#fff;color:#000">Hi</div>';
const minimalDesignMd = [
  '# Test Brand',
  '',
  '## Colors',
  'Primary: #2b74ff',
  'Background: #ffffff',
  'Text: #111111',
  '',
  '## Typography',
  'Body: Inter 14 400',
].join('\n');

// ─── TEST 1: input mode conflict ────────────────────────────
//
// { html: '...', variants: { scenes: [...] } } — caller sent both
// single-scene input AND variants composition. Silent drop of html
// would be a bug; we throw explicitly.
async function testInputModeConflict(): Promise<void> {
  const result = await handleCompile({
    html: minimalHtml,
    variants: {
      scenes: [
        { html: minimalHtml, name: 'a' },
        { html: minimalHtml, name: 'b' },
      ],
    },
  } as any);
  const err = extractError(result);
  assert(err !== null, 'input mode conflict: result should be isError');
  assert(err?.code === 'compile.input_mode_conflict', `input mode conflict: code was ${err?.code}`);
  assert(
    Array.isArray(err?.details?.conflictingFields) && err!.details.conflictingFields.includes('html'),
    'input mode conflict: details.conflictingFields should list "html"',
  );
}

// ─── TEST 2: brand mismatch ─────────────────────────────────
//
// All variants must share a brand (Phase 0 constraint). Mismatched
// strings OR mixed presence (some have brand, some don't) throws.
async function testBrandMismatch(): Promise<void> {
  const result = await handleCompile({
    variants: {
      scenes: [
        { html: minimalHtml, name: 'a', brand: 'stripe' },
        { html: minimalHtml, name: 'b', brand: 'linear' },
      ],
    },
  } as any);
  const err = extractError(result);
  assert(err !== null, 'brand mismatch: result should be isError');
  assert(err?.code === 'compile.variants.brand_mismatch', `brand mismatch: code was ${err?.code}`);
  assert(
    Array.isArray(err?.details?.brands) && err!.details.brands.length === 2,
    'brand mismatch: details.brands should be array of length 2',
  );
}

// ─── TEST 3: duplicate name (resolved) ──────────────────────
//
// Duplicates on resolved names — either explicit (both scenes pass the
// same name) OR implicit (one scene explicit matches another's auto-fill).
async function testDuplicateNameExplicit(): Promise<void> {
  const result = await handleCompile({
    variants: {
      scenes: [
        { html: minimalHtml, name: 'hero' },
        { html: minimalHtml, name: 'hero' },
      ],
    },
  } as any);
  const err = extractError(result);
  assert(err !== null, 'duplicate explicit: result should be isError');
  assert(err?.code === 'compile.variants.duplicate_name', `duplicate explicit: code was ${err?.code}`);
}

async function testDuplicateNameImplicit(): Promise<void> {
  // scene[0] explicit name 'variant-1' collides with scene[1] auto-fill
  // at index 1 → 'variant-1'. Guard must catch this.
  const result = await handleCompile({
    variants: {
      scenes: [
        { html: minimalHtml, name: 'variant-1' },
        { html: minimalHtml },
      ],
    },
  } as any);
  const err = extractError(result);
  assert(err !== null, 'duplicate implicit: result should be isError');
  assert(err?.code === 'compile.variants.duplicate_name', `duplicate implicit: code was ${err?.code}`);
}

// ─── TEST 4: custom per-scene designMd ──────────────────────
//
// Phase 0 = shared brand AND shared designMd. Per-scene designMd override
// = future signal; throw for now instead of silent divergence.
async function testCustomDesignMd(): Promise<void> {
  const result = await handleCompile({
    variants: {
      scenes: [
        { html: minimalHtml, name: 'a' },
        { html: minimalHtml, name: 'b', designMd: minimalDesignMd },
      ],
    },
  } as any);
  const err = extractError(result);
  assert(err !== null, 'custom designMd: result should be isError');
  assert(
    err?.code === 'compile.variants.custom_designmd_unsupported',
    `custom designMd: code was ${err?.code}`,
  );
  assert(err?.details?.sceneIndex === 1, 'custom designMd: details.sceneIndex should be 1');
}

// ─── TEST 5: min count ──────────────────────────────────────
//
// scenes.length < 2 → throw. Zod also enforces via min(2), but handler
// has a defensive check for non-validated call paths (tests, internal).
async function testMinCount(): Promise<void> {
  const result = await handleCompile({
    variants: {
      scenes: [{ html: minimalHtml, name: 'only-one' }],
    },
  } as any);
  const err = extractError(result);
  assert(err !== null, 'min count: result should be isError');
  assert(err?.code === 'compile.variants.too_few', `min count: code was ${err?.code}`);
}

// ─── TEST 6: happy path envelope ────────────────────────────
//
// Two same-brand (via shared html, no brand field) scenes compile
// successfully. Response envelope shape: {kind:'variants', sharedBrand,
// scenes:[{index,name,result}]}. Each result is the full single-compile
// MCP envelope (intentional — see compile.ts comment).
async function testHappyPathEnvelope(): Promise<void> {
  const result = await handleCompile({
    variants: {
      scenes: [
        { html: minimalHtml, name: 'happy-a', audit: false, exports: ['html'] },
        { html: minimalHtml, name: 'happy-b', audit: false, exports: ['html'] },
      ],
    },
  } as any);
  // Not an error.
  assert(!(result as any).isError, 'happy path: result should NOT be isError');
  const text = (result as any).content?.[0]?.text;
  assert(typeof text === 'string' && text.length > 0, 'happy path: content[0].text should be string');
  let parsed: any;
  try { parsed = JSON.parse(text); }
  catch { assert(false, 'happy path: content[0].text should be JSON-parseable'); return; }
  assert(parsed?.kind === 'variants', `happy path: envelope kind was ${parsed?.kind}`);
  assert(parsed?.sharedBrand === null, `happy path: sharedBrand should be null (no brand passed)`);
  assert(Array.isArray(parsed?.scenes) && parsed.scenes.length === 2, 'happy path: scenes should be length 2');
  assert(parsed?.scenes?.[0]?.index === 0 && parsed?.scenes?.[0]?.name === 'happy-a', 'happy path: scenes[0]');
  assert(parsed?.scenes?.[1]?.index === 1 && parsed?.scenes?.[1]?.name === 'happy-b', 'happy path: scenes[1]');
  // Each result should be a full MCP envelope (content array) — intentional double-wrap.
  assert(
    Array.isArray(parsed?.scenes?.[0]?.result?.content),
    'happy path: scenes[0].result.content should be array (preserves full single-compile response)',
  );
}

// ─── TEST 7: breakGrid contract — compositionId throws ──────
//
// Phase 0 contract: edit ops target one scene via sceneId. Any op
// carrying compositionId throws — future composition-level macros
// need a dedicated op kind (compositionMacro), not silent per-scene
// application.
async function testEditCompositionIdThrows(): Promise<void> {
  const result = await handleEdit({
    operations: [
      {
        op: 'scaleSpacing',
        compositionId: 'some-composition',
        factor: 1.2,
      },
    ],
  } as any);
  const err = extractError(result);
  assert(err !== null, 'breakGrid contract: result should be isError');
  assert(
    err?.code === 'edit.composition_target_unsupported',
    `breakGrid contract: code was ${err?.code}`,
  );
  assert(err?.details?.op === 'scaleSpacing', 'breakGrid contract: details.op echoes the op name');
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Phase 0 variants-compile + edit composition-guard contracts\n');

  const tests: Array<[string, () => Promise<void>]> = [
    ['input mode conflict', testInputModeConflict],
    ['brand mismatch', testBrandMismatch],
    ['duplicate name (explicit)', testDuplicateNameExplicit],
    ['duplicate name (implicit auto-fill collision)', testDuplicateNameImplicit],
    ['custom per-scene designMd', testCustomDesignMd],
    ['min count', testMinCount],
    ['happy path envelope', testHappyPathEnvelope],
    ['edit op compositionId throws', testEditCompositionIdThrows],
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
