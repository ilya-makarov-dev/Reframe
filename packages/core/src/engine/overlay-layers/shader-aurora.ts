/**
 * shader-aurora layer — flowing color bands evoking aurora borealis.
 *
 * Three vertical color streams modulated by sine + smooth noise, drift
 * upward and laterally over time. Reads as ambient depth / atmospheric
 * glow — best on dark scenes where the additive blend lets bands
 * brighten without saturating.
 *
 * Different from shader-gradient-flow:
 *   - Aurora has localized stream structure (vertical bands), not a
 *     uniform color sweep
 *   - Additive blend default (luminous overlay)
 *   - Shader is more expressive — multi-octave noise modulation
 *
 * Config:
 *   colors: hex[]                    default ['#00ffaa', '#00aaff', '#aa00ff']
 *                                    must contain exactly 3 entries
 *   intensity: 0..1                  default 0.6  (brightness)
 *   speed: 0..2                      default 0.4  (flow rate)
 *
 * Default blend: 'lighter' — aurora is a luminous effect; additive
 * matches the physical model.
 */

import type { JsonValue } from '../composition.js';
import type { LayerImpl, LayerValidationResult } from './types.js';
import { readNumber, isHexColor } from './utils.js';

const DEFAULT_COLORS = ['#00ffaa', '#00aaff', '#aa00ff'];

function validate(config: Record<string, JsonValue>): LayerValidationResult {
  const colorsRaw = config.colors;
  if (colorsRaw !== undefined && colorsRaw !== null) {
    if (!Array.isArray(colorsRaw)) {
      return { ok: false, param: 'colors', message: 'must be an array of 3 hex strings' };
    }
    if (colorsRaw.length !== 3) {
      return { ok: false, param: 'colors', message: 'must contain exactly 3 hex colors' };
    }
    for (let i = 0; i < 3; i++) {
      if (!isHexColor(colorsRaw[i])) {
        return { ok: false, param: 'colors', message: `colors[${i}] must be a hex color (#abc or #aabbcc)` };
      }
    }
  }
  const intensityRaw = config.intensity;
  if (intensityRaw !== undefined && intensityRaw !== null) {
    if (typeof intensityRaw !== 'number' || !Number.isFinite(intensityRaw) || intensityRaw < 0 || intensityRaw > 1) {
      return { ok: false, param: 'intensity', message: 'must be a finite number in 0..1' };
    }
  }
  const speedRaw = config.speed;
  if (speedRaw !== undefined && speedRaw !== null) {
    if (typeof speedRaw !== 'number' || !Number.isFinite(speedRaw) || speedRaw < 0 || speedRaw > 2) {
      return { ok: false, param: 'speed', message: 'must be a finite number in 0..2' };
    }
  }
  return {
    ok: true,
    resolved: {
      colors: Array.isArray(colorsRaw) && colorsRaw.length === 3
        ? colorsRaw.filter((c): c is string => typeof c === 'string')
        : DEFAULT_COLORS,
      intensity: readNumber(config, 'intensity', 0.6, 0, 1),
      speed: readNumber(config, 'speed', 0.4, 0, 2),
    },
  };
}

const FRAGMENT_SHADER = `
precision mediump float;
varying vec2 v_uv;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_intensity;
uniform float u_speed;
uniform vec3 u_color1;
uniform vec3 u_color2;
uniform vec3 u_color3;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Aurora band: vertical column with sine + noise modulation. centerX
// drifts horizontally; brightness modulated by a vertical envelope plus
// noise turbulence so it flickers like real aurora.
float band(vec2 uv, float centerX, float width, float t) {
  float dx = uv.x - centerX;
  float fall = exp(-dx * dx / (width * width));
  // Vertical envelope: peaks middle-screen, fades top/bottom.
  float vEnv = sin(uv.y * 3.14159) * 0.6 + 0.4;
  // Noise modulation across the band — gives it the flickery flow look.
  float n = noise(vec2(uv.y * 4.0 + t, dx * 6.0));
  return fall * vEnv * (0.5 + 0.5 * n);
}

void main() {
  float t = u_time * u_speed;
  // 3 drifting bands at different x-positions, drifting at different rates.
  float c1Mask = band(v_uv, 0.25 + 0.1 * sin(t * 0.7), 0.18, t);
  float c2Mask = band(v_uv, 0.50 + 0.08 * sin(t * 0.5 + 1.5), 0.20, t * 1.1);
  float c3Mask = band(v_uv, 0.75 + 0.1 * sin(t * 0.6 + 3.0), 0.18, t * 0.9);

  vec3 color = u_color1 * c1Mask + u_color2 * c2Mask + u_color3 * c3Mask;
  color *= u_intensity;
  // Output alpha tracks total brightness so additive blending against
  // the host element behaves predictably.
  float alpha = clamp((c1Mask + c2Mask + c3Mask) * u_intensity, 0.0, 1.0);
  gl_FragColor = vec4(color, alpha);
}
`;

const BROWSER_SOURCE = `
function factory_shader_aurora(canvas, config, baseSize, layerId) {
  var gl = tryGetWebGLContext(canvas);
  if (!gl) { warnShaderUnavailable('shader-aurora'); return makeInertLayer(); }
  var FRAG = ${JSON.stringify(FRAGMENT_SHADER.trim())};
  var program, buffer;
  try {
    program = linkProgram(gl, VERTEX_QUAD_SOURCE, FRAG);
    buffer = setupFullScreenQuad(gl, program);
  } catch (e) {
    console.warn('[reframe-overlay] shader-aurora link failed:', e.message);
    return makeInertLayer();
  }
  var colors = (Array.isArray(config.colors) && config.colors.length === 3) ? config.colors : ['#00ffaa', '#00aaff', '#aa00ff'];
  var intensity = typeof config.intensity === 'number' ? config.intensity : 0.6;
  var speed = typeof config.speed === 'number' ? config.speed : 0.4;
  var c1 = hexToVec3(colors[0]);
  var c2 = hexToVec3(colors[1]);
  var c3 = hexToVec3(colors[2]);

  var uTime = gl.getUniformLocation(program, 'u_time');
  var uRes = gl.getUniformLocation(program, 'u_resolution');
  var uInt = gl.getUniformLocation(program, 'u_intensity');
  var uSpeed = gl.getUniformLocation(program, 'u_speed');
  var uC1 = gl.getUniformLocation(program, 'u_color1');
  var uC2 = gl.getUniformLocation(program, 'u_color2');
  var uC3 = gl.getUniformLocation(program, 'u_color3');

  var w = canvas.width, h = canvas.height;
  gl.viewport(0, 0, w, h);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);  // additive — aurora glows

  return {
    render: function(ctx, time) {
      gl.useProgram(program);
      gl.uniform1f(uTime, time / 1000);
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uInt, intensity);
      gl.uniform1f(uSpeed, speed);
      gl.uniform3f(uC1, c1[0], c1[1], c1[2]);
      gl.uniform3f(uC2, c2[0], c2[1], c2[2]);
      gl.uniform3f(uC3, c3[0], c3[1], c3[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    resize: function(newW, newH) {
      canvas.width = newW;
      canvas.height = newH;
      w = newW; h = newH;
      gl.viewport(0, 0, w, h);
    },
    destroy: function() {
      try { gl.deleteProgram(program); } catch (e) {}
      try { gl.deleteBuffer(buffer); } catch (e) {}
    },
  };
}
`;

export const shaderAuroraImpl: LayerImpl = {
  type: 'shader-aurora',
  validate,
  BROWSER_SOURCE,
  DEFAULT_BLEND_MODE: 'lighter',
};
