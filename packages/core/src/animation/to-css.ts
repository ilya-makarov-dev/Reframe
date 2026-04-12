/**
 * Phase 5: ITimeline → CSS emission.
 *
 * Converts an ITimeline into two strings:
 *   1. A `@keyframes` block per animation (named by animation.name).
 *   2. Per-node rules mapping a CSS class to the right `animation: ...`
 *      shorthand + transform/filter overrides needed to reach that class.
 *
 * This is intentionally dumb — we don't try to be clever about merging or
 * optimising. One animation → one @keyframes block → one rule. Optimisation
 * can come later; correctness first.
 *
 * Scope limitations (documented, not hidden):
 *   - Only a subset of AnimatableProperties map to pure CSS without tricks
 *     (transform, opacity, filter, color-adjacent props). Geometry props
 *     like `width`/`height` are animated via the transform(scale) fallback
 *     when a scale keyframe is present; otherwise they are omitted with a
 *     TODO noted in the comment block.
 *   - Spring easings degrade to an ease-out-back approximation — the
 *     easingToCss helper handles this.
 *   - Stroke/fill color animation emits a `color` or `background` keyframe,
 *     not a fill-paint keyframe (SVG) — HTML export uses div backgrounds.
 */

import type { ITimeline, INodeAnimation, IKeyframe, AnimatableProperties } from './types.js';
import { easingToCss } from './easing.js';

export interface TimelineCss {
  /** Full `@keyframes name { ... }` blocks, joined with newlines. */
  keyframes: string;
  /** Per-nodeId → list of class names to apply on the element. */
  perNodeClasses: Map<string, string[]>;
  /** Per-class → single-line CSS rule body the caller should append to the stylesheet. */
  classRules: Map<string, string>;
}

/**
 * Emit a CSS keyframes block and per-node class rules from a timeline.
 *
 * Callers (exporters) should:
 *   1. Paste `keyframes` + `classRules` (joined) into a <style> tag.
 *   2. For each node id, look up `perNodeClasses` and add those to the
 *      element's className. HTML exporter already has a behaviorClassMap
 *      mechanism — we reuse the same pattern so animations live alongside
 *      hover/state CSS without a second stylesheet round-trip.
 */
export function timelineToCss(timeline: ITimeline | null | undefined): TimelineCss {
  const out: TimelineCss = {
    keyframes: '',
    perNodeClasses: new Map(),
    classRules: new Map(),
  };
  if (!timeline || !timeline.animations?.length) return out;

  const keyframeBlocks: string[] = [];
  let counter = 0;

  for (const anim of timeline.animations) {
    if (!anim.nodeId || !anim.keyframes || anim.keyframes.length < 2) continue;

    // Synthesize a unique CSS identifier per animation. We can't trust the
    // agent-supplied `name` to be CSS-safe (spaces, emojis, collisions), so
    // we re-derive one from the counter + node id prefix.
    const safeId = `rfa${counter++}_${(anim.nodeId || '').replace(/[^\w-]/g, '')}`;

    // Build the @keyframes body.
    const kfLines: string[] = [];
    for (let i = 0; i < anim.keyframes.length; i++) {
      const kf = anim.keyframes[i];
      const percent = Math.round(kf.offset * 100);
      const decls = keyframeToCssDeclarations(kf);
      if (decls.length > 0) {
        kfLines.push(`  ${percent}% { ${decls.join('; ')} }`);
      }
    }
    if (kfLines.length === 0) continue;

    keyframeBlocks.push(`@keyframes ${safeId} {\n${kfLines.join('\n')}\n}`);

    // Build the class rule. `animation` shorthand: name duration timing-function delay iteration-count direction fill-mode.
    const duration = `${Math.max(1, Math.round(anim.duration))}ms`;
    const delay = `${Math.max(0, Math.round(anim.delay ?? 0))}ms`;
    const iterations = anim.iterations === Infinity ? 'infinite' : String(anim.iterations ?? 1);
    const direction = anim.direction ?? 'normal';
    const fillMode = anim.fillMode ?? 'both';
    // Easing on the first keyframe applies to the whole animation in CSS
    // shorthand — per-segment easing requires either animation-timing-function
    // per keyframe (supported but verbose) or multiple animations. Keep it
    // single-easing for now; the preset library produces uniform easing.
    const easing = anim.keyframes[0].easing ? easingToCss(anim.keyframes[0].easing) : 'ease';

    const shorthand = `${safeId} ${duration} ${easing} ${delay} ${iterations} ${direction} ${fillMode}`;
    out.classRules.set(safeId, `.${safeId} { animation: ${shorthand}; }`);

    const existing = out.perNodeClasses.get(anim.nodeId) ?? [];
    existing.push(safeId);
    out.perNodeClasses.set(anim.nodeId, existing);
  }

  out.keyframes = keyframeBlocks.join('\n');
  return out;
}

/**
 * Translate a single keyframe's AnimatableProperties into CSS declarations.
 * Returns an array of `prop: value` strings (no trailing semicolons —
 * the caller joins with "; ").
 *
 * Ordering within a keyframe is irrelevant for CSS; we output transform
 * aggregates first because they're the common case.
 */
function keyframeToCssDeclarations(kf: IKeyframe): string[] {
  const out: string[] = [];
  const p = kf.properties as AnimatableProperties;

  // Aggregate transform components — CSS allows a single `transform`
  // declaration per rule, so we must combine translate/scale/rotate.
  const transforms: string[] = [];
  if (typeof p.x === 'number' || typeof p.y === 'number') {
    transforms.push(`translate(${p.x ?? 0}px, ${p.y ?? 0}px)`);
  }
  if (typeof p.scaleX === 'number' || typeof p.scaleY === 'number') {
    const sx = p.scaleX ?? 1;
    const sy = p.scaleY ?? sx;
    transforms.push(`scale(${sx}, ${sy})`);
  }
  if (typeof p.rotation === 'number') {
    transforms.push(`rotate(${p.rotation}deg)`);
  }
  if (transforms.length > 0) {
    out.push(`transform: ${transforms.join(' ')}`);
  }

  if (typeof p.opacity === 'number') out.push(`opacity: ${p.opacity}`);
  if (typeof p.cornerRadius === 'number') out.push(`border-radius: ${p.cornerRadius}px`);
  if (typeof p.fontSize === 'number') out.push(`font-size: ${p.fontSize}px`);
  if (typeof p.letterSpacing === 'number') out.push(`letter-spacing: ${p.letterSpacing}px`);

  if (typeof p.blurRadius === 'number') out.push(`filter: blur(${p.blurRadius}px)`);

  if (p.fillColor) {
    const { r, g, b, a } = p.fillColor;
    out.push(`background: rgba(${Math.round((r ?? 0) * 255)}, ${Math.round((g ?? 0) * 255)}, ${Math.round((b ?? 0) * 255)}, ${a ?? 1})`);
  }

  if (p.clipInset) {
    const { top, right, bottom, left } = p.clipInset;
    out.push(`clip-path: inset(${top}px ${right}px ${bottom}px ${left}px)`);
  }

  return out;
}
