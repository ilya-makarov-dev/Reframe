/**
 * INode Conformance Spec — Animation Specifications
 *
 * Each entry: scene + timeline → expected patterns in animated HTML and Lottie output.
 */

import type { AnimationSpec } from './types';
import { frame, rect, text, solid } from '../builder';

export const ANIMATION_SPECS: AnimationSpec[] = [

  // ── Basic opacity animation ─────────────────────────────

  {
    name: 'animation/fadeIn',
    scene: frame({ width: 400, height: 200 },
      rect({ name: 'box', x: 10, y: 10, width: 100, height: 100, fills: [solid('#FF0000')] }),
    ),
    timeline: {
      animations: [{
        nodeName: 'box',
        keyframes: [
          { offset: 0, properties: { opacity: 0 } },
          { offset: 1, properties: { opacity: 1 } },
        ],
        duration: 500,
      }],
    },
    html: ['@keyframes', 'opacity'],
    lottie: (json: string) => {
      const obj = JSON.parse(json);
      return obj.v === '5.7.4' && Array.isArray(obj.layers) && obj.layers.length > 0;
    },
  },

  // ── Slide animation with transform ──────────────────────

  {
    name: 'animation/slideIn',
    scene: frame({ width: 400, height: 200 },
      rect({ name: 'slider', x: 10, y: 10, width: 100, height: 100, fills: [solid('#0000FF')] }),
    ),
    timeline: {
      animations: [{
        nodeName: 'slider',
        keyframes: [
          { offset: 0, properties: { x: -100 } },
          { offset: 1, properties: { x: 10 } },
        ],
        duration: 800,
      }],
    },
    html: ['@keyframes', 'translate('],
  },

  // ── Custom easing ───────────────────────────────────────

  {
    name: 'animation/custom-easing',
    scene: frame({ width: 400, height: 200 },
      rect({ name: 'eased', x: 10, y: 10, width: 100, height: 100, fills: [solid('#00FF00')] }),
    ),
    timeline: {
      animations: [{
        nodeName: 'eased',
        keyframes: [
          { offset: 0, properties: { opacity: 0 }, easing: [0.42, 0, 0.58, 1] },
          { offset: 1, properties: { opacity: 1 } },
        ],
        duration: 600,
      }],
    },
    html: /cubic-bezier\(0\.42,\s*0,\s*0\.58,\s*1\)/,
  },

  // ── Multi-property animation ────────────────────────────

  {
    name: 'animation/multi-property',
    scene: frame({ width: 400, height: 200 },
      rect({ name: 'multi', x: 50, y: 50, width: 80, height: 80, fills: [solid('#FF6600')] }),
    ),
    timeline: {
      animations: [{
        nodeName: 'multi',
        keyframes: [
          { offset: 0, properties: { opacity: 0, rotation: 0, scaleX: 0.5, scaleY: 0.5 } },
          { offset: 1, properties: { opacity: 1, rotation: 360, scaleX: 1, scaleY: 1 } },
        ],
        duration: 1000,
      }],
    },
    html: ['@keyframes', 'opacity', 'rotate', 'scale'],
  },

  // ── Delay and iterations ────────────────────────────────

  {
    name: 'animation/delay-iterations',
    scene: frame({ width: 400, height: 200 },
      rect({ name: 'repeater', x: 10, y: 10, width: 100, height: 100, fills: [solid('#9900FF')] }),
    ),
    timeline: {
      animations: [{
        nodeName: 'repeater',
        keyframes: [
          { offset: 0, properties: { opacity: 0.5 } },
          { offset: 1, properties: { opacity: 1 } },
        ],
        duration: 500,
        delay: 200,
        iterations: 3,
      }],
    },
    html: (output: string) => output.includes('200ms') && output.includes(' 3 '),
  },

  // ── Alternate direction ─────────────────────────────────

  {
    name: 'animation/alternate-direction',
    scene: frame({ width: 400, height: 200 },
      rect({ name: 'bouncer', x: 10, y: 10, width: 100, height: 100, fills: [solid('#FF0099')] }),
    ),
    timeline: {
      animations: [{
        nodeName: 'bouncer',
        keyframes: [
          { offset: 0, properties: { y: 10 } },
          { offset: 1, properties: { y: 80 } },
        ],
        duration: 800,
        iterations: Infinity,
        direction: 'alternate',
      }],
    },
    html: ['alternate', 'infinite'],
  },

  // ── Multiple nodes animated ─────────────────────────────

  {
    name: 'animation/stagger-multiple',
    scene: frame({ width: 400, height: 200 },
      rect({ name: 'a', x: 10, y: 10, width: 80, height: 80, fills: [solid('#FF0000')] }),
      rect({ name: 'b', x: 110, y: 10, width: 80, height: 80, fills: [solid('#00FF00')] }),
      rect({ name: 'c', x: 210, y: 10, width: 80, height: 80, fills: [solid('#0000FF')] }),
    ),
    timeline: {
      animations: [
        { nodeName: 'a', keyframes: [{ offset: 0, properties: { opacity: 0 } }, { offset: 1, properties: { opacity: 1 } }], duration: 300, delay: 0 },
        { nodeName: 'b', keyframes: [{ offset: 0, properties: { opacity: 0 } }, { offset: 1, properties: { opacity: 1 } }], duration: 300, delay: 100 },
        { nodeName: 'c', keyframes: [{ offset: 0, properties: { opacity: 0 } }, { offset: 1, properties: { opacity: 1 } }], duration: 300, delay: 200 },
      ],
    },
    html: (output: string) => {
      // Should have 3 different @keyframes rules
      const keyframeCount = (output.match(/@keyframes/g) || []).length;
      return keyframeCount >= 3;
    },
    lottie: (json: string) => {
      const obj = JSON.parse(json);
      return obj.layers && obj.layers.length >= 3;
    },
  },

  // ── Lottie version and structure ────────────────────────

  {
    name: 'animation/lottie-structure',
    scene: frame({ width: 300, height: 250 },
      text('Hello', { name: 'title', x: 10, y: 10, width: 280, height: 40, fontSize: 24 }),
    ),
    timeline: {
      animations: [{
        nodeName: 'title',
        keyframes: [
          { offset: 0, properties: { opacity: 0 } },
          { offset: 1, properties: { opacity: 1 } },
        ],
        duration: 1000,
      }],
    },
    lottie: (json: string) => {
      const obj = JSON.parse(json);
      return obj.v === '5.7.4' &&
        obj.w === 300 && obj.h === 250 &&
        typeof obj.fr === 'number' && obj.fr > 0 &&
        typeof obj.ip === 'number' &&
        typeof obj.op === 'number' &&
        obj.op > obj.ip;
    },
  },

  // ── Three-keyframe animation ────────────────────────────

  {
    name: 'animation/three-keyframes',
    scene: frame({ width: 400, height: 200 },
      rect({ name: 'tri', x: 10, y: 10, width: 100, height: 100, fills: [solid('#FF0000')] }),
    ),
    timeline: {
      animations: [{
        nodeName: 'tri',
        keyframes: [
          { offset: 0, properties: { opacity: 0 } },
          { offset: 0.5, properties: { opacity: 1 } },
          { offset: 1, properties: { opacity: 0.3 } },
        ],
        duration: 1000,
      }],
    },
    html: (output: string) => {
      // Should have 3 stops: 0%, 50%, 100%
      return output.includes('0%') && output.includes('50%') && output.includes('100%');
    },
  },

  // ── Spring easing (should not crash) ────────────────────

  {
    name: 'animation/spring-easing',
    scene: frame({ width: 400, height: 200 },
      rect({ name: 'spring', x: 10, y: 10, width: 100, height: 100, fills: [solid('#00FF00')] }),
    ),
    timeline: {
      animations: [{
        nodeName: 'spring',
        keyframes: [
          { offset: 0, properties: { y: 0 }, easing: { type: 'spring', stiffness: 300, damping: 20, mass: 1 } },
          { offset: 1, properties: { y: 100 } },
        ],
        duration: 800,
      }],
    },
    // Spring easing should produce valid HTML without crashing
    html: '@keyframes',
    lottie: (json: string) => {
      const obj = JSON.parse(json);
      return obj.v === '5.7.4' && Array.isArray(obj.layers);
    },
  },

  // ── Fill mode forwards ──────────────────────────────────

  {
    name: 'animation/fill-mode',
    scene: frame({ width: 400, height: 200 },
      rect({ name: 'filled', x: 10, y: 10, width: 100, height: 100, fills: [solid('#FFCC00')] }),
    ),
    timeline: {
      animations: [{
        nodeName: 'filled',
        keyframes: [
          { offset: 0, properties: { opacity: 0 } },
          { offset: 1, properties: { opacity: 1 } },
        ],
        duration: 400,
        fillMode: 'forwards',
      }],
    },
    html: 'forwards',
  },

  // ── Scale animation ─────────────────────────────────────

  {
    name: 'animation/scale-transform',
    scene: frame({ width: 400, height: 200 },
      rect({ name: 'scaler', x: 50, y: 50, width: 100, height: 100, fills: [solid('#9900FF')] }),
    ),
    timeline: {
      animations: [{
        nodeName: 'scaler',
        keyframes: [
          { offset: 0, properties: { scaleX: 0, scaleY: 0 } },
          { offset: 1, properties: { scaleX: 1, scaleY: 1 } },
        ],
        duration: 600,
      }],
    },
    html: ['@keyframes', 'scale'],
  },
];
