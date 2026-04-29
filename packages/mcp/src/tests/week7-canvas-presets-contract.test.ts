/**
 * T3 #31 Constrained-canvas presets — resolver / compile / persistence
 * / inspect contract.
 *
 * Tests:
 *   1. resolveCanvas: 'icon' → 200×200 with preset='icon'
 *   2. resolveCanvas: 'social-square' → 1080×1080
 *   3. resolveCanvas: '320x240' → 320×240 with preset undefined
 *   4. resolveCanvas: '320×240' (real ×) — accepted same as 320x240
 *   5. resolveCanvas: 'bogus' → throws unknown_preset
 *   6. resolveCanvas: '10x10' → throws dimensions_out_of_range (< 50)
 *   7. resolveCanvas: '5000x5000' → throws dimensions_out_of_range (> 4096)
 *   8. All 9 named presets resolve to non-null dimensions in [50, 4096]
 *   9. compile with canvas='icon' → scene.canvas = { width:200, height:200, preset:'icon' }
 *  10. compile without canvas option → scene.canvas null/undefined (backward compat)
 *  11. compile with bad preset → tool error envelope code = compile.canvas.unknown_preset
 *  12. determinism — same canvas option → identical scene.canvas across two compiles
 *  13. inspect surfaces canvas line when canvas set; omits when absent
 *
 * Run: npx tsx packages/mcp/src/tests/week7-canvas-presets-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  resolveCanvas,
  CANVAS_PRESETS,
  KNOWN_CANVAS_PRESETS,
  CANVAS_MIN_DIM,
  CANVAS_MAX_DIM,
  CanvasResolveError,
} from '../../../core/src/engine/canvas-presets.js';
import { handleCompile } from '../tools/compile.js';
import { handleInspect } from '../tools/inspect.js';
import { setProjectDir, getScene, getSessionId } from '../store.js';
import { initProject } from '../../../core/src/project/io.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

let projectDir: string;
function setupProject(): void {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-canvas-test-'));
  initProject(projectDir, 'canvas-test');
  setProjectDir(projectDir);
}

const minimalHtml = '<div style="background:#fff;color:#111;font-family:Inter,sans-serif"><h1>Hi</h1></div>';

// ─── TEST 1: icon preset ──
async function testIconPreset(): Promise<void> {
  const r = resolveCanvas('icon');
  assert(r.width === 200 && r.height === 200, `icon: 200×200 (got ${r.width}×${r.height})`);
  assert(r.preset === 'icon', 'icon: preset name retained');
}

// ─── TEST 2: social-square preset ──
async function testSocialSquare(): Promise<void> {
  const r = resolveCanvas('social-square');
  assert(r.width === 1080 && r.height === 1080, `social-square: 1080×1080 (got ${r.width}×${r.height})`);
  assert(r.preset === 'social-square', 'social-square: preset retained');
}

// ─── TEST 3: custom NxN ──
async function testCustomNxN(): Promise<void> {
  const r = resolveCanvas('320x240');
  assert(r.width === 320 && r.height === 240, `custom: 320×240`);
  assert(r.preset === undefined, 'custom: no preset name');
}

// ─── TEST 4: real-× separator ──
async function testRealXSeparator(): Promise<void> {
  const r = resolveCanvas('320×240');
  assert(r.width === 320 && r.height === 240, `real-×: 320×240 accepted`);
  assert(r.preset === undefined, 'real-×: no preset name');
}

// ─── TEST 5: unknown preset throws ──
async function testUnknownPreset(): Promise<void> {
  let caught: any = null;
  try { resolveCanvas('not-a-preset'); }
  catch (err) { caught = err; }
  assert(caught instanceof CanvasResolveError, 'unknown: CanvasResolveError raised');
  assert(caught?.code === 'compile.canvas.unknown_preset', `unknown: code = compile.canvas.unknown_preset (got ${caught?.code})`);
  assert(typeof caught?.message === 'string' && caught.message.includes('not-a-preset'), 'unknown: message names input');
}

// ─── TEST 6: too small ──
async function testTooSmall(): Promise<void> {
  let caught: any = null;
  try { resolveCanvas('10x10'); }
  catch (err) { caught = err; }
  assert(caught instanceof CanvasResolveError, 'too-small: error raised');
  assert(caught?.code === 'compile.canvas.dimensions_out_of_range', `too-small: code = dimensions_out_of_range`);
}

// ─── TEST 7: too large ──
async function testTooLarge(): Promise<void> {
  let caught: any = null;
  try { resolveCanvas('5000x5000'); }
  catch (err) { caught = err; }
  assert(caught instanceof CanvasResolveError, 'too-large: error raised');
  assert(caught?.code === 'compile.canvas.dimensions_out_of_range', 'too-large: code');
}

// ─── TEST 8: all presets in range ──
async function testAllPresetsInRange(): Promise<void> {
  for (const name of KNOWN_CANVAS_PRESETS) {
    const r = resolveCanvas(name);
    assert(r.width >= CANVAS_MIN_DIM && r.width <= CANVAS_MAX_DIM, `preset ${name}: width in [${CANVAS_MIN_DIM}, ${CANVAS_MAX_DIM}] (got ${r.width})`);
    assert(r.height >= CANVAS_MIN_DIM && r.height <= CANVAS_MAX_DIM, `preset ${name}: height in range (got ${r.height})`);
    assert(r.preset === name, `preset ${name}: preset name returned`);
  }
  // Sanity check: count matches registry.
  assert(KNOWN_CANVAS_PRESETS.length === Object.keys(CANVAS_PRESETS).length, 'preset count matches registry');
  assert(KNOWN_CANVAS_PRESETS.length === 9, `9 presets shipped (got ${KNOWN_CANVAS_PRESETS.length})`);
}

// ─── TEST 9: compile with preset persists scene.canvas ──
async function testCompileWithPreset(): Promise<void> {
  setupProject();
  const result = await handleCompile({
    html: minimalHtml,
    name: 'icon-scene',
    canvas: 'icon',
    audit: false,
    exports: [] as string[],
  } as any);
  assert(!(result as any).isError, 'compile-icon: not isError');
  const sid = getSessionId('icon-scene')!;
  const stored = getScene(sid)!;
  const canvas = (stored.graph as any).canvas;
  assert(canvas?.width === 200, `compile-icon: scene.canvas.width = 200 (got ${canvas?.width})`);
  assert(canvas?.height === 200, 'compile-icon: scene.canvas.height = 200');
  assert(canvas?.preset === 'icon', 'compile-icon: preset name persisted');
}

// ─── TEST 10: compile without canvas (backward compat) ──
async function testCompileBackwardCompat(): Promise<void> {
  setupProject();
  const result = await handleCompile({
    html: minimalHtml,
    name: 'plain-scene',
    audit: false,
    exports: [] as string[],
  } as any);
  assert(!(result as any).isError, 'compile-plain: not isError');
  const sid = getSessionId('plain-scene')!;
  const stored = getScene(sid)!;
  const canvas = (stored.graph as any).canvas;
  assert(canvas == null, `compile-plain: scene.canvas null/undefined (got ${JSON.stringify(canvas)})`);
}

// ─── TEST 11: bad preset → structured tool error ──
async function testBadPresetEnvelope(): Promise<void> {
  setupProject();
  const result = await handleCompile({
    html: minimalHtml,
    name: 'bad-preset',
    canvas: 'gigantosaurus',
    audit: false,
    exports: [] as string[],
  } as any);
  assert((result as any).isError === true, 'bad-preset: isError flag set');
  // Tool error envelope is at content[1] (text JSON).
  const errText = (result as any).content?.[1]?.text;
  if (errText) {
    try {
      const parsed = JSON.parse(errText);
      assert(parsed?.code === 'compile.canvas.unknown_preset', `bad-preset: code = compile.canvas.unknown_preset (got ${parsed?.code})`);
    } catch {
      assert(false, 'bad-preset: error envelope not parseable as JSON');
    }
  } else {
    assert(false, 'bad-preset: no error envelope content[1].text');
  }
}

// ─── TEST 12: determinism ──
async function testDeterminism(): Promise<void> {
  setupProject();
  const a = await handleCompile({ html: minimalHtml, name: 'det-a', canvas: 'thumbnail', audit: false, exports: [] as string[] } as any);
  const b = await handleCompile({ html: minimalHtml, name: 'det-b', canvas: 'thumbnail', audit: false, exports: [] as string[] } as any);
  assert(!(a as any).isError && !(b as any).isError, 'determinism: both compiles ok');
  const sa = getScene(getSessionId('det-a')!)!;
  const sb = getScene(getSessionId('det-b')!)!;
  const ca = (sa.graph as any).canvas;
  const cb = (sb.graph as any).canvas;
  assert(ca?.width === cb?.width && ca?.height === cb?.height && ca?.preset === cb?.preset, 'determinism: canvas spec identical');
}

// ─── TEST 13: inspect surfaces canvas ──
async function testInspectSurface(): Promise<void> {
  setupProject();
  // With canvas → line emitted.
  await handleCompile({ html: minimalHtml, name: 'icon-i', canvas: 'icon', audit: false, exports: [] as string[] } as any);
  const sid = getSessionId('icon-i')!;
  const inspectIcon = await handleInspect({ sceneId: sid, tree: false, audit: false, preview: false } as any);
  const txt1 = (inspectIcon as any).content?.[0]?.text ?? '';
  assert(txt1.includes('Canvas: 200×200'), `inspect: surfaces "Canvas: 200×200" (got partial: ${txt1.split('\n').filter((l: string) => l.startsWith('Canvas:')).join(' | ')})`);
  assert(txt1.includes('preset: icon'), 'inspect: surfaces preset name');

  // Without canvas → line absent.
  await handleCompile({ html: minimalHtml, name: 'plain-i', audit: false, exports: [] as string[] } as any);
  const sid2 = getSessionId('plain-i')!;
  const inspectPlain = await handleInspect({ sceneId: sid2, tree: false, audit: false, preview: false } as any);
  const txt2 = (inspectPlain as any).content?.[0]?.text ?? '';
  assert(!txt2.includes('Canvas:'), 'inspect: omits Canvas line for default-sized scene');
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('T3 #31 Canvas Presets contract\n');

  const tests: Array<[string, () => Promise<void>]> = [
    ['resolveCanvas("icon") → 200×200 with preset', testIconPreset],
    ['resolveCanvas("social-square") → 1080×1080', testSocialSquare],
    ['resolveCanvas("320x240") → custom dimensions, no preset', testCustomNxN],
    ['resolveCanvas("320×240") with real × separator accepted', testRealXSeparator],
    ['resolveCanvas("not-a-preset") → unknown_preset error', testUnknownPreset],
    ['resolveCanvas("10x10") → dimensions_out_of_range (too small)', testTooSmall],
    ['resolveCanvas("5000x5000") → dimensions_out_of_range (too large)', testTooLarge],
    ['all 9 named presets resolve in [50, 4096]', testAllPresetsInRange],
    ['compile with canvas="icon" persists scene.canvas spec', testCompileWithPreset],
    ['compile without canvas option preserves backward compat', testCompileBackwardCompat],
    ['compile with bad preset returns structured tool error envelope', testBadPresetEnvelope],
    ['determinism — same canvas option → identical persisted spec', testDeterminism],
    ['inspect surfaces Canvas line when set; omits when absent', testInspectSurface],
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
