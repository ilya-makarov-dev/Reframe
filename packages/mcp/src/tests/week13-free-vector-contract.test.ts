/**
 * Phase 2 Brief 2b — Free-vector pen tool contract.
 *
 * Pins covered:
 *   #1 free-vector annotation kind + payload type + KNOWN_ANNOTATION_KINDS
 *      + renderFreeVectorMark in bundle (pointsToPath smooth/plain branches)
 *   #6 free-vector gesture kind + KNOWN_GESTURE_KINDS + translateGesture
 *      maps to free-vector annotation
 *   #2 Pen verb toolbar button (#btn-pen) + drawing capture overlay + state
 *      machine (enterPenMode/exitPenMode/togglePenMode/activatePenCapture)
 *   #4 Pen style controls panel (color/width/opacity/smooth) + localStorage
 *      key `reframe-pen-style`
 *   #3 Context-menu Annotations section + Draw on top entry (data-ctx="pen-draw")
 *      routed before selection guard in handleContextAction
 *   #5 Eraser mode — hover/click handler + delete-icon + Delete key removal
 *   #7 SSE parity for /api/tweaks/declare
 *
 * Run: npx tsx packages/mcp/src/tests/week13-free-vector-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  KNOWN_ANNOTATION_KINDS,
  type AnnotationPayload,
} from '../../../core/src/project/annotations/types.js';
import {
  KNOWN_GESTURE_KINDS,
  type Gesture,
} from '../../../core/src/gestures/types.js';
import { translateGesture } from '../../../core/src/gestures/translate.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const ANNOTATIONS_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '040-annotations.js');
const VERBS_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '030-verbs.js');
const CONTEXT_MENU_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '045-context-menu.js');
const SELECTION_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '020-selection.js');
const LAYOUT_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'layout.ts');
const TWEAKS_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'api', 'tweaks.ts');
const INIT_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '160-init.js');
const CSS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'platform-ui.css');

function main(): void {
  console.log('Phase 2 Brief 2b — Free-vector pen tool contract\n');

  // ─── Pin #1 — annotation kind + render path ───────────────
  console.log('Pin #1 — Annotation kind + render');
  {
    assert(KNOWN_ANNOTATION_KINDS.has('free-vector' as any),
      'KNOWN_ANNOTATION_KINDS includes free-vector');

    // Type-level: build a payload literal and ensure it matches the union
    const payload: AnnotationPayload = {
      kind: 'free-vector',
      points: [{ x: 10, y: 10 }, { x: 20, y: 20 }],
      stroke: '#2b74ff',
      width: 2,
      opacity: 1,
      smooth: true,
    };
    assert(payload.kind === 'free-vector', 'FreeVectorPayload literal type-checks');

    const ann = fs.readFileSync(ANNOTATIONS_JS, 'utf8');
    assert(/case 'free-vector':\s*renderFreeVectorMark/.test(ann),
      'render switch dispatches free-vector → renderFreeVectorMark');
    assert(/function renderFreeVectorMark/.test(ann),
      'renderFreeVectorMark function defined');
    // pointsToPath body — bounded by the next top-level function decl.
    const pp = ann.match(/function pointsToPath[\s\S]*?\n  function\s/);
    assert(pp !== null, 'pointsToPath body extractable');
    assert(pp !== null && pp![0].includes("' L'"),
      'pointsToPath emits L commands for plain polyline');
    assert(pp !== null && pp![0].includes("' C'"),
      'pointsToPath emits C commands when smooth=true (Catmull-Rom)');
    assert(/<path class="mark-free-vector"[^"]*?[\s\S]*?stroke-linecap="round"/.test(ann),
      'free-vector path uses stroke-linecap="round" for fluid stroke');
  }

  // ─── Pin #6 — gesture kind + translator ────────────────────
  console.log('\nPin #6 — Gesture + translator');
  {
    assert(KNOWN_GESTURE_KINDS.has('free-vector' as any),
      'KNOWN_GESTURE_KINDS includes free-vector');

    const g: Gesture = {
      kind: 'free-vector',
      at: '2026-05-01T00:00:00.000Z',
      sceneSlug: 'test-scene',
      author: { kind: 'human', id: 'test' },
      points: [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }],
      stroke: '#dc2626',
      width: 3,
      opacity: 0.8,
      smooth: false,
    };
    const t = translateGesture(g);
    assert(t !== null, 'translateGesture(free-vector) returns translation');
    assert(t!.anchor === 'scene:test-scene',
      'free-vector translates to scene-level anchor (no node anchor)');
    assert(t!.annotation?.kind === 'free-vector',
      'translation produces free-vector annotation');
    if (t!.annotation && t!.annotation.kind === 'free-vector') {
      assert(t!.annotation.points.length === 3, 'points carried through');
      assert(t!.annotation.stroke === '#dc2626', 'stroke carried through');
      assert(t!.annotation.smooth === false, 'smooth flag carried through');
    }
    assert(!t!.intentParts || t!.intentParts.length === 0,
      'free-vector emits no intent parts (visual-only annotation)');
  }

  // ─── Pin #2 — Pen toolbar button + capture overlay ─────────
  console.log('\nPin #2 — Pen verb + capture');
  {
    const layout = fs.readFileSync(LAYOUT_TS, 'utf8');
    assert(/id="btn-pen"[\s\S]*?data-pen-toggle/.test(layout),
      'Toolbar renders #btn-pen with data-pen-toggle attribute');

    const verbs = fs.readFileSync(VERBS_JS, 'utf8');
    assert(/function enterPenMode\s*\(/.test(verbs), 'enterPenMode function defined');
    assert(/function exitPenMode\s*\(/.test(verbs), 'exitPenMode function defined');
    assert(/function togglePenMode\s*\(/.test(verbs), 'togglePenMode function defined');
    assert(/function activatePenCapture/.test(verbs), 'activatePenCapture defined');
    assert(/svg\.addEventListener\('pointerdown'/.test(verbs),
      'pointer capture binds pointerdown on annotation SVG (sibling overlay)');
    assert(/svg\.addEventListener\('pointermove'/.test(verbs),
      'pointer capture binds pointermove for path sampling');
    assert(/svg\.addEventListener\('pointerup'/.test(verbs),
      'pointer capture binds pointerup → commit');
    assert(/PEN_SAMPLE_DISTANCE\s*=\s*4/.test(verbs),
      'point sampling cadence = 4px (avoids over-sampling)');
    assert(/submitGesture\(\s*\{[\s\S]*?kind:\s*'free-vector'/.test(verbs),
      'pointerup commits via submitGesture with kind=free-vector');

    const init = fs.readFileSync(INIT_JS, 'utf8');
    assert(/bindPenToolbarButton/.test(init),
      'bindPenToolbarButton wired on app init');
  }

  // ─── Pin #4 — Style controls + localStorage ─────────────────
  console.log('\nPin #4 — Style controls panel');
  {
    const verbs = fs.readFileSync(VERBS_JS, 'utf8');
    assert(/PEN_STORAGE_KEY\s*=\s*'reframe-pen-style'/.test(verbs),
      'localStorage key is reframe-pen-style');
    assert(/data-pen-field="stroke"/.test(verbs), 'stroke field in panel');
    assert(/data-pen-field="width"/.test(verbs), 'width field in panel');
    assert(/data-pen-field="opacity"/.test(verbs), 'opacity field in panel');
    assert(/data-pen-field="smooth"/.test(verbs), 'smooth field in panel');
    assert(/data-pen-color/.test(verbs), 'palette swatches present');
    assert(/savePenStyle/.test(verbs) && /loadPenStyle/.test(verbs),
      'save/load helpers persist style across sessions');
  }

  // ─── Pin #3 — Context-menu Annotations section ─────────────
  console.log('\nPin #3 — Context-menu entry');
  {
    const ctx = fs.readFileSync(CONTEXT_MENU_JS, 'utf8');
    assert(/ctx-section-label[\s\S]*?Annotations/.test(ctx),
      'Annotations section header present');
    assert(/data-ctx="pen-draw"[\s\S]*?Draw on top/.test(ctx),
      'Draw on top entry with data-ctx="pen-draw"');

    const sel = fs.readFileSync(SELECTION_JS, 'utf8');
    assert(/action === 'pen-draw'[\s\S]*?togglePenMode/.test(sel),
      'pen-draw routed BEFORE selection guard (anchor-free)');
  }

  // ─── Pin #5 — Eraser mode ──────────────────────────────────
  console.log('\nPin #5 — Eraser mode');
  {
    const ann = fs.readFileSync(ANNOTATIONS_JS, 'utf8');
    assert(/function bindFreeVectorEraser/.test(ann),
      'bindFreeVectorEraser binds hover/click on free-vector paths');
    assert(/eraser-selected/.test(ann), 'eraser-selected highlight class');
    assert(/free-vector-erase-btn/.test(ann),
      'delete-pill button class present');
    assert(/'Delete'\s*\|\|\s*e\.key === 'Backspace'/.test(ann),
      'Delete + Backspace keys remove highlighted stroke');
    assert(/annotate-transition[\s\S]*?'dismissed'/.test(ann),
      'eraser dispatches annotate-transition → dismissed');
  }

  // ─── Pin #7 — SSE parity for /api/tweaks/declare ───────────
  console.log('\nPin #7 — SSE parity (/declare)');
  {
    const tweaks = fs.readFileSync(TWEAKS_TS, 'utf8');
    // Match the broadcast inside the /declare handler — declare block ends
    // with 'count: tweaks.length, warnings'. The new emitEvent call must
    // sit between the validation/warnings and the response.
    const declareBlock = tweaks.match(
      /\/platform\/api\/tweaks\/declare[\s\S]*?count:\s*tweaks\.length/,
    );
    assert(declareBlock !== null, 'declare handler block found');
    assert(declareBlock !== null && /emitEvent\(\s*\{\s*type:\s*'scene:session-changed'/.test(declareBlock![0]),
      '/declare emits scene:session-changed SSE on success');
  }

  // ─── CSS polish ─────────────────────────────────────────────
  console.log('\nCSS polish');
  {
    const css = fs.readFileSync(CSS, 'utf8');
    assert(/@keyframes pen-panel-slidein/.test(css),
      'pen-panel slide-in animation defined');
    assert(/\.pen-swatch\.active[\s\S]*?rgba\(43, 116, 255, 0\.15\)/.test(css),
      'active swatch carries Phase 1 focus-ring identity');
    assert(/\.pen-panel[\s\S]*?box-shadow:[\s\S]*?rgba\(43, 116, 255, 0\.08\)/.test(css),
      'pen panel uses Phase 1 focus-ring drop shadow');
    assert(/path\.mark-free-vector\.eraser-selected/.test(css),
      'eraser-selected animated dash style present');
    assert(/\.free-vector-erase-btn/.test(css),
      'delete-pill style present');
    assert(/\.viewport-frame\.pen-active path\.mark-free-vector\s*\{[^}]*pointer-events:\s*none/.test(css),
      'pen-active suppresses hit-testing on existing strokes (drag lands on capture surface)');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
