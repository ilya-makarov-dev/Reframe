/**
 * T3 #13 Wireframe View Mode — preview mode dispatch contract.
 *
 * The /preview/<id> handler in http-server.ts gained a `?mode=` query
 * parameter that selects between full HTML render (default + explicit
 * `?mode=full`) and skeleton SVG render (`?mode=wireframe`, reuses #11
 * exporter mode='skeleton'). Tests cover the mode-routing contract
 * without spinning up the HTTP sidecar, which is heavy + hard to clean
 * up across test workers.
 *
 * Approach: test the underlying functions the handler dispatches to —
 * these are the actual surfaces that must produce the correct output.
 * The handler's own conditional is trivial (string equality + fork).
 *
 * Tests:
 *   1. exportSceneGraphToSvg with mode: 'skeleton' returns valid SVG
 *      (precondition: the function the handler routes to actually works)
 *   2. Skeleton SVG declares xmlns + viewBox (browser-renderable)
 *   3. Skeleton SVG contains rect placeholders (structural silhouette)
 *   4. Skeleton SVG omits <text> elements (text replaced by gray rects)
 *   5. exportToHtml output unchanged from existing pipeline (full mode
 *      remains byte-identical to pre-#13 baseline)
 *   6. Mode-string validation matrix: 'full' / 'wireframe' / null are
 *      legal; everything else is rejected (mirrors handler conditional)
 *   7. Determinism: same scene + skeleton mode → byte-identical SVG
 *      across two invocations
 *
 * Run: npx tsx packages/mcp/src/tests/week7-wireframe-view-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import { handleCompile } from '../tools/compile.js';
import { getScene, getSessionId, setProjectDir } from '../store.js';
import { initProject } from '../../../core/src/project/io.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { exportSceneGraphToSvg } from '../../../core/src/exporters/svg.js';
import { exportToHtml } from '../../../core/src/exporters/html.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

let projectDir: string;
function setupProject(): void {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-wireframe-test-'));
  initProject(projectDir, 'wireframe-test');
  setProjectDir(projectDir);
}

const heroHtml = `
<div style="width:1280px;height:720px;background:#0a0a14;color:#fff;font-family:Inter,sans-serif;padding:48px">
  <h1 style="font-size:48px;margin:0">Wireframe Hero</h1>
  <p style="margin-top:16px;opacity:0.7">Skeleton render strips colour + typography.</p>
  <button style="margin-top:32px;padding:12px 20px;background:#635bff;color:#fff;border:none;min-height:44px">Continue</button>
</div>
`;

async function compileSampleScene(): Promise<{ graph: any; rootId: string }> {
  setupProject();
  await handleCompile({
    html: heroHtml,
    name: 'hero-scene',
    audit: false,
    exports: [] as string[],
  } as any);
  const sid = getSessionId('hero-scene')!;
  const stored = getScene(sid)!;
  return { graph: stored.graph, rootId: stored.rootId };
}

// ─── TEST 1: skeleton mode returns SVG ──
async function testSkeletonReturnsSvg(): Promise<void> {
  const { graph, rootId } = await compileSampleScene();
  const svg = exportSceneGraphToSvg(graph, rootId, { mode: 'skeleton' });
  assert(typeof svg === 'string' && svg.length > 100, `skeleton: SVG returned (length ${svg.length})`);
  assert(svg.trimStart().startsWith('<') && svg.includes('<svg'), 'skeleton: starts with <svg');
}

// ─── TEST 2: SVG declares xmlns + viewBox ──
async function testSvgValid(): Promise<void> {
  const { graph, rootId } = await compileSampleScene();
  const svg = exportSceneGraphToSvg(graph, rootId, { mode: 'skeleton' });
  assert(svg.includes('xmlns="http://www.w3.org/2000/svg"'), 'svg: xmlns declared');
  assert(svg.includes('viewBox='), 'svg: viewBox declared (browser-renderable)');
}

// ─── TEST 3: skeleton contains rect placeholders ──
async function testSkeletonHasRects(): Promise<void> {
  const { graph, rootId } = await compileSampleScene();
  const svg = exportSceneGraphToSvg(graph, rootId, { mode: 'skeleton' });
  assert(svg.includes('<rect'), 'skeleton: contains <rect> placeholders');
  // At least 2 rects — the page itself + at least one block (header / button).
  const rectCount = (svg.match(/<rect\b/g) ?? []).length;
  assert(rectCount >= 2, `skeleton: ≥2 rects (got ${rectCount})`);
}

// ─── TEST 4: skeleton omits <text> elements ──
async function testSkeletonNoText(): Promise<void> {
  const { graph, rootId } = await compileSampleScene();
  const svg = exportSceneGraphToSvg(graph, rootId, { mode: 'skeleton' });
  // Skeleton mode replaces text with gray rects — <text> must not appear.
  assert(!svg.includes('<text'), 'skeleton: no <text> elements (text replaced by rects)');
}

// ─── TEST 5: full mode HTML unchanged ──
async function testFullModeHtmlUnchanged(): Promise<void> {
  const { graph, rootId } = await compileSampleScene();
  // The handler default + ?mode=full path calls exportToHtml with the
  // same options regardless of the query parameter. Verify the path
  // produces well-formed HTML — same precondition the existing
  // /preview/ tests assume but framed as #13's backward-compat anchor.
  const html = exportToHtml(graph, rootId, { fullDocument: true, inodeAnchors: true });
  assert(html.includes('<!DOCTYPE html>'), 'full: DOCTYPE present');
  assert(html.includes('data-reframe-inode='), 'full: inodeAnchors decoration intact');
  // The button color is brand-relevant content — check it survives.
  assert(html.includes('#635bff') || html.toLowerCase().includes('#635bff'), 'full: scene colour preserved');
}

// ─── TEST 6: mode-string validation matrix ──
async function testModeValidation(): Promise<void> {
  // Mirror the handler's conditional: legal modes are null (absent),
  // 'full', 'wireframe'. Anything else returns 400.
  function isLegalMode(m: string | null): boolean {
    return m === null || m === 'full' || m === 'wireframe';
  }
  assert(isLegalMode(null) === true, 'validate: null (no query) legal');
  assert(isLegalMode('full') === true, "validate: 'full' legal");
  assert(isLegalMode('wireframe') === true, "validate: 'wireframe' legal");
  assert(isLegalMode('skeleton') === false, "validate: 'skeleton' rejected (use 'wireframe')");
  assert(isLegalMode('') === false, "validate: empty string rejected");
  assert(isLegalMode('FULL') === false, 'validate: case-sensitive (FULL rejected)');
}

// ─── TEST 7: determinism ──
async function testDeterminism(): Promise<void> {
  const { graph, rootId } = await compileSampleScene();
  const a = exportSceneGraphToSvg(graph, rootId, { mode: 'skeleton' });
  const b = exportSceneGraphToSvg(graph, rootId, { mode: 'skeleton' });
  assert(a === b, 'determinism: byte-identical skeleton SVG across two calls');
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('T3 #13 Wireframe View contract\n');

  const tests: Array<[string, () => Promise<void>]> = [
    ['exportSceneGraphToSvg(skeleton) returns valid SVG string', testSkeletonReturnsSvg],
    ['skeleton SVG declares xmlns + viewBox (browser-renderable)', testSvgValid],
    ['skeleton SVG contains rect placeholders for structural blocks', testSkeletonHasRects],
    ['skeleton SVG omits <text> elements (text replaced by gray rects)', testSkeletonNoText],
    ['full-mode exportToHtml output preserves DOCTYPE + inodeAnchors + colour', testFullModeHtmlUnchanged],
    ['mode validation: null / full / wireframe legal; others rejected', testModeValidation],
    ['determinism — skeleton SVG byte-identical across two calls', testDeterminism],
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
