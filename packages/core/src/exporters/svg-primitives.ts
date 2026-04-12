/**
 * SVG primitive generators — render individual INode types as inline
 * SVG fragments for use inside HTML export.
 *
 * The HTML exporter traditionally renders every non-text node as a
 * `<div>` with CSS. For layout containers that's correct — flexbox
 * and grid only exist in HTML. But for *vector shapes* (ELLIPSE,
 * STAR, POLYGON, LINE, VECTOR, and RECTANGLE with complex strokes)
 * HTML is a compromise:
 *
 *   - `border-radius: 50%` ≠ real ellipse (fixed aspect, no stroke
 *     control, can't do dash patterns cleanly)
 *   - `clip-path: polygon()` for stars is fragile across browsers
 *   - VECTOR paths are impossible to approximate in CSS
 *   - Complex strokes (dashed, non-uniform weight, rounded caps) lose
 *     fidelity in HTML borders
 *
 * This module produces **inline `<svg>` strings** sized to the node's
 * bounding box. The caller wraps them in a positioned `<div>` so the
 * parent's flex/grid layout still works. CSS variables on the wrapper
 * propagate to SVG fill/stroke via `var(--...)` references when
 * tokens are bound.
 *
 * Design choices:
 *   - Keep attributes minimal — no filters, no transforms, no XML
 *     namespace declarations (HTML5 parses inline SVG without ns)
 *   - Everything rendered in the node's local coordinate space
 *     (0,0) → (width, height). The wrapping `<div>` handles
 *     positioning in the parent layout.
 *   - Gradients and complex fills fall through to the default HTML
 *     path (too much state to handle in a leaf primitive).
 */

import type { SceneNode, Fill, Stroke, Color } from '../engine/types';

// ─── Helpers ────────────────────────────────────────────────

function round(n: number, decimals = 2): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

function colorToRgba(color: Color, opacity = 1): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = (color.a ?? 1) * opacity;
  if (a >= 1) return `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${round(a, 3)})`;
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/&/g, '&amp;');
}

/** Get the primary solid fill (first visible SOLID) or null. */
function primarySolidFill(fills: Fill[] | undefined | null): string | null {
  if (!fills) return null;
  for (const f of fills) {
    if (f.visible === false) continue;
    if (f.type === 'SOLID' && f.color) {
      return colorToRgba(f.color, f.opacity ?? 1);
    }
  }
  return null;
}

/** Get primary solid stroke color. */
function primarySolidStroke(strokes: Stroke[] | undefined | null): string | null {
  if (!strokes) return null;
  for (const s of strokes) {
    if (s.visible === false) continue;
    if (s.color) return colorToRgba(s.color, s.opacity ?? 1);
  }
  return null;
}

/**
 * Build a minimal set of SVG stroke-* attributes from the node.
 * Returns a string fragment ready to drop into an element open tag.
 */
function strokeAttrs(node: SceneNode): string {
  const color = primarySolidStroke(node.strokes as Stroke[] | undefined);
  if (!color) return '';
  const parts: string[] = [`stroke="${color}"`];

  const weight = (node as any).strokeWeight ?? (node.strokes?.[0] as any)?.weight;
  if (typeof weight === 'number' && weight > 0) parts.push(`stroke-width="${round(weight)}"`);

  const dash = node.dashPattern as number[] | undefined;
  if (Array.isArray(dash) && dash.length > 0) {
    parts.push(`stroke-dasharray="${dash.map(n => round(n)).join(' ')}"`);
  }

  const cap = (node as any).strokeCap as string | undefined;
  if (cap === 'ROUND') parts.push('stroke-linecap="round"');
  else if (cap === 'SQUARE') parts.push('stroke-linecap="square"');

  const join = (node as any).strokeJoin as string | undefined;
  if (join === 'ROUND') parts.push('stroke-linejoin="round"');
  else if (join === 'BEVEL') parts.push('stroke-linejoin="bevel"');

  return parts.join(' ');
}

/** Helper: compose a string of SVG attributes, skipping empty values. */
function composeAttrs(parts: Array<string | undefined | null>): string {
  return parts.filter((p): p is string => Boolean(p)).join(' ');
}

