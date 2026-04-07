/**
 * Easing functions — convert normalized time (0–1) to progress (0–1).
 *
 * All functions: (t: number) => number where t ∈ [0,1]
 */

import type { Easing, EasingPreset, CubicBezier, SpringConfig } from './types.js';

// ─── Core easing functions ─────────────────────────────────────

export function linear(t: number): number { return t; }

// Quad
export function easeInQuad(t: number): number { return t * t; }
export function easeOutQuad(t: number): number { return t * (2 - t); }
export function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

// Cubic
export function easeInCubic(t: number): number { return t * t * t; }
export function easeOutCubic(t: number): number { return (--t) * t * t + 1; }
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
}

// Quart
export function easeInQuart(t: number): number { return t * t * t * t; }
export function easeOutQuart(t: number): number { return 1 - (--t) * t * t * t; }
export function easeInOutQuart(t: number): number {
  return t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t;
}

// Expo
export function easeInExpo(t: number): number {
  return t === 0 ? 0 : Math.pow(2, 10 * (t - 1));
}
export function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}
export function easeInOutExpo(t: number): number {
  if (t === 0 || t === 1) return t;
  return t < 0.5
    ? Math.pow(2, 20 * t - 10) / 2
    : (2 - Math.pow(2, -20 * t + 10)) / 2;
}

// Back (overshoot)
const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;

export function easeInBack(t: number): number {
  return c3 * t * t * t - c1 * t * t;
}
export function easeOutBack(t: number): number {
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
export function easeInOutBack(t: number): number {
  return t < 0.5
    ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
    : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
}

// Elastic
export function easeInElastic(t: number): number {
  if (t === 0 || t === 1) return t;
  return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * (2 * Math.PI / 3));
}
export function easeOutElastic(t: number): number {
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
}

// Bounce
export function easeOutBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}
export function easeInBounce(t: number): number {
  return 1 - easeOutBounce(1 - t);
}

// ─── CSS ease presets (cubic-bezier equivalents) ───────────────

function easeCss(t: number): number {
  return cubicBezierAt(0.25, 0.1, 0.25, 1.0, t);
}
function easeInCss(t: number): number {
  return cubicBezierAt(0.42, 0, 1.0, 1.0, t);
}
function easeOutCss(t: number): number {
  return cubicBezierAt(0, 0, 0.58, 1.0, t);
}
function easeInOutCss(t: number): number {
  return cubicBezierAt(0.42, 0, 0.58, 1.0, t);
}

// ─── Preset map ────────────────────────────────────────────────

type EasingFn = (t: number) => number;

const PRESET_MAP: Record<EasingPreset, EasingFn> = {
  'linear': linear,
  'ease': easeCss,
  'ease-in': easeInCss,
  'ease-out': easeOutCss,
  'ease-in-out': easeInOutCss,
  'ease-in-quad': easeInQuad,
  'ease-out-quad': easeOutQuad,
  'ease-in-out-quad': easeInOutQuad,
  'ease-in-cubic': easeInCubic,
  'ease-out-cubic': easeOutCubic,
  'ease-in-out-cubic': easeInOutCubic,
  'ease-in-quart': easeInQuart,
  'ease-out-quart': easeOutQuart,
  'ease-in-out-quart': easeInOutQuart,
  'ease-in-expo': easeInExpo,
  'ease-out-expo': easeOutExpo,
  'ease-in-out-expo': easeInOutExpo,
  'ease-in-back': easeInBack,
  'ease-out-back': easeOutBack,
  'ease-in-out-back': easeInOutBack,
  'ease-in-elastic': easeInElastic,
  'ease-out-elastic': easeOutElastic,
  'ease-in-bounce': easeInBounce,
  'ease-out-bounce': easeOutBounce,
};

// ─── CSS cubic-bezier string mapping ───────────────────────────

