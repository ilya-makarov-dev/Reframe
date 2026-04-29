/**
 * realdata-globe layer — 2D orthographic Earth wireframe with city markers.
 *
 * Rotating sphere drawn as longitude / latitude wireframe lines. Cities
 * (lat/lon facts, hand-curated dataset) projected via orthographic
 * projection — visible on the front hemisphere as bright dots, fading
 * on the limb, hidden on the back. Rotation animates the world over
 * configurable period (slow / medium / fast → 60s / 30s / 15s per turn).
 *
 * Why 2D canvas, not WebGL:
 *   - Orthographic projection of ~100 points + ~30 wireframe arcs is
 *     trivially cheap in 2D — well under 1ms/frame even at 1080p.
 *   - WebGL spheres pull in shader pipeline + depth buffer setup that
 *     gains nothing visually for this density.
 *   - 3D textured globe = future signal (designer asks for "real
 *     satellite imagery" — different deps profile, large data weight).
 *
 * Config:
 *   cities:        'top-50' | 'top-100' | 'capitals' | string[]   default 'top-50'
 *   rotationSpeed: 'slow' | 'medium' | 'fast'                     default 'medium'
 *   markerColor:   hex                                            default '#ffaa00'
 *   globeColor:    hex                                            default '#4a90e2'
 *   showLabels:    boolean                                        default false
 *
 * Default blend: 'source-over' — globe is a solid foreground subject,
 * not luminous; additive would wash it out.
 */

import type { JsonValue } from '../composition.js';
import type { LayerImpl, LayerValidationResult } from './types.js';
import { readEnum, isHexColor } from './utils.js';
import { CITIES_DATA, findCityByName } from './realdata/cities-data.js';

const ROTATION_SPEEDS = ['slow', 'medium', 'fast'] as const;
const CITY_PRESETS = ['top-50', 'top-100', 'capitals'] as const;

function validate(config: Record<string, JsonValue>): LayerValidationResult {
  const citiesRaw = config.cities;
  if (citiesRaw !== undefined && citiesRaw !== null) {
    if (typeof citiesRaw === 'string') {
      if (!CITY_PRESETS.includes(citiesRaw as any)) {
        return { ok: false, param: 'cities', message: `must be one of ${CITY_PRESETS.join(', ')} or an array of city names` };
      }
    } else if (Array.isArray(citiesRaw)) {
      for (let i = 0; i < citiesRaw.length; i++) {
        const name = citiesRaw[i];
        if (typeof name !== 'string') {
          return { ok: false, param: 'cities', message: `cities[${i}] must be a string` };
        }
        if (!findCityByName(name)) {
          return { ok: false, param: 'cities', message: `cities[${i}] "${name}" not found in dataset (top-100 cities only)` };
        }
      }
    } else {
      return { ok: false, param: 'cities', message: 'must be a preset string or an array of city names' };
    }
  }
  const speedRaw = config.rotationSpeed;
  if (speedRaw !== undefined && speedRaw !== null) {
    if (typeof speedRaw !== 'string' || !ROTATION_SPEEDS.includes(speedRaw as any)) {
      return { ok: false, param: 'rotationSpeed', message: `must be one of ${ROTATION_SPEEDS.join(', ')}` };
    }
  }
  const markerRaw = config.markerColor;
  if (markerRaw !== undefined && markerRaw !== null) {
    if (typeof markerRaw !== 'string' || !isHexColor(markerRaw)) {
      return { ok: false, param: 'markerColor', message: 'must be a hex color (#abc or #aabbcc)' };
    }
  }
  const globeRaw = config.globeColor;
  if (globeRaw !== undefined && globeRaw !== null) {
    if (typeof globeRaw !== 'string' || !isHexColor(globeRaw)) {
      return { ok: false, param: 'globeColor', message: 'must be a hex color' };
    }
  }
  const showLabelsRaw = config.showLabels;
  if (showLabelsRaw !== undefined && showLabelsRaw !== null) {
    if (typeof showLabelsRaw !== 'boolean') {
      return { ok: false, param: 'showLabels', message: 'must be boolean' };
    }
  }
  return {
    ok: true,
    resolved: {
      cities: typeof citiesRaw === 'string' || Array.isArray(citiesRaw) ? citiesRaw as JsonValue : 'top-50',
      rotationSpeed: readEnum(config, 'rotationSpeed', ROTATION_SPEEDS, 'medium'),
      markerColor: typeof markerRaw === 'string' ? markerRaw : '#ffaa00',
      globeColor: typeof globeRaw === 'string' ? globeRaw : '#4a90e2',
      showLabels: showLabelsRaw === true,
    },
  };
}

// Cities dataset embedded as JSON literal — part of BROWSER_SOURCE so the
// runtime IIFE has it in scope without external fetches.
const CITIES_JSON = JSON.stringify(CITIES_DATA);