// ─── Per-node generators ────────────────────────────────────

export interface SvgPrimitiveOptions {
  /** Width of the node's bounding box (used for viewBox + inner sizing). */
  width: number;
  /** Height of the node's bounding box. */
  height: number;
  /** Optional token CSS var override for the fill (e.g. 'var(--color-primary)') */
  fillVar?: string;
  /** Optional token CSS var override for the stroke */
  strokeVar?: string;
}

/** Generate the INNER SVG element for a single node (no wrapping <svg>). */
export function renderNodePrimitive(node: SceneNode, opts: SvgPrimitiveOptions): string {
  const { width: w, height: h, fillVar, strokeVar } = opts;
  const fill = fillVar ?? primarySolidFill(node.fills as Fill[] | undefined) ?? 'none';
  const strokeBase = strokeAttrs(node);
  const strokeFinal = strokeVar
    ? strokeBase.replace(/stroke="[^"]*"/, `stroke="${strokeVar}"`)
    : strokeBase;

  switch (node.type) {
    case 'ELLIPSE': {
      const cx = round(w / 2);
      const cy = round(h / 2);
      const rx = round(w / 2);
      const ry = round(h / 2);
      return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" ${strokeFinal}/>`;
    }

    case 'LINE': {
      // Line nodes in reframe are axis-aligned from (0,0) to (w, h).
      // Force a visible stroke if none specified — a fill-only line is
      // invisible in SVG (no area), so black 1px is the only sane default.
      const strokeOrDefault = strokeFinal || 'stroke="currentColor" stroke-width="1"';
      return `<line x1="0" y1="0" x2="${round(w)}" y2="${round(h)}" ${strokeOrDefault}/>`;
    }

    case 'STAR': {
      const points = regularStarPoints(w, h, node.pointCount || 5, node.starInnerRadius || 0.5);
      return `<polygon points="${points}" fill="${fill}" ${strokeFinal}/>`;
    }

    case 'POLYGON': {
      const points = regularPolygonPoints(w, h, node.pointCount || 3);
      return `<polygon points="${points}" fill="${fill}" ${strokeFinal}/>`;
    }

    case 'VECTOR': {
      // VECTOR nodes carry a vectorNetwork (vertices + segments) or
      // fillGeometry (binary commands). Neither is trivial to decode
      // here without pulling in the full rasterizer, so we emit a
      // bounding-box rect as a safe placeholder. The html exporter's
      // shouldRenderAsSvg() heuristic will prefer the standard div path
      // for vectors that don't have serialized SVG data in meta.
      const path = (node as any).meta?.svgPath as string | undefined;
      if (path) {
        return `<path d="${escapeAttr(path)}" fill="${fill}" ${strokeFinal}/>`;
      }
      // Fallback — outline the bbox so the element is at least visible
      return `<rect width="${round(w)}" height="${round(h)}" fill="${fill}" ${strokeFinal}/>`;
    }

    case 'RECTANGLE':
    case 'ROUNDED_RECTANGLE':
    case 'FRAME': {
      // Rectangle with independent corners or dashed strokes → SVG is
      // better than HTML border. Otherwise the caller shouldn't be
      // calling us for a plain rect (HTML covers it just fine).
      const r = node.cornerRadius ?? 0;
      const tl = (node as any).topLeftRadius ?? r;
      const tr = (node as any).topRightRadius ?? r;
      const br = (node as any).bottomRightRadius ?? r;
      const bl = (node as any).bottomLeftRadius ?? r;
      const uniform = tl === tr && tr === br && br === bl;
      if (uniform) {
        return `<rect width="${round(w)}" height="${round(h)}" rx="${round(tl)}" ry="${round(tl)}" fill="${fill}" ${strokeFinal}/>`;
      }
      // Non-uniform corners — path with bezier arcs
      const d = roundedRectPath(w, h, tl, tr, br, bl);
      return `<path d="${d}" fill="${fill}" ${strokeFinal}/>`;
    }

    default:
      // Unknown → bounding box rect
      return `<rect width="${round(w)}" height="${round(h)}" fill="${fill}" ${strokeFinal}/>`;
  }
}

