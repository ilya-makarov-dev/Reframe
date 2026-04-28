/**
 * shader-noise-field layer — procedural noise texture via fragment shader.
 *
 * Tinted Perlin-like noise pattern animated over time. Reads as
 * organic texture / atmospheric depth — Linear's homepage backdrop,
 * Vercel's gradient cards, premium product surfaces.
 *
 * Different from noise-grain (#5):
 *   - Smooth gradient noise (perceived organic) vs per-pixel random
 *     (perceived gritty)
 *   - GPU-driven, tinted color interp (white-tinted noise vs grayscale
 *     pixel walking)
 *   - Larger feature scale (10s of pixels vs 1px granularity)
 *
 * Config:
 *   intensity: 0..1                  default 0.5  (contrast)
 *   scale: 0.5..10                   default 2    (noise frequency, higher = finer detail)
 *   speed: 0..2                      default 0.3  (animation rate)
 *   color: hex                       default '#ffffff' (tint)
 *
 * Default blend: 'source-over' — textural overlay on top of base scene.
 */

import type { JsonValue } from '../composition.js';
import type { LayerImpl, LayerValidationResult } from './types.js';
import { readNumber, isHexColor } from './utils.js';

function validate(config: Record<string, JsonValue>): LayerValidationResult {
  const intensityRaw = config.intensity;
  if (intensityRaw !== undefined && intensityRaw !== null) {
    if (typeof intensityRaw !== 'number' || !Number.isFinite(intensityRaw) || intensityRaw < 0 || intensityRaw > 1) {
      return { ok: false, param: 'intensity', message: 'must be a finite number in 0..1' };
    }
  }
  const scaleRaw = config.scale;
  if (scaleRaw !== undefined && scaleRaw !== null) {
    if (typeof scaleRaw !== 'number' || !Number.isFinite(scaleRaw) || scaleRaw < 0.5 || scaleRaw > 10) {
      return { ok: false, param: 'scale', message: 'must be a finite number in 0.5..10' };
    }
  }
  const speedRaw = config.speed;
  if (speedRaw !== undefined && speedRaw !== null) {
    if (typeof speedRaw !== 'number' || !Number.isFinite(speedRaw) || speedRaw < 0 || speedRaw > 2) {
      return { ok: false, param: 'speed', message: 'must be a finite number in 0..2' };
    }
  }
  const colorRaw = config.color;
  if (colorRaw !== undefined && colorRaw !== null) {
    if (typeof colorRaw !== 'string' || !isHexColor(colorRaw)) {
      return { ok: false, param: 'color', message: 'must be a hex color (#abc or #aabbcc)' };
    }
  }
  return {
    ok: true,
    resolved: {
      intensity: readNumber(config, 'intensity', 0.5, 0, 1),
      scale: readNumber(config, 'scale', 2, 0.5, 10),
      speed: readNumber(config, 'speed', 0.3, 0, 2),
      color: typeof colorRaw === 'string' ? colorRaw : '#ffffff',
    },
  };
}

const FRAGMENT_SHADER = `
precision mediump float;
varying vec2 v_uv;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_intensity;
uniform float u_scale;
uniform float u_speed;
uniform vec3 u_tint;

// Smooth noise via 2D hash. Cheap, no permutation tables — fragment-stage
// friendly. Quality is good enough for atmospheric texture; for crisper
// detail bump scale up.
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float smoothNoise(vec2 uv) {
  vec2 i = floor(uv);
  vec2 f = fract(uv);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// Fractal sum (FBM) — 3 octaves enough for textural depth.
float fbm(vec2 uv) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    v += amp * smoothNoise(uv);
    uv *= 2.0;
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = v_uv * u_scale;
  uv.x += u_time * u_speed * 0.05;
  uv.y += u_time * u_speed * 0.03;
  float n = fbm(uv);
  // Apply intensity as contrast around midpoint.
  n = (n - 0.5) * u_intensity + 0.5;
  vec3 color = u_tint * n;
  gl_FragColor = vec4(color, n * u_intensity);
}
`;

const BROWSER_SOURCE = `
function factory_shader_noise_field(canvas, config, baseSize, layerId) {
  var gl = tryGetWebGLContext(canvas);
  if (!gl) { warnShaderUnavailable('shader-noise-field'); return makeInertLayer(); }
  var FRAG = ${JSON.stringify(FRAGMENT_SHADER.trim())};
  var program, buffer;
  try {
    program = linkProgram(gl, VERTEX_QUAD_SOURCE, FRAG);
    buffer = setupFullScreenQuad(gl, program);
  } catch (e) {
    console.warn('[reframe-overlay] shader-noise-field link failed:', e.message);
    return makeInertLayer();
  }
  var intensity = typeof config.intensity === 'number' ? config.intensity : 0.5;
  var scale = typeof config.scale === 'number' ? config.scale : 2;
  var speed = typeof config.speed === 'number' ? config.speed : 0.3;
  var tint = hexToVec3(config.color || '#ffffff');

  var uTime = gl.getUniformLocation(program, 'u_time');
  var uRes = gl.getUniformLocation(program, 'u_resolution');
  var uInt = gl.getUniformLocation(program, 'u_intensity');
  var uScale = gl.getUniformLocation(program, 'u_scale');
  var uSpeed = gl.getUniformLocation(program, 'u_speed');
  var uTint = gl.getUniformLocation(program, 'u_tint');

  var w = canvas.width, h = canvas.height;
  gl.viewport(0, 0, w, h);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  return {
    render: function(ctx, time) {
      gl.useProgram(program);
      gl.uniform1f(uTime, time / 1000);
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uInt, intensity);
      gl.uniform1f(uScale, scale);
      gl.uniform1f(uSpeed, speed);
      gl.uniform3f(uTint, tint[0], tint[1], tint[2]);
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

export const shaderNoiseFieldImpl: LayerImpl = {
  type: 'shader-noise-field',
  validate,
  BROWSER_SOURCE,
  DEFAULT_BLEND_MODE: 'source-over',
};
