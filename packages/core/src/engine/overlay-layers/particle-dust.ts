/**
 * particle-dust layer — sparse floating particles drifting upward.
 *
 * Renders N small circles with subtle vertical-drift + horizontal jitter,
 * fading in/out over their lifecycle. Reads as ambient atmosphere —
 * Linear's homepage, Vercel's marketing pages use this kind of treatment.
 *
 * Config:
 *   count: 30..200                  default 60
 *   size:  1..4 px                  default 2
 *   speed: pixels/sec               default 30
 *   color: hex                      default 'rgba(255,255,255,0.4)' (white-ish)
 *
 * Determinism: initial particle positions deterministic from layerId
 * (seeded RNG). Velocities/lifecycles also seeded. Two mounts at t=0
 * show identical scatter.
 */

import type { JsonValue } from '../composition.js';
import type { LayerImpl, LayerValidationResult } from './types.js';
import { readNumber, isHexColor } from './utils.js';

function validate(config: Record<string, JsonValue>): LayerValidationResult {
  const countRaw = config.count;
  if (countRaw !== undefined && countRaw !== null) {
    if (typeof countRaw !== 'number' || !Number.isFinite(countRaw)) {
      return { ok: false, param: 'count', message: 'must be a finite number' };
    }
    if (countRaw < 30 || countRaw > 200) {
      return { ok: false, param: 'count', message: 'must be in 30..200 range' };
    }
  }
  const sizeRaw = config.size;
  if (sizeRaw !== undefined && sizeRaw !== null) {
    if (typeof sizeRaw !== 'number' || !Number.isFinite(sizeRaw)) {
      return { ok: false, param: 'size', message: 'must be a finite number' };
    }
    if (sizeRaw < 1 || sizeRaw > 4) {
      return { ok: false, param: 'size', message: 'must be in 1..4 px range' };
    }
  }
  const speedRaw = config.speed;
  if (speedRaw !== undefined && speedRaw !== null) {
    if (typeof speedRaw !== 'number' || !Number.isFinite(speedRaw) || speedRaw < 0 || speedRaw > 500) {
      return { ok: false, param: 'speed', message: 'must be a finite number in 0..500 px/sec' };
    }
  }
  const colorRaw = config.color;
  if (colorRaw !== undefined && colorRaw !== null) {
    if (typeof colorRaw !== 'string') {
      return { ok: false, param: 'color', message: 'must be a CSS color string' };
    }
    // Accept hex OR rgba()/rgb() — particle color often needs alpha.
    if (!isHexColor(colorRaw) && !/^rgba?\(/.test(colorRaw)) {
      return { ok: false, param: 'color', message: 'must be a hex (#abc/#aabbcc) or rgb()/rgba() color' };
    }
  }
  return {
    ok: true,
    resolved: {
      count: Math.round(readNumber(config, 'count', 60, 30, 200)),
      size: readNumber(config, 'size', 2, 1, 4),
      speed: readNumber(config, 'speed', 30, 0, 500),
      color: typeof colorRaw === 'string' ? colorRaw : 'rgba(255,255,255,0.4)',
    },
  };
}

const BROWSER_SOURCE = `
function factory_particle_dust(canvas, config, baseSize, layerId) {
  var ctx = canvas.getContext('2d');
  var rng = seededRng(layerId);
  var count = typeof config.count === 'number' ? Math.round(config.count) : 60;
  var size = typeof config.size === 'number' ? config.size : 2;
  var speed = typeof config.speed === 'number' ? config.speed : 30;
  var color = config.color || 'rgba(255,255,255,0.4)';
  var w = canvas.width, h = canvas.height;
  var particles = [];

  function spawn(p, initial) {
    p.x = rng() * w;
    p.y = initial ? rng() * h : h + rng() * 50;
    p.vx = (rng() - 0.5) * 0.3;
    p.vy = -(0.5 + rng() * 0.5);  // upward drift; scaled by speed at render
    p.life = rng();               // 0..1 — used for fade in/out cycle
    p.lifeSpeed = 0.0005 + rng() * 0.001;
    p.r = size * (0.7 + rng() * 0.6);
  }

  for (var i = 0; i < count; i++) {
    var p = {};
    spawn(p, true);
    particles.push(p);
  }

  var lastTime = 0;
  return {
    render: function(ctx2, time) {
      var dt = lastTime === 0 ? 0 : Math.min(time - lastTime, 100);
      lastTime = time;
      ctx2.clearRect(0, 0, w, h);
      ctx2.fillStyle = color;
      var advance = (speed / 1000) * dt;
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.x += p.vx * advance * 0.3;
        p.y += p.vy * advance;
        p.life += p.lifeSpeed * dt;
        if (p.life >= 1 || p.y < -10) {
          spawn(p, false);
          continue;
        }
        // Fade-in first 20%, fade-out last 30%, full opacity middle.
        var alpha = 1;
        if (p.life < 0.2) alpha = p.life / 0.2;
        else if (p.life > 0.7) alpha = (1 - p.life) / 0.3;
        ctx2.globalAlpha = alpha;
        ctx2.beginPath();
        ctx2.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx2.fill();
      }
      ctx2.globalAlpha = 1;
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

export const particleDustImpl: LayerImpl = {
  type: 'particle-dust',
  validate,
  BROWSER_SOURCE,
};
