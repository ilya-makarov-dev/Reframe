/**
 * Animation Presets — common animations ready to apply.
 *
 * Usage:
 *   const fadeIn = presets.fadeIn.create({ duration: 500 });
 *   timeline.animations.push({ nodeId: 'hero', ...fadeIn });
 */

import type { AnimationPreset, INodeAnimation, IKeyframe } from './types.js';

// ─── Fade ──────────────────────────────────────────────────────

export const fadeIn: AnimationPreset = {
  name: 'fadeIn',
  description: 'Fade from transparent to visible',
  create: (config = {}) => ({
    keyframes: [
      { offset: 0, properties: { opacity: 0 }, easing: config.easing ?? 'ease-out' },
      { offset: 1, properties: { opacity: 1 } },
    ],
    duration: config.duration ?? 600,
    fillMode: 'both',
  }),
};

export const fadeOut: AnimationPreset = {
  name: 'fadeOut',
  description: 'Fade from visible to transparent',
  create: (config = {}) => ({
    keyframes: [
      { offset: 0, properties: { opacity: 1 }, easing: config.easing ?? 'ease-in' },
      { offset: 1, properties: { opacity: 0 } },
    ],
    duration: config.duration ?? 600,
    fillMode: 'both',
  }),
};

// ─── Slide ─────────────────────────────────────────────────────

export const slideInLeft: AnimationPreset = {
  name: 'slideInLeft',
  description: 'Slide in from the left with fade',
  create: (config = {}) => {
    const distance = config.distance ?? 60;
    return {
      keyframes: [
        { offset: 0, properties: { x: -distance, opacity: 0 }, easing: config.easing ?? 'ease-out-cubic' },
        { offset: 1, properties: { x: 0, opacity: 1 } },
      ],
      duration: config.duration ?? 700,
      fillMode: 'both',
    };
  },
};

export const slideInRight: AnimationPreset = {
  name: 'slideInRight',
  description: 'Slide in from the right with fade',
  create: (config = {}) => {
    const distance = config.distance ?? 60;
    return {
      keyframes: [
        { offset: 0, properties: { x: distance, opacity: 0 }, easing: config.easing ?? 'ease-out-cubic' },
        { offset: 1, properties: { x: 0, opacity: 1 } },
      ],
      duration: config.duration ?? 700,
      fillMode: 'both',
    };
  },
};

export const slideInUp: AnimationPreset = {
  name: 'slideInUp',
  description: 'Slide in from below with fade',
  create: (config = {}) => {
    const distance = config.distance ?? 40;
    return {
      keyframes: [
        { offset: 0, properties: { y: distance, opacity: 0 }, easing: config.easing ?? 'ease-out-cubic' },
        { offset: 1, properties: { y: 0, opacity: 1 } },
      ],
      duration: config.duration ?? 700,
      fillMode: 'both',
    };
  },
};

export const slideInDown: AnimationPreset = {
  name: 'slideInDown',
  description: 'Slide in from above with fade',
  create: (config = {}) => {
    const distance = config.distance ?? 40;
    return {
      keyframes: [
        { offset: 0, properties: { y: -distance, opacity: 0 }, easing: config.easing ?? 'ease-out-cubic' },
        { offset: 1, properties: { y: 0, opacity: 1 } },
      ],
      duration: config.duration ?? 700,
      fillMode: 'both',
    };
  },
};

// ─── Scale ─────────────────────────────────────────────────────

export const scaleIn: AnimationPreset = {
  name: 'scaleIn',
  description: 'Scale up from zero with fade',
  create: (config = {}) => ({
    keyframes: [
      { offset: 0, properties: { scaleX: 0, scaleY: 0, opacity: 0 }, easing: config.easing ?? 'ease-out-back' },
      { offset: 1, properties: { scaleX: 1, scaleY: 1, opacity: 1 } },
    ],
    duration: config.duration ?? 500,
    fillMode: 'both',
  }),
};

export const scaleOut: AnimationPreset = {
  name: 'scaleOut',
  description: 'Scale down to zero with fade',
  create: (config = {}) => ({
    keyframes: [
      { offset: 0, properties: { scaleX: 1, scaleY: 1, opacity: 1 }, easing: config.easing ?? 'ease-in-back' },
      { offset: 1, properties: { scaleX: 0, scaleY: 0, opacity: 0 } },
    ],
    duration: config.duration ?? 500,
    fillMode: 'both',
  }),
};

