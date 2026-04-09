/**
 * HTML Importer — HTML/CSS → reframe scene graph
 *
 * Designed for AI agent output: agents naturally produce HTML/CSS,
 * this converts it into INode trees for the full reframe pipeline.
 *
 * Supports:
 *   - Inline styles + <style> blocks (class/id/tag selectors)
 *   - Flexbox → auto-layout mapping
 *   - Absolute positioning → x, y
 *   - Colors: hex, rgb(), rgba(), hsl(), named
 *   - Gradients: linear-gradient()
 *   - Shadows: box-shadow → DROP_SHADOW
 *   - Typography: font-size, font-family, font-weight, line-height, letter-spacing, text-align
 *   - Border → strokes, border-radius → cornerRadius
 *   - Images: <img> tags, background-image
 *   - Semantic HTML: div, span, p, h1-h6, section, header, footer, nav, button, a, img
 */

import { SceneGraph } from '../engine/scene-graph';
import type { SceneNode, Color, Fill, Stroke, Effect, NodeType } from '../engine/types';
// Dynamic import — linkedom is ESM-only
let _parseHTML: ((html: string) => { document: any }) | null = null;
async function getParseHTML() {
  if (!_parseHTML) {
    const mod = await import('linkedom');
    _parseHTML = mod.parseHTML;
  }
  return _parseHTML;
}

// ─── Public API ────────────────────────────────────────────────

export interface HtmlImportOptions {
  /** Scene name (default: "HTML Import") */
  name?: string;
  /** Viewport width when not specified in HTML (default: 1920) */
  width?: number;
  /** Viewport height when not specified in HTML (default: 1080) */
  height?: number;
}

export interface HtmlImportResult {
  graph: SceneGraph;
  rootId: string;
  stats: {
    elements: number;
    textNodes: number;
    images: number;
    unsupported: string[];
  };
}

/**
 * Import HTML/CSS into a reframe SceneGraph.
 *
 * Typical agent workflow:
 *   const html = agentGeneratedHtml;
 *   const { graph, rootId } = await importFromHtml(html);
 *   // → adapt, audit, export
 */
export async function importFromHtml(
  html: string,
  options: HtmlImportOptions = {},
): Promise<HtmlImportResult> {
  let parsed = await parseWithLinkedom(html);
  let dom = parsed.dom;
  let { linkedomStyles, cssVars } = parsed;

  const graph = new SceneGraph();
  const page = graph.addPage(options.name ?? 'HTML Import');

  const stats = { elements: 0, textNodes: 0, images: 0, unsupported: [] as string[] };
  let ctx: ConvertContext = {
    graph, stats, cssVars, linkedomStyles,
    defaultWidth: options.width ?? 1920,
    defaultHeight: options.height ?? 1080,
  };

  // Find the outermost element (skip doctype, html/head/body wrappers)
  let rootElement = findRootElement(dom);
  if (!rootElement && html.trim()) {
    parsed = await parseWithLinkedom(
      `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div data-reframe-import-wrap="1">${html}</div></body></html>`,
    );
    dom = parsed.dom;
    linkedomStyles = parsed.linkedomStyles;
    cssVars = parsed.cssVars;
    ctx = { graph, stats, cssVars, linkedomStyles, defaultWidth: ctx.defaultWidth, defaultHeight: ctx.defaultHeight };
    rootElement = findRootElement(dom);
  }
  if (!rootElement) {
    throw new Error('No renderable HTML element found');
  }

  const rootId = convertElement(ctx, page.id, rootElement, null);

  return { graph, rootId, stats };
}

// ─── Types ────────────────────────────────────────────────────

interface HtmlElement {
  kind: 'element';
  tag: string;
  attrs: Record<string, string>;
  children: HtmlChild[];
}

interface HtmlText {
  kind: 'text';
  value: string;
}

type HtmlChild = HtmlElement | HtmlText;

// ─── Linkedom DOM → HtmlElement tree ─────────────────────────

/** Convert a linkedom DOM node to our HtmlElement/HtmlText format */
function domNodeToHtml(node: any, idx: { i: number }): HtmlChild | null {
  if (node.nodeType === 3 /* TEXT_NODE */) {
    const text = (node.textContent || '').trim();
    return text ? { kind: 'text', value: text } : null;
  }
  if (node.nodeType !== 1 /* ELEMENT_NODE */) return null;

  const tag = (node.tagName || '').toLowerCase();
  if (tag === 'script') return null;

  // Collect attributes
  const attrs: Record<string, string> = {};
  if (node.attributes) {
    for (let i = 0; i < node.attributes.length; i++) {
      const attr = node.attributes[i];
      attrs[attr.name.toLowerCase()] = attr.value;
    }
  }

  // Tag with index for style map cross-reference
  attrs['data-reframe-idx'] = String(idx.i++);

  // For <style> elements, capture raw CSS
  if (tag === 'style') {
    attrs._css = node.textContent || '';
    return { kind: 'element', tag, attrs, children: [] };
  }

  // Convert children recursively
  const children: HtmlChild[] = [];
  for (const child of node.childNodes) {
    const converted = domNodeToHtml(child, idx);
    if (converted) children.push(converted);
  }

  return { kind: 'element', tag, attrs, children };
}

/**
 * Single-parse entry point: linkedom handles HTML + CSS.
 * Returns our HtmlElement tree, linkedom style map, and CSS variables.
 */