const BROWSER_SOURCE = `
var REFRAME_CITIES_DATA = ${CITIES_JSON};
function factory_realdata_globe(canvas, config, baseSize, layerId) {
  var ctx = canvas.getContext('2d');
  var citiesCfg = config.cities || 'top-50';
  var speed = config.rotationSpeed || 'medium';
  var markerColor = config.markerColor || '#ffaa00';
  var globeColor = config.globeColor || '#4a90e2';
  var showLabels = !!config.showLabels;

  // Resolve city subset from preset string or explicit name array.
  var cities;
  if (citiesCfg === 'top-50') cities = REFRAME_CITIES_DATA.slice(0, 50);
  else if (citiesCfg === 'top-100') cities = REFRAME_CITIES_DATA;
  else if (citiesCfg === 'capitals') cities = REFRAME_CITIES_DATA.filter(function(c) { return c.isCapital; });
  else if (Array.isArray(citiesCfg)) {
    var lower = citiesCfg.map(function(s) { return String(s).toLowerCase(); });
    cities = REFRAME_CITIES_DATA.filter(function(c) { return lower.indexOf(c.name.toLowerCase()) !== -1; });
  } else cities = REFRAME_CITIES_DATA.slice(0, 50);

  // Period in ms per full rotation.
  var period = speed === 'slow' ? 60000 : speed === 'fast' ? 15000 : 30000;

  var w = canvas.width, h = canvas.height;

  function project(latDeg, lonDeg, time) {
    // Orthographic projection. World rotates around Y-axis as time advances.
    var rotation = (time / period) * Math.PI * 2;
    var lat = latDeg * Math.PI / 180;
    var lon = lonDeg * Math.PI / 180 + rotation;
    var x = Math.cos(lat) * Math.sin(lon);
    var y = -Math.sin(lat);                  // screen y is down
    var z = Math.cos(lat) * Math.cos(lon);   // > 0 = front hemisphere
    return { x: x, y: y, z: z };
  }

  return {
    render: function(ctx2, time) {
      ctx2.clearRect(0, 0, w, h);
      var cx = w / 2, cy = h / 2;
      var radius = Math.min(w, h) * 0.4;

      // ── Wireframe sphere: latitude + longitude lines ────
      ctx2.strokeStyle = globeColor;
      ctx2.globalAlpha = 0.4;
      ctx2.lineWidth = 1;
      // Latitude lines every 30°.
      for (var lat = -60; lat <= 60; lat += 30) {
        ctx2.beginPath();
        var first = true;
        for (var lon = 0; lon <= 360; lon += 6) {
          var p = project(lat, lon, time);
          if (p.z < -0.05) { first = true; continue; }   // back-hemisphere clip
          var sx = cx + p.x * radius;
          var sy = cy + p.y * radius;
          if (first) { ctx2.moveTo(sx, sy); first = false; }
          else ctx2.lineTo(sx, sy);
        }
        ctx2.stroke();
      }
      // Longitude lines every 30°.
      for (var lonL = 0; lonL < 360; lonL += 30) {
        ctx2.beginPath();
        var firstL = true;
        for (var latL = -90; latL <= 90; latL += 6) {
          var pL = project(latL, lonL, time);
          if (pL.z < -0.05) { firstL = true; continue; }
          var sxL = cx + pL.x * radius;
          var syL = cy + pL.y * radius;
          if (firstL) { ctx2.moveTo(sxL, syL); firstL = false; }
          else ctx2.lineTo(sxL, syL);
        }
        ctx2.stroke();
      }
      // Equator + prime meridian highlight.
      ctx2.globalAlpha = 0.6;
      ctx2.beginPath();
      ctx2.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx2.stroke();

      // ── City markers ────────────────────────────────────
      ctx2.globalAlpha = 1;
      ctx2.fillStyle = markerColor;
      for (var i = 0; i < cities.length; i++) {
        var city = cities[i];
        var pp = project(city.lat, city.lon, time);
        if (pp.z < 0) continue;                              // back hemisphere — hide
        var sx2 = cx + pp.x * radius;
        var sy2 = cy + pp.y * radius;
        // Fade marker on the limb (z near 0) so they don't pop in/out abruptly.
        var alpha = Math.min(1, pp.z * 3);
        ctx2.globalAlpha = alpha;
        ctx2.beginPath();
        ctx2.arc(sx2, sy2, 3, 0, Math.PI * 2);
        ctx2.fill();
        if (showLabels && pp.z > 0.4) {
          ctx2.font = '10px system-ui, sans-serif';
          ctx2.fillText(city.name, sx2 + 5, sy2 + 3);
        }
      }
      ctx2.globalAlpha = 1;
    },
    resize: function(newW, newH) {
      canvas.width = newW;
      canvas.height = newH;
      w = newW; h = newH;
    },
    destroy: function() {
      cities = null;
    },
  };
}
`;

export const realdataGlobeImpl: LayerImpl = {
  type: 'realdata-globe',
  validate,
  BROWSER_SOURCE,
  DEFAULT_BLEND_MODE: 'source-over',
};
