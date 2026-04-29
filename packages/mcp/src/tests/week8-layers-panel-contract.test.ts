/**
 * Phase 1 UI-4 — Layers panel contract.
 *
 * Tests assert against the SHIPPING ARTIFACTS:
 *   - layers-helpers.ts — pure functions (flattenTree, rangeBetween,
 *     filterTreeByName, validateReorder, deriveDisplayName)
 *   - 150-sidebar.js (concatenated platform-ui.js bundle) —
 *     visibility/lock toggles, multi-select, drag-reorder, rename,
 *     filter, keyboard nav
 *   - node-edit.ts — /platform/api/node/reorder endpoint shape +
 *     name/locked patch handling
 *   - layout.ts — filter input element rendered in sidebar
 *   - platform-ui.css — drop indicators, hidden/locked visual states
 *
 * Live-browser verification deferred while reframe MCP is
 * disconnected — designer-qa probes batch with UI-2 + UI-3 + UI-4
 * when MCP reconnects.
 *
 * Run: npx tsx packages/mcp/src/tests/week8-layers-panel-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  flattenTree,
  rangeBetween,
  filterTreeByName,
  buildParentMap,
  nextRowId,
  validateReorder,
  deriveDisplayName,
  type LayerTreeNode,
} from '../platform/layers-helpers.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SIDEBAR_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '150-sidebar.js');
const LAYOUT_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'layout.ts');
const NODE_EDIT_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'api', 'node-edit.ts');
const CSS_FILE = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'platform-ui.css');

let sidebarJs = '';
let layoutTs = '';
let nodeEditTs = '';
let cssText = '';

function loadFixtures(): void {
  sidebarJs = fs.readFileSync(SIDEBAR_JS, 'utf-8');
  layoutTs = fs.readFileSync(LAYOUT_TS, 'utf-8');
  nodeEditTs = fs.readFileSync(NODE_EDIT_TS, 'utf-8');
  cssText = fs.readFileSync(CSS_FILE, 'utf-8');
}

function makeSampleTree(): LayerTreeNode {
  return {
    id: 'root',
    name: 'div',
    type: 'FRAME',
    children: [
      {
        id: 'hero',
        name: 'Hero',
        type: 'FRAME',
        visible: true,
        locked: false,
        children: [
          { id: 'hero-title', name: 'h1', type: 'TEXT', text: 'Welcome' },
          { id: 'hero-cta', name: 'button', type: 'FRAME', visible: true },
        ],
      },
      {
        id: 'pricing',
        name: 'Pricing',
        type: 'FRAME',
        visible: false,
        locked: true,
        children: [
          { id: 'pricing-card', name: 'div', type: 'FRAME' },
        ],
      },
    ],
  };
}

// ─── TEST 1: flattenTree DFS order + depth ──
async function testFlatten(): Promise<void> {
  const rows = flattenTree(makeSampleTree());
  const ids = rows.map((r) => r.id);
  assert(ids[0] === 'root', 'flatten: root first');
  assert(ids[1] === 'hero', 'flatten: hero second');
  assert(ids[2] === 'hero-title', 'flatten: hero-title third');
  assert(ids[3] === 'hero-cta', 'flatten: hero-cta fourth');
  assert(ids[4] === 'pricing', 'flatten: pricing fifth');
  assert(ids[5] === 'pricing-card', 'flatten: pricing-card sixth');
  // Depth
  const heroRow = rows.find((r) => r.id === 'hero')!;
  const heroTitleRow = rows.find((r) => r.id === 'hero-title')!;
  assert(heroRow.depth === 1, 'flatten: hero depth = 1');
  assert(heroTitleRow.depth === 2, 'flatten: hero-title depth = 2');
  // hasChildren
  assert(heroRow.hasChildren === true, 'flatten: hero hasChildren');
  assert(heroTitleRow.hasChildren === false, 'flatten: hero-title leaf');
}

// ─── TEST 2: deriveDisplayName ──
async function testDisplayName(): Promise<void> {
  assert(deriveDisplayName({ id: 'a', name: 'div', type: 'FRAME' }) === 'Container', 'name: div → Container');
  assert(deriveDisplayName({ id: 'b', name: 'h1', type: 'FRAME' }) === 'Heading 1', 'name: h1 → Heading 1');
  assert(deriveDisplayName({ id: 'c', name: 'button', type: 'FRAME' }) === 'Button', 'name: button → Button');
  // TEXT with content shows truncated text
  assert(
    deriveDisplayName({ id: 'd', name: 'Original', type: 'TEXT', text: 'Welcome to reframe' }) === 'Welcome to reframe',
    'name: TEXT shows text content',
  );
  // TEXT empty → "Text"
  assert(
    deriveDisplayName({ id: 'e', type: 'TEXT' }) === 'Text',
    'name: empty TEXT → Text',
  );
  // Truncation past 28 chars
  const long = 'a'.repeat(40);
  const short = deriveDisplayName({ id: 'f', name: 'x', type: 'TEXT', text: long });
  assert(short.length === 29, `name: long text truncated at 28 + ellipsis (got ${short.length})`);
  assert(short.endsWith('…'), 'name: ellipsis appended');
  // FRAME with single TEXT child — displayName stays as the FRAME's
  // own friendly label; the absorbed text shows separately as a
  // quote-style preview span (renderLayerNode emits both). The
  // helper only sets displayName from absorbedText for TEXT nodes
  // themselves, mirroring existing 150-sidebar.js behavior.
  const frameWithText: LayerTreeNode = {
    id: 'g', name: 'div', type: 'FRAME',
    children: [{ id: 'g-text', name: 'span', type: 'TEXT', text: 'Hello world' }],
  };
  assert(deriveDisplayName(frameWithText) === 'Container', 'name: FRAME w/ TEXT child keeps friendly label (text shown separately in UI)');
}

// ─── TEST 3: rangeBetween ──
async function testRangeBetween(): Promise<void> {
  const rows = flattenTree(makeSampleTree());
  const range = rangeBetween(rows, 'hero', 'pricing');
  assert(range.length === 4, `range: hero..pricing = 4 (got ${range.length})`);
  assert(range[0] === 'hero' && range[3] === 'pricing', 'range: endpoints inclusive');
  // Reverse direction returns same forward order.
  const reverse = rangeBetween(rows, 'pricing', 'hero');
  assert(JSON.stringify(reverse) === JSON.stringify(range), 'range: direction independent');
  // Same id → single
  assert(rangeBetween(rows, 'hero', 'hero').length === 1, 'range: same id → 1 element');
  // Missing id → empty
  assert(rangeBetween(rows, 'hero', 'missing').length === 0, 'range: missing id → empty');
}

// ─── TEST 4: filterTreeByName + ancestor preservation ──
async function testFilter(): Promise<void> {
  const tree = makeSampleTree();
  const rows = flattenTree(tree);
  const parents = buildParentMap(tree);
  // Filter searches displayName (post-FRIENDLY substitution + TEXT
  // absorption), not raw id. 'Pricing' is the literal name on the
  // pricing FRAME (not in FRIENDLY map), so its displayName === name.
  const visible = filterTreeByName(rows, parents, 'Pricing');
  assert(visible !== null, 'filter: non-empty query returns set');
  assert(visible!.has('pricing'), 'filter: matched displayName present');
  assert(visible!.has('root'), 'filter: ancestor root preserved');
  assert(!visible!.has('hero'), 'filter: unrelated branch excluded');
  // Empty query → null (full tree visible)
  assert(filterTreeByName(rows, parents, '') === null, 'filter: empty query → null');
  assert(filterTreeByName(rows, parents, '   ') === null, 'filter: whitespace → null');
  // Case-insensitive — TEXT node 'h1' becomes "Welcome" via TEXT
  // absorption (text content of the heading is "Welcome").
  const upper = filterTreeByName(rows, parents, 'WELCOME');
  assert(upper !== null && upper.has('hero-title'), 'filter: case-insensitive');
}

// ─── TEST 5: nextRowId cyclic walk ──
async function testNextRow(): Promise<void> {
  const rows = flattenTree(makeSampleTree());
  const visibleIds = new Set(rows.map((r) => r.id));
  assert(nextRowId(rows, visibleIds, 'hero', 1) === 'hero-title', 'next: hero → hero-title forward');
  assert(nextRowId(rows, visibleIds, 'hero', -1) === 'root', 'next: hero → root backward');
  assert(nextRowId(rows, visibleIds, 'pricing-card', 1) === 'root', 'next: last → wraps to first');
  assert(nextRowId(rows, visibleIds, 'root', -1) === 'pricing-card', 'next: first → wraps to last backward');
}

// ─── TEST 6: validateReorder rejects self ──
async function testValidateSelf(): Promise<void> {
  const tree = makeSampleTree();
  const rows = flattenTree(tree);
  const parents = buildParentMap(tree);
  const err = validateReorder({ rows, parentByChild: parents, nodeId: 'hero', targetId: 'hero', position: 'before', rootId: 'root' });
  assert(err === 'edit.reorder.invalid_self', `validate: self → invalid_self (got ${err})`);
}

// ─── TEST 7: validateReorder rejects descendant target ──
async function testValidateDescendant(): Promise<void> {
  const tree = makeSampleTree();
  const rows = flattenTree(tree);
  const parents = buildParentMap(tree);
  // Try to drop hero into hero-title (its own descendant)
  const err = validateReorder({ rows, parentByChild: parents, nodeId: 'hero', targetId: 'hero-title', position: 'inside', rootId: 'root' });
  assert(err === 'edit.reorder.invalid_descendant', 'validate: descendant target rejected');
}

// ─── TEST 8: validateReorder rejects locked target ──
async function testValidateLocked(): Promise<void> {
  const tree = makeSampleTree();
  const rows = flattenTree(tree);
  const parents = buildParentMap(tree);
  // pricing is locked in our sample tree.
  const err = validateReorder({ rows, parentByChild: parents, nodeId: 'hero', targetId: 'pricing', position: 'inside', rootId: 'root' });
  assert(err === 'edit.reorder.target_locked', 'validate: locked target rejected');
}

// ─── TEST 9: validateReorder rejects scene root as source ──
async function testValidateRoot(): Promise<void> {
  const tree = makeSampleTree();
  const rows = flattenTree(tree);
  const parents = buildParentMap(tree);
  const err = validateReorder({ rows, parentByChild: parents, nodeId: 'root', targetId: 'hero', position: 'after', rootId: 'root' });
  assert(err === 'edit.reorder.is_root', 'validate: scene root cannot move');
}

// ─── TEST 10: validateReorder rejects sibling-of-root ──
async function testValidateRootSibling(): Promise<void> {
  const tree = makeSampleTree();
  const rows = flattenTree(tree);
  const parents = buildParentMap(tree);
  const err = validateReorder({ rows, parentByChild: parents, nodeId: 'hero', targetId: 'root', position: 'before', rootId: 'root' });
  assert(err === 'edit.reorder.target_is_root', 'validate: cannot drop sibling-of-root');
}

// ─── TEST 11: validateReorder accepts valid sibling reorder ──
async function testValidateValid(): Promise<void> {
  const tree = makeSampleTree();
  const rows = flattenTree(tree);
  const parents = buildParentMap(tree);
  const err = validateReorder({ rows, parentByChild: parents, nodeId: 'hero', targetId: 'pricing-card', position: 'after', rootId: 'root' });
  // pricing-card is descendant of pricing (locked) — but pricing-card
  // itself is not locked. Cycle check: target must not be descendant
  // of node — pricing-card is NOT descendant of hero. Valid drop.
  assert(err === null, `validate: valid drop (got ${err})`);
}

// ─── TEST 12: layers panel JS bundle has visibility + lock + drag wiring ──
async function testJsBundleWiring(): Promise<void> {
  loadFixtures();
  // Visibility toggle
  assert(sidebarJs.includes('layer-vis'), 'js: visibility class referenced');
  assert(/data-layer-visible/.test(sidebarJs), 'js: visible state attribute emitted');
  // Lock toggle
  assert(sidebarJs.includes('layer-lock'), 'js: lock class referenced');
  assert(/data-layer-locked/.test(sidebarJs), 'js: locked state attribute emitted');
  // Drag-reorder wiring
  assert(sidebarJs.includes('bindLayersDragReorder'), 'js: drag-reorder binder defined');
  assert(sidebarJs.includes("'/platform/api/node/reorder'"), 'js: reorder endpoint called');
  assert(sidebarJs.includes('layer-drop-before') && sidebarJs.includes('layer-drop-after') && sidebarJs.includes('layer-drop-inside'),
    'js: three drop indicator classes referenced');
  // Rename inline
  assert(sidebarJs.includes('data-layer-rename'), 'js: rename anchor present');
  // Multi-select
  assert(sidebarJs.includes('layersSelectedIds'), 'js: multi-select set defined');
  assert(/e\.shiftKey/.test(sidebarJs) && /e\.metaKey/.test(sidebarJs), 'js: Shift/Cmd modifier handling');
  // Filter
  assert(sidebarJs.includes('bindLayersFilter'), 'js: filter binder defined');
  // Keyboard nav
  assert(sidebarJs.includes('bindLayersKeyboardNav'), 'js: keyboard nav binder defined');
  assert(sidebarJs.includes('ArrowDown') && sidebarJs.includes('ArrowUp'), 'js: arrow key handlers');
}

// ─── TEST 13: layout.ts emits filter input + tabindex on tree ──
async function testLayoutFilterInput(): Promise<void> {
  assert(layoutTs.includes('data-layers-filter'), 'layout: filter input attr present');
  assert(/Filter\s+layers\.\.\./.test(layoutTs), 'layout: filter placeholder text');
  assert(/data-layers-tree[^>]*tabindex/.test(layoutTs), 'layout: tree has tabindex for keyboard focus');
}

// ─── TEST 14: reorder endpoint shape ──
async function testReorderEndpoint(): Promise<void> {
  assert(nodeEditTs.includes("'/platform/api/node/reorder'"), 'api: reorder path declared');
  // All three position values
  for (const p of ['before', 'after', 'inside']) {
    assert(nodeEditTs.includes(`'${p}'`), `api: position "${p}" handled`);
  }
  // Cycle guard
  assert(/edit\.reorder\.invalid/.test(nodeEditTs), 'api: cycle guard error code emitted');
  // Locked-target guard
  assert(/edit\.reorder\.target_locked/.test(nodeEditTs), 'api: target_locked error code');
  // Calls reparentNode + reorderChild
  assert(/reparentNode\(/.test(nodeEditTs), 'api: uses reparentNode');
  assert(/reorderChild\(/.test(nodeEditTs), 'api: uses reorderChild');
}

// ─── TEST 15: visible + locked + name patches accepted by /node/edit ──
async function testEditPatches(): Promise<void> {
  // case statements for the new keys
  assert(/case 'visible':[^;]*partial\.visible/.test(nodeEditTs), 'api: visible patch handled');
  assert(/case 'locked':[^;]*partial\.locked/.test(nodeEditTs), 'api: locked patch handled');
  assert(/case 'name':[^;]*partial\.name/.test(nodeEditTs), 'api: name patch handled');
  // nodeToCssProps surfaces locked so the inspector + layers panel
  // can read current state.
  assert(/out\['locked'\]/.test(nodeEditTs), 'api: locked emitted in nodeToCssProps');
}

// ─── TEST 16: CSS — drop indicators + hidden/locked + shake animation ──
async function testCssStates(): Promise<void> {
  assert(/\.layer-item\.layer-hidden/.test(cssText), 'css: layer-hidden state styled');
  assert(/\.layer-item\.layer-locked/.test(cssText), 'css: layer-locked state styled');
  assert(/\.layer-item\.layer-dragging/.test(cssText), 'css: dragging state styled');
  assert(/\.layer-item\.layer-drop-before/.test(cssText), 'css: drop-before indicator');
  assert(/\.layer-item\.layer-drop-after/.test(cssText), 'css: drop-after indicator');
  assert(/\.layer-item\.layer-drop-inside/.test(cssText), 'css: drop-inside indicator');
  assert(/@keyframes\s+rfd-layer-shake/.test(cssText), 'css: shake animation defined');
  assert(/\.layer-item\.layer-shake/.test(cssText), 'css: shake class wired');
  assert(/\.layer-item\.primary/.test(cssText), 'css: primary multi-select highlight');
}

// ─── TEST 17: filter empty preserves all rows ──
async function testFilterEmpty(): Promise<void> {
  const tree = makeSampleTree();
  const rows = flattenTree(tree);
  const parents = buildParentMap(tree);
  // Empty filter → null (caller renders full tree)
  const result = filterTreeByName(rows, parents, '');
  assert(result === null, 'filter: empty query returns null sentinel');
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Phase 1 UI-4 Layers panel contract\n');
  loadFixtures();

  const tests: Array<[string, () => Promise<void>]> = [
    ['flattenTree — DFS order + depth + hasChildren', testFlatten],
    ['deriveDisplayName — friendly tag, TEXT absorb, truncation', testDisplayName],
    ['rangeBetween — endpoints inclusive, direction-independent', testRangeBetween],
    ['filterTreeByName — ancestor preservation + case insensitive', testFilter],
    ['nextRowId — cyclic walk forward + backward', testNextRow],
    ['validateReorder — rejects self', testValidateSelf],
    ['validateReorder — rejects descendant target (cycle)', testValidateDescendant],
    ['validateReorder — rejects locked target', testValidateLocked],
    ['validateReorder — rejects scene root as source', testValidateRoot],
    ['validateReorder — rejects sibling-of-root', testValidateRootSibling],
    ['validateReorder — accepts valid drop', testValidateValid],
    ['JS bundle — visibility/lock/drag/rename/multi-select/filter/keyboard wiring', testJsBundleWiring],
    ['layout.ts — filter input element + tree tabindex', testLayoutFilterInput],
    ['API — /node/reorder endpoint with all three positions + guards', testReorderEndpoint],
    ['API — /node/edit accepts visible / locked / name patches', testEditPatches],
    ['CSS — drop indicators + hidden/locked/dragging/shake states', testCssStates],
    ['filter — empty query returns null sentinel', testFilterEmpty],
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