/** Map easing to CSS cubic-bezier() or keyword */
export function easingToCss(easing: Easing): string {
  if (typeof easing === 'string') {
    const CSS_KEYWORDS: Record<string, string> = {
      'linear': 'linear',
      'ease': 'ease',
      'ease-in': 'ease-in',
      'ease-out': 'ease-out',
      'ease-in-out': 'ease-in-out',
    };
    if (CSS_KEYWORDS[easing]) return CSS_KEYWORDS[easing];

    // Map named presets to cubic-bezier approximations
    const BEZIER_APPROX: Partial<Record<EasingPreset, string>> = {
      'ease-in-quad': 'cubic-bezier(0.55, 0.085, 0.68, 0.53)',
      'ease-out-quad': 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      'ease-in-out-quad': 'cubic-bezier(0.455, 0.03, 0.515, 0.955)',
      'ease-in-cubic': 'cubic-bezier(0.55, 0.055, 0.675, 0.19)',
      'ease-out-cubic': 'cubic-bezier(0.215, 0.61, 0.355, 1)',
      'ease-in-out-cubic': 'cubic-bezier(0.645, 0.045, 0.355, 1)',
      'ease-in-quart': 'cubic-bezier(0.895, 0.03, 0.685, 0.22)',
      'ease-out-quart': 'cubic-bezier(0.165, 0.84, 0.44, 1)',
      'ease-in-out-quart': 'cubic-bezier(0.77, 0, 0.175, 1)',
      'ease-in-expo': 'cubic-bezier(0.95, 0.05, 0.795, 0.035)',
      'ease-out-expo': 'cubic-bezier(0.19, 1, 0.22, 1)',
      'ease-in-out-expo': 'cubic-bezier(1, 0, 0, 1)',
      'ease-in-back': 'cubic-bezier(0.6, -0.28, 0.735, 0.045)',
      'ease-out-back': 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
      'ease-in-out-back': 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
    };
    return BEZIER_APPROX[easing] ?? 'ease';
  }

  if (Array.isArray(easing)) {
    return `cubic-bezier(${easing[0]}, ${easing[1]}, ${easing[2]}, ${easing[3]})`;
  }

  // Spring — approximate with cubic-bezier
  if (easing.type === 'spring') {
    return 'cubic-bezier(0.175, 0.885, 0.32, 1.275)';
  }

  return 'ease';
}

// ─── Resolve easing to function ────────────────────────────────

/** Resolve any Easing to a (t) => number function */
export function resolveEasing(easing: Easing | undefined): EasingFn {
  if (!easing) return PRESET_MAP['ease'];

  if (typeof easing === 'string') {
    return PRESET_MAP[easing] ?? PRESET_MAP['ease'];
  }

  if (Array.isArray(easing)) {
    const [x1, y1, x2, y2] = easing;
    return (t: number) => cubicBezierAt(x1, y1, x2, y2, t);
  }

  // Spring physics
  if (easing.type === 'spring') {
    return createSpringEasing(easing);
  }

  return PRESET_MAP['ease'];
}

// ─── Cubic Bezier solver ───────────────────────────────────────

function cubicBezierAt(x1: number, y1: number, x2: number, y2: number, t: number): number {
  // Newton-Raphson iteration to find t for x, then compute y
  let guessT = t;
  for (let i = 0; i < 8; i++) {
    const x = sampleCurve(x1, x2, guessT) - t;
    if (Math.abs(x) < 1e-6) break;
    const dx = sampleCurveDerivative(x1, x2, guessT);
    if (Math.abs(dx) < 1e-6) break;
    guessT -= x / dx;
  }
  return sampleCurve(y1, y2, guessT);
}

function sampleCurve(a: number, b: number, t: number): number {
  return ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t;
}

function sampleCurveDerivative(a: number, b: number, t: number): number {
  return (3 - 9 * b + 9 * a) * t * t + (6 * b - 12 * a) * t + 3 * a;
}

// ─── Spring physics ────────────────────────────────────────────

function createSpringEasing(config: SpringConfig): EasingFn {
  const { stiffness = 100, damping = 10, mass = 1 } = config;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));

  // Compute settle time — how long the spring takes to reach ~99% of target
  // This scales the simulation window to match the animation's actual duration
  const settleTime = zeta < 1
    ? -Math.log(0.01) / (zeta * w0)  // underdamped: exponential envelope
    : -Math.log(0.01) / w0;           // overdamped
  const simDuration = Math.min(Math.max(settleTime, 1), 10); // clamp 1–10s

  const samples = 200;
  const cache: number[] = new Array(samples + 1);

  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * simDuration;
    let value: number;
    if (zeta < 1) {
      // Underdamped — oscillates before settling
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      value = 1 - Math.exp(-zeta * w0 * t) * (
        Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t)
      );
    } else {
      // Critically/overdamped — smooth approach
      value = 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    }
    cache[i] = Math.min(1, Math.max(0, value));
  }

  return (t: number) => {
    const idx = t * samples;
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, samples);
    const frac = idx - lo;
    return cache[lo] * (1 - frac) + cache[hi] * frac;
  };
}