async function parseWithLinkedom(html: string): Promise<{
  dom: HtmlElement;
  linkedomStyles: Map<string, Record<string, string>>;
  cssVars: Map<string, string>;
}> {
  const parseHTML = await getParseHTML();
  const { document } = parseHTML(html);

  // ── Build style map (CSS specificity + combinators) ──
  const linkedomStyles = new Map<string, Record<string, string>>();

  // Tag every element for cross-referencing
  const allEls = document.querySelectorAll('*');
  for (let i = 0; i < allEls.length; i++) {
    allEls[i].setAttribute('data-reframe-idx', String(i));
  }

  // Extract and apply CSS rules via querySelectorAll
  const styleEls = document.querySelectorAll('style');
  const cssRules: Array<{ selector: string; properties: Record<string, string>; specificity: number }> = [];

  for (const styleEl of Array.from(styleEls) as any[]) {
    const css = styleEl.textContent || '';
    const cleaned = css.replace(/@[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
    const re = /([^{]+)\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(cleaned)) !== null) {
      const selectors = m[1].split(',').map(s => s.trim()).filter(Boolean);
      const properties = parseInlineStyle(m[2]);
      for (const selector of selectors) {
        if (selector.includes(':') && !selector.includes('[')) continue;
        cssRules.push({ selector, properties, specificity: calcSpecificity(selector) });
      }
    }
  }

  cssRules.sort((a, b) => a.specificity - b.specificity);

  for (const rule of cssRules) {
    try {
      const matched = document.querySelectorAll(rule.selector);
      for (const el of Array.from(matched) as any[]) {
        const idx = el.getAttribute('data-reframe-idx');
        if (!idx) continue;
        const existing = linkedomStyles.get(idx) || {};
        Object.assign(existing, rule.properties);
        linkedomStyles.set(idx, existing);
      }
    } catch { /* invalid selector — skip */ }
  }

  // Inline styles (highest specificity)
  for (const el of Array.from(allEls) as any[]) {
    const inlineStyle = el.getAttribute('style');
    if (inlineStyle) {
      const idx = el.getAttribute('data-reframe-idx')!;
      const existing = linkedomStyles.get(idx) || {};
      Object.assign(existing, parseInlineStyle(inlineStyle));
      linkedomStyles.set(idx, existing);
    }
  }

  // ── Extract CSS variables from :root / html ──
  const cssVars = new Map<string, string>();
  for (const rule of cssRules) {
    if (rule.selector === ':root' || rule.selector === 'html') {
      for (const [k, v] of Object.entries(rule.properties)) {
        if (k.startsWith('--')) cssVars.set(k, v);
      }
    }
  }

  // ── Convert linkedom DOM → HtmlElement tree ──
  // linkedom's documentElement may be <html> or just the first element for fragments.
  // For fragments like `<style>...</style><div>...</div>`, documentElement is only
  // the first element — siblings are lost. Walk all document.childNodes instead.
  const idx = { i: 0 };
  const children: HtmlChild[] = [];
  for (const child of document.childNodes) {
    const converted = domNodeToHtml(child, idx);
    if (converted) children.push(converted);
  }
  const dom: HtmlElement = {
    kind: 'element', tag: '__root__', attrs: {},
    children,
  };

  return { dom, linkedomStyles, cssVars };
}

/** CSS specificity score: id=100, class/attr=10, tag=1 */
function calcSpecificity(selector: string): number {
  let score = 0;
  score += (selector.match(/#[\w-]+/g) || []).length * 100;
  score += (selector.match(/\.[\w-]+|\[[\w-]|:[\w-]/g) || []).length * 10;
  score += (selector.match(/(?:^|[\s>+~])[\w][\w-]*/g) || []).length;
  return score;
}

// ─── CSS Value Parsing ────────────────────────────────────────

function parseInlineStyle(style: string): Record<string, string> {
  const props: Record<string, string> = {};
  if (!style) return props;

  // Handle parentheses (e.g., rgb(), linear-gradient()) by tracking nesting
  let current = '';
  let key = '';
  let depth = 0;

  for (let i = 0; i < style.length; i++) {
    const ch = style[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;

    if (ch === ':' && depth === 0 && !key) {
      key = current.trim();
      current = '';
    } else if (ch === ';' && depth === 0) {
      if (key) {
        props[key] = current.trim();
        key = '';
      }
      current = '';
    } else {
      current += ch;
    }
  }
  if (key && current.trim()) {
    props[key] = current.trim();
  }
  return props;
}

/** Resolve var(--name, fallback) references using extracted variables. */
function resolveVar(value: string, vars: Map<string, string>): string {
  return value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g, (_, name, fallback) => {
    return vars.get(name) ?? fallback?.trim() ?? '';
  });
}

function resolveStyles(
  el: HtmlElement,
  cssVars: Map<string, string>,
  linkedomStyles?: Map<string, Record<string, string>>,
): Record<string, string> {
  const merged: Record<string, string> = {};

  // Linkedom-resolved styles (handles specificity + combinators + inline)
  const idx = el.attrs['data-reframe-idx'];
  if (idx && linkedomStyles) {
    const resolved = linkedomStyles.get(idx);
    if (resolved) Object.assign(merged, resolved);
  }

  // Resolve CSS variables
  if (cssVars.size > 0) {
    for (const [k, v] of Object.entries(merged)) {
      if (v.includes('var(')) merged[k] = resolveVar(v, cssVars);
    }
  }
  // Expand `font` shorthand → individual properties
  if (merged.font && !merged['font-size']) {
    expandFontShorthand(merged);
  }
  // Expand `inset` shorthand → top/right/bottom/left
  if (merged.inset) {
    const parts = merged.inset.split(/\s+/);
    merged.top = parts[0];
    merged.right = parts[1] ?? parts[0];
    merged.bottom = parts[2] ?? parts[0];
    merged.left = parts[3] ?? parts[1] ?? parts[0];
  }
  return merged;
}

/** Parse CSS `font` shorthand: [style] [weight] size[/line-height] family */
function expandFontShorthand(styles: Record<string, string>) {
  const val = styles.font;
  if (!val) return;
  // font: italic bold 16px/1.5 "Inter", sans-serif
  const m = val.match(
    /(?:(italic|oblique)\s+)?(?:(bold|bolder|lighter|\d{1,3}00?)\s+)?([\d.]+(?:px|em|rem|%))(?:\/([\d.]+(?:px|em|rem|%)?))?\s+(.*)/i
  );
  if (!m) return;
  if (m[1]) styles['font-style'] = m[1];
  if (m[2]) styles['font-weight'] = m[2];
  if (m[3]) styles['font-size'] = m[3];
  if (m[4]) styles['line-height'] = m[4];
  if (m[5]) styles['font-family'] = m[5];
}

// ─── Color Parsing ─────────────────────────────────────────────

const NAMED_COLORS: Record<string, string> = {
  white: '#FFFFFF', black: '#000000', red: '#FF0000', green: '#008000',
  blue: '#0000FF', yellow: '#FFFF00', orange: '#FFA500', purple: '#800080',
  pink: '#FFC0CB', gray: '#808080', grey: '#808080', transparent: '#00000000',
  cyan: '#00FFFF', magenta: '#FF00FF', lime: '#00FF00', navy: '#000080',
  teal: '#008080', maroon: '#800000', olive: '#808000', silver: '#C0C0C0',
  aqua: '#00FFFF', fuchsia: '#FF00FF', coral: '#FF7F50', tomato: '#FF6347',
  salmon: '#FA8072', gold: '#FFD700', khaki: '#F0E68C', indigo: '#4B0082',
  violet: '#EE82EE', plum: '#DDA0DD', orchid: '#DA70D6', tan: '#D2B48C',
  beige: '#F5F5DC', ivory: '#FFFFF0', linen: '#FAF0E6', snow: '#FFFAFA',
  crimson: '#DC143C', darkblue: '#00008B', darkgreen: '#006400',
  darkred: '#8B0000', darkgray: '#A9A9A9', lightgray: '#D3D3D3',
  lightblue: '#ADD8E6', lightgreen: '#90EE90', lightyellow: '#FFFFE0',
  whitesmoke: '#F5F5F5', aliceblue: '#F0F8FF', ghostwhite: '#F8F8FF',
  mintcream: '#F5FFFA', lavender: '#E6E6FA', cornsilk: '#FFF8DC',
  seashell: '#FFF5EE', honeydew: '#F0FFF0', azure: '#F0FFFF',
  slategray: '#708090', steelblue: '#4682B4', dodgerblue: '#1E90FF',
  deepskyblue: '#00BFFF', royalblue: '#4169E1', midnightblue: '#191970',
  cornflowerblue: '#6495ED', cadetblue: '#5F9EA0',
};

function parseColor(value: string): Color | null {
  if (!value) return null;
  value = value.trim().toLowerCase();

  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  // Named color
  if (NAMED_COLORS[value]) {
    return parseHexColor(NAMED_COLORS[value]);
  }

  // Hex
  if (value.startsWith('#')) {
    return parseHexColor(value);
  }

  // rgb(r, g, b) / rgba(r, g, b, a)
  const rgbMatch = value.match(/rgba?\(\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?))?\s*\)/);
  if (rgbMatch) {
    const r = parseColorComponent(rgbMatch[1], 255);
    const g = parseColorComponent(rgbMatch[2], 255);
    const b = parseColorComponent(rgbMatch[3], 255);
    const a = rgbMatch[4] ? parseColorComponent(rgbMatch[4], 1) : 1;
    return { r, g, b, a };
  }

  // hsl(h, s%, l%) / hsla(h, s%, l%, a)
  const hslMatch = value.match(/hsla?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)%\s*[,\s]\s*([\d.]+)%\s*(?:[,/]\s*([\d.]+%?))?\s*\)/);
  if (hslMatch) {
    const h = parseFloat(hslMatch[1]) / 360;
    const s = parseFloat(hslMatch[2]) / 100;
    const l = parseFloat(hslMatch[3]) / 100;
    const a = hslMatch[4] ? parseColorComponent(hslMatch[4], 1) : 1;
    const { r, g, b } = hslToRgb(h, s, l);
    return { r, g, b, a };
  }

  return NAMED_COLORS[value] ? parseHexColor(NAMED_COLORS[value]) : null;
}

function parseHexColor(hex: string): Color {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  if (hex.length === 4) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

function parseColorComponent(val: string, max: number): number {
  if (val.endsWith('%')) return parseFloat(val) / 100;
  return parseFloat(val) / max;
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s === 0) return { r: l, g: l, b: l };
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return { r: hue2rgb(p, q, h + 1 / 3), g: hue2rgb(p, q, h), b: hue2rgb(p, q, h - 1 / 3) };
}

