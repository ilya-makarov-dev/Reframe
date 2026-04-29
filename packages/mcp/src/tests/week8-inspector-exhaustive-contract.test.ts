/**
 * Phase 1 UI-3 — Inspector exhaustive contract.
 *
 * Tests assert against the SHIPPING ARTIFACTS:
 *   - inspector-helpers.ts — pure functions (intersect, filter,
 *     inferControlType, summarizeMeta, groupPropsBySection)
 *   - 110-properties.js (concatenated platform-ui.js bundle) —
 *     multi-select panel + search input + metadata section +
 *     reset-prop wiring
 *   - node-edit.ts — /platform/api/node/get-many endpoint shape +
 *     /platform/api/node/reset-prop endpoint shape
 *
 * No HTTP / DOM mocks — helpers are pure, JS bundle is asserted
 * via string-search on the concatenated artifact. Live Inspector
 * behavior in a real browser is covered by manual / designer-qa
 * probes (deferred while reframe MCP is disconnected).
 *
 * Run: npx tsx packages/mcp/src/tests/week8-inspector-exhaustive-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  intersectSharedProps,
  MIXED_VALUE,
  filterPropsByQuery,
  inferControlType,
  enumOptions,
  summarizeMeta,
  groupPropsBySection,
  sectionIsRelevant,
  SECTION_ORDER,
} from '../platform/inspector-helpers.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PROPS_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '110-properties.js');
const WIDGETS_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '120-widgets.js');
const INIT_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '160-init.js');
const NODE_EDIT_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'api', 'node-edit.ts');
const BOOTSTRAP_TS = path.join(REPO_ROOT, 'packages', 'editor', 'src', 'app', 'platform-bootstrap.ts');

let propsJs = '';
let widgetsJs = '';
let initJs = '';
let nodeEditTs = '';
let bootstrapTs = '';

function loadFixtures(): void {
  propsJs = fs.readFileSync(PROPS_JS, 'utf-8');
  widgetsJs = fs.readFileSync(WIDGETS_JS, 'utf-8');
  initJs = fs.readFileSync(INIT_JS, 'utf-8');
  nodeEditTs = fs.readFileSync(NODE_EDIT_TS, 'utf-8');
  bootstrapTs = fs.readFileSync(BOOTSTRAP_TS, 'utf-8');
}

// ─── TEST 1: intersectSharedProps with same values ──
async function testIntersectSame(): Promise<void> {
  const result = intersectSharedProps([
    { width: 100, color: '#fff', opacity: 0.5 },
    { width: 100, color: '#fff', opacity: 0.5 },
    { width: 100, color: '#fff', opacity: 0.5 },
  ]);
  assert(result.width === 100, `intersect-same: width = 100 (got ${result.width})`);
  assert(result.color === '#fff', 'intersect-same: color preserved');
  assert(result.opacity === 0.5, 'intersect-same: opacity preserved');
}

// ─── TEST 2: intersectSharedProps with divergent → MIXED ──
async function testIntersectMixed(): Promise<void> {
  const result = intersectSharedProps([
    { width: 100, color: '#fff', shared: 'yes' },
    { width: 200, color: '#fff', shared: 'yes' },
    { width: 100, color: '#000', shared: 'yes' },
  ]);
  assert(result.width === MIXED_VALUE, 'intersect-mixed: width diverges → Mixed');
  assert(result.color === MIXED_VALUE, 'intersect-mixed: color diverges → Mixed');
  assert(result.shared === 'yes', 'intersect-mixed: shared kept verbatim');
}

// ─── TEST 3: intersectSharedProps drops keys not in all maps ──
async function testIntersectMissingKeys(): Promise<void> {
  const result = intersectSharedProps([
    { width: 100, height: 50 },
    { width: 100 }, // height missing
  ]);
  assert(result.width === 100, 'intersect-missing: width retained (in all)');
  assert(!('height' in result), 'intersect-missing: height dropped (not in second map)');
}

// ─── TEST 4: intersect deep-equal objects collapse to non-Mixed ──
async function testIntersectDeepEqual(): Promise<void> {
  const result = intersectSharedProps([
    { effects: [{ type: 'DROP_SHADOW', radius: 4 }] },
    { effects: [{ type: 'DROP_SHADOW', radius: 4 }] },
  ]);
  assert(result.effects !== MIXED_VALUE, 'intersect-deep: identical effect arrays not Mixed');
  assert(Array.isArray(result.effects), 'intersect-deep: effects shape preserved');
}

// ─── TEST 5: filterPropsByQuery ──
async function testFilter(): Promise<void> {
  const props = { 'padding-top': 8, 'padding-left': 8, color: '#fff', width: 100 };
  const filtered = filterPropsByQuery(props, 'padding');
  assert(Object.keys(filtered).length === 2, `filter: 2 padding props (got ${Object.keys(filtered).length})`);
  assert('padding-top' in filtered && 'padding-left' in filtered, 'filter: padding-* matched');
  assert(!('color' in filtered), 'filter: color excluded');
  // Empty query returns input unchanged.
  assert(Object.keys(filterPropsByQuery(props, '')).length === 4, 'filter: empty query passes all');
  assert(Object.keys(filterPropsByQuery(props, '   ')).length === 4, 'filter: whitespace-only passes all');
  // Case insensitive.
  assert(Object.keys(filterPropsByQuery(props, 'PADDING')).length === 2, 'filter: case-insensitive');
}

// ─── TEST 6: inferControlType ──
async function testInferControlType(): Promise<void> {
  assert(inferControlType('background', '#fff') === 'color', 'control: background → color');
  assert(inferControlType('color', '#000') === 'color', 'control: color → color');
  assert(inferControlType('opacity', 0.5) === 'range', 'control: opacity → range');
  assert(inferControlType('width', 100) === 'number', 'control: width → number');
  assert(inferControlType('padding-top', 8) === 'number', 'control: padding-top → number');
  assert(inferControlType('display', 'flex-row') === 'enum', 'control: display → enum');
  assert(inferControlType('visible', true) === 'boolean', 'control: visible → boolean');
  assert(inferControlType('border-radius', 4) === 'borderRadius', 'control: border-radius → borderRadius composite');
  assert(inferControlType('effects', []) === 'shadow', 'control: effects → shadow composite');
  assert(inferControlType('annotations', []) === 'metadata-summary', 'control: annotations → metadata-summary');
  assert(inferControlType('narrative', {}) === 'metadata-summary', 'control: narrative → metadata-summary');
  assert(inferControlType('unknown-prop', 'foo') === 'string', 'control: unknown → string fallback');

  const dispOpts = enumOptions('display');
  assert(dispOpts.includes('flex-row') && dispOpts.includes('flex-col'), 'enum: display options');
  assert(enumOptions('width').length === 0, 'enum: non-enum returns empty');
}

// ─── TEST 7: summarizeMeta ──
async function testSummarizeMeta(): Promise<void> {
  assert(summarizeMeta('annotations', [{}]) === '1 annotation', 'summary: annotations 1');
  assert(summarizeMeta('annotations', [{}, {}, {}]) === '3 annotations', 'summary: annotations 3');
  assert(summarizeMeta('annotations', []) === null, 'summary: empty annotations → null');
  assert(summarizeMeta('annotations', null) === null, 'summary: null annotations → null');
  assert(summarizeMeta('interactive', { type: 'mouse-tilt' }) === 'Interactive: mouse-tilt', 'summary: interactive');
  assert(summarizeMeta('entrance', { type: 'fade-up' }) === 'Entrance: fade-up', 'summary: entrance');
  assert(summarizeMeta('hero', { mode: 'full-bleed-brand' }) === 'Hero: full-bleed-brand', 'summary: hero');
  assert(
    summarizeMeta('narrative', { kind: 'sprite', frameCount: 8 }) === 'Narrative: sprite (8 frames)',
    'summary: narrative with frames',
  );
  assert(summarizeMeta('narrative', { kind: 'sprite' }) === 'Narrative: sprite', 'summary: narrative without frames');
  assert(summarizeMeta('unknown', { foo: 1 }) === null, 'summary: unknown key → null');
}

// ─── TEST 8: groupPropsBySection ──
async function testGroupPropsBySection(): Promise<void> {
  const props = {
    width: 100, height: 50,
    x: 10, y: 20,
    'font-size': 16, 'font-family': 'Inter',
    background: '#fff', visible: true,
    'border-radius': 4, opacity: 0.9,
    annotations: [{}],
    gap: 8, 'padding-top': 12,
    id: 'abc', type: 'frame', name: 'thing',
  };
  const grouped = groupPropsBySection(props);
  assert('width' in grouped.Size && 'height' in grouped.Size, 'group: Size has width + height');
  assert('x' in grouped.Position && 'y' in grouped.Position, 'group: Position has x + y');
  assert('font-size' in grouped.Typography, 'group: Typography has font-size');
  assert('background' in grouped.Appearance && 'visible' in grouped.Appearance, 'group: Appearance has background + visible');
  assert('border-radius' in grouped.Effects && 'opacity' in grouped.Effects, 'group: Effects has border-radius + opacity');
  assert('annotations' in grouped.Metadata, 'group: Metadata has annotations');
  assert('gap' in grouped.Layout && 'padding-top' in grouped.Layout, 'group: Layout has gap + padding-top');
  // Identity / structural keys hidden
  assert(!Object.values(grouped).some((s) => 'id' in s), 'group: id hidden');
  assert(!Object.values(grouped).some((s) => 'type' in s), 'group: type hidden');
  // SECTION_ORDER stable
  assert(SECTION_ORDER[0] === 'Layout' && SECTION_ORDER[6] === 'Metadata', 'group: section order Layout..Metadata');
}

// ─── TEST 9: sectionIsRelevant ──
async function testSectionRelevance(): Promise<void> {
  // Image node — no Typography props
  const imgProps = { width: 100, height: 50, background: '#fff' };
  assert(!sectionIsRelevant('Typography', imgProps), 'relevance: Typography hidden for image');
  assert(sectionIsRelevant('Size', imgProps), 'relevance: Size shown for image');
  // Text node — Typography relevant
  const textProps = { 'font-size': 16, 'font-family': 'Inter', 'text-content': 'hi' };
  assert(sectionIsRelevant('Typography', textProps), 'relevance: Typography shown for text');
  assert(!sectionIsRelevant('Layout', textProps), 'relevance: Layout hidden for text-only');
}

// ─── TEST 10: properties.js bundle has multi-select wiring ──
async function testJsMultiSelectWiring(): Promise<void> {
  loadFixtures();
  assert(propsJs.includes('function showPropsForNodes'), 'js: showPropsForNodes function defined');
  assert(propsJs.includes('renderMultiSelectPanel'), 'js: renderMultiSelectPanel function defined');
  assert(propsJs.includes('/platform/api/node/get-many'), 'js: calls get-many endpoint');
  assert(propsJs.includes('mixedSentinel'), 'js: reads mixedSentinel from response');
  assert(propsJs.includes('window.showPropsForNodes ='), 'js: exposed on window for cross-module access');
  // 160-init.js routes multi-select to showPropsForNodes
  assert(initJs.includes('detail.multi') && initJs.includes('window.showPropsForNodes'),
    'init: multi-select routes to showPropsForNodes');
}

// ─── TEST 11: search filter input + handler ──
async function testJsSearchFilter(): Promise<void> {
  assert(propsJs.includes('data-props-filter'), 'js: filter input attr present');
  assert(propsJs.includes('function bindPropsFilter'), 'js: bindPropsFilter function defined');
  assert(propsJs.includes('Filter properties...'), 'js: filter placeholder text present');
  // Filter handler runs over data-prop attrs
  assert(/data-prop['"]?\s*\)/.test(propsJs), 'js: filter walks data-prop attrs');
}

// ─── TEST 12: section collapse persistence ──
async function testJsCollapsePersistence(): Promise<void> {
  assert(propsJs.includes('reframe-inspector-collapsed-sections'), 'js: localStorage key present');
  assert(propsJs.includes('function bindCollapsePersistence'), 'js: persistence binder defined');
  // Reads on render, writes on toggle
  assert(propsJs.includes('localStorage.getItem(KEY') || propsJs.includes("localStorage.getItem(KEY)"),
    'js: reads from localStorage');
  assert(/localStorage\.setItem\(KEY/.test(propsJs), 'js: writes to localStorage on toggle');
}

// ─── TEST 13: metadata section render ──
async function testJsMetadataSection(): Promise<void> {
  assert(propsJs.includes('function renderMetaRows'), 'js: renderMetaRows function defined');
  // All five metadata field types appear
  for (const meta of ['annotations', 'interactive', 'entrance', 'hero', 'narrative']) {
    assert(propsJs.includes(meta), `js: metadata field ${meta} referenced`);
  }
  assert(/Metadata<span class="chevron">/.test(propsJs), 'js: Metadata section header rendered');
}

// ─── TEST 14: reset-prop button + handler ──
async function testJsResetProp(): Promise<void> {
  assert(propsJs.includes('function bindResetButtons'), 'js: bindResetButtons defined');
  assert(propsJs.includes('/platform/api/node/reset-prop'), 'js: reset-prop endpoint called');
  assert(widgetsJs.includes('data-reset-prop'), 'widgets: propCompact emits reset attr');
  assert(widgetsJs.includes('prop-reset-btn'), 'widgets: reset button class present');
}

// ─── TEST 15: get-many endpoint shape ──
async function testGetManyEndpoint(): Promise<void> {
  assert(nodeEditTs.includes("'/platform/api/node/get-many'"), 'api: get-many path declared');
  assert(/intersectSharedProps/.test(nodeEditTs), 'api: imports intersectSharedProps');
  assert(/perNode\s*[:,]/.test(nodeEditTs), 'api: returns perNode map');
  assert(/shared\s*[:,]/.test(nodeEditTs), 'api: returns shared map');
  assert(nodeEditTs.includes('mixedSentinel'), 'api: returns mixedSentinel');
}

// ─── TEST 16: reset-prop endpoint shape ──
async function testResetPropEndpoint(): Promise<void> {
  assert(nodeEditTs.includes("'/platform/api/node/reset-prop'"), 'api: reset-prop path declared');
  assert(nodeEditTs.includes('RESET_MAP'), 'api: declarative reset map present');
  // Multi-node form supported
  assert(/Array\.isArray\(body\.nodeIds\)/.test(nodeEditTs), 'api: accepts nodeIds[] for multi-node reset');
  // Border-radius reset → 0
  assert(/cornerRadius\s*=\s*0/.test(nodeEditTs), 'api: border-radius resets to 0');
  // Visible reset → true
  assert(/visible\s*=\s*true/.test(nodeEditTs), 'api: visible resets to true');
}

// ─── TEST 17: bootstrap event detail carries nodeIds ──
async function testBootstrapNodeIds(): Promise<void> {
  // Every multi-select dispatch carries the full ids array — UI-3
  // depends on this so the platform's multi-select path doesn't have
  // to listen to a second event for the array.
  assert(/nodeIds:\s*ids/.test(bootstrapTs), 'bootstrap: canvas-select detail carries nodeIds array');
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Phase 1 UI-3 Inspector exhaustive contract\n');
  loadFixtures();

  const tests: Array<[string, () => Promise<void>]> = [
    ['intersectSharedProps — identical maps preserve values', testIntersectSame],
    ['intersectSharedProps — divergent values become MIXED sentinel', testIntersectMixed],
    ['intersectSharedProps — keys missing in some maps dropped', testIntersectMissingKeys],
    ['intersectSharedProps — deep-equal objects collapse (effects array)', testIntersectDeepEqual],
    ['filterPropsByQuery — case-insensitive substring + empty passes all', testFilter],
    ['inferControlType — color/range/number/enum/boolean/composite/metadata', testInferControlType],
    ['summarizeMeta — annotations/interactive/entrance/hero/narrative', testSummarizeMeta],
    ['groupPropsBySection — 7 sections, identity hidden, order stable', testGroupPropsBySection],
    ['sectionIsRelevant — Typography hidden for image, shown for text', testSectionRelevance],
    ['JS bundle — multi-select wiring (showPropsForNodes + get-many call)', testJsMultiSelectWiring],
    ['JS bundle — search filter input + bindPropsFilter', testJsSearchFilter],
    ['JS bundle — collapse persistence via localStorage key', testJsCollapsePersistence],
    ['JS bundle — Metadata section render with all 5 field types', testJsMetadataSection],
    ['JS bundle — reset-prop button + click handler + propCompact attr', testJsResetProp],
    ['API — /node/get-many returns perNode + shared + mixedSentinel', testGetManyEndpoint],
    ['API — /node/reset-prop with nodeIds[] multi-form + RESET_MAP', testResetPropEndpoint],
    ['Bootstrap — reframe:canvas-select detail carries nodeIds array', testBootstrapNodeIds],
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
