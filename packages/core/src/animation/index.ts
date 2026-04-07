/**
 * Animation module — timeline layer for INode trees.
 *
 * INode = single frame of visual intent.
 * ITimeline = how that frame changes over time.
 */

// Types
export type {
  Easing, EasingPreset, CubicBezier, SpringConfig,
  AnimatableProperties, AnimatableProperty,
  IKeyframe, INodeAnimation, ITimeline,
  FillMode, PlayDirection,
  AnimationPreset, ITimelineJSON,
} from './types.js';

// Easing
export { resolveEasing, easingToCss } from './easing.js';

// Timeline engine
export {
  computeDuration,
  validateTimeline,
  interpolateProperties,
  sampleAnimation,
  sampleTimeline,
} from './timeline.js';

// Presets
export {
  presets, getPreset, listPresets, stagger,
  fadeIn, fadeOut,
  slideInLeft, slideInRight, slideInUp, slideInDown,
  scaleIn, scaleOut, popIn,
  revealLeft, revealUp,
  pulse, shake, bounce, typewriter,
  colorShift, blurIn,
} from './presets.js';