// ─── CSS Value Parsing ─────────────────────────────────────────

function parseUnit(value: string): number {
  if (!value) return 0;
  const n = parseFloat(value);
  return isNaN(n) ? 0 : n;
}

/** Resolve a CSS length value, handling % relative to a reference dimension. */
function resolveLength(value: string, ref?: number): number {
  if (!value) return 0;
  value = value.trim();
  if (value.endsWith('%')) {
    if (ref == null || ref <= 0) return 0; // no reference = can't resolve %
    return (parseFloat(value) / 100) * ref;
  }
  return parseUnit(value);
}

function parseFourValues(value: string): [number, number, number, number] {
  const parts = value.split(/\s+/).map(parseUnit);
  if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]];
  if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]];
  if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]];
  return [parts[0], parts[1], parts[2], parts[3]];
}

/** Convert CSS direction keywords (e.g. "to right", "to bottom left") to degrees. */
function cssDirectionToDeg(dir: string): number {
  const d = dir.replace('to ', '').trim();
  const map: Record<string, number> = {
    'top': 0, 'right': 90, 'bottom': 180, 'left': 270,
    'top right': 45, 'right top': 45,
    'bottom right': 135, 'right bottom': 135,
    'bottom left': 225, 'left bottom': 225,
    'top left': 315, 'left top': 315,
  };
  return map[d] ?? 180;
}

/** Convert CSS gradient angle (deg) to a 2×3 gradient transform matrix.
 *  CSS: 0deg=to top, 90deg=to right. Matrix maps unit square [0,1]×[0,1]
 *  start→end direction. */
function angleToGradientTransform(cssDeg: number): { m00: number; m01: number; m02: number; m10: number; m11: number; m12: number } {
  // CSS angles: 0deg = to top (↑), clockwise. Convert to math radians.
  const rad = (cssDeg - 90) * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Gradient line direction in unit-square coordinates:
  // center (0.5, 0.5), direction rotated by angle
  return {
    m00: cos, m01: sin, m02: 0.5 - 0.5 * cos - 0.5 * sin,
    m10: -sin, m11: cos, m12: 0.5 + 0.5 * sin - 0.5 * cos,
  };
}

/** Convert gradientTransform matrix back to CSS angle in degrees. */
function gradientTransformToAngle(t: { m00: number; m01: number; m02: number; m10: number; m11: number; m12: number }): number {
  // Reverse of angleToGradientTransform: extract angle from rotation part
  const rad = Math.atan2(t.m01, t.m00);
  return ((rad * 180 / Math.PI) + 90 + 360) % 360;
}

function parseGradient(value: string): Fill | null {
  // Extract gradient content handling nested parentheses
  const extractGradientArgs = (val: string, prefix: string): string | null => {
    const idx = val.indexOf(prefix + '(');
    if (idx === -1) return null;
    let start = idx + prefix.length + 1;
    let depth = 1;
    let i = start;
    while (i < val.length && depth > 0) {
      if (val[i] === '(') depth++;
      else if (val[i] === ')') depth--;
      if (depth > 0) i++;
    }
    return val.slice(start, i);
  };

  const linearArgs = extractGradientArgs(value, 'linear-gradient');
  const radialArgs = extractGradientArgs(value, 'radial-gradient');
  const args = linearArgs ?? radialArgs;
  if (!args) return null;

  const isRadial = !linearArgs && !!radialArgs;

  // Split by commas but not inside parentheses
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of args) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());

  // First part might be angle/direction (linear) or shape/size (radial)
  let startIdx = 0;
  let angleDeg = 180; // CSS default: top-to-bottom
  const first = parts[0]?.toLowerCase() ?? '';
  if (isRadial) {
    // Skip shape keywords: circle, ellipse, closest-side, farthest-corner, etc.
    if (/^(circle|ellipse|closest|farthest|at\s)/.test(first) || first.includes('at ')) {
      startIdx = 1;
    }
  } else {
    if (first.includes('deg')) {
      angleDeg = parseFloat(first);
      startIdx = 1;
    } else if (first.includes('rad')) {
      angleDeg = parseFloat(first) * (180 / Math.PI);
      startIdx = 1;
    } else if (first.includes('turn')) {
      angleDeg = parseFloat(first) * 360;
      startIdx = 1;
    } else if (first.startsWith('to ')) {
      angleDeg = cssDirectionToDeg(first);
      startIdx = 1;
    }
  }

  const stops: { color: Color; position: number }[] = [];
  const colorParts = parts.slice(startIdx);
  for (let i = 0; i < colorParts.length; i++) {
    const part = colorParts[i].trim();
    // Try to extract position percentage
    const posMatch = part.match(/\s+([\d.]+)%\s*$/);
    const colorStr = posMatch ? part.slice(0, -posMatch[0].length).trim() : part;
    const position = posMatch ? parseFloat(posMatch[1]) / 100 : i / Math.max(colorParts.length - 1, 1);
    const color = parseColor(colorStr);
    if (color) stops.push({ color, position });
  }

  if (stops.length < 2) return null;

  // Convert CSS angle to gradientTransform matrix
  // CSS gradient angles: 0deg=to top, 90deg=to right, 180deg=to bottom (default)
  const gradientTransform = angleDeg !== 180
    ? angleToGradientTransform(angleDeg)
    : undefined;

  return {
    type: isRadial ? 'GRADIENT_RADIAL' : 'GRADIENT_LINEAR',
    color: stops[0].color,
    opacity: 1,
    visible: true,
    gradientStops: stops,
    gradientTransform,
  };
}

function parseShadow(value: string): Effect | null {
  // box-shadow: offsetX offsetY blur spread? color
  // box-shadow: 0 4px 12px rgba(0,0,0,0.15)
  if (!value || value === 'none') return null;

  // Extract color (might contain parentheses)
  let color: Color | null = null;
  let rest = value;

  // Try rgba/rgb/hsl at the end
  const colorFnMatch = value.match(/(rgba?\([^)]+\)|hsla?\([^)]+\))\s*$/);
  if (colorFnMatch) {
    color = parseColor(colorFnMatch[1]);
    rest = value.slice(0, -colorFnMatch[0].length).trim();
  } else {
    // Try hex or named color at the end
    const parts = value.split(/\s+/);
    const lastPart = parts[parts.length - 1];
    color = parseColor(lastPart);
    if (color) {
      rest = parts.slice(0, -1).join(' ');
    }
  }

  // Also try color at the beginning
  if (!color) {
    const colorFnStart = value.match(/^(rgba?\([^)]+\)|hsla?\([^)]+\))\s+/);
    if (colorFnStart) {
      color = parseColor(colorFnStart[1]);
      rest = value.slice(colorFnStart[0].length).trim();
    }
  }

  const nums = rest.split(/\s+/).map(parseUnit);
  const ox = nums[0] ?? 0;
  const oy = nums[1] ?? 0;
  const blur = nums[2] ?? 0;
  const spread = nums[3] ?? 0;

  return {
    type: 'DROP_SHADOW',
    color: color ?? { r: 0, g: 0, b: 0, a: 0.25 },
    offset: { x: ox, y: oy },
    radius: blur,
    spread,
    visible: true,
  };
}

// ─── DOM → SceneGraph Conversion ───────────────────────────────

interface ConvertContext {
  graph: SceneGraph;
  stats: HtmlImportResult['stats'];
  cssVars: Map<string, string>;
  linkedomStyles: Map<string, Record<string, string>>;
  defaultWidth: number;
  defaultHeight: number;
}

const CONTAINER_TAGS = new Set([
  'div', 'section', 'header', 'footer', 'nav', 'main', 'article', 'aside',
  'form', 'fieldset', 'details', 'summary', 'figure', 'figcaption',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'tr', 'td', 'th',
]);

