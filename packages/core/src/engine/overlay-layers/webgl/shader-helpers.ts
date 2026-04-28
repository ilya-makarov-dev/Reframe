/**
 * Shared WebGL utilities for shader-* overlay layer types (T2 #28).
 *
 * Pure browser-runtime code — never invoked server-side (compile-time
 * validate() doesn't need GL). Inlined into ALL_LAYERS_BROWSER_SOURCE
 * so each shader factory can call compileShader / linkProgram /
 * setupFullScreenQuad / setUniform without re-defining its own copies.
 *
 * ─── Why functions, not classes ─────────────────────────────
 *
 * Functions evaluate cheaper inside `new Function()`. Classes work too
 * but force `this` discipline that isn't needed — we never share state
 * across helper calls. Each shader factory closure owns its own
 * gl/program/buffer references; helpers are pure transforms.
 *
 * ─── Error handling ─────────────────────────────────────────
 *
 * compileShader / linkProgram throw on failure with the GL infoLog
 * attached as message. Caller (shader factory init) catches and
 * downgrades to fallback inert LayerInstance so a malformed shader
 * doesn't crash the whole scene render loop.
 *
 * ─── Color parsing ──────────────────────────────────────────
 *
 * hexToVec3 converts '#aabbcc' / '#abc' to a [r,g,b] float triplet
 * in 0..1 range — what GLSL uniforms want. Not exported as separate
 * utility because OVERLAY_UTILS_BROWSER_SOURCE already has hexToRgb
 * (returns 0..255 ints); this is a thin re-projection.
 */

export const SHADER_HELPERS_BROWSER_SOURCE = `
function compileShader(gl, type, source) {
  var shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    var log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error('shader compile failed: ' + log);
  }
  return shader;
}
function linkProgram(gl, vertexSrc, fragmentSrc) {
  var vs = compileShader(gl, gl.VERTEX_SHADER, vertexSrc);
  var fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);
  var program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    var log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error('program link failed: ' + log);
  }
  // Detach + delete shaders — program retains them. Frees driver memory
  // sooner than waiting for GC.
  gl.detachShader(program, vs);
  gl.detachShader(program, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}
function setupFullScreenQuad(gl, program) {
  // Two triangles covering NDC -1..1.
  var positions = new Float32Array([
    -1, -1,   1, -1,   -1,  1,
    -1,  1,   1, -1,    1,  1,
  ]);
  var buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  var posLoc = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
  return buffer;
}
function hexToVec3(hex) {
  var rgb = hexToRgb(hex);
  return [rgb.r / 255, rgb.g / 255, rgb.b / 255];
}
`;