export const popIn: AnimationPreset = {
  name: 'popIn',
  description: 'Pop in with elastic overshoot',
  create: (config = {}) => ({
    keyframes: [
      { offset: 0, properties: { scaleX: 0, scaleY: 0, opacity: 0 }, easing: 'ease-out-elastic' },
      { offset: 1, properties: { scaleX: 1, scaleY: 1, opacity: 1 } },
    ],
    duration: config.duration ?? 800,
    fillMode: 'both',
  }),
};

// ─── Reveal ────────────────────────────────────────────────────

export const revealLeft: AnimationPreset = {
  name: 'revealLeft',
  description: 'Reveal by sliding clip from left to right',
  create: (config = {}) => ({
    keyframes: [
      { offset: 0, properties: { clipInset: { top: 0, right: 100, bottom: 0, left: 0 } }, easing: config.easing ?? 'ease-in-out-cubic' },
      { offset: 1, properties: { clipInset: { top: 0, right: 0, bottom: 0, left: 0 } } },
    ],
    duration: config.duration ?? 800,
    fillMode: 'both',
  }),
};

export const revealUp: AnimationPreset = {
  name: 'revealUp',
  description: 'Reveal by sliding clip from bottom to top',
  create: (config = {}) => ({
    keyframes: [
      { offset: 0, properties: { clipInset: { top: 100, right: 0, bottom: 0, left: 0 } }, easing: config.easing ?? 'ease-in-out-cubic' },
      { offset: 1, properties: { clipInset: { top: 0, right: 0, bottom: 0, left: 0 } } },
    ],
    duration: config.duration ?? 800,
    fillMode: 'both',
  }),
};

// ─── Attention ─────────────────────────────────────────────────

export const pulse: AnimationPreset = {
  name: 'pulse',
  description: 'Gentle scale pulse (loop-friendly)',
  create: (config = {}) => ({
    keyframes: [
      { offset: 0, properties: { scaleX: 1, scaleY: 1 }, easing: 'ease-in-out' },
      { offset: 0.5, properties: { scaleX: 1.05, scaleY: 1.05 }, easing: 'ease-in-out' },
      { offset: 1, properties: { scaleX: 1, scaleY: 1 } },
    ],
    duration: config.duration ?? 1500,
    direction: 'normal',
    fillMode: 'none',
  }),
};

export const shake: AnimationPreset = {
  name: 'shake',
  description: 'Horizontal shake',
  create: (config = {}) => {
    const d = config.distance ?? 8;
    return {
      keyframes: [
        { offset: 0, properties: { x: 0 }, easing: 'linear' },
        { offset: 0.1, properties: { x: -d } },
        { offset: 0.3, properties: { x: d } },
        { offset: 0.5, properties: { x: -d } },
        { offset: 0.7, properties: { x: d } },
        { offset: 0.9, properties: { x: -d } },
        { offset: 1, properties: { x: 0 } },
      ],
      duration: config.duration ?? 600,
      fillMode: 'none',
    };
  },
};

export const bounce: AnimationPreset = {
  name: 'bounce',
  description: 'Bouncing entrance',
  create: (config = {}) => ({
    keyframes: [
      { offset: 0, properties: { y: -30, opacity: 0 }, easing: 'ease-out-bounce' },
      { offset: 1, properties: { y: 0, opacity: 1 } },
    ],
    duration: config.duration ?? 1000,
    fillMode: 'both',
  }),
};

export const typewriter: AnimationPreset = {
  name: 'typewriter',
  description: 'Reveal text with clip from left (typewriter effect)',
  create: (config = {}) => ({
    keyframes: [
      { offset: 0, properties: { clipInset: { top: 0, right: 100, bottom: 0, left: 0 } }, easing: 'linear' },
      { offset: 1, properties: { clipInset: { top: 0, right: 0, bottom: 0, left: 0 } } },
    ],
    duration: config.duration ?? 2000,
    fillMode: 'both',
  }),
};

// ─── Color ─────────────────────────────────────────────────────

export const colorShift: AnimationPreset = {
  name: 'colorShift',
  description: 'Animate between two fill colors',
  create: (config = {}) => {
    const from = config.from ?? { r: 1, g: 0, b: 0, a: 1 };
    const to = config.to ?? { r: 0, g: 0, b: 1, a: 1 };
    return {
      keyframes: [
        { offset: 0, properties: { fillColor: from }, easing: config.easing ?? 'ease-in-out' },
        { offset: 1, properties: { fillColor: to } },
      ],
      duration: config.duration ?? 1000,
      fillMode: 'both',
    };
  },
};

// ─── Blur ──────────────────────────────────────────────────────

