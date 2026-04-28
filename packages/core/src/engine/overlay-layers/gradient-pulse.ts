/**
 * gradient-pulse layer — slow color shift across the canvas.
 *
 * Renders a linear or radial gradient whose stops cycle through the
 * configured palette over `cycle` ms. Reads as ambient mood lighting
 * — Stripe payment-page hero treatment for "this isn't static".
 *
 * Config:
 *   colors: hex[]                                  default ['#1a1a2e', '#16213e', '#0f3460']
 *   cycle:  number ms                              default 8000
 *   direction: 'horizontal'|'vertical'|'radial'    default 'horizontal'
 *
 * Determinism: phase starts at 0 (no random startup variance). Two
 * mounts at t=0 → identical first frame.
 */

import type { JsonValue } from '../composition.js';
import type { LayerImpl, LayerValidationResult } from './types.js';
import { readNumber, readEnum, readColorArray, isHexColor } from './utils.js';

const DIRECTIONS = ['horizontal', 'vertical', 'radial'] as const;
const DEFAULT_COLORS = ['#1a1a2e', '#16213e', '#0f3460'];

function validate(config: Record<string, JsonValue>): LayerValidationResult {
  const colorsRaw = config.colors;
  if (colorsRaw !== undefined && colorsRaw !== null) {
    if (!Array.isArray(colorsRaw)) {
      return { ok: false, param: 'colors', message: 'must be an array of hex strings' };
    }
    if (colorsRaw.length < 2) {
      return { ok: false, param: 'colors', message: 'must contain at least 2 colors' };
    }
    for (let i = 0; i < colorsRaw.length; i++) {
      if (!isHexColor(colorsRaw[i])) {
        return { ok: false, param: 'colors', message: `colors[${i}] must be a hex color (#abc or #aabbcc)` };
      }
    }
  }
  const cycleRaw = config.cycle;
  if (cycleRaw !== undefined && cycleRaw !== null) {
    if (typeof cycleRaw !== 'number' || !Number.isFinite(cycleRaw) || cycleRaw < 100) {
      return { ok: false, param: 'cycle', message: 'must be a finite number ≥ 100 (ms)' };
    }
  }
  const directionRaw = config.direction;
  if (directionRaw !== undefined && directionRaw !== null) {
    if (typeof directionRaw !== 'string' || !DIRECTIONS.includes(directionRaw as typeof DIRECTIONS[number])) {
      return { ok: false, param: 'direction', message: `must be one of ${DIRECTIONS.join(', ')}` };
    }
  }
  return {
    ok: true,
    resolved: {
      colors: readColorArray(config, 'colors', DEFAULT_COLORS),
      cycle: readNumber(config, 'cycle', 8000, 100),
      direction: readEnum(config, 'direction', DIRECTIONS, 'horizontal'),
    },
  };
}

const BROWSER_SOURCE = `
function factory_gradient_pulse(canvas, config, baseSize, layerId) {
  var ctx = canvas.getContext('2d');
  var colors = (Array.isArray(config.colors) && config.colors.length >= 2) ? config.colors.slice() : ['#1a1a2e', '#16213e', '#0f3460'];
  var cycle = typeof config.cycle === 'number' && config.cycle >= 100 ? config.cycle : 8000;
  var direction = config.direction || 'horizontal';
  var w = canvas.width, h = canvas.height;

  function colorAtPhase(phase) {
    // phase ∈ [0, 1) → interp between adjacent colors in cycling palette.
    var n = colors.length;
    var scaled = phase * n;
    var i = Math.floor(scaled) % n;
    var t = scaled - Math.floor(scaled);
    var rgb = lerpColor(colors[i], colors[(i + 1) % n], t);
    return 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')';
  }

  return {
    render: function(ctx2, time) {
      var phase = (time % cycle) / cycle;
      var c1 = colorAtPhase(phase);
      var c2 = colorAtPhase((phase + 0.33) % 1);
      var c3 = colorAtPhase((phase + 0.66) % 1);
      var grad;
      if (direction === 'horizontal') {
        grad = ctx2.createLinearGradient(0, 0, w, 0);
      } else if (direction === 'vertical') {
        grad = ctx2.createLinearGradient(0, 0, 0, h);
      } else {
        grad = ctx2.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) / 2);
      }
      grad.addColorStop(0, c1);
      grad.addColorStop(0.5, c2);
      grad.addColorStop(1, c3);
      ctx2.clearRect(0, 0, w, h);
      ctx2.fillStyle = grad;
      ctx2.fillRect(0, 0, w, h);
    },
    resize: function(newW, newH) {
      canvas.width = newW;
      canvas.height = newH;
      w = newW;
      h = newH;
    },
    destroy: function() {},
  };
}
`;

export const gradientPulseImpl: LayerImpl = {
  type: 'gradient-pulse',
  validate,
  BROWSER_SOURCE,
};
