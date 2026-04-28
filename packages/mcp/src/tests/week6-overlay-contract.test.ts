/**
 * T2 #5 Overlay — compile/store/persistence/HTML-export contract.
 *
 * 10 tests:
 *   1. happy path — 1-layer overlay, response envelope + overlay.json on disk
 *   2. no_layers throws (zero layers)
 *   3. unknown_layer_type throws
 *   4. invalid_layer_config — noise-grain intensity > 1 → param='intensity'
 *   5. too_many_layers throws (4 layers > Phase 0 cap of 3)
 *   6. duplicate_layer_id throws
 *   7. invalid_id (regex fail) throws
 *   8. storage round-trip — write → read → spec equal
 *   9. determinism — same input compiled twice → byte-identical overlay.json
 *  10. HTML export — exportOverlayToHtml emits canvas elements + IIFE
 *      registry referencing each factory_<type> by correct name
 *
 * Run: npx tsx packages/mcp/src/tests/week6-overlay-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleCompile } from '../tools/compile.js';
import { setProjectDir } from '../store.js';
import { initProject } from '../../../core/src/project/io.js';
import { readOverlaySpec, overlaySpecPath } from '../../../core/src/project/overlay-store.js';
import { exportOverlayToHtml } from '../../../core/src/exporters/html.js';
import { ALL_LAYERS_BROWSER_SOURCE } from '../../../core/src/engine/overlay-layers/index.js';

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
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-overlay-test-'));
  initProject(projectDir, 'overlay-test');
  setProjectDir(projectDir);
}

const baseHtml =
  '<div style="width:1280px;height:720px;background:#0f3460;color:#fff;font-family:Inter,sans-serif;padding:48px">' +
    '<h1 style="font-size:48px;margin:0">Overlay Hero</h1>' +
    '<p style="margin-top:16px">Decorated by canvas layers</p>' +
    '<button style="margin-top:32px;padding:14px 24px;min-height:44px">Engage</button>' +
  '</div>';

function makeBase() {
  return { html: baseHtml, audit: false, exports: [] as string[] };
}

// ─── TEST 1: happy path ──
async function testHappyPath(): Promise<void> {
  setupProject();
  const overlayId = 'happy-overlay';
  const result = await handleCompile({
    overlay: {
      overlayId,
      name: 'Happy Overlay',
      base: makeBase(),
      layers: [
        { type: 'noise-grain', config: { intensity: 0.12, speed: 'medium' } },
      ],
    },
  } as any);
  assert(!(result as any).isError, 'happy: not isError');
  const env = extractEnvelope(result);
  assert(env?.kind === 'overlay', `happy: kind=overlay (got ${env?.kind})`);
  assert(env?.overlayId === overlayId, 'happy: overlayId roundtrips');
  assert(env?.name === 'Happy Overlay', 'happy: name roundtrips');
  assert(env?.layerCount === 1, `happy: layerCount=1 (got ${env?.layerCount})`);
  assert(env?.layers?.[0]?.id === 'layer-0', `happy: auto-id (got ${env?.layers?.[0]?.id})`);
  assert(env?.layers?.[0]?.type === 'noise-grain', 'happy: type retained');
  // Default-filled config: intensity user-supplied, speed user-supplied,
  // tint defaults to null.
  assert(env?.layers?.[0]?.config?.intensity === 0.12, 'happy: intensity preserved');
  assert(env?.layers?.[0]?.config?.tint === null, 'happy: tint null default');

  const spec = readOverlaySpec(projectDir, overlayId);
  assert(spec !== null, 'happy: overlay.json on disk');
  assert(spec?.baseSceneId === `${overlayId}-base`, `happy: baseSceneId namespaced (got ${spec?.baseSceneId})`);
  assert(spec?.layers?.length === 1, 'happy: spec carries 1 layer');
  assert(typeof spec?.createdAt === 'string', 'happy: createdAt set');
}

// ─── TEST 2: no_layers ──
async function testNoLayers(): Promise<void> {
  setupProject();
  const result = await handleCompile({
    overlay: {
      overlayId: 'no-layers',
      name: 'Empty',
      base: makeBase(),
      layers: [],
    },
  } as any);
  const err = extractError(result);
  assert(err?.code === 'compile.overlay.no_layers', `no_layers: code = ${err?.code}`);
}

// ─── TEST 3: unknown_layer_type ──
async function testUnknownLayerType(): Promise<void> {
  setupProject();
  const result = await handleCompile({
    overlay: {
      overlayId: 'unknown-type',
      name: 'X',
      base: makeBase(),
      layers: [{ type: 'bogus-layer', config: {} }],
    },
  } as any);
  const err = extractError(result);
  assert(err?.code === 'compile.overlay.unknown_layer_type', `unknown_type: code = ${err?.code}`);
  assert(err?.details?.type === 'bogus-layer', 'unknown_type: details.type echoes input');
  assert(Array.isArray(err?.details?.knownTypes) && err!.details.knownTypes.length === 3, 'unknown_type: details.knownTypes lists 3 known');
}

// ─── TEST 4: invalid_layer_config — intensity out of range ──
async function testInvalidLayerConfig(): Promise<void> {
  setupProject();
  const result = await handleCompile({
    overlay: {
      overlayId: 'invalid-cfg',
      name: 'X',
      base: makeBase(),
      layers: [{ type: 'noise-grain', config: { intensity: 1.5 } }],  // > 1
    },
  } as any);
  const err = extractError(result);
  assert(err?.code === 'compile.overlay.invalid_layer_config', `invalid_cfg: code = ${err?.code}`);
  assert(err?.details?.param === 'intensity', `invalid_cfg: param = intensity (got ${err?.details?.param})`);
  assert(err?.details?.layerIndex === 0, 'invalid_cfg: layerIndex echoes');
}

// ─── TEST 5: too_many_layers ──
async function testTooManyLayers(): Promise<void> {
  setupProject();
  const result = await handleCompile({
    overlay: {
      overlayId: 'too-many',
      name: 'X',
      base: makeBase(),
      layers: [
        { type: 'noise-grain', config: {} },
        { type: 'gradient-pulse', config: {} },
        { type: 'particle-dust', config: {} },
        { type: 'noise-grain', config: {} },  // 4th — exceeds cap
      ],
    },
  } as any);
  const err = extractError(result);
  assert(err?.code === 'compile.overlay.too_many_layers', `too_many: code = ${err?.code}`);
  assert(err?.details?.cap === 3, `too_many: cap = 3 (got ${err?.details?.cap})`);
  assert(err?.details?.count === 4, 'too_many: count = 4');
}

// ─── TEST 6: duplicate_layer_id ──
async function testDuplicateLayerId(): Promise<void> {
  setupProject();
  const result = await handleCompile({
    overlay: {
      overlayId: 'dup-id',
      name: 'X',
      base: makeBase(),
      layers: [
        { id: 'glow', type: 'noise-grain', config: {} },
        { id: 'glow', type: 'gradient-pulse', config: {} },  // dup id
      ],
    },
  } as any);
  const err = extractError(result);
  assert(err?.code === 'compile.overlay.duplicate_layer_id', `duplicate_id: code = ${err?.code}`);
  assert(err?.details?.id === 'glow', 'duplicate_id: id echoes');
}

// ─── TEST 7: invalid_id (regex) ──
async function testInvalidId(): Promise<void> {
  setupProject();
  const badIds = ['has space', 'with/slash', 'wíth-unicode', ''];
  for (const id of badIds) {
    const result = await handleCompile({
      overlay: {
        overlayId: id,
        name: 'X',
        base: makeBase(),
        layers: [{ type: 'noise-grain', config: {} }],
      },
    } as any);
    const err = extractError(result);
    if (id === '') {
      assert(err?.code === 'compile.overlay.missing_id', `empty-id: code = ${err?.code}`);
    } else {
      assert(err?.code === 'compile.overlay.invalid_id', `invalid id "${id}": code = ${err?.code}`);
    }
  }
}

// ─── TEST 8: storage round-trip ──
async function testStorageRoundTrip(): Promise<void> {
  setupProject();
  const overlayId = 'roundtrip-overlay';
  const r = await handleCompile({
    overlay: {
      overlayId,
      name: 'Roundtrip',
      base: makeBase(),
      layers: [
        { type: 'noise-grain', config: { intensity: 0.08, speed: 'slow' } },
        { type: 'particle-dust', config: { count: 80, size: 1.5, speed: 25 } },
      ],
    },
  } as any);
  assert(!(r as any).isError, 'roundtrip: compile ok');

  const env = extractEnvelope(r);
  const spec = readOverlaySpec(projectDir, overlayId);
  assert(spec !== null, 'roundtrip: spec readable');
  assert(spec?.layers?.length === 2, 'roundtrip: 2 layers persisted');
  assert(spec?.layers[0].type === 'noise-grain', 'roundtrip: layer 0 type');
  assert(spec?.layers[0].config.intensity === 0.08, 'roundtrip: layer 0 intensity');
  assert(spec?.layers[0].config.speed === 'slow', 'roundtrip: layer 0 speed');
  assert(spec?.layers[1].type === 'particle-dust', 'roundtrip: layer 1 type');
  assert(spec?.layers[1].config.count === 80, 'roundtrip: layer 1 count rounded');
  assert(env?.layers?.[0].id === spec?.layers[0].id, 'roundtrip: response env id matches disk');
}

// ─── TEST 9: determinism ──
async function testDeterminism(): Promise<void> {
  setupProject();
  const overlayId = 'det';
  const input = {
    overlay: {
      overlayId,
      name: 'D',
      base: makeBase(),
      layers: [
        { id: 'layer-grain', type: 'noise-grain', config: { intensity: 0.1 } },
        { id: 'layer-pulse', type: 'gradient-pulse', config: { cycle: 5000, direction: 'horizontal', colors: ['#1a1a2e', '#16213e'] } },
      ],
    },
  };
  const r1 = await handleCompile(input as any);
  assert(!(r1 as any).isError, 'det: 1st compile ok');
  const file1 = fs.readFileSync(overlaySpecPath(projectDir, overlayId), 'utf-8');
  const parsed1 = JSON.parse(file1);

  // Re-compile in a fresh project dir so disk state doesn't pollute.
  const oldDir = projectDir;
  setupProject();
  const r2 = await handleCompile(input as any);
  assert(!(r2 as any).isError, 'det: 2nd compile ok');
  const file2 = fs.readFileSync(overlaySpecPath(projectDir, overlayId), 'utf-8');
  const parsed2 = JSON.parse(file2);

  // Strip timestamps — they're ALWAYS Date.now()-derived and aren't part
  // of "deterministic given input". The structural deterministic part
  // is the spec body (overlayId, name, baseSceneId, layers).
  delete parsed1.createdAt; delete parsed1.updatedAt;
  delete parsed2.createdAt; delete parsed2.updatedAt;
  assert(
    JSON.stringify(parsed1) === JSON.stringify(parsed2),
    'det: structural spec byte-identical across two compiles',
  );

  // Sanity: original projectDir still readable (not a flake from cleanup).
  assert(fs.existsSync(oldDir), 'det: old project still on disk');
}

// ─── TEST 10: HTML export emits canvas + IIFE registry ──
async function testHtmlExport(): Promise<void> {
  // exportOverlayToHtml takes a SceneGraph, not a compile envelope, so
  // we synthesize one via importFromHtml (same path the standard exporter
  // uses internally).
  const { importFromHtml } = await import('../../../core/src/importers/html.js');
  const baseDoc = '<!DOCTYPE html><html><body>' + baseHtml + '</body></html>';
  const { graph, rootId } = await importFromHtml(baseDoc);

  const layers = [
    { id: 'grain', type: 'noise-grain', config: { intensity: 0.1 } },
    { id: 'pulse', type: 'gradient-pulse', config: { cycle: 6000, colors: ['#1a1a2e', '#0f3460'], direction: 'horizontal' } },
  ];
  const html = exportOverlayToHtml(graph, rootId, layers, ALL_LAYERS_BROWSER_SOURCE, { width: 1280, height: 720 });

  assert(html.includes('<!DOCTYPE html>'), 'html: starts with DOCTYPE');
  assert(html.includes('class="rfd-overlay-root"'), 'html: overlay root wrapper present');
  assert(html.includes('class="rfd-overlay-base"'), 'html: base wrapper present');
  assert(html.includes('data-layer-id="grain"'), 'html: layer-grain canvas emitted');
  assert(html.includes('data-layer-id="pulse"'), 'html: layer-pulse canvas emitted');
  assert(html.includes('factory_noise_grain'), 'html: factory_noise_grain referenced');
  assert(html.includes('factory_gradient_pulse'), 'html: factory_gradient_pulse referenced');
  assert(html.includes('requestAnimationFrame'), 'html: RAF loop present');
  assert(html.includes('seededRng'), 'html: seededRng utility inlined');
  assert(html.includes('mulberry32'), 'html: mulberry32 utility inlined');
  // Width/height applied to wrapper.
  assert(html.includes('width:1280px;height:720px'), 'html: wrapper sized');
  // Canvas pointer-events:none so clicks reach base.
  assert(html.includes('pointer-events:none'), 'html: canvases are click-through');
  // Two canvas elements expected.
  const canvasCount = (html.match(/<canvas\b/g) ?? []).length;
  assert(canvasCount === 2, `html: 2 canvas elements (got ${canvasCount})`);
}

// ─── TEST 11: runtime determinism — factories evaluate + first frame stable ──
async function testRuntimeDeterminism(): Promise<void> {
  // Probe pin #10 (Layer init determinism): the IIFE inlined into HTML
  // must (a) evaluate without runtime errors in a browser-shaped global
  // and (b) produce a deterministic first frame given the same layerId.
  //
  // We can't spin up Playwright for a unit-test, but we CAN evaluate the
  // BROWSER_SOURCE in a fresh Function() context with a minimal canvas
  // mock, call factory_<type> twice with the same layerId, and verify
  // the seeded RNGs produce identical first-pull values.

  // Minimal canvas + ctx + ImageData mock — captures method calls + the
  // first putImageData payload so we can compare runs.
  function makeCanvas(): any {
    const calls: any[] = [];
    let lastImageData: any = null;
    const ctx: any = {
      canvas: { width: 256, height: 256 },
      createImageData(w: number, h: number) {
        return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
      },
      putImageData(img: any) { lastImageData = img; calls.push(['put', img.data.length]); },
      drawImage() { calls.push(['drawImage']); },
      clearRect() { calls.push(['clear']); },
      fillRect() { calls.push(['fillRect']); },
      beginPath() {},
      arc() {},
      fill() {},
      createLinearGradient() { return { addColorStop() {} }; },
      createRadialGradient() { return { addColorStop() {} }; },
      get imageSmoothingEnabled() { return false; },
      set imageSmoothingEnabled(_v: boolean) {},
      get globalAlpha() { return 1; },
      set globalAlpha(_v: number) {},
      get fillStyle() { return ''; },
      set fillStyle(_v: any) {},
    };
    return {
      width: 256,
      height: 256,
      getContext: () => ctx,
      _calls: calls,
      _getLastImage: () => lastImageData,
    };
  }

  // Build a fresh evaluator context. document.createElement('canvas') is
  // referenced by noise-grain for its tiled offscreen — every created
  // canvas pushes its mock into createdCanvases so the test can read back
  // ImageData written by putImageData on the OFFSCREEN tile.
  function buildContext(): { factories: Record<string, any>; createdCanvases: any[] } {
    const createdCanvases: any[] = [];
    const documentMock: any = { createElement: () => { const c = makeCanvas(); createdCanvases.push(c); return c; } };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function('document',
      ALL_LAYERS_BROWSER_SOURCE +
      "; return { factory_noise_grain: factory_noise_grain, factory_gradient_pulse: factory_gradient_pulse, factory_particle_dust: factory_particle_dust };",
    );
    return { factories: fn(documentMock), createdCanvases };
  }

  const ctx1 = buildContext();
  assert(typeof ctx1.factories.factory_noise_grain === 'function', 'runtime: factory_noise_grain defined');
  assert(typeof ctx1.factories.factory_gradient_pulse === 'function', 'runtime: factory_gradient_pulse defined');
  assert(typeof ctx1.factories.factory_particle_dust === 'function', 'runtime: factory_particle_dust defined');

  // Mount noise-grain twice with same layerId. First-frame ImageData
  // (written into offscreen tile via putImageData) should be byte-
  // identical because the seed comes from layerId.
  const main1 = makeCanvas();
  const inst1 = ctx1.factories.factory_noise_grain(main1, { intensity: 0.1 }, { width: 256, height: 256 }, 'layer-grain');
  inst1.render(main1.getContext('2d'), 0);
  // First created canvas is the offscreen tile (factory creates it).
  const img1 = ctx1.createdCanvases[0]?._getLastImage();

  const ctx2 = buildContext();  // fresh eval — proves no shared state
  const main2 = makeCanvas();
  const inst2 = ctx2.factories.factory_noise_grain(main2, { intensity: 0.1 }, { width: 256, height: 256 }, 'layer-grain');
  inst2.render(main2.getContext('2d'), 0);
  const img2 = ctx2.createdCanvases[0]?._getLastImage();

  assert(img1 != null && img2 != null, `runtime: noise-grain produced first frame (img1=${!!img1}, img2=${!!img2})`);
  // Compare the two byte arrays.
  let equal = img1 && img2 && img1.data.length === img2.data.length;
  if (equal) {
    for (let i = 0; i < img1.data.length; i++) {
      if (img1.data[i] !== img2.data[i]) { equal = false; break; }
    }
  }
  assert(!!equal, 'runtime: noise-grain first frame byte-identical for same layerId');

  // Sanity: different layerId → different bytes.
  const ctx3 = buildContext();
  const main3 = makeCanvas();
  const inst3 = ctx3.factories.factory_noise_grain(main3, { intensity: 0.1 }, { width: 256, height: 256 }, 'layer-other-id');
  inst3.render(main3.getContext('2d'), 0);
  const img3 = ctx3.createdCanvases[0]?._getLastImage();
  let differ = false;
  if (img1 && img3) {
    for (let i = 0; i < img1.data.length; i++) {
      if (img1.data[i] !== img3.data[i]) { differ = true; break; }
    }
  }
  assert(differ, 'runtime: different layerId → different first frame bytes (seed actually flows)');
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('T2 #5 Overlay contract\n');

  const tests: Array<[string, () => Promise<void>]> = [
    ['happy path — 1-layer overlay + overlay.json on disk', testHappyPath],
    ['no_layers throws (zero layers)', testNoLayers],
    ['unknown_layer_type throws + lists known types', testUnknownLayerType],
    ['invalid_layer_config (intensity > 1) throws with param detail', testInvalidLayerConfig],
    ['too_many_layers throws (Phase 0 cap = 3)', testTooManyLayers],
    ['duplicate_layer_id throws', testDuplicateLayerId],
    ['invalid_id throws (regex + missing) ', testInvalidId],
    ['storage round-trip — read back identical layers', testStorageRoundTrip],
    ['determinism — structural spec byte-identical across 2 compiles', testDeterminism],
    ['HTML export — canvas elements + IIFE registry inlined', testHtmlExport],
    ['runtime determinism — factory_<type> evals + first frame seeded', testRuntimeDeterminism],
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