/**
 * Wrap a primitive inside a complete inline <svg> element with the
 * correct viewBox. Size is rendered via CSS width/height on the
 * parent wrapper div, so viewBox controls the coordinate system.
 */
export function wrapPrimitiveSvg(
  primitive: string,
  width: number,
  height: number,
): string {
  return `<svg viewBox="0 0 ${round(width)} ${round(height)}" width="100%" height="100%" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${primitive}</svg>`;
}

// ─── Geometry helpers ──────────────────────────────────────

/**
 * Regular polygon points centered in the bounding box, inscribed in
 * an ellipse of the given dimensions. First vertex points up.
 */
function regularPolygonPoints(width: number, height: number, sides: number): string {
  if (sides < 3) sides = 3;
  const cx = width / 2;
  const cy = height / 2;
  const rx = width / 2;
  const ry = height / 2;
  const points: string[] = [];
  for (let i = 0; i < sides; i++) {
    // -Math.PI/2 so the first vertex points up
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    points.push(`${round(x)},${round(y)}`);
  }
  return points.join(' ');
}

/**
 * Regular star points (N-pointed star) with outer and inner radii.
 * innerRatio = starInnerRadius (0..1, Figma convention).
 */
function regularStarPoints(width: number, height: number, points: number, innerRatio: number): string {
  if (points < 3) points = 5;
  if (innerRatio <= 0 || innerRatio >= 1) innerRatio = 0.382; // default pentagram ratio
  const cx = width / 2;
  const cy = height / 2;
  const outerRx = width / 2;
  const outerRy = height / 2;
  const innerRx = outerRx * innerRatio;
  const innerRy = outerRy * innerRatio;
  const step = Math.PI / points;
  const coords: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const angle = -Math.PI / 2 + i * step;
    const rx = i % 2 === 0 ? outerRx : innerRx;
    const ry = i % 2 === 0 ? outerRy : innerRy;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    coords.push(`${round(x)},${round(y)}`);
  }
  return coords.join(' ');
}

/**
 * SVG path for a rectangle with independent corner radii. Uses
 * quarter-circle arc commands.
 */
function roundedRectPath(w: number, h: number, tl: number, tr: number, br: number, bl: number): string {
  // Clamp radii to half of the shorter side so adjacent corners don't overlap
  const cap = Math.min(w, h) / 2;
  const r1 = Math.min(tl, cap);
  const r2 = Math.min(tr, cap);
  const r3 = Math.min(br, cap);
  const r4 = Math.min(bl, cap);
  return [
    `M${round(r1)},0`,
    `L${round(w - r2)},0`,
    `A${round(r2)},${round(r2)} 0 0 1 ${round(w)},${round(r2)}`,
    `L${round(w)},${round(h - r3)}`,
    `A${round(r3)},${round(r3)} 0 0 1 ${round(w - r3)},${round(h)}`,
    `L${round(r4)},${round(h)}`,
    `A${round(r4)},${round(r4)} 0 0 1 0,${round(h - r4)}`,
    `L0,${round(r1)}`,
    `A${round(r1)},${round(r1)} 0 0 1 ${round(r1)},0`,
    'Z',
  ].join(' ');
}

// ─── Heuristics ─────────────────────────────────────────────

/**
 * Decide whether a node should render as inline SVG vs a plain HTML
 * element. Pure shape types always win. RECTANGLE / FRAME wins only
 * when it has features HTML can't express (dashed strokes, non-uniform
 * rounded corners, etc).
 *
 * This is the single source of truth — both the html exporter and the
 * group-detector import from here.
 */
