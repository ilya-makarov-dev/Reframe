/**
 * noise-grain layer — animated film-grain texture.
 *
 * Renders sparse random noise at low resolution upscaled. Reads as a
 * subtle texture overlay — Stripe / Linear / editorial sites use this
 * for warmth without baking it into the base scene's images.
 *
 * Config:
 *   intensity: 0..1     default 0.10  (alpha multiplier; 0 invisible, 1 obnoxious)
 *   speed: 'slow' | 'medium' | 'fast'    default 'medium'
 *   tint:  hex color or null            default null (greyscale)
 *
 * Determinism: noise FRAMES are time-driven (each frame regenerates
 * noise from time-derived seed) — so intra-frame variation is
 * intentional. The FIRST FRAME at t=0 is determined by layerId+0, so
 * mounting the same overlay twice shows identical pixels at t=0.
 */

import type { JsonValue } from '../composition.js';
import type { LayerImpl, LayerValidationResult } from './types.js';
import { readNumber, readEnum } from './utils.js';

const SPEEDS = ['slow', 'medium', 'fast'] as const;

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
  const speedRaw = config.speed;
  if (speedRaw !== undefined && speedRaw !== null) {
    if (typeof speedRaw !== 'string' || !SPEEDS.includes(speedRaw as typeof SPEEDS[number])) {
      return { ok: false, param: 'speed', message: `must be one of ${SPEEDS.join(', ')}` };
    }
  }
  const tintRaw = config.tint;
  if (tintRaw !== undefined && tintRaw !== null) {
    if (typeof tintRaw !== 'string' || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(tintRaw)) {
      return { ok: false, param: 'tint', message: 'must be a hex color (#abc or #aabbcc) or null' };
    }
  }
  return {
    ok: true,
    resolved: {
      intensity: readNumber(config, 'intensity', 0.10, 0, 1),
      speed: readEnum(config, 'speed', SPEEDS, 'medium'),
      tint: typeof tintRaw === 'string' ? tintRaw : null,
    },
  };
}

const BROWSER_SOURCE = `
function factory_noise_grain(canvas, config, baseSize, layerId) {
  var ctx = canvas.getContext('2d');
  var rng = seededRng(layerId);
  var intensity = typeof config.intensity === 'number' ? config.intensity : 0.10;
  var speed = config.speed || 'medium';
  var tint = config.tint || null;
  var speedScale = speed === 'slow' ? 0.0008 : speed === 'fast' ? 0.005 : 0.0018;
  // Low-res noise tile, upscaled with imageSmoothingEnabled=false for grit.
  var TILE = 96;
  var off = document.createElement('canvas');
  off.width = TILE;
  off.height = TILE;
  var offCtx = off.getContext('2d');
  var imageData = offCtx.createImageData(TILE, TILE);
  var w = canvas.width, h = canvas.height;

  function fillTile(t) {
    // Per-pixel noise. Seed advances with t so frames differ; first frame
    // (t=0) uses layerId-seeded RNG so same overlay → same first frame.
    var localRng = t === 0 ? seededRng(layerId) : mulberry32(fnv32(layerId + ':' + Math.floor(t)));
    var d = imageData.data;
    var rT = tint ? hexToRgb(tint) : null;
    for (var i = 0; i < d.length; i += 4) {
      var v = (localRng() * 255) | 0;
      if (rT) {
        d[i] = (v + rT.r) >> 1;
        d[i + 1] = (v + rT.g) >> 1;
        d[i + 2] = (v + rT.b) >> 1;
      } else {
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      d[i + 3] = (intensity * 255) | 0;
    }
    offCtx.putImageData(imageData, 0, 0);
  }

  fillTile(0);

  return {
    render: function(ctx2, time) {
      var t = Math.floor(time * speedScale);
      fillTile(t);
      ctx2.imageSmoothingEnabled = false;
      // Tile across the canvas. Two-row pattern is enough — eye won't
      // detect repetition with random pixels.
      for (var y = 0; y < h; y += TILE) {
        for (var x = 0; x < w; x += TILE) {
          ctx2.drawImage(off, x, y, TILE, TILE);
        }
      }
    },
    resize: function(newW, newH) {
      canvas.width = newW;
      canvas.height = newH;
      w = newW;
      h = newH;
    },
    destroy: function() {
      // No timers / listeners owned — RAF lives in the renderer.
    },
  };
}
`;

export const noiseGrainImpl: LayerImpl = {
  type: 'noise-grain',
  validate,
  BROWSER_SOURCE,
};
