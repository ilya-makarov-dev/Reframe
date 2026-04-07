/**
 * Animated HTML Exporter — Scene Graph + ITimeline → HTML + CSS @keyframes
 *
 * Takes a static scene and a timeline, produces a self-contained HTML document
 * with CSS animations that plays in any browser. No JS required.
 */

import type { SceneGraph } from '../engine/scene-graph.js';
import type { SceneNode, Color, Fill, Effect, GradientTransform } from '../engine/types.js';
import type { ITimeline, INodeAnimation, IKeyframe, AnimatableProperties, Easing } from '../animation/types.js';
import { easingToCss } from '../animation/easing.js';
import { computeDuration } from '../animation/timeline.js';

// ─── Options ───────────────────────────────────────────────────

export interface AnimatedHtmlExportOptions {
  /** Include full HTML document wrapper (default: true) */
  fullDocument?: boolean;
  /** Include play/pause controls (default: false) */
  controls?: boolean;
  /** Background color for the document (default: transparent) */
  backgroundColor?: string;
  /** Include responsive meta viewport (default: true) */
  responsive?: boolean;
}

// ─── Main Export ───────────────────────────────────────────────

export function exportToAnimatedHtml(
  graph: SceneGraph,
  rootId: string,
  timeline: ITimeline,
  options: AnimatedHtmlExportOptions = {},
): string {
  const root = graph.getNode(rootId);
  if (!root) throw new Error(`Node ${rootId} not found`);

  const fullDoc = options.fullDocument ?? true;

  // Build node-id → animation map
  const animByNode = new Map<string, INodeAnimation[]>();
  for (const anim of timeline.animations) {
    const key = resolveNodeKey(graph, rootId, anim);
    if (!key) continue;
    const list = animByNode.get(key) ?? [];
    list.push(anim);
    animByNode.set(key, list);
  }

  // Generate keyframes CSS
  const keyframesBlocks: string[] = [];
  const nodeAnimNames = new Map<string, string[]>();
  let animCounter = 0;

  for (const [nodeId, anims] of animByNode) {
    const names: string[] = [];
    for (const anim of anims) {
      const animName = `rf-anim-${animCounter++}`;
      names.push(animName);
      keyframesBlocks.push(generateKeyframesBlock(animName, anim));
    }
    nodeAnimNames.set(nodeId, names);
  }

  // Render HTML with animation classes
  const html = renderNode(graph, root, true, animByNode, nodeAnimNames);

  const totalDuration = computeDuration(timeline);
  const loop = timeline.loop ?? false;

  // Assemble CSS
  const cssBlocks = [
    '* { margin: 0; padding: 0; box-sizing: border-box; }',
    ...keyframesBlocks,
  ];

  if (options.controls) {
    cssBlocks.push(`
.rf-controls {
  position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
  z-index: 9999; display: flex; gap: 8px;
  background: rgba(0,0,0,0.8); padding: 8px 16px; border-radius: 8px;
}
.rf-controls button {
  background: #fff; color: #000; border: none; padding: 6px 14px;
  border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500;
}
.rf-controls button:hover { background: #e0e0e0; }
.rf-controls span { color: #fff; font-size: 13px; line-height: 30px; }
.rf-paused * { animation-play-state: paused !important; }`);
  }

  if (!fullDoc) {
    return `<style>\n${cssBlocks.join('\n\n')}\n</style>\n${html}`;
  }

  const bg = options.backgroundColor ? `\n    body { background: ${options.backgroundColor}; }` : '';
  const viewport = (options.responsive ?? true)
    ? '\n  <meta name="viewport" content="width=device-width, initial-scale=1">'
    : '';

  const controlsHtml = options.controls ? `
  <div class="rf-controls">
    <button onclick="document.body.classList.toggle('rf-paused')">⏯ Play/Pause</button>
    <span>${(totalDuration / 1000).toFixed(1)}s${loop ? ' (loop)' : ''}</span>
  </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">${viewport}
  <title>${escapeHtml(root.name)} — Animated</title>
  <style>
    ${cssBlocks.join('\n    ')}${bg}
  </style>
</head>
<body>
  ${html}${controlsHtml}
</body>
</html>`;
}

