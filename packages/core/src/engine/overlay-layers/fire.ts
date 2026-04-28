/**
 * fire layer — animated upward flame particles.
 *
 * Particles spawn along the bottom edge, rise with strong upward
 * velocity, lose heat as they age (yellow → orange → red → fade).
 * Reads as ambient fire / energy — game UI splash, demo reel hero,
 * "engaged" state visualization.
 *
 * Config:
 *   intensity: 0..1                 default 0.5  (multiplier on particle count, max 150)
 *   color: 'warm' | 'cool' | hex    default 'warm'
 *                                   'warm' = yellow→red gradient (60° → 0°)
 *                                   'cool' = blue→violet (200° → 270°)
 *                                   hex = monochromatic flame in that hue family
 *   height: 'low' | 'med' | 'tall'  default 'med'  (peak vertical reach)
 *
 * Default blend: 'lighter' (additive) — flames are luminous; additive
 * matches the physical model (overlapping flames brighten).
 *
 * Determinism: initial particle positions seeded from layerId. Particle
 * recycle (when life >= 1) reuses the seeded RNG so subsequent spawn
 * sequence is also deterministic. Two mounts → identical t=0 frame.
 */

import type { JsonValue } from '../composition.js';
import type { LayerImpl, LayerValidationResult } from './types.js';
import { readNumber, readEnum, isHexColor } from './utils.js';

const HEIGHTS = ['low', 'med', 'tall'] as const;

function validate(config: Record<string, JsonValue>): LayerValidationResult {
  const intensityRaw = config.intensity;
  if (intensityRaw !== undefined && intensityRaw !== null) {
    if (typeof intensityRaw !== 'number' || !Number.isFinite(intensityRaw)) {
      return { ok: false, param: 'intensity', message: 'must be a finite number' };
    }
    if (intensityRaw < 0 || intensityRaw > 1) {
      return { ok: false, param: 'intensity', message: 'must be in 0..1 range' };
    }
  }
  const colorRaw = config.color;
  if (colorRaw !== undefined && colorRaw !== null) {
    if (typeof colorRaw !== 'string') {
      return { ok: false, param: 'color', message: 'must be "warm", "cool", or a hex color' };
    }
    if (colorRaw !== 'warm' && colorRaw !== 'cool' && !isHexColor(colorRaw)) {
      return { ok: false, param: 'color', message: 'must be "warm", "cool", or a hex color (#abc / #aabbcc)' };
    }
  }
  const heightRaw = config.height;
  if (heightRaw !== undefined && heightRaw !== null) {
    if (typeof heightRaw !== 'string' || !HEIGHTS.includes(heightRaw as typeof HEIGHTS[number])) {
      return { ok: false, param: 'height', message: `must be one of ${HEIGHTS.join(', ')}` };
    }
  }
  return {
    ok: true,
    resolved: {
      intensity: readNumber(config, 'intensity', 0.5, 0, 1),
      color: typeof colorRaw === 'string' ? colorRaw : 'warm',
      height: readEnum(config, 'height', HEIGHTS, 'med'),
    },
  };
}

const BROWSER_SOURCE = `
function factory_fire(canvas, config, baseSize, layerId) {
  var ctx = canvas.getContext('2d');
  var rng = seededRng(layerId);
  var intensity = typeof config.intensity === 'number' ? config.intensity : 0.5;
  var color = config.color || 'warm';
  var height = config.height || 'med';
  // Particle cap protects RAF budget. 9 layer types × cap × 60fps = bounded total.
  var MAX_PARTICLES = 150;
  var count = Math.max(8, Math.round(MAX_PARTICLES * intensity));
  var heightScale = height === 'low' ? 0.4 : height === 'tall' ? 1.0 : 0.7;
  var w = canvas.width, h = canvas.height;

  // Pre-compute color resolution: 'warm' / 'cool' use flameHue(t); hex
  // means monochromatic with hue extracted from the hex.
  var monoHue = null;
  if (color !== 'warm' && color !== 'cool') {
    // Extract approximate hue from hex via RGB → HSL inverse.
    var rgb = hexToRgb(color);
    var maxC = Math.max(rgb.r, rgb.g, rgb.b);
    var minC = Math.min(rgb.r, rgb.g, rgb.b);
    var d = maxC - minC;
    if (d === 0) monoHue = 0;
    else if (maxC === rgb.r) monoHue = ((rgb.g - rgb.b) / d) % 6;
    else if (maxC === rgb.g) monoHue = (rgb.b - rgb.r) / d + 2;
    else monoHue = (rgb.r - rgb.g) / d + 4;
    monoHue *= 60;
    if (monoHue < 0) monoHue += 360;
  }

  function spawn(p, initialSeed) {
    p.x = rng() * w;
    p.y = h - rng() * h * 0.05;  // bottom 5% spawn band
    p.vx = (rng() - 0.5) * 30;   // gentle horizontal drift
    p.vy = -(80 + rng() * 80);   // upward velocity 80..160 px/sec
    p.life = initialSeed ? rng() : 0;  // initial particles staggered across lifecycle
    p.lifeSpeed = 0.0008 + rng() * 0.0006;  // longer-lived than dust
    p.size = 6 + rng() * 6;
    p.jitterPhase = rng() * 1000;
  }

  var particles = makePool(count, function() { var p = {}; spawn(p, true); return p; });
  var lastTime = 0;

  return {
    render: function(ctx2, time) {
      var dt = lastTime === 0 ? 0 : Math.min(time - lastTime, 100);
      lastTime = time;
      ctx2.clearRect(0, 0, w, h);

      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        // Horizontal noise jitter — gives organic flame waver.
        var jitter = (valueNoise1D(p.jitterPhase + time * 0.001, 1234) - 0.5) * 8;
        p.x += (p.vx * dt / 1000) + jitter * 0.05;
        p.y += p.vy * heightScale * dt / 1000;
        p.life += p.lifeSpeed * dt;
        if (p.life >= 1 || p.y < -p.size) {
          spawn(p, false);
          continue;
        }
        // Alpha: fade in (0..0.15), fade out (0.7..1).
        var alpha = 1;
        if (p.life < 0.15) alpha = p.life / 0.15;
        else if (p.life > 0.7) alpha = (1 - p.life) / 0.3;
        // Size shrinks with age (heat dissipates).
        var radius = p.size * (1 - p.life * 0.5);
        // Color: temperature drops with age.
        var hue;
        if (color === 'warm') hue = flameHue('warm', p.life);
        else if (color === 'cool') hue = flameHue('cool', p.life);
        else hue = monoHue;
        var lightness = 0.6 - p.life * 0.4;  // bright young, dim old
        var rgb = hslToRgb(hue, 0.9, lightness);
        ctx2.fillStyle = rgba(rgb.r, rgb.g, rgb.b, alpha * 0.7);
        ctx2.beginPath();
        ctx2.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx2.fill();
      }
    },
    resize: function(newW, newH) {
      canvas.width = newW;
      canvas.height = newH;
      w = newW;
      h = newH;
    },
    destroy: function() {
      particles.length = 0;
    },
  };
}
`;

export const fireImpl: LayerImpl = {
  type: 'fire',
  validate,
  BROWSER_SOURCE,
  DEFAULT_BLEND_MODE: 'lighter',
};
