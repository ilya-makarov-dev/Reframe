/**
 * INode path parity — reframe_edit (MCP) vs /api/node/edit (Platform UI).
 *
 * Both mutation paths MUST produce identical INode state for the same logical
 * input. Without this, a chat edit and a right-panel edit of the same property
 * drift — canvas desyncs from scene graph, export differs from canvas.
 *
 * Covers the divergences found in the 2026-04-22 /designer-qa sweep:
 *   1. Clamping (opacity>1, negative padding, negative radius, oversized dims)
 *   2. Hex alpha semantics (#RRGGBBAA → opacity field, not color.a)
 *   3. lineHeight / letterSpacing unit (number, not {value, unit})
 *   4. role → semanticRole translation
 *   5. padding shorthand → 4 sides
 *   6. border-color merges with existing stroke (doesn't reset weight)
 *   7. 3-char hex accepted
 *
 * Run: npx tsx packages/mcp/src/tests/inode-path-parity.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import { SceneGraph } from '../../../core/src/engine/scene-graph.js';
import { sanitizeNodePartial } from '../tools/edit.js';
import { cssPropsToNodePartial } from '../platform/api/node-edit.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

function mkGraph(): { graph: SceneGraph; targetId: string } {
  const graph = new SceneGraph();
  const root = graph.createNode('FRAME', '', { name: 'root', width: 800, height: 600 } as any);
  const target = graph.createNode('FRAME', root.id, {
    name: 'card',
    width: 400,
    height: 200,
    paddingTop: 12, paddingRight: 12, paddingBottom: 12, paddingLeft: 12,
    cornerRadius: 8,
    fills: [{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5, a: 1 }, opacity: 1, visible: true }],
    strokes: [{ color: { r: 0, g: 0, b: 0, a: 1 }, weight: 3, opacity: 1, visible: true, align: 'INSIDE' }],
  } as any);
  return { graph, targetId: target.id };
}

function applyToolPath(inputs: Record<string, any>): any {
  const { graph, targetId } = mkGraph();
  const { changes } = sanitizeNodePartial(inputs, { targetId, graph });
  graph.updateNode(targetId, changes);
  return graph.getNode(targetId);
}

function applyUiPath(edits: Record<string, any>): any {
  const { graph, targetId } = mkGraph();
  const node = graph.getNode(targetId);
  const raw = cssPropsToNodePartial(edits, node);
  const { changes } = sanitizeNodePartial(raw, { targetId, graph });
  graph.updateNode(targetId, changes);
  return graph.getNode(targetId);
}

// ── Test 1 — clamping parity ────────────────────────────────
{
  const toolNode = applyToolPath({ opacity: 2.5, paddingTop: -20, cornerRadius: -10, width: 99999 });
  const uiNode = applyUiPath({ opacity: 2.5, 'padding-top': -20, 'border-radius': -10, width: 99999 });
  assert(toolNode.opacity === 1, `tool opacity clamped to 1 (got ${toolNode.opacity})`);
  assert(uiNode.opacity === 1, `ui opacity clamped to 1 (got ${uiNode.opacity})`);
  assert(toolNode.paddingTop === 0, `tool paddingTop clamped to 0 (got ${toolNode.paddingTop})`);
  assert(uiNode.paddingTop === 0, `ui paddingTop clamped to 0 (got ${uiNode.paddingTop})`);
  assert(toolNode.cornerRadius === 0, `tool cornerRadius clamped to 0 (got ${toolNode.cornerRadius})`);
  assert(uiNode.cornerRadius === 0, `ui cornerRadius clamped to 0 (got ${uiNode.cornerRadius})`);
  assert(toolNode.width === 16384, `tool width clamped to 16384 (got ${toolNode.width})`);
  assert(uiNode.width === 16384, `ui width clamped to 16384 (got ${uiNode.width})`);
}

// ── Test 2 — hex alpha semantics parity ─────────────────────
{
  const toolNode = applyToolPath({ fills: ['#FF0000AA'] });
  const uiNode = applyUiPath({ background: '#FF0000AA' });
  const tf = toolNode.fills[0];
  const uf = uiNode.fills[0];
  assert(Math.abs(tf.color.r - 1) < 1e-6 && Math.abs(tf.color.g) < 1e-6 && Math.abs(tf.color.b) < 1e-6,
    `tool fill color = red (got r=${tf.color.r} g=${tf.color.g} b=${tf.color.b})`);
  assert(Math.abs(uf.color.r - 1) < 1e-6 && Math.abs(uf.color.g) < 1e-6 && Math.abs(uf.color.b) < 1e-6,
    `ui fill color = red (got r=${uf.color.r} g=${uf.color.g} b=${uf.color.b})`);
  assert(tf.color.a === 1, `tool color.a = 1, not alpha (got ${tf.color.a})`);
  assert(uf.color.a === 1, `ui color.a = 1, not alpha (got ${uf.color.a})`);
  const alpha = 0xAA / 255;
  assert(Math.abs(tf.opacity - alpha) < 1e-4, `tool opacity = alpha (got ${tf.opacity}, expected ${alpha})`);
  assert(Math.abs(uf.opacity - alpha) < 1e-4, `ui opacity = alpha (got ${uf.opacity}, expected ${alpha})`);
}

// ── Test 3 — 3-char hex accepted on UI path ─────────────────
{
  const toolNode = applyToolPath({ fills: ['#fff'] });
  const uiNode = applyUiPath({ background: '#fff' });
  const tf = toolNode.fills[0], uf = uiNode.fills[0];
  assert(tf.color.r === 1 && tf.color.g === 1 && tf.color.b === 1, `tool 3-char hex = white`);
  assert(uf.color.r === 1 && uf.color.g === 1 && uf.color.b === 1, `ui 3-char hex = white`);
}

// ── Test 4 — lineHeight/letterSpacing are plain numbers ─────
{
  const uiNode = applyUiPath({ 'line-height': 24, 'letter-spacing': 0.5 });
  assert(uiNode.lineHeight === 24 && typeof uiNode.lineHeight === 'number',
    `ui lineHeight is plain number 24 (got ${JSON.stringify(uiNode.lineHeight)})`);
  assert(uiNode.letterSpacing === 0.5 && typeof uiNode.letterSpacing === 'number',
    `ui letterSpacing is plain number 0.5 (got ${JSON.stringify(uiNode.letterSpacing)})`);
}

// ── Test 5 — role → semanticRole on UI path ─────────────────
{
  const uiNode = applyUiPath({ role: 'button' });
  assert(uiNode.semanticRole === 'button',
    `ui role translated to semanticRole (got ${uiNode.semanticRole})`);
  assert(uiNode.role === undefined,
    `ui raw role field NOT written (got ${uiNode.role})`);
}

// ── Test 6 — padding shorthand on UI path ───────────────────
{
  const uiNode = applyUiPath({ padding: 16 });
  assert(uiNode.paddingTop === 16, `ui padding shorthand → top (got ${uiNode.paddingTop})`);
  assert(uiNode.paddingRight === 16, `ui padding shorthand → right (got ${uiNode.paddingRight})`);
  assert(uiNode.paddingBottom === 16, `ui padding shorthand → bottom (got ${uiNode.paddingBottom})`);
  assert(uiNode.paddingLeft === 16, `ui padding shorthand → left (got ${uiNode.paddingLeft})`);
  assert(uiNode.padding === undefined, `ui padding shorthand key removed (got ${uiNode.padding})`);
}

// ── Test 7 — border-color merges, preserves weight ──────────
{
  const uiNode = applyUiPath({ 'border-color': '#ff0000' });
  assert(uiNode.strokes?.[0]?.weight === 3,
    `ui border-color preserves existing weight=3 (got ${uiNode.strokes?.[0]?.weight})`);
  assert(Math.abs(uiNode.strokes?.[0]?.color?.r - 1) < 1e-6,
    `ui border-color set color.r=1 (got ${uiNode.strokes?.[0]?.color?.r})`);
}

// ── Test 8 — border-width merges, preserves color ───────────
{
  const uiNode = applyUiPath({ 'border-width': 5 });
  assert(uiNode.strokes?.[0]?.weight === 5,
    `ui border-width set to 5 (got ${uiNode.strokes?.[0]?.weight})`);
  assert(uiNode.strokes?.[0]?.color?.r === 0 && uiNode.strokes?.[0]?.color?.g === 0,
    `ui border-width preserves existing black color (got ${JSON.stringify(uiNode.strokes?.[0]?.color)})`);
}

// ── Test 9 — full symmetric edit: both paths = same INode ───
{
  const toolNode = applyToolPath({
    paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24,
    fontSize: 18,
    fills: ['#533afd'],
    cornerRadius: 12,
    opacity: 0.9,
  });
  const uiNode = applyUiPath({
    padding: 24,
    'font-size': 18,
    background: '#533afd',
    'border-radius': 12,
    opacity: 0.9,
  });
  assert(toolNode.paddingTop === uiNode.paddingTop, `paddingTop parity (${toolNode.paddingTop} vs ${uiNode.paddingTop})`);
  assert(toolNode.fontSize === uiNode.fontSize, `fontSize parity (${toolNode.fontSize} vs ${uiNode.fontSize})`);
  assert(toolNode.cornerRadius === uiNode.cornerRadius, `cornerRadius parity (${toolNode.cornerRadius} vs ${uiNode.cornerRadius})`);
  assert(toolNode.opacity === uiNode.opacity, `opacity parity (${toolNode.opacity} vs ${uiNode.opacity})`);
  const tf = toolNode.fills[0], uf = uiNode.fills[0];
  assert(Math.abs(tf.color.r - uf.color.r) < 1e-6 &&
    Math.abs(tf.color.g - uf.color.g) < 1e-6 &&
    Math.abs(tf.color.b - uf.color.b) < 1e-6,
    `fill color parity`);
  assert(tf.opacity === uf.opacity, `fill opacity parity (${tf.opacity} vs ${uf.opacity})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