// ─── Keyframes Generation ──────────────────────────────────────

function generateKeyframesBlock(name: string, anim: INodeAnimation): string {
  const lines: string[] = [`@keyframes ${name} {`];

  for (const kf of anim.keyframes) {
    const pct = Math.round(kf.offset * 100);
    const props = animatableToCSS(kf.properties);
    const easingStr = kf.easing ? `animation-timing-function: ${easingToCss(kf.easing)};` : '';
    const allProps = easingStr ? `${props} ${easingStr}` : props;
    lines.push(`  ${pct}% { ${allProps} }`);
  }

  lines.push('}');
  return lines.join('\n');
}

/** Convert AnimatableProperties to CSS property declarations */
function animatableToCSS(props: AnimatableProperties): string {
  const css: string[] = [];
  const transforms: string[] = [];

  if (props.x !== undefined || props.y !== undefined) {
    const tx = props.x ?? 0;
    const ty = props.y ?? 0;
    if (tx !== 0 || ty !== 0) transforms.push(`translate(${px(tx)}, ${px(ty)})`);
  }

  if (props.scaleX !== undefined || props.scaleY !== undefined) {
    const sx = props.scaleX ?? 1;
    const sy = props.scaleY ?? 1;
    transforms.push(`scale(${round(sx)}, ${round(sy)})`);
  }

  if (props.rotation !== undefined) {
    transforms.push(`rotate(${round(props.rotation)}deg)`);
  }

  if (transforms.length > 0) {
    css.push(`transform: ${transforms.join(' ')};`);
  }

  if (props.opacity !== undefined) css.push(`opacity: ${round(props.opacity)};`);
  if (props.width !== undefined) css.push(`width: ${px(props.width)};`);
  if (props.height !== undefined) css.push(`height: ${px(props.height)};`);
  if (props.cornerRadius !== undefined) css.push(`border-radius: ${px(props.cornerRadius)};`);

  if (props.fillColor) {
    css.push(`background-color: ${colorToRgba(props.fillColor, props.fillOpacity ?? 1)};`);
  }

  if (props.strokeColor) {
    css.push(`border-color: ${colorToRgba(props.strokeColor, props.strokeOpacity ?? 1)};`);
  }
  if (props.strokeWeight !== undefined) css.push(`border-width: ${px(props.strokeWeight)};`);

  if (props.fontSize !== undefined) css.push(`font-size: ${px(props.fontSize)};`);
  if (props.letterSpacing !== undefined) css.push(`letter-spacing: ${px(props.letterSpacing)};`);

  // Shadow
  if (props.shadowRadius !== undefined || props.shadowColor) {
    const ox = props.shadowOffsetX ?? 0;
    const oy = props.shadowOffsetY ?? 0;
    const r = props.shadowRadius ?? 0;
    const s = props.shadowSpread ?? 0;
    const c = props.shadowColor ? colorToRgba(props.shadowColor) : 'rgba(0,0,0,0.25)';
    css.push(`box-shadow: ${px(ox)} ${px(oy)} ${px(r)} ${px(s)} ${c};`);
  }

  if (props.blurRadius !== undefined) {
    css.push(`filter: blur(${px(props.blurRadius)});`);
  }

  if (props.clipInset) {
    const { top, right, bottom, left } = props.clipInset;
    css.push(`clip-path: inset(${round(top)}% ${round(right)}% ${round(bottom)}% ${round(left)}%);`);
  }

  return css.join(' ');
}

// ─── Node Rendering ────────────────────────────────────────────

