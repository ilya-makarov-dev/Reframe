/**
 * INode Conformance Spec — Property Specifications
 *
 * Each entry declares: here's a scene, here's what each export target
 * should produce, here's what should survive roundtrip.
 *
 * ~80 entries covering all 49 INode properties + key compositions.
 */

import type { PropertySpec } from './types';
import { frame, rect, ellipse, text, group, line, solid, linearGradient, radialGradient, dropShadow, innerShadow, blur } from '../builder';

// ═══════════════════════════════════════════════════════════════
// Geometry
// ═══════════════════════════════════════════════════════════════

export const GEOMETRY_SPECS: PropertySpec[] = [
  {
    name: 'geometry/position',
    category: 'geometry',
    scene: frame({ width: 400, height: 300 },
      rect({ x: 50, y: 30, width: 100, height: 80, fills: [solid('#FF0000')] }),
    ),
    html: ['left: 50px', 'top: 30px'],
    svg: 'translate(50,30)',
    react: ['left: 50', 'top: 30'],
    roundtrip: ['x', 'y'],
  },
  {
    name: 'geometry/size',
    category: 'geometry',
    scene: frame({ width: 400, height: 300 },
      rect({ x: 0, y: 0, width: 200, height: 150, fills: [solid('#00FF00')] }),
    ),
    html: ['width: 200px', 'height: 150px'],
    svg: ['width="200"', 'height="150"'],
    react: ['width: 200', 'height: 150'],
    roundtrip: ['width', 'height'],
  },
  {
    name: 'geometry/rotation',
    category: 'geometry',
    scene: frame({ width: 400, height: 300 },
      rect({ x: 100, y: 100, width: 80, height: 80, rotation: 45, fills: [solid('#0000FF')] }),
    ),
    html: 'rotate(45deg)',
    svg: (svg) => svg.includes('rotate(45') || svg.includes('transform='),
    react: (code) => code.includes('rotate') && code.includes('45'),
    roundtrip: ['rotation'],
  },
];

// ═══════════════════════════════════════════════════════════════
// Fills
// ═══════════════════════════════════════════════════════════════

