/**
 * WebGL fallback — graceful no-op when the browser context fails.
 *
 * Shader layer factories call tryGetWebGLContext() in init(). If the
 * browser refuses (older mobile, headless without WebGL, --disable-webgl
 * flag, GPU process crashed) → null. Factory returns makeInertLayer()
 * which is a no-op LayerInstance: render/resize/destroy all silently
 * pass.
 *
 * Why inert vs throwing:
 *   - Throwing = scene crash. One missing layer breaks the whole overlay.
 *   - Inert = layer invisible but scene renders. User sees the base
 *     scene + any other (non-shader) layers normally.
 *
 * Why the warning is one-time per layer type:
 *   - Spamming console.warn every frame is hostile in prod.
 *   - Once per layer type per page = enough signal for the developer
 *     to investigate; a `__reframeShaderWarnedTypes` Set tracks emitted
 *     warnings inline in the IIFE.
 */

export const SHADER_FALLBACK_BROWSER_SOURCE = `
function tryGetWebGLContext(canvas) {
  try {
    var attrs = { alpha: true, premultipliedAlpha: false, antialias: false };
    var gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
    return gl || null;
  } catch (e) {
    return null;
  }
}
function makeInertLayer() {
  return {
    render: function() {},
    resize: function() {},
    destroy: function() {},
  };
}
function warnShaderUnavailable(typeName) {
  if (!window.__reframeShaderWarnedTypes) window.__reframeShaderWarnedTypes = {};
  if (window.__reframeShaderWarnedTypes[typeName]) return;
  window.__reframeShaderWarnedTypes[typeName] = true;
  console.warn('[reframe-overlay] WebGL unavailable, "' + typeName + '" layer rendering as inert no-op');
}
`;
