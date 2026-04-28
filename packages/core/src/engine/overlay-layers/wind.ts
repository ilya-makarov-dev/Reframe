/**
 * wind layer — abstract directional motion streaks.
 *
 * Short line segments move across the canvas at configurable angle
 * + speed, with subtle jitter. Reads as motion lines / speed cue —
 * dashboard "loading" energy, abstract data flow, brand video opener.
 *
 * Config:
 *   speed: 30..300 px/sec    default 100
 *   direction: 0..360 deg    default 0  (rightward; 90 = downward, etc.)
 *   intensity: 0..1          default 0.5  (multiplier on streak count)
 *
 * Default blend: 'source-over' — streaks are foreground objects, not
 * additive light. Stand on top of the base scene cleanly.
 */

import type { JsonValue } from '../composition.js';
import type { LayerImpl, LayerValidationResult } from './types.js';
import { readNumber } from './utils.js';

function validate(config: Record<string, JsonValue>): LayerValidationResult {
  const speedRaw = config.speed;
  if (speedRaw !== undefined && speedRaw !== null) {
    if (typeof speedRaw !== 'number' || !Number.isFinite(speedRaw) || speedRaw < 30 || speedRaw > 300) {
      return { ok: false, param: 'speed', message: 'must be a finite number in 30..300 px/sec' };
    }
  }
  const directionRaw = config.direction;
  if (directionRaw !== undefined && directionRaw !== null) {
    if (typeof directionRaw !== 'number' || !Number.isFinite(directionRaw)) {
      return { ok: false, param: 'direction', message: 'must be a finite number (degrees)' };
    }
  }
  const intensityRaw = config.intensity;
  if (intensityRaw !== undefined && intensityRaw !== null) {
    if (typeof intensityRaw !== 'number' || !Number.isFinite(intensityRaw) || intensityRaw < 0 || intensityRaw > 1) {
      return { ok: false, param: 'intensity', message: 'must be a finite number in 0..1' };
    }
  }
  // Normalize direction into 0..360 range for resolved spec.
  let direction = readNumber(config, 'direction', 0);
  direction = ((direction % 360) + 360) % 360;
  return {
    ok: true,
    resolved: {
      speed: readNumber(config, 'speed', 100, 30, 300),
      direction,
      intensity: readNumber(config, 'intensity', 0.5, 0, 1),
    },
  };
}

const BROWSER_SOURCE = `
function factory_wind(canvas, config, baseSize, layerId) {
  var ctx = canvas.getContext('2d');
  var rng = seededRng(layerId);
  var speed = typeof config.speed === 'number' ? config.speed : 100;
  var direction = typeof config.direction === 'number' ? config.direction : 0;
  var intensity = typeof config.intensity === 'number' ? config.intensity : 0.5;
  var MAX_STREAKS = 80;
  var count = Math.max(6, Math.round(MAX_STREAKS * intensity));
  var w = canvas.width, h = canvas.height;
  var rad = direction * Math.PI / 180;
  var dirX = Math.cos(rad);
  var dirY = Math.sin(rad);

  function spawn(p, initialSeed) {
    if (initialSeed) {
      // Scatter across the canvas for full first frame.
      p.x = rng() * w;
      p.y = rng() * h;
    } else {
      // Spawn just off the upstream edge so the streak enters naturally.
      // Pick a random point on the upstream side based on direction.
      if (Math.abs(dirX) > Math.abs(dirY)) {
        p.x = dirX > 0 ? -50 : w + 50;
        p.y = rng() * h;
      } else {
        p.x = rng() * w;
        p.y = dirY > 0 ? -50 : h + 50;
      }
    }
    p.length = 30 + rng() * 60;
    p.alpha = 0.15 + rng() * 0.25;
    p.thickness = 1 + rng() * 1.5;
    // Per-streak speed variance (90%..130% of base) for organic motion.
    p.speed = speed * (0.9 + rng() * 0.4);
  }

  var streaks = makePool(count, function() { var p = {}; spawn(p, true); return p; });
  var lastTime = 0;

  return {
    render: function(ctx2, time) {
      var dt = lastTime === 0 ? 0 : Math.min(time - lastTime, 100);
      lastTime = time;
      ctx2.clearRect(0, 0, w, h);

      ctx2.lineCap = 'round';
      for (var i = 0; i < streaks.length; i++) {
        var p = streaks[i];
        p.x += dirX * p.speed * dt / 1000;
        p.y += dirY * p.speed * dt / 1000;
        // Recycle when fully past downstream edge (account for streak length).
        var offscreen = p.x < -p.length - 20 || p.x > w + p.length + 20 || p.y < -p.length - 20 || p.y > h + p.length + 20;
        if (offscreen) {
          spawn(p, false);
          continue;
        }
        var x2 = p.x - dirX * p.length;
        var y2 = p.y - dirY * p.length;
        ctx2.strokeStyle = rgba(255, 255, 255, p.alpha);
        ctx2.lineWidth = p.thickness;
        ctx2.beginPath();
        ctx2.moveTo(p.x, p.y);
        ctx2.lineTo(x2, y2);
        ctx2.stroke();
      }
    },
    resize: function(newW, newH) {
      canvas.width = newW;
      canvas.height = newH;
      w = newW;
      h = newH;
    },
    destroy: function() {
      streaks.length = 0;
    },
  };
}
`;

export const windImpl: LayerImpl = {
  type: 'wind',
  validate,
  BROWSER_SOURCE,
  DEFAULT_BLEND_MODE: 'source-over',
};
