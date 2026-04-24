/**
 * breakGrid macro — detector + bento transform + idempotency.
 *
 * Covers:
 *   1. Happy N=3 flex  → [1, 2, 1] + middle padding bumped
 *   2. Happy N=4 flex  → [1, 2, 2, 1] + middle band padding bumped
 *   3. Happy N=3 grid  → gridTemplateColumns rewritten to [1fr, 2fr, 1fr]
 *   4. Negative N=2    → no-op (<3 children)
 *   5. Negative unequal widths → no-op (widths fail tolerance)
 *   6. Negative mixed padding → no-op (vertical padding not uniform)
 *   7. Negative mixed density → no-op (subtree count spread > 1)
 *   8. Idempotency    → second call reports skippedIdempotent, no mutation
 *
 * Run: npx tsx packages/core/src/tests/break-grid.test.ts
 */

import { SceneGraph } from '../engine/scene-graph';
import { breakGrid } from '../variations/break-grid';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

// ─── Graph helpers ─────────────────────────────────────────

interface ChildSpec {
  width?: number;
  height?: number;
  paddingTop?: number;
  paddingBottom?: number;
  innerCount?: number; // add N nested leaves inside this child (for density equality)
}

function makeFlexRowScene(children: ChildSpec[]): {
  graph: SceneGraph;
  rootId: string;
  containerId: string;
  childIds: string[];
} {
  const graph = new SceneGraph();
  const root = graph.createNode('FRAME', '', { name: 'root', width: 1200, height: 400 } as any);
  const container = graph.createNode('FRAME', root.id, {
    name: 'row',
    layoutMode: 'HORIZONTAL',
    layoutWrap: 'NO_WRAP',
    width: 1200,
    height: 400,
  } as any);
  const childIds: string[] = [];
  children.forEach((spec, i) => {
    const child = graph.createNode('FRAME', container.id, {
      name: `card-${i}`,
      width: spec.width ?? 400,
      height: spec.height ?? 300,
      paddingTop: spec.paddingTop ?? 24,
      paddingBottom: spec.paddingBottom ?? 24,
      layoutGrow: 1,
    } as any);
    childIds.push(child.id);
    // Optional inner nodes to control subtree-count equality.
    const inner = spec.innerCount ?? 1;
    for (let k = 0; k < inner; k++) {
      graph.createNode('TEXT', child.id, { name: `inner-${k}` } as any);
    }
  });
  return { graph, rootId: root.id, containerId: container.id, childIds };
}

function makeGridScene(childWidths: number[]): {
  graph: SceneGraph;
  rootId: string;
  containerId: string;
  childIds: string[];
} {
  const graph = new SceneGraph();
  const root = graph.createNode('FRAME', '', { name: 'root', width: 1200, height: 400 } as any);
  const n = childWidths.length;
  const container = graph.createNode('FRAME', root.id, {
    name: 'grid',
    layoutMode: 'GRID',
    width: 1200,
    height: 400,
    gridTemplateColumns: Array.from({ length: n }, () => ({ type: 'FR', value: 1 })),
  } as any);
  const childIds: string[] = [];
  childWidths.forEach((w, i) => {
    const child = graph.createNode('FRAME', container.id, {
      name: `cell-${i}`,
      width: w,
      height: 300,
      paddingTop: 24,
      paddingBottom: 24,
    } as any);
    childIds.push(child.id);
    graph.createNode('TEXT', child.id, { name: `t-${i}` } as any);
  });
  return { graph, rootId: root.id, containerId: container.id, childIds };
}

// ─── Tests ────────────────────────────────────────────────

// TEST 1: N=3 equal flex-row → [1, 2, 1] + middle padding × 1.4
function test3EqualFlex(): void {
  const { graph, rootId, childIds } = makeFlexRowScene([{}, {}, {}]);
  const result = breakGrid(graph, rootId);
  assert(result.broken === 1, `N=3 flex: broken=${result.broken}, expected 1`);
  assert(result.skippedIdempotent.length === 0, 'N=3 flex: nothing should be skipped');

  const grows = childIds.map(id => (graph.getNode(id) as any).layoutGrow);
  assert(grows[0] === 1 && grows[1] === 2 && grows[2] === 1, `N=3 flex: grow=[${grows}], expected [1,2,1]`);

  const middlePt = (graph.getNode(childIds[1]) as any).paddingTop;
  const edgePt = (graph.getNode(childIds[0]) as any).paddingTop;
  assert(middlePt === Math.round(24 * 1.4), `N=3 flex: middle pt=${middlePt}, expected ${Math.round(24 * 1.4)}`);
  assert(edgePt === 24, `N=3 flex: edge pt=${edgePt}, expected 24 (unchanged)`);
}

// TEST 2: N=4 equal flex-row → [1, 2, 2, 1]
function test4EqualFlex(): void {
  const { graph, rootId, childIds } = makeFlexRowScene([{}, {}, {}, {}]);
  const result = breakGrid(graph, rootId);
  assert(result.broken === 1, `N=4 flex: broken=${result.broken}`);

  const grows = childIds.map(id => (graph.getNode(id) as any).layoutGrow);
  assert(
    grows[0] === 1 && grows[1] === 2 && grows[2] === 2 && grows[3] === 1,
    `N=4 flex: grow=[${grows}], expected [1,2,2,1]`,
  );

  // Middle-band pt bumped on indices 1 and 2
  const pts = childIds.map(id => (graph.getNode(id) as any).paddingTop);
  const bumped = Math.round(24 * 1.4);
  assert(
    pts[0] === 24 && pts[1] === bumped && pts[2] === bumped && pts[3] === 24,
    `N=4 flex: paddingTop=[${pts}], expected [24,${bumped},${bumped},24]`,
  );
}

