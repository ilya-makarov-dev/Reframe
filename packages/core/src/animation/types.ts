/**
 * Animation Types — Timeline layer for INode trees.
 *
 * INode describes a single frame of visual intent.
 * ITimeline describes how those frames change over time.
 *
 * Design principle: INode stays minimal. Animation is a separate
 * data structure that references nodes by id or name.
 */

// ─── Easing ────────────────────────────────────────────────────

/** Named easing presets */
export type EasingPreset =
  | 'linear'
  | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out'
  | 'ease-in-quad' | 'ease-out-quad' | 'ease-in-out-quad'
  | 'ease-in-cubic' | 'ease-out-cubic' | 'ease-in-out-cubic'
  | 'ease-in-quart' | 'ease-out-quart' | 'ease-in-out-quart'
  | 'ease-in-expo' | 'ease-out-expo' | 'ease-in-out-expo'
  | 'ease-in-back' | 'ease-out-back' | 'ease-in-out-back'
  | 'ease-in-elastic' | 'ease-out-elastic'
  | 'ease-in-bounce' | 'ease-out-bounce';

/** Cubic bezier control points [x1, y1, x2, y2] */
export type CubicBezier = [number, number, number, number];

/** Spring physics parameters */
export interface SpringConfig {
  type: 'spring';
  stiffness: number;   // default 100
  damping: number;     // default 10
  mass: number;        // default 1
}

export type Easing = EasingPreset | CubicBezier | SpringConfig;

// ─── Animatable Properties ─────────────────────────────────────

/** Properties of INode/SceneNode that can be animated */
export interface AnimatableProperties {
  // Transform
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;

  // Visual
  opacity?: number;
  cornerRadius?: number;

  // Scale (CSS transform scale, not node resize)
  scaleX?: number;
  scaleY?: number;

  // Fills — animate color transitions
  fillColor?: { r: number; g: number; b: number; a: number };
  fillOpacity?: number;

  // Stroke
  strokeColor?: { r: number; g: number; b: number; a: number };
  strokeWeight?: number;
  strokeOpacity?: number;

  // Text
  fontSize?: number;
  letterSpacing?: number;

  // Effects — animate shadow
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowRadius?: number;
  shadowSpread?: number;
  shadowColor?: { r: number; g: number; b: number; a: number };

  // Blur
  blurRadius?: number;

  // Clip path (for reveal animations)
  clipInset?: { top: number; right: number; bottom: number; left: number };
}

/** All animatable property names */
export type AnimatableProperty = keyof AnimatableProperties;

// ─── Keyframe ──────────────────────────────────────────────────

/** A single keyframe: property values at a point in time */
export interface IKeyframe {
  /** Time offset, 0–1 normalized within the animation's duration */
  offset: number;
  /** Property values at this keyframe */
  properties: AnimatableProperties;
  /** Easing to use FROM this keyframe to the next (default: 'ease') */
  easing?: Easing;
}

// ─── Node Animation ────────────────────────────────────────────

/** Fill mode — what happens before/after animation */
export type FillMode = 'none' | 'forwards' | 'backwards' | 'both';

/** Play direction */
export type PlayDirection = 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';

/** Animation applied to a single node */
export interface INodeAnimation {
  /** Target node by id */
  nodeId?: string;
  /** Target node by name (fallback if nodeId not found) */
  nodeName?: string;
  /** Human-readable animation name */
  name?: string;

  /** Keyframes — must have at least 2, offsets 0 and 1 */
  keyframes: IKeyframe[];

  /** Duration in milliseconds */
  duration: number;
  /** Delay before start in milliseconds (default: 0) */
  delay?: number;
  /** Number of iterations (Infinity for loop, default: 1) */
  iterations?: number;
  /** Play direction (default: 'normal') */
  direction?: PlayDirection;
  /** Fill mode (default: 'both') */
  fillMode?: FillMode;
}

// ─── Timeline ──────────────────────────────────────────────────

/** A complete animation timeline for a scene */
export interface ITimeline {
  /** Timeline name */
  name?: string;
  /** Total duration in ms (derived from longest animation + delay if not set) */
  duration?: number;
  /** All node animations in this timeline */
  animations: INodeAnimation[];
  /** Global loop (default: false) */
  loop?: boolean;
  /** Playback speed multiplier (default: 1) */
  speed?: number;
}

// ─── Animation Preset ──────────────────────────────────────────

/** Preset animation that can be applied to any node */
export interface AnimationPreset {
  name: string;
  description: string;
  /** Creates keyframes for the preset with optional config */
  create: (config?: Record<string, any>) => Pick<INodeAnimation, 'keyframes' | 'duration' | 'direction' | 'fillMode'>;
}

// ─── Serialized format ─────────────────────────────────────────

/** JSON-safe timeline for storage/transport */
export interface ITimelineJSON {
  name?: string;
  duration?: number;
  loop?: boolean;
  speed?: number;
  animations: Array<{
    nodeId?: string;
    nodeName?: string;
    name?: string;
    keyframes: Array<{
      offset: number;
      properties: AnimatableProperties;
      easing?: Easing;
    }>;
    duration: number;
    delay?: number;
    iterations?: number;
    direction?: PlayDirection;
    fillMode?: FillMode;
  }>;
}