const TEXT_TAGS = new Set([
  'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'label', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'mark',
  'code', 'pre', 'blockquote', 'cite', 'q', 'abbr', 'time',
]);

const TAG_FONT_DEFAULTS: Record<string, { fontSize: number; fontWeight: number }> = {
  h1: { fontSize: 48, fontWeight: 700 },
  h2: { fontSize: 36, fontWeight: 700 },
  h3: { fontSize: 28, fontWeight: 700 },
  h4: { fontSize: 24, fontWeight: 700 },
  h5: { fontSize: 20, fontWeight: 700 },
  h6: { fontSize: 16, fontWeight: 700 },
  small: { fontSize: 12, fontWeight: 400 },
};

function findRootElement(dom: HtmlElement): HtmlElement | null {
  // Skip wrapper nodes to find the first real visual element
  function findDeep(node: HtmlElement): HtmlElement | null {
    const skip = new Set(['__root__', 'html', 'head', 'body', 'style', 'script', 'meta', 'link', 'title']);
    if (!skip.has(node.tag)) return node;
    for (const child of node.children) {
      if (child.kind === 'element') {
        const found = findDeep(child);
        if (found) return found;
      }
    }
    return null;
  }
  return findDeep(dom);
}

function getTextContent(el: HtmlElement): string {
  const parts: string[] = [];
  for (const child of el.children) {
    if (child.kind === 'text') parts.push(child.value);
    else if (child.kind === 'element') {
      if (child.tag === 'br') {
        parts.push('\n');
      } else {
        parts.push(getTextContent(child));
      }
    }
  }
  return parts.join('').replace(/[ \t]+/g, ' ').replace(/^ | $/gm, '').trim();
}

/** Check if element has <br> children (inline line break, not block element) */
function hasBrChildren(el: HtmlElement): boolean {
  return el.children.some(c => c.kind === 'element' && c.tag === 'br');
}

function hasElementChildren(el: HtmlElement): boolean {
  return el.children.some(c => c.kind === 'element' && c.tag !== 'style' && c.tag !== 'script' && c.tag !== 'br');
}