function renderNode(
  graph: SceneGraph,
  node: SceneNode,
  isRoot: boolean,
  animByNode: Map<string, INodeAnimation[]>,
  nodeAnimNames: Map<string, string[]>,
): string {
  if (!node.visible) return '';

  const tag = node.type === 'TEXT' ? 'span' : 'div';
  const styles = computeStaticStyles(node, isRoot);
  const animStyle = computeAnimationStyle(node.id, animByNode, nodeAnimNames);
  const fullStyle = animStyle ? `${styles}; ${animStyle}` : styles;

  const attrs = [`style="${fullStyle}"`, `data-id="${node.id}"`, `data-name="${escapeHtml(node.name)}"`];

  if (node.type === 'TEXT' && node.text) {
    const textHtml = escapeHtml(node.text).replace(/\n/g, '<br/>');
    return `<${tag} ${attrs.join(' ')}>${textHtml}</${tag}>`;
  }

  const children = node.childIds
    .map(id => graph.getNode(id))
    .filter((n): n is SceneNode => n !== null && n !== undefined)
    .map(child => renderNode(graph, child, false, animByNode, nodeAnimNames))
    .filter(Boolean);

  if (children.length === 0) {
    return `<${tag} ${attrs.join(' ')}></${tag}>`;
  }

  return `<${tag} ${attrs.join(' ')}>\n${indent(children.join('\n'), 4)}\n  </${tag}>`;
}

function computeAnimationStyle(
  nodeId: string,
  animByNode: Map<string, INodeAnimation[]>,
  nodeAnimNames: Map<string, string[]>,
): string | null {
  const anims = animByNode.get(nodeId);
  const names = nodeAnimNames.get(nodeId);
  if (!anims || !names || anims.length === 0) return null;

  const parts = anims.map((anim, i) => {
    const name = names[i];
    const dur = `${anim.duration}ms`;
    const delay = anim.delay ? `${anim.delay}ms` : '0ms';
    const easing = anim.keyframes[0]?.easing ? easingToCss(anim.keyframes[0].easing) : 'ease';
    const iterations = anim.iterations === Infinity ? 'infinite' : String(anim.iterations ?? 1);
    const direction = anim.direction ?? 'normal';
    const fill = anim.fillMode ?? 'both';
    return `${name} ${dur} ${easing} ${delay} ${iterations} ${direction} ${fill}`;
  });

  return `animation: ${parts.join(', ')}`;
}

// ─── Static Styles (same as html.ts but simplified) ────────────

function computeStaticStyles(node: SceneNode, isRoot: boolean): string {
  const s: string[] = [];

  if (isRoot) {
    s.push('position: relative');
    s.push(`width: ${px(node.width)}`);
    s.push(`height: ${px(node.height)}`);
    s.push('margin: 0 auto');
    s.push('overflow: hidden');
  } else {
    s.push('position: absolute');
    s.push(`left: ${px(node.x)}`);
    s.push(`top: ${px(node.y)}`);
    s.push(`width: ${px(node.width)}`);
    s.push(`height: ${px(node.height)}`);
  }

  if (node.opacity < 1) s.push(`opacity: ${round(node.opacity)}`);
  if (node.rotation !== 0) s.push(`transform: rotate(${round(node.rotation)}deg)`);

  // For TEXT nodes, fills represent text color (handled below), not background
  if (node.type !== 'TEXT') {
    const bg = computeBackground(node.fills);
    if (bg) s.push(bg);
  }

  const border = computeBorder(node.strokes);
  if (border) s.push(border);

  if (node.cornerRadius) s.push(`border-radius: ${px(node.cornerRadius)}`);
  if (node.clipsContent) s.push('overflow: hidden');

  const shadow = computeBoxShadow(node.effects);
  if (shadow) s.push(shadow);

  if (node.type === 'TEXT') {
    s.push(`font-size: ${px(node.fontSize || 16)}`);
    if (node.fontFamily) s.push(`font-family: "${node.fontFamily}", sans-serif`);
    if (node.fontWeight && node.fontWeight !== 400) s.push(`font-weight: ${node.fontWeight}`);
    if (node.italic) s.push('font-style: italic');
    if (node.letterSpacing) s.push(`letter-spacing: ${px(node.letterSpacing)}`);
    if (node.lineHeight) s.push(`line-height: ${px(node.lineHeight)}`);

    const textColor = node.fills?.find(f => f.visible && f.type === 'SOLID');
    if (textColor) s.push(`color: ${colorToRgba(textColor.color, textColor.opacity)}`);

    if (node.textAlignHorizontal === 'CENTER') s.push('text-align: center');
    else if (node.textAlignHorizontal === 'RIGHT') s.push('text-align: right');

    s.push('display: flex');
    s.push('align-items: ' + (
      node.textAlignVertical === 'CENTER' ? 'center' :
      node.textAlignVertical === 'BOTTOM' ? 'flex-end' : 'flex-start'
    ));
  }

  return s.join('; ');
}

