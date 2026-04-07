/**
 * INode Conformance Spec — Import Specifications
 *
 * Each entry: HTML input → expected INode properties after import.
 * Tests the HTML → INode parser fidelity.
 */

import type { ImportSpec } from './types';

export const IMPORT_SPECS: ImportSpec[] = [

  // ── Gradients ───────────────────────────────────────────

  {
    name: 'gradient/linear-to-right',
    category: 'gradient',
    html: `<div style="width:400px;height:200px;position:relative">
      <div data-name="grad" style="position:absolute;left:0;top:0;width:400px;height:200px;background:linear-gradient(to right, #FF0000, #0000FF)"></div>
    </div>`,
    checks: [
      { path: 'children[0].fills[0].type', expected: 'GRADIENT_LINEAR' },
      { path: 'children[0].fills[0].gradientStops.length', expected: 2 },
    ],
  },

  {
    name: 'gradient/linear-angle-45deg',
    category: 'gradient',
    html: `<div style="width:400px;height:200px;position:relative">
      <div data-name="grad" style="position:absolute;left:0;top:0;width:400px;height:200px;background:linear-gradient(45deg, #FF0000, #00FF00)"></div>
    </div>`,
    checks: [
      { path: 'children[0].fills[0].type', expected: 'GRADIENT_LINEAR' },
      // 45deg gradient should produce a non-identity transform (object with m00, m01, etc.)
      { path: 'children[0].fills[0].gradientTransform', expected: (v: unknown) => v != null && typeof v === 'object' && 'm00' in (v as any) },
    ],
  },

  {
    name: 'gradient/radial',
    category: 'gradient',
    html: `<div style="width:400px;height:200px;position:relative">
      <div data-name="grad" style="position:absolute;left:0;top:0;width:200px;height:200px;background:radial-gradient(circle, #FF0000, #0000FF)"></div>
    </div>`,
    checks: [
      { path: 'children[0].fills[0].type', expected: 'GRADIENT_RADIAL' },
    ],
  },

  // ── CSS Transforms ──────────────────────────────────────

  {
    name: 'transform/rotate-45',
    category: 'transform',
    html: `<div style="width:400px;height:400px;position:relative">
      <div data-name="rotated" style="position:absolute;left:100px;top:100px;width:100px;height:100px;background:#FF0000;transform:rotate(45deg)"></div>
    </div>`,
    checks: [
      { path: 'children[0].rotation', expected: 45, tolerance: 1 },
    ],
  },

  {
    name: 'transform/translateX',
    category: 'transform',
    html: `<div style="width:400px;height:400px;position:relative">
      <div data-name="moved" style="position:absolute;left:10px;top:20px;width:100px;height:100px;background:#FF0000;transform:translateX(50px)"></div>
    </div>`,
    checks: [
      // left:10 + translateX(50) = 60
      { path: 'children[0].x', expected: 60, tolerance: 1 },
    ],
  },

  {
    name: 'transform/scale',
    category: 'transform',
    html: `<div style="width:400px;height:400px;position:relative">
      <div data-name="scaled" style="position:absolute;left:10px;top:10px;width:100px;height:50px;background:#FF0000;transform:scaleX(2) scaleY(3)"></div>
    </div>`,
    checks: [
      // width: 100 * 2 = 200, height: 50 * 3 = 150
      { path: 'children[0].width', expected: 200, tolerance: 1 },
      { path: 'children[0].height', expected: 150, tolerance: 1 },
    ],
  },

  // ── Flex Layout ─────────────────────────────────────────

  {
    name: 'layout/flex-row',
    category: 'layout',
    html: `<div style="width:400px;height:200px;display:flex;flex-direction:row;gap:10px">
      <div data-name="a" style="width:100px;height:100px;background:#FF0000"></div>
      <div data-name="b" style="width:100px;height:100px;background:#0000FF"></div>
    </div>`,
    checks: [
      { path: 'layoutMode', expected: 'HORIZONTAL' },
      { path: 'itemSpacing', expected: 10 },
    ],
  },

  {
    name: 'layout/flex-column',
    category: 'layout',
    html: `<div style="width:400px;height:400px;display:flex;flex-direction:column;gap:20px">
      <div data-name="a" style="width:100px;height:100px;background:#FF0000"></div>
      <div data-name="b" style="width:100px;height:100px;background:#0000FF"></div>
    </div>`,
    checks: [
      { path: 'layoutMode', expected: 'VERTICAL' },
      { path: 'itemSpacing', expected: 20 },
    ],
  },

  {
    name: 'layout/flex-wrap',
    category: 'layout',
    html: `<div style="width:300px;height:300px;display:flex;flex-wrap:wrap;gap:10px">
      <div data-name="a" style="width:100px;height:100px;background:#FF0000"></div>
      <div data-name="b" style="width:100px;height:100px;background:#0000FF"></div>
      <div data-name="c" style="width:100px;height:100px;background:#00FF00"></div>
    </div>`,
    checks: [
      { path: 'layoutWrap', expected: 'WRAP' },
    ],
  },

  {
    name: 'layout/flex-grow',
    category: 'layout',
    html: `<div style="width:400px;height:200px;display:flex;flex-direction:row">
      <div data-name="grow" style="flex:2;height:100px;background:#FF0000"></div>
      <div data-name="fixed" style="width:100px;height:100px;background:#0000FF"></div>
    </div>`,
    checks: [
      { path: 'children[0].layoutGrow', expected: 2, tolerance: 0.1 },
    ],
  },

  {
    name: 'layout/justify-center',
    category: 'layout',
    html: `<div style="width:400px;height:200px;display:flex;justify-content:center">
      <div data-name="a" style="width:100px;height:100px;background:#FF0000"></div>
    </div>`,
    checks: [
      { path: 'primaryAxisAlign', expected: 'CENTER' },
    ],
  },

  {
    name: 'layout/align-center',
    category: 'layout',
    html: `<div style="width:400px;height:200px;display:flex;align-items:center">
      <div data-name="a" style="width:100px;height:100px;background:#FF0000"></div>
    </div>`,
    checks: [
      { path: 'counterAxisAlign', expected: 'CENTER' },
    ],
  },

  {
    name: 'layout/padding',
    category: 'layout',
    html: `<div style="width:400px;height:200px;display:flex;padding:10px 20px 30px 40px">
      <div data-name="a" style="width:100px;height:100px;background:#FF0000"></div>
    </div>`,
    checks: [
      { path: 'paddingTop', expected: 10 },
      { path: 'paddingRight', expected: 20 },
      { path: 'paddingBottom', expected: 30 },
      { path: 'paddingLeft', expected: 40 },
    ],
  },

  // ── Z-index ordering ────────────────────────────────────

  {
    name: 'general/z-index-ordering',
    category: 'general',
    html: `<div style="width:400px;height:400px;position:relative">
      <div data-name="back" style="position:absolute;left:0;top:0;width:200px;height:200px;background:#FF0000;z-index:1"></div>
      <div data-name="front" style="position:absolute;left:0;top:0;width:200px;height:200px;background:#0000FF;z-index:10"></div>
    </div>`,
    checks: [
      // Higher z-index should come later in children array
      { path: 'children[0].name', expected: 'back' },
      { path: 'children[1].name', expected: 'front' },
    ],
  },

  // ── Text ────────────────────────────────────────────────

  {
    name: 'text/overflow-ellipsis',
    category: 'text',
    html: `<div style="width:400px;height:200px;position:relative">
      <span data-name="truncated" style="position:absolute;left:10px;top:10px;width:200px;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Long text here</span>
    </div>`,
    checks: [
      { path: 'children[0].textTruncation', expected: 'ENDING' },
      { path: 'children[0].maxLines', expected: 1 },
    ],
  },

  {
    name: 'text/line-clamp',
    category: 'text',
    html: `<div style="width:400px;height:200px;position:relative">
      <span data-name="clamped" style="position:absolute;left:10px;top:10px;width:200px;font-size:16px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">Multi-line clamped text</span>
    </div>`,
    checks: [
      { path: 'children[0].textTruncation', expected: 'ENDING' },
      { path: 'children[0].maxLines', expected: 3 },
    ],
  },

  // ── Per-side Borders ────────────────────────────────────

  {
    name: 'border/per-side-weights',
    category: 'border',
    html: `<div style="width:400px;height:200px;position:relative">
      <div data-name="bordered" style="position:absolute;left:10px;top:10px;width:200px;height:100px;border-top:2px solid red;border-right:4px solid red;border-bottom:6px solid red;border-left:8px solid red"></div>
    </div>`,
    checks: [
      { path: 'children[0].independentStrokeWeights', expected: true },
      { path: 'children[0].borderTopWeight', expected: 2 },
      { path: 'children[0].borderRightWeight', expected: 4 },
      { path: 'children[0].borderBottomWeight', expected: 6 },
      { path: 'children[0].borderLeftWeight', expected: 8 },
    ],
  },

  // ── Additional layout alignment modes ───────────────────

  {
    name: 'layout/justify-space-between',
    category: 'layout',
    html: `<div style="width:400px;height:200px;display:flex;justify-content:space-between">
      <div data-name="a" style="width:100px;height:100px;background:#FF0000"></div>
      <div data-name="b" style="width:100px;height:100px;background:#0000FF"></div>
    </div>`,
    checks: [
      { path: 'primaryAxisAlign', expected: 'SPACE_BETWEEN' },
    ],
  },

  {
    name: 'layout/align-flex-end',
    category: 'layout',
    html: `<div style="width:400px;height:200px;display:flex;align-items:flex-end">
      <div data-name="a" style="width:100px;height:100px;background:#FF0000"></div>
    </div>`,
    checks: [
      { path: 'counterAxisAlign', expected: 'MAX' },
    ],
  },

  {
    name: 'layout/gap-asymmetric',
    category: 'layout',
    html: `<div style="width:400px;height:400px;display:flex;flex-wrap:wrap;row-gap:10px;column-gap:16px">
      <div data-name="a" style="width:180px;height:100px;background:#FF0000"></div>
      <div data-name="b" style="width:180px;height:100px;background:#0000FF"></div>
    </div>`,
    checks: [
      // Importer reads gap as itemSpacing — use column-gap explicitly
      { path: 'itemSpacing', expected: (v: unknown) => typeof v === 'number' && v > 0 },
    ],
  },

  // ── Combined CSS transform ──────────────────────────────

  {
    name: 'transform/combined-translate-scale',
    category: 'transform',
    html: `<div style="width:400px;height:400px;position:relative">
      <div data-name="combo" style="position:absolute;left:10px;top:20px;width:50px;height:30px;background:#FF0000;transform:translateX(40px) scaleX(2) scaleY(3)"></div>
    </div>`,
    checks: [
      // left:10 + translateX(40) = 50
      { path: 'children[0].x', expected: 50, tolerance: 2 },
      // width: 50 * 2 = 100
      { path: 'children[0].width', expected: 100, tolerance: 2 },
      // height: 30 * 3 = 90
      { path: 'children[0].height', expected: 90, tolerance: 2 },
    ],
  },

  {
    name: 'transform/matrix-decompose',
    category: 'transform',
    html: `<div style="width:400px;height:400px;position:relative">
      <div data-name="matrix" style="position:absolute;left:0;top:0;width:100px;height:100px;background:#0000FF;transform:matrix(0.866, 0.5, -0.5, 0.866, 20, 30)"></div>
    </div>`,
    checks: [
      // matrix decompose: rotation ~30deg, translate (20, 30)
      { path: 'children[0].rotation', expected: 30, tolerance: 2 },
    ],
  },

  // ── Border import ───────────────────────────────────────

  {
    name: 'border/uniform',
    category: 'border',
    html: `<div style="width:400px;height:200px;position:relative">
      <div data-name="bordered" style="position:absolute;left:10px;top:10px;width:200px;height:100px;border:3px solid #333333;background:#FFFFFF"></div>
    </div>`,
    checks: [
      { path: 'children[0].strokeWeight', expected: 3, tolerance: 0.5 },
    ],
  },

  // ── Gradient directions ─────────────────────────────────

  {
    name: 'gradient/to-bottom',
    category: 'gradient',
    html: `<div style="width:400px;height:200px;position:relative">
      <div data-name="grad" style="position:absolute;left:0;top:0;width:200px;height:200px;background:linear-gradient(to bottom, #FF0000, #0000FF)"></div>
    </div>`,
    checks: [
      { path: 'children[0].fills[0].type', expected: 'GRADIENT_LINEAR' },
      { path: 'children[0].fills[0].gradientStops.length', expected: 2 },
    ],
  },

  // ── Flex shorthand ──────────────────────────────────────

  {
    name: 'layout/flex-none',
    category: 'layout',
    html: `<div style="width:600px;height:100px;display:flex">
      <div data-name="none" style="flex:none;width:200px;height:100px;background:#FF0000"></div>
    </div>`,
    checks: [
      { path: 'children[0].layoutGrow', expected: 0, tolerance: 0.1 },
    ],
  },

  {
    name: 'layout/flex-auto',
    category: 'layout',
    html: `<div style="width:600px;height:100px;display:flex">
      <div data-name="auto" style="flex:auto;background:#FF0000"></div>
    </div>`,
    checks: [
      { path: 'children[0].layoutGrow', expected: 1, tolerance: 0.1 },
    ],
  },

  {
    name: 'layout/flex-with-basis',
    category: 'layout',
    html: `<div style="width:600px;height:100px;display:flex">
      <div data-name="basis" style="flex:1 0 200px;background:#FF0000"></div>
    </div>`,
    checks: [
      { path: 'children[0].layoutGrow', expected: 1, tolerance: 0.1 },
    ],
  },

  // ── Z-index 3 elements sorted ───────────────────────────

  {
    name: 'general/z-index-three-way',
    category: 'general',
    html: `<div style="width:400px;height:400px;position:relative">
      <div data-name="back" style="position:absolute;left:0;top:0;width:100px;height:100px;background:#FF0000;z-index:1"></div>
      <div data-name="front" style="position:absolute;left:50px;top:50px;width:100px;height:100px;background:#0000FF;z-index:10"></div>
      <div data-name="middle" style="position:absolute;left:25px;top:25px;width:100px;height:100px;background:#00FF00;z-index:5"></div>
    </div>`,
    checks: [
      { path: 'children[0].name', expected: 'back' },
      { path: 'children[1].name', expected: 'middle' },
      { path: 'children[2].name', expected: 'front' },
    ],
  },

  // ── Gradient angle roundtrip (3-stop, 135deg) ───────────

  {
    name: 'gradient/three-stop-135deg',
    category: 'gradient',
    html: `<div style="width:400px;height:300px;background:linear-gradient(135deg, #ff0000 0%, #00ff00 50%, #0000ff 100%)"></div>`,
    checks: [
      { path: 'fills[0].type', expected: 'GRADIENT_LINEAR' },
      { path: 'fills[0].gradientStops.length', expected: 3 },
      { path: 'fills[0].gradientTransform', expected: (v: unknown) => v != null },
    ],
  },

  // ── Combined translate(x,y) ──────────────────────────────

  {
    name: 'transform/translateXY-combined',
    category: 'transform',
    html: `<div style="width:400px;height:400px;position:relative">
      <div data-name="shifted" style="position:absolute;left:10px;top:20px;width:100px;height:100px;background:#FF0000;transform:translateX(30px) translateY(40px)"></div>
    </div>`,
    checks: [
      // left:10 + translateX(30) = 40
      { path: 'children[0].x', expected: 40, tolerance: 2 },
      // top:20 + translateY(40) = 60
      { path: 'children[0].y', expected: 60, tolerance: 2 },
    ],
  },

  {
    name: 'transform/translate-two-values',
    category: 'transform',
    html: `<div style="width:400px;height:400px;position:relative">
      <div data-name="trans2" style="position:absolute;left:0;top:0;width:100px;height:100px;background:#FF0000;transform:translate(15px, 25px)"></div>
    </div>`,
    checks: [
      { path: 'children[0].x', expected: 15, tolerance: 2 },
      { path: 'children[0].y', expected: 25, tolerance: 2 },
    ],
  },

  {
    name: 'transform/matrix-translation',
    category: 'transform',
    html: `<div style="width:400px;height:400px;position:relative">
      <div data-name="matrixed" style="position:absolute;left:0;top:0;width:100px;height:100px;background:#FF0000;transform:matrix(0.866, 0.5, -0.5, 0.866, 20, 30)"></div>
    </div>`,
    checks: [
      // matrix translation: tx=20, ty=30
      { path: 'children[0].x', expected: 20, tolerance: 2 },
      { path: 'children[0].y', expected: 30, tolerance: 2 },
    ],
  },

  // ── No z-index preserves DOM order ──────────────────────

  {
    name: 'general/dom-order-no-zindex',
    category: 'general',
    html: `<div style="width:400px;height:300px;position:relative">
      <div data-name="first" style="position:absolute;left:0;top:0;width:100px;height:100px;background:#FF0000"></div>
      <div data-name="second" style="position:absolute;left:50px;top:50px;width:100px;height:100px;background:#0000FF"></div>
    </div>`,
    checks: [
      { path: 'children[0].name', expected: 'first' },
      { path: 'children[1].name', expected: 'second' },
    ],
  },

  // ── CSS Combinators (linkedom-powered) ─────────────────────

  {
    name: 'css/descendant-selector',
    category: 'general',
    html: `<div style="width:400px;height:300px;position:relative">
      <style>.container .title { color: #FF0000; font-size: 32px; }</style>
      <div class="container" style="width:400px;height:300px">
        <span class="title">Red Title</span>
      </div>
    </div>`,
    checks: [
      // .container .title should resolve — descendant combinator
      { path: 'children[0].children[0].fontSize', expected: 32 },
      { path: 'children[0].children[0].fills[0].color.r', expected: 1, tolerance: 0.01 },
    ],
  },
  {
    name: 'css/child-combinator',
    category: 'general',
    html: `<div style="width:400px;height:300px">
      <style>.parent > .child { background: #00FF00; width: 200px; height: 100px; }</style>
      <div class="parent" style="width:400px;height:300px;position:relative">
        <div class="child"></div>
      </div>
    </div>`,
    checks: [
      // .parent > .child should match — direct child combinator
      { path: 'children[0].children[0].fills[0].color.g', expected: 1, tolerance: 0.01 },
    ],
  },
  {
    name: 'css/specificity-override',
    category: 'general',
    html: `<div style="width:400px;height:200px">
      <style>
        span { font-size: 14px; color: #000000; }
        .hero-text { font-size: 48px; }
        #main-title { color: #0000FF; }
      </style>
      <span id="main-title" class="hero-text">Big Blue</span>
    </div>`,
    checks: [
      // #main-title (specificity 100) beats span (1) for color → blue
      { path: 'children[0].fills[0].color.b', expected: 1, tolerance: 0.01 },
      // .hero-text (specificity 10) beats span (1) for font-size → 48
      { path: 'children[0].fontSize', expected: 48 },
    ],
  },
  {
    name: 'css/multi-class-selector',
    category: 'general',
    html: `<div style="width:400px;height:200px;position:relative">
      <style>
        .card .btn.primary { background: #0071E3; width: 200px; height: 48px; }
      </style>
      <div class="card" style="width:400px;height:200px">
        <div class="btn primary">Click</div>
      </div>
    </div>`,
    checks: [
      // .card .btn.primary — compound + descendant selector
      { path: 'children[0].children[0].fills[0].color.r', expected: (v: unknown) => typeof v === 'number' && v < 0.1 },
      { path: 'children[0].children[0].fills[0].color.b', expected: (v: unknown) => typeof v === 'number' && v > 0.8 },
    ],
  },
  {
    name: 'css/attribute-selector',
    category: 'general',
    html: `<div style="width:400px;height:200px">
      <style>[data-type="heading"] { font-size: 36px; font-weight: 700; }</style>
      <p data-type="heading">Heading</p>
    </div>`,
    checks: [
      { path: 'children[0].fontSize', expected: 36 },
      { path: 'children[0].fontWeight', expected: 700 },
    ],
  },
];