function convertElement(
  ctx: ConvertContext,
  parentId: string,
  el: HtmlElement,
  parentStyles: Record<string, string> | null,
): string {
  const styles = resolveStyles(el, ctx.cssVars, ctx.linkedomStyles);
  ctx.stats.elements++;

  // Determine node type
  let nodeType: NodeType;
  let isTextNode = false;

  if (el.tag === 'img') {
    nodeType = 'RECTANGLE';
    ctx.stats.images++;
  } else if (el.tag === 'svg') {
    nodeType = 'VECTOR';
  } else if (TEXT_TAGS.has(el.tag) && !hasElementChildren(el)) {
    // Leaf text element → TEXT node
    nodeType = 'TEXT';
    isTextNode = true;
  } else if (!hasElementChildren(el) && el.children.some(c => c.kind === 'text')) {
    // Container with only text children → TEXT node
    nodeType = 'TEXT';
    isTextNode = true;
  } else {
    nodeType = 'FRAME';
  }

  // Build node overrides from CSS
  const overrides = cssToOverrides(styles, el, nodeType, ctx, parentStyles);

  // clip-path: circle/ellipse → change node type to ELLIPSE
  if ((overrides as any)._clipShape === 'ellipse' && nodeType !== 'TEXT') {
    nodeType = 'ELLIPSE';
    delete (overrides as any)._clipShape;
  }

  // Handle text content
  if (isTextNode) {
    const textContent = getTextContent(el);
    ctx.stats.textNodes++;

    // If this text node has visual container styling (background, border, padding),
    // create a FRAME wrapper with a TEXT child instead of a flat TEXT node.
    const hasBackground = styles.background || styles['background-color'];
    const hasBorder = styles.border && styles.border !== 'none' && styles.border !== '0';
    const hasPadding = styles.padding || styles['padding-top'] || styles['padding-left'];
    const needsWrapper = hasBackground || hasBorder || hasPadding;

    if (needsWrapper) {
      // Convert to FRAME with auto-layout containing a TEXT child
      nodeType = 'FRAME';
      isTextNode = false;
      // The overrides.fills were set by cssToOverrides which processes
      // background first, then replaces with text color for TEXT nodes.
      // Re-compute fills from background only (text color goes on child).
      if (hasBackground) {
        const bg = styles.background || styles['background-color']!;
        const grad = parseGradient(bg);
        if (grad) {
          overrides.fills = [grad];
        } else {
          const c = parseColor(bg);
          overrides.fills = c ? [makeSolidFill(c)] : [];
        }
      } else {
        delete overrides.fills;
      }
      // Remove text-specific properties from the frame wrapper
      delete overrides.fontSize;
      delete overrides.fontFamily;
      delete overrides.fontWeight;
      delete overrides.italic;
      delete overrides.letterSpacing;
      delete overrides.lineHeight;
      delete overrides.textAlignHorizontal;
      delete overrides.textAlignVertical;
      delete overrides.textDecoration;
      delete overrides.textCase;
      delete overrides.text;
    } else {
      overrides.text = textContent;

      // Estimate text node size when no explicit width/height (flex children)
      if (!overrides.width || !overrides.height) {
        const fontSize = overrides.fontSize ?? 16;
        const fontWeight = overrides.fontWeight ?? 400;
        const avgCharWidth = fontSize * (0.48 + (fontWeight >= 600 ? 0.04 : 0));
        const textLines = textContent.split('\n');
        const longestLine = Math.max(...textLines.map(l => l.length));
        if (!overrides.width) {
          overrides.width = Math.max(20, Math.ceil(longestLine * avgCharWidth));
        }
        if (!overrides.height) {
          const lineHeight = overrides.lineHeight ?? fontSize * 1.4;
          overrides.height = Math.max(fontSize, Math.ceil(textLines.length * lineHeight));
        }
      }
    }
  }

  // Set name: prefer data-name, then id, then class, then tag
  if (!overrides.name) {
    overrides.name = el.attrs['data-name']
      || el.attrs.id
      || (el.attrs.class ? el.attrs.class.split(/\s+/)[0] : '')
      || el.tag;
  }

  // For wrapper frames (text node promoted to frame), set up flex centering
  const hasBackground = styles.background || styles['background-color'];
  const hasBorder = styles.border && styles.border !== 'none' && styles.border !== '0';
  const hasPadding = styles.padding || styles['padding-top'] || styles['padding-left'];
  const wasPromotedToFrame = nodeType === 'FRAME' && (hasBackground || hasBorder || hasPadding) && !hasElementChildren(el) && el.children.some(c => c.kind === 'text');

  if (wasPromotedToFrame && !overrides.layoutMode) {
    // Set up flex layout so text child is centered
    overrides.layoutMode = 'HORIZONTAL';
    overrides.primaryAxisAlign = 'CENTER';
    overrides.counterAxisAlign = 'CENTER';
  }

  // Extract deferred positioning metadata before creating node
  const ov = overrides as any;
  const deferredRight = ov._rightOffset as number | undefined;
  const deferredBottom = ov._bottomOffset as number | undefined;
  const deferredParentW = ov._parentW as number | undefined;
  const deferredParentH = ov._parentH as number | undefined;
  delete ov._rightOffset;
  delete ov._bottomOffset;
  delete ov._parentW;
  delete ov._parentH;

  const node = ctx.graph.createNode(nodeType, parentId, overrides);

  // For promoted frames, create the TEXT child with inherited text styles
  if (wasPromotedToFrame) {
    const textContent = getTextContent(el);
    const textOverrides: any = { text: textContent, name: overrides.name ? overrides.name + '-text' : 'text' };
    applyTextStyles(textOverrides, styles, el.tag);
    if (styles.color) {
      const c = parseColor(styles.color);
      if (c) textOverrides.fills = [makeSolidFill(c)];
    }
    // Estimate text size
    const fontSize = textOverrides.fontSize ?? 16;
    const tLines = textContent.split('\n');
    const tLongest = Math.max(...tLines.map(l => l.length));
    const tw = textOverrides.fontWeight ?? 400;
    textOverrides.width = Math.max(20, Math.ceil(tLongest * fontSize * (0.48 + (tw >= 600 ? 0.04 : 0))));
    textOverrides.height = Math.max(fontSize, Math.ceil(tLines.length * (textOverrides.lineHeight ?? fontSize * 1.4)));
    ctx.stats.textNodes++;
    ctx.graph.createNode('TEXT', node.id, textOverrides);
  }

  // Convert children (only for non-text nodes and non-promoted frames)
  // Sort element children by z-index to preserve stacking order
  if (!isTextNode && !wasPromotedToFrame) {
    const sortedChildren = [...el.children];
    sortedChildren.sort((a, b) => {
      if (a.kind !== 'element' || b.kind !== 'element') return 0;
      const styA = resolveStyles(a, ctx.cssVars, ctx.linkedomStyles);
      const styB = resolveStyles(b, ctx.cssVars, ctx.linkedomStyles);
      const zA = parseInt(styA['z-index'] ?? '0') || 0;
      const zB = parseInt(styB['z-index'] ?? '0') || 0;
      return zA - zB;
    });
    for (const child of sortedChildren) {
      if (child.kind === 'element') {
        if (child.tag === 'style' || child.tag === 'script' || child.tag === 'br' || child.tag === 'hr' || child.tag === 'wbr') continue;
        convertElement(ctx, node.id, child, styles);
      } else if (child.kind === 'text' && child.value.trim()) {
        // Inline text in a container → create TEXT child node
        const textStyles = { ...styles }; // inherit parent styles
        ctx.stats.textNodes++;
        ctx.stats.elements++;
        const textOverrides: any = {
          text: child.value.trim(),
          name: 'text',
        };
        applyTextStyles(textOverrides, textStyles, el.tag);
        // Inherit color from parent
        if (styles.color) {
          const c = parseColor(styles.color);
          if (c) textOverrides.fills = [makeSolidFill(c)];
        }
        ctx.graph.createNode('TEXT', node.id, textOverrides);
      }
    }
  }

  // Post-process: handle containers without explicit dimensions
  const createdNode = ctx.graph.getNode(node.id);
  if (createdNode && createdNode.childIds.length > 0) {
    const noExplicitWidth = !styles.width && createdNode.width === 100;
    const noExplicitHeight = !styles.height && createdNode.height === 100;
    const hasLayout = createdNode.layoutMode && createdNode.layoutMode !== 'NONE';
    const isFlex = styles.flex || styles['flex-grow'];
    const updates: any = {};

    // Get parent layout mode for context-aware sizing
    const parentNode = createdNode.parentId ? ctx.graph.getNode(createdNode.parentId) : null;
    const parentIsRow = parentNode?.layoutMode === 'HORIZONTAL';

    if (noExplicitWidth) {
      if (isFlex || (hasLayout && !styles.width)) {
        // Flex child or layout container without explicit width → let CSS handle it
        updates.primaryAxisSizing = hasLayout ? 'HUG' : 'FILL';
        // Counter axis sizing depends on layout direction AND parent:
        // VERTICAL child in VERTICAL parent: counter=width → FILL (CSS block fills parent width)
        // VERTICAL child in HORIZONTAL parent: counter=width → HUG (flex row controls width)
        // HORIZONTAL child: counter=height → HUG (CSS doesn't stretch height by default)
        if (createdNode.layoutMode === 'VERTICAL' && !parentIsRow) {
          updates.counterAxisSizing = 'FILL';
        } else {
          updates.counterAxisSizing = 'HUG';
        }
        // Set a reasonable default instead of 100
        updates.width = ctx.defaultWidth ?? 1440;
      } else {
        // Estimate from children
        let maxW = 0, sumW = 0;
        for (const cid of createdNode.childIds) {
          const child = ctx.graph.getNode(cid);
          if (!child) continue;
          maxW = Math.max(maxW, child.width);
          sumW += child.width;
        }
        const padH = (createdNode.paddingLeft ?? 0) + (createdNode.paddingRight ?? 0);
        const gap = createdNode.itemSpacing ?? 0;
        const gapTotal = gap * Math.max(createdNode.childIds.length - 1, 0);
        if (createdNode.layoutMode === 'HORIZONTAL') {
          updates.width = sumW + padH + gapTotal;
        } else {
          updates.width = maxW + padH;
        }
      }
    }

    if (noExplicitHeight) {
      if (hasLayout) {
        // Layout container without height → HUG content on the height axis
        if (createdNode.layoutMode === 'VERTICAL') {
          // VERTICAL: primary axis = height → HUG
          updates.primaryAxisSizing = updates.primaryAxisSizing ?? 'HUG';
        } else {
          // HORIZONTAL: counter axis = height → HUG
          updates.counterAxisSizing = updates.counterAxisSizing ?? 'HUG';
        }
        // Estimate from children
        let maxH = 0, sumH = 0;
        for (const cid of createdNode.childIds) {
          const child = ctx.graph.getNode(cid);
          if (!child) continue;
          maxH = Math.max(maxH, child.height);
          sumH += child.height;
        }
        const padV = (createdNode.paddingTop ?? 0) + (createdNode.paddingBottom ?? 0);
        const gap = createdNode.itemSpacing ?? 0;
        const gapTotal = gap * Math.max(createdNode.childIds.length - 1, 0);
        if (createdNode.layoutMode === 'VERTICAL') {
          updates.height = sumH + padV + gapTotal;
        } else {
          updates.height = maxH + padV;
        }
      } else {
        updates.height = 40; // minimal default
      }
    }

    if (Object.keys(updates).length > 0) {
      ctx.graph.updateNode(node.id, updates);
    }

    // Convert child margins to itemSpacing (scan child element CSS for margins)
    if (createdNode.layoutMode && createdNode.layoutMode !== 'NONE' && !createdNode.itemSpacing) {
      let maxMargin = 0;
      for (const child of el.children) {
        if (child.kind !== 'element' || child.tag === 'style' || child.tag === 'script') continue;
        const childStyles = resolveStyles(child, ctx.cssVars, ctx.linkedomStyles);
        const mb = parseUnit(childStyles['margin-bottom'] ?? '0');
        const mt = parseUnit(childStyles['margin-top'] ?? '0');
        maxMargin = Math.max(maxMargin, mb, mt);
      }
      if (maxMargin > 0) {
        ctx.graph.updateNode(node.id, { itemSpacing: maxMargin });
      }
    }
  }

  // Resolve deferred right/bottom positioning now that sizes are computed
  if (deferredRight !== undefined && deferredParentW !== undefined) {
    const finalNode = ctx.graph.getNode(node.id);
    if (finalNode) {
      ctx.graph.updateNode(node.id, { x: deferredParentW - finalNode.width - deferredRight });
    }
  }
  if (deferredBottom !== undefined && deferredParentH !== undefined) {
    const finalNode = ctx.graph.getNode(node.id);
    if (finalNode) {
      ctx.graph.updateNode(node.id, { y: deferredParentH - finalNode.height - deferredBottom });
    }
  }

  return node.id;
}

