/**
 * Bridge Integration Test — permanent, in-repo.
 *
 * Run: node packages/editor/src/bridge/bridge.integration.test.mjs
 *
 * Tests that @open-pencil/core accepts SceneGraph data
 * matching our reframe SceneNode shape.
 */

import { SceneGraph, createEditor } from '@open-pencil/core';

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); pass++; }
  else { console.error(`  FAIL: ${msg}`); fail++; }
}

console.log('=== Editor Bridge Integration Test ===\n');

// 1. SceneGraph + nodes (simulates bridge output)
const graph = new SceneGraph();
const page = graph.addPage('Page 1');

const frame = graph.createNode('FRAME', page.id, {
  name: 'Root',
  x: 0, y: 0, width: 1440, height: 800,
  fills: [{ type: 'SOLID', color: { r: 0.04, g: 0.04, b: 0.04, a: 1 }, opacity: 1, visible: true }],
  layoutMode: 'VERTICAL',
  primaryAxisAlign: 'MIN',
  counterAxisAlign: 'MIN',
  paddingTop: 40, paddingRight: 64, paddingBottom: 40, paddingLeft: 64,
  itemSpacing: 24,
  primaryAxisSizing: 'FIXED',
  counterAxisSizing: 'FIXED',
});

const heading = graph.createNode('TEXT', frame.id, {
  name: 'Heading',
  text: 'Design at Scale',
  fontSize: 48, fontWeight: 700, fontFamily: 'Inter',
  fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
  width: 400, height: 60,
  textAlignHorizontal: 'LEFT',
});

const paragraph = graph.createNode('TEXT', frame.id, {
  name: 'Body',
  text: 'Create production designs with AI and export to any format.',
  fontSize: 16, fontWeight: 400, fontFamily: 'Inter',
  fills: [{ type: 'SOLID', color: { r: 0.6, g: 0.6, b: 0.6, a: 1 }, opacity: 1, visible: true }],
  width: 500, height: 24,
  lineHeight: 24,
});

const btnRow = graph.createNode('FRAME', frame.id, {
  name: 'ButtonRow',
  layoutMode: 'HORIZONTAL',
  itemSpacing: 12,
  width: 400, height: 48,
  primaryAxisSizing: 'HUG',
  counterAxisSizing: 'HUG',
});

const btn1 = graph.createNode('FRAME', btnRow.id, {
  name: 'PrimaryBtn',
  width: 160, height: 48, cornerRadius: 8,
  fills: [{ type: 'SOLID', color: { r: 0.145, g: 0.388, b: 0.922, a: 1 }, opacity: 1, visible: true }],
  layoutMode: 'HORIZONTAL',
  primaryAxisAlign: 'CENTER',
  counterAxisAlign: 'CENTER',
});

graph.createNode('TEXT', btn1.id, {
  name: 'BtnLabel',
  text: 'Get Started',
  fontSize: 14, fontWeight: 600,
  fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
  width: 80, height: 20,
});

const btn2 = graph.createNode('FRAME', btnRow.id, {
  name: 'SecondaryBtn',
  width: 140, height: 48, cornerRadius: 8,
  strokes: [{ color: { r: 0.2, g: 0.2, b: 0.2, a: 1 }, weight: 1, opacity: 1, visible: true, align: 'INSIDE' }],
  layoutMode: 'HORIZONTAL',
  primaryAxisAlign: 'CENTER',
  counterAxisAlign: 'CENTER',
});

graph.createNode('TEXT', btn2.id, {
  name: 'Btn2Label',
  text: 'Learn More',
  fontSize: 14, fontWeight: 500,
  fills: [{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8, a: 1 }, opacity: 1, visible: true }],
  width: 80, height: 20,
});

// ── Assertions ──

// Structure
ok(graph.getChildren(frame.id).length === 3, 'Frame has 3 children');
ok(graph.getChildren(btnRow.id).length === 2, 'ButtonRow has 2 children');
ok(graph.getChildren(btn1.id).length === 1, 'PrimaryBtn has 1 child');

// Data integrity
ok(heading.text === 'Design at Scale', 'Heading text correct');
ok(btn1.cornerRadius === 8, 'Button radius correct');
ok(btn2.strokes[0]?.weight === 1, 'Stroke weight correct');

// Editor creation
const editor = createEditor({
  graph,
  getViewportSize: () => ({ width: 1440, height: 900 }),
});

ok(editor.graph === graph, 'Editor owns graph');
ok(editor.state.activeTool === 'SELECT', 'Default tool SELECT');

// Selection
editor.select([frame.id]);
ok(editor.state.selectedIds.size === 1, 'Single select');
ok(editor.getSelectedNode()?.name === 'Root', 'Selected Root');

editor.select([btn1.id, btn2.id]);
ok(editor.state.selectedIds.size === 2, 'Multi-select 2 buttons');
ok(editor.getSelectedNodes().length === 2, 'getSelectedNodes returns 2');

editor.clearSelection();
ok(editor.state.selectedIds.size === 0, 'Cleared');

// Mutation with undo
editor.updateNodeWithUndo(heading.id, { text: 'Ship with Confidence' }, 'Change heading');
ok(graph.getNode(heading.id)?.text === 'Ship with Confidence', 'updateNodeWithUndo works');

// Undo
editor.undoAction();
ok(graph.getNode(heading.id)?.text === 'Design at Scale', 'Undo restored text');

editor.redoAction();
ok(graph.getNode(heading.id)?.text === 'Ship with Confidence', 'Redo re-applied');

// Duplicate
editor.select([btn1.id]);
editor.duplicateSelected();
ok(graph.getChildren(btnRow.id).length === 3, 'Duplicate added child');

// Delete
editor.deleteSelected();
// After delete, the duplicated node is removed (selection was the duplicate)
const afterDelete = graph.getChildren(btnRow.id).length;
ok(afterDelete === 2, `Delete removed node (${afterDelete} children)`);

// Group
editor.select([btn1.id, btn2.id]);
const groupId = editor.groupSelected();
ok(groupId !== null, `groupSelected returned ${groupId}`);
ok(groupId && graph.getNode(groupId)?.type === 'GROUP', 'Created GROUP node');

// Ungroup
editor.ungroupSelected();
ok(graph.getChildren(frame.id).length >= 3, 'Ungroup restored children');

// replaceGraph
const fresh = new SceneGraph();
fresh.addPage('Empty');
editor.replaceGraph(fresh);
ok(editor.graph === fresh, 'replaceGraph swapped');

// API existence checks
ok(typeof editor.applyZoom === 'function', 'applyZoom exists');
ok(typeof editor.zoomToFit === 'function', 'zoomToFit exists');
ok(typeof editor.screenToCanvas === 'function', 'screenToCanvas exists');
ok(typeof editor.pan === 'function', 'pan exists');
ok(typeof editor.createShape === 'function', 'createShape exists');
ok(typeof editor.hitTestAtPoint === 'function', 'hitTestAtPoint exists');
ok(typeof editor.startTextEditing === 'function', 'startTextEditing exists');
ok(typeof editor.commitTextEdit === 'function', 'commitTextEdit exists');
ok(typeof editor.bringToFront === 'function', 'bringToFront exists');
ok(typeof editor.sendToBack === 'function', 'sendToBack exists');
ok(typeof editor.wrapInAutoLayout === 'function', 'wrapInAutoLayout exists');
ok(typeof editor.createComponentFromSelection === 'function', 'createComponent exists');
ok(typeof editor.alignNodes === 'function', 'alignNodes exists');

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
