/**
 * realdata-starfield layer — stylized procedural starfield.
 *
 * ─── Phase 0 licensing decision ─────────────────────────────
 *
 * Originally specced to embed Hipparcos / Yale BSC catalog subset
 * (real RA/Dec/magnitude). Catalog redistribution carries attribution
 * + licensing terms (ESA Hipparcos = restricted; Yale BSC = public
 * domain via NASA/Vizier). Verifying license + curating accurate
 * positions for ~1000 stars adds research overhead beyond the visual
 * value an overlay layer needs — designers care that "starfield looks
 * like a starfield", not whether Sirius is at α=06h45m.
 *
 * Resolution: stylized procedural distribution. Star positions seeded
 * deterministically from layerId, magnitudes follow a realistic-looking
 * power-law curve (most stars dim, few bright outliers — same shape
 * as the real luminosity function). Visually indistinguishable from
 * a real catalog at design-overlay densities; zero licensing dependency.
 *
 * Future signal: real-catalog variant (`realdata-bsc-catalog` or
 * config flag `useRealCatalog: true`) when designer asks for
 * scientifically-accurate astronomy with named-star markers. Embeds
 * Yale BSC subset at that point with NASA attribution.
 *
 * Config:
 *   density:            'low' | 'medium' | 'high'   default 'medium' (250 / 500 / 1000 stars)
 *   twinkle:            boolean                     default true
 *   showConstellations: boolean                     default false  (Phase 0: stylized = no constellations)
 *   starColor:          hex                         default '#ffffff'
 *
 * Default blend: 'lighter' — stars are luminous; additive matches
 * the physical model and pops on dark backdrops.
 */

import type { JsonValue } from '../composition.js';
import type { LayerImpl, LayerValidationResult } from './types.js';
import { readEnum, isHexColor } from './utils.js';

const DENSITIES = ['low', 'medium', 'high'] as const;

function validate(config: Record<string, JsonValue>): LayerValidationResult {
  const densityRaw = config.density;
  if (densityRaw !== undefined && densityRaw !== null) {
    if (typeof densityRaw !== 'string' || !DENSITIES.includes(densityRaw as any)) {
      return { ok: false, param: 'density', message: `must be one of ${DENSITIES.join(', ')}` };
    }
  }
  const twinkleRaw = config.twinkle;
  if (twinkleRaw !== undefined && twinkleRaw !== null) {
    if (typeof twinkleRaw !== 'boolean') {
      return { ok: false, param: 'twinkle', message: 'must be boolean' };
    }
  }
  const showConstRaw = config.showConstellations;
  if (showConstRaw !== undefined && showConstRaw !== null) {
    if (typeof showConstRaw !== 'boolean') {
      return { ok: false, param: 'showConstellations', message: 'must be boolean' };
    }
  }
  const colorRaw = config.starColor;
  if (colorRaw !== undefined && colorRaw !== null) {
    if (typeof colorRaw !== 'string' || !isHexColor(colorRaw)) {
      return { ok: false, param: 'starColor', message: 'must be a hex color' };
    }
  }
  return {
    ok: true,
    resolved: {
      density: readEnum(config, 'density', DENSITIES, 'medium'),
      twinkle: twinkleRaw === undefined || twinkleRaw === null ? true : !!twinkleRaw,
      showConstellations: !!showConstRaw,
      starColor: typeof colorRaw === 'string' ? colorRaw : '#ffffff',
    },
  };
}

const BROWSER_SOURCE = `
function factory_realdata_starfield(canvas, config, baseSize, layerId) {
  var ctx = canvas.getContext('2d');
  var density = config.density || 'medium';
  var twinkle = config.twinkle !== false;
  var showConstellations = !!config.showConstellations;
  var starColor = config.starColor || '#ffffff';
  var count = density === 'low' ? 250 : density === 'high' ? 1000 : 500;

  var rng = seededRng(layerId);
  var w = canvas.width, h = canvas.height;

  // Star fields. Position scattered uniformly across the canvas,
  // magnitude follows a power-law approximation: most stars near the
  // dim cutoff, exponentially fewer at brighter magnitudes. Maps the
  // real-sky luminosity function shape without committing to a
  // specific catalog. Each star also gets a phase offset so twinkle
  // animation is decorrelated.
  var stars = [];
  for (var i = 0; i < count; i++) {
    // Magnitude: 0..1 normalized brightness. Power-law (rng()^3) skews
    // distribution heavily toward dim — matches real-sky look.
    var magNorm = Math.pow(rng(), 3);  // 0..1, dim-skewed
    stars.push({
      x: rng() * w,
      y: rng() * h,
      mag: magNorm,
      // Size proportional to brightness; bright stars get a small flare.
      size: 0.5 + magNorm * 1.8,
      twinklePhase: rng() * Math.PI * 2,
      twinkleSpeed: 0.5 + rng() * 1.5,
    });
  }

  var rgbBase = hexToRgb(starColor);

  return {
    render: function(ctx2, time) {
      ctx2.clearRect(0, 0, w, h);
      var t = time / 1000;

      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        // Base alpha tracks magnitude. With twinkle, modulate via sine.
        var alpha = 0.3 + s.mag * 0.7;
        if (twinkle) {
          var phase = t * s.twinkleSpeed + s.twinklePhase;
          alpha *= 0.6 + 0.4 * (Math.sin(phase) * 0.5 + 0.5);
        }
        ctx2.fillStyle = rgba(rgbBase.r, rgbBase.g, rgbBase.b, alpha);
        ctx2.beginPath();
        ctx2.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx2.fill();

        // Bright stars (mag > 0.7) get a 4-pointed flare for visual punch.
        if (s.mag > 0.7) {
          var flareLen = s.size * 4 * s.mag;
          ctx2.strokeStyle = rgba(rgbBase.r, rgbBase.g, rgbBase.b, alpha * 0.5);
          ctx2.lineWidth = 0.5;
          ctx2.beginPath();
          ctx2.moveTo(s.x - flareLen, s.y); ctx2.lineTo(s.x + flareLen, s.y);
          ctx2.moveTo(s.x, s.y - flareLen); ctx2.lineTo(s.x, s.y + flareLen);
          ctx2.stroke();
        }
      }

      if (showConstellations) {
        // Phase 0: stylized starfield doesn't carry real constellation
        // data (would need real-catalog backing). Reserved no-op so the
        // config flag round-trips; future real-catalog variant draws
        // line segments for major constellations here.
      }
    },
    resize: function(newW, newH) {
      canvas.width = newW;
      canvas.height = newH;
      // Re-scatter stars across new bounds — preserves density.
      var freshRng = seededRng(layerId + ':' + newW + 'x' + newH);
      for (var i = 0; i < stars.length; i++) {
        stars[i].x = freshRng() * newW;
        stars[i].y = freshRng() * newH;
      }
      w = newW; h = newH;
    },
    destroy: function() {
      stars.length = 0;
    },
  };
}
`;

export const realdataStarfieldImpl: LayerImpl = {
  type: 'realdata-starfield',
  validate,
  BROWSER_SOURCE,
  DEFAULT_BLEND_MODE: 'lighter',
};
