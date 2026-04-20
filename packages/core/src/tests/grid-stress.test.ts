/**
 * Grid layout — stress-test regressions
 *
 * Covers the Bento-landing / multi-section engine fixes shipped in the
 * /designer-qa stress run (2026-04-20):
 *
 *   1. `grid-auto-rows` tracks parsed from CSS → `gridAutoRows` field
 *   2. `minmax(Npx, auto)` honors the minimum as FIXED (was AUTO/0)
 *   3. Implicit row count derives from child rowSpan (was children/cols)
 *   4. Post-layout scene-root height grows to sum of vertical children
 *      (was pinned at importer default 1080, letting footers overflow)
 *   5. Height propagation does NOT re-run Yoga on the whole tree —
 *      previous fix attempt called computeLayout() again which clobbered
 *      grid-cell x/y coords set by computeGridLayout()
 *
 * Run: `npx tsx src/tests/grid-stress.test.ts` from `packages/core`.
 */

import { importFromHtml } from '../importers/html';
import { computeAllLayouts } from '../engine/layout';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

async function compile(html: string): Promise<{ graph: any; rootId: string }> {
  const res = await importFromHtml(html);
  computeAllLayouts(res.graph, res.rootId);
  return { graph: res.graph, rootId: res.rootId };
}

async function main(): Promise<void> {

function findGrid(graph: any, nodeId: string): any | null {
  const n = graph.getNode(nodeId);
  if (!n) return null;
  if (n.layoutMode === 'GRID') return n;
  for (const c of n.childIds ?? []) {
    const hit = findGrid(graph, c);
    if (hit) return hit;
  }
  return null;
}

// Test 1 ─ grid-auto-rows with minmax(Npx, auto) imports as FIXED track
{
  const html = `
    <div style="width:600px;background:#000;display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:minmax(200px,auto);gap:12px">
      <div style="grid-column:span 2;grid-row:span 2;background:#111"></div>
      <div style="background:#222"></div>
      <div style="background:#333"></div>
      <div style="background:#444"></div>
    </div>
  `;
  const { graph, rootId } = await compile(html);
  const gridNode = findGrid(graph, rootId);
  assert(
    gridNode !== null && gridNode.layoutMode === 'GRID',
    `grid-auto-rows scene: GRID node found`,
  );
  if (gridNode) {
    assert(
      gridNode.gridAutoRows !== null && gridNode.gridAutoRows.type === 'FIXED' && gridNode.gridAutoRows.value === 200,
      `grid-auto-rows: minmax(200px,auto) → FIXED 200 (got ${JSON.stringify(gridNode.gridAutoRows)})`,
    );
    const spanChild = graph.getNode(gridNode.childIds[0])!;
    assert(
      spanChild.height >= 400,
      `row-span 2 child height ≥ 400 (got ${spanChild.height})`,
    );
  }
}

// Test 2 ─ implicit row count derives from rowSpan not children.length
{
  const html = `
    <div style="width:600px;background:#000;display:grid;grid-template-columns:repeat(6,1fr);grid-auto-rows:200px;gap:8px">
      <div style="grid-column:span 4;grid-row:span 2;background:#111"></div>
      <div style="grid-column:span 2;background:#222"></div>
      <div style="grid-column:span 2;background:#333"></div>
      <div style="grid-column:span 3;background:#444"></div>
      <div style="grid-column:span 3;background:#555"></div>
    </div>
  `;
  const { graph, rootId } = await compile(html);
  const grid = findGrid(graph, rootId);
  if (grid) {
    const heroCell = graph.getNode(grid.childIds[0])!;
    assert(
      heroCell.height >= 400,
      `implicit rowspan: hero cell ≥ 400px (got ${heroCell.height})`,
    );
    const lastCell = graph.getNode(grid.childIds[grid.childIds.length - 1])!;
    assert(
      lastCell.y > 350,
      `implicit rowspan: last cell on row 3, y > 350 (got ${lastCell.y})`,
    );
  } else {
    assert(false, 'implicit rowspan test: grid node found');
  }
}

// Test 3 ─ scene root grows when multi-section content exceeds default 1080
{
  const html = `
    <div style="width:1440px;background:#000;display:flex;flex-direction:column">
      <section style="padding:40px;background:#111;height:400px;display:flex"></section>
      <section style="padding:40px;background:#222;height:600px;display:flex"></section>
      <section style="padding:40px;background:#333;height:300px;display:flex"></section>
    </div>
  `;
  const { graph, rootId } = await compile(html);
  const root = graph.getNode(rootId)!;
  // 400 + 600 + 300 = 1300 > default 1080
  assert(
    root.height >= 1200,
    `scene root grew past 1080 default (got ${root.height})`,
  );
}

// Test 4 ─ grid cells retain x/y after root-grow pass (no Yoga re-pass)
{
  const html = `
    <div style="width:900px;background:#000;display:flex;flex-direction:column;gap:20px">
      <section style="padding:20px;background:#111">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:150px;gap:10px">
          <div style="background:#aaa"></div>
          <div style="background:#bbb"></div>
          <div style="background:#ccc"></div>
        </div>
      </section>
    </div>
  `;
  const { graph, rootId } = await compile(html);
  const grid = findGrid(graph, rootId)!;
  const cells = grid.childIds.map((id: string) => graph.getNode(id)!);
  // Three cells in a single row — x coords must be distinct (not all 0)
  const xs = cells.map((c: any) => c.x);
  const uniqueX = new Set(xs);
  assert(
    uniqueX.size === 3,
    `grid cells retain distinct x-coords after root-grow (got ${JSON.stringify(xs)})`,
  );
  // All cells on row 1 → same y
  const ys = cells.map((c: any) => c.y);
  const uniqueY = new Set(ys);
  assert(
    uniqueY.size === 1,
    `grid cells share y on single row (got ${JSON.stringify(ys)})`,
  );
}

}

main().then(() => {
  if (failed === 0) console.log(`  ✓ grid-stress passed (${passed} assertions)`);
  else { console.error(`  ✗ grid-stress FAILED (${failed} of ${passed + failed})`); process.exit(1); }
}).catch(err => { console.error(err); process.exit(1); });
