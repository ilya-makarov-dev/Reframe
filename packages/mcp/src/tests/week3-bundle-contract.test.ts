/**
 * Week 3 #3 Bundle + #18 SRI strip — single-file portable HTML contract.
 *
 * 9 tests:
 *   1. happy path local-only — no externals, no inlining work
 *   2. inline fonts — @font-face emitted from Google Fonts CSS, link removed
 *   3. inline images — <img src> rewritten to data: URI
 *   4. SRI stripping — integrity attr gone on inlined link
 *   5. external fallback when fetch fails — fallback chain still rendered
 *   6. resource cache — same URL fetched once, used many times
 *   7. annotations preserved — Caveat font inlined, spans intact
 *   8. determinism — two calls produce byte-identical output
 *   9. URL classification — 5 image URL classes handled per spec
 *
 * Run: npx tsx packages/mcp/src/tests/week3-bundle-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import { handleCompile } from '../tools/compile.js';
import { handleEdit } from '../tools/edit.js';
import { getScene, getSessionId } from '../store.js';
import {
  exportSceneGraphToBundle,
  collectUsedVariants,
} from '../../../core/src/exporters/bundle.js';
import {
  isGoogleFontUrl,
  type ResourceFetcher,
} from '../../../core/src/exporters/inline-fonts.js';
import { stripSriAttrs } from '../../../core/src/exporters/sri-strip.js';
import { classifyUrl } from '../../../core/src/exporters/inline-images.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

async function compileScene(name: string, html: string): Promise<{ sessionId: string }> {
  const result = await handleCompile({ html, name, audit: false, preview: false, exports: [] } as any);
  const text = (result as any).content?.[0]?.text ?? '';
  const sessionId = text.match(/Scenes?:\s*(s\d+)/)?.[1] ?? getSessionId(name) ?? '';
  if (!sessionId) throw new Error(`compileScene: no session for ${name}`);
  if (!getScene(sessionId)) throw new Error(`compileScene: no stored scene for ${name}`);
  return { sessionId };
}

// ─── Mock fetcher ───────────────────────────────────────────

interface MockSpec {
  text?: Map<string, string | (() => string | Promise<string>)>;
  binary?: Map<string, Uint8Array | (() => Uint8Array | Promise<Uint8Array>)>;
}

function makeMockFetcher(spec: MockSpec): ResourceFetcher & { textCalls: string[]; binaryCalls: string[] } {
  const textCalls: string[] = [];
  const binaryCalls: string[] = [];
  return {
    textCalls,
    binaryCalls,
    async fetchText(url) {
      textCalls.push(url);
      const v = spec.text?.get(url);
      if (v === undefined) throw new Error(`mock: no text for ${url}`);
      return typeof v === 'function' ? await v() : v;
    },
    async fetchBinary(url) {
      binaryCalls.push(url);
      const v = spec.binary?.get(url);
      if (v === undefined) throw new Error(`mock: no binary for ${url}`);
      return typeof v === 'function' ? await v() : v;
    },
  };
}

const fakeWoff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0xfa, 0xfa, 0xbe, 0xbe, 0x01, 0x02]);
const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde, 0xad, 0xbe, 0xef]);

const interCss = `
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v1/inter-400.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v1/inter-700.woff2) format('woff2');
}
@font-face {
  font-family: 'Inter';
  font-style: italic;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v1/inter-400i.woff2) format('woff2');
}
`;

// ─── TEST 1: happy local-only ──
async function testLocalOnly(): Promise<void> {
  const { sessionId } = await compileScene(
    'bundle-local',
    '<div style="width:300px;padding:24px;background:#fff;color:#111;font-family:system-ui">Local only</div>',
  );
  const stored = getScene(sessionId)!;
  // Use a mock fetcher that has nothing — confirms no fetches happen.
  const mock = makeMockFetcher({});
  const result = await exportSceneGraphToBundle(stored.graph, stored.rootId, { fetcher: mock });
  assert(typeof result.html === 'string' && result.html.length > 0, 'local: html present');
  assert(result.inlinedAssets.fonts === 0, `local: 0 fonts inlined (got ${result.inlinedAssets.fonts})`);
  assert(result.inlinedAssets.images === 0, `local: 0 images inlined (got ${result.inlinedAssets.images})`);
  assert(mock.textCalls.length === 0, `local: 0 text fetches (got ${mock.textCalls.length})`);
  assert(mock.binaryCalls.length === 0, `local: 0 binary fetches (got ${mock.binaryCalls.length})`);
}

// ─── TEST 2: inline fonts ──
async function testInlineFonts(): Promise<void> {
  const { sessionId } = await compileScene(
    'bundle-fonts',
    '<div style="width:300px;padding:24px;background:#fff;font-family:Inter,sans-serif"><h1 style="font-size:32px;font-weight:400;margin:0">A</h1><p style="font-weight:700">B</p></div>',
  );
  const stored = getScene(sessionId)!;
  const cssUrl = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap';
  const mock = makeMockFetcher({
    text: new Map([[cssUrl, interCss]]),
    binary: new Map([
      ['https://fonts.gstatic.com/s/inter/v1/inter-400.woff2', fakeWoff2],
      ['https://fonts.gstatic.com/s/inter/v1/inter-700.woff2', fakeWoff2],
      ['https://fonts.gstatic.com/s/inter/v1/inter-400i.woff2', fakeWoff2],
    ]),
  });
  const result = await exportSceneGraphToBundle(stored.graph, stored.rootId, { fetcher: mock });
  assert(result.inlinedAssets.fonts >= 1, `fonts: at least 1 face inlined (got ${result.inlinedAssets.fonts})`);
  assert(result.html.includes('@font-face'), 'fonts: @font-face block present');
  assert(result.html.includes('data:font/woff2;base64,'), 'fonts: data URI present');
  // The debug data-reframe-inlined-fonts attribute on the replacement
  // <style> retains the original URL — that's intentional. Test that no
  // <link> tag still points at the Google Fonts CDN.
  assert(!/<link[^>]+fonts\.googleapis\.com/i.test(result.html), 'fonts: no <link> still points at Google Fonts CDN');
  assert(!result.html.includes('rel="preconnect"'), 'fonts: preconnect hints dropped');
  // Subset check — only 400 and 700 (italic dropped because not used in scene).
  assert(!result.html.includes('inter-400i.woff2'), 'fonts: italic variant subset-dropped (not requested)');
}

// ─── TEST 3: inline images ──
async function testInlineImages(): Promise<void> {
  const { sessionId } = await compileScene(
    'bundle-img',
    '<div style="width:300px;padding:24px;background:#fff"><img src="https://example.com/cat.png" alt="cat" style="width:200px;height:120px"></div>',
  );
  const stored = getScene(sessionId)!;
  const mock = makeMockFetcher({
    binary: new Map([['https://example.com/cat.png', fakePng]]),
  });
  const result = await exportSceneGraphToBundle(stored.graph, stored.rootId, { fetcher: mock });
  assert(result.inlinedAssets.images === 1, `images: 1 inlined (got ${result.inlinedAssets.images})`);
  assert(result.html.includes('data:image/png;base64,'), 'images: png data URI present');
  assert(!result.html.includes('https://example.com/cat.png'), 'images: external src removed');
}

// ─── TEST 4: SRI stripping ──
async function testSriStrip(): Promise<void> {
  // Direct test of the utility — exhaustive against attribute orderings.
  const samples = [
    {
      input: '<link rel="stylesheet" integrity="sha384-abc" href="x" crossorigin>',
      mustNotInclude: ['integrity', 'crossorigin'],
    },
    {
      input: `<link integrity='sha384-xyz' href='x' rel='stylesheet'>`,
      mustNotInclude: ['integrity'],
    },
    {
      input: '<link rel="stylesheet" href="x">',
      mustNotInclude: [],
    },
  ];
  for (const s of samples) {
    const out = stripSriAttrs(s.input);
    for (const banned of s.mustNotInclude) {
      assert(!out.includes(banned), `sri-strip: "${banned}" should be removed from "${s.input}"`);
    }
    assert(out.includes('href='), `sri-strip: href preserved in "${s.input}"`);
  }
  // Integration: html.ts doesn't itself emit integrity, so end-to-end
  // bundle output also must not have any integrity attr after inlining.
  const { sessionId } = await compileScene(
    'bundle-sri',
    '<div style="width:300px;background:#fff;font-family:Inter"><h1 style="font-weight:400">A</h1></div>',
  );
  const stored = getScene(sessionId)!;
  const cssUrl = 'https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap';
  const mock = makeMockFetcher({
    text: new Map([[cssUrl, interCss]]),
    binary: new Map([['https://fonts.gstatic.com/s/inter/v1/inter-400.woff2', fakeWoff2]]),
  });
  const result = await exportSceneGraphToBundle(stored.graph, stored.rootId, { fetcher: mock });
  assert(!result.html.includes('integrity='), 'sri-strip e2e: no integrity attr in bundle output');
}

// ─── TEST 5: external fallback when fetch fails ──
async function testExternalFallback(): Promise<void> {
  const { sessionId } = await compileScene(
    'bundle-fail',
    '<div style="width:300px;background:#fff;font-family:Inter"><h1 style="font-weight:400">A</h1></div>',
  );
  const stored = getScene(sessionId)!;
  const cssUrl = 'https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap';
  const mock = makeMockFetcher({
    text: new Map([[cssUrl, async () => { throw new Error('500 simulated'); }]]),
  });
  const result = await exportSceneGraphToBundle(stored.graph, stored.rootId, { fetcher: mock });
  assert(result.inlinedAssets.fonts === 0, 'fallback: 0 fonts inlined on fetch fail');
  assert(result.warnings.some((w) => w.includes('Failed to inline font')), 'fallback: warning emitted');
  // System fallback chain — body font-family includes 'Inter', system-ui, sans-serif.
  assert(result.html.includes('system-ui'), 'fallback: fallback chain present in body font-family');
}

// ─── TEST 6: resource cache (one URL → fetched once) ──
async function testResourceCache(): Promise<void> {
  const { sessionId } = await compileScene(
    'bundle-cache',
    '<div style="width:400px;background:#fff">' +
      '<img src="https://cdn.example/icon.png" style="width:50px;height:50px">' +
      '<img src="https://cdn.example/icon.png" style="width:50px;height:50px">' +
      '<img src="https://cdn.example/icon.png" style="width:50px;height:50px">' +
      '<img src="https://cdn.example/icon.png" style="width:50px;height:50px">' +
      '<img src="https://cdn.example/icon.png" style="width:50px;height:50px">' +
    '</div>',
  );
  const stored = getScene(sessionId)!;
  const mock = makeMockFetcher({
    binary: new Map([['https://cdn.example/icon.png', fakePng]]),
  });
  const result = await exportSceneGraphToBundle(stored.graph, stored.rootId, { fetcher: mock });
  const dataUriCount = (result.html.match(/data:image\/png;base64,/g) ?? []).length;
  assert(dataUriCount >= 5, `cache: 5 references resolved to data: URIs (got ${dataUriCount})`);
  assert(mock.binaryCalls.length === 1, `cache: binary fetched once (got ${mock.binaryCalls.length})`);
}

// ─── TEST 7: annotations preserved + Caveat inlined ──
async function testAnnotationsPreserved(): Promise<void> {
  const { sessionId } = await compileScene(
    'bundle-anno',
    '<div style="width:400px;padding:24px;background:#fff;font-family:Inter"><h1 style="font-weight:400">Hero</h1></div>',
  );
  const stored = getScene(sessionId)!;
  const target = (() => {
    let found: any;
    function walk(id: string): void {
      const n = stored.graph.getNode(id); if (!n) return;
      if (n.type === 'TEXT' && !found) found = n;
      for (const c of n.childIds) walk(c);
    }
    walk(stored.rootId);
    return found;
  })();
  await handleEdit({
    operations: [
      { op: 'annotate', sceneId: sessionId, targetNodeId: target.id, text: 'note A', anchor: 'ne', severity: 'suggestion', author: 'critic' },
      { op: 'annotate', sceneId: sessionId, targetNodeId: target.id, text: 'note B', anchor: 'sw', severity: 'warn', author: 'critic' },
    ],
  } as any);
  const refreshed = getScene(sessionId)!;
  assert(refreshed.graph.annotations.length === 2, 'anno: 2 annotations on scene');
  // Variant walker must include Caveat 500 since annotations exist.
  const variants = collectUsedVariants(refreshed.graph, refreshed.rootId);
  assert(variants.some((v) => v.family === 'Caveat' && v.weight === 500), `anno: Caveat 500 in variants (got ${JSON.stringify(variants)})`);

  const interUrl = 'https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap';
  const caveatUrl = 'https://fonts.googleapis.com/css2?family=Caveat:wght@400;600&display=swap';
  const caveatCss =
    `@font-face {\n  font-family: 'Caveat';\n  font-style: normal;\n  font-weight: 500;\n  src: url(https://fonts.gstatic.com/s/caveat/v1/caveat-500.woff2) format('woff2');\n}\n` +
    `@font-face {\n  font-family: 'Caveat';\n  font-style: normal;\n  font-weight: 600;\n  src: url(https://fonts.gstatic.com/s/caveat/v1/caveat-600.woff2) format('woff2');\n}\n`;
  const mock = makeMockFetcher({
    text: new Map([
      [interUrl, interCss],
      [caveatUrl, caveatCss],
    ]),
    binary: new Map([
      ['https://fonts.gstatic.com/s/inter/v1/inter-400.woff2', fakeWoff2],
      ['https://fonts.gstatic.com/s/caveat/v1/caveat-500.woff2', fakeWoff2],
      ['https://fonts.gstatic.com/s/caveat/v1/caveat-600.woff2', fakeWoff2],
    ]),
  });
  const result = await exportSceneGraphToBundle(refreshed.graph, refreshed.rootId, { fetcher: mock });
  assert(result.html.includes('class="reframe-annotation"'), 'anno: annotation spans preserved in bundle');
  assert(result.html.includes('note A'), 'anno: text A present');
  assert(result.html.includes('note B'), 'anno: text B present');
  // Caveat 500 inlined (annotation uses it). Caveat 600 also inlined (it's in
  // the URL request from html.ts) — variant-subset filter would normally drop
  // it, but we don't add Caveat 600 to usedVariants so it should be filtered.
  // The actual test: ensure at least Caveat 500 is in the output.
  assert(result.html.includes("font-family: 'Caveat'"), 'anno: Caveat @font-face inlined');
  assert(result.html.includes('caveat-500.woff2') || result.html.includes('font-weight: 500;'), 'anno: Caveat 500 face emitted');
}

// ─── TEST 8: determinism ──
async function testDeterminism(): Promise<void> {
  const { sessionId } = await compileScene(
    'bundle-det',
    '<div style="width:300px;background:#fff;font-family:Inter"><h1 style="font-weight:400">D</h1><img src="https://example.com/d.png" style="width:50px;height:50px"></div>',
  );
  const stored = getScene(sessionId)!;
  const cssUrl = 'https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap';
  function freshMock(): ResourceFetcher {
    return makeMockFetcher({
      text: new Map([[cssUrl, interCss]]),
      binary: new Map<string, Uint8Array>([
        ['https://fonts.gstatic.com/s/inter/v1/inter-400.woff2', fakeWoff2],
        ['https://example.com/d.png', fakePng],
      ]),
    });
  }
  const a = await exportSceneGraphToBundle(stored.graph, stored.rootId, { fetcher: freshMock() });
  const b = await exportSceneGraphToBundle(stored.graph, stored.rootId, { fetcher: freshMock() });
  assert(a.html === b.html, `determinism: byte-identical output (a=${a.html.length} b=${b.html.length})`);
  assert(JSON.stringify(a.warnings) === JSON.stringify(b.warnings), 'determinism: warnings identical');
}

// ─── TEST 9: URL classification ──
async function testUrlClassification(): Promise<void> {
  // Direct classifier check.
  assert(classifyUrl('https://example.com/x.png') === 'absolute', 'cls: https → absolute');
  assert(classifyUrl('http://example.com/x.png') === 'absolute', 'cls: http → absolute');
  assert(classifyUrl('./local.png') === 'relative', 'cls: ./ → relative');
  assert(classifyUrl('../up.png') === 'relative', 'cls: ../ → relative');
  assert(classifyUrl('local.png') === 'relative', 'cls: bare → relative');
  assert(classifyUrl('/assets/foo.png') === 'server-relative', 'cls: / → server-relative');
  assert(classifyUrl('data:image/png;base64,iVBORw0KG') === 'data', 'cls: data: → data');
  assert(classifyUrl('blob:https://example.com/abc') === 'blob', 'cls: blob: → blob');

  // E2E: scene with mixed image src classes.
  const { sessionId } = await compileScene(
    'bundle-cls',
    '<div style="width:400px;background:#fff">' +
      '<img src="https://cdn.example/abs.png" style="width:50px;height:50px">' +
      '<img src="./local.png" style="width:50px;height:50px">' +
      '<img src="/assets/server.png" style="width:50px;height:50px">' +
      '<img src="data:image/png;base64,iVBORw0KG" style="width:50px;height:50px">' +
      '<img src="blob:https://example.com/xyz" style="width:50px;height:50px">' +
    '</div>',
  );
  const stored = getScene(sessionId)!;
  const mock = makeMockFetcher({
    binary: new Map([['https://cdn.example/abs.png', fakePng]]),
  });
  const result = await exportSceneGraphToBundle(stored.graph, stored.rootId, { fetcher: mock });
  assert(result.inlinedAssets.images === 1, `cls e2e: 1 image inlined (got ${result.inlinedAssets.images})`);
  assert(result.html.includes('./local.png'), 'cls e2e: relative kept as-is');
  assert(result.html.includes('/assets/server.png'), 'cls e2e: server-relative kept as-is');
  assert(result.html.includes('data:image/png;base64,iVBORw0KG'), 'cls e2e: data: URI unchanged');
  assert(result.html.includes('blob:https://example.com/xyz'), 'cls e2e: blob: URL kept as-is');
  // 3 warnings: relative + server-relative + blob (data and absolute don't warn).
  const warnCount = result.warnings.filter((w) => w.includes('Relative URL') || w.includes('Server-relative') || w.includes('blob:')).length;
  assert(warnCount === 3, `cls e2e: 3 url-class warnings (got ${warnCount}: ${result.warnings.join(' | ')})`);

  // Sanity: hostname-based URL recognition is strict equality.
  assert(isGoogleFontUrl('https://fonts.googleapis.com/css2?family=Inter'), 'isGoogleFontUrl: googleapis');
  assert(isGoogleFontUrl('https://fonts.gstatic.com/s/inter/v1/x.woff2'), 'isGoogleFontUrl: gstatic');
  assert(!isGoogleFontUrl('https://fonts.bunny.net/css2?family=Inter'), 'isGoogleFontUrl: bunny.net rejected');
  assert(!isGoogleFontUrl('https://x.fonts.googleapis.com.evil.com/x'), 'isGoogleFontUrl: subdomain trick rejected');
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Week 3 #3 Bundle + #18 SRI contract\n');

  const tests: Array<[string, () => Promise<void>]> = [
    ['happy local-only — no fetches', testLocalOnly],
    ['inline fonts — @font-face with data URI, link removed, italic subset-dropped', testInlineFonts],
    ['inline images — <img src> rewritten to data:', testInlineImages],
    ['SRI stripping — integrity gone on inlined link (unit + e2e)', testSriStrip],
    ['external fallback — failed font fetch leaves system fallback chain', testExternalFallback],
    ['resource cache — 5 refs to same URL → 1 fetch', testResourceCache],
    ['annotations preserved + Caveat inlined', testAnnotationsPreserved],
    ['determinism — two calls produce byte-identical output', testDeterminism],
    ['URL classification — 5 schemes handled per spec', testUrlClassification],
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
