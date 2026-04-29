/**
 * T3 #9 Typography Roles — parser / annotation override / inspect contract.
 *
 * Tests:
 *   1. Parser detects all 4 roles (display + body + ui + annotation)
 *   2. Parser handles partial subset (only display + body)
 *   3. Parser parses sizes in three formats: [48, 64], "48, 64", "48 64"
 *   4. Parser tolerates invalid weight (warn + skip; role still registers)
 *   5. Parser drops empty role specs (no fields parsed → not registered)
 *   6. Parser ignores unknown role labels (silently skipped)
 *   7. Backward compat — DESIGN.md without ## Typography Roles section
 *      → typography.roles undefined; existing typography fields unchanged
 *   8. resolveAnnotationFont with no ds → ANNOTATION_FONT defaults
 *   9. resolveAnnotationFont with declared role → overrides family + weight,
 *      preserves style + fallback from constant
 *  10. resolveAnnotationFont with partial role (family only) → declared family,
 *      ANNOTATION_FONT weight (fills missing fields)
 *  11. Determinism — parse twice → identical roles
 *  12. collectUsedVariants picks up declared annotation font in font subset
 *
 * Run: npx tsx packages/mcp/src/tests/week7-typography-roles-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import { parseDesignMd } from '../../../core/src/design-system/parser.js';
import {
  ANNOTATION_FONT,
  resolveAnnotationFont,
} from '../../../core/src/engine/annotation.js';
import { collectUsedVariants } from '../../../core/src/exporters/bundle.js';
import { SceneGraph } from '../../../core/src/engine/scene-graph.js';
import { createAnnotation } from '../../../core/src/engine/annotation.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

const allFourMd = `
# X

## Color
primary: #635bff

## Typography
body: 16px / 400

## Layout
spacing: 16
borderRadiusScale: 4 8

## Typography Roles

display:
  family: Inter
  weight: 700
  letterSpacing: -0.03em
  sizes: [48, 64, 80, 96]

body:
  family: Inter
  weight: 400
  letterSpacing: -0.01em
  sizes: [14, 16, 18]

ui:
  family: Inter
  weight: 500
  letterSpacing: 0em
  sizes: [12, 13, 14, 16]

annotation:
  family: Caveat
  weight: 500
  letterSpacing: 0.02em
  sizes: [13, 14, 16]
`;

const subsetMd = `
# X

## Color
primary: #635bff

## Typography
body: 16px / 400

## Layout
spacing: 16
borderRadiusScale: 4 8

## Typography Roles

display:
  family: Manrope
  weight: 800
  sizes: [56, 72]

body:
  family: Manrope
  weight: 400
`;

const noRolesMd = `
# X

## Color
primary: #635bff

## Typography
body: 16px / 400

## Layout
spacing: 16
borderRadiusScale: 4 8
`;

// ─── TEST 1: all 4 roles ──
async function testAllFourRoles(): Promise<void> {
  const ds = parseDesignMd(allFourMd);
  const roles = ds.typography.roles;
  assert(!!roles, 'roles object present');
  assert(!!roles?.display, 'display role parsed');
  assert(!!roles?.body, 'body role parsed');
  assert(!!roles?.ui, 'ui role parsed');
  assert(!!roles?.annotation, 'annotation role parsed');
  assert(roles?.display?.family === 'Inter', `display.family = Inter (got ${roles?.display?.family})`);
  assert(roles?.display?.weight === 700, `display.weight = 700`);
  assert(roles?.display?.letterSpacing === '-0.03em', `display.letterSpacing preserved`);
  assert(JSON.stringify(roles?.display?.sizes) === '[48,64,80,96]', `display.sizes parsed`);
  assert(roles?.annotation?.family === 'Caveat', 'annotation.family');
  assert(roles?.annotation?.weight === 500, 'annotation.weight');
}

// ─── TEST 2: partial subset ──
async function testPartialSubset(): Promise<void> {
  const ds = parseDesignMd(subsetMd);
  const roles = ds.typography.roles;
  assert(!!roles?.display, 'subset: display present');
  assert(!!roles?.body, 'subset: body present');
  assert(roles?.ui === undefined, 'subset: ui absent');
  assert(roles?.annotation === undefined, 'subset: annotation absent');
  // Body has only family + weight (no letterSpacing / sizes) — partial OK.
  assert(roles?.body?.letterSpacing === undefined, 'subset: body.letterSpacing undefined');
  assert(roles?.body?.sizes === undefined, 'subset: body.sizes undefined');
}

// ─── TEST 3: sizes parsed in multiple formats ──
async function testSizesFormats(): Promise<void> {
  const md = `
# X
## Typography
body: 16px / 400
## Layout
spacing: 16
borderRadiusScale: 4 8
## Typography Roles

display:
  sizes: [48, 64, 80]
body:
  sizes: 14, 16, 18
ui:
  sizes: 12 13 14
`;
  const ds = parseDesignMd(md);
  const r = ds.typography.roles;
  assert(JSON.stringify(r?.display?.sizes) === '[48,64,80]', 'sizes: bracketed format');
  assert(JSON.stringify(r?.body?.sizes) === '[14,16,18]', 'sizes: comma-separated');
  assert(JSON.stringify(r?.ui?.sizes) === '[12,13,14]', 'sizes: space-separated');
}

// ─── TEST 4: invalid weight tolerated ──
async function testInvalidWeight(): Promise<void> {
  const origWarn = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  try {
    const md = `
# X
## Typography
body: 16px / 400
## Layout
spacing: 16
borderRadiusScale: 4 8
## Typography Roles

display:
  family: Inter
  weight: bold
  sizes: [48]
`;
    const ds = parseDesignMd(md);
    assert(!!ds.typography.roles?.display, 'invalid-weight: role still registered');
    assert(ds.typography.roles?.display?.family === 'Inter', 'invalid-weight: family preserved');
    assert(ds.typography.roles?.display?.weight === undefined, 'invalid-weight: weight skipped');
    assert(warned, 'invalid-weight: warning logged');
  } finally {
    console.warn = origWarn;
  }
}

// ─── TEST 5: empty role spec dropped ──
async function testEmptyRoleDropped(): Promise<void> {
  const md = `
# X
## Typography
body: 16px / 400
## Layout
spacing: 16
borderRadiusScale: 4 8
## Typography Roles

display:

body:
  family: Inter
`;
  const ds = parseDesignMd(md);
  // Display has no fields — drop. Body has family — keep.
  assert(ds.typography.roles?.display === undefined, 'empty-role: display dropped');
  assert(!!ds.typography.roles?.body, 'empty-role: body with single field kept');
}

// ─── TEST 6: unknown role labels ignored ──
async function testUnknownLabel(): Promise<void> {
  const md = `
# X
## Typography
body: 16px / 400
## Layout
spacing: 16
borderRadiusScale: 4 8
## Typography Roles

display:
  family: Inter
  weight: 700

caption:
  family: Whatever
  weight: 400

ui:
  family: Inter
  weight: 500
`;
  const ds = parseDesignMd(md);
  const r = ds.typography.roles;
  assert(!!r?.display, 'unknown-label: display kept');
  assert(!!r?.ui, 'unknown-label: ui kept');
  assert(!('caption' in (r ?? {})), 'unknown-label: caption (unknown) not in roles object');
}

// ─── TEST 7: backward compat — no section ──
async function testBackwardCompat(): Promise<void> {
  const ds = parseDesignMd(noRolesMd);
  assert(ds.typography.roles === undefined, 'backward: roles undefined when section absent');
  assert(ds.typography.hierarchy.length > 0, 'backward: legacy hierarchy still parsed');
}

// ─── TEST 8: resolveAnnotationFont without ds ──
async function testResolveNoDs(): Promise<void> {
  const r = resolveAnnotationFont();
  assert(r.family === ANNOTATION_FONT.family, `resolve(undefined).family = Caveat`);
  assert(r.weight === ANNOTATION_FONT.weight, 'resolve(undefined).weight = 500');
  assert(r.style === 'normal', 'resolve(undefined).style = normal');
  assert(r.fallback === ANNOTATION_FONT.fallback, 'resolve(undefined).fallback');
}

// ─── TEST 9: resolveAnnotationFont with declared role ──
async function testResolveDeclaredRole(): Promise<void> {
  const ds = parseDesignMd(allFourMd);
  // Override annotation declaration.
  ds.typography.roles!.annotation = { family: 'Manrope', weight: 600, letterSpacing: '0.01em' };
  const r = resolveAnnotationFont(ds);
  assert(r.family === 'Manrope', `resolve declared family = Manrope (got ${r.family})`);
  assert(r.weight === 600, `resolve declared weight = 600`);
  // style + fallback always come from ANNOTATION_FONT — verify.
  assert(r.style === ANNOTATION_FONT.style, 'resolve preserves style');
  assert(r.fallback === ANNOTATION_FONT.fallback, 'resolve preserves fallback');
}

// ─── TEST 10: resolveAnnotationFont with partial role ──
async function testResolvePartialRole(): Promise<void> {
  // Only family declared — weight should fall back to ANNOTATION_FONT.weight.
  const ds = { typography: { roles: { annotation: { family: 'Manrope' } } } };
  const r = resolveAnnotationFont(ds);
  assert(r.family === 'Manrope', 'partial: declared family wins');
  assert(r.weight === ANNOTATION_FONT.weight, 'partial: weight falls back to constant');
}

// ─── TEST 11: determinism ──
async function testDeterminism(): Promise<void> {
  const a = parseDesignMd(allFourMd);
  const b = parseDesignMd(allFourMd);
  assert(JSON.stringify(a.typography.roles) === JSON.stringify(b.typography.roles), 'determinism: identical roles across two parses');
}

// ─── TEST 12: collectUsedVariants picks up declared annotation ──
async function testFontSubsetIncludesAnnotation(): Promise<void> {
  // Build a minimal scene with one annotation. Annotation rendering is
  // triggered by graph.annotations being non-empty.
  const graph = new SceneGraph();
  // Add a target node so the annotation has somewhere to anchor.
  const child = graph.createNode('FRAME' as any, graph.rootId, { name: 'target' });
  graph.annotations.push(createAnnotation({
    targetNodeId: child.id,
    text: 'note',
    anchor: 'ne',
  }));

  // Default — Caveat 500 picked up.
  const defaultVariants = collectUsedVariants(graph, graph.rootId);
  const hasCaveat = defaultVariants.some(v => v.family === 'Caveat' && v.weight === 500);
  assert(hasCaveat, `default: Caveat 500 in font subset (variants: ${JSON.stringify(defaultVariants)})`);

  // Override via DesignSystem with declared annotation role.
  const ds = parseDesignMd(allFourMd);
  ds.typography.roles!.annotation = { family: 'Manrope', weight: 600 };
  const overrideVariants = collectUsedVariants(graph, graph.rootId, ds);
  const hasManrope = overrideVariants.some(v => v.family === 'Manrope' && v.weight === 600);
  const hasCaveatStill = overrideVariants.some(v => v.family === 'Caveat');
  assert(hasManrope, `override: Manrope 600 in font subset`);
  assert(!hasCaveatStill, `override: Caveat NOT in subset (replaced)`);
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('T3 #9 Typography Roles contract\n');

  const tests: Array<[string, () => Promise<void>]> = [
    ['parser detects all 4 roles', testAllFourRoles],
    ['parser handles partial subset (only display + body)', testPartialSubset],
    ['parser sizes accept [bracketed] / comma / space formats', testSizesFormats],
    ['parser tolerates invalid weight (warn + skip)', testInvalidWeight],
    ['parser drops empty role spec; partial role kept', testEmptyRoleDropped],
    ['parser ignores unknown role labels', testUnknownLabel],
    ['backward compat — no section → roles undefined; hierarchy unchanged', testBackwardCompat],
    ['resolveAnnotationFont() without ds → ANNOTATION_FONT defaults', testResolveNoDs],
    ['resolveAnnotationFont() with declared role overrides family + weight', testResolveDeclaredRole],
    ['resolveAnnotationFont() partial role → declared family + fallback weight', testResolvePartialRole],
    ['determinism — identical roles across two parses', testDeterminism],
    ['collectUsedVariants picks up declared annotation font (replaces Caveat)', testFontSubsetIncludesAnnotation],
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