function cssToOverrides(
  styles: Record<string, string>,
  el: HtmlElement,
  nodeType: NodeType,
  ctx: ConvertContext,
  parentStyles: Record<string, string> | null,
): Partial<SceneNode> & { name?: string } {
  const o: any = {};

  // ── Resolve parent dimensions for % values ──
  // Width cascades from root (pages have fixed width). Height does NOT cascade —
  // scrolling pages have content taller than viewport. Only use explicit parent height.
  const parentW = parentStyles?.width ? parseUnit(parentStyles.width) : ctx.defaultWidth;
  const parentH = parentStyles?.height ? parseUnit(parentStyles.height) : undefined;

  // ── Dimensions (with % resolution) ──
  if (styles.width) o.width = resolveLength(styles.width, parentW);
  if (styles.height) o.height = resolveLength(styles.height, parentH);
  if (styles['min-width']) o.minWidth = resolveLength(styles['min-width'], parentW);
  if (styles['min-height']) o.minHeight = resolveLength(styles['min-height'], parentH);
  if (styles['max-width']) o.maxWidth = resolveLength(styles['max-width'], parentW);
  if (styles['max-height']) o.maxHeight = resolveLength(styles['max-height'], parentH);

  // Default root dimensions
  if (!parentStyles && !o.width) o.width = ctx.defaultWidth;
  if (!parentStyles && !o.height) o.height = ctx.defaultHeight;

  // Flex child sizing: stretch to parent in cross-axis direction
  // Only stretch when parent uses default align-items (stretch) or explicit stretch
  if (parentStyles && nodeType !== 'TEXT') {
    const parentDisplay = parentStyles.display ?? '';
    const parentDir = parentStyles['flex-direction'] ?? 'row';
    const parentAlignItems = parentStyles['align-items'] ?? '';
    // Default align-items is 'stretch' (when not set). Only stretch for stretch/default.
    const shouldStretch = !parentAlignItems || parentAlignItems === 'stretch' || parentAlignItems === 'normal';
    // Individual align-self overrides parent
    const alignSelf = styles['align-self'] ?? '';
    const selfPreventsStretch = alignSelf && alignSelf !== 'stretch' && alignSelf !== 'auto';

    if (parentDisplay.includes('flex') && shouldStretch && !selfPreventsStretch) {
      const pPad = parseFourValues(parentStyles.padding ?? '0');
      const pPadT = parseUnit(parentStyles['padding-top'] ?? '') || pPad[0];
      const pPadR = parseUnit(parentStyles['padding-right'] ?? '') || pPad[1];
      const pPadB = parseUnit(parentStyles['padding-bottom'] ?? '') || pPad[2];
      const pPadL = parseUnit(parentStyles['padding-left'] ?? '') || pPad[3];

      if ((parentDir === 'column' || parentDir === 'column-reverse') && !styles.width) {
        // Column layout: child without width → stretch to parent width
        o.width = Math.max(40, parentW - pPadL - pPadR);
      }
      if ((parentDir === 'row' || parentDir === 'row-reverse') && !styles.height && parentH != null && parentH > 0) {
        // Row layout: child without height → stretch to parent height (only if parent has explicit height)
        o.height = Math.max(40, parentH - pPadT - pPadB);
      }
    }
  }

  // ── Box sizing ── (adjust for border-box: width/height include padding+border)
  // We just track it; Figma-style nodes are inherently content-box,
  // but we don't need to adjust since our layout engine handles it.

  // ── Position ──
  const position = styles.position ?? '';
  if (position === 'absolute' || position === 'fixed') {
    o.layoutPositioning = 'ABSOLUTE';
    if (styles.left) o.x = resolveLength(styles.left, parentW);
    if (styles.top) o.y = resolveLength(styles.top, parentH);
    // right/bottom need parent dimensions (width/height may be resolved later in post-process)
    if (styles.right && !styles.left) {
      if (o.width) {
        o.x = parentW - o.width - resolveLength(styles.right, parentW);
      } else {
        // Store for deferred resolution after size is computed
        o._rightOffset = resolveLength(styles.right, parentW);
        o._parentW = parentW;
      }
    }
    if (styles.bottom && !styles.top && parentH != null) {
      if (o.height) {
        o.y = parentH - o.height - resolveLength(styles.bottom, parentH);
      } else {
        o._bottomOffset = resolveLength(styles.bottom, parentH);
        o._parentH = parentH;
      }
    }
    // inset: 0 = stretch to fill parent
    if (styles.left && styles.right && !styles.width) {
      o.x = resolveLength(styles.left, parentW);
      o.width = parentW - o.x - resolveLength(styles.right, parentW);
    }
    if (styles.top && styles.bottom && !styles.height && parentH != null) {
      o.y = resolveLength(styles.top, parentH);
      o.height = parentH - o.y - resolveLength(styles.bottom, parentH);
    }
  }

  // ── Fills ──
  const fills: Fill[] = [];
  const bg = styles.background || styles['background-color'];
  if (bg) {
    // Try gradient first
    const grad = parseGradient(bg);
    if (grad) {
      fills.push(grad);
    } else {
      const color = parseColor(bg);
      if (color) fills.push(makeSolidFill(color));
    }
  }

  // Image fills (<img> tag)
  if (el.tag === 'img' && el.attrs.src) {
    const scaleMode = mapObjectFit(styles['object-fit'] ?? 'fill');
    fills.push({
      type: 'IMAGE',
      color: { r: 0, g: 0, b: 0, a: 1 },
      opacity: 1,
      visible: true,
      imageHash: el.attrs.src,
      imageScaleMode: scaleMode,
    });
  }

  // background-image: url(...) or gradient
  if (styles['background-image']) {
    const bgi = styles['background-image'];
    const urlMatch = bgi.match(/url\(['"]?([^'")\s]+)['"]?\)/);
    if (urlMatch) {
      fills.push({
        type: 'IMAGE',
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true,
        imageHash: urlMatch[1],
        imageScaleMode: mapObjectFit(styles['background-size'] ?? styles['object-fit'] ?? 'cover'),
      });
    } else {
      const grad = parseGradient(bgi);
      if (grad) fills.push(grad);
    }
  }

  if (fills.length > 0) o.fills = fills;

  // Text color
  if (nodeType === 'TEXT') {
    const textColor = styles.color || parentStyles?.color;
    if (textColor) {
      const c = parseColor(textColor);
      if (c) o.fills = [makeSolidFill(c)];
    }
  }

  // ── Strokes (border) ──
  const border = styles.border;
  if (border && border !== 'none' && border !== '0') {
    const borderParts = border.split(/\s+/);
    const weight = parseUnit(borderParts[0] ?? '1');
    // style is borderParts[1] — skip (always solid for our purposes)
    const colorStr = borderParts.slice(2).join(' ') || borderParts[1] || '';
    const color = parseColor(colorStr);
    if (weight > 0) {
      o.strokes = [{
        color: color ?? { r: 0, g: 0, b: 0, a: 1 },
        weight,
        opacity: 1,
        visible: true,
        align: 'INSIDE' as const,
      }];
    }
  }

  // Individual border sides — detect per-side weights
  const sideWeights: Record<string, number> = {};
  let sideColor: import('../engine/types').Color | null = null;
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const val = styles[`border-${side}`];
    if (val && val !== 'none') {
      const parts = val.split(/\s+/);
      const weight = parseUnit(parts[0]);
      sideWeights[side] = weight;
      if (!sideColor && weight > 0) {
        sideColor = parseColor(parts.slice(2).join(' ') || parts[1] || '') ?? { r: 0, g: 0, b: 0, a: 1 };
      }
    }
    // Also check border-<side>-width (when border shorthand + override)
    const widthVal = styles[`border-${side}-width`];
    if (widthVal) {
      sideWeights[side] = parseUnit(widthVal);
    }
  }

  const hasSideWeights = Object.keys(sideWeights).length > 0;
  if (hasSideWeights && !o.strokes) {
    const tw = sideWeights.top ?? 0;
    const rw = sideWeights.right ?? 0;
    const bw = sideWeights.bottom ?? 0;
    const lw = sideWeights.left ?? 0;
    const maxWeight = Math.max(tw, rw, bw, lw);
    if (maxWeight > 0) {
      const color = sideColor ?? { r: 0, g: 0, b: 0, a: 1 };
      o.strokes = [{
        color,
        weight: maxWeight,
        opacity: 1,
        visible: true,
        align: 'INSIDE' as const,
      }];
      // Check if sides differ
      if (tw !== rw || rw !== bw || bw !== lw) {
        o.independentStrokeWeights = true;
        o.borderTopWeight = tw;
        o.borderRightWeight = rw;
        o.borderBottomWeight = bw;
        o.borderLeftWeight = lw;
      }
    }
  }

  // ── Corner Radius ──
  if (styles['border-radius']) {
    const radii = styles['border-radius'].split(/[\s/]+/).map(parseUnit);
    if (radii.length === 1) {
      o.cornerRadius = radii[0];
    } else if (radii.length >= 4) {
      o.topLeftRadius = radii[0];
      o.topRightRadius = radii[1];
      o.bottomRightRadius = radii[2];
      o.bottomLeftRadius = radii[3];
      o.independentCorners = true;
      o.cornerRadius = 0;
    }
  }

  // ── Opacity ──
  if (styles.opacity) o.opacity = parseFloat(styles.opacity);

  // ── Overflow ──
  if (styles.overflow === 'hidden' || styles.overflow === 'clip') {
    o.clipsContent = true;
  }
  // Flex/grid containers with explicit dimensions clip content like browsers do
  if (!o.clipsContent && (styles.display === 'flex' || styles.display === 'grid') &&
      (styles.width || styles['max-width'] || styles.flex)) {
    o.clipsContent = true;
  }

  // ── Effects (box-shadow) ──
  if (styles['box-shadow'] && styles['box-shadow'] !== 'none') {
    // Handle multiple shadows separated by commas (outside parentheses)
    const shadows = splitShadows(styles['box-shadow']);
    const effects: Effect[] = [];
    for (const s of shadows) {
      const effect = parseShadow(s.trim());
      if (effect) effects.push(effect);
    }
    if (effects.length > 0) o.effects = effects;
  }

  // ── Layout (Flexbox / Grid → Auto Layout) ──
  const display = styles.display ?? '';
  const hasChildElements = el.children.some(c => c.kind === 'element' && c.tag !== 'style' && c.tag !== 'script' && c.tag !== 'br');
  if (display === 'flex' || display === 'inline-flex' || display === 'grid' || display === 'inline-grid') {
    const isGrid = display === 'grid' || display === 'inline-grid';

    // Grid: infer direction from template
    let dir: string;
    if (isGrid) {
      const cols = styles['grid-template-columns'] ?? '';
      const rows = styles['grid-template-rows'] ?? '';
      const colCount = cols ? cols.split(/\s+/).filter(s => s && s !== '/').length : 0;
      // Multi-column grid → horizontal with wrap; single column or rows → vertical
      if (colCount > 1) {
        dir = 'row';
        o.layoutWrap = 'WRAP';
      } else {
        dir = 'column';
      }
    } else {
      dir = styles['flex-direction'] ?? 'row';
    }
    o.layoutMode = dir === 'column' || dir === 'column-reverse' ? 'VERTICAL' : 'HORIZONTAL';

    // justify-content → primaryAxisAlign
    const jc = styles['justify-content'] ?? (isGrid ? styles['place-content']?.split(/\s+/)[1] : '') ?? '';
    if (jc === 'center') o.primaryAxisAlign = 'CENTER';
    else if (jc === 'flex-end' || jc === 'end') o.primaryAxisAlign = 'MAX';
    else if (jc === 'space-between') o.primaryAxisAlign = 'SPACE_BETWEEN';

    // align-items → counterAxisAlign
    const ai = styles['align-items'] ?? (isGrid ? styles['place-items']?.split(/\s+/)[0] : '') ?? '';
    if (ai === 'center') o.counterAxisAlign = 'CENTER';
    else if (ai === 'flex-end' || ai === 'end') o.counterAxisAlign = 'MAX';
    else if (ai === 'stretch') o.counterAxisAlign = 'STRETCH';
    else if (ai === 'baseline') o.counterAxisAlign = 'BASELINE';

    // gap
    if (styles.gap) o.itemSpacing = parseUnit(styles.gap);
    if (styles['row-gap']) o.counterAxisSpacing = parseUnit(styles['row-gap']);
    if (styles['column-gap']) o.itemSpacing = parseUnit(styles['column-gap']);

    // flex-wrap
    if (styles['flex-wrap'] === 'wrap') o.layoutWrap = 'WRAP';
  } else if (hasChildElements && nodeType === 'FRAME' && position !== 'absolute' && position !== 'fixed') {
    // Block-level container with element children → VERTICAL (normal document flow)
    o.layoutMode = 'VERTICAL';
  }

  // ── Flex item properties ──
  if (styles.flex) {
    const flexVal = styles.flex.trim();
    if (flexVal === 'none') {
      o.layoutGrow = 0;
    } else if (flexVal === 'auto') {
      o.layoutGrow = 1;
    } else if (/^\d+$/.test(flexVal)) {
      o.layoutGrow = parseInt(flexVal);
    } else {
      // flex: <grow> [<shrink>] [<basis>]
      const parts = flexVal.split(/\s+/);
      o.layoutGrow = parseFloat(parts[0]) || 0;
      // shrink (2nd value if numeric)
      if (parts[1] && /^[\d.]/.test(parts[1])) {
        // layoutShrink doesn't exist on SceneNode yet — store on overrides
        // to preserve for future roundtrip
      }
      // basis (last value with units) → apply to width/height depending on direction
      const basis = parts.length >= 3 ? parts[2] : (parts[1] && !/^[\d.]$/.test(parts[1]) ? parts[1] : undefined);
      if (basis && basis !== 'auto' && basis !== '0') {
        const basisPx = parseUnit(basis);
        if (basisPx > 0) {
          // Flex basis typically applies along primary axis
          // We can't know direction here, so store as width hint
          if (!o.width || o.width === 0) o.width = basisPx;
        }
      }
    }
  }
  if (styles['flex-grow']) o.layoutGrow = parseFloat(styles['flex-grow']) || 0;
  if (styles['flex-shrink']) o.layoutShrink = parseFloat(styles['flex-shrink']) || 1;

  // align-self
  if (styles['align-self']) {
    const as = styles['align-self'];
    if (as === 'center') o.layoutAlign = 'CENTER';
    else if (as === 'flex-end' || as === 'end') o.layoutAlign = 'MAX';
    else if (as === 'stretch') o.layoutAlign = 'STRETCH';
  }

  // ── Padding ──
  if (styles.padding) {
    const [pt, pr, pb, pl] = parseFourValues(styles.padding);
    o.paddingTop = pt; o.paddingRight = pr;
    o.paddingBottom = pb; o.paddingLeft = pl;
  }
  if (styles['padding-top']) o.paddingTop = parseUnit(styles['padding-top']);
  if (styles['padding-right']) o.paddingRight = parseUnit(styles['padding-right']);
  if (styles['padding-bottom']) o.paddingBottom = parseUnit(styles['padding-bottom']);
  if (styles['padding-left']) o.paddingLeft = parseUnit(styles['padding-left']);

  // ── Typography ──
  if (nodeType === 'TEXT') {
    applyTextStyles(o, styles, el.tag);
  }

  // ── Transforms ──
  if (styles.transform && styles.transform !== 'none') {
    const tf = styles.transform;

    // rotate() / rotateZ()
    const rotateMatch = tf.match(/rotate[Z]?\(([^)]+)\)/);
    if (rotateMatch) {
      const val = rotateMatch[1].trim();
      if (val.endsWith('deg')) o.rotation = parseFloat(val);
      else if (val.endsWith('rad')) o.rotation = parseFloat(val) * (180 / Math.PI);
      else if (val.endsWith('turn')) o.rotation = parseFloat(val) * 360;
      else o.rotation = parseFloat(val);
    }

    // scale() / scaleX() / scaleY()
    const scaleMatch = tf.match(/scale\(([^)]+)\)/);
    if (scaleMatch) {
      const parts = scaleMatch[1].split(',').map(s => parseFloat(s.trim()));
      const sx = parts[0] ?? 1;
      const sy = parts[1] ?? sx;
      if (o.width) o.width = Math.round(o.width * sx);
      if (o.height) o.height = Math.round(o.height * sy);
    }
    const scaleXMatch = tf.match(/scaleX\(([^)]+)\)/);
    if (scaleXMatch && o.width) o.width = Math.round(o.width * parseFloat(scaleXMatch[1]));
    const scaleYMatch = tf.match(/scaleY\(([^)]+)\)/);
    if (scaleYMatch && o.height) o.height = Math.round(o.height * parseFloat(scaleYMatch[1]));

    // translate() / translateX() / translateY()
    const translateMatch = tf.match(/translate\(([^)]+)\)/);
    if (translateMatch) {
      const rawParts = translateMatch[1].split(',').map(s => s.trim());
      const tx = rawParts[0]?.endsWith('%') ? (parseFloat(rawParts[0]) / 100) * (o.width ?? 0) : parseUnit(rawParts[0] ?? '');
      const ty = rawParts[1]?.endsWith('%') ? (parseFloat(rawParts[1]) / 100) * (o.height ?? 0) : parseUnit(rawParts[1] ?? '');
      o.x = (o.x ?? 0) + tx;
      o.y = (o.y ?? 0) + ty;
    }
    const txMatch = tf.match(/translateX\(([^)]+)\)/);
    if (txMatch) {
      const txVal = txMatch[1].trim();
      // translateX(%) is relative to the element's own width
      o.x = (o.x ?? 0) + (txVal.endsWith('%') ? (parseFloat(txVal) / 100) * (o.width ?? 0) : parseUnit(txVal));
    }
    const tyMatch = tf.match(/translateY\(([^)]+)\)/);
    if (tyMatch) {
      const tyVal = tyMatch[1].trim();
      // translateY(%) is relative to the element's own height
      o.y = (o.y ?? 0) + (tyVal.endsWith('%') ? (parseFloat(tyVal) / 100) * (o.height ?? 0) : parseUnit(tyVal));
    }

    // skew() / skewX() / skewY() → store as rotation approximation for small angles
    const skewMatch = tf.match(/skew\(([^)]+)\)/);
    if (skewMatch && !rotateMatch) {
      const parts = skewMatch[1].split(',').map(s => parseFloat(s.trim()));
      // Use average of skewX and skewY as rotation approximation
      o.rotation = (parts[0] ?? 0) + (parts[1] ?? 0) / 2;
    }

    // matrix(a, b, c, d, tx, ty) — extract rotation, scale, translation
    const matrixMatch = tf.match(/matrix\(([^)]+)\)/);
    if (matrixMatch) {
      const [a, b, c, d, tx, ty] = matrixMatch[1].split(',').map(s => parseFloat(s.trim()));
      // Extract rotation from matrix
      const angle = Math.atan2(b, a) * (180 / Math.PI);
      if (Math.abs(angle) > 0.1) o.rotation = angle;
      // Extract scale
      const sx = Math.sqrt(a * a + b * b);
      const sy = Math.sqrt(c * c + d * d);
      if (Math.abs(sx - 1) > 0.01 && o.width) o.width = Math.round(o.width * sx);
      if (Math.abs(sy - 1) > 0.01 && o.height) o.height = Math.round(o.height * sy);
      // Extract translation
      if (tx) o.x = (o.x ?? 0) + tx;
      if (ty) o.y = (o.y ?? 0) + ty;
    }
  }

  // ── Clip path ──
  if (styles['clip-path']) {
    o.clipsContent = true;
    // circle() → make the node an ellipse
    if (styles['clip-path'].includes('circle(') || styles['clip-path'].includes('ellipse(')) {
      // Override the node type hint via a flag the caller can check
      o._clipShape = 'ellipse';
    }
  }

  // ── Visibility ──
  if (styles.display === 'none' || styles.visibility === 'hidden') {
    o.visible = false;
  }

  return o;
}

