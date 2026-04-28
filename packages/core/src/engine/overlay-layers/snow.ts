/**
 * snow layer — falling flake particles with horizontal drift.
 *
 * Small white circles spawn at the top edge, fall under gravity-like
 * vy with a horizontal drift component. Configurable drift angle lets
 * callers express "still snow" (drift=0) vs "blizzard" (drift=±30+).
 *
 * Config:
 *   count: 30..500     default 100
 *   size:  1..6 px     default 2
 *   drift: -45..45     default -10  (degrees of horizontal drift; negative = leftward)
 *
 * Default blend: 'source-over' — flakes are visible white objects, not
 * luminous additive sources.
 */

import type { JsonValue } from '../composition.js';
import type { LayerImpl, LayerValidationResult } from './types.js';
import { readNumber } from './utils.js';

function validate(config: Record<string, JsonValue>): LayerValidationResult {
  const countRaw = config.count;
  if (countRaw !== undefined && countRaw !== null) {
    if (typeof countRaw !== 'number' || !Number.isFinite(countRaw) || countRaw < 30 || countRaw > 500) {
      return { ok: false, param: 'count', message: 'must be a finite number in 30..500' };
    }
  }
  const sizeRaw = config.size;
  if (sizeRaw !== undefined && sizeRaw !== null) {
    if (typeof sizeRaw !== 'number' || !Number.isFinite(sizeRaw) || sizeRaw < 1 || sizeRaw > 6) {
      return { ok: false, param: 'size', message: 'must be a finite number in 1..6 px' };
    }
  }
  const driftRaw = config.drift;
  if (driftRaw !== undefined && driftRaw !== null) {
    if (typeof driftRaw !== 'number' || !Number.isFinite(driftRaw) || driftRaw < -45 || driftRaw > 45) {
      return { ok: false, param: 'drift', message: 'must be a finite number in -45..45 degrees' };
    }
  }
  return {
    ok: true,
    resolved: {
      count: Math.round(readNumber(config, 'count', 100, 30, 500)),
      size: readNumber(config, 'size', 2, 1, 6),
      drift: readNumber(config, 'drift', -10, -45, 45),
    },
  };
}

const BROWSER_SOURCE = `
function factory_snow(canvas, config, baseSize, layerId) {
  var ctx = canvas.getContext('2d');
  var rng = seededRng(layerId);
  var count = typeof config.count === 'number' ? Math.round(config.count) : 100;
  var size = typeof config.size === 'number' ? config.size : 2;
  var drift = typeof config.drift === 'number' ? config.drift : -10;
  var w = canvas.width, h = canvas.height;
  // Drift angle → horizontal velocity component. Vertical is gravity-like.
  var driftRad = drift * Math.PI / 180;
  var horizontalDrift = Math.sin(driftRad);  // ratio of vy that becomes vx

  function spawn(p, initialSeed) {
    p.x = rng() * w;
    p.y = initialSeed ? rng() * h : -10;
    // Per-flake fall speed varies for parallax depth feel.
    var depth = 0.4 + rng() * 0.6;  // 0.4 = far/slow, 1.0 = near/fast
    p.vy = (30 + rng() * 50) * depth;
    p.vx = p.vy * horizontalDrift + (rng() - 0.5) * 5;
    p.size = size * depth;
    p.alpha = 0.4 + depth * 0.5;
    // Sway phase — flakes wobble slightly while falling for organic feel.
    p.swayPhase = rng() * Math.PI * 2;
    p.swayAmp = 0.3 + rng() * 0.4;
  }

  var flakes = makePool(count, function() { var p = {}; spawn(p, true); return p; });
  var lastTime = 0;

  return {
    render: function(ctx2, time) {
      var dt = lastTime === 0 ? 0 : Math.min(time - lastTime, 100);
      lastTime = time;
      ctx2.clearRect(0, 0, w, h);

      for (var i = 0; i < flakes.length; i++) {
        var p = flakes[i];
        // Sway = subtle horizontal sine offset, separate from drift.
        var sway = Math.sin(time * 0.001 + p.swayPhase) * p.swayAmp;
        p.x += (p.vx + sway) * dt / 1000;
        p.y += p.vy * dt / 1000;
        if (p.y > h + 10) {
          spawn(p, false);
          continue;
        }
        // Wrap horizontally so flakes don't disappear off the side prematurely.
        if (p.x < -10) p.x = w + 10;
        else if (p.x > w + 10) p.x = -10;
        ctx2.fillStyle = rgba(255, 255, 255, p.alpha);
        ctx2.beginPath();
        ctx2.arc(p.x, p.y, p.size, 0, Math.PI * 2);
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
      flakes.length = 0;
    },
  };
}
`;

export const snowImpl: LayerImpl = {
  type: 'snow',
  validate,
  BROWSER_SOURCE,
  DEFAULT_BLEND_MODE: 'source-over',
};
