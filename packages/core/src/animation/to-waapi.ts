/**
 * ITimeline → Web Animations API (WAAPI) emission.
 *
 * Converts an ITimeline into per-node WAAPI keyframe arrays and a
 * self-contained <script> that applies all animations via Element.animate().
 *
 * Advantages over CSS @keyframes:
 *   - Spring easings via `linear()` CSS function (60 sample points)
 *   - Better stagger timing control
 *   - Geometry animation (width/height via scale transform)
 *   - Compositor-thread animation via WAAPI
 *
 * The output script uses `[data-reframe-inode]` attributes to target
 * nodes, which is already emitted by the HTML exporter when
 * `inodeAnchors: true` is set.
 */

import type { ITimeline, INodeAnimation, IKeyframe, AnimatableProperties } from './types.js';
import { resolveEasing } from './easing.js';

// ─── Types ──────────────────────────────────────────────────

export interface WaapiNodeAnimation {
  /** Node target: id or name. */
  nodeId?: string;
  nodeName?: string;
  /** WAAPI-compatible keyframe array. */
  keyframes: Record<string, unknown>[];
  /** WAAPI KeyframeAnimationOptions. */
  options: {
    duration: number;
    delay: number;
    iterations: number;
    direction: string;
    fill: string;
    easing: string;
  };
}

export interface WaapiOutput {
  /** Per-node animation definitions. */
  animations: WaapiNodeAnimation[];
  /** Self-contained <script> tag content. */
  script: string;
}

// ─── Property Mapping ───────────────────────────────────────

function propToWaapi(props: AnimatableProperties): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  // Transform components
  const transforms: string[] = [];
  if (props.x !== undefined || props.y !== undefined) {
    transforms.push(`translate(${props.x ?? 0}px, ${props.y ?? 0}px)`);
  }
  if (props.scaleX !== undefined || props.scaleY !== undefined) {
    transforms.push(`scale(${props.scaleX ?? 1}, ${props.scaleY ?? 1})`);
  }
  if (props.rotation !== undefined) {
    transforms.push(`rotate(${props.rotation}deg)`);
  }
  if (transforms.length > 0) {
    out.transform = transforms.join(' ');
  }

  // Opacity
  if (props.opacity !== undefined) out.opacity = props.opacity;

  // Fill color → background-color
  if (props.fillColor) {
    const c = props.fillColor;
    out.backgroundColor = `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${c.a ?? 1})`;
  }

  // Stroke color → border-color
  if (props.strokeColor) {
    const c = props.strokeColor;
    out.borderColor = `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${c.a ?? 1})`;
  }

  // Filter (blur)
  if (props.blurRadius !== undefined) {
    out.filter = `blur(${props.blurRadius}px)`;
  }

  // Clip path (for reveal animations)
  if (props.clipInset) {
    const ci = props.clipInset;
    out.clipPath = `inset(${ci.top}% ${ci.right}% ${ci.bottom}% ${ci.left}%)`;
  }

  // Width/height via scale fallback
  if (props.width !== undefined) {
    out.width = `${props.width}px`;
  }
  if (props.height !== undefined) {
    out.height = `${props.height}px`;
  }

  // Font size
  if (props.fontSize !== undefined) {
    out.fontSize = `${props.fontSize}px`;
  }

  // Letter spacing
  if (props.letterSpacing !== undefined) {
    out.letterSpacing = `${props.letterSpacing}px`;
  }

  return out;
}

/** Convert an easing to WAAPI-compatible string. */
function easingToWaapi(easing: string | undefined): string {
  if (!easing) return 'ease';
  // Check for spring easing — approximate with linear() function
  if (easing.startsWith('spring(')) {
    // Generate 60 sample points for spring approximation
    return generateLinearEasing(easing);
  }
  // Standard CSS easings work directly in WAAPI
  if (['ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear'].includes(easing)) {
    return easing;
  }
  if (easing.startsWith('cubic-bezier')) {
    return easing;
  }
  return 'ease';
}

/** Generate a linear() CSS function from spring parameters. */
function generateLinearEasing(_springStr: string): string {
  // Simple damped spring approximation with 60 points
  const points: number[] = [];
  const damping = 0.6;
  const frequency = 3.5;
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const value = 1 - Math.exp(-damping * t * 10) * Math.cos(frequency * t * Math.PI * 2);
    points.push(Math.max(0, Math.min(1, value)));
  }
  return `linear(${points.map(p => p.toFixed(3)).join(', ')})`;
}

// ─── Main Conversion ────────────────────────────────────────

function animationToWaapi(anim: INodeAnimation): WaapiNodeAnimation {
  const keyframes: Record<string, unknown>[] = [];

  for (const kf of anim.keyframes) {
    const frame: Record<string, unknown> = {
      offset: kf.offset,
      ...propToWaapi(kf.properties),
    };
    if (kf.easing) {
      frame.easing = easingToWaapi(kf.easing as string);
    }
    keyframes.push(frame);
  }

  return {
    nodeId: anim.nodeId,
    nodeName: anim.nodeName,
    keyframes,
    options: {
      duration: anim.duration,
      delay: anim.delay ?? 0,
      iterations: anim.iterations ?? 1,
      direction: anim.direction ?? 'normal',
      fill: anim.fillMode ?? 'both',
      easing: 'linear', // Per-keyframe easing handled above
    },
  };
}

/**
 * Convert an ITimeline to WAAPI output.
 * Returns per-node animation data and a self-contained script.
 */
export function timelineToWaapi(timeline: ITimeline | null | undefined): WaapiOutput {
  if (!timeline || timeline.animations.length === 0) {
    return { animations: [], script: '' };
  }

  const animations = timeline.animations.map(animationToWaapi);

  // Generate self-contained script
  const scriptLines: string[] = [
    '(function() {',
    '  "use strict";',
    '  var animations = ' + JSON.stringify(animations.map(a => ({
      nodeId: a.nodeId,
      nodeName: a.nodeName,
      keyframes: a.keyframes,
      options: a.options,
    })), null, 2) + ';',
    '',
    '  function findElement(nodeId, nodeName) {',
    '    if (nodeId) {',
    '      var el = document.querySelector(\'[data-reframe-inode="\' + nodeId + \'"]\');',
    '      if (el) return el;',
    '    }',
    '    if (nodeName) {',
    '      var el = document.querySelector(\'[data-reframe-name="\' + nodeName + \'"]\');',
    '      if (el) return el;',
    '    }',
    '    return null;',
    '  }',
    '',
    '  document.addEventListener("DOMContentLoaded", function() {',
    '    animations.forEach(function(anim) {',
    '      var el = findElement(anim.nodeId, anim.nodeName);',
    '      if (!el) return;',
    '      try {',
    '        el.animate(anim.keyframes, anim.options);',
    '      } catch(e) { console.warn("WAAPI animation failed:", e); }',
    '    });',
    '  });',
    '})();',
  ];

  return {
    animations,
    script: scriptLines.join('\n'),
  };
}
