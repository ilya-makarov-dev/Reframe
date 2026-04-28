/**
 * shader-gradient-flow layer — animated multi-stop gradient via fragment shader.
 *
 * GPU-driven smooth color transitions across the canvas, flowing in a
 * configurable direction. Reads as ambient mood lighting — Stripe
 * payment hero, Vercel marketing, premium SaaS landing.
 *
 * Different from gradient-pulse (#5):
 *   - GPU compute (fragment shader) vs CPU (canvas fillStyle)
 *   - Smoother color interp (per-pixel sin/lerp)
 *   - Perf headroom: 1920x1080 @ 60fps = <1ms GPU work
 *   - Deterministic output across two mounts (pure shader)
 *
 * Config:
 *   colors: hex[]                            default ['#0a2540', '#635bff', '#00d4ff']
 *                                             must contain 2..3 entries
 *   cycle: ms                                default 12000
 *   direction: 0..360 deg                    default 0  (rightward; 90=down)
 *
 * Default blend: 'source-over' — gradient is a background-replacement
 * effect, not a luminous overlay; additive would saturate.
 */

import type { JsonValue } from '../composition.js';
import type { LayerImpl, LayerValidationResult } from './types.js';
import { readNumber, isHexColor } from './utils.js';

const DEFAULT_COLORS = ['#0a2540', '#635bff', '#00d4ff'];

function validate(config: Record<string, JsonValue>): LayerValidationResult {
  const colorsRaw = config.colors;
  if (colorsRaw !== undefined && colorsRaw !== null) {
    if (!Array.isArray(colorsRaw)) {
      return { ok: false, param: 'colors', message: 'must be an array of hex strings' };
    }
    if (colorsRaw.length < 2 || colorsRaw.length > 3) {
      return { ok: false, param: 'colors', message: 'must contain 2 or 3 hex colors' };
    }
    for (let i = 0; i < colorsRaw.length; i++) {
      if (!isHexColor(colorsRaw[i])) {
        return { ok: false, param: 'colors', message: `colors[${i}] must be a hex color (#abc or #aabbcc)` };
      }
    }
  }
  const cycleRaw = config.cycle;
  if (cycleRaw !== undefined && cycleRaw !== null) {
    if (typeof cycleRaw !== 'number' || !Number.isFinite(cycleRaw) || cycleRaw < 100) {
      return { ok: false, param: 'cycle', message: 'must be a finite number ≥ 100 (ms)' };
    }
  }
  const directionRaw = config.direction;
  if (directionRaw !== undefined && directionRaw !== null) {
    if (typeof directionRaw !== 'number' || !Number.isFinite(directionRaw)) {
      return { ok: false, param: 'direction', message: 'must be a finite number (degrees)' };
    }
  }
  let direction = readNumber(config, 'direction', 0);
  direction = ((direction % 360) + 360) % 360;
  return {
    ok: true,
    resolved: {
      colors: Array.isArray(colorsRaw) && colorsRaw.length > 0
        ? colorsRaw.filter((c): c is string => typeof c === 'string')
        : DEFAULT_COLORS,
      cycle: readNumber(config, 'cycle', 12000, 100),
      direction,
    },
  };
}

const FRAGMENT_SHADER = `
precision mediump float;
varying vec2 v_uv;
uniform float u_time;        // seconds since init
uniform vec2 u_resolution;
uniform vec3 u_color1;
uniform vec3 u_color2;
uniform vec3 u_color3;
uniform float u_color_count;  // 2.0 or 3.0
uniform float u_cycle;        // ms
uniform float u_direction;    // radians

void main() {
  // Project uv onto the direction axis → gives a 0..1 progress along
  // the flow direction (with wraparound via fract for loop seamlessness).
  vec2 dir = vec2(cos(u_direction), sin(u_direction));
  float axis = dot(v_uv - 0.5, dir) + 0.5;     // 0..1 along the flow direction
  float phase = mod(u_time * 1000.0 / u_cycle, 1.0);
  float t = fract(axis - phase);

  vec3 color;
  if (u_color_count < 2.5) {
    // 2 colors → smoothstep cycle: c1→c2→c1 over the period.
    float k = sin(t * 6.2831853) * 0.5 + 0.5;
    color = mix(u_color1, u_color2, k);
  } else {
    // 3 colors → tri-stop interp at thirds (cycles).
    float seg = t * 3.0;
    if (seg < 1.0) color = mix(u_color1, u_color2, seg);
    else if (seg < 2.0) color = mix(u_color2, u_color3, seg - 1.0);
    else color = mix(u_color3, u_color1, seg - 2.0);
  }
  gl_FragColor = vec4(color, 1.0);
}
`;

const BROWSER_SOURCE = `
function factory_shader_gradient_flow(canvas, config, baseSize, layerId) {
  var gl = tryGetWebGLContext(canvas);
  if (!gl) { warnShaderUnavailable('shader-gradient-flow'); return makeInertLayer(); }
  var FRAG = ${JSON.stringify(FRAGMENT_SHADER.trim())};
  var program, buffer;
  try {
    program = linkProgram(gl, VERTEX_QUAD_SOURCE, FRAG);
    buffer = setupFullScreenQuad(gl, program);
  } catch (e) {
    console.warn('[reframe-overlay] shader-gradient-flow link failed:', e.message);
    return makeInertLayer();
  }
  var colors = (Array.isArray(config.colors) && config.colors.length >= 2) ? config.colors.slice(0, 3) : ['#0a2540', '#635bff', '#00d4ff'];
  var cycle = typeof config.cycle === 'number' ? config.cycle : 12000;
  var direction = typeof config.direction === 'number' ? config.direction : 0;
  var c1 = hexToVec3(colors[0]);
  var c2 = hexToVec3(colors[1]);
  var c3 = colors.length >= 3 ? hexToVec3(colors[2]) : c2;

  var uTime = gl.getUniformLocation(program, 'u_time');
  var uRes = gl.getUniformLocation(program, 'u_resolution');
  var uC1 = gl.getUniformLocation(program, 'u_color1');
  var uC2 = gl.getUniformLocation(program, 'u_color2');
  var uC3 = gl.getUniformLocation(program, 'u_color3');
  var uCount = gl.getUniformLocation(program, 'u_color_count');
  var uCycle = gl.getUniformLocation(program, 'u_cycle');
  var uDir = gl.getUniformLocation(program, 'u_direction');

  var w = canvas.width, h = canvas.height;
  gl.viewport(0, 0, w, h);

  return {
    render: function(ctx, time) {
      gl.useProgram(program);
      gl.uniform1f(uTime, time / 1000);
      gl.uniform2f(uRes, w, h);
      gl.uniform3f(uC1, c1[0], c1[1], c1[2]);
      gl.uniform3f(uC2, c2[0], c2[1], c2[2]);
      gl.uniform3f(uC3, c3[0], c3[1], c3[2]);
      gl.uniform1f(uCount, colors.length);
      gl.uniform1f(uCycle, cycle);
      gl.uniform1f(uDir, direction * Math.PI / 180);
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

export const shaderGradientFlowImpl: LayerImpl = {
  type: 'shader-gradient-flow',
  validate,
  BROWSER_SOURCE,
  DEFAULT_BLEND_MODE: 'source-over',
};
