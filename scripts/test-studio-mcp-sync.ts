/**
 * Studio ↔ MCP sync — parse inspect audit text, HTTP PUT /scenes revision bump.
 *
 * Run: npx tsx scripts/test-studio-mcp-sync.ts
 *
 * Intentionally starts the HTTP sidecar on TEST_PORT — do not set REFRAME_SKIP_HTTP_SIDECAR.
 * Scripts that only need storeScene + handleInspect should set the skip flag instead (see test-inspect-diff-structured.ts).
 */

import { initYoga } from '../packages/core/src/engine/yoga-init.js';
import { build, frame, solid } from '../packages/core/src/builder.js';
import { serializeSceneNode } from '../packages/core/src/serialize.js';
import { clearScenes, storeScene, listScenes, getScene } from '../packages/mcp/src/store.js';
import { setProjectDir } from '../packages/mcp/src/tools/project.js';
import { startHttpSidecar } from '../packages/mcp/src/http-server.js';
import { parseInspectAuditSection } from '../packages/studio/src/mcp/parse-inspect-audit.ts';
import { createServer } from 'net';

async function pickUnusedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr && 'port' in addr ? addr.port : 0;
      s.close(err => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForHealth(baseUrl: string, timeoutMs = 20000): Promise<void> {
  const health = `${baseUrl}/health`;
  const t0 = Date.now();
  let lastErr: unknown;
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(health);
      if (r.ok) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise<void>(r => setTimeout(r, 50));
  }
  throw new Error(`sidecar not ready at ${health}${lastErr != null ? ` (${String(lastErr)})` : ''}`);
}

function ok(label: string) {
  console.log(`  [OK] ${label}`);
}

function fail(label: string, err: unknown): never {
  console.error(`  [FAIL] ${label}:`, err);
  process.exit(1);
}

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) fail(msg, new Error(msg));
}