// TEST 3: N=3 equal grid → gridTemplateColumns rewritten
function test3EqualGrid(): void {
  const { graph, rootId, containerId, childIds } = makeGridScene([400, 400, 400]);
  const result = breakGrid(graph, rootId);
  assert(result.broken === 1, `N=3 grid: broken=${result.broken}`);

  const cols = (graph.getNode(containerId) as any).gridTemplateColumns;
  const values = cols.map((t: any) => t.value);
  assert(
    values[0] === 1 && values[1] === 2 && values[2] === 1,
    `N=3 grid: columns values=[${values}], expected [1,2,1]`,
  );

  // Middle child padding bumped
  const middlePt = (graph.getNode(childIds[1]) as any).paddingTop;
  assert(middlePt === Math.round(24 * 1.4), `N=3 grid: middle pt=${middlePt}`);
}

// TEST 4: N=2 → no-op (below threshold)
function test2ChildrenNoOp(): void {
  const { graph, rootId, childIds } = makeFlexRowScene([{}, {}]);
  const result = breakGrid(graph, rootId);
  assert(result.broken === 0, `N=2: broken=${result.broken}, expected 0`);
  assert(result.skippedIdempotent.length === 0, 'N=2: nothing to skip');

  // No mutation
  const grows = childIds.map(id => (graph.getNode(id) as any).layoutGrow);
  assert(grows.every(g => g === 1), `N=2: grows unchanged, got [${grows}]`);
}

// TEST 5: 3 children with unequal widths → no-op
function test3UnequalWidthsNoOp(): void {
  const { graph, rootId } = makeFlexRowScene([
    { width: 300 },
    { width: 500 },
    { width: 400 },
  ]);
  const result = breakGrid(graph, rootId);
  assert(result.broken === 0, `unequal widths: broken=${result.broken}, expected 0`);
}

// TEST 6: 3 children with mixed vertical padding → no-op
function test3MixedPaddingNoOp(): void {
  const { graph, rootId } = makeFlexRowScene([
    { paddingTop: 16, paddingBottom: 16 },
    { paddingTop: 24, paddingBottom: 24 },
    { paddingTop: 16, paddingBottom: 16 },
  ]);
  const result = breakGrid(graph, rootId);
  assert(result.broken === 0, `mixed padding: broken=${result.broken}, expected 0`);
}

// TEST 7: 3 children with mixed density (subtree counts spread > 1) → no-op
function test3MixedDensityNoOp(): void {
  const { graph, rootId } = makeFlexRowScene([
    { innerCount: 1 },
    { innerCount: 5 },  // spread: 1 → 5, diff = 4 > 1
    { innerCount: 1 },
  ]);
  const result = breakGrid(graph, rootId);
  assert(result.broken === 0, `mixed density: broken=${result.broken}, expected 0`);
}

// TEST 8a: idempotency after full transform — second call is no-op. The
// container no longer matches the detector (paddings now asymmetric after
// transform), so it's dropped at detection rather than explicitly skipped.
// Either way, the invariant holds: broken=0 on pass 2.
function testIdempotentAfterTransform(): void {
  const { graph, rootId } = makeFlexRowScene([{}, {}, {}]);
  const first = breakGrid(graph, rootId);
  assert(first.broken === 1, 'idempotent first pass: broken=1');

  const second = breakGrid(graph, rootId);
  assert(second.broken === 0, `idempotent second pass: broken=${second.broken}, expected 0`);
}

// TEST 8b: idempotency on pre-broken-ratios scene. If ratios are already
// asymmetric but everything else still signals an equal-grid pattern
// (same widths, same paddings, same density), the container matches the
// detector but gets logged in skippedIdempotent — NOT re-shuffled.
function testIdempotentPreBrokenRatios(): void {
  const { graph, rootId, containerId, childIds } = makeFlexRowScene([{}, {}, {}]);
  // Simulate a caller that already set asymmetric layoutGrow without
  // touching paddings (e.g. manual edit via update op before this macro).
  graph.updateNode(childIds[1], { layoutGrow: 2 } as any);

  const result = breakGrid(graph, rootId);
  assert(result.broken === 0, `pre-broken: broken=${result.broken}, expected 0`);
  assert(
    result.skippedIdempotent.includes(containerId),
    `pre-broken: container "${containerId}" should be in skippedIdempotent=${JSON.stringify(result.skippedIdempotent)}`,
  );

  // Middle child padding was NOT bumped — macro bailed before transform.
  const middlePt = (graph.getNode(childIds[1]) as any).paddingTop;
  assert(middlePt === 24, `pre-broken: middle pt=${middlePt}, expected 24 (untouched)`);
}

// ─── Runner ────────────────────────────────────────────────

console.log('breakGrid macro\n');

const tests: Array<[string, () => void]> = [
  ['N=3 equal flex → [1,2,1] + middle padding × 1.4', test3EqualFlex],
  ['N=4 equal flex → [1,2,2,1]', test4EqualFlex],
  ['N=3 equal grid → columns rewritten', test3EqualGrid],
  ['N=2 → no-op (below threshold)', test2ChildrenNoOp],
  ['N=3 unequal widths → no-op', test3UnequalWidthsNoOp],
  ['N=3 mixed padding → no-op', test3MixedPaddingNoOp],
  ['N=3 mixed density → no-op', test3MixedDensityNoOp],
  ['idempotency — second call no-op (detection fails post-transform)', testIdempotentAfterTransform],
  ['idempotency — pre-broken ratios skipped (detection + skip path)', testIdempotentPreBrokenRatios],
];

for (const [name, fn] of tests) {
  console.log(`▸ ${name}`);
  try { fn(); }
  catch (err: any) {
    failed++;
    console.error(`  UNEXPECTED ERROR: ${err?.message ?? err}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