function applyTextStyles(o: any, styles: Record<string, string>, tag: string) {
  const defaults = TAG_FONT_DEFAULTS[tag];
  if (defaults) {
    o.fontSize = defaults.fontSize;
    o.fontWeight = defaults.fontWeight;
  }

  if (styles['font-size']) o.fontSize = parseUnit(styles['font-size']);
  if (styles['font-weight']) {
    const w = styles['font-weight'];
    if (w === 'bold') o.fontWeight = 700;
    else if (w === 'normal') o.fontWeight = 400;
    else if (w === 'lighter') o.fontWeight = 300;
    else if (w === 'bolder') o.fontWeight = 800;
    else o.fontWeight = parseInt(w) || 400;
  }

  if (styles['font-family']) {
    // Take the first font family, strip quotes
    o.fontFamily = styles['font-family']
      .split(',')[0]
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }

  if (styles['font-style'] === 'italic' || styles['font-style'] === 'oblique') {
    o.italic = true;
  }

  if (styles['line-height']) {
    const lh = styles['line-height'];
    if (lh.endsWith('px')) {
      o.lineHeight = parseFloat(lh);
    } else {
      // unitless or percentage — multiply by fontSize
      const multiplier = parseFloat(lh);
      if (!isNaN(multiplier)) {
        const fs = o.fontSize ?? 16;
        o.lineHeight = multiplier > 4 ? multiplier : fs * multiplier;
      }
    }
  }

  if (styles['letter-spacing']) {
    o.letterSpacing = parseUnit(styles['letter-spacing']);
  }

  if (styles['text-align']) {
    const ta = styles['text-align'];
    if (ta === 'center') o.textAlignHorizontal = 'CENTER';
    else if (ta === 'right' || ta === 'end') o.textAlignHorizontal = 'RIGHT';
    else if (ta === 'justify') o.textAlignHorizontal = 'JUSTIFIED';
    else o.textAlignHorizontal = 'LEFT';
  }

  if (styles['text-transform']) {
    const tt = styles['text-transform'];
    if (tt === 'uppercase') o.textCase = 'UPPER';
    else if (tt === 'lowercase') o.textCase = 'LOWER';
    else if (tt === 'capitalize') o.textCase = 'TITLE';
  }

  // font-feature-settings: "ss01", "tnum" → ['ss01', 'tnum']
  if (styles['font-feature-settings'] && styles['font-feature-settings'] !== 'normal') {
    const ffs = styles['font-feature-settings'];
    const tags = [...ffs.matchAll(/["']([a-z]{2,4}\d{0,2})["']/gi)].map(m => m[1].toLowerCase());
    if (tags.length > 0) o.fontFeatureSettings = tags;
  }

  if (styles['text-decoration']) {
    const td = styles['text-decoration'];
    if (td.includes('underline')) o.textDecoration = 'UNDERLINE';
    else if (td.includes('line-through')) o.textDecoration = 'STRIKETHROUGH';
  }

  // Text truncation (text-overflow + line-clamp)
  const textOverflow = styles['text-overflow'];
  const whiteSpace = styles['white-space'];
  const lineClamp = styles['-webkit-line-clamp'] || styles['line-clamp'];

  if (textOverflow === 'ellipsis' || lineClamp) {
    o.textTruncation = 'ENDING';
    if (lineClamp) {
      o.maxLines = parseInt(lineClamp, 10) || null;
    } else if (whiteSpace === 'nowrap') {
      o.maxLines = 1;
    }
  }

  // Auto-resize for text without explicit dimensions
  if (!styles.width && !styles.height) {
    o.textAutoResize = 'WIDTH_AND_HEIGHT';
  } else if (!styles.height) {
    o.textAutoResize = 'HEIGHT';
  }
}

function mapObjectFit(fit: string): any {
  switch (fit.trim()) {
    case 'contain': return 'FIT';
    case 'fill': return 'STRETCH';
    case 'none': return 'CROP';
    case 'scale-down': return 'FIT';
    default: return 'FILL'; // cover
  }
}

function makeSolidFill(color: Color): Fill {
  return {
    type: 'SOLID',
    color: { r: color.r, g: color.g, b: color.b, a: 1 },
    opacity: color.a,
    visible: true,
  };
}

function splitShadows(value: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) result.push(current);
  return result;
}
