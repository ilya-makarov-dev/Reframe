/**
 * realdata-weather layer — atmospheric condition presets.
 *
 * Five conditions cover the canonical "weather mood" vocabulary
 * designers reach for: rainy / snowy / sunny / stormy / clear. Each
 * resolves to a deterministic preset (tint + particle behavior +
 * counts) — NOT a live-API integration. "Real data" here means
 * "real-world atmospheric vocabulary", not "current weather in Tokyo".
 *
 * Live-weather-API variant deferred — different category with
 * external dependency profile incompatible with offline bundles.
 *
 * Config:
 *   condition:     'rainy' | 'snowy' | 'sunny' | 'stormy' | 'clear'   required
 *   intensity:     0..1                                                default 0.6
 *   windDirection: 0..360 degrees                                      default 0
 *
 * Default blend: per-condition resolution at compile (lighter for
 * sunny/stormy, source-over for rainy/snowy/clear) — see
 * conditionDefaultBlend() helper.
 */

import type { JsonValue } from '../composition.js';
import type { OverlayBlendMode } from '../composition.js';
import type { LayerImpl, LayerValidationResult } from './types.js';
import { readNumber } from './utils.js';
import { KNOWN_WEATHER_CONDITIONS, WEATHER_PRESETS, type WeatherCondition } from './realdata/weather-presets.js';

function validate(config: Record<string, JsonValue>): LayerValidationResult {
  const conditionRaw = config.condition;
  if (conditionRaw === undefined || conditionRaw === null) {
    return { ok: false, param: 'condition', message: `required (must be one of ${KNOWN_WEATHER_CONDITIONS.join(', ')})` };
  }
  if (typeof conditionRaw !== 'string' || !KNOWN_WEATHER_CONDITIONS.includes(conditionRaw as WeatherCondition)) {
    return { ok: false, param: 'condition', message: `must be one of ${KNOWN_WEATHER_CONDITIONS.join(', ')}` };
  }
  const intensityRaw = config.intensity;
  if (intensityRaw !== undefined && intensityRaw !== null) {
    if (typeof intensityRaw !== 'number' || !Number.isFinite(intensityRaw) || intensityRaw < 0 || intensityRaw > 1) {
      return { ok: false, param: 'intensity', message: 'must be a finite number in 0..1' };
    }
  }
  const windRaw = config.windDirection;
  if (windRaw !== undefined && windRaw !== null) {
    if (typeof windRaw !== 'number' || !Number.isFinite(windRaw)) {
      return { ok: false, param: 'windDirection', message: 'must be a finite number (degrees)' };
    }
  }
  let windDirection = readNumber(config, 'windDirection', 0);
  windDirection = ((windDirection % 360) + 360) % 360;
  return {
    ok: true,
    resolved: {
      condition: conditionRaw,
      intensity: readNumber(config, 'intensity', 0.6, 0, 1),
      windDirection,
    },
  };
}

/**
 * Per-condition default blendMode. Compile-time resolveBlendMode reads
 * this when the user doesn't override blendMode explicitly.
 *
 * Why we expose this distinct from LayerImpl.DEFAULT_BLEND_MODE:
 * realdata-weather has a single layer impl but different conditions
 * conceptually want different blends — sunny/stormy luminous, others
 * diffuse. Phase 0 ships ONE DEFAULT_BLEND_MODE on the impl ('lighter'
 * — biased toward atmospheric "glow" feel since sunny + stormy benefit
 * most). Designers can override per-instance via the existing
 * blendMode override on the layer spec. Future Variant 2 schema
 * could plumb per-condition defaults through the registry.
 */
export function conditionDefaultBlend(condition: WeatherCondition): OverlayBlendMode {
  if (condition === 'sunny' || condition === 'stormy') return 'lighter';
  return 'source-over';
}

const PRESETS_JSON = JSON.stringify(WEATHER_PRESETS);

