/**
 * T2 #10 Physics Layers — registry/validate/init/determinism/blend contract.
 *
 * Adds 6 layer types to the overlay registry: fire / smoke / wind / snow
 * / electric / gold. Existing 3 (#5: noise-grain, gradient-pulse,
 * particle-dust) are touched only by the registry expansion — their
 * impl files are unchanged, so the #5 contract suite is the backward-
 * compat gate.
 *
 * Tests:
 *   1. registry has 9 entries; all impls have validate / BROWSER_SOURCE
 *   2. validate accepts default config for all 6 new types
 *   3. validate rejects bad fire.intensity (out of 0..1)
 *   4. validate rejects bad smoke.color (non-CSS string)
 *   5. validate rejects bad wind.speed (out of 30..300)
 *   6. validate rejects bad snow.drift (out of -45..45)
 *   7. validate rejects bad electric.frequency (out of 0.5..10)
 *   8. validate rejects bad gold.twinkle (not 'fast' / 'slow')
 *   9. compile happy path — 1-layer fire overlay → spec on disk with
 *      blendMode 'lighter' (resolved from DEFAULT_BLEND_MODE)
 *  10. compile multi-layer — fire+smoke combo, blendModes resolved
 *      independently per layer (lighter, source-over)
 *  11. determinism — 6 layer factories produce byte-identical first
 *      frames across two evals when seeded with same layerId
 *  12. registry source includes all 6 factory_<type> definitions
 *
 * Run: npx tsx packages/mcp/src/tests/week7-physics-layers-contract.test.ts
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
} from '../../../core/src/engine/overlay-layers/index.js';

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
  } catch {}
  return null;
}

let projectDir: string;
function setupProject(): void {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-physics-test-'));
  initProject(projectDir, 'physics-test');
  setProjectDir(projectDir);
}

const baseHtml =
  '<div style="width:1280px;height:720px;background:#0f0f0f;color:#fff;font-family:Inter,sans-serif;padding:48px">' +
    '<h1 style="font-size:48px;margin:0">Physics Hero</h1>' +
  '</div>';

function makeBase() {
  return { html: baseHtml, audit: false, exports: [] as string[] };
}

const PHYSICS_TYPES = ['fire', 'smoke', 'wind', 'snow', 'electric', 'gold'] as const;
const ADDITIVE_TYPES = new Set(['fire', 'electric', 'gold']);
const DIFFUSE_TYPES = new Set(['smoke', 'snow', 'wind']);

// ─── TEST 1: registry shape ──
async function testRegistryShape(): Promise<void> {
  const keys = Object.keys(LAYER_REGISTRY);
  assert(keys.length === 9, `registry: 9 entries (got ${keys.length})`);
  for (const t of PHYSICS_TYPES) {
    const impl = LAYER_REGISTRY[t];
    assert(typeof impl?.validate === 'function', `registry: ${t} has validate()`);
    assert(typeof impl?.BROWSER_SOURCE === 'string' && impl.BROWSER_SOURCE.length > 100, `registry: ${t} has BROWSER_SOURCE`);
    assert(impl?.type === t, `registry: ${t}.type matches key`);
  }
  // Default blend modes — additive vs diffuse split.
  for (const t of PHYSICS_TYPES) {
    const impl = LAYER_REGISTRY[t];
    if (ADDITIVE_TYPES.has(t)) {
      assert(impl?.DEFAULT_BLEND_MODE === 'lighter', `registry: ${t} DEFAULT_BLEND_MODE = lighter`);
    } else if (DIFFUSE_TYPES.has(t)) {
      assert(impl?.DEFAULT_BLEND_MODE === 'source-over', `registry: ${t} DEFAULT_BLEND_MODE = source-over`);
    }
  }
}

// ─── TEST 2: validate accepts default config for all 6 ──
async function testDefaultConfigsValidate(): Promise<void> {
  for (const t of PHYSICS_TYPES) {
    const result = LAYER_REGISTRY[t].validate({});
    assert(result.ok === true, `${t}: validate({}) ok`);
    if (result.ok) {
      assert(typeof result.resolved === 'object' && result.resolved !== null, `${t}: validate returns resolved object`);
    }
  }
}

// ─── TEST 3: fire.intensity out-of-range rejected ──
async function testFireIntensity(): Promise<void> {
  const r1 = LAYER_REGISTRY['fire'].validate({ intensity: -0.1 });
  assert(!r1.ok && r1.param === 'intensity', `fire: intensity=-0.1 rejected (param=${(r1 as any).param})`);
  const r2 = LAYER_REGISTRY['fire'].validate({ intensity: 1.5 });
  assert(!r2.ok && r2.param === 'intensity', `fire: intensity=1.5 rejected`);
  const r3 = LAYER_REGISTRY['fire'].validate({ intensity: 'soft' as any });
  assert(!r3.ok && r3.param === 'intensity', `fire: intensity='soft' rejected`);
  const r4 = LAYER_REGISTRY['fire'].validate({ intensity: 0.5 });
  assert(r4.ok, `fire: intensity=0.5 accepted`);
}

// ─── TEST 4: smoke.color rejected when non-CSS ──
async function testSmokeColor(): Promise<void> {
  const r1 = LAYER_REGISTRY['smoke'].validate({ color: 'mauve' });
  assert(!r1.ok && r1.param === 'color', `smoke: color='mauve' rejected`);
  const r2 = LAYER_REGISTRY['smoke'].validate({ color: '#abc' });
  assert(r2.ok, `smoke: color='#abc' accepted`);
  const r3 = LAYER_REGISTRY['smoke'].validate({ color: 'rgba(100,100,100,0.5)' });
  assert(r3.ok, `smoke: color='rgba(...)' accepted`);
}

// ─── TEST 5: wind.speed out-of-range rejected ──
async function testWindSpeed(): Promise<void> {
  const r1 = LAYER_REGISTRY['wind'].validate({ speed: 20 });  // < 30
  assert(!r1.ok && r1.param === 'speed', `wind: speed=20 rejected`);
  const r2 = LAYER_REGISTRY['wind'].validate({ speed: 500 });  // > 300
  assert(!r2.ok && r2.param === 'speed', `wind: speed=500 rejected`);
  const r3 = LAYER_REGISTRY['wind'].validate({ speed: 100 });
  assert(r3.ok, `wind: speed=100 accepted`);
  // Direction wraps but doesn't reject — angle outside 0..360 normalized.
  const r4 = LAYER_REGISTRY['wind'].validate({ direction: 720 });
  assert(r4.ok && r4.resolved.direction === 0, `wind: direction=720 → 0 (normalized)`);
}

// ─── TEST 6: snow.drift out-of-range rejected ──
async function testSnowDrift(): Promise<void> {
  const r1 = LAYER_REGISTRY['snow'].validate({ drift: -60 });  // < -45
  assert(!r1.ok && r1.param === 'drift', `snow: drift=-60 rejected`);
  const r2 = LAYER_REGISTRY['snow'].validate({ drift: 50 });  // > 45
  assert(!r2.ok && r2.param === 'drift', `snow: drift=50 rejected`);
  const r3 = LAYER_REGISTRY['snow'].validate({ drift: 0 });
  assert(r3.ok, `snow: drift=0 accepted`);
}

// ─── TEST 7: electric.frequency out-of-range rejected ──
async function testElectricFrequency(): Promise<void> {
  const r1 = LAYER_REGISTRY['electric'].validate({ frequency: 0.1 });  // < 0.5
  assert(!r1.ok && r1.param === 'frequency', `electric: frequency=0.1 rejected`);
  const r2 = LAYER_REGISTRY['electric'].validate({ frequency: 50 });  // > 10
  assert(!r2.ok && r2.param === 'frequency', `electric: frequency=50 rejected`);
  const r3 = LAYER_REGISTRY['electric'].validate({ frequency: 2 });
  assert(r3.ok, `electric: frequency=2 accepted`);
  // branches: 1..5
  const r4 = LAYER_REGISTRY['electric'].validate({ branches: 10 });
  assert(!r4.ok && r4.param === 'branches', `electric: branches=10 rejected`);
}

// ─── TEST 8: gold.twinkle rejected when not 'fast' / 'slow' ──
async function testGoldTwinkle(): Promise<void> {
  const r1 = LAYER_REGISTRY['gold'].validate({ twinkle: 'medium' });
  assert(!r1.ok && r1.param === 'twinkle', `gold: twinkle='medium' rejected`);
  const r2 = LAYER_REGISTRY['gold'].validate({ twinkle: 'slow' });
  assert(r2.ok, `gold: twinkle='slow' accepted`);
}

// ─── TEST 9: compile happy path with fire — blendMode resolved ──
async function testCompileFire(): Promise<void> {
  setupProject();
  const overlayId = 'fire-test';
  const result = await handleCompile({
    overlay: {
      overlayId,
      name: 'Fire',
      base: makeBase(),
      layers: [{ type: 'fire', config: { intensity: 0.5, color: 'warm' } }],
    },
  } as any);
  assert(!(result as any).isError, `fire: compile not isError`);
  const spec = readOverlaySpec(projectDir, overlayId);
  assert(spec !== null, `fire: spec on disk`);
  assert(spec?.layers[0].type === 'fire', `fire: layer type`);
  // blendMode resolved to 'lighter' (DEFAULT_BLEND_MODE for fire).
  assert(spec?.layers[0].blendMode === 'lighter', `fire: blendMode resolved to lighter (got ${spec?.layers[0].blendMode})`);
}

// ─── TEST 10: multi-layer fire+smoke — independent blend resolution ──
async function testCompileFireSmoke(): Promise<void> {
  setupProject();
  const overlayId = 'fire-smoke';
  const result = await handleCompile({
    overlay: {
      overlayId,
      name: 'Fire + Smoke',
      base: makeBase(),
      layers: [
        { type: 'smoke', config: { density: 0.3, drift: 'up' } },
        { type: 'fire', config: { intensity: 0.7, color: 'warm', height: 'tall' } },
      ],
    },
  } as any);
  assert(!(result as any).isError, `fire+smoke: not isError`);
  const spec = readOverlaySpec(projectDir, overlayId);
  assert(spec?.layers.length === 2, `fire+smoke: 2 layers`);
  assert(spec?.layers[0].type === 'smoke' && spec?.layers[0].blendMode === 'source-over', `fire+smoke: smoke = source-over`);
  assert(spec?.layers[1].type === 'fire' && spec?.layers[1].blendMode === 'lighter', `fire+smoke: fire = lighter`);
  // Explicit blendMode override still wins over default.
  const overrideResult = await handleCompile({
    overlay: {
      overlayId: 'fire-override',
      name: 'X',
      base: makeBase(),
      layers: [{ type: 'fire', config: {}, blendMode: 'screen' }],
    },
  } as any);
  assert(!(overrideResult as any).isError, `override: compile ok`);
  const overrideSpec = readOverlaySpec(projectDir, 'fire-override');
  assert(overrideSpec?.layers[0].blendMode === 'screen', `override: explicit blendMode wins (got ${overrideSpec?.layers[0].blendMode})`);
}

// ─── TEST 11: determinism — first frame byte-identical for same layerId ──
async function testRuntimeDeterminism(): Promise<void> {
  // Mock canvas with putImageData / drawImage capture, just like the
  // #5 runtime probe. For physics layers we capture a hash of all draw
  // calls (positions + colors). Same layerId → identical call sequence.

  function makeCanvas(): any {
    const calls: any[] = [];
    const ctx: any = {
      canvas: { width: 256, height: 256 },
      createImageData(w: number, h: number) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
      createLinearGradient() { return { addColorStop() {} }; },
      createRadialGradient() { return { addColorStop() {} }; },
      putImageData(img: any) { calls.push(['put', Array.from(img.data).reduce((a: any, b: any) => (a + b) | 0, 0)]); },
      drawImage(_img: any, x: number, y: number) { calls.push(['draw', Math.round(x), Math.round(y)]); },
      clearRect() { calls.push(['clear']); },
      fillRect(x: number, y: number, w: number, h: number) { calls.push(['fill', Math.round(x), Math.round(y), Math.round(w), Math.round(h)]); },
      beginPath() { calls.push(['begin']); },
      arc(x: number, y: number, r: number) { calls.push(['arc', Math.round(x), Math.round(y), Math.round(r * 10) / 10]); },
      moveTo(x: number, y: number) { calls.push(['m', Math.round(x), Math.round(y)]); },
      lineTo(x: number, y: number) { calls.push(['l', Math.round(x), Math.round(y)]); },
      fill() { calls.push(['fill0']); },
      stroke() { calls.push(['stroke']); },
      get imageSmoothingEnabled() { return false; },
      set imageSmoothingEnabled(_v: boolean) {},
      get globalAlpha() { return 1; },
      set globalAlpha(_v: number) {},
      get globalCompositeOperation() { return ''; },
      set globalCompositeOperation(_v: string) {},
      get fillStyle() { return ''; },
      set fillStyle(v: any) { calls.push(['fs', String(v)]); },
      get strokeStyle() { return ''; },
      set strokeStyle(v: any) { calls.push(['ss', String(v)]); },
      get lineWidth() { return 0; },
      set lineWidth(v: number) { calls.push(['lw', v]); },
      get lineCap() { return ''; },
      set lineCap(_v: string) {},
      get lineJoin() { return ''; },
      set lineJoin(_v: string) {},
    };
    return {
      width: 256,
      height: 256,
      getContext: () => ctx,
      _getCalls: () => calls,
    };
  }

  function buildContext(): { factories: Record<string, any>; createdCanvases: any[] } {
    const createdCanvases: any[] = [];
    const documentMock: any = { createElement: () => { const c = makeCanvas(); createdCanvases.push(c); return c; } };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function('document',
      ALL_LAYERS_BROWSER_SOURCE +
      "; return { factory_fire, factory_smoke, factory_wind, factory_snow, factory_electric, factory_gold };",
    );
    return { factories: fn(documentMock), createdCanvases };
  }

  const layerIdRunner = (factoryName: string) => {
    function run() {
      const ctx = buildContext();
      const canvas = makeCanvas();
      const inst = ctx.factories[factoryName](canvas, {}, { width: 256, height: 256 }, 'phys:layer-x');
      inst.render(canvas.getContext('2d'), 0);
      return JSON.stringify(canvas._getCalls());
    }
    const a = run();
    const b = run();
    return a === b;
  };

  for (const t of PHYSICS_TYPES) {
    const factoryName = 'factory_' + t.replace(/-/g, '_');
    const same = layerIdRunner(factoryName);
    assert(same, `determinism: ${t} first-frame call sequence identical across two evals`);
  }
}

// ─── TEST 12: registry source includes all 6 factory_<type> definitions ──
async function testSourceCompletes(): Promise<void> {
  for (const t of PHYSICS_TYPES) {
    const fname = 'factory_' + t.replace(/-/g, '_');
    assert(ALL_LAYERS_BROWSER_SOURCE.includes(fname), `source: ${fname} present`);
  }
  // resolveBlendMode sanity — default 'source-over' for #5 layers, 'lighter'
  // for additive physics, 'source-over' for diffuse physics.
  assert(resolveBlendMode('noise-grain', undefined) === 'source-over', 'resolve: noise-grain → source-over');
  assert(resolveBlendMode('fire', undefined) === 'lighter', 'resolve: fire → lighter');
  assert(resolveBlendMode('snow', undefined) === 'source-over', 'resolve: snow → source-over');
  assert(resolveBlendMode('fire', 'screen') === 'screen', 'resolve: explicit override wins');
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('T2 #10 Physics Layers contract\n');

  const tests: Array<[string, () => Promise<void>]> = [
    ['registry has 9 entries; all impls have validate / BROWSER_SOURCE / DEFAULT_BLEND_MODE', testRegistryShape],
    ['validate accepts default config for all 6 physics types', testDefaultConfigsValidate],
    ['fire.intensity out-of-range rejected with param=intensity', testFireIntensity],
    ['smoke.color non-CSS string rejected', testSmokeColor],
    ['wind.speed out-of-range rejected; direction normalized', testWindSpeed],
    ['snow.drift out-of-range rejected', testSnowDrift],
    ['electric.frequency + branches out-of-range rejected', testElectricFrequency],
    ['gold.twinkle non-{fast,slow} rejected', testGoldTwinkle],
    ['compile fire — blendMode resolved to lighter', testCompileFire],
    ['compile fire+smoke — blendModes resolved per-layer; explicit override wins', testCompileFireSmoke],
    ['runtime determinism — 6 factories produce identical first-frame call sequence', testRuntimeDeterminism],
    ['source includes all 6 factory_<type> defs; resolveBlendMode correct', testSourceCompletes],
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
