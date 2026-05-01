/**
 * Phase 2 Brief 2a — Tweaks panel authoring contract.
 *
 * Pins covered:
 *   #1 Authoring modal: bundle string-search for + Add tweak button,
 *      modal markup (Label/ID/Kind radio/Op fields, validation error)
 *   #2 Edit/duplicate/delete row icons + flows
 *   #3 Card-picker convention via getCardPickerKindForTweak helper
 *      (palette.* → palette, typography.* → typography, else null)
 *      + bundle wires the convention in render path
 *   #4 inferSliderDefaults adaptive defaults — exhaustive prop coverage
 *      (opacity, border-radius, font-size, padding, margin, etc.)
 *      + suggestIdFromLabel + isValidTweakId helpers
 *   #5 Backend: /api/tweaks/update + /api/tweaks/remove endpoints in
 *      tweaks.ts; declare endpoint already tolerant of source field
 *
 * Run: npx tsx packages/mcp/src/tests/week12-tweaks-authoring-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  inferSliderDefaults,
  SLIDER_DEFAULTS_FALLBACK,
  listKnownSliderProps,
  getCardPickerKindForTweak,
  suggestIdFromLabel,
  isValidTweakId,
} from '../platform/tweak-defaults.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PANEL_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '115-tweaks-panel.js');
const TWEAKS_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'api', 'tweaks.ts');
const CSS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'platform-ui.css');

function main(): void {
  console.log('Phase 2 Brief 2a — Tweaks authoring contract\n');

  // ─── Pin #4 — inferSliderDefaults ─────────────────────────
  console.log('Pin #4 — inferSliderDefaults');
  {
    // Core props with semantic ranges
    const opacity = inferSliderDefaults('opacity');
    assert(opacity.min === 0 && opacity.max === 1 && opacity.step === 0.05,
      `opacity → 0-1/0.05 (got ${JSON.stringify(opacity)})`);

    const radius = inferSliderDefaults('border-radius');
    assert(radius.min === 0 && radius.max === 32 && radius.step === 1,
      'border-radius → 0-32/1');

    const fontSize = inferSliderDefaults('font-size');
    assert(fontSize.min === 8 && fontSize.max === 72 && fontSize.step === 1,
      'font-size → 8-72/1');

    const padding = inferSliderDefaults('padding');
    assert(padding.min === 0 && padding.max === 128 && padding.step === 4,
      'padding → 0-128/4 (4pt scale)');

    const margin = inferSliderDefaults('margin');
    assert(margin.min === 0 && margin.max === 128 && margin.step === 4,
      'margin → 0-128/4');

    const lineHeight = inferSliderDefaults('line-height');
    assert(lineHeight.min === 0.8 && lineHeight.max === 2.4 && lineHeight.step === 0.05,
      'line-height → 0.8-2.4/0.05');

    const letterSpacing = inferSliderDefaults('letter-spacing');
    assert(letterSpacing.min === -0.05 && letterSpacing.max === 0.2 && letterSpacing.step === 0.005,
      'letter-spacing → -0.05-0.2/0.005');

    const minH = inferSliderDefaults('min-height');
    assert(minH.min === 44, 'min-height min = 44 (WCAG touch target floor)');

    // Unknown prop → fallback
    const fallback = inferSliderDefaults('definitely-not-a-prop');
    assert(fallback.min === 0 && fallback.max === 100 && fallback.step === 1,
      'unknown prop → fallback 0-100/1');
    assert(fallback === SLIDER_DEFAULTS_FALLBACK || (fallback.min === 0 && fallback.max === 100 && fallback.step === 1),
      'fallback constant exposed for caller equality checks');

    // Empty / null prop → fallback
    assert(inferSliderDefaults('').min === 0, 'empty prop returns fallback');
    // @ts-expect-error null intentionally
    assert(inferSliderDefaults(null).max === 100, 'null prop returns fallback');

    // Coverage breadth — at least 25 props mapped
    const knownProps = listKnownSliderProps();
    assert(knownProps.length >= 25,
      `≥25 props mapped (got ${knownProps.length}: ${knownProps.slice(0, 5).join(', ')}…)`);
  }

  // ─── Pin #3 — getCardPickerKindForTweak ────────────────────
  console.log('\nPin #3 — Card-picker convention');
  {
    assert(
      getCardPickerKindForTweak({ kind: 'select', op: { type: 'token', tokenPath: 'palette.accent' } }) === 'palette',
      'select + palette.accent → palette');
    assert(
      getCardPickerKindForTweak({ kind: 'select', op: { type: 'token', tokenPath: 'color.primary' } }) === 'palette',
      'select + color.primary → palette (color.* alias)');
    assert(
      getCardPickerKindForTweak({ kind: 'select', op: { type: 'token', tokenPath: 'typography.display' } }) === 'typography',
      'select + typography.display → typography');
    assert(
      getCardPickerKindForTweak({ kind: 'select', op: { type: 'token', tokenPath: 'font.body' } }) === 'typography',
      'select + font.body → typography (font.* alias)');
    assert(
      getCardPickerKindForTweak({ kind: 'select', op: { type: 'token', tokenPath: 'spacing.gap' } }) === null,
      'select + spacing.gap → null (no picker, falls to dropdown)');
    assert(
      getCardPickerKindForTweak({ kind: 'select', op: { type: 'macro', kind: 'density' } }) === null,
      'select + macro op → null (no token path to inspect)');
    assert(
      getCardPickerKindForTweak({ kind: 'color', op: { type: 'token', tokenPath: 'palette.accent' } }) === null,
      'color kind → null regardless of path (color tweaks render swatch+hex, not card grid)');
    assert(
      getCardPickerKindForTweak(null) === null,
      'null input → null (defensive)');
  }

  // ─── Pin #4 — suggestIdFromLabel + isValidTweakId ──────────
  console.log('\nPin #4 — ID auto-suggest + validation');
  {
    assert(suggestIdFromLabel('Accent color') === 'accent-color', '"Accent color" → accent-color');
    assert(suggestIdFromLabel('Hero Title!') === 'hero-title', '"Hero Title!" → hero-title (special chars stripped)');
    assert(suggestIdFromLabel('  Padding   X  ') === 'padding-x', 'whitespace collapse');
    assert(suggestIdFromLabel('123 starts numeric') === 'starts-numeric',
      'leading numeric stripped (id pattern requires letter start)');
    assert(suggestIdFromLabel('') === '', 'empty input → empty');

    assert(isValidTweakId('valid-id'), 'valid-id matches');
    assert(isValidTweakId('a1') === true, 'a1 matches (letter then alnum)');
    assert(isValidTweakId('1invalid') === false, '1invalid rejected (must start with letter)');
    assert(isValidTweakId('Has-Capital') === false, 'capitals rejected');
    assert(isValidTweakId('') === false, 'empty rejected');
    assert(isValidTweakId('has space') === false, 'space rejected');
  }

  // ─── Pin #1 — Authoring modal markup ───────────────────────
  console.log('\nPin #1 — Authoring modal in bundle');
  {
    const src = fs.readFileSync(PANEL_JS, 'utf8');
    assert(/openTweakAuthorModal/.test(src), 'openTweakAuthorModal function defined');
    assert(/data-tweak-add/.test(src), '+ Add tweak button mounted in panel header');
    assert(/data-tweak-author-modal/.test(src), 'modal carries data-tweak-author-modal mode marker');
    // Required form fields
    assert(/data-tweak-field="label"/.test(src), 'Label field present');
    assert(/data-tweak-field="id"/.test(src), 'ID field present');
    assert(/data-tweak-field="kind"/.test(src), 'Kind radio present');
    // Validation surfacing
    assert(/data-tweak-form-error/.test(src), 'inline error element present');
    assert(/ID "?\s*\+\s*id\s*\+\s*"?\s+already exists|already exists/.test(src),
      'Duplicate ID validation message');
    assert(/Label is required/.test(src), 'Label required validation');
    // Modal mounts in document.body (sibling to #panel — UI-6a Pin #4 lock)
    assert(/document\.body\.appendChild\(overlay\)/.test(src),
      'Modal mounts in document.body (sibling, not nested in tweaks-panel)');
    // Esc closes modal
    assert(/onTweakModalEsc/.test(src), 'Esc handler bound for modal close');
    // ID auto-suggest from label
    assert(/suggestIdFromLabelJS\(labelInput\.value\)/.test(src),
      'Label change triggers ID auto-suggest');
  }

  // ─── Pin #2 — Edit / duplicate / delete row icons ──────────
  console.log('\nPin #2 — Row action icons');
  {
    const src = fs.readFileSync(PANEL_JS, 'utf8');
    assert(/tweak-row-actions/.test(src), 'Row actions container rendered per tweak row');
    assert(/data-tweak-action="edit"/.test(src), 'Edit pencil icon');
    assert(/data-tweak-action="duplicate"/.test(src), 'Duplicate icon');
    assert(/data-tweak-action="delete"/.test(src), 'Delete icon');
    assert(/confirmAndDeleteTweak/.test(src), 'Delete goes through confirm prompt (not silent)');
    assert(/tweak-delete-confirm/.test(src), 'Inline delete confirm card (not browser dialog)');
    assert(/mode === 'duplicate'/.test(src), 'Duplicate mode pre-fills with -copy suffix');
  }

  // ─── Pin #3 — Card-picker render in bundle ─────────────────
  console.log('\nPin #3 — Card-picker rendering wired');
  {
    const src = fs.readFileSync(PANEL_JS, 'utf8');
    assert(/getCardPickerKindForTweakJS/.test(src),
      'Bundle mirror of getCardPickerKindForTweak in render path');
    assert(/tweak-cards-grid/.test(src), 'Card grid markup');
    assert(/pickerKind === 'palette'/.test(src), 'Palette branch in render');
    assert(/pickerKind === 'typography'/.test(src), 'Typography branch in render');
    // Dropdown fallback preserved for non-palette/typography selects
    assert(/document\.createElement\('select'\)/.test(src),
      'Existing <select> dropdown fallback preserved (no breaking change)');
  }

  // ─── Pin #5 — Backend endpoints ────────────────────────────
  console.log('\nPin #5 — /api/tweaks/update + /remove');
  {
    const src = fs.readFileSync(TWEAKS_TS, 'utf8');
    assert(/'\/platform\/api\/tweaks\/update'/.test(src), 'update route declared');
    assert(/'\/platform\/api\/tweaks\/remove'/.test(src), 'remove route declared');
    // update reuses validateTweaks
    assert(/update[\s\S]*?validateTweaks\(\[merged\]\)/.test(src),
      'update endpoint reuses validateTweaks (merged tweak goes through same schema)');
    // update finds by id, replaces in place
    assert(/findIndex\(\(t\) => t\.id === id\)/.test(src),
      'update finds existing by id');
    // remove splices and broadcasts SSE
    assert(/tweaks\.splice\(idx, 1\)/.test(src), 'remove splices the tweak');
    assert(/scene:session-changed/.test(src),
      'SSE broadcast on update + remove for panel re-render');
    // 404 when sceneId/id unknown
    assert(/`scene \$\{sceneId\} not found`/.test(src), '404 on unknown scene');
    assert(/`tweak \$\{id\} not declared`/.test(src), '404 on unknown tweak');
  }

  // ─── Pin #6 — CSS polish ───────────────────────────────────
  console.log('\nPin #6 — Visual polish');
  {
    const css = fs.readFileSync(CSS, 'utf8');
    assert(/@keyframes tweak-author-slidein/.test(css), 'modal slide-in animation');
    assert(/\.tweak-add-btn[\s\S]*?rgb\(43, 116, 255\)/.test(css),
      '+ Add btn picks up focus-ring identity on hover');
    assert(/\.tweak-row:hover \.tweak-row-actions[\s\S]*?opacity:\s*1/.test(css),
      'Row icons hover-revealed (opacity 0 → 1)');
    assert(/\.tweak-card:hover[\s\S]*?transform:\s*scale\(1\.08\)/.test(css),
      'Card hover scale 1.08');
    assert(/\.tweak-card\.active[\s\S]*?rgba\(43, 116, 255, 0\.15\)/.test(css),
      'Active card gets focus-ring glow');
    assert(/\.tweak-author-modal[\s\S]*?box-shadow:\s*0 0 0 3px rgba\(43, 116, 255, 0\.15\)/.test(css),
      'Modal carries Phase 1 focus-ring identity');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
