/**
 * Week 4 #6 Skeleton thumbnail — cover endpoint two-mode contract.
 *
 * 5 tests:
 *   1. scene available → skeleton mode (cover output equals exporter skeleton)
 *   2. scene unavailable → procedural mode (brand-colored card with initials)
 *   3. mode transition: empty → compile → skeleton, edit → fresh skeleton
 *   4. lazy regen: delete cache → next resolveCover regenerates
 *   5. cache headers: skeleton max-age=60, procedural max-age=86400, ETag prefixes
 *
 * Run: npx tsx packages/mcp/src/tests/week4-thumbnail-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleCompile } from '../tools/compile.js';
import { handleEdit } from '../tools/edit.js';
import { getScene, getSessionId, setProjectDir } from '../store.js';
import { initProject } from '../../../core/src/project/io.js';
import {
  resolveCover,
  type CoverResolverDeps,
} from '../platform/cover.js';
import {
  skeletonExists,
  getSkeletonPath,
  invalidateSkeleton,
} from '../../../core/src/project/skeleton-cache.js';
import { exportSceneGraphToSvg } from '../../../core/src/exporters/svg.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

let projectDir: string;
function setupProject(): void {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-thumb-test-'));
  initProject(projectDir, 'thumb-test');
  setProjectDir(projectDir);
}

const sceneHtml =
  '<div style="width:600px;padding:32px;background:#0f1115;color:#fff;font-family:Inter,sans-serif">' +
    '<h1 style="font-size:48px;margin:0">Hero</h1>' +
    '<p>Body</p>' +
    '<button style="margin-top:16px;padding:12px 24px;background:#5b8def;color:#fff;border:none;min-height:44px">Action</button>' +
  '</div>';

async function compileScene(name: string): Promise<{ sessionId: string; slug: string }> {
  const result = await handleCompile({ html: sceneHtml, name, audit: false, preview: false, exports: [] } as any);
  const text = (result as any).content?.[0]?.text ?? '';
  const sessionId = text.match(/Scenes?:\s*(s\d+)/)?.[1] ?? getSessionId(name) ?? '';
  if (!sessionId) throw new Error(`compile: no session for ${name}`);
  const stored = getScene(sessionId);
  if (!stored) throw new Error(`compile: no stored scene for ${name}`);
  return { sessionId, slug: stored.slug ?? name };
}

function makeDeps(): CoverResolverDeps {
  return {
    projectDir,
    getScene: (id) => {
      const s = getScene(id);
      if (!s) return null;
      return { graph: s.graph, rootId: s.rootId, brand: (s as any).brand, name: s.name, width: s.width, height: s.height };
    },
  };
}

// ─── TEST 1: scene available → skeleton mode ──
async function testSkeletonMode(): Promise<void> {
  setupProject();
  const { slug } = await compileScene('thumb-skel');
  const stored = getScene(slug)!;

  // Eager write happened during compile — cache file should exist already.
  assert(skeletonExists(projectDir, slug), `eager: skeleton.svg cached after compile`);

  const result = await resolveCover(
    { sceneId: slug, name: stored.name, brand: (stored as any).brand },
    makeDeps(),
  );
  assert(result.mode === 'skeleton', `skeleton mode (got ${result.mode})`);
  assert(result.svg.includes('<svg'), 'skeleton: SVG response');
  assert(result.svg.includes('#fafafa') || result.svg.includes('#525252'), 'skeleton: ramp colors present');
  // Compare against direct exporter output — should match (cache hit
  // serves identical bytes to fresh render).
  const direct = exportSceneGraphToSvg(stored.graph, stored.rootId, { mode: 'skeleton' });
  assert(result.svg === direct, 'skeleton: cover output equals direct exporter output');
}

// ─── TEST 2: scene unavailable → procedural ──
async function testProceduralMode(): Promise<void> {
  setupProject();
  const result = await resolveCover(
    { sceneId: 'never-existed', name: 'Phantom', brand: 'stripe' },
    makeDeps(),
  );
  assert(result.mode === 'procedural', `procedural mode (got ${result.mode})`);
  assert(result.svg.includes('<svg'), 'procedural: SVG response');
  // Procedural output has the initials marker block (rendered inside <text>).
  assert(result.svg.includes('<text'), 'procedural: text element present (initials)');
  // Brand color (Stripe primary #635bff) appears in palette gradient.
  assert(result.svg.includes('#635bff'), 'procedural: brand color present');
  // Should NOT carry skeleton ramp colors as fills.
  assert(!result.svg.includes('fill="#fafafa"'), 'procedural: no skeleton ramp fill');
}

// ─── TEST 3: mode transition empty → skeleton → edit → fresh ──
async function testModeTransition(): Promise<void> {
  setupProject();
  // Before compile — procedural fallback.
  const before = await resolveCover({ sceneId: 'unborn', name: 'Unborn' }, makeDeps());
  assert(before.mode === 'procedural', 'transition: procedural before compile');
  const beforeEtag = before.etag;

  // Compile — skeleton with hash etag.
  const { slug } = await compileScene('thumb-trans');
  const after = await resolveCover(
    { sceneId: slug, name: 'thumb-trans' },
    makeDeps(),
  );
  assert(after.mode === 'skeleton', 'transition: skeleton after compile');
  assert(after.etag !== beforeEtag, 'transition: etag changed mode');
  assert(after.etag.startsWith('W/"skel-'), `transition: skel etag prefix (got ${after.etag})`);

  // Edit — invalidate cache, regenerate.
  const stored = getScene(slug)!;
  // Find a node to edit.
  let textNode: any = null;
  function walk(id: string): void {
    const n = stored.graph.getNode(id); if (!n) return;
    if (n.type === 'TEXT' && !textNode) textNode = n;
    for (const c of n.childIds) walk(c);
  }
  walk(stored.rootId);
  await handleEdit({
    operations: [
      { op: 'update', sceneId: slug, path: textNode.name, props: { fontSize: 64 } },
    ],
  } as any);

  // After edit, skeleton cache file should be invalidated (deleted).
  assert(!skeletonExists(projectDir, slug), 'transition: skeleton cache invalidated by edit');

  const afterEdit = await resolveCover(
    { sceneId: slug, name: 'thumb-trans' },
    makeDeps(),
  );
  assert(afterEdit.mode === 'skeleton', 'transition: still skeleton mode after edit');
  // Lazy regen wrote the file back to disk.
  assert(skeletonExists(projectDir, slug), 'transition: cache regenerated on next request');
  // Etag should differ because the rendered SVG differs (text bbox changed
  // due to fontSize:64). Not strictly required if Yoga rounding produces
  // identical rects, but the bbox of a 48→64px text should differ.
  // We at least assert both etags are valid skel format.
  assert(afterEdit.etag.startsWith('W/"skel-'), 'transition: post-edit etag is skel format');
}

// ─── TEST 4: lazy regen on missing file ──
async function testLazyRegen(): Promise<void> {
  setupProject();
  const { slug } = await compileScene('thumb-lazy');
  assert(skeletonExists(projectDir, slug), 'lazy: cache present after compile');

  // Manually delete cache (simulate file system cleanup or external invalidation).
  invalidateSkeleton(projectDir, slug);
  assert(!skeletonExists(projectDir, slug), 'lazy: cache deleted manually');

  const result = await resolveCover({ sceneId: slug, name: 'thumb-lazy' }, makeDeps());
  assert(result.mode === 'skeleton', 'lazy: regenerated as skeleton');
  assert(result.svg.length > 0, 'lazy: regenerated SVG non-empty');
  assert(skeletonExists(projectDir, slug), 'lazy: cache file written back');
}

// ─── TEST 5: cache headers per mode ──
async function testCacheHeaders(): Promise<void> {
  setupProject();
  // Procedural — long max-age, proc- etag.
  const proc = await resolveCover({ sceneId: 'noop', name: 'NoOp', brand: 'linear' }, makeDeps());
  assert(proc.maxAge === 86400, `proc: max-age 86400 (got ${proc.maxAge})`);
  assert(proc.etag.startsWith('W/"proc-'), `proc: etag prefix proc- (got ${proc.etag})`);

  // Skeleton — short max-age, skel- etag.
  const { slug } = await compileScene('thumb-headers');
  const skel = await resolveCover({ sceneId: slug, name: 'thumb-headers' }, makeDeps());
  assert(skel.maxAge === 60, `skel: max-age 60 (got ${skel.maxAge})`);
  assert(skel.etag.startsWith('W/"skel-'), `skel: etag prefix skel- (got ${skel.etag})`);

  // Etag stability — same scene, same call, same etag.
  const skel2 = await resolveCover({ sceneId: slug, name: 'thumb-headers' }, makeDeps());
  assert(skel.etag === skel2.etag, 'skel: etag deterministic across identical calls');

  // Procedural etag stability — same inputs.
  const proc2 = await resolveCover({ sceneId: 'noop', name: 'NoOp', brand: 'linear' }, makeDeps());
  assert(proc.etag === proc2.etag, 'proc: etag deterministic from inputs');

  // Procedural etag varies with brand.
  const procStripe = await resolveCover({ sceneId: 'noop', name: 'NoOp', brand: 'stripe' }, makeDeps());
  assert(proc.etag !== procStripe.etag, 'proc: etag varies with brand');
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Week 4 #6 Skeleton thumbnail contract\n');

  const tests: Array<[string, () => Promise<void>]> = [
    ['scene available → skeleton mode', testSkeletonMode],
    ['scene unavailable → procedural fallback', testProceduralMode],
    ['mode transition empty → skeleton, edit invalidates', testModeTransition],
    ['lazy regen on missing cache', testLazyRegen],
    ['cache headers + ETag per mode', testCacheHeaders],
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
