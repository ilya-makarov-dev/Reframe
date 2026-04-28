/**
 * T2 #28 Shader Layers — registry/validate/fallback/blend contract.
 *
 * Adds 3 GPU-driven shader layer types (shader-gradient-flow,
 * shader-noise-field, shader-aurora) to the overlay registry. Existing
 * 9 layers (#5: 3 atmospherics + #10: 6 physics) untouched — the #5/#10
 * contract suites are the backward-compat gate.
 *
 * jsdom doesn't ship WebGL, so init() determinism via real GL is run
 * via the standalone probe HTMLs (file:// in a real browser). Here we
 * verify:
 *   - registry shape (12 entries, all with required interface)
 *   - validate accepts default config for each shader type
 *   - validate rejects per-param invalid input
 *   - default blend modes correct (lighter for aurora, source-over for others)
 *   - WebGL fallback path: factory called with canvas missing
 *     getContext('webgl') returns inert no-op LayerInstance
 *   - HTML export emits BROWSER_SOURCE that includes all 3 factory_<type>
 *     definitions + helpers + vertex shader source
 *   - Backward compat: existing 9 layers still validate identically
 *
 * Run: npx tsx packages/mcp/src/tests/week7-shader-layers-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleCompile } from '../tools/compile.js';
import { setProjectDir } from '../store.js';
import { initProject } from '../../../core/src/project/io.js';
import { readOverlaySpec } from '../../../core/src/project/overlay-store.js';
import {
  LAYER_REGISTRY,
  ALL_LAYERS_BROWSER_SOURCE,
  resolveBlendMode,
  KNOWN_LAYER_TYPES,
} from '../../../core/src/engine/overlay-layers/index.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

let projectDir: string;
function setupProject(): void {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-shader-test-'));
  initProject(projectDir, 'shader-test');
  setProjectDir(projectDir);
}

const baseHtml =
  '<div style="width:1280px;height:720px;background:#0a0a14;color:#fff;font-family:Inter,sans-serif;padding:48px">' +
    '<h1 style="font-size:48px;margin:0">Shader Hero</h1>' +
  '</div>';

function makeBase() {
  return { html: baseHtml, audit: false, exports: [] as string[] };
}

const SHADER_TYPES = ['shader-gradient-flow', 'shader-noise-field', 'shader-aurora'] as const;

// ─── TEST 1: registry shape ──
async function testRegistryShape(): Promise<void> {
  const keys = Object.keys(LAYER_REGISTRY);
  assert(keys.length === 12, `registry: 12 entries (got ${keys.length})`);
  for (const t of SHADER_TYPES) {
    const impl = LAYER_REGISTRY[t];
    assert(typeof impl?.validate === 'function', `registry: ${t} has validate()`);
    assert(typeof impl?.BROWSER_SOURCE === 'string' && impl.BROWSER_SOURCE.length > 200, `registry: ${t} has BROWSER_SOURCE`);
    assert(impl?.type === t, `registry: ${t}.type matches key`);
  }
  // KNOWN_LAYER_TYPES export reflects the registry too.
  for (const t of SHADER_TYPES) {
    assert(KNOWN_LAYER_TYPES.includes(t), `KNOWN_LAYER_TYPES includes ${t}`);
  }
}

// ─── TEST 2: validate accepts default config ──
async function testDefaultConfigsValidate(): Promise<void> {
  for (const t of SHADER_TYPES) {
    const result = LAYER_REGISTRY[t].validate({});
    assert(result.ok === true, `${t}: validate({}) ok`);
  }
}

// ─── TEST 3: shader-gradient-flow color array bounds ──
async function testGradientFlowColors(): Promise<void> {
  // Wrong types
  const r1 = LAYER_REGISTRY['shader-gradient-flow'].validate({ colors: 'red' as any });
  assert(!r1.ok && r1.param === 'colors', `gradient-flow: colors must be array`);
  // Too few
  const r2 = LAYER_REGISTRY['shader-gradient-flow'].validate({ colors: ['#abc'] });
  assert(!r2.ok && r2.param === 'colors', `gradient-flow: colors min 2`);
  // Too many
  const r3 = LAYER_REGISTRY['shader-gradient-flow'].validate({ colors: ['#abc', '#abc', '#abc', '#abc'] });
  assert(!r3.ok && r3.param === 'colors', `gradient-flow: colors max 3`);
  // Bad hex
  const r4 = LAYER_REGISTRY['shader-gradient-flow'].validate({ colors: ['#abc', 'mauve'] });
  assert(!r4.ok && r4.param === 'colors', `gradient-flow: bad hex rejected`);
  // Cycle min
  const r5 = LAYER_REGISTRY['shader-gradient-flow'].validate({ cycle: 50 });
  assert(!r5.ok && r5.param === 'cycle', `gradient-flow: cycle < 100 rejected`);
  // Direction normalized (not rejected, wrapped)
  const r6 = LAYER_REGISTRY['shader-gradient-flow'].validate({ direction: 720 });
  assert(r6.ok && r6.resolved.direction === 0, `gradient-flow: direction=720 → 0`);
}

// ─── TEST 4: shader-noise-field range checks ──
async function testNoiseFieldRanges(): Promise<void> {
  const r1 = LAYER_REGISTRY['shader-noise-field'].validate({ intensity: 1.5 });
  assert(!r1.ok && r1.param === 'intensity', `noise-field: intensity > 1 rejected`);
  const r2 = LAYER_REGISTRY['shader-noise-field'].validate({ scale: 0.1 });
  assert(!r2.ok && r2.param === 'scale', `noise-field: scale < 0.5 rejected`);
  const r3 = LAYER_REGISTRY['shader-noise-field'].validate({ scale: 20 });
  assert(!r3.ok && r3.param === 'scale', `noise-field: scale > 10 rejected`);
  const r4 = LAYER_REGISTRY['shader-noise-field'].validate({ speed: 5 });
  assert(!r4.ok && r4.param === 'speed', `noise-field: speed > 2 rejected`);
  const r5 = LAYER_REGISTRY['shader-noise-field'].validate({ color: 'plaid' });
  assert(!r5.ok && r5.param === 'color', `noise-field: bad hex rejected`);
}

// ─── TEST 5: shader-aurora color count exactly 3 ──
async function testAuroraColors(): Promise<void> {
  const r1 = LAYER_REGISTRY['shader-aurora'].validate({ colors: ['#abc', '#def'] });
  assert(!r1.ok && r1.param === 'colors', `aurora: 2 colors rejected (must be 3)`);
  const r2 = LAYER_REGISTRY['shader-aurora'].validate({ colors: ['#abc', '#def', '#fed', '#cba'] });
  assert(!r2.ok && r2.param === 'colors', `aurora: 4 colors rejected`);
  const r3 = LAYER_REGISTRY['shader-aurora'].validate({ colors: ['#abc', '#def', '#fed'] });
  assert(r3.ok, `aurora: 3 colors ok`);
  const r4 = LAYER_REGISTRY['shader-aurora'].validate({ intensity: 1.5 });
  assert(!r4.ok && r4.param === 'intensity', `aurora: intensity > 1 rejected`);
}

// ─── TEST 6: default blend modes ──
async function testDefaultBlendModes(): Promise<void> {
  assert(resolveBlendMode('shader-gradient-flow', undefined) === 'source-over', 'gradient-flow → source-over');
  assert(resolveBlendMode('shader-noise-field', undefined) === 'source-over', 'noise-field → source-over');
  assert(resolveBlendMode('shader-aurora', undefined) === 'lighter', 'aurora → lighter');
  // Explicit override still wins.
  assert(resolveBlendMode('shader-aurora', 'multiply') === 'multiply', 'aurora explicit override wins');
}

// ─── TEST 7: WebGL fallback path ──
async function testWebGLFallback(): Promise<void> {
  // Build a minimal canvas mock whose getContext('webgl') returns null.
  // Factory should detect this and return an inert LayerInstance.
  function makeNoWebGLCanvas(): any {
    return {
      width: 256,
      height: 256,
      getContext: (type: string) => (type === 'webgl' || type === 'experimental-webgl' ? null : { canvas: { width: 256, height: 256 } }),
    };
  }

  // Eval the runtime source (same path that runs in browser).
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('window', 'console',
    ALL_LAYERS_BROWSER_SOURCE +
    "; return { factory_shader_gradient_flow, factory_shader_noise_field, factory_shader_aurora };",
  );
  // Mock window for warnShaderUnavailable's __reframeShaderWarnedTypes registry.
  const mockWindow: any = {};
  const warnings: string[] = [];
  const mockConsole = {
    warn: (...args: any[]) => warnings.push(args.map(String).join(' ')),
    error: () => {},
    log: () => {},
  };
  const factories = fn(mockWindow, mockConsole);

  for (const t of SHADER_TYPES) {
    const factoryName = 'factory_' + t.replace(/-/g, '_');
    const f = factories[factoryName];
    const canvas = makeNoWebGLCanvas();
    const instance = f(canvas, {}, { width: 256, height: 256 }, 'test-layer');
    assert(typeof instance?.render === 'function', `fallback ${t}: instance.render exists`);
    assert(typeof instance?.resize === 'function', `fallback ${t}: instance.resize exists`);
    assert(typeof instance?.destroy === 'function', `fallback ${t}: instance.destroy exists`);
    // Calling render on inert instance must not throw.
    let threw = false;
    try { instance.render(null, 0); }
    catch { threw = true; }
    assert(!threw, `fallback ${t}: render(null, 0) does not throw`);
  }

  // Each shader type should have logged exactly one warning.
  assert(warnings.length === SHADER_TYPES.length, `fallback: 1 warning per shader type (got ${warnings.length})`);
  // Re-init same type → no second warning (idempotent guard).
  const f2 = factories['factory_shader_aurora'];
  f2(makeNoWebGLCanvas(), {}, { width: 256, height: 256 }, 'test-layer-2');
  assert(warnings.length === SHADER_TYPES.length, `fallback: re-init does not duplicate warning`);
}

// ─── TEST 8: BROWSER_SOURCE includes all 3 factories + shared helpers ──
async function testBrowserSourceCompletes(): Promise<void> {
  const requiredFactories = SHADER_TYPES.map(t => 'factory_' + t.replace(/-/g, '_'));
  for (const f of requiredFactories) {
    assert(ALL_LAYERS_BROWSER_SOURCE.includes(f), `source: ${f} present`);
  }
  // Shared WebGL helpers
  assert(ALL_LAYERS_BROWSER_SOURCE.includes('function compileShader'), 'source: compileShader helper present');
  assert(ALL_LAYERS_BROWSER_SOURCE.includes('function linkProgram'), 'source: linkProgram helper present');
  assert(ALL_LAYERS_BROWSER_SOURCE.includes('function setupFullScreenQuad'), 'source: setupFullScreenQuad helper present');
  assert(ALL_LAYERS_BROWSER_SOURCE.includes('function tryGetWebGLContext'), 'source: tryGetWebGLContext helper present');
  assert(ALL_LAYERS_BROWSER_SOURCE.includes('function makeInertLayer'), 'source: makeInertLayer helper present');
  assert(ALL_LAYERS_BROWSER_SOURCE.includes('VERTEX_QUAD_SOURCE'), 'source: VERTEX_QUAD_SOURCE constant present');
  // GLSL fragment markers from each shader.
  assert(ALL_LAYERS_BROWSER_SOURCE.includes('precision mediump float'), 'source: GLSL precision declaration present');
  assert(ALL_LAYERS_BROWSER_SOURCE.includes('gl_FragColor'), 'source: gl_FragColor write present');
}

// ─── TEST 9: compile happy path with shader-aurora ──
async function testCompileShaderAurora(): Promise<void> {
  setupProject();
  const overlayId = 'aurora-test';
  const result = await handleCompile({
    overlay: {
      overlayId,
      name: 'Aurora',
      base: makeBase(),
      layers: [{ type: 'shader-aurora', config: { intensity: 0.7 } }],
    },
  } as any);
  assert(!(result as any).isError, `aurora: compile not isError`);
  const spec = readOverlaySpec(projectDir, overlayId);
  assert(spec !== null, `aurora: spec on disk`);
  assert(spec?.layers[0].type === 'shader-aurora', `aurora: layer type`);
  assert(spec?.layers[0].blendMode === 'lighter', `aurora: blendMode resolved to lighter (got ${spec?.layers[0].blendMode})`);
}

// ─── TEST 10: shader + canvas-2D layers compose in same overlay ──
async function testMixedComposition(): Promise<void> {
  setupProject();
  const overlayId = 'mixed-shader-canvas';
  const result = await handleCompile({
    overlay: {
      overlayId,
      name: 'Mixed',
      base: makeBase(),
      layers: [
        { type: 'shader-aurora', config: {} },              // GPU
        { type: 'snow', config: { count: 80 } },             // canvas 2D
      ],
    },
  } as any);
  assert(!(result as any).isError, `mixed: compile not isError`);
  const spec = readOverlaySpec(projectDir, overlayId);
  assert(spec?.layers.length === 2, `mixed: 2 layers persisted`);
  assert(spec?.layers[0].type === 'shader-aurora' && spec?.layers[0].blendMode === 'lighter', `mixed: aurora layer + lighter blend`);
  assert(spec?.layers[1].type === 'snow' && spec?.layers[1].blendMode === 'source-over', `mixed: snow layer + source-over blend`);
}

// ─── TEST 11: backward compat — #5/#10 layers still validate identically ──
async function testBackwardCompat(): Promise<void> {
  // Re-validate each pre-#28 type with empty config; if any drifted we'd see a fail.
  const PRE_28_TYPES = [
    'noise-grain', 'gradient-pulse', 'particle-dust',
    'fire', 'smoke', 'wind', 'snow', 'electric', 'gold',
  ] as const;
  for (const t of PRE_28_TYPES) {
    const r = LAYER_REGISTRY[t].validate({});
    assert(r.ok === true, `backward: ${t} validate({}) still ok`);
  }
}

// ─── TEST 12: overlay max-layers cap unchanged at 3 ──
async function testMaxLayersUnchanged(): Promise<void> {
  setupProject();
  const result = await handleCompile({
    overlay: {
      overlayId: 'too-many-shaders',
      name: 'X',
      base: makeBase(),
      layers: [
        { type: 'shader-aurora', config: {} },
        { type: 'shader-gradient-flow', config: {} },
        { type: 'shader-noise-field', config: {} },
        { type: 'fire', config: {} },  // 4th — exceeds cap
      ],
    },
  } as any);
  assert((result as any).isError, `cap: 4-layer overlay rejected`);
  const json = JSON.parse((result as any).content?.[1]?.text ?? '{}');
  assert(json?.code === 'compile.overlay.too_many_layers', `cap: error code is too_many_layers (got ${json?.code})`);
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('T2 #28 Shader Layers contract\n');

  const tests: Array<[string, () => Promise<void>]> = [
    ['registry has 12 entries; shader types have validate / BROWSER_SOURCE', testRegistryShape],
    ['validate({}) ok for all 3 shader types', testDefaultConfigsValidate],
    ['shader-gradient-flow colors bounds + cycle floor + direction normalization', testGradientFlowColors],
    ['shader-noise-field intensity / scale / speed / color ranges', testNoiseFieldRanges],
    ['shader-aurora colors must be exactly 3', testAuroraColors],
    ['default blend modes correct (aurora=lighter, others=source-over)', testDefaultBlendModes],
    ['WebGL fallback path returns inert LayerInstance + warns once per type', testWebGLFallback],
    ['BROWSER_SOURCE includes all 3 factories + shader helpers + vertex source', testBrowserSourceCompletes],
    ['compile shader-aurora — blendMode resolved to lighter on disk', testCompileShaderAurora],
    ['compile shader + canvas-2D mixed composition — both blends resolved per-layer', testMixedComposition],
    ['backward compat — pre-#28 layer types still validate({}) cleanly', testBackwardCompat],
    ['max-layers cap unchanged at 3 (4th rejected)', testMaxLayersUnchanged],
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