// ─── Node resolution ───────────────────────────────────────────

function resolveNodeKey(graph: SceneGraph, rootId: string, anim: INodeAnimation): string | null {
  if (anim.nodeId) {
    const node = graph.getNode(anim.nodeId);
    if (node) return anim.nodeId;
  }
  if (anim.nodeName) {
    // Search by name
    const found = findNodeByName(graph, rootId, anim.nodeName);
    if (found) return found;
  }
  return null;
}

function findNodeByName(graph: SceneGraph, nodeId: string, name: string): string | null {
  const node = graph.getNode(nodeId);
  if (!node) return null;
  if (node.name === name) return node.id;
  for (const childId of node.childIds) {
    const found = findNodeByName(graph, childId, name);
    if (found) return found;
  }
  return null;
}

// ─── Utilities ─────────────────────────────────────────────────

function gradientTransformToAngle(t: GradientTransform): number {
  const rad = Math.atan2(t.m01, t.m00);
  return ((rad * 180 / Math.PI) + 90 + 360) % 360;
}

function computeBackground(fills: Fill[]): string | null {
  if (!fills || fills.length === 0) return null;
  const visible = fills.filter(f => f.visible);
  if (visible.length === 0) return null;
  if (visible.length === 1 && visible[0].type === 'SOLID') {
    return `background: ${colorToRgba(visible[0].color, visible[0].opacity)}`;
  }
  const bgs = visible.map(fill => {
    if (fill.type === 'SOLID') return colorToRgba(fill.color, fill.opacity);
    if (fill.type === 'GRADIENT_LINEAR' && fill.gradientStops) {
      const stops = fill.gradientStops.map(s => `${colorToRgba(s.color)} ${round(s.position * 100)}%`).join(', ');
      const angle = fill.gradientTransform
        ? `${round(gradientTransformToAngle(fill.gradientTransform))}deg, `
        : '';
      return `linear-gradient(${angle}${stops})`;
    }
    if (fill.type === 'GRADIENT_RADIAL' && fill.gradientStops) {
      const stops = fill.gradientStops.map(s => `${colorToRgba(s.color)} ${round(s.position * 100)}%`).join(', ');
      return `radial-gradient(${stops})`;
    }
    return null;
  }).filter(Boolean);
  return bgs.length > 0 ? `background: ${bgs.join(', ')}` : null;
}

function computeBorder(strokes: import('../engine/types.js').Stroke[]): string | null {
  if (!strokes || strokes.length === 0) return null;
  const stroke = strokes.find(s => s.visible);
  if (!stroke) return null;
  return `border: ${px(stroke.weight)} solid ${colorToRgba(stroke.color, stroke.opacity)}`;
}

function computeBoxShadow(effects: Effect[]): string | null {
  if (!effects || effects.length === 0) return null;
  const shadows = effects
    .filter(e => e.visible && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'))
    .map(e => {
      const inset = e.type === 'INNER_SHADOW' ? 'inset ' : '';
      return `${inset}${px(e.offset.x)} ${px(e.offset.y)} ${px(e.radius)} ${px(e.spread)} ${colorToRgba(e.color)}`;
    });
  return shadows.length > 0 ? `box-shadow: ${shadows.join(', ')}` : null;
}

function colorToRgba(color: { r: number; g: number; b: number; a: number }, opacity = 1): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = round(color.a * opacity);
  if (a === 1) return `#${hex(r)}${hex(g)}${hex(b)}`;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function hex(n: number): string { return n.toString(16).padStart(2, '0'); }
function px(n: number): string { return n === 0 ? '0' : `${round(n)}px`; }
function round(n: number): number { return Math.round(n * 100) / 100; }
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function indent(s: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return s.split('\n').map(l => pad + l).join('\n');
}
