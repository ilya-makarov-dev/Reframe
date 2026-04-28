/**
 * Week 5 #21 Brand-mark first-class — storage / parser / endpoint /
 * inliner contract.
 *
 * 6 tests:
 *   1. parse — ## Brand Mark section → DesignSystem.brandMark
 *   2. multi-variant discovery
 *   3. endpoint serves SVG
 *   4. endpoint 404 cases (missing brand, missing variant)
 *   5. bundle inliner replaces /platform/api/brand/.../mark/... with data: URI
 *   6. bundle inliner graceful when file missing
 *
 * Run: npx tsx packages/mcp/src/tests/week5-brand-mark-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Readable } from 'node:stream';
import { handleCompile } from '../tools/compile.js';
import { getScene, getSessionId, setProjectDir } from '../store.js';
import { initProject } from '../../../core/src/project/io.js';
import { parseDesignMd } from '../../../core/src/design-system/parser.js';
import { handleBrandMarkApi } from '../platform/api/brand-mark.js';
import { exportSceneGraphToBundle } from '../../../core/src/exporters/bundle.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

let projectDir: string;
function setupProject(): void {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-brand-mark-test-'));
  initProject(projectDir, 'bm-test');
  setProjectDir(projectDir);
  process.env.REFRAME_WORKSPACE = projectDir;
}

const FAKE_SVG_PRIMARY = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#635bff"/><text x="50" y="60" text-anchor="middle" fill="#fff">P</text></svg>';
const FAKE_SVG_MONO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#000"/><text x="50" y="60" text-anchor="middle" fill="#fff">M</text></svg>';
const FAKE_SVG_DARK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#1a1a1a"/></svg>';

function depositMark(brand: string, variant: string, svg: string): void {
  const dir = path.join(projectDir, '.reframe', 'brands', brand, 'marks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${variant}.svg`), svg, 'utf8');
}

// ─── Mock req/res for endpoint ───────────────────────────────

interface MockResponse { statusCode: number; headers: Record<string, string>; body: string; }

async function fakeRequest(pathname: string, headers: Record<string, string> = {}): Promise<MockResponse> {
  const req: any = Object.assign(Readable.from([]), { url: pathname, method: 'GET', headers });
  let statusCode = 200;
  const respHeaders: Record<string, string> = {};
  let body = '';
  const res: any = {
    writeHead(code: number, hdrs: Record<string, string>) { statusCode = code; Object.assign(respHeaders, hdrs); },
    end(d: any) { if (d) body = String(d); },
    setHeader(k: string, v: string) { respHeaders[k] = v; },
  };
  await handleBrandMarkApi(req, res, { projectDir } as any);
  return { statusCode, headers: respHeaders, body };
}

// ─── TEST 1: parse single primary variant ──
async function testParseSinglePrimary(): Promise<void> {
  setupProject();
  depositMark('test-brand', 'primary', FAKE_SVG_PRIMARY);
  const designMd = `# Test Brand DESIGN.md

## Brand Mark

Variants available:
- primary: marks/primary.svg

Default: primary

Usage:
- primary on neutral backgrounds
`;
  const ds = parseDesignMd(designMd);
  assert(ds.brandMark !== undefined, 'parse: brandMark present');
  assert(ds.brandMark!.variants.length === 1, `parse: 1 variant (got ${ds.brandMark!.variants.length})`);
  assert(ds.brandMark!.variants[0] === 'primary', 'parse: variant name = primary');
  assert(ds.brandMark!.defaultVariant === 'primary', 'parse: default = primary');
  assert(ds.brandMark!.paths.primary === 'marks/primary.svg', 'parse: path stored');
}

// ─── TEST 2: multi-variant discovery ──
async function testParseMultiVariant(): Promise<void> {
  setupProject();
  depositMark('multi', 'primary', FAKE_SVG_PRIMARY);
  depositMark('multi', 'mono', FAKE_SVG_MONO);
  depositMark('multi', 'dark', FAKE_SVG_DARK);
  const designMd = `# Multi DESIGN.md

## Brand Mark

Variants available:
- primary: marks/primary.svg
- mono: marks/mono.svg
- dark: marks/dark.svg

Default: mono
`;
  const ds = parseDesignMd(designMd);
  assert(ds.brandMark !== undefined, 'multi: brandMark present');
  assert(ds.brandMark!.variants.length === 3, `multi: 3 variants (got ${ds.brandMark!.variants.length})`);
  assert(ds.brandMark!.variants.includes('primary'), 'multi: primary in variants');
  assert(ds.brandMark!.variants.includes('mono'), 'multi: mono in variants');
  assert(ds.brandMark!.variants.includes('dark'), 'multi: dark in variants');
  assert(ds.brandMark!.defaultVariant === 'mono', `multi: default = mono (explicit override, got ${ds.brandMark!.defaultVariant})`);

  // Section absent → brandMark undefined.
  const dsNoMark = parseDesignMd('# Brand X\n\n## Color Palette\nprimary: #fff\n');
  assert(dsNoMark.brandMark === undefined, 'no section: brandMark undefined');
}

// ─── TEST 3: endpoint serves SVG ──
async function testEndpointServesSvg(): Promise<void> {
  setupProject();
  depositMark('stripe', 'primary', FAKE_SVG_PRIMARY);
  const r = await fakeRequest('/platform/api/brand/stripe/mark/primary');
  assert(r.statusCode === 200, `endpoint: 200 (got ${r.statusCode})`);
  assert(r.headers['Content-Type']?.includes('image/svg+xml'), `endpoint: Content-Type svg+xml (got ${r.headers['Content-Type']})`);
  assert(r.body === FAKE_SVG_PRIMARY, 'endpoint: body matches file');
  assert(r.headers['Cache-Control']?.includes('86400'), 'endpoint: 24h cache header');
  assert(r.headers['ETag']?.startsWith('W/"mark-'), `endpoint: ETag prefix mark- (got ${r.headers['ETag']})`);

  // ETag stable across calls.
  const r2 = await fakeRequest('/platform/api/brand/stripe/mark/primary');
  assert(r.headers['ETag'] === r2.headers['ETag'], 'endpoint: ETag deterministic');

  // If-None-Match → 304.
  const r304 = await fakeRequest('/platform/api/brand/stripe/mark/primary', { 'if-none-match': r.headers['ETag'] });
  assert(r304.statusCode === 304, `endpoint: 304 on matching ETag (got ${r304.statusCode})`);
}

// ─── TEST 4: 404 cases ──
async function test404Cases(): Promise<void> {
  setupProject();
  depositMark('exists', 'primary', FAKE_SVG_PRIMARY);

  // Missing brand.
  const r1 = await fakeRequest('/platform/api/brand/missing/mark/primary');
  assert(r1.statusCode === 404, `missing brand: 404 (got ${r1.statusCode})`);

  // Existing brand, missing variant.
  const r2 = await fakeRequest('/platform/api/brand/exists/mark/never-deposited');
  assert(r2.statusCode === 404, `missing variant: 404 (got ${r2.statusCode})`);

  // Non-SVG file in marks/ — variant lookup is `<variant>.svg` only.
  // Drop a .png and try to GET mark/png-thing → must 404 (no .svg file).
  const dir = path.join(projectDir, '.reframe', 'brands', 'exists', 'marks');
  fs.writeFileSync(path.join(dir, 'png-thing.png'), 'not-an-svg');
  const r3 = await fakeRequest('/platform/api/brand/exists/mark/png-thing');
  assert(r3.statusCode === 404, `non-svg sibling: 404 (got ${r3.statusCode})`);
}

// ─── TEST 5: bundle inliner replaces brand-mark URL with data URI ──
async function testBundleInlineMark(): Promise<void> {
  setupProject();
  depositMark('inline-brand', 'primary', FAKE_SVG_PRIMARY);

  // Compile a scene whose <img> points at the brand-mark endpoint URL.
  const html = '<div style="width:300px;background:#fff"><img src="/platform/api/brand/inline-brand/mark/primary" alt="Logo" style="width:100px;height:100px"></div>';
  await handleCompile({ html, name: 'mark-bundle', audit: false, preview: false, exports: [] } as any);
  const sid = getSessionId('mark-bundle')!;
  const stored = getScene(sid)!;

  const result = await exportSceneGraphToBundle(stored.graph, stored.rootId, {
    projectDir,
  });
  assert(result.html.includes('data:image/svg+xml;base64,'), 'bundle: data URI emitted');
  assert(!result.html.includes('/platform/api/brand/inline-brand/mark/primary'), 'bundle: original URL removed');
  // Decode base64 and confirm it's our SVG.
  const m = result.html.match(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/);
  assert(m !== null, 'bundle: base64 segment found');
  if (m) {
    const decoded = Buffer.from(m[1], 'base64').toString('utf8');
    assert(decoded === FAKE_SVG_PRIMARY, 'bundle: base64 round-trips to original SVG');
  }
  assert(result.inlinedAssets.images >= 1, `bundle: at least 1 image counted as inlined (got ${result.inlinedAssets.images})`);
}

// ─── TEST 6: bundle inliner graceful when file missing ──
async function testBundleInlineMissing(): Promise<void> {
  setupProject();
  // No marks/ deposited for "phantom" brand.
  const html = '<div style="width:300px;background:#fff"><img src="/platform/api/brand/phantom/mark/primary" alt="Missing" style="width:50px;height:50px"></div>';
  await handleCompile({ html, name: 'mark-missing', audit: false, preview: false, exports: [] } as any);
  const sid = getSessionId('mark-missing')!;
  const stored = getScene(sid)!;

  const result = await exportSceneGraphToBundle(stored.graph, stored.rootId, {
    projectDir,
  });
  // No crash; URL kept as-is.
  assert(result.html.includes('/platform/api/brand/phantom/mark/primary'), 'graceful: URL kept as-is');
  assert(!result.html.includes('data:image/svg+xml'), 'graceful: no data URI emitted');
  assert(result.warnings.some((w) => w.includes('Brand mark') && w.includes('phantom')), 'graceful: warning emitted');
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Week 5 #21 Brand-mark contract\n');
  const tests: Array<[string, () => Promise<void>]> = [
    ['parse single primary variant', testParseSinglePrimary],
    ['parse multi-variant + explicit default', testParseMultiVariant],
    ['endpoint serves SVG with ETag + 304', testEndpointServesSvg],
    ['endpoint 404: missing brand / missing variant / non-svg', test404Cases],
    ['bundle inliner inlines /platform/api/brand/.../mark/... as data URI', testBundleInlineMark],
    ['bundle inliner graceful when brand-mark file missing', testBundleInlineMissing],
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