export const blurIn: AnimationPreset = {
  name: 'blurIn',
  description: 'Fade in from blurred state',
  create: (config = {}) => ({
    keyframes: [
      { offset: 0, properties: { blurRadius: config.blur ?? 20, opacity: 0 }, easing: config.easing ?? 'ease-out' },
      { offset: 1, properties: { blurRadius: 0, opacity: 1 } },
    ],
    duration: config.duration ?? 700,
    fillMode: 'both',
  }),
};

// ─── Compound presets (multiple properties) ───────────────────

export const fadeSlideUp: AnimationPreset = {
  name: 'fadeSlideUp',
  description: 'Fade in while sliding up — classic entrance',
  create: (config = {}) => ({
    keyframes: [
      { offset: 0, properties: { opacity: 0, y: config.distance ?? 40 }, easing: config.easing ?? 'ease-out-cubic' },
      { offset: 1, properties: { opacity: 1, y: 0 } },
    ],
    duration: config.duration ?? 600,
    fillMode: 'both',
  }),
};

export const fadeSlideDown: AnimationPreset = {
  name: 'fadeSlideDown',
  description: 'Fade in while sliding down',
  create: (config = {}) => ({
    keyframes: [
      { offset: 0, properties: { opacity: 0, y: -(config.distance ?? 40) }, easing: config.easing ?? 'ease-out-cubic' },
      { offset: 1, properties: { opacity: 1, y: 0 } },
    ],
    duration: config.duration ?? 600,
    fillMode: 'both',
  }),
};

export const fadeSlideLeft: AnimationPreset = {
  name: 'fadeSlideLeft',
  description: 'Fade in while sliding from left',
  create: (config = {}) => ({
    keyframes: [
      { offset: 0, properties: { opacity: 0, x: -(config.distance ?? 60) }, easing: config.easing ?? 'ease-out-cubic' },
      { offset: 1, properties: { opacity: 1, x: 0 } },
    ],
    duration: config.duration ?? 600,
    fillMode: 'both',
  }),
};

export const fadeSlideRight: AnimationPreset = {
  name: 'fadeSlideRight',
  description: 'Fade in while sliding from right',
  create: (config = {}) => ({
    keyframes: [
      { offset: 0, properties: { opacity: 0, x: config.distance ?? 60 }, easing: config.easing ?? 'ease-out-cubic' },
      { offset: 1, properties: { opacity: 1, x: 0 } },
    ],
    duration: config.duration ?? 600,
    fillMode: 'both',
  }),
};

export const fadeScaleIn: AnimationPreset = {
  name: 'fadeScaleIn',
  description: 'Fade in with scale-up — attention-grabbing entrance',
  create: (config = {}) => ({
    keyframes: [
      { offset: 0, properties: { opacity: 0, scaleX: config.startScale ?? 0.8, scaleY: config.startScale ?? 0.8 }, easing: config.easing ?? 'ease-out-back' },
      { offset: 1, properties: { opacity: 1, scaleX: 1, scaleY: 1 } },
    ],
    duration: config.duration ?? 500,
    fillMode: 'both',
  }),
};

// ─── Preset registry ───────────────────────────────────────────

export const presets: Record<string, AnimationPreset> = {
  fadeIn, fadeOut,
  slideInLeft, slideInRight, slideInUp, slideInDown,
  scaleIn, scaleOut, popIn,
  revealLeft, revealUp,
  pulse, shake, bounce, typewriter,
  colorShift, blurIn,
  fadeSlideUp, fadeSlideDown, fadeSlideLeft, fadeSlideRight, fadeScaleIn,
};

/** Get a preset by name */
export function getPreset(name: string): AnimationPreset | undefined {
  return presets[name];
}

/** List all available preset names */
export function listPresets(): string[] {
  return Object.keys(presets);
}

// ─── Timeline Builder ──────────────────────────────────────────

/**
 * Build a staggered animation timeline from presets.
 * Applies the same preset to multiple nodes with automatic stagger delay.
 */
export function stagger(
  nodeIds: string[],
  presetName: string,
  options: {
    staggerDelay?: number;
    duration?: number;
    baseDelay?: number;
    config?: Record<string, any>;
  } = {},
): Array<Pick<INodeAnimation, 'nodeId' | 'keyframes' | 'duration' | 'delay' | 'fillMode' | 'direction'>> {
  const preset = presets[presetName];
  if (!preset) throw new Error(`Unknown preset: ${presetName}`);

  const { staggerDelay = 100, baseDelay = 0, config = {} } = options;
  if (options.duration) config.duration = options.duration;

  const base = preset.create(config);

  return nodeIds.map((nodeId, i) => ({
    nodeId,
    ...base,
    delay: baseDelay + i * staggerDelay,
  }));
}