const BROWSER_SOURCE = `
var REFRAME_WEATHER_PRESETS = ${PRESETS_JSON};
function factory_realdata_weather(canvas, config, baseSize, layerId) {
  var ctx = canvas.getContext('2d');
  var condition = config.condition || 'clear';
  var intensity = typeof config.intensity === 'number' ? config.intensity : 0.6;
  var windDirection = typeof config.windDirection === 'number' ? config.windDirection : 0;
  var preset = REFRAME_WEATHER_PRESETS[condition] || REFRAME_WEATHER_PRESETS.clear;

  var rng = seededRng(layerId);
  var w = canvas.width, h = canvas.height;
  var count = Math.round(preset.baseCount * intensity);
  var windRad = windDirection * Math.PI / 180;
  var windX = Math.sin(windRad);  // horizontal drift component

  // Particle pool — per-condition spawn function fills the right shape.
  var particles = [];
  function spawn(p, initial) {
    p.x = rng() * w;
    p.y = initial ? rng() * h : -10;
    if (preset.particleKind === 'rain' || preset.particleKind === 'lightning') {
      p.vy = preset.baseSpeed * (0.85 + rng() * 0.3);
      p.vx = p.vy * windX * 0.3 + (rng() - 0.5) * 30;
      p.size = 1 + rng() * 1;
      p.length = 8 + rng() * 8;
      p.alpha = 0.25 + rng() * 0.35;
    } else if (preset.particleKind === 'snow') {
      p.vy = preset.baseSpeed * (0.6 + rng() * 0.5);
      p.vx = p.vy * windX * 0.4 + (rng() - 0.5) * 5;
      p.size = 1.5 + rng() * 2;
      p.alpha = 0.4 + rng() * 0.5;
      p.swayPhase = rng() * Math.PI * 2;
    } else if (preset.particleKind === 'sparkle') {
      p.x = rng() * w;
      p.y = rng() * h;
      p.size = 1 + rng() * 2;
      p.alpha = 0.3 + rng() * 0.6;
      p.twinklePhase = rng() * Math.PI * 2;
      p.twinkleSpeed = 0.5 + rng() * 1.5;
      p.vx = 0; p.vy = 0;
    } else {
      p.vx = 0; p.vy = 0; p.size = 0; p.alpha = 0;
    }
  }
  for (var i = 0; i < count; i++) { var p = {}; spawn(p, true); particles.push(p); }

  // Lightning event list (stormy only) — sparse arc flashes overlaid
  // on the rain particle base.
  var lightningEvents = [];
  var nextLightningAt = 0;

  var lastTime = 0;

  return {
    render: function(ctx2, time) {
      var dt = lastTime === 0 ? 0 : Math.min(time - lastTime, 100);
      lastTime = time;
      ctx2.clearRect(0, 0, w, h);

      // ── Tint pass ────────────────────────────────────
      if (preset.tint) {
        ctx2.fillStyle = preset.tint;
        ctx2.fillRect(0, 0, w, h);
      }

      // ── Particle pass ────────────────────────────────
      if (preset.particleKind === 'rain' || preset.particleKind === 'lightning') {
        ctx2.strokeStyle = 'rgba(180, 200, 230, 0.5)';
        ctx2.lineWidth = 1;
        for (var i = 0; i < particles.length; i++) {
          var pp = particles[i];
          pp.x += pp.vx * dt / 1000;
          pp.y += pp.vy * dt / 1000;
          if (pp.y > h + pp.length || pp.x < -50 || pp.x > w + 50) { spawn(pp, false); continue; }
          ctx2.globalAlpha = pp.alpha;
          ctx2.beginPath();
          ctx2.moveTo(pp.x, pp.y);
          ctx2.lineTo(pp.x - pp.vx * 0.02, pp.y - pp.vy * 0.02);
          ctx2.stroke();
        }
        ctx2.globalAlpha = 1;
      } else if (preset.particleKind === 'snow') {
        ctx2.fillStyle = 'rgba(255, 255, 255, 0.85)';
        for (var j = 0; j < particles.length; j++) {
          var s = particles[j];
          var sway = Math.sin(time * 0.001 + s.swayPhase) * 0.4;
          s.x += (s.vx + sway) * dt / 1000;
          s.y += s.vy * dt / 1000;
          if (s.y > h + 5) { spawn(s, false); continue; }
          if (s.x < -10) s.x = w + 10;
          if (s.x > w + 10) s.x = -10;
          ctx2.globalAlpha = s.alpha;
          ctx2.beginPath();
          ctx2.arc(s.x, s.y, s.size, 0, Math.PI * 2);
          ctx2.fill();
        }
        ctx2.globalAlpha = 1;
      } else if (preset.particleKind === 'sparkle') {
        ctx2.fillStyle = 'rgba(255, 230, 170, 0.9)';
        for (var k = 0; k < particles.length; k++) {
          var sp = particles[k];
          var phase = time * 0.001 * sp.twinkleSpeed + sp.twinklePhase;
          var alpha = sp.alpha * (0.4 + 0.6 * Math.pow((Math.sin(phase) + 1) / 2, 3));
          if (alpha < 0.05) continue;
          ctx2.globalAlpha = alpha;
          ctx2.beginPath();
          ctx2.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
          ctx2.fill();
        }
        ctx2.globalAlpha = 1;
      }
      // 'haze' kind has no particle pass — tint alone defines the look.

      // ── Lightning pass (stormy only) ─────────────────
      if (preset.particleKind === 'lightning') {
        if (time >= nextLightningAt) {
          // Rare flashes — every 2-6 seconds.
          var flash = {
            x: rng() * w,
            yTop: 0,
            yBottom: rng() * h * 0.6 + h * 0.2,
            birth: time,
            life: 200,
          };
          lightningEvents.push(flash);
          nextLightningAt = time + 2000 + rng() * 4000;
        }
        for (var li = lightningEvents.length - 1; li >= 0; li--) {
          var lf = lightningEvents[li];
          var age = time - lf.birth;
          if (age >= lf.life) { lightningEvents.splice(li, 1); continue; }
          var t = age / lf.life;
          var alpha = t < 0.1 ? t / 0.1 : (1 - t) / 0.9;
          // Bright vertical-ish jagged path.
          ctx2.strokeStyle = rgba(220, 240, 255, alpha);
          ctx2.lineWidth = 2;
          ctx2.beginPath();
          var px = lf.x;
          ctx2.moveTo(px, lf.yTop);
          var steps = 8;
          for (var st = 1; st <= steps; st++) {
            var py = lf.yTop + (lf.yBottom - lf.yTop) * (st / steps);
            px += (rng() - 0.5) * 30;
            ctx2.lineTo(px, py);
          }
          ctx2.stroke();
          // Bright halo overlay.
          ctx2.strokeStyle = rgba(180, 220, 255, alpha * 0.3);
          ctx2.lineWidth = 8;
          ctx2.stroke();
        }
      }
    },
    resize: function(newW, newH) {
      canvas.width = newW;
      canvas.height = newH;
      w = newW; h = newH;
    },
    destroy: function() {
      particles.length = 0;
      lightningEvents.length = 0;
    },
  };
}
`;

export const realdataWeatherImpl: LayerImpl = {
  type: 'realdata-weather',
  validate,
  BROWSER_SOURCE,
  // Weather is biased toward 'lighter' since sunny + stormy benefit most;
  // designer overrides per-instance for rainy/snowy/clear when they want
  // diffuse blend. Phase 0 ships one default; per-condition routing =
  // future Variant 2 schema work.
  DEFAULT_BLEND_MODE: 'lighter',
};
