/**
 * gold layer — sparse glitter sparkles in static positions.
 *
 * Static-positioned bright points that twinkle (alpha pulses sine over
 * time, phase-offset per particle). Reads as luxurious shimmer —
 * premium product hero, gala / fundraiser, jewelry brand context.
 *
 * Differs from particle-dust (#5): NO drift / fall — particles stay
 * put, only their alpha cycles. Different visual signature: dust is
 * atmospheric movement; gold is twinkle-on-still-surface.
 *
 * Config:
 *   density: 0..1                   default 0.3
 *   color:   hex / rgba             default 'rgba(255,200,80,0.9)'
 *   twinkle: 'fast' | 'slow'        default 'slow'  (~2s cycle vs ~1s)
 *
 * Default blend: 'lighter' — sparkles are luminous; additive matches
 * the physical model and makes them pop on dark backgrounds.
 */

import type { JsonValue } from '../composition.js';
import type { LayerImpl, LayerValidationResult } from './types.js';
import { readNumber, readEnum, isHexColor } from './utils.js';

const TWINKLES = ['fast', 'slow'] as const;

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
  const twinkleRaw = config.twinkle;
  if (twinkleRaw !== undefined && twinkleRaw !== null) {
    if (typeof twinkleRaw !== 'string' || !TWINKLES.includes(twinkleRaw as typeof TWINKLES[number])) {
      return { ok: false, param: 'twinkle', message: `must be one of ${TWINKLES.join(', ')}` };
    }
  }
  return {
    ok: true,
    resolved: {
      density: readNumber(config, 'density', 0.3, 0, 1),
      color: typeof colorRaw === 'string' ? colorRaw : 'rgba(255,200,80,0.9)',
      twinkle: readEnum(config, 'twinkle', TWINKLES, 'slow'),
    },
  };
}

const BROWSER_SOURCE = `
function factory_gold(canvas, config, baseSize, layerId) {
  var ctx = canvas.getContext('2d');
  var rng = seededRng(layerId);
  var density = typeof config.density === 'number' ? config.density : 0.3;
  var color = config.color || 'rgba(255,200,80,0.9)';
  var twinkle = config.twinkle || 'slow';
  var MAX_PARTICLES = 200;
  var count = Math.max(10, Math.round(MAX_PARTICLES * density));
  var w = canvas.width, h = canvas.height;
  // Cycle period: slow=2000ms, fast=1000ms. Per-particle phase offset
  // means sparkles don't all flash in unison.
  var cycleMs = twinkle === 'fast' ? 1000 : 2000;

  function spawn(p) {
    p.x = rng() * w;
    p.y = rng() * h;
    p.size = 1.5 + rng() * 2.5;
    p.phase = rng() * Math.PI * 2;
    // Per-particle base alpha — dim sparkles add depth without
    // overwhelming the brightest ones.
    p.baseAlpha = 0.4 + rng() * 0.6;
  }

  var particles = makePool(count, function() { var p = {}; spawn(p); return p; });

  return {
    render: function(ctx2, time) {
      ctx2.clearRect(0, 0, w, h);

      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        // Twinkle: alpha cycles sine-over-time. Map [-1,1] sin → [0,1] alpha
        // with a pow shaping so bright peaks read sharper than the
        // dim valleys (proper twinkle look, not simple sine).
        var phase = (time / cycleMs) * Math.PI * 2 + p.phase;
        var s = (Math.sin(phase) + 1) / 2;     // 0..1
        var twinkleAlpha = Math.pow(s, 3);     // sharpened peaks
        var alpha = p.baseAlpha * twinkleAlpha;
        if (alpha < 0.02) continue;            // skip near-invisible sparkles
        ctx2.fillStyle = color;
        ctx2.globalAlpha = alpha;
        ctx2.beginPath();
        ctx2.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx2.fill();
        // Optional 4-pointed flare at peak alpha — sells the "sparkle".
        if (alpha > 0.6) {
          ctx2.strokeStyle = color;
          ctx2.lineWidth = 0.5;
          var flare = p.size * 3 * (alpha - 0.6) / 0.4;
          ctx2.beginPath();
          ctx2.moveTo(p.x - flare, p.y); ctx2.lineTo(p.x + flare, p.y);
          ctx2.moveTo(p.x, p.y - flare); ctx2.lineTo(p.x, p.y + flare);
          ctx2.stroke();
        }
      }
      ctx2.globalAlpha = 1;
    },
    resize: function(newW, newH) {
      canvas.width = newW;
      canvas.height = newH;
      // Re-scatter particles into the new bounds — sparkles aren't
      // tied to a content origin so re-randomization preserves overall
      // density without needing per-particle bbox math.
      w = newW;
      h = newH;
      var freshRng = seededRng(layerId + ':' + newW + 'x' + newH);
      for (var i = 0; i < particles.length; i++) {
        particles[i].x = freshRng() * newW;
        particles[i].y = freshRng() * newH;
      }
    },
    destroy: function() {
      particles.length = 0;
    },
  };
}
`;

export const goldImpl: LayerImpl = {
  type: 'gold',
  validate,
  BROWSER_SOURCE,
  DEFAULT_BLEND_MODE: 'lighter',
};
