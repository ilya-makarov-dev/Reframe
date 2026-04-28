/**
 * Week 4 #8 Babel-standalone live React preview contract.
 *
 * 5 tests:
 *   1. endpoint structure — vendor scripts + Babel block + root div
 *   2. JSX equals exporter output (no hand-rewriting in endpoint)
 *   3. vendor static serving — babel/react/react-dom paths resolve
 *   4. determinism — two GETs identical
 *   5. 404 on missing scene (no procedural fallback)
 *
 * Tests instantiate handlePreviewReact directly via mock req/res rather
 * than spinning up an HTTP server — same pattern as other contracts.
 *
 * Run: npx tsx packages/mcp/src/tests/week4-preview-react-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { handleCompile } from '../tools/compile.js';
import { getScene, getSessionId } from '../store.js';
import { handlePreviewReact } from '../platform/api/preview-react.js';
import { exportToReact } from '../../../core/src/exporters/react.js';
import { StandaloneNode } from '../../../core/src/adapters/standalone/node.js';
import { StandaloneHost } from '../../../core/src/adapters/standalone/adapter.js';
import { setHost } from '../../../core/src/host/context.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

// ─── Mock req/res ────────────────────────────────────────────

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

async function fakeRequest(pathname: string): Promise<MockResponse> {
  const req: any = Object.assign(Readable.from([]), {
    url: pathname,
    method: 'GET',
    headers: {},
  });
  let statusCode = 200;
  const headers: Record<string, string> = {};
  let body = '';
  const res: any = {
    writeHead(code: number, hdrs: Record<string, string>) {
      statusCode = code;
      Object.assign(headers, hdrs);
    },
    end(data: any) {
      if (typeof data === 'string') body = data;
      else if (data) body = String(data);
    },
    statusCode,
    setHeader(k: string, v: string) { headers[k] = v; },
  };
  await handlePreviewReact(req, res);
  return { statusCode, headers, body };
}

async function compileScene(name: string): Promise<{ slug: string }> {
  const html = '<div style="width:600px;padding:32px;background:#fff;color:#111;font-family:Inter,sans-serif">' +
    '<h1 style="font-size:32px;margin:0">Preview test</h1>' +
    '<p>Body</p>' +
    '<button style="margin-top:16px;padding:12px 24px;min-height:44px">Action</button>' +
  '</div>';
  const result = await handleCompile({ html, name, audit: false, preview: false, exports: [] } as any);
  const text = (result as any).content?.[0]?.text ?? '';
  const sessionId = text.match(/Scenes?:\s*(s\d+)/)?.[1] ?? getSessionId(name) ?? '';
  if (!sessionId) throw new Error(`compile: no session for ${name}`);
  const stored = getScene(sessionId);
  if (!stored) throw new Error(`compile: no stored scene for ${name}`);
  return { slug: stored.slug ?? name };
}

// ─── TEST 1: endpoint structure ──
async function testStructure(): Promise<void> {
  const { slug } = await compileScene('rp-struct');
  const r = await fakeRequest(`/platform/preview-react/${slug}`);
  assert(r.statusCode === 200, `200 status (got ${r.statusCode})`);
  assert(r.headers['Content-Type']?.includes('text/html'), 'Content-Type text/html');

  // 3 vendor script tags present.
  assert(r.body.includes('src="/platform/vendor/babel-standalone.min.js"'), 'babel script tag');
  assert(r.body.includes('src="/platform/vendor/react.production.min.js"'), 'react script tag');
  assert(r.body.includes('src="/platform/vendor/react-dom.production.min.js"'), 'react-dom script tag');

  // Root div + babel script type.
  assert(r.body.includes('<div id="root">'), 'root div present');
  assert(/<script type="text\/babel"[^>]*>/.test(r.body), 'babel script type');
  assert(r.body.includes('ReactDOM.createRoot'), 'createRoot call wired');
  assert(r.body.includes('React.createElement(Scene)'), 'mount Scene component');

  // Scene component definition emitted.
  assert(r.body.includes('function Scene') || r.body.includes('Scene = ') || r.body.includes('const Scene'),
    'Scene component defined in body');
  // No `export default` left from the exporter (Babel-standalone non-module mode).
  assert(!/export\s+default\s+\w+\s*;?\s*\n/m.test(r.body), 'export default stripped');
}

// ─── TEST 2: JSX equals exporter output ──
async function testJsxEqualsExporter(): Promise<void> {
  const { slug } = await compileScene('rp-equiv');
  const stored = getScene(slug)!;
  const root = stored.graph.getNode(stored.rootId)!;
  const host = new StandaloneHost(stored.graph);
  setHost(host);
  const wrappedRoot = new StandaloneNode(stored.graph, root) as any;
  const direct = exportToReact(wrappedRoot, {
    typescript: false,
    cssModules: false,
    componentName: 'Scene',
  });
  // Mirror the endpoint's strip pipeline (imports + export default).
  // The endpoint runs the same regex pair before embedding, so this is
  // what should appear verbatim inside the body.
  const directBody = direct
    .replace(/^\s*import\s+[^;]+;?\s*$/gm, '')
    .replace(/^\s*export\s+default\s+\w+\s*;?\s*$/m, '')
    .trim();

  const r = await fakeRequest(`/platform/preview-react/${slug}`);
  // Endpoint embeds the directBody verbatim — the test asserts the body
  // content contains every line of the direct exporter output (the
  // surrounding HTML wraps it but doesn't mutate the JSX itself).
  // Pick a recognizable JSX fragment that should appear unchanged.
  assert(r.body.includes(directBody), 'endpoint embeds exporter JSX byte-equal');
}

// ─── TEST 3: vendor file presence (resolved from node_modules) ──
async function testVendorFiles(): Promise<void> {
  const cwd = process.cwd();
  const checks = [
    { name: 'babel-standalone', file: path.join(cwd, 'node_modules', '@babel', 'standalone', 'babel.min.js') },
    { name: 'react umd prod', file: path.join(cwd, 'node_modules', 'react', 'umd', 'react.production.min.js') },
    { name: 'react-dom umd prod', file: path.join(cwd, 'node_modules', 'react-dom', 'umd', 'react-dom.production.min.js') },
  ];
  for (const c of checks) {
    assert(fs.existsSync(c.file), `${c.name} file exists at ${c.file}`);
    if (fs.existsSync(c.file)) {
      const stat = fs.statSync(c.file);
      assert(stat.size > 1000, `${c.name} non-empty (${stat.size} bytes)`);
    }
  }
  // Read babel head for sanity — should look like a JS bundle.
  const babelBytes = fs.readFileSync(checks[0].file, 'utf8').slice(0, 4096);
  assert(/babel|jsx|transform/i.test(babelBytes), 'babel bundle has identifiable markers in first 4KB');
}

// ─── TEST 4: determinism ──
async function testDeterminism(): Promise<void> {
  const { slug } = await compileScene('rp-det');
  const a = await fakeRequest(`/platform/preview-react/${slug}`);
  const b = await fakeRequest(`/platform/preview-react/${slug}`);
  assert(a.body === b.body, `body byte-identical across calls (a=${a.body.length} b=${b.body.length})`);
  assert(a.headers['Content-Type'] === b.headers['Content-Type'], 'Content-Type identical');
  assert(a.headers['Cache-Control'] === b.headers['Cache-Control'], 'Cache-Control identical');
}

// ─── TEST 5: 404 on missing scene ──
async function testMissingScene(): Promise<void> {
  const r = await fakeRequest('/platform/preview-react/never-existed-123');
  assert(r.statusCode === 404, `404 for missing scene (got ${r.statusCode})`);
  assert(r.body.includes('Scene not found'), 'human-readable 404 body');
  assert(!r.body.includes('proc-'), 'no procedural fallback (different from /cover/)');
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Week 4 #8 Live React preview contract\n');
  const tests: Array<[string, () => Promise<void>]> = [
    ['endpoint structure — vendor + babel script + root div', testStructure],
    ['JSX matches exporter byte-equal', testJsxEqualsExporter],
    ['vendor files resolved from node_modules', testVendorFiles],
    ['determinism — two GETs identical', testDeterminism],
    ['404 on missing scene (no procedural fallback)', testMissingScene],
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