async function main() {
  console.log('Studio MCP sync tests\n');

  // ─── Parser (no server) ─────────────────────────────────────
  const passText = `
--- Audit (19 rules) ---
PASS — all checks passed.
`;
  const passParsed = parseInspectAuditSection(passText);
  assert(passParsed.passed && passParsed.issues.length === 0, 'parser: PASS');

  const failText = `
--- Audit (19 rules) ---
Result: FAIL — 1 error, 1 warning, 0 info
[x] contrast-minimum: Contrast 2:1 for "Lbl"
    → reframe_edit: update "Lbl" props: { fills: ["#fafafa"] }
[!] min-touch-target: "Btn" too small
    → reframe_edit: update "Btn" props: { minHeight: 44 }
[i] 2 info-level suggestions (non-blocking)
`;
  const failParsed = parseInspectAuditSection(failText);
  assert(!failParsed.passed, 'parser: should not pass');
  assert(failParsed.issues.length === 2, 'parser: two issues');
  assert(failParsed.issues[0].severity === 'error', 'parser: error severity');
  assert(failParsed.issues[0].rule === 'contrast-minimum', 'parser: rule');
  assert(failParsed.issues[0].nodeId === 'Lbl', 'parser: node from fix');
  assert(failParsed.issues[0].fix?.includes('fills'), 'parser: fix line');
  assert(failParsed.issues[1].severity === 'warning', 'parser: warning');
  assert(failParsed.issues[1].nodeId === 'Btn', 'parser: second node');
  ok('parseInspectAuditSection fixtures');

  // ─── HTTP PUT + revision ──────────────────────────────────
  await initYoga();
  clearScenes();
  setProjectDir(null);

  const { graph, root } = build(
    frame(
      { width: 400, height: 300, name: 'Scene', fills: [solid('#111827')] },
    ),
  );
  const sid = storeScene(graph, root.id, undefined, { name: 'sync-test' });
  assert(listScenes().some(s => s.id === sid), 'scene stored');

  const testPort = await pickUnusedPort();
  const baseUrl = `http://127.0.0.1:${testPort}`;
  startHttpSidecar(testPort);
  await waitForHealth(baseUrl);

  const j0 = await fetch(`${baseUrl}/scenes/${encodeURIComponent(sid)}?format=json`).then(r => r.json()) as {
    revision?: number;
    root?: { width?: number };
  };
  assert(j0.revision === 1, `initial revision 1, got ${j0.revision}`);
  assert(j0.root?.width === 400, 'initial width');

  const rootObj = serializeSceneNode(graph, root.id, { compact: true }) as { width?: number };
  rootObj.width = 440;

  const putRes = await fetch(`${baseUrl}/scenes/${encodeURIComponent(sid)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root: rootObj }),
  });
  const putJson = await putRes.json().catch(() => ({})) as { ok?: boolean; revision?: number; error?: string };
  assert(putRes.ok, `PUT ok: ${putJson.error ?? putRes.status}`);
  assert(putJson.revision === 2, `revision bump 2, got ${putJson.revision}`);

  const j1 = await fetch(`${baseUrl}/scenes/${encodeURIComponent(sid)}?format=json`).then(r => r.json()) as {
    revision?: number;
    root?: { width?: number };
  };
  assert(j1.revision === 2, 'GET json revision after PUT');
  assert(j1.root?.width === 440, 'GET json width after PUT');

  ok(`PUT /scenes/${sid} revision bump + json round-trip`);

  // v1-shaped root (engine fields on JSON node) must be migrated before deserialize — same as Studio/loadSceneJson
  const legacyRoot = {
    type: 'FRAME' as const,
    name: 'Legacy',
    width: 80,
    height: 60,
    horizontalConstraint: 'STRETCH' as const,
    verticalConstraint: 'MAX' as const,
  };
  const putLegacy = await fetch(`${baseUrl}/scenes/${encodeURIComponent(sid)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root: legacyRoot }),
  });
  const putLegJson = await putLegacy.json().catch(() => ({})) as { ok?: boolean; revision?: number; error?: string };
  assert(putLegacy.ok, `PUT legacy-shaped root: ${putLegJson.error ?? putLegacy.status}`);
  assert(putLegJson.revision === 3, `revision after legacy PUT, got ${putLegJson.revision}`);

  const j2 = await fetch(`${baseUrl}/scenes/${encodeURIComponent(sid)}?format=json`).then(r => r.json()) as {
    revision?: number;
    root?: { width?: number; constraints?: { horizontal?: string; vertical?: string } };
  };
  assert(j2.revision === 3, 'GET json revision after legacy PUT');
  assert(j2.root?.width === 80, 'legacy PUT width');
  assert(
    j2.root?.constraints?.horizontal === 'STRETCH' && j2.root?.constraints?.vertical === 'MAX',
    'legacy root stored with normalized constraints',
  );
  ok(`PUT v1-shaped root (migrateScene) on /scenes/${sid}`);

  const miniPng =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const putImgRes = await fetch(`${baseUrl}/scenes/${encodeURIComponent(sid)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      root: { type: 'FRAME', name: 'WithImg', width: 10, height: 10 },
      images: { t1: miniPng },
    }),
  });
  const putImgJson = await putImgRes.json().catch(() => ({})) as { ok?: boolean; revision?: number; error?: string };
  assert(putImgRes.ok, `PUT with images: ${putImgJson.error ?? putImgRes.status}`);
  assert(putImgJson.revision === 4, `revision after images PUT, got ${putImgJson.revision}`);
  const stored = getScene(sid);
  assert(stored !== undefined && stored.graph.images.has('t1'), 'hydrated image hash in session graph');
  assert((stored!.graph.images.get('t1')?.length ?? 0) > 10, 'image bytes decoded');
  ok(`PUT /scenes/${sid} hydrates body.images`);

  // Timeline: PUT body.timeline === null clears; omitting `timeline` preserves (legacy clients).
  const stTl = getScene(sid)!;
  stTl.timeline = { animations: [] };
  const rootForTl = serializeSceneNode(stTl.graph, stTl.rootId, { compact: true }) as { width?: number };
  const putTlNull = await fetch(`${baseUrl}/scenes/${encodeURIComponent(sid)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root: rootForTl, timeline: null, images: { t1: miniPng } }),
  });
  const putTlNullJson = await putTlNull.json().catch(() => ({})) as { ok?: boolean; revision?: number; error?: string };
  assert(putTlNull.ok, `PUT timeline null: ${putTlNullJson.error ?? putTlNull.status}`);
  assert(putTlNullJson.revision === 5, `revision after timeline null PUT, got ${putTlNullJson.revision}`);
  assert(getScene(sid)!.timeline === undefined, 'session timeline cleared after PUT timeline: null');
  ok(`PUT timeline: null clears stored.timeline`);

  const stTl2 = getScene(sid)!;
  stTl2.timeline = { animations: [] };
  const rootPreserve = serializeSceneNode(stTl2.graph, stTl2.rootId, { compact: true });
  const putNoTlKey = await fetch(`${baseUrl}/scenes/${encodeURIComponent(sid)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root: rootPreserve, images: { t1: miniPng } }),
  });
  const putNoTlJson = await putNoTlKey.json().catch(() => ({})) as { ok?: boolean; revision?: number; error?: string };
  assert(putNoTlKey.ok, `PUT without timeline key: ${putNoTlJson.error ?? putNoTlKey.status}`);
  assert(putNoTlJson.revision === 6, `revision after PUT omit timeline, got ${putNoTlJson.revision}`);
  assert(
    getScene(sid)!.timeline !== undefined && Array.isArray(getScene(sid)!.timeline!.animations),
    'omitting timeline key preserves session timeline',
  );
  ok(`PUT without timeline key preserves stored.timeline`);

  const jGet = await fetch(`${baseUrl}/scenes/${encodeURIComponent(sid)}?format=json`).then(r => r.json()) as {
    revision?: number;
    images?: Record<string, string>;
    version?: number;
    timeline?: unknown;
  };
  assert(jGet.revision === 6, 'GET json revision');
  assert(jGet.images && typeof jGet.images.t1 === 'string' && jGet.images.t1.length > 10, 'GET ?format=json returns images map');
  assert(typeof jGet.version === 'number', 'GET json includes envelope version');
  assert(Object.prototype.hasOwnProperty.call(jGet, 'timeline'), 'GET ?format=json includes timeline key');
  assert(
    jGet.timeline != null && typeof jGet.timeline === 'object' && Array.isArray((jGet.timeline as { animations?: unknown }).animations),
    'GET json timeline round-trip when session has timeline',
  );

  clearScenes();
  setProjectDir(null);

  console.log('\nAll studio MCP sync checks passed.');
}

main().catch(e => fail('unhandled', e));
