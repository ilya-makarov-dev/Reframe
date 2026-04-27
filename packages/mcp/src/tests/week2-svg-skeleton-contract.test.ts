/**
 * Week 2 #11 — SVG skeleton mode contract.
 *
 * 5 tests: backward-compat default, text→rect bbox preservation, image→pattern,
 * fixed grayscale ramp regardless of brand, determinism (byte-identical).
 *
 * Run: npx tsx packages/mcp/src/tests/week2-svg-skeleton-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import { handleCompile } from '../tools/compile.js';
import { getScene, getSessionId } from '../store.js';
import { exportSceneGraphToSvg } from '../../../core/src/exporters/svg.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

async function compileScene(name: string, html: string): Promise<{ sessionId: string }> {
  const result = await handleCompile({ html, name, audit: false, preview: false, exports: ['html'] } as any);
  const text = (result as any).content?.[0]?.text ?? '';
  const sessionId = text.match(/Scenes?:\s*(s\d+)/)?.[1] ?? getSessionId(name) ?? '';
  if (!sessionId) throw new Error(`compileScene: no session for ${name}`);
  const stored = getScene(sessionId);
  if (!stored) throw new Error(`compileScene: no stored scene for ${name}`);
  return { sessionId };
}

const baseHtml =
  '<div style="width:600px;padding:40px;background:#0a4080;color:#fff;font-family:Inter,sans-serif">' +
    '<h1 style="font-size:48px;font-weight:700;margin:0">Big Title</h1>' +
    '<p style="font-size:14px;color:#cbd5e1;margin:16px 0 0">Body line at 14px</p>' +
    '<button style="margin-top:24px;padding:14px 24px;background:#22d3ee;color:#0f172a;border:none;border-radius:8px;font-size:16px;min-height:44px">Action</button>' +
  '</div>';

// ─── TEST 1: mode='full' is default; output equals omitted-mode ──
async function testFullIsDefault(): Promise<void> {
  const { sessionId } = await compileScene('skel-default', baseHtml);
  const stored = getScene(sessionId)!;
  const omitted = exportSceneGraphToSvg(stored.graph, stored.rootId);
  const explicit = exportSceneGraphToSvg(stored.graph, stored.rootId, { mode: 'full' });
  assert(omitted === explicit, 'full is default: omitted-mode equals mode=full');
  assert(omitted.includes('<text '), 'full: <text> elements present');
  assert(omitted.includes('Big Title'), 'full: text content present');
}

// ─── TEST 2: skeleton — text → <rect> with identical bbox ──
async function testTextBecomesRect(): Promise<void> {
  const { sessionId } = await compileScene('skel-text', baseHtml);
  const stored = getScene(sessionId)!;

  // Collect bbox of every TEXT node.
  const textBoxes: Array<{ name: string; w: number; h: number }> = [];
  function walk(id: string): void {
    const n = stored.graph.getNode(id); if (!n) return;
    if (n.type === 'TEXT') textBoxes.push({ name: n.name, w: Math.round(n.width), h: Math.round(n.height) });
    for (const c of n.childIds) walk(c);
  }
  walk(stored.rootId);
  assert(textBoxes.length >= 3, `text fixture should yield ≥3 text nodes, got ${textBoxes.length}`);

  const skel = exportSceneGraphToSvg(stored.graph, stored.rootId, { mode: 'skeleton' });
  assert(!skel.includes('<text '), 'skeleton: no <text> elements');
  assert(!skel.includes('Big Title'), 'skeleton: text content stripped');
  assert(!skel.includes('Body line'), 'skeleton: body text stripped');
  assert(!skel.includes('Action'), 'skeleton: button label stripped');
  assert(!skel.includes('font-family'), 'skeleton: no font attributes');

  // Each text node's bbox must appear as a <rect width=W height=H>.
  for (const tb of textBoxes) {
    const widthAttr = `width="${tb.w}"`;
    const heightAttr = `height="${tb.h}"`;
    const matches = skel.split(widthAttr).length - 1;
    assert(matches > 0, `skeleton: rect with width="${tb.w}" missing for text "${tb.name}"`);
    // Verify width+height co-occur on at least one rect line.
    const lines = skel.split('\n');
    const matchingLine = lines.find((l) => l.includes('<rect') && l.includes(widthAttr) && l.includes(heightAttr));
    assert(matchingLine !== undefined, `skeleton: rect with both width="${tb.w}" and height="${tb.h}" missing`);
  }
}

// ─── TEST 3: skeleton — image → patterned <rect> ──
async function testImageBecomesPatternedRect(): Promise<void> {
  const html =
    '<div style="width:400px;padding:20px;background:#fff">' +
      '<img src="https://example.com/cat.png" alt="" style="width:200px;height:120px;display:block">' +
    '</div>';
  const { sessionId } = await compileScene('skel-image', html);
  const stored = getScene(sessionId)!;
  const skel = exportSceneGraphToSvg(stored.graph, stored.rootId, { mode: 'skeleton' });
  assert(skel.includes('<defs>'), 'skeleton: <defs> block present');
  assert(skel.includes('id="reframe-skeleton-img"'), 'skeleton: fixed pattern id emitted');
  assert(skel.includes('patternTransform="rotate(45)"'), 'skeleton: 45deg pattern transform');
  assert(skel.includes('fill="url(#reframe-skeleton-img)"'), 'skeleton: at least one rect references the pattern');
}

// ─── TEST 4: skeleton — fixed 5-level grayscale ramp regardless of brand ──
async function testGrayscaleRampOnly(): Promise<void> {
  // Stripe-ish brand palette baked into HTML. Skeleton must NOT carry these.
  const stripeHtml =
    '<div style="width:600px;padding:40px;background:#635bff;color:#0a2540;font-family:Inter,sans-serif">' +
      '<h1 style="font-size:48px;font-weight:700;margin:0;color:#0a2540">Stripe-like</h1>' +
      '<p style="font-size:14px;color:#425466;margin:16px 0 0">Body</p>' +
      '<button style="margin-top:24px;padding:14px 24px;background:#00d4ff;color:#0a2540;border:none;border-radius:8px;font-size:16px;min-height:44px">Click</button>' +
    '</div>';
  const { sessionId } = await compileScene('skel-stripe', stripeHtml);
  const stored = getScene(sessionId)!;
  const skel = exportSceneGraphToSvg(stored.graph, stored.rootId, { mode: 'skeleton' });

  const ramp = ['#fafafa', '#f0f0f0', '#d4d4d4', '#a0a0a0', '#525252'];
  // Background + at least one text level always appear (root bg + text rect).
  assert(skel.includes('#fafafa'), 'skeleton: background ramp color #fafafa always present (root bg)');
  const textColorsPresent = ['#a0a0a0', '#525252'].filter((c) => skel.includes(c));
  assert(textColorsPresent.length >= 1, `skeleton: at least one text-ramp color should appear, got ${textColorsPresent.length}`);

  // Any color in the output (matching #xxxxxx) must be a member of the ramp set.
  const allHex = Array.from(new Set((skel.match(/#[0-9a-f]{6}/gi) ?? []).map((c) => c.toLowerCase())));
  const offRamp = allHex.filter((c) => !ramp.includes(c));
  assert(offRamp.length === 0, `skeleton: only ramp colors allowed, found off-ramp: ${offRamp.join(',')}`);

  const bannedBrandColors = ['#635bff', '#0a2540', '#425466', '#00d4ff'];
  for (const c of bannedBrandColors) {
    assert(!skel.includes(c), `skeleton: brand color ${c} must NOT appear (skeleton is brand-agnostic)`);
  }

  // Skeleton emits opacity 1 — no fill-opacity attributes from brand palette.
  // (fill-opacity may appear from clip paths in some scenes; check that none
  // of the brand colors has been ramped to a partial-alpha variant.)
  assert(!/fill-opacity="0\.\d+"/.test(skel), 'skeleton: no partial fill-opacity (deterministic finished output)');
}

// ─── TEST 5: skeleton is deterministic — byte-identical across runs ──
async function testDeterministic(): Promise<void> {
  const { sessionId } = await compileScene('skel-determinism', baseHtml);
  const stored = getScene(sessionId)!;
  const a = exportSceneGraphToSvg(stored.graph, stored.rootId, { mode: 'skeleton' });
  const b = exportSceneGraphToSvg(stored.graph, stored.rootId, { mode: 'skeleton' });
  assert(a === b, `skeleton: two calls must produce byte-identical output (lengths a=${a.length} b=${b.length})`);

  // Run a third time after a no-op handle to confirm no global state drift.
  const c = exportSceneGraphToSvg(stored.graph, stored.rootId, { mode: 'skeleton' });
  assert(a === c, 'skeleton: third call also byte-identical');
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Week 2 #11 SVG skeleton contract\n');

  const tests: Array<[string, () => Promise<void>]> = [
    ["mode='full' is default; equals explicit full", testFullIsDefault],
    ["mode='skeleton' replaces text with rects of identical bbox", testTextBecomesRect],
    ["mode='skeleton' replaces image with patterned rect", testImageBecomesPatternedRect],
    ["mode='skeleton' uses fixed 5-level ramp regardless of brand", testGrayscaleRampOnly],
    ["mode='skeleton' is byte-deterministic", testDeterministic],
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
