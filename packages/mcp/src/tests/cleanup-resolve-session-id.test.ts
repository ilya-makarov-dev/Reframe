/**
 * Cleanup pass — `resolveSessionId(idOrSlug): string | null` utility.
 *
 * 5 unit tests:
 *   1. direct sessionId lookup (memory hit)
 *   2. slug → sessionId via slugIndex (memory hit)
 *   3. cold-start disk load (scene on disk, not in memory)
 *   4. unknown id returns null (no throw)
 *   5. idempotency — second call resolves entirely from memory
 *      (verified via state of slugIndex after first call)
 *
 * Run: npx tsx packages/mcp/src/tests/cleanup-resolve-session-id.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  resolveSessionId,
  storeScene,
  setProjectDir,
  clearScenes,
  getScene,
  findSessionId,
} from '../store.js';
import { initProject } from '../../../core/src/project/io.js';
import { handleCompile } from '../tools/compile.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

let projectDir: string;
function setupProject(): void {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-resolve-test-'));
  initProject(projectDir, 'resolve-test');
  setProjectDir(projectDir);
  process.env.REFRAME_WORKSPACE = projectDir;
  clearScenes();
}

const sceneHtml = '<div style="width:300px;background:#fff"><h1>Test</h1></div>';

async function compileScene(name: string): Promise<{ sessionId: string; slug: string }> {
  const result = await handleCompile({ html: sceneHtml, name, audit: false, preview: false, exports: [] } as any);
  const text = (result as any).content?.[0]?.text ?? '';
  const sessionId = text.match(/Scenes?:\s*(s\d+)/)?.[1] ?? '';
  if (!sessionId) throw new Error(`compile: no session for ${name}`);
  const stored = getScene(sessionId);
  if (!stored) throw new Error(`compile: no stored scene for ${name}`);
  return { sessionId, slug: stored.slug ?? name };
}

// ─── TEST 1: direct sessionId lookup ──
async function testDirectSessionIdLookup(): Promise<void> {
  setupProject();
  const { sessionId } = await compileScene('direct-id');
  const resolved = resolveSessionId(sessionId);
  assert(resolved === sessionId, `direct: returns sessionId as-is (got ${resolved})`);
}

// ─── TEST 2: slug → sessionId via slugIndex ──
async function testSlugLookup(): Promise<void> {
  setupProject();
  const { sessionId, slug } = await compileScene('slug-lookup');
  const resolved = resolveSessionId(slug);
  assert(resolved === sessionId, `slug: maps to sessionId (slug=${slug}, expected=${sessionId}, got=${resolved})`);
}

// ─── TEST 3: cold-start disk load ──
async function testColdStartDiskLoad(): Promise<void> {
  setupProject();
  // Compile + persist to disk.
  const { slug } = await compileScene('cold-start');
  // Verify file exists on disk.
  const diskPath = path.join(projectDir, '.reframe', 'scenes', `${slug}.scene.json`);
  assert(fs.existsSync(diskPath), `cold-start: disk file present at ${diskPath}`);

  // Wipe in-memory state to simulate fresh sidecar start.
  clearScenes();
  setProjectDir(projectDir); // re-prime project dir after clear
  assert(findSessionId(slug) === undefined, 'cold-start: memory empty after clearScenes');

  // resolveSessionId should load from disk + register.
  const resolved = resolveSessionId(slug);
  assert(resolved !== null, `cold-start: resolveSessionId returned non-null (got ${resolved})`);
  if (resolved) {
    const stored = getScene(resolved);
    assert(stored !== undefined, 'cold-start: scene now in memory');
    assert(stored?.slug === slug, `cold-start: registered with EXACT slug (no -1 suffix; got ${stored?.slug})`);
  }
}

// ─── TEST 4: unknown id returns null ──
async function testUnknownReturnsNull(): Promise<void> {
  setupProject();
  const resolved = resolveSessionId('never-existed');
  assert(resolved === null, `unknown: returns null (got ${resolved})`);
  // Also exercise the no-throw guarantee: reasonable garbage strings are
  // common in URL params; the resolver must never crash a request handler.
  assert(resolveSessionId('') === null, 'unknown: empty string returns null');
  assert(resolveSessionId('weird/path/with/slashes') === null, 'unknown: unusual chars return null');
}

// ─── TEST 5: idempotency — second call hits cache ──
async function testIdempotency(): Promise<void> {
  setupProject();
  const { slug } = await compileScene('idempotent');
  // Wipe memory to force first call to load from disk.
  clearScenes();
  setProjectDir(projectDir);
  // First call: loads from disk, registers in slugIndex.
  const r1 = resolveSessionId(slug);
  assert(r1 !== null, 'idempotent: first call resolves via disk');
  assert(findSessionId(slug) !== undefined, 'idempotent: slugIndex populated after first call');
  // Second call: must hit memory only (slugIndex now has it).
  const r2 = resolveSessionId(slug);
  assert(r2 === r1, `idempotent: second call returns same sessionId (r1=${r1}, r2=${r2})`);

  // Side-channel proof: delete the disk file. If second call had still
  // loaded from disk, it would now miss. But it should still resolve
  // because slugIndex is cached.
  const diskPath = path.join(projectDir, '.reframe', 'scenes', `${slug}.scene.json`);
  fs.unlinkSync(diskPath);
  const r3 = resolveSessionId(slug);
  assert(r3 === r1, `idempotent: post-disk-delete still resolves from memory (got ${r3})`);
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Cleanup — resolveSessionId utility unit tests\n');
  const tests: Array<[string, () => Promise<void>]> = [
    ['direct sessionId lookup', testDirectSessionIdLookup],
    ['slug → sessionId via slugIndex', testSlugLookup],
    ['cold-start disk load (scene on disk, not in memory)', testColdStartDiskLoad],
    ['unknown id returns null (no throw)', testUnknownReturnsNull],
    ['idempotency — second call resolves from memory', testIdempotency],
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
