/**
 * T3 #7 Undertone — computation / override / audit rule contract.
 *
 * Tests:
 *   1. rgbToHsl correctness on known cases
 *   2. computeWarmness anchor mapping (red=+1, blue=-1, green=0)
 *   3. computeUndertone — Stripe-like cool palette → cool
 *   4. computeUndertone — Coca-Cola-like warm palette → warm
 *   5. computeUndertone — grayscale only → neutral
 *   6. computeUndertone — primary 2× weight overrides accent
 *   7. computeUndertone — balanced palette below threshold → neutral
 *   8. parser — DESIGN.md without ## Undertone → undertone computed,
 *      undertoneSource='computed'
 *   9. parser — DESIGN.md with ## Undertone → undertone declared,
 *      undertoneSource='declared'
 *  10. parser — invalid declaration ("scorching") → falls back to computed
 *  11. colorClashesUndertone — warm color on cool brand → true
 *  12. colorClashesUndertone — neutral brand never clashes
 *  13. colorClashesUndertone — low-saturation color never clashes
 *  14. determinism — same input → same undertone across two calls
 *  15. backward compat — DesignSystem fields all-optional; existing brands
 *      parse without error and populate undertone field
 *
 * Run: npx tsx packages/mcp/src/tests/week7-undertone-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import { parseDesignMd } from '../../../core/src/design-system/parser.js';
import {
  computeUndertone,
  computeWarmness,
  rgbToHsl,
  colorClashesUndertone,
  type PaletteEntry,
} from '../../../core/src/design-system/undertone.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

function approx(a: number, b: number, eps = 0.05): boolean {
  return Math.abs(a - b) < eps;
}

// ─── TEST 1: rgbToHsl ──
async function testRgbToHsl(): Promise<void> {
  const red = rgbToHsl('#ff0000');
  assert(approx(red.h, 0, 1) && approx(red.s, 1) && approx(red.l, 0.5), `rgb→hsl: red h=${red.h.toFixed(1)} s=${red.s.toFixed(2)} l=${red.l.toFixed(2)}`);
  const blue = rgbToHsl('#0000ff');
  assert(approx(blue.h, 240, 1) && approx(blue.s, 1), `rgb→hsl: blue h=${blue.h.toFixed(1)}`);
  const gray = rgbToHsl('#808080');
  assert(gray.s < 0.05, `rgb→hsl: gray s low (got ${gray.s.toFixed(3)})`);
  // Short hex form.
  const shortRed = rgbToHsl('#f00');
  assert(approx(shortRed.h, 0, 1), `rgb→hsl: #f00 expansion`);
}

// ─── TEST 2: computeWarmness anchors ──
async function testComputeWarmness(): Promise<void> {
  assert(approx(computeWarmness(0), 1.0), `warmness: red=+1`);
  assert(approx(computeWarmness(30), 1.0), `warmness: orange=+1`);
  assert(computeWarmness(90) >= -0.1 && computeWarmness(90) <= 0.1, `warmness: yellow-green near 0`);
  assert(approx(computeWarmness(240), -1.0), `warmness: blue=-1`);
  assert(approx(computeWarmness(360), 1.0), `warmness: 360=red wrap`);
  // Hue normalization for negative input.
  assert(approx(computeWarmness(-120), computeWarmness(240)), `warmness: -120 normalizes to 240`);
}

// ─── TEST 3: Stripe-like cool palette ──
async function testCoolPalette(): Promise<void> {
  const palette: PaletteEntry[] = [
    { hex: '#635bff', role: 'primary' },
    { hex: '#00d4ff', role: 'accent' },
    { hex: '#ffffff', role: 'background' },
  ];
  assert(computeUndertone(palette) === 'cool', 'Stripe-like → cool');
}

// ─── TEST 4: warm palette ──
async function testWarmPalette(): Promise<void> {
  const palette: PaletteEntry[] = [
    { hex: '#f40000', role: 'primary' },
    { hex: '#ff5a5f', role: 'accent' },
    { hex: '#ffffff', role: 'background' },
  ];
  assert(computeUndertone(palette) === 'warm', 'Coca-Cola-like → warm');
}

// ─── TEST 5: grayscale neutral ──
async function testGrayscalePalette(): Promise<void> {
  const palette: PaletteEntry[] = [
    { hex: '#000000', role: 'primary' },
    { hex: '#ffffff', role: 'background' },
    { hex: '#888888', role: 'text' },
  ];
  assert(computeUndertone(palette) === 'neutral', 'all-grayscale → neutral');
}

// ─── TEST 6: primary 2× weight ──
async function testPrimaryWeight(): Promise<void> {
  // Primary blue + accent red. Without weight, ratio could go either way.
  // Primary 2× → cool wins.
  const palette: PaletteEntry[] = [
    { hex: '#0000ff', role: 'primary' },
    { hex: '#ff0000', role: 'accent' },
  ];
  assert(computeUndertone(palette) === 'cool', '2×primary blue beats accent red');
  // Reverse: primary red, accent blue — primary wins again.
  const reversed: PaletteEntry[] = [
    { hex: '#ff0000', role: 'primary' },
    { hex: '#0000ff', role: 'accent' },
  ];
  assert(computeUndertone(reversed) === 'warm', '2×primary red beats accent blue');
}

// ─── TEST 7: balanced palette → neutral ──
async function testBalancedPalette(): Promise<void> {
  // Equal weight warm + cool, both non-primary.
  // Balance below ±0.25 threshold → neutral.
  const palette: PaletteEntry[] = [
    { hex: '#ff8866', role: 'accent' },     // warm
    { hex: '#6688ff', role: 'background' }, // cool
  ];
  // Designed to balance: same saturation, opposite warmness.
  // ratio = (warm - cool) / total ≈ 0 → neutral.
  const result = computeUndertone(palette);
  assert(result === 'neutral', `balanced palette → neutral (got ${result})`);
}

// ─── TEST 8: parser — no override → computed ──
async function testParserComputed(): Promise<void> {
  const md = `
# X

## Color
primary: #635bff
accent: #00d4ff
background: #ffffff

## Typography
body: 16px / 400

## Layout
spacing: 16
borderRadiusScale: 4 8
`;
  const ds = parseDesignMd(md);
  assert(ds.undertone === 'cool', `parser computed: cool (got ${ds.undertone})`);
  assert(ds.undertoneSource === 'computed', `parser source: computed (got ${ds.undertoneSource})`);
}

// ─── TEST 9: parser — declared override ──
async function testParserDeclared(): Promise<void> {
  // Cool palette, but designer overrides to warm via section.
  const md = `
# X

## Color
primary: #635bff
accent: #00d4ff

## Typography
body: 16px / 400

## Layout
spacing: 16
borderRadiusScale: 4 8

## Undertone

warm
`;
  const ds = parseDesignMd(md);
  assert(ds.undertone === 'warm', `parser declared: warm override wins (got ${ds.undertone})`);
  assert(ds.undertoneSource === 'declared', `parser source: declared`);
}

// ─── TEST 10: parser — invalid declaration falls back ──
async function testParserInvalidDeclaration(): Promise<void> {
  const md = `
# X

## Color
primary: #635bff

## Typography
body: 16px / 400

## Layout
spacing: 16
borderRadiusScale: 4 8

## Undertone

scorching
`;
  const ds = parseDesignMd(md);
  // Falls back to computed.
  assert(ds.undertone === 'cool', 'parser invalid declaration falls back to computed');
  assert(ds.undertoneSource === 'computed', 'parser source: computed (declaration ignored)');
}

// ─── TEST 11: colorClashesUndertone — warm-on-cool ──
async function testClashWarmOnCool(): Promise<void> {
  assert(colorClashesUndertone('#ff6633', 'cool') === true, 'warm color on cool brand → clash');
  assert(colorClashesUndertone('#0066ff', 'warm') === true, 'cool color on warm brand → clash');
  assert(colorClashesUndertone('#0066ff', 'cool') === false, 'cool color on cool brand → no clash');
  assert(colorClashesUndertone('#ff6633', 'warm') === false, 'warm color on warm brand → no clash');
}

// ─── TEST 12: neutral brand never clashes ──
async function testNeutralBrandNoClash(): Promise<void> {
  assert(colorClashesUndertone('#ff6633', 'neutral') === false, 'warm color on neutral brand → no clash');
  assert(colorClashesUndertone('#0066ff', 'neutral') === false, 'cool color on neutral brand → no clash');
}

// ─── TEST 13: low-saturation color never clashes ──
async function testLowSaturationNoClash(): Promise<void> {
  assert(colorClashesUndertone('#888888', 'cool') === false, 'gray on cool brand → no clash');
  assert(colorClashesUndertone('#cccccc', 'warm') === false, 'light gray on warm brand → no clash');
  // Slightly tinted but below saturation threshold.
  assert(colorClashesUndertone('#9088a0', 'warm') === false, 'desaturated mauve on warm brand → no clash');
}

// ─── TEST 14: determinism ──
async function testDeterminism(): Promise<void> {
  const palette: PaletteEntry[] = [
    { hex: '#635bff', role: 'primary' },
    { hex: '#00d4ff', role: 'accent' },
    { hex: '#ffffff', role: 'background' },
    { hex: '#1a1a2e', role: 'text' },
  ];
  const a = computeUndertone(palette);
  const b = computeUndertone(palette);
  assert(a === b, 'determinism: same palette → same result');

  // And iteration-order-independent: shuffle, same answer.
  const shuffled = [...palette].reverse();
  assert(computeUndertone(shuffled) === a, 'determinism: order-independent');
}

// ─── TEST 15: backward compat — empty palette ──
async function testBackwardCompat(): Promise<void> {
  // Empty palette → neutral (no signal).
  assert(computeUndertone([]) === 'neutral', 'empty palette → neutral');
  // Parser on minimal DESIGN.md without undertone section.
  const minimal = `
# X

## Color
primary: #635bff

## Typography
body: 16px / 400

## Layout
spacing: 16
borderRadiusScale: 4 8
`;
  const ds = parseDesignMd(minimal);
  assert(ds.undertone !== undefined, 'parser: undertone field always populated');
  assert(['warm', 'cool', 'neutral'].includes(ds.undertone!), 'parser: undertone is valid axis');
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('T3 #7 Undertone contract\n');

  const tests: Array<[string, () => Promise<void>]> = [
    ['rgbToHsl correctness on known cases', testRgbToHsl],
    ['computeWarmness anchor mapping (red=+1, blue=-1, green=0)', testComputeWarmness],
    ['computeUndertone — Stripe-like → cool', testCoolPalette],
    ['computeUndertone — Coca-Cola-like → warm', testWarmPalette],
    ['computeUndertone — grayscale only → neutral', testGrayscalePalette],
    ['computeUndertone — primary 2× weight overrides accent', testPrimaryWeight],
    ['computeUndertone — balanced palette below threshold → neutral', testBalancedPalette],
    ['parser — no override section → computed undertone', testParserComputed],
    ['parser — ## Undertone override → declared', testParserDeclared],
    ['parser — invalid declaration falls back to computed', testParserInvalidDeclaration],
    ['colorClashesUndertone — warm-on-cool / cool-on-warm true', testClashWarmOnCool],
    ['colorClashesUndertone — neutral brand never clashes', testNeutralBrandNoClash],
    ['colorClashesUndertone — low-saturation never clashes', testLowSaturationNoClash],
    ['determinism — same palette → same result; order-independent', testDeterminism],
    ['backward compat — empty palette + minimal DESIGN.md still populate undertone', testBackwardCompat],
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
