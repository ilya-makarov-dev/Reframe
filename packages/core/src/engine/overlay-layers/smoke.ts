/**
 * smoke layer — drifting cloud particles.
 *
 * Soft-edged blobs spawn at one edge and drift across the canvas with
 * organic noise jitter. Reads as ambient atmosphere — incense, mist,
 * distant chimney. Reduces the "sterile" feel of dark backgrounds.
 *
 * Config:
 *   density: 0..1                              default 0.4
 *   color:   hex / rgba                        default 'rgba(180,180,180,0.5)'
 *   drift:   'left' | 'right' | 'up'           default 'up'
 *
 * Default blend: 'source-over' — smoke OBSCURES what's behind, doesn't
 * brighten it. Additive would invert the physical model.
 *
 * Determinism: spawn positions seeded from layerId; noise jitter uses
 * deterministic value-noise.
 */

import type { JsonValue } from '../composition.js';
import type { LayerImpl, LayerValidationResult } from './types.js';
import { readNumber, readEnum, isHexColor } from './utils.js';

const DRIFTS = ['left', 'right', 'up'] as const;

function validate(config: Record<string, JsonValue>): LayerValidationResult {
  const densityRaw = config.density;
  if (densityRaw !== undefined && densityRaw !== null) {
    if (typeof densityRaw !== 'number' || !Number.isFinite(densityRaw) || densityRaw < 0 || densityRaw > 1) {
      return { ok: false, param: 'density', message: 'must be a finite number in 0..1' };
    }
  }
  const colorRaw = config.color;
  if (colorRaw !== undefined && colorRaw !== null) {
    if (typeof colorRaw !== 'string') {
      return { ok: false, param: 'color', message: 'must be a CSS color string' };
    }
    if (!isHexColor(colorRaw) && !/^rgba?\(/.test(colorRaw)) {
      return { ok: false, param: 'color', message: 'must be a hex (#abc/#aabbcc) or rgb()/rgba() color' };
    }
  }
  const driftRaw = config.drift;
  if (driftRaw !== undefined && driftRaw !== null) {
    if (typeof driftRaw !== 'string' || !DRIFTS.includes(driftRaw as typeof DRIFTS[number])) {
      return { ok: false, param: 'drift', message: `must be one of ${DRIFTS.join(', ')}` };
    }
  }
  return {
    ok: true,
    resolved: {
      density: readNumber(config, 'density', 0.4, 0, 1),
      color: typeof colorRaw === 'string' ? colorRaw : 'rgba(180,180,180,0.5)',
      drift: readEnum(config, 'drift', DRIFTS, 'up'),
    },
  };
}

const BROWSER_SOURCE = `
function factory_smoke(canvas, config, baseSize, layerId) {
  var ctx = canvas.getContext('2d');
  var rng = seededRng(layerId);
  var density = typeof config.density === 'number' ? config.density : 0.4;
  var color = config.color || 'rgba(180,180,180,0.5)';
  var drift = config.drift || 'up';
  var MAX_PARTICLES = 50;
  var count = Math.max(8, Math.round(MAX_PARTICLES * density));
  var w = canvas.width, h = canvas.height;

  // Drift direction → primary velocity vector. Noise adds organic wobble.
  function spawnDir() {
    if (drift === 'left') return { vx: -(20 + rng() * 30), vy: (rng() - 0.5) * 10 };
    if (drift === 'right') return { vx: (20 + rng() * 30), vy: (rng() - 0.5) * 10 };
    // 'up'
    return { vx: (rng() - 0.5) * 10, vy: -(15 + rng() * 25) };
  }

  function spawn(p, initialSeed) {
    var dir = spawnDir();
    if (drift === 'left') { p.x = w + 50; p.y = rng() * h; }
    else if (drift === 'right') { p.x = -50; p.y = rng() * h; }
    else { p.x = rng() * w; p.y = h + 30; }  // 'up' spawns from bottom
    if (initialSeed) {
      // Initial particles randomized across the scene so first frame is full.
      p.x = rng() * w;
      p.y = rng() * h;
    }
    p.vx = dir.vx;
    p.vy = dir.vy;
    p.life = initialSeed ? rng() * 0.5 : 0;
    p.lifeSpeed = 0.0003 + rng() * 0.0004;  // slow lifetime — smoke lingers
    p.size = 25 + rng() * 35;  // soft large blobs
    p.noisePhase = rng() * 1000;
  }

  var particles = makePool(count, function() { var p = {}; spawn(p, true); return p; });
  var lastTime = 0;

  // Pre-create radial gradient cache for a single particle. Stretched
  // per-frame per-particle via translate; saves createRadialGradient cost.
  var BLOB_R = 60;
  var blobCanvas = document.createElement('canvas');
  blobCanvas.width = BLOB_R * 2;
  blobCanvas.height = BLOB_R * 2;
  var blobCtx = blobCanvas.getContext('2d');
  var grad = blobCtx.createRadialGradient(BLOB_R, BLOB_R, 0, BLOB_R, BLOB_R, BLOB_R);
  grad.addColorStop(0, color);
  // Convert color to faded version for outer stop. Simpler: a transparent
  // color in same family. We'll hack by setting alpha 0 of the same string —
  // doesn't always work for hex; safer is to draw color, mask via alpha.
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  blobCtx.fillStyle = grad;
  blobCtx.fillRect(0, 0, BLOB_R * 2, BLOB_R * 2);

  return {
    render: function(ctx2, time) {
      var dt = lastTime === 0 ? 0 : Math.min(time - lastTime, 100);
      lastTime = time;
      ctx2.clearRect(0, 0, w, h);

      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        // Noise-driven horizontal jitter — adds organic puff motion.
        var jx = (valueNoise2D(p.x * 0.005, time * 0.0005, 5678) - 0.5) * 20;
        var jy = (valueNoise2D(time * 0.0005, p.y * 0.005, 91011) - 0.5) * 15;
        p.x += (p.vx + jx) * dt / 1000;
        p.y += (p.vy + jy) * dt / 1000;
        p.life += p.lifeSpeed * dt;
        var offscreen = p.x < -100 || p.x > w + 100 || p.y < -100 || p.y > h + 100;
        if (p.life >= 1 || offscreen) {
          spawn(p, false);
          continue;
        }
        var alpha = 1;
        if (p.life < 0.2) alpha = p.life / 0.2;
        else if (p.life > 0.7) alpha = (1 - p.life) / 0.3;
        ctx2.globalAlpha = alpha;
        var scale = p.size / BLOB_R;
        ctx2.drawImage(blobCanvas, p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
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

export const smokeImpl: LayerImpl = {
  type: 'smoke',
  validate,
  BROWSER_SOURCE,
  DEFAULT_BLEND_MODE: 'source-over',
};
