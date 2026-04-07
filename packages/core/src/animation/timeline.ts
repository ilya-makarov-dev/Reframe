/**
 * Timeline Engine — interpolation, validation, computed duration.
 *
 * Takes an ITimeline + INode tree → computes animated property values
 * at any point in time. Foundation for all animation exporters.
 */

import type {
  ITimeline, INodeAnimation, IKeyframe,
  AnimatableProperties, AnimatableProperty, FillMode,
} from './types.js';
import { resolveEasing } from './easing.js';

// ─── Timeline Computation ──────────────────────────────────────

/** Compute the total duration of a timeline (ms) */
export function computeDuration(timeline: ITimeline): number {
  if (timeline.duration) return timeline.duration;
  let max = 0;
  for (const anim of timeline.animations) {
    const iterations = anim.iterations ?? 1;
    const dir = anim.direction ?? 'normal';
    // alternate/alternate-reverse: each iteration reverses, doubling effective time per cycle
    const isAlternate = dir === 'alternate' || dir === 'alternate-reverse';
    const effectiveIterations = isAlternate && iterations > 1
      ? iterations  // each iteration is one direction, total time stays the same
      : iterations;
    const end = (anim.delay ?? 0) + anim.duration * effectiveIterations;
    if (end > max) max = end;
  }
  return max;
}

/** Validate a timeline, return errors */
export function validateTimeline(timeline: ITimeline): string[] {
  const errors: string[] = [];

  if (!timeline.animations || timeline.animations.length === 0) {
    errors.push('Timeline has no animations');
    return errors;
  }

  for (let i = 0; i < timeline.animations.length; i++) {
    const anim = timeline.animations[i];
    const prefix = `animations[${i}]`;

    if (!anim.nodeId && !anim.nodeName) {
      errors.push(`${prefix}: must have nodeId or nodeName`);
    }
    if (!anim.keyframes || anim.keyframes.length < 2) {
      errors.push(`${prefix}: needs at least 2 keyframes`);
    }
    if (anim.duration <= 0) {
      errors.push(`${prefix}: duration must be > 0`);
    }

    // Validate keyframe offsets
    if (anim.keyframes?.length >= 2) {
      const offsets = anim.keyframes.map(k => k.offset);
      if (offsets[0] !== 0) {
        errors.push(`${prefix}: first keyframe offset must be 0`);
      }
      if (offsets[offsets.length - 1] !== 1) {
        errors.push(`${prefix}: last keyframe offset must be 1`);
      }
      for (let j = 1; j < offsets.length; j++) {
        if (offsets[j] <= offsets[j - 1]) {
          errors.push(`${prefix}: keyframe offsets must be strictly increasing`);
          break;
        }
      }
    }
  }

  return errors;
}

// ─── Interpolation ─────────────────────────────────────────────

/** Interpolate a single number */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolate a color {r,g,b,a} */
function lerpColor(
  a: { r: number; g: number; b: number; a: number },
  b: { r: number; g: number; b: number; a: number },
  t: number,
): { r: number; g: number; b: number; a: number } {
  return {
    r: lerp(a.r, b.r, t),
    g: lerp(a.g, b.g, t),
    b: lerp(a.b, b.b, t),
    a: lerp(a.a, b.a, t),
  };
}

/** Interpolate clipInset */
function lerpClipInset(
  a: { top: number; right: number; bottom: number; left: number },
  b: { top: number; right: number; bottom: number; left: number },
  t: number,
): { top: number; right: number; bottom: number; left: number } {
  return {
    top: lerp(a.top, b.top, t),
    right: lerp(a.right, b.right, t),
    bottom: lerp(a.bottom, b.bottom, t),
    left: lerp(a.left, b.left, t),
  };
}

/** Color property names */
const COLOR_PROPS = new Set<AnimatableProperty>([
  'fillColor', 'strokeColor', 'shadowColor',
]);

/** Clip inset property */
const CLIP_PROPS = new Set<AnimatableProperty>(['clipInset']);

/**
 * Interpolate between two keyframes' properties at progress t ∈ [0,1]
 */
