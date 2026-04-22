/**
 * INode round-trip — CSS transform + mix-blend-mode must survive import.
 *
 * Covers the 2026-04-22 finding (see `designer-qa/SKILL.md`): `transform:
 * scaleX(-1)`, `transform: scaleY(-1)`, `transform: scale(-1,-1)`,
 * `transform: matrix(-1,0,0,1,...)`, and `mix-blend-mode: <name>` were
 * silently dropped by `importers/html.ts` — the exporter had full support
 * but the importer never populated `flipX`/`flipY`/`blendMode`, so HTML in
 * → INode → HTML out round-trip lost the mirror flip + blend entirely.
 *
 * Run: `npx tsx src/tests/inode-roundtrip.test.ts` from `packages/core`.
 */

import { importFromHtml } from '../importers/html';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

async function main(): Promise<void> {
  const html = `<div style="width:800px;height:600px;background:#fff;display:flex;flex-direction:column;gap:10px;padding:20px;">
    <div id="sx"  style="width:100px;height:40px;background:#f00;transform:scaleX(-1);">A</div>
    <div id="sy"  style="width:100px;height:40px;background:#f0f;transform:scaleY(-1);">B</div>
    <div id="sxy" style="width:100px;height:40px;background:#0f0;transform:scale(-1,-1);">C</div>
    <div id="sxp" style="width:100px;height:40px;background:#0ff;transform:scale(-2,1);">D</div>
    <div id="sxr" style="width:100px;height:40px;background:#abc;transform:scaleX(1);">E</div>
    <div id="mbm" style="width:100px;height:40px;background:#00f;mix-blend-mode:multiply;">F</div>
    <div id="ovl" style="width:100px;height:40px;background:#fa0;mix-blend-mode:overlay;">G</div>
    <div id="sft" style="width:100px;height:40px;background:#888;mix-blend-mode:soft-light;">H</div>
    <div id="mat" style="width:100px;height:40px;background:#222;transform:matrix(-1,0,0,1,0,0);">I</div>
    <div id="mtr" style="width:100px;height:40px;background:#444;transform:matrix(1,0,0,-1,0,0);">J</div>
    <div id="rot" style="width:100px;height:40px;background:#777;transform:rotate(15deg);">K</div>
  </div>`;

  const { graph, rootId } = await importFromHtml(html);
  const root = graph.getNode(rootId)!;
  const byName: Record<string, any> = {};
  for (const cid of root.childIds) {
    const n = graph.getNode(cid)!;
    byName[n.name] = n;
  }

  // scaleX(-1) → flipX
  assert(byName.sx?.flipX === true, `scaleX(-1) → flipX=true (got ${byName.sx?.flipX})`);
  assert(byName.sx?.flipY === false, `scaleX(-1) leaves flipY=false (got ${byName.sx?.flipY})`);

  // scaleY(-1) → flipY
  assert(byName.sy?.flipX === false, `scaleY(-1) leaves flipX=false (got ${byName.sy?.flipX})`);
  assert(byName.sy?.flipY === true, `scaleY(-1) → flipY=true (got ${byName.sy?.flipY})`);

  // scale(-1,-1) → both flips
  assert(byName.sxy?.flipX === true && byName.sxy?.flipY === true,
    `scale(-1,-1) → flipX+flipY (got flipX=${byName.sxy?.flipX}, flipY=${byName.sxy?.flipY})`);

  // scale(-2,1) — negative X, positive Y → flipX only
  assert(byName.sxp?.flipX === true && byName.sxp?.flipY === false,
    `scale(-2,1) → flipX only (got flipX=${byName.sxp?.flipX}, flipY=${byName.sxp?.flipY})`);

  // scaleX(1) — positive, no flip
  assert(byName.sxr?.flipX === false && byName.sxr?.flipY === false,
    `scaleX(1) → no flip (got flipX=${byName.sxr?.flipX}, flipY=${byName.sxr?.flipY})`);

  // mix-blend-mode → enum
  assert(byName.mbm?.blendMode === 'MULTIPLY', `mix-blend-mode:multiply → MULTIPLY (got ${byName.mbm?.blendMode})`);
  assert(byName.ovl?.blendMode === 'OVERLAY', `mix-blend-mode:overlay → OVERLAY (got ${byName.ovl?.blendMode})`);
  assert(byName.sft?.blendMode === 'SOFT_LIGHT', `mix-blend-mode:soft-light → SOFT_LIGHT (got ${byName.sft?.blendMode})`);

  // matrix(a,b,c,d,…) with negative a (and unit length) → flipX
  assert(byName.mat?.flipX === true && byName.mat?.flipY === false,
    `matrix(-1,0,0,1,..) → flipX (got flipX=${byName.mat?.flipX}, flipY=${byName.mat?.flipY})`);

  // matrix with negative d → flipY
  assert(byName.mtr?.flipX === false && byName.mtr?.flipY === true,
    `matrix(1,0,0,-1,..) → flipY (got flipX=${byName.mtr?.flipX}, flipY=${byName.mtr?.flipY})`);

  // rotate() must NOT spuriously set flipX/flipY (regression guard)
  assert(byName.rot?.flipX === false && byName.rot?.flipY === false,
    `rotate(15deg) leaves flipX/flipY false (got flipX=${byName.rot?.flipX}, flipY=${byName.rot?.flipY})`);
  assert(Math.abs((byName.rot?.rotation ?? 0) - 15) < 0.01,
    `rotate(15deg) → rotation≈15 (got ${byName.rot?.rotation})`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