export function shouldRenderAsSvg(node: SceneNode): boolean {
  // Pure vector primitives: always yes
  switch (node.type) {
    case 'ELLIPSE':
    case 'STAR':
    case 'POLYGON':
    case 'LINE':
      return true;
    case 'VECTOR':
      // Only when we have a usable path string in meta (see
      // renderNodePrimitive). Otherwise the default HTML div is fine.
      return Boolean((node as any).meta?.svgPath);
  }

  // RECTANGLE / FRAME: only when HTML borders can't express the stroke
  if (node.type === 'RECTANGLE' || node.type === 'ROUNDED_RECTANGLE') {
    // Dashed stroke — HTML `border-style: dashed` doesn't respect
    // dashPattern arrays, only a single generic dash. Use SVG.
    if (Array.isArray(node.dashPattern) && node.dashPattern.length > 0) return true;
    // Non-uniform border widths (HTML border-*-width works but loses
    // continuity on rounded corners) — use SVG for fidelity.
    const bt = (node as any).borderTopWeight as number | undefined;
    const br = (node as any).borderRightWeight as number | undefined;
    const bb = (node as any).borderBottomWeight as number | undefined;
    const bl = (node as any).borderLeftWeight as number | undefined;
    if (
      (bt !== undefined || br !== undefined || bb !== undefined || bl !== undefined) &&
      !(bt === br && br === bb && bb === bl)
    ) {
      return true;
    }
    return false;
  }

  return false;
}

/**
 * Decide whether a TEXT node has stroke/outline effects that HTML
 * can't render (HTML text has no border/stroke — `-webkit-text-stroke`
 * exists but is non-standard, inconsistent across browsers, and
 * doesn't respect stroke width precisely).
 */
export function shouldRenderTextAsSvg(node: SceneNode): boolean {
  if (node.type !== 'TEXT') return false;
  const strokes = node.strokes as Stroke[] | undefined;
  if (!Array.isArray(strokes) || strokes.length === 0) return false;
  for (const s of strokes) {
    if (s.visible === false) continue;
    const weight = (s as any).weight as number | undefined;
    if (weight && weight > 0) return true;
  }
  return false;
}

/**
 * Render a TEXT node as an SVG <text> element with stroke/outline
 * support. Preserves fontFamily, fontSize, fontWeight, letterSpacing,
 * and textAlignHorizontal.
 */
export function renderTextAsSvg(node: SceneNode): string {
  const w = node.width ?? 0;
  const h = node.height ?? 0;
  const text = node.text || '';
  const fontSize = (node as any).fontSize ?? 16;
  const fontFamily = (node as any).fontFamily ?? 'sans-serif';
  const fontWeight = (node as any).fontWeight ?? 400;
  const letterSpacing = (node as any).letterSpacing ?? 0;
  const lineHeight = (node as any).lineHeight ?? fontSize * 1.2;

  // Fill from the first solid
  const fill = primarySolidFill(node.fills as Fill[] | undefined) ?? '#000';

  // Alignment — convert Figma horizontal align to SVG text-anchor
  const align = (node as any).textAlignHorizontal as string | undefined;
  const textAnchor = align === 'CENTER' ? 'middle' : align === 'RIGHT' ? 'end' : 'start';
  const xPos = align === 'CENTER' ? w / 2 : align === 'RIGHT' ? w : 0;

  const strokeAttr = strokeAttrs(node);

  // Split into lines
  const lines = text.split('\n');
  const lineHeightPx = lineHeight < 10 ? lineHeight * fontSize : lineHeight;

  const escaped = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const tspans = lines.map((line, i) => {
    const dy = i === 0 ? fontSize * 0.85 : lineHeightPx;
    return `<tspan x="${round(xPos)}" dy="${round(dy)}">${escaped(line)}</tspan>`;
  }).join('');

  const textEl = `<text
    x="${round(xPos)}" y="0"
    font-family="${escapeAttr(fontFamily)}"
    font-size="${round(fontSize)}"
    font-weight="${fontWeight}"
    ${letterSpacing ? `letter-spacing="${round(letterSpacing)}"` : ''}
    text-anchor="${textAnchor}"
    fill="${fill}"
    ${strokeAttr}
    paint-order="stroke fill">${tspans}</text>`;

  return `<svg viewBox="0 0 ${round(w)} ${round(h)}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${textEl}</svg>`;
}