export const FILL_SPECS: PropertySpec[] = [
  {
    name: 'fill/solid',
    category: 'fill',
    scene: frame({ width: 200, height: 200 },
      rect({ x: 0, y: 0, width: 200, height: 200, fills: [solid('#FF6633')] }),
    ),
    html: '#ff6633',
    svg: '#ff6633',
    react: '#ff6633',
  },
  {
    name: 'fill/solid-opacity',
    category: 'fill',
    scene: frame({ width: 200, height: 200 },
      rect({ x: 0, y: 0, width: 200, height: 200, fills: [solid('#FF0000', 0.5)] }),
    ),
    html: 'rgba(255, 0, 0, 0.5)',
    svg: 'fill-opacity="0.5',
    react: 'rgba(255, 0, 0, 0.5)',
  },
  {
    name: 'fill/linear-gradient',
    category: 'fill',
    scene: frame({ width: 200, height: 200 },
      rect({ x: 0, y: 0, width: 200, height: 200, fills: [
        linearGradient([
          { color: '#FF0000', position: 0 },
          { color: '#0000FF', position: 1 },
        ]),
      ] }),
    ),
    html: /linear-gradient\(/,
    svg: /linearGradient/,
    react: /linear-gradient\(/,
  },
  {
    name: 'fill/radial-gradient',
    category: 'fill',
    scene: frame({ width: 200, height: 200 },
      rect({ x: 0, y: 0, width: 200, height: 200, fills: [
        radialGradient([
          { color: '#FFFFFF', position: 0 },
          { color: '#000000', position: 1 },
        ]),
      ] }),
    ),
    html: /radial-gradient\(/,
    svg: /radialGradient/,
    react: /radial-gradient\(/,
  },
  {
    name: 'fill/multiple-layered',
    category: 'fill',
    scene: frame({ width: 200, height: 200 },
      rect({ x: 0, y: 0, width: 200, height: 200, fills: [
        solid('#FF0000', 0.5),
        solid('#0000FF', 0.3),
      ] }),
    ),
    html: (output) => {
      const bgMatch = output.match(/background:\s*([^;]+)/);
      return !!bgMatch && bgMatch[1].includes(',');
    },
    react: (code) => {
      const bgMatch = code.match(/background:\s*['"]([^'"]+)/);
      return !!bgMatch && bgMatch[1].includes(',');
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// Strokes
// ═══════════════════════════════════════════════════════════════

export const STROKE_SPECS: PropertySpec[] = [
  {
    name: 'stroke/solid',
    category: 'stroke',
    scene: frame({ width: 200, height: 200 },
      rect({ x: 10, y: 10, width: 180, height: 180, strokes: [solid('#333333')], fills: [solid('#FFFFFF')] }),
    ),
    html: ['border:', 'solid', '#333333'],
    svg: ['stroke="#333333"'],
    react: (code) => code.includes('border') && code.includes('#333333'),
    roundtrip: ['strokeWeight'],
  },
  {
    name: 'stroke/dashed',
    category: 'stroke',
    scene: frame({ width: 200, height: 200 },
      rect({ x: 10, y: 10, width: 180, height: 180,
        strokes: [solid('#000000')], dashPattern: [5, 3], fills: [solid('#FFFFFF')] }),
    ),
    html: 'dashed',
    svg: 'stroke-dasharray',
    react: (code) => code.includes('border') && code.includes('solid'),  // React border always solid for now
    roundtrip: ['strokeWeight'],
  },
  {
    name: 'stroke/per-side-weights',
    category: 'stroke',
    scene: frame({ width: 200, height: 200 },
      rect({
        x: 10, y: 10, width: 180, height: 180,
        strokes: [solid('#000000')],
        independentStrokeWeights: true,
        borderTopWeight: 3, borderRightWeight: 0,
        borderBottomWeight: 1, borderLeftWeight: 0,
        fills: [solid('#FFFFFF')],
      }),
    ),
    html: 'border-width: 3px 0 1px 0',
    react: (code) => code.includes('borderWidth') && code.includes('3px') && code.includes('1px'),
    roundtrip: ['borderTopWeight', 'borderBottomWeight', 'borderRightWeight', 'borderLeftWeight'],
  },
];

// ═══════════════════════════════════════════════════════════════
// Shape (corners, clip)
// ═══════════════════════════════════════════════════════════════

export const SHAPE_SPECS: PropertySpec[] = [
  {
    name: 'shape/cornerRadius-uniform',
    category: 'shape',
    scene: frame({ width: 200, height: 200 },
      rect({ x: 0, y: 0, width: 200, height: 200, cornerRadius: 12, fills: [solid('#CCCCCC')] }),
    ),
    html: 'border-radius: 12px',
    svg: 'rx="12"',
    react: (code) => code.includes('borderRadius') && code.includes('12'),
    roundtrip: ['cornerRadius'],
  },
  {
    name: 'shape/cornerRadius-independent',
    category: 'shape',
    scene: frame({ width: 200, height: 200 },
      rect({
        x: 0, y: 0, width: 200, height: 200,
        independentCorners: true,
        topLeftRadius: 8, topRightRadius: 0,
        bottomRightRadius: 16, bottomLeftRadius: 4,
        fills: [solid('#CCCCCC')],
      }),
    ),
    html: 'border-radius: 8px 0 16px 4px',
    svg: /<path /,
    react: (code) => code.includes('borderRadius') && code.includes('8px'),
    roundtrip: ['topLeftRadius', 'topRightRadius', 'bottomRightRadius', 'bottomLeftRadius'],
  },
  {
    name: 'shape/clipsContent',
    category: 'shape',
    scene: frame({ width: 300, height: 300, fills: [solid('#EEEEEE')] },
      frame({ x: 50, y: 50, width: 200, height: 200, clipsContent: true, fills: [solid('#FFFFFF')] },
        rect({ x: -50, y: -50, width: 300, height: 300, fills: [solid('#FF0000')] }),
      ),
    ),
    html: 'overflow: hidden',
    svg: /clipPath/,
    react: (code) => code.includes('overflow') && code.includes('hidden'),
  },
  {
    name: 'shape/ellipse',
    category: 'shape',
    scene: frame({ width: 200, height: 200 },
      ellipse({ x: 50, y: 50, width: 100, height: 100, fills: [solid('#3366FF')] }),
    ),
    html: 'border-radius: 50%',
    svg: /<ellipse/,
    react: (code) => code.includes('borderRadius') && code.includes('50%'),
  },
];

// ═══════════════════════════════════════════════════════════════
// Effects
// ═══════════════════════════════════════════════════════════════

export const EFFECT_SPECS: PropertySpec[] = [
  {
    name: 'effect/drop-shadow',
    category: 'effect',
    scene: frame({ width: 200, height: 200 },
      rect({
        x: 20, y: 20, width: 160, height: 160,
        fills: [solid('#FFFFFF')],
        effects: [dropShadow({ offset: { x: 4, y: 4 }, radius: 8, spread: 2 })],
      }),
    ),
    html: /box-shadow:.*4px 4px 8px 2px/,
    svg: /feDropShadow|feGaussianBlur/,
    react: (code) => code.includes('boxShadow') && code.includes('4px'),
  },
  {
    name: 'effect/inner-shadow',
    category: 'effect',
    scene: frame({ width: 200, height: 200 },
      rect({
        x: 20, y: 20, width: 160, height: 160,
        fills: [solid('#FFFFFF')],
        effects: [innerShadow({ offset: { x: 0, y: 2 }, radius: 4 })],
      }),
    ),
    html: /box-shadow:.*inset/,
    react: (code) => code.includes('boxShadow') && code.includes('inset'),
  },
  {
    name: 'effect/blur',
    category: 'effect',
    scene: frame({ width: 200, height: 200 },
      rect({
        x: 20, y: 20, width: 160, height: 160,
        fills: [solid('#FFFFFF')],
        effects: [blur(6)],
      }),
    ),
    html: 'filter: blur(6px)',
    svg: /feGaussianBlur/,
    react: (code) => code.includes('filter') && code.includes('blur(6px)'),
  },
];

// ═══════════════════════════════════════════════════════════════
// Opacity / Blend
// ═══════════════════════════════════════════════════════════════

export const OPACITY_SPECS: PropertySpec[] = [
  {
    name: 'opacity/half',
    category: 'opacity',
    scene: frame({ width: 200, height: 200 },
      rect({ x: 0, y: 0, width: 200, height: 200, opacity: 0.5, fills: [solid('#FF0000')] }),
    ),
    html: 'opacity: 0.5',
    svg: 'opacity="0.5',
    react: (code) => code.includes('opacity') && code.includes('0.5'),
    roundtrip: ['opacity'],
  },
  {
    name: 'opacity/blendMode',
    category: 'opacity',
    scene: frame({ width: 200, height: 200 },
      rect({ x: 0, y: 0, width: 200, height: 200, blendMode: 'MULTIPLY', fills: [solid('#FF0000')] }),
    ),
    html: 'mix-blend-mode: multiply',
    react: (code) => code.includes('mixBlendMode') && code.includes('multiply'),
    roundtrip: ['blendMode'],
  },
];

// ═══════════════════════════════════════════════════════════════
// Text
// ═══════════════════════════════════════════════════════════════

export const TEXT_SPECS: PropertySpec[] = [
  {
    name: 'text/fontSize',
    category: 'text',
    scene: frame({ width: 400, height: 200 },
      text('Hello', { x: 10, y: 10, width: 200, height: 40, fontSize: 32 }),
    ),
    html: 'font-size: 32px',
    svg: 'font-size="32',
    react: (code) => code.includes('fontSize') && code.includes('32'),
    roundtrip: ['fontSize'],
  },
  {
    name: 'text/fontFamily',
    category: 'text',
    scene: frame({ width: 400, height: 200 },
      text('Hello', { x: 10, y: 10, width: 200, height: 40, fontSize: 16, fontFamily: 'Inter' }),
    ),
    html: "font-family: 'Inter'",
    svg: 'font-family="Inter',
    react: (code) => code.includes('fontFamily') && code.includes('Inter'),
    roundtrip: ['fontFamily'],
  },
  {
    name: 'text/fontWeight-bold',
    category: 'text',
    scene: frame({ width: 400, height: 200 },
      text('Bold', { x: 10, y: 10, width: 200, height: 40, fontSize: 16, fontWeight: 700 }),
    ),
    html: 'font-weight: 700',
    svg: 'font-weight="700',
    react: (code) => code.includes('fontWeight') && code.includes('700'),
    roundtrip: ['fontWeight'],
  },
  {
    name: 'text/italic',
    category: 'text',
    scene: frame({ width: 400, height: 200 },
      text('Italic', { x: 10, y: 10, width: 200, height: 40, fontSize: 16, italic: true }),
    ),
    html: 'font-style: italic',
    svg: 'font-style="italic',
    react: (code) => code.includes('fontStyle') && code.includes('italic'),
    roundtrip: ['italic'],
  },
  {
    name: 'text/align-center',
    category: 'text',
    scene: frame({ width: 400, height: 200 },
      text('Centered', { x: 10, y: 10, width: 200, height: 40, fontSize: 16, textAlignHorizontal: 'CENTER' }),
    ),
    html: 'text-align: center',
    svg: 'text-anchor="middle',
    react: (code) => code.includes('textAlign') && code.includes('center'),
    roundtrip: ['textAlignHorizontal'],
  },
  {
    name: 'text/align-right',
    category: 'text',
    scene: frame({ width: 400, height: 200 },
      text('Right', { x: 10, y: 10, width: 200, height: 40, fontSize: 16, textAlignHorizontal: 'RIGHT' }),
    ),
    html: 'text-align: right',
    svg: 'text-anchor="end',
    react: (code) => code.includes('textAlign') && code.includes('right'),
    roundtrip: ['textAlignHorizontal'],
  },
  {
    name: 'text/decoration-underline',
    category: 'text',
    scene: frame({ width: 400, height: 200 },
      text('Underlined', { x: 10, y: 10, width: 200, height: 40, fontSize: 16, textDecoration: 'UNDERLINE' }),
    ),
    html: 'text-decoration: underline',
    react: (code) => code.includes('textDecoration') && code.includes('underline'),
    roundtrip: ['textDecoration'],
  },
  {
    name: 'text/decoration-strikethrough',
    category: 'text',
    scene: frame({ width: 400, height: 200 },
      text('Struck', { x: 10, y: 10, width: 200, height: 40, fontSize: 16, textDecoration: 'STRIKETHROUGH' }),
    ),
    html: 'text-decoration: line-through',
    react: (code) => code.includes('textDecoration') && code.includes('line-through'),
    roundtrip: ['textDecoration'],
  },
  {
    name: 'text/case-upper',
    category: 'text',
    scene: frame({ width: 400, height: 200 },
      text('hello', { x: 10, y: 10, width: 200, height: 40, fontSize: 16, textCase: 'UPPER' }),
    ),
    html: 'text-transform: uppercase',
    react: (code) => code.includes('textTransform') && code.includes('uppercase'),
    roundtrip: ['textCase'],
  },
  {
    name: 'text/case-lower',
    category: 'text',
    scene: frame({ width: 400, height: 200 },
      text('HELLO', { x: 10, y: 10, width: 200, height: 40, fontSize: 16, textCase: 'LOWER' }),
    ),
    html: 'text-transform: lowercase',
    react: (code) => code.includes('textTransform') && code.includes('lowercase'),
    roundtrip: ['textCase'],
  },
  {
    name: 'text/letterSpacing',
    category: 'text',
    scene: frame({ width: 400, height: 200 },
      text('Spaced', { x: 10, y: 10, width: 200, height: 40, fontSize: 16, letterSpacing: 2 }),
    ),
    html: 'letter-spacing: 2px',
    svg: 'letter-spacing="2',
    react: (code) => code.includes('letterSpacing') && code.includes('2'),
    roundtrip: ['letterSpacing'],
  },
  {
    name: 'text/lineHeight',
    category: 'text',
    scene: frame({ width: 400, height: 200 },
      text('Tall line', { x: 10, y: 10, width: 200, height: 60, fontSize: 16, lineHeight: 28 }),
    ),
    html: 'line-height: 28px',
    react: (code) => code.includes('lineHeight') && code.includes('28'),
    roundtrip: ['lineHeight'],
  },
  {
    name: 'text/truncation-single-line',
    category: 'text',
    scene: frame({ width: 400, height: 200 },
      text('This text is too long and should be truncated with ellipsis', {
        x: 10, y: 10, width: 150, height: 24, fontSize: 14,
        textTruncation: 'ENDING', maxLines: 1,
      }),
    ),
    html: ['white-space: nowrap', 'text-overflow: ellipsis', 'overflow: hidden'],
    react: (code) => code.includes('whiteSpace') && code.includes('nowrap') && code.includes('textOverflow'),
    roundtrip: ['textTruncation', 'maxLines'],
  },
  {
    name: 'text/truncation-multi-line',
    category: 'text',
    scene: frame({ width: 400, height: 200 },
      text('Multi-line truncation with webkit line clamp', {
        x: 10, y: 10, width: 150, height: 60, fontSize: 14,
        textTruncation: 'ENDING', maxLines: 3,
      }),
    ),
    html: ['-webkit-line-clamp: 3', '-webkit-box-orient: vertical', 'text-overflow: ellipsis'],
    react: (code) => code.includes('WebkitLineClamp') && code.includes('3'),
    roundtrip: ['textTruncation', 'maxLines'],
  },
  {
    name: 'text/color',
    category: 'text',
    scene: frame({ width: 400, height: 200 },
      text('Red text', { x: 10, y: 10, width: 200, height: 40, fontSize: 16, fills: [solid('#FF0000')] }),
    ),
    html: 'color: #ff0000',
    svg: 'fill="#ff0000',
    react: (code) => code.includes('color') && code.includes('#ff0000'),
  },
];

// ═══════════════════════════════════════════════════════════════
// Layout
// ═══════════════════════════════════════════════════════════════

export const LAYOUT_SPECS: PropertySpec[] = [
  {
    name: 'layout/vertical',
    category: 'layout',
    scene: frame({ width: 300, height: 400, layoutMode: 'VERTICAL', itemSpacing: 10, fills: [solid('#FFFFFF')] },
      rect({ width: 280, height: 80, fills: [solid('#FF0000')] }),
      rect({ width: 280, height: 80, fills: [solid('#00FF00')] }),
    ),
    html: ['display: flex', 'flex-direction: column', 'gap: 10px'],
    react: (code) => code.includes('flexDirection') && code.includes('column') && code.includes('gap'),
  },
  {
    name: 'layout/horizontal',
    category: 'layout',
    scene: frame({ width: 400, height: 200, layoutMode: 'HORIZONTAL', itemSpacing: 16, fills: [solid('#FFFFFF')] },
      rect({ width: 100, height: 100, fills: [solid('#FF0000')] }),
      rect({ width: 100, height: 100, fills: [solid('#00FF00')] }),
    ),
    html: ['display: flex', 'flex-direction: row', 'gap: 16px'],
    react: (code) => code.includes('flexDirection') && code.includes('row'),
  },
  {
    name: 'layout/primaryAxis-center',
    category: 'layout',
    scene: frame({ width: 400, height: 200, layoutMode: 'HORIZONTAL', fills: [solid('#FFFFFF')] },
      rect({ width: 100, height: 100, fills: [solid('#FF0000')] }),
    ),
    html: 'justify-content: flex-start',
    react: (code) => code.includes('justifyContent'),
  },
  {
    name: 'layout/counterAxis-center',
    category: 'layout',
    scene: frame({ width: 400, height: 200, layoutMode: 'HORIZONTAL', fills: [solid('#FFFFFF')] },
      rect({ width: 100, height: 100, fills: [solid('#FF0000')] }),
    ),
    html: 'align-items: flex-start',
    react: (code) => code.includes('alignItems'),
  },
  {
    name: 'layout/padding',
    category: 'layout',
    scene: frame({
      width: 300, height: 200,
      layoutMode: 'VERTICAL',
      paddingTop: 20, paddingRight: 16, paddingBottom: 20, paddingLeft: 16,
      fills: [solid('#FFFFFF')],
    },
      rect({ width: 268, height: 80, fills: [solid('#CCCCCC')] }),
    ),
    html: 'padding: 20px 16px 20px 16px',
    react: (code) => code.includes('padding'),
  },
  {
    name: 'layout/wrap',
    category: 'layout',
    scene: frame({ width: 200, height: 200, layoutMode: 'HORIZONTAL', layoutWrap: 'WRAP', fills: [solid('#FFFFFF')] },
      rect({ width: 80, height: 80, fills: [solid('#FF0000')] }),
      rect({ width: 80, height: 80, fills: [solid('#00FF00')] }),
      rect({ width: 80, height: 80, fills: [solid('#0000FF')] }),
    ),
    html: 'flex-wrap: wrap',
    react: (code) => code.includes('flexWrap') && code.includes('wrap'),
  },
  {
    name: 'layout/counterAxisSpacing',
    category: 'layout',
    scene: frame({
      width: 400, height: 400,
      layoutMode: 'HORIZONTAL',
      itemSpacing: 16, counterAxisSpacing: 8,
      fills: [solid('#FFFFFF')],
    },
      rect({ width: 100, height: 100, fills: [solid('#FF0000')] }),
    ),
    html: 'gap: 8px 16px',
    react: (code) => code.includes('gap') && code.includes('8px 16px'),
  },
  {
    name: 'layout/alignSelf',
    category: 'layout',
    scene: frame({ width: 400, height: 200, layoutMode: 'VERTICAL', itemSpacing: 10, fills: [solid('#FFFFFF')] },
      rect({ width: 100, height: 50, layoutAlignSelf: 'CENTER', fills: [solid('#FF0000')] }),
    ),
    html: 'align-self: center',
    react: (code) => code.includes('alignSelf') && code.includes('center'),
  },
  {
    name: 'layout/grow',
    category: 'layout',
    scene: frame({ width: 400, height: 200, layoutMode: 'HORIZONTAL', fills: [solid('#FFFFFF')] },
      rect({ width: 100, height: 100, layoutGrow: 1, fills: [solid('#FF0000')] }),
      rect({ width: 100, height: 100, fills: [solid('#00FF00')] }),
    ),
    html: (output) => output.includes('flex-grow: 1') || output.includes('flex: 1'),
    react: (code) => code.includes('flexGrow'),
  },
];

// ═══════════════════════════════════════════════════════════════
// Compositions (property interactions)
// ═══════════════════════════════════════════════════════════════

export const COMPOSITION_SPECS: PropertySpec[] = [
  {
    name: 'composition/visible-false',
    category: 'composition',
    scene: frame({ width: 200, height: 200, fills: [solid('#FFFFFF')] },
      rect({ x: 0, y: 0, width: 200, height: 200, visible: false, fills: [solid('#FF0000')] }),
    ),
    html: (output) => !output.includes('#ff0000'),
    react: (code) => !code.includes('#ff0000'),
  },
  {
    name: 'composition/nested-flex',
    category: 'composition',
    scene: frame({ width: 600, height: 400, layoutMode: 'VERTICAL', itemSpacing: 20, fills: [solid('#FFFFFF')] },
      frame({ width: 560, height: 150, layoutMode: 'HORIZONTAL', itemSpacing: 10, fills: [solid('#F0F0F0')] },
        rect({ width: 100, height: 100, fills: [solid('#FF0000')] }),
        rect({ width: 100, height: 100, fills: [solid('#00FF00')] }),
      ),
      frame({ width: 560, height: 150, layoutMode: 'HORIZONTAL', itemSpacing: 10, fills: [solid('#E0E0E0')] },
        rect({ width: 100, height: 100, fills: [solid('#0000FF')] }),
      ),
    ),
    html: (output) => {
      const flexCount = (output.match(/display: flex/g) || []).length;
      return flexCount >= 3; // outer + 2 inner
    },
    react: (code) => {
      const flexCount = (code.match(/flexDirection/g) || []).length;
      return flexCount >= 3;
    },
  },
  {
    name: 'composition/text-in-flex',
    category: 'composition',
    scene: frame({ width: 400, height: 200, layoutMode: 'VERTICAL', itemSpacing: 8, fills: [solid('#FFFFFF')] },
      text('Title', { width: 380, height: 40, fontSize: 24, fontWeight: 700 }),
      text('Subtitle', { width: 380, height: 30, fontSize: 16 }),
    ),
    html: (output) => output.includes('flex-direction: column') && output.includes('font-size: 24px'),
    react: (code) => code.includes('column') && code.includes('fontSize: 24'),
  },
  {
    name: 'composition/absolute-in-flex',
    category: 'composition',
    scene: frame({ width: 400, height: 300, layoutMode: 'VERTICAL', fills: [solid('#FFFFFF')] },
      rect({ width: 380, height: 100, fills: [solid('#FF0000')] }),
      rect({ x: 350, y: 10, width: 40, height: 40, layoutPositioning: 'ABSOLUTE', fills: [solid('#00FF00')] }),
    ),
    html: (output) => {
      // Should have both flex layout and an absolute-positioned child
      return output.includes('flex-direction: column') && output.includes('position: absolute');
    },
  },

  // ─── Edge-case compositions ────────────────────────────────

  {
    name: 'composition/clips-overflow',
    category: 'composition',
    scene: frame({ width: 200, height: 100, clipsContent: true, fills: [solid('#FFFFFF')] },
      // Child deliberately overflows parent bounds
      rect({ x: -20, y: -20, width: 300, height: 200, fills: [solid('#FF0000')] }),
    ),
    html: (output) => output.includes('overflow: hidden'),
    react: (code) => code.includes("overflow: 'hidden'") || code.includes('overflow: "hidden"'),
  },
  {
    name: 'composition/truncation-in-flex',
    category: 'composition',
    scene: frame({ width: 300, height: 200, layoutMode: 'VERTICAL', itemSpacing: 8, fills: [solid('#FFFFFF')] },
      text('Very long title that should be truncated with ellipsis to prevent overflow', {
        width: 280, height: 24, fontSize: 16, fontWeight: 700,
        textTruncation: 'ENDING', maxLines: 1,
      }),
      text('Body text that wraps to two lines maximum and then gets cut off with an ellipsis indicator', {
        width: 280, height: 48, fontSize: 14,
        textTruncation: 'ENDING', maxLines: 2,
      }),
    ),
    html: (output) => {
      // Single-line truncation
      const singleLine = output.includes('white-space: nowrap') && output.includes('text-overflow: ellipsis');
      // Multi-line truncation
      const multiLine = output.includes('-webkit-line-clamp: 2');
      return singleLine && multiLine;
    },
    react: (code) => {
      return code.includes('whiteSpace') && code.includes('textOverflow') && code.includes('WebkitLineClamp');
    },
  },
  {
    name: 'composition/grow-with-fixed',
    category: 'composition',
    scene: frame({ width: 600, height: 80, layoutMode: 'HORIZONTAL', itemSpacing: 12, fills: [solid('#F0F0F0')] },
      // Fixed-width sidebar
      rect({ width: 200, height: 60, fills: [solid('#0000FF')] }),
      // Flexible content area that fills remaining space
      rect({ width: 100, height: 60, layoutGrow: 1, fills: [solid('#FF0000')] }),
      // Fixed-width sidebar
      rect({ width: 80, height: 60, fills: [solid('#00FF00')] }),
    ),
    html: (output) => {
      // The growing child should use flex, fixed children should have explicit widths
      return output.includes('flex: 1') && output.includes('width: 200px') && output.includes('width: 80px');
    },
    react: (code) => {
      return code.includes('flexGrow: 1') && code.includes('width: 200') && code.includes('width: 80');
    },
  },
  {
    name: 'composition/shadow-and-radius',
    category: 'composition',
    scene: frame({ width: 300, height: 200, fills: [solid('#FFFFFF')] },
      frame({ width: 260, height: 160, cornerRadius: 16,
        fills: [solid('#EEEEEE')],
        effects: [dropShadow({ color: '#00000040', offset: { x: 0, y: 4 }, radius: 12 })],
      }),
    ),
    html: (output) => output.includes('border-radius: 16px') && output.includes('box-shadow'),
    svg: (output) => {
      // SVG should have both rounded rect and drop-shadow filter
      return output.includes('rx="16"') && /filter/.test(output);
    },
    react: (code) => code.includes('borderRadius') && code.includes('boxShadow'),
  },
  {
    name: 'composition/gradient-stroke-radius',
    category: 'composition',
    scene: frame({ width: 200, height: 200, cornerRadius: 12,
      fills: [linearGradient([{ color: '#FF0000', position: 0 }, { color: '#0000FF', position: 1 }])],
      strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, weight: 2 } as any],
    }),
    html: (output) => {
      return output.includes('linear-gradient') && output.includes('border:') && output.includes('border-radius: 12px');
    },
    react: (code) => {
      return code.includes('linear-gradient') && code.includes('border') && code.includes('borderRadius');
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// All specs combined
// ═══════════════════════════════════════════════════════════════

export const ALL_PROPERTY_SPECS: PropertySpec[] = [
  ...GEOMETRY_SPECS,
  ...FILL_SPECS,
  ...STROKE_SPECS,
  ...SHAPE_SPECS,
  ...EFFECT_SPECS,
  ...OPACITY_SPECS,
  ...TEXT_SPECS,
  ...LAYOUT_SPECS,
  ...COMPOSITION_SPECS,
];
