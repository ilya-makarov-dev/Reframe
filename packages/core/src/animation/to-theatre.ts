/**
 * ITimeline → Theatre.js project JSON export.
 *
 * Converts an ITimeline into a Theatre.js project structure that can be
 * imported into Theatre.js Studio for fine-tuning animations.
 *
 * Theatre.js model:
 *   Project → Sheet → Object → Props (keyframed values)
 *
 * Each INodeAnimation maps to one Theatre.js Object with keyframed props.
 */

import type { ITimeline, INodeAnimation, AnimatableProperties } from './types.js';

// ─── Types ──────────────────────────────────────────────────

export interface TheatreProject {
  /** Theatre.js project name. */
  name: string;
  /** Sheets in the project (one per timeline). */
  sheets: TheatreSheet[];
}

export interface TheatreSheet {
  /** Sheet name. */
  name: string;
  /** Duration in seconds. */
  length: number;
  /** Objects (one per animated node). */
  objects: TheatreObject[];
}

export interface TheatreObject {
  /** Object path (e.g., "Hero Title"). */
  path: string;
  /** Keyframed properties. */
  props: Record<string, TheatreKeyframes>;
}

export interface TheatreKeyframes {
  /** Keyframe list for one property. */
  keyframes: Array<{
    /** Position in seconds. */
    position: number;
    /** Value at this keyframe. */
    value: number | string;
    /** Easing to next keyframe. */
    type?: 'bezier' | 'hold';
  }>;
}

// ─── Conversion ─────────────────────────────────────────────

function animToTheatreObject(anim: INodeAnimation, duration: number): TheatreObject {
  const path = anim.nodeName ?? anim.nodeId ?? 'Unnamed';
  const props: Record<string, TheatreKeyframes> = {};

  // Collect all animated properties across keyframes
  const allProps = new Set<string>();
  for (const kf of anim.keyframes) {
    for (const key of Object.keys(kf.properties)) {
      allProps.add(key);
    }
  }

  // Build keyframe tracks per property
  for (const propName of allProps) {
    const keyframes: TheatreKeyframes['keyframes'] = [];

    for (const kf of anim.keyframes) {
      const value = (kf.properties as Record<string, unknown>)[propName];
      if (value === undefined) continue;

      // Convert to Theatre.js-compatible value
      let theatreValue: number | string;
      if (typeof value === 'number') {
        theatreValue = value;
      } else if (typeof value === 'object' && value !== null && 'r' in value) {
        // Color → hex string
        const c = value as { r: number; g: number; b: number };
        theatreValue = `#${Math.round(c.r * 255).toString(16).padStart(2, '0')}${Math.round(c.g * 255).toString(16).padStart(2, '0')}${Math.round(c.b * 255).toString(16).padStart(2, '0')}`;
      } else {
        theatreValue = String(value);
      }

      keyframes.push({
        position: kf.offset * (duration / 1000), // Convert offset 0-1 to seconds
        value: theatreValue,
        type: 'bezier',
      });
    }

    if (keyframes.length > 0) {
      props[propName] = { keyframes };
    }
  }

  return { path, props };
}

/**
 * Convert an ITimeline to Theatre.js project JSON.
 */
export function timelineToTheatre(
  timeline: ITimeline | null | undefined,
  projectName?: string,
): TheatreProject | null {
  if (!timeline || timeline.animations.length === 0) return null;

  // Compute total duration
  let maxDuration = timeline.duration ?? 0;
  if (!maxDuration) {
    for (const anim of timeline.animations) {
      const end = (anim.delay ?? 0) + anim.duration;
      if (end > maxDuration) maxDuration = end;
    }
  }

  const objects = timeline.animations.map(anim =>
    animToTheatreObject(anim, anim.duration)
  );

  return {
    name: projectName ?? timeline.name ?? 'Reframe Animation',
    sheets: [{
      name: 'Main',
      length: maxDuration / 1000, // Convert ms to seconds
      objects,
    }],
  };
}