/**
 * Decide whether a FRAME node is "icon-like" and can be collapsed into
 * a single inline SVG containing all its descendants. An icon is:
 *   - Small (≤ 128px on the longest side)
 *   - Non-empty
 *   - Every descendant renders as an SVG primitive (via shouldRenderAsSvg)
 *   - No nested text (text in icons is rare and breaks vector assumption)
 *
 * When true, the html exporter emits a single `<svg>` with nested
 * shapes instead of 4–5 divs, dramatically improving fidelity for
 * brand icons, logo marks, and similar compositions.
 */
export function isIconLikeFrame(
  node: SceneNode,
  resolveChild: (id: string) => SceneNode | null | undefined,
): boolean {
  if (node.type !== 'FRAME' && node.type !== 'GROUP') return false;
  const longest = Math.max(node.width ?? 0, node.height ?? 0);
  if (longest <= 0 || longest > 128) return false;
  if (!node.childIds || node.childIds.length === 0) return false;

  function allVectorDescendants(n: SceneNode): boolean {
    for (const cid of n.childIds) {
      const child = resolveChild(cid);
      if (!child) continue;
      if (child.type === 'TEXT') return false;
      if (child.type === 'FRAME' || child.type === 'GROUP') {
        if (!allVectorDescendants(child)) return false;
      } else if (!shouldRenderAsSvg(child)) {
        // Pure colored RECTANGLE might fail shouldRenderAsSvg, but for
        // icon purposes we accept it — render it as a SVG rect.
        if (child.type !== 'RECTANGLE' && child.type !== 'ROUNDED_RECTANGLE') return false;
      }
    }
    return true;
  }

  return allVectorDescendants(node);
}

/**
 * Render an icon-like frame as a single inline SVG containing all
 * nested shapes. Children are positioned via their x/y coordinates
 * relative to the frame.
 */
export function renderIconFrameSvg(
  frame: SceneNode,
  resolveChild: (id: string) => SceneNode | null | undefined,
  tokenLookup?: (nodeId: string, field: string) => string | undefined,
): string {
  const w = frame.width ?? 0;
  const h = frame.height ?? 0;
  const body: string[] = [];

  // Background fill of the frame itself
  const bgFill = primarySolidFill(frame.fills as Fill[] | undefined);
  if (bgFill && bgFill !== 'transparent') {
    const r = frame.cornerRadius ?? 0;
    body.push(`<rect width="${round(w)}" height="${round(h)}" rx="${round(r)}" ry="${round(r)}" fill="${bgFill}"/>`);
  }

  function walk(n: SceneNode, offsetX: number, offsetY: number) {
    for (const cid of n.childIds) {
      const child = resolveChild(cid);
      if (!child || child.visible === false) continue;
      const cx = offsetX + (child.x ?? 0);
      const cy = offsetY + (child.y ?? 0);
      const cw = child.width ?? 0;
      const ch = child.height ?? 0;

      // Container — recurse (no group wrapper; we flatten into root)
      if (child.type === 'FRAME' || child.type === 'GROUP') {
        // Render background if any
        const cbg = primarySolidFill(child.fills as Fill[] | undefined);
        if (cbg && cbg !== 'transparent') {
          const r = child.cornerRadius ?? 0;
          body.push(`<rect x="${round(cx)}" y="${round(cy)}" width="${round(cw)}" height="${round(ch)}" rx="${round(r)}" ry="${round(r)}" fill="${cbg}"/>`);
        }
        walk(child, cx, cy);
        continue;
      }

      // Leaf primitive — render with position offset
      const fillVar = tokenLookup?.(child.id, 'fills[0].color');
      const strokeVar = tokenLookup?.(child.id, 'strokes[0].color');
      const inner = renderNodePrimitive(child, { width: cw, height: ch, fillVar, strokeVar });
      // Wrap in <g transform="translate(...)"> to position inside root
      body.push(`<g transform="translate(${round(cx)},${round(cy)})">${inner}</g>`);
    }
  }

  walk(frame, 0, 0);

  const ariaLabel = frame.name ? ` aria-label="${escapeAttr(frame.name)}"` : '';
  return `<svg viewBox="0 0 ${round(w)} ${round(h)}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" role="img"${ariaLabel}>${body.join('')}</svg>`;
}
