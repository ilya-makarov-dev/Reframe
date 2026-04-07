/**
 * reframe info — show engine info.
 */

export function info(): void {
  console.log('');
  console.log('  reframe — Design Computation Engine');
  console.log('  ====================================');
  console.log('');
  console.log('  Version:    0.3.0');
  console.log('  Engine:     Standalone (SceneGraph + Yoga WASM Layout)');
  console.log('  Adapters:   Figma, Standalone, Headless');
  console.log('');
  console.log('  Capabilities:');
  console.log('    - Scene graph (create, clone, group, reparent)');
  console.log('    - Layout engine (Yoga WASM — flex, auto-layout)');
  console.log('    - Constraint-based positioning (MIN, CENTER, MAX, STRETCH, SCALE)');
  console.log('    - Smart scaling (background detection, cluster projection)');
  console.log('    - Text measurement (opentype.js — glyph-level accuracy)');
  console.log('    - Template engine ({{variables}}, data binding, name conventions)');
  console.log('    - Figma REST API import (file → reframe scene)');
  console.log('    - SVG import (SVG → reframe scene)');
  console.log('    - SVG export (scene → vector graphics)');
  console.log('    - PNG export (CanvasKit WASM rasterization)');
  console.log('    - HTML/CSS export (scene → absolute-positioned HTML)');
  console.log('    - Font system (Google Fonts, system fonts, range ops)');
  console.log('');
  console.log('  Strategies:');
  console.log('    smart         Cluster-aware: stretch bg, uniform-scale content');
  console.log('    constraints   Figma-style constraints: MIN/CENTER/MAX/STRETCH/SCALE');
  console.log('    contain       Uniform scale, fit inside target, letterbox');
  console.log('    cover         Uniform scale, fill target, clip overflow');
  console.log('    stretch       Non-uniform scale to exact target');
  console.log('');
  console.log('  Import formats: JSON, Figma REST API, SVG');
  console.log('  Export formats: JSON, SVG, PNG, HTML/CSS');
  console.log('');
}
