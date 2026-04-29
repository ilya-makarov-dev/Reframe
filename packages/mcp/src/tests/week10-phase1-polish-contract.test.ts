/**
 * Phase 1 UI-6a — Polish bridge contract.
 *
 * Pins covered (per accepted (A) merge — Pin #1 absorbs original
 * #1 + #3 layers-rail .primary class fix as state-correctness
 * side-effect):
 *   #1 Layers ↔ canvas selection bidirectional sync
 *      — layers click routes through canvas.setSelection
 *      — canvas-only Cmd+click toggle correctness regression-locked
 *      — primary class follows from canonical state
 *   #2 Inline-edit promotes selection
 *      — startInlineEdit on node N → commitSelection([N]) fired
 *      — multi-select drops on dblclick (Figma behavior)
 *   #3 Inspector swatch label semantics
 *      — getColorFieldsForNode pure helper
 *      — text-shaped types hide Background swatch
 *   #4 Tweaks panel discoverability
 *      — empty-state CTA rendered when 0 tweaks
 *      — header prominence + click-to-collapse + auto-expand persistence
 *
 * No HTTP / DOM mocks beyond hand-rolled stand-ins for the surfaces
 * the helpers touch. Editor pkg is ESM, mcp is CJS — dynamic import
 * bridges the boundary.
 *
 * Run: npx tsx packages/mcp/src/tests/week10-phase1-polish-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  getColorFieldsForNode,
  isTextShapedType,
} from '../platform/inspector-color-fields.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SIDEBAR_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '150-sidebar.js');
const PROPS_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '110-properties.js');
const TWEAKS_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '115-tweaks-panel.js');
const DOM_CANVAS_TS = path.join(REPO_ROOT, 'packages', 'editor', 'src', 'canvas-dom', 'dom-canvas.ts');
const SELECTION_STATE_TS = path.join(REPO_ROOT, 'packages', 'editor', 'src', 'canvas-dom', 'selection-state.ts');
const CSS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'platform-ui.css');

async function main() {
  console.log('Phase 1 UI-6a — polish bridge contract\n');

  // ─── Pin #1 — Layers click routes through canvas API ─────────
  console.log('Pin #1 — Layers ↔ canvas sync');
  {
    const sidebar = fs.readFileSync(SIDEBAR_JS, 'utf8');
    assert(/canvas\.select\(nextIds\)/.test(sidebar),
      'Layers click handler routes through canvas.select(nextIds) — DOMCanvasHandle API');
    assert(/window\.__reframeDOMCanvas/.test(sidebar),
      'Layers reads canvas via legacy global shim (registry getter)');
    // Branch ordering: clicked node ends up last so primary tracks
    // user intent (canvas's setSelection picks ids[ids.length-1] as primary).
    assert(/nextIds\.push\(nodeId\)/.test(sidebar),
      'Shift/Cmd-click branches push clicked node last for primary-tracking');
    // Fallback path preserved when canvas not mounted (defensive).
    assert(/Fallback for callers without a mounted canvas/.test(sidebar),
      'Defensive fallback when canvas not registered');
    // Layers state is now a passive mirror, not authoritative.
    assert(/passive mirror/.test(sidebar) || /single-source-of-truth/.test(sidebar),
      'Code documents layers state as mirror, not source-of-truth');
  }

  // ─── Pin #1 — Canvas-only Cmd+click toggle correctness regression ─
  console.log('\nPin #1 — Canvas-only toggle correctness (regression lock)');
  {
    const editorMod: any = await import('../../../editor/dist/canvas-dom/selection-state.js');
    const { createSelectionState, addToSelection, toggleInSelection, setSelection, selectionAsArray } = editorMod;

    // Repro: {A} → shift+click adds B → {A,B} → cmd+click B → {A}
    const s = createSelectionState();
    setSelection(s, ['A']);
    addToSelection(s, 'B');
    assert(s.selectedIds.has('A') && s.selectedIds.has('B'),
      'Shift-click adds B to {A} → multi {A,B}');
    toggleInSelection(s, 'B');
    const after = selectionAsArray(s);
    assert(after.length === 1 && after[0] === 'A',
      `Cmd+click B from {A,B} → {A} (regression lock; got [${after.join(',')}])`);
    assert(s.primaryId === 'A',
      `Primary remains A after toggling off B (got ${s.primaryId})`);

    // Cmd+click first member: {A,B} + toggle A → {B}, primary = B
    const s2 = createSelectionState();
    setSelection(s2, ['A']);
    addToSelection(s2, 'B');
    toggleInSelection(s2, 'A');
    const after2 = selectionAsArray(s2);
    assert(after2.length === 1 && after2[0] === 'B',
      `Cmd+click A from {A,B} → {B} (got [${after2.join(',')}])`);
  }

  // ─── Pin #2 — Inline-edit promotes selection ─────────────────
  console.log('\nPin #2 — Inline-edit promotes selection');
  {
    const dom = fs.readFileSync(DOM_CANVAS_TS, 'utf8');
    assert(/inline-edit promotes selection/.test(dom),
      'dom-canvas comment documents the inline-edit-promotes-selection invariant');
    assert(/onEditStart:[\s\S]*?commitSelection\(\[id\]\)/.test(dom),
      'onEditStart handler calls commitSelection([id]) for the editing node');
    // Idempotency guard: don't re-fire if already single-selected the host
    assert(/current\.length === 1 && current\[0\] === id/.test(dom),
      'Selection promotion is idempotent for already-single-selected target');
  }

  // ─── Pin #3 — getColorFieldsForNode + Fill section gate ──────
  console.log('\nPin #3 — Swatch label semantics');
  {
    // Pure helper coverage
    assert(getColorFieldsForNode({ type: 'TEXT' }).showBackground === false,
      'TEXT node: showBackground = false');
    assert(getColorFieldsForNode({ type: 'TEXT' }).showColor === true,
      'TEXT node: showColor = true');
    assert(getColorFieldsForNode({ type: 'FRAME' }).showBackground === true,
      'FRAME node: showBackground = true');
    assert(getColorFieldsForNode({ type: 'BUTTON' }).showBackground === false,
      'BUTTON treated as text-shaped (Figma convention)');
    assert(getColorFieldsForNode({ type: 'A' }).showBackground === false,
      'Anchor (A) treated as text-shaped');
    assert(getColorFieldsForNode({ type: 'P' }).showBackground === false,
      'P treated as text-shaped');
    assert(getColorFieldsForNode({ type: 'span' }).showBackground === false,
      'Lowercase tag normalized (case-insensitive)');
    assert(getColorFieldsForNode(null).showBackground === true,
      'Null node defaults to showBackground=true (frame default)');
    assert(getColorFieldsForNode({}).showBackground === true,
      'Missing type defaults to showBackground=true');
    assert(isTextShapedType('H1') && isTextShapedType('H6'),
      'isTextShapedType covers all heading levels');

    // Bundle wires the gate
    const props = fs.readFileSync(PROPS_JS, 'utf8');
    assert(/TEXT_SHAPED_TYPES_JS/.test(props),
      'Inline mirror of TEXT_SHAPED_TYPES_JS in 110-properties.js');
    assert(/if \(!isTextShaped\) \{/.test(props),
      'Fill section gated on !isTextShaped');
    // Original token-binding row preserved for non-text Fill rendering
    assert(/fillRowHtml/.test(props), 'fillRowHtml preserved (non-text frames still render Fill)');
  }

  // ─── Pin #4 — Tweaks panel empty-state + persistence ─────────
  console.log('\nPin #4 — Tweaks panel discoverability');
  {
    const tweaks = fs.readFileSync(TWEAKS_JS, 'utf8');
    assert(/data-tweaks-empty/.test(tweaks),
      'Empty-state CTA element rendered when no tweaks declared');
    assert(/0 declared/.test(tweaks),
      'Empty-state count label "0 declared" present');
    assert(/add tweaks for accent color and spacing/.test(tweaks),
      'Empty-state copy carries the example agent-prompt');
    // Auto-expand on first load when tweaks > 0; per-scene localStorage key
    assert(/reframe-tweaks-collapsed-/.test(tweaks),
      'Per-scene localStorage key for collapse persistence');
    assert(/userCollapsed/.test(tweaks),
      'Auto-expand reads user-collapse state from localStorage');
    // Header click toggles + persists
    assert(/head\.addEventListener\('click'/.test(tweaks),
      'Header click handler bound for collapse toggle');

    // Architectural fix: tweaks-panel hoisted OUT of data-panel="design"
    // so inspector innerHTML overwrites don't wipe it.
    const editorShell = fs.readFileSync(
      path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'pages', 'editor-shell-page.ts'),
      'utf8',
    );
    assert(/Tweaks panel hoisted OUT of/.test(editorShell),
      'Editor shell documents the architectural hoist of tweaks-panel');
    // tweaks-panel <section> should appear BEFORE the data-panel="design"
    // div opening tag in DOM order (sibling, not nested). Search for the
    // actual `<div data-panel="design"` open-tag — comments mentioning the
    // attr appear earlier and would false-positive on a naive substring.
    const tweaksIdx = editorShell.indexOf('data-tweaks-panel');
    const designOpenIdx = editorShell.indexOf('<div data-panel="design"');
    assert(tweaksIdx > 0 && designOpenIdx > 0 && tweaksIdx < designOpenIdx,
      'tweaks-panel section precedes <div data-panel="design"> in DOM order (sibling, not nested)');

    const css = fs.readFileSync(CSS, 'utf8');
    assert(/\.tweaks-empty[\s\S]*?font-style:\s*italic/.test(css),
      'Empty-state copy styled italic (muted CTA)');
    assert(/\.tweaks-title[\s\S]*?font-size:\s*13px/.test(css),
      'Header bumped to 13px (was 11px) for prominence');
    assert(/\.tweaks-panel[\s\S]*?border-left:\s*2px solid rgb\(43, 116, 255\)/.test(css),
      'Accent left-border (focus-ring identity color) on tweaks-panel');
    assert(/\.tweaks-panel\.collapsed/.test(css),
      'Collapsed-state CSS rule present (hides list + empty-state)');
  }

  // ─── Selection-state purity (no regressions to UI-2) ─────────
  console.log('\nIntegration — selection-state.ts purity unchanged');
  {
    const src = fs.readFileSync(SELECTION_STATE_TS, 'utf8');
    assert(/export function toggleInSelection/.test(src),
      'toggleInSelection still exported (UI-2 contract)');
    assert(/state\.selectedIds\.delete\(id\)/.test(src),
      'Delete-on-toggle invariant preserved');
    assert(/state\.primaryId = next/.test(src),
      'Primary re-anchor on toggle-out preserved');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
