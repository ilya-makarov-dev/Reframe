/**
 * Shared full-screen vertex shader for all shader-* overlay layer types.
 *
 * Two triangles covering NDC space (-1..1 on both axes) — no transform,
 * no projection. Fragment shaders sample uv ∈ [0,1] in v_uv to produce
 * their effects.
 *
 * Inlined into BROWSER_SOURCE as a JS string constant so the runtime
 * IIFE has it in scope (compileShader / linkProgram read VERTEX_QUAD_SOURCE
 * variable name when calling out to the helpers).
 */

export const VERTEX_QUAD_SOURCE = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = (a_position + 1.0) * 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`.trim();

/**
 * BROWSER_SOURCE fragment that exposes VERTEX_QUAD_SOURCE as a top-level
 * `var` for shader factories to reference during program linking. Kept as
 * a separate emission so the helpers file stays focused on functions
 * (helpers concatenated AFTER this constant declaration).
 */
export const VERTEX_QUAD_BROWSER_SOURCE = `
var VERTEX_QUAD_SOURCE = ${JSON.stringify(VERTEX_QUAD_SOURCE)};
`;