export function interpolateProperties(
  from: AnimatableProperties,
  to: AnimatableProperties,
  t: number,
): AnimatableProperties {
  const result: AnimatableProperties = {};
  const allKeys = new Set([
    ...Object.keys(from) as AnimatableProperty[],
    ...Object.keys(to) as AnimatableProperty[],
  ]);

  for (const key of allKeys) {
    const a = from[key];
    const b = to[key];
    if (a === undefined && b === undefined) continue;

    if (COLOR_PROPS.has(key)) {
      const ca = (a ?? { r: 0, g: 0, b: 0, a: 1 }) as { r: number; g: number; b: number; a: number };
      const cb = (b ?? ca) as { r: number; g: number; b: number; a: number };
      (result as any)[key] = lerpColor(ca, cb, t);
    } else if (CLIP_PROPS.has(key)) {
      const ca = (a ?? { top: 0, right: 0, bottom: 0, left: 0 }) as { top: number; right: number; bottom: number; left: number };
      const cb = (b ?? ca) as { top: number; right: number; bottom: number; left: number };
      (result as any)[key] = lerpClipInset(ca, cb, t);
    } else {
      const na = (a ?? 0) as number;
      const nb = (b ?? na) as number;
      (result as any)[key] = lerp(na, nb, t);
    }
  }

  return result;
}

/**
 * Get animated properties for a single animation at a given time (ms).
 * Returns null if the animation hasn't started yet or is finished (respecting fillMode).
 */
export function sampleAnimation(
  anim: INodeAnimation,
  timeMs: number,
): AnimatableProperties | null {
  const delay = anim.delay ?? 0;
  const iterations = anim.iterations ?? 1;
  const fillMode: FillMode = anim.fillMode ?? 'both';
  const totalDuration = anim.duration * iterations;

  // Before animation starts
  if (timeMs < delay) {
    if (fillMode === 'backwards' || fillMode === 'both') {
      return anim.keyframes[0].properties;
    }
    return null;
  }

  // After animation ends
  if (timeMs >= delay + totalDuration) {
    if (fillMode === 'forwards' || fillMode === 'both') {
      const lastKf = anim.keyframes[anim.keyframes.length - 1];
      if (anim.direction === 'alternate' || anim.direction === 'alternate-reverse') {
        const isEvenIteration = Math.floor(iterations) % 2 === 0;
        const isAlternateReverse = anim.direction === 'alternate-reverse';
        const reversed = isEvenIteration !== isAlternateReverse;
        return reversed ? anim.keyframes[0].properties : lastKf.properties;
      }
      if (anim.direction === 'reverse') return anim.keyframes[0].properties;
      return lastKf.properties;
    }
    return null;
  }

  // Active — compute iteration progress
  const elapsed = timeMs - delay;
  let iterationProgress = (elapsed % anim.duration) / anim.duration;
  const currentIteration = Math.floor(elapsed / anim.duration);

  // Handle direction
  const direction = anim.direction ?? 'normal';
  let reversed = false;
  if (direction === 'reverse') reversed = true;
  if (direction === 'alternate') reversed = currentIteration % 2 === 1;
  if (direction === 'alternate-reverse') reversed = currentIteration % 2 === 0;

  if (reversed) iterationProgress = 1 - iterationProgress;

  // Find the keyframe pair
  const keyframes = anim.keyframes;
  let fromIdx = 0;
  for (let i = 0; i < keyframes.length - 1; i++) {
    if (iterationProgress >= keyframes[i].offset) fromIdx = i;
  }
  const toIdx = Math.min(fromIdx + 1, keyframes.length - 1);

  const fromKf = keyframes[fromIdx];
  const toKf = keyframes[toIdx];

  // Local progress within this keyframe segment
  const segmentRange = toKf.offset - fromKf.offset;
  const segmentProgress = segmentRange > 0
    ? (iterationProgress - fromKf.offset) / segmentRange
    : 0;

  // Apply easing
  const easeFn = resolveEasing(fromKf.easing);
  const easedProgress = easeFn(segmentProgress);

  return interpolateProperties(fromKf.properties, toKf.properties, easedProgress);
}

/**
 * Sample the entire timeline at a given time.
 * Returns a map of nodeId → AnimatableProperties
 */
export function sampleTimeline(
  timeline: ITimeline,
  timeMs: number,
): Map<string, AnimatableProperties> {
  const result = new Map<string, AnimatableProperties>();
  const speed = timeline.speed ?? 1;
  const effectiveTime = timeMs * speed;

  for (const anim of timeline.animations) {
    const key = anim.nodeId ?? anim.nodeName ?? '';
    if (!key) continue;

    const props = sampleAnimation(anim, effectiveTime);
    if (!props) continue;

    // Merge with existing (later animations override)
    const existing = result.get(key);
    if (existing) {
      Object.assign(existing, props);
    } else {
      result.set(key, { ...props });
    }
  }

  return result;
}
