/**
 * Phase 1 UI-2 — Selection model + multi-select + group/ungroup contract.
 *
 * Tests in this suite cover:
 *   1. Single click sets selectedIds = {id}, primaryId = id
 *   2. Shift+click adds to selection, updates primaryId
 *   3. Cmd+click toggles — adding then removing
 *   4. Clear selection empties both selectedIds + primaryId
 *   5. Marquee intersection query (replace / union / toggle modifiers)
 *   6. Keyboard nav helpers — collectSiblings / walkSibling / firstChild / parentOf
 *   7. edit.ts case 'group' creates frame + nests children + re-anchors coords
 *   8. edit.ts case 'group' rejects different-parent selection
 *   9. edit.ts case 'group' rejects < 2 nodes
 *  10. edit.ts case 'ungroup' extracts children + removes frame + re-anchors
 *  11. edit.ts case 'ungroup' rejects scene root
 *  12. edit.ts case 'ungroup' rejects childless node
 *
 * No HTTP / DOM mocks beyond the small custom DOM the keyboard-nav
 * helpers need (jsdom-grade is overkill — we hand-roll just enough
 * Element + Node shape to satisfy the helpers).
 *
 * Run: npx tsx packages/mcp/src/tests/week8-selection-model-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

// Editor package is ESM, this file is CJS — bridge via dynamic
// import inside main() (same pattern as the caret-preservation
// contract in week7-caret-preservation-contract.test.ts).
let createSelectionState: any;
let setSelection: any;
let addToSelection: any;
let toggleInSelection: any;
let clearSelection: any;
let applyMarqueeResult: any;
let selectionAsArray: any;
let isSelected: any;
let intersectMarquee: any;
let collectSiblings: any;
let walkSibling: any;
let firstChild: any;
let parentOf: any;

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

// ─── Hand-rolled minimal DOM shape for keyboard-nav helpers ──
//
// We only need: querySelector, parentElement, children, getAttribute,
// nodeType (1 = Element). Fully synthetic — no jsdom required. The
// tree we build mirrors a typical reframe iframe scene: <body><root>
//   <child-a><leaf-a1/><leaf-a2/></child-a>
//   <child-b><leaf-b1/></child-b>
// </root></body>

interface MockEl {
  nodeType: 1;
  tagName: string;
  attrs: Record<string, string>;
  parentElement: MockEl | null;
  children: MockEl[];
  ownerDocument: any;
  getAttribute(name: string): string | null;
}

function makeMockTree(): { doc: any; ids: Record<string, MockEl> } {
  const ids: Record<string, MockEl> = {};
  function el(tag: string, id: string | null, parent: MockEl | null): MockEl {
    const attrs: Record<string, string> = {};
    if (id) attrs['data-reframe-inode'] = id;
    const node: MockEl = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      attrs,
      parentElement: parent,
      children: [],
      ownerDocument: null,
      getAttribute(name: string) { return this.attrs[name] ?? null; },
    };
    if (parent) parent.children.push(node);
    if (id) ids[id] = node;
    return node;
  }
  const body = el('body', null, null);
  const root = el('div', 'root', body);
  const a = el('div', 'A', root);
  el('div', 'A1', a);
  el('div', 'A2', a);
  const b = el('div', 'B', root);
  el('div', 'B1', b);

  function querySelectorAll(node: MockEl, sel: string): MockEl[] {
    // Only support `[data-reframe-inode="X"]` form.
    const m = sel.match(/^\[data-reframe-inode="([^"]+)"\]$/);
    if (!m) return [];
    const out: MockEl[] = [];
    function walk(n: MockEl) {
      if (n.attrs['data-reframe-inode'] === m![1]) out.push(n);
      for (const c of n.children) walk(c);
    }
    walk(node);
    return out;
  }

  const doc = {
    body: {
      get firstElementChild() { return body.children[0]; },
    },
    querySelector(sel: string) {
      return querySelectorAll(body, sel)[0] ?? null;
    },
  };
  for (const k of Object.keys(ids)) ids[k].ownerDocument = doc;
  return { doc, ids };
}

// ─── TEST 1: single click semantics ──
async function testSingleClick(): Promise<void> {
  const s = createSelectionState();
  setSelection(s, ['nodeA']);
  assert(s.selectedIds.has('nodeA'), 'single: selectedIds contains nodeA');
  assert(s.primaryId === 'nodeA', 'single: primary = nodeA');
  setSelection(s, ['nodeB']);
  assert(!s.selectedIds.has('nodeA'), 'single: replacement clears prior selection');
  assert(s.selectedIds.has('nodeB'), 'single: new node selected');
  assert(s.primaryId === 'nodeB', 'single: primary updated to nodeB');
}

// ─── TEST 2: Shift+click extends ──
async function testShiftClick(): Promise<void> {
  const s = createSelectionState();
  setSelection(s, ['A']);
  addToSelection(s, 'B');
  assert(s.selectedIds.size === 2, 'shift: size = 2');
  assert(s.selectedIds.has('A') && s.selectedIds.has('B'), 'shift: both selected');
  assert(s.primaryId === 'B', 'shift: primary = last added');
  // Idempotent re-add
  addToSelection(s, 'B');
  assert(s.selectedIds.size === 2, 'shift: re-add idempotent');
}

// ─── TEST 3: Cmd+click toggle ──
async function testCmdClick(): Promise<void> {
  const s = createSelectionState();
  setSelection(s, ['A', 'B']);
  toggleInSelection(s, 'B');
  assert(!s.selectedIds.has('B'), 'toggle: B removed');
  assert(s.selectedIds.has('A'), 'toggle: A retained');
  // primary was B → re-anchor to A
  assert(s.primaryId === 'A', 'toggle: primary re-anchored after removal');
  // Re-add B
  toggleInSelection(s, 'B');
  assert(s.selectedIds.has('B'), 'toggle: B re-added');
  assert(s.primaryId === 'B', 'toggle: primary = newly added');
}

// ─── TEST 4: Clear ──
async function testClear(): Promise<void> {
  const s = createSelectionState();
  setSelection(s, ['A', 'B', 'C']);
  clearSelection(s);
  assert(s.selectedIds.size === 0, 'clear: empty');
  assert(s.primaryId === null, 'clear: primary null');
}

// ─── TEST 5: Marquee intersection geometry ──
async function testMarqueeIntersect(): Promise<void> {
  // Three boxes of different positions; marquee covers two of them.
  const candidates = [
    { id: 'A', bbox: { left: 0,   top: 0,   right: 100, bottom: 100 } },
    { id: 'B', bbox: { left: 200, top: 0,   right: 300, bottom: 100 } },
    { id: 'C', bbox: { left: 0,   top: 200, right: 100, bottom: 300 } },
  ];
  // Marquee 50–250 × 50–150 → touches A (overlap) + B (overlap), misses C.
  const hit = intersectMarquee({ left: 50, top: 50, right: 250, bottom: 150 }, candidates);
  assert(hit.length === 2, `marquee: 2 hits (got ${hit.length})`);
  assert(hit.includes('A') && hit.includes('B'), 'marquee: A + B intersected');
  assert(!hit.includes('C'), 'marquee: C not intersected');

  // Edge-touch test — marquee right edge exactly at candidate left edge → still counts.
  const edge = intersectMarquee({ left: 100, top: 0, right: 200, bottom: 100 }, candidates);
  assert(edge.includes('A') || edge.includes('B'), 'marquee: edge-touch still counts');
}

// ─── TEST 6: Marquee modifiers ──
async function testMarqueeModifiers(): Promise<void> {
  // replace
  const s1 = createSelectionState();
  setSelection(s1, ['X']);
  applyMarqueeResult(s1, ['A', 'B'], 'replace');
  assert(s1.selectedIds.size === 2 && !s1.selectedIds.has('X'), 'mod replace: replaces prior');
  assert(s1.primaryId === 'B', 'mod replace: primary = last intersected');

  // union
  const s2 = createSelectionState();
  setSelection(s2, ['X']);
  applyMarqueeResult(s2, ['A', 'B'], 'union');
  assert(s2.selectedIds.size === 3, 'mod union: 3 total');
  assert(s2.selectedIds.has('X') && s2.selectedIds.has('A'), 'mod union: both prior + new');

  // toggle
  const s3 = createSelectionState();
  setSelection(s3, ['A', 'C']);
  applyMarqueeResult(s3, ['A', 'B'], 'toggle');
  assert(!s3.selectedIds.has('A'), 'mod toggle: A removed (was selected)');
  assert(s3.selectedIds.has('B'), 'mod toggle: B added (was not)');
  assert(s3.selectedIds.has('C'), 'mod toggle: C retained (not in marquee)');
}

// ─── TEST 7: keyboard-nav helpers ──
async function testKeyboardNavHelpers(): Promise<void> {
  const { doc } = makeMockTree();
  // siblings of A under root → [A, B]
  const sibs = collectSiblings(doc as Document, 'A');
  assert(sibs.length === 2 && sibs.includes('A') && sibs.includes('B'), `siblings(A) = [A, B] (got ${sibs.join(',')})`);
  // siblings(null) = root children = [root]'s children = [A, B] (root is body's first child)
  const rootSibs = collectSiblings(doc as Document, null);
  assert(rootSibs.includes('A') && rootSibs.includes('B'), 'siblings(null) = root children');

  // walkSibling A forward → B; B forward → A (cyclic)
  assert(walkSibling(doc as Document, 'A', 1) === 'B', 'walk A→B forward');
  assert(walkSibling(doc as Document, 'B', 1) === 'A', 'walk B→A wraps');
  assert(walkSibling(doc as Document, 'A', -1) === 'B', 'walk A→B backward (wraps)');

  // firstChild of A → A1
  assert(firstChild(doc as Document, 'A') === 'A1', 'firstChild(A) = A1');
  // firstChild of A1 → null (leaf)
  assert(firstChild(doc as Document, 'A1') === null, 'firstChild(A1) = null (leaf)');

  // parentOf A1 → A; parentOf A → root
  assert(parentOf(doc as Document, 'A1') === 'A', 'parentOf(A1) = A');
  assert(parentOf(doc as Document, 'A') === 'root', 'parentOf(A) = root');
  // parentOf root → null
  assert(parentOf(doc as Document, 'root') === null, 'parentOf(root) = null');
}

// Helper: import an HTML scene + register it in the store, returning
// {sceneId, root inner-frame, list of immediate children}. Avoids the
// edit.ts create op (which builds blueprints, not full HTML scenes).
async function importHtmlScene(html: string, name: string): Promise<{
  sceneId: string;
  innerFrameId: string;
  childIds: string[];
}> {
  const { importFromHtml } = await import('../../../core/src/importers/html.js');
  const { storeScene } = await import('../store.js');
  const { graph, rootId } = await importFromHtml(html);
  const sceneId = storeScene(graph, rootId, undefined, { name });
  // The outermost div is rootId; immediate children are the siblings
  // we want to test group/ungroup on.
  const childIds = graph.getChildren(rootId).map((n: any) => n.id);
  return { sceneId, innerFrameId: rootId, childIds };
}

// ─── TEST 8: edit.ts case 'group' creates frame + restructures ──
async function testGroupOp(): Promise<void> {
  const { handleEdit } = await import('../tools/edit.js');
  const html =
    '<!DOCTYPE html><html><body>' +
    '<div style="width:800px;height:600px;background:#fff;position:relative">' +
    '<div data-name="a" style="position:absolute;left:50px;top:50px;width:100px;height:100px;background:#f00"></div>' +
    '<div data-name="b" style="position:absolute;left:200px;top:80px;width:100px;height:100px;background:#0f0"></div>' +
    '<div data-name="c" style="position:absolute;left:80px;top:300px;width:100px;height:100px;background:#00f"></div>' +
    '</div></body></html>';
  const { sceneId, innerFrameId, childIds } = await importHtmlScene(html, 'group-test');
  const { getScene } = await import('../store.js');
  const stored = getScene(sceneId);
  if (!stored) { failed++; console.error('  FAIL: group: getScene undefined'); return; }
  const [idA, idB] = childIds;
  // Snapshot primitive fields before mutation — getNode returns the
  // same object reference both before and after, so reading after the
  // op would see the post-mutation values. Capture by value.
  const aPre = (() => { const n = stored.graph.getNode(idA)!; return { x: n.x, y: n.y, parentId: n.parentId }; })();
  const bPre = (() => { const n = stored.graph.getNode(idB)!; return { x: n.x, y: n.y, parentId: n.parentId }; })();
  await handleEdit({ operations: [{ op: 'group', sceneId, nodeIds: [idA, idB] } as any] });
  const aAfter = stored.graph.getNode(idA)!;
  const bAfter = stored.graph.getNode(idB)!;
  assert(aAfter.parentId === bAfter.parentId, 'group: A and B share new parent');
  assert(aAfter.parentId !== aPre.parentId, 'group: A reparented out of innerFrame');
  const newFrameId = aAfter.parentId!;
  const newFrame = stored.graph.getNode(newFrameId);
  assert(!!newFrame, 'group: new frame exists in graph');
  assert(newFrame!.parentId === innerFrameId, 'group: new frame parented to original innerFrame');
  // Coords re-anchored — visual position preserved end-to-end.
  // SceneGraph.reparentNode handles the math: A and B sit at the
  // same absolute coordinates as before. Inside the new frame
  // (which itself sits at minX,minY in parent coords), A's local
  // origin (0, 0) corresponds to absolute (minX, minY), so:
  //   aAfter.x === aPre.x - newFrame.x
  //   bAfter.y === bPre.y - newFrame.y
  // Parent of newFrame and parent of A originally are the same
  // (innerFrame), so absolute math collapses to simple subtraction.
  assert(Math.abs(aAfter.x - (aPre.x - newFrame!.x)) < 0.5, `group: A re-anchored x (got ${aAfter.x}, expected ${aPre.x - newFrame!.x})`);
  assert(Math.abs(bAfter.y - (bPre.y - newFrame!.y)) < 0.5, 'group: B re-anchored y');
}

// ─── TEST 9: case 'group' rejects different-parent selection ──
async function testGroupDifferentParents(): Promise<void> {
  const { handleEdit } = await import('../tools/edit.js');
  const html =
    '<!DOCTYPE html><html><body>' +
    '<div style="width:800px;height:600px;position:relative">' +
    '<div data-name="parentA" style="position:absolute;left:0;top:0;width:300px;height:300px"><div data-name="leafA" style="width:50px;height:50px"></div></div>' +
    '<div data-name="parentB" style="position:absolute;left:400px;top:0;width:300px;height:300px"><div data-name="leafB" style="width:50px;height:50px"></div></div>' +
    '</div></body></html>';
  const { sceneId } = await importHtmlScene(html, 'group-diff-parents');
  const { getScene } = await import('../store.js');
  const stored = getScene(sceneId)!;
  const parents = stored.graph.getChildren(stored.rootId);
  const leafA = stored.graph.getChildren(parents[0].id)[0];
  const leafB = stored.graph.getChildren(parents[1].id)[0];
  const result = await handleEdit({ operations: [{ op: 'group', sceneId, nodeIds: [leafA.id, leafB.id] } as any] }) as any;
  const text = JSON.stringify(result);
  assert(text.includes('edit.group.different_parents'), 'diff-parents: error code surfaced');
}

// ─── TEST 10: case 'group' rejects < 2 nodes ──
async function testGroupTooFew(): Promise<void> {
  const { handleEdit } = await import('../tools/edit.js');
  const html =
    '<!DOCTYPE html><html><body><div style="width:200px;height:200px;position:relative">' +
    '<div data-name="only" style="position:absolute;left:0;top:0;width:50px;height:50px"></div>' +
    '</div></body></html>';
  const { sceneId, childIds } = await importHtmlScene(html, 'group-too-few');
  // Schema requires nodeIds.min(2), so a single id won't even reach
  // the handler. We test the post-dedup path: passing the same id
  // twice satisfies the schema (length=2) but dedup reduces to 1.
  const onlyId = childIds[0];
  const result = await handleEdit({ operations: [{ op: 'group', sceneId, nodeIds: [onlyId, onlyId] } as any] }) as any;
  const text = JSON.stringify(result);
  assert(text.includes('edit.group.empty_selection'), 'too-few: error code surfaced after dedup');
}

// ─── TEST 11: case 'ungroup' reverses group ──
async function testUngroupOp(): Promise<void> {
  const { handleEdit } = await import('../tools/edit.js');
  const html =
    '<!DOCTYPE html><html><body>' +
    '<div style="width:800px;height:600px;position:relative">' +
    '<div data-name="a" style="position:absolute;left:50px;top:50px;width:100px;height:100px;background:red"></div>' +
    '<div data-name="b" style="position:absolute;left:200px;top:80px;width:100px;height:100px;background:green"></div>' +
    '</div></body></html>';
  const { sceneId, innerFrameId, childIds } = await importHtmlScene(html, 'ungroup-test');
  const { getScene } = await import('../store.js');
  const stored = getScene(sceneId)!;
  // Snapshot pre-group coordinates by node id.
  const before = childIds.map((id) => {
    const n = stored.graph.getNode(id)!;
    return { id, x: n.x, y: n.y };
  });
  await handleEdit({ operations: [{ op: 'group', sceneId, nodeIds: childIds } as any] });
  const afterGroup = stored.graph.getChildren(innerFrameId);
  assert(afterGroup.length === 1, 'ungroup: group reduced innerFrame to a single child');
  const groupId = afterGroup[0].id;
  await handleEdit({ operations: [{ op: 'ungroup', sceneId, nodeId: groupId } as any] });
  const afterUngroup = stored.graph.getChildren(innerFrameId);
  assert(afterUngroup.length === childIds.length, `ungroup: ${childIds.length} children restored (got ${afterUngroup.length})`);
  assert(!stored.graph.getNode(groupId), 'ungroup: group node removed');
  // Coords round-trip cleanly — subtract-then-add of the same offset.
  for (const orig of before) {
    const after = stored.graph.getNode(orig.id);
    assert(!!after, `ungroup: node ${orig.id} still present`);
    assert(Math.abs(after!.x - orig.x) < 1, `ungroup: ${orig.id} x preserved`);
    assert(Math.abs(after!.y - orig.y) < 1, `ungroup: ${orig.id} y preserved`);
  }
}

// ─── TEST 12: case 'ungroup' rejects scene root + childless ──
async function testUngroupRejects(): Promise<void> {
  const { handleEdit } = await import('../tools/edit.js');
  const html =
    '<!DOCTYPE html><html><body>' +
    '<div style="width:200px;height:200px;position:relative">' +
    '<div data-name="leaf" style="position:absolute;left:0;top:0;width:50px;height:50px;background:red"></div>' +
    '</div></body></html>';
  const { sceneId, childIds } = await importHtmlScene(html, 'ungroup-rejects');
  const { getScene } = await import('../store.js');
  const stored = getScene(sceneId)!;
  const r1 = await handleEdit({ operations: [{ op: 'ungroup', sceneId, nodeId: stored.rootId } as any] }) as any;
  assert(JSON.stringify(r1).includes('edit.ungroup.is_root'), 'ungroup: rejects scene root');
  const r2 = await handleEdit({ operations: [{ op: 'ungroup', sceneId, nodeId: childIds[0] } as any] }) as any;
  assert(JSON.stringify(r2).includes('edit.ungroup.no_children'), 'ungroup: rejects childless node');
}

// ─── TEST 13: isSelected helper ──
async function testIsSelected(): Promise<void> {
  const s = createSelectionState();
  setSelection(s, ['a', 'b']);
  assert(isSelected(s, 'a'), 'helper: isSelected a');
  assert(!isSelected(s, 'c'), 'helper: !isSelected c');
  const arr = selectionAsArray(s);
  assert(arr.length === 2 && arr.includes('a'), 'helper: selectionAsArray');
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Phase 1 UI-2 Selection model contract\n');
  // Bridge editor (ESM) → mcp tests (CJS) via dynamic import.
  const sel = await import('../../../editor/src/canvas-dom/selection-state.js');
  createSelectionState = sel.createSelectionState;
  setSelection = sel.setSelection;
  addToSelection = sel.addToSelection;
  toggleInSelection = sel.toggleInSelection;
  clearSelection = sel.clearSelection;
  applyMarqueeResult = sel.applyMarqueeResult;
  selectionAsArray = sel.selectionAsArray;
  isSelected = sel.isSelected;
  const mar = await import('../../../editor/src/canvas-dom/marquee-select.js');
  intersectMarquee = mar.intersectMarquee;
  const kb = await import('../../../editor/src/canvas-dom/keyboard-nav.js');
  collectSiblings = kb.collectSiblings;
  walkSibling = kb.walkSibling;
  firstChild = kb.firstChild;
  parentOf = kb.parentOf;

  const tests: Array<[string, () => Promise<void>]> = [
    ['single click → selectedIds = {id}, primaryId = id', testSingleClick],
    ['Shift+click → adds to selection (idempotent), primaryId = last added', testShiftClick],
    ['Cmd+click → toggles, primary re-anchors after removal', testCmdClick],
    ['clearSelection → empties Set + primary null', testClear],
    ['marquee intersect — AABB hit detection on candidate set', testMarqueeIntersect],
    ['marquee modifiers — replace / union / toggle semantics', testMarqueeModifiers],
    ['keyboard-nav helpers — collectSiblings / walkSibling / firstChild / parentOf', testKeyboardNavHelpers],
    ['edit.ts group creates frame + reparents + re-anchors coords', testGroupOp],
    ['edit.ts group rejects different-parent selection (edit.group.different_parents)', testGroupDifferentParents],
    ['edit.ts group rejects < 2 nodes after dedup (edit.group.empty_selection)', testGroupTooFew],
    ['edit.ts ungroup reverses group — children promoted, frame removed, coords restored', testUngroupOp],
    ['edit.ts ungroup rejects scene root + childless node', testUngroupRejects],
    ['helpers — isSelected, selectionAsArray', testIsSelected],
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
