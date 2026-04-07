/**
 * Serialization roundtrip tests — full fidelity.
 *
 * Run: npx tsx src/serialize.test.ts
 */

import { SceneGraph } from '../engine/scene-graph.js';
import { ComponentRegistry } from '../engine/component-registry.js';
import type { SceneNode } from '../engine/types.js';
import type { ITimeline } from '../animation/types.js';
import {
  serializeNode, deserializeNode,
  serializeSceneNode, serializeGraph, serializeGraphToString,
  deserializeToGraph, deserializeScene,
  serializeTimeline, deserializeTimeline,
  SERIALIZE_VERSION,
} from '../serialize.js';
import { StandaloneNode } from '../adapters/standalone/node.js';
import { StandaloneHost } from '../adapters/standalone/adapter.js';
import { setHost } from '../host/context.js';

let passed = 0;
let failed = 0;
const sections: string[] = [];

function assert(cond: boolean, msg: string) {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

function section(name: string) {
  sections.push(name);
  console.log(`\n── ${name} ──`);
}

function deepEqual(a: unknown, b: unknown, path = ''): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i], `${path}[${i}]`));
  }
  const aKeys = Object.keys(a as object).sort();
  const bKeys = Object.keys(b as object).sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(k => deepEqual((a as any)[k], (b as any)[k], `${path}.${k}`));
}

// ─── Helpers ──────────────────────────────────────────────────

function createTestGraph(): { graph: SceneGraph; pageId: string } {
  const graph = new SceneGraph();
  const page = graph.addPage('Test');
  return { graph, pageId: page.id };
}

// ─── 1. Basic Geometry Roundtrip ──────────────────────────────

section('Basic geometry roundtrip');
{
  const { graph, pageId } = createTestGraph();
  const frame = graph.createNode('FRAME', pageId, {
    name: 'Root', x: 10, y: 20, width: 300, height: 200,
  });

  const json = serializeSceneNode(graph, frame.id);
  assert(json.id === frame.id, 'id preserved');
  assert(json.name === 'Root', 'name preserved');
  assert(json.type === 'FRAME', 'type preserved');
  assert(json.x === 10, 'x preserved');
  assert(json.y === 20, 'y preserved');
  assert(json.width === 300, 'width preserved');
  assert(json.height === 200, 'height preserved');

  const { graph: g2, rootId } = deserializeToGraph(json);
  const restored = g2.getNode(rootId)!;
  assert(restored.name === 'Root', 'name roundtrip');
  assert(restored.type === 'FRAME', 'type roundtrip');
  assert(restored.x === 10, 'x roundtrip');
  assert(restored.y === 20, 'y roundtrip');
  assert(restored.width === 300, 'width roundtrip');
  assert(restored.height === 200, 'height roundtrip');
}

// ─── 2. Layout Properties ─────────────────────────────────────

section('Layout properties roundtrip');
{
  const { graph, pageId } = createTestGraph();
  const frame = graph.createNode('FRAME', pageId, {
    name: 'Flex', width: 400, height: 300,
    layoutMode: 'HORIZONTAL',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'STRETCH',
    itemSpacing: 16,
    counterAxisSpacing: 8,
    layoutWrap: 'WRAP',
    paddingTop: 10, paddingRight: 20, paddingBottom: 30, paddingLeft: 40,
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FILL',
    clipsContent: true,
  });

  const child = graph.createNode('RECTANGLE', frame.id, {
    name: 'Child', width: 50, height: 50,
    layoutPositioning: 'ABSOLUTE',
    layoutGrow: 1,
    layoutAlignSelf: 'CENTER',
  });

  const json = serializeSceneNode(graph, frame.id);
  const { graph: g2, rootId } = deserializeToGraph(json);
  const f2 = g2.getNode(rootId)!;

  assert(f2.layoutMode === 'HORIZONTAL', 'layoutMode');
  assert(f2.primaryAxisAlign === 'CENTER', 'primaryAxisAlign');
  assert(f2.counterAxisAlign === 'STRETCH', 'counterAxisAlign');
  assert(f2.itemSpacing === 16, 'itemSpacing');
  assert(f2.counterAxisSpacing === 8, 'counterAxisSpacing');
  assert(f2.layoutWrap === 'WRAP', 'layoutWrap');
  assert(f2.paddingTop === 10, 'paddingTop');
  assert(f2.paddingRight === 20, 'paddingRight');
  assert(f2.paddingBottom === 30, 'paddingBottom');
  assert(f2.paddingLeft === 40, 'paddingLeft');
  assert(f2.primaryAxisSizing === 'HUG', 'primaryAxisSizing');
  assert(f2.counterAxisSizing === 'FILL', 'counterAxisSizing');
  assert(f2.clipsContent === true, 'clipsContent');

  const c2 = g2.getNode(f2.childIds[0])!;
  assert(c2.layoutPositioning === 'ABSOLUTE', 'child layoutPositioning');
  assert(c2.layoutGrow === 1, 'child layoutGrow');
  assert(c2.layoutAlignSelf === 'CENTER', 'child layoutAlignSelf');
}

// ─── 3. Visual Properties ─────────────────────────────────────

section('Visual properties roundtrip');
{
  const { graph, pageId } = createTestGraph();
  const rect = graph.createNode('RECTANGLE', pageId, {
    name: 'Styled',
    width: 100, height: 100,
    fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 0.8, visible: true }],
    strokes: [{ color: { r: 0, g: 0, b: 0, a: 1 }, weight: 2, opacity: 1, visible: true, align: 'INSIDE' }],
    effects: [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.5 }, offset: { x: 2, y: 4 }, radius: 8, spread: 0, visible: true }],
    cornerRadius: 12,
    topLeftRadius: 4, topRightRadius: 8, bottomRightRadius: 12, bottomLeftRadius: 16,
    independentCorners: true,
    cornerSmoothing: 0.6,
    opacity: 0.9,
    visible: true,
    rotation: 45,
    blendMode: 'MULTIPLY',
    locked: true,
    flipX: true, flipY: false,
  });

  const json = serializeSceneNode(graph, rect.id);
  const { graph: g2, rootId } = deserializeToGraph(json);
  const r2 = g2.getNode(rootId)!;

  assert(r2.fills.length === 1, 'fills count');
  assert(r2.fills[0].type === 'SOLID', 'fill type');
  assert(r2.fills[0].color.r === 1, 'fill color.r');
  assert(r2.fills[0].opacity === 0.8, 'fill opacity');
  assert(r2.strokes.length === 1, 'strokes count');
  assert(r2.strokes[0].weight === 2, 'stroke weight');
  assert(r2.effects.length === 1, 'effects count');
  assert(r2.effects[0].type === 'DROP_SHADOW', 'effect type');
  assert(r2.cornerRadius === 12, 'cornerRadius');
  assert(r2.topLeftRadius === 4, 'topLeftRadius');
  assert(r2.topRightRadius === 8, 'topRightRadius');
  assert(r2.bottomRightRadius === 12, 'bottomRightRadius');
  assert(r2.bottomLeftRadius === 16, 'bottomLeftRadius');
  assert(r2.independentCorners === true, 'independentCorners');
  assert(r2.cornerSmoothing === 0.6, 'cornerSmoothing');
  assert(r2.opacity === 0.9, 'opacity');
  assert(r2.rotation === 45, 'rotation');
  assert(r2.blendMode === 'MULTIPLY', 'blendMode');
  assert(r2.locked === true, 'locked');
  assert(r2.flipX === true, 'flipX');
}

// ─── 4. Stroke Details ────────────────────────────────────────

section('Stroke details roundtrip');
{
  const { graph, pageId } = createTestGraph();
  const node = graph.createNode('RECTANGLE', pageId, {
    name: 'StrokeDetail',
    width: 100, height: 100,
    strokes: [{ color: { r: 0, g: 0, b: 0, a: 1 }, weight: 1, opacity: 1, visible: true, align: 'CENTER' }],
    strokeCap: 'ROUND',
    strokeJoin: 'BEVEL',
    dashPattern: [5, 3, 2],
    independentStrokeWeights: true,
    borderTopWeight: 1, borderRightWeight: 2, borderBottomWeight: 3, borderLeftWeight: 4,
    strokeMiterLimit: 8,
  });

  const json = serializeSceneNode(graph, node.id);
  const { graph: g2, rootId } = deserializeToGraph(json);
  const n2 = g2.getNode(rootId)!;

  assert(n2.strokeCap === 'ROUND', 'strokeCap');
  assert(n2.strokeJoin === 'BEVEL', 'strokeJoin');
  assert(deepEqual(n2.dashPattern, [5, 3, 2]), 'dashPattern');
  assert(n2.independentStrokeWeights === true, 'independentStrokeWeights');
  assert(n2.borderTopWeight === 1, 'borderTopWeight');
  assert(n2.borderRightWeight === 2, 'borderRightWeight');
  assert(n2.borderBottomWeight === 3, 'borderBottomWeight');
  assert(n2.borderLeftWeight === 4, 'borderLeftWeight');
  assert(n2.strokeMiterLimit === 8, 'strokeMiterLimit');
}

// ─── 5. Text Properties ───────────────────────────────────────

section('Text properties roundtrip');
{
  const { graph, pageId } = createTestGraph();
  const txt = graph.createNode('TEXT', pageId, {
    name: 'Label',
    width: 200, height: 40,
    text: 'Hello World',
    fontSize: 24,
    fontFamily: 'Roboto',
    fontWeight: 700,
    italic: true,
    textAlignHorizontal: 'CENTER',
    textAlignVertical: 'BOTTOM',
    textAutoResize: 'HEIGHT',
    textCase: 'UPPER',
    textDecoration: 'UNDERLINE',
    textTruncation: 'ENDING',
    lineHeight: 32,
    letterSpacing: 1.5,
    maxLines: 3,
  });

  const json = serializeSceneNode(graph, txt.id);
  const { graph: g2, rootId } = deserializeToGraph(json);
  const t2 = g2.getNode(rootId)!;

  assert(t2.text === 'Hello World', 'text content');
  assert(t2.fontSize === 24, 'fontSize');
  assert(t2.fontFamily === 'Roboto', 'fontFamily');
  assert(t2.fontWeight === 700, 'fontWeight');
  assert(t2.italic === true, 'italic');
  assert(t2.textAlignHorizontal === 'CENTER', 'textAlignHorizontal');
  assert(t2.textAlignVertical === 'BOTTOM', 'textAlignVertical');
  assert(t2.textAutoResize === 'HEIGHT', 'textAutoResize');
  assert(t2.textCase === 'UPPER', 'textCase');
  assert(t2.textDecoration === 'UNDERLINE', 'textDecoration');
  assert(t2.textTruncation === 'ENDING', 'textTruncation');
  assert(t2.lineHeight === 32, 'lineHeight');
  assert(t2.letterSpacing === 1.5, 'letterSpacing');
  assert(t2.maxLines === 3, 'maxLines');
}

// ─── 6. Style Runs (Rich Text) ───────────────────────────────

section('Style runs roundtrip');
{
  const { graph, pageId } = createTestGraph();
  const txt = graph.createNode('TEXT', pageId, {
    name: 'RichText',
    width: 300, height: 60,
    text: 'Bold and Italic',
    fontSize: 16,
    fontFamily: 'Inter',
    styleRuns: [
      { start: 0, length: 4, style: { fontWeight: 700 } },
      { start: 9, length: 6, style: { italic: true, fillColor: { r: 1, g: 0, b: 0, a: 1 } } },
    ],
  });

  const json = serializeSceneNode(graph, txt.id);
  assert(json.styleRuns !== undefined, 'styleRuns serialized');
  assert(json.styleRuns!.length === 2, 'styleRuns count');

  const { graph: g2, rootId } = deserializeToGraph(json);
  const t2 = g2.getNode(rootId)!;
  assert(t2.styleRuns.length === 2, 'styleRuns roundtrip count');
  assert(t2.styleRuns[0].start === 0, 'run 0 start');
  assert(t2.styleRuns[0].length === 4, 'run 0 length');
  assert(t2.styleRuns[0].style.fontWeight === 700, 'run 0 bold');
  assert(t2.styleRuns[1].style.italic === true, 'run 1 italic');
}

// ─── 7. Component System ──────────────────────────────────────

section('Component system roundtrip');
{
  const { graph, pageId } = createTestGraph();
  const registry = new ComponentRegistry(graph);

  // Create a button component
  const btnFrame = graph.createNode('FRAME', pageId, {
    name: 'Button', width: 120, height: 40,
    fills: [{ type: 'SOLID', color: { r: 0, g: 0.5, b: 1, a: 1 }, opacity: 1, visible: true }],
  });
  const label = graph.createNode('TEXT', btnFrame.id, {
    name: 'Label', text: 'Click Me', fontSize: 16, fontFamily: 'Inter',
    width: 80, height: 20, x: 20, y: 10,
  });

  // Define as component
  registry.defineComponent(btnFrame.id, 'Button');

  // Create instance
  const instanceId = registry.createInstance(btnFrame.id, pageId, {
    overrides: { 'Label': { text: 'Submit' } },
    x: 200, y: 0,
  });

  // Serialize the whole page subtree — we need a container
  const container = graph.createNode('FRAME', pageId, {
    name: 'Container', width: 500, height: 100,
  });
  // Reparent both into container for serialization
  graph.reparentNode(btnFrame.id, container.id);
  graph.reparentNode(instanceId, container.id);

  const json = serializeSceneNode(graph, container.id);

  // Verify component fields in JSON
  const compJson = json.children![0];
  assert(compJson.type === 'COMPONENT', 'component type in JSON');

  const instJson = json.children![1];
  assert(instJson.type === 'INSTANCE', 'instance type in JSON');
  assert(instJson.componentId === btnFrame.id, 'componentId in JSON');
  assert(instJson.overrides !== undefined, 'overrides in JSON');

  // Roundtrip
  const { graph: g2, rootId } = deserializeToGraph(json);
  const root2 = g2.getNode(rootId)!;

  const comp2 = g2.getNode(root2.childIds[0])!;
  assert(comp2.type === 'COMPONENT', 'component type roundtrip');
  assert(comp2.name === 'Button', 'component name roundtrip');

  const inst2 = g2.getNode(root2.childIds[1])!;
  assert(inst2.type === 'INSTANCE', 'instance type roundtrip');
  assert(inst2.componentId !== null, 'componentId roundtrip not null');
  assert(Object.keys(inst2.overrides).length > 0, 'overrides roundtrip');

  // Instance index should be rebuilt
  const instances = g2.getInstances(inst2.componentId!);
  assert(instances.length >= 1, 'instance index rebuilt');
}

// ─── 8. Component Set (Variants) ─────────────────────────────

section('Component set / variants roundtrip');
{
  const { graph, pageId } = createTestGraph();
  const registry = new ComponentRegistry(graph);

  // Create two variant components
  const sm = graph.createNode('FRAME', pageId, { name: 'Button/sm', width: 80, height: 32 });
  const lg = graph.createNode('FRAME', pageId, { name: 'Button/lg', width: 160, height: 48 });
  registry.defineComponent(sm.id);
  registry.defineComponent(lg.id);
  graph.updateNode(sm.id, { variantProperties: { size: 'sm' } });
  graph.updateNode(lg.id, { variantProperties: { size: 'lg' }, isDefaultVariant: true });

  const setId = registry.defineComponentSet('Button', [sm.id, lg.id], [
    { name: 'size', type: 'VARIANT', defaultValue: 'lg', variantOptions: ['sm', 'lg'] },
  ]);

  const json = serializeSceneNode(graph, setId);
  assert(json.type === 'COMPONENT_SET', 'set type');
  assert(json.componentPropertyDefinitions !== undefined, 'propertyDefs present');
  assert(json.componentPropertyDefinitions!.length === 1, 'one propertyDef');
  assert(json.componentPropertyDefinitions![0].name === 'size', 'propertyDef name');

  const smJson = json.children!.find(c => c.name === 'Button/sm')!;
  assert(smJson.variantProperties !== undefined, 'sm variantProperties');
  assert(smJson.variantProperties!.size === 'sm', 'sm variant = sm');

  const lgJson = json.children!.find(c => c.name === 'Button/lg')!;
  assert(lgJson.isDefaultVariant === true, 'lg isDefaultVariant');

  // Roundtrip
  const { graph: g2, rootId } = deserializeToGraph(json);
  const set2 = g2.getNode(rootId)!;
  assert(set2.type === 'COMPONENT_SET', 'set type roundtrip');
  assert(set2.componentPropertyDefinitions !== null, 'propertyDefs roundtrip');
  assert(set2.componentPropertyDefinitions!.length === 1, 'propertyDefs count roundtrip');

  const variants = set2.childIds.map(id => g2.getNode(id)!);
  const smVariant = variants.find(v => v.variantProperties.size === 'sm');
  const lgVariant = variants.find(v => v.variantProperties.size === 'lg');
  assert(smVariant !== undefined, 'sm variant roundtrip');
  assert(lgVariant !== undefined, 'lg variant roundtrip');
  assert(lgVariant!.isDefaultVariant === true, 'isDefaultVariant roundtrip');
}

// ─── 9. Vector & Mask ─────────────────────────────────────────

section('Vector & mask roundtrip');
{
  const { graph, pageId } = createTestGraph();
  const vec = graph.createNode('VECTOR', pageId, {
    name: 'Arrow', width: 24, height: 24,
    vectorNetwork: {
      vertices: [
        { x: 0, y: 12 },
        { x: 24, y: 12 },
        { x: 18, y: 6 },
      ],
      segments: [
        { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
        { start: 1, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
      ],
      regions: [],
    },
    isMask: true,
    maskType: 'LUMINANCE',
  });

  const json = serializeSceneNode(graph, vec.id);
  assert(json.vectorNetwork !== undefined, 'vectorNetwork serialized');
  assert(json.isMask === true, 'isMask serialized');
  assert(json.maskType === 'LUMINANCE', 'maskType serialized');

  const { graph: g2, rootId } = deserializeToGraph(json);
  const v2 = g2.getNode(rootId)!;
  assert(v2.vectorNetwork !== null, 'vectorNetwork roundtrip');
  assert(v2.vectorNetwork!.vertices.length === 3, 'vertices count');
  assert(v2.vectorNetwork!.segments.length === 2, 'segments count');
  assert(v2.isMask === true, 'isMask roundtrip');
  assert(v2.maskType === 'LUMINANCE', 'maskType roundtrip');
}

// ─── 10. Arc Data (Ellipse) ──────────────────────────────────

section('Arc data roundtrip');
{
  const { graph, pageId } = createTestGraph();
  const ellipse = graph.createNode('ELLIPSE', pageId, {
    name: 'Pie', width: 100, height: 100,
    arcData: { startingAngle: 0, endingAngle: Math.PI, innerRadius: 0.5 },
  });

  const json = serializeSceneNode(graph, ellipse.id);
  assert(json.arcData !== undefined, 'arcData serialized');

  const { graph: g2, rootId } = deserializeToGraph(json);
  const e2 = g2.getNode(rootId)!;
  assert(e2.arcData !== null, 'arcData roundtrip');
  assert(Math.abs(e2.arcData!.endingAngle - Math.PI) < 0.001, 'endingAngle');
  assert(e2.arcData!.innerRadius === 0.5, 'innerRadius');
}

// ─── 11. Grid Layout ──────────────────────────────────────────

section('Grid layout roundtrip');
{
  const { graph, pageId } = createTestGraph();
  const grid = graph.createNode('FRAME', pageId, {
    name: 'Grid', width: 400, height: 300,
    layoutMode: 'GRID',
    gridTemplateColumns: [
      { type: 'FR', value: 1 },
      { type: 'FR', value: 2 },
      { type: 'FIXED', value: 100 },
    ],
    gridTemplateRows: [
      { type: 'AUTO', value: 0 },
      { type: 'FR', value: 1 },
    ],
    gridColumnGap: 16,
    gridRowGap: 8,
  });

  const child = graph.createNode('RECTANGLE', grid.id, {
    name: 'Cell', width: 50, height: 50,
    gridPosition: { column: 1, row: 0, columnSpan: 2, rowSpan: 1 },
  });

  const json = serializeSceneNode(graph, grid.id);
  assert(json.gridTemplateColumns!.length === 3, 'grid cols count');
  assert(json.gridColumnGap === 16, 'gridColumnGap');

  const { graph: g2, rootId } = deserializeToGraph(json);
  const g2root = g2.getNode(rootId)!;
  assert(g2root.gridTemplateColumns.length === 3, 'grid cols roundtrip');
  assert(g2root.gridTemplateRows.length === 2, 'grid rows roundtrip');
  assert(g2root.gridColumnGap === 16, 'gridColumnGap roundtrip');
  assert(g2root.gridRowGap === 8, 'gridRowGap roundtrip');

  const c2 = g2.getNode(g2root.childIds[0])!;
  assert(c2.gridPosition !== null, 'gridPosition roundtrip');
  assert(c2.gridPosition!.columnSpan === 2, 'gridPosition.columnSpan');
}

// ─── 12. Size Constraints ─────────────────────────────────────

section('Size constraints roundtrip');
{
  const { graph, pageId } = createTestGraph();
  const node = graph.createNode('FRAME', pageId, {
    name: 'Constrained', width: 200, height: 100,
    minWidth: 50, maxWidth: 400,
    minHeight: 30, maxHeight: 300,
  });

  const json = serializeSceneNode(graph, node.id);
  assert(json.minWidth === 50, 'minWidth in JSON');
  assert(json.maxWidth === 400, 'maxWidth in JSON');

  const { graph: g2, rootId } = deserializeToGraph(json);
  const n2 = g2.getNode(rootId)!;
  assert(n2.minWidth === 50, 'minWidth roundtrip');
  assert(n2.maxWidth === 400, 'maxWidth roundtrip');
  assert(n2.minHeight === 30, 'minHeight roundtrip');
  assert(n2.maxHeight === 300, 'maxHeight roundtrip');
}

// ─── 13. Bound Variables ──────────────────────────────────────

section('Bound variables roundtrip');
{
  const { graph, pageId } = createTestGraph();
  const node = graph.createNode('TEXT', pageId, {
    name: 'BoundText', text: 'Dynamic', fontSize: 16, fontFamily: 'Inter',
    width: 100, height: 20,
    boundVariables: { text: 'var_headline', fontSize: 'var_size' },
  });

  const json = serializeSceneNode(graph, node.id);
  assert(json.boundVariables !== undefined, 'boundVariables in JSON');
  assert(json.boundVariables!.text === 'var_headline', 'boundVar text');

  const { graph: g2, rootId } = deserializeToGraph(json);
  const n2 = g2.getNode(rootId)!;
  assert(n2.boundVariables.text === 'var_headline', 'boundVar text roundtrip');
  assert(n2.boundVariables.fontSize === 'var_size', 'boundVar fontSize roundtrip');
}

// ─── 14. Constraints → Engine Fields ──────────────────────────

section('Constraints normalization');
{
  const { graph, pageId } = createTestGraph();
  const node = graph.createNode('RECTANGLE', pageId, {
    name: 'Constrained', width: 100, height: 100,
    horizontalConstraint: 'STRETCH',
    verticalConstraint: 'CENTER',
  });

  const json = serializeSceneNode(graph, node.id);
  assert(json.constraints !== undefined, 'constraints in JSON');
  assert(json.constraints!.horizontal === 'STRETCH', 'horizontal constraint');
  assert(json.constraints!.vertical === 'CENTER', 'vertical constraint');

  const { graph: g2, rootId } = deserializeToGraph(json);
  const n2 = g2.getNode(rootId)!;
  assert(n2.horizontalConstraint === 'STRETCH', 'horizontalConstraint roundtrip');
  assert(n2.verticalConstraint === 'CENTER', 'verticalConstraint roundtrip');
}

// ─── 15. Deep Tree ────────────────────────────────────────────

section('Deep tree roundtrip');
{
  const { graph, pageId } = createTestGraph();
  const root = graph.createNode('FRAME', pageId, { name: 'Root', width: 400, height: 400 });
  const child1 = graph.createNode('FRAME', root.id, { name: 'Child1', width: 200, height: 200, x: 0, y: 0 });
  const child2 = graph.createNode('FRAME', root.id, { name: 'Child2', width: 200, height: 200, x: 200, y: 0 });
  const grandchild = graph.createNode('TEXT', child1.id, {
    name: 'Label', text: 'Nested', fontSize: 14, fontFamily: 'Inter',
    width: 100, height: 20, x: 10, y: 10,
  });

  const json = serializeSceneNode(graph, root.id);
  assert(json.children!.length === 2, 'root has 2 children');
  assert(json.children![0].children!.length === 1, 'child1 has 1 child');
  assert(json.children![0].children![0].name === 'Label', 'grandchild name');

  const { graph: g2, rootId } = deserializeToGraph(json);
  const r2 = g2.getNode(rootId)!;
  assert(r2.childIds.length === 2, 'children count roundtrip');
  const c1 = g2.getNode(r2.childIds[0])!;
  assert(c1.childIds.length === 1, 'grandchildren count roundtrip');
  const gc = g2.getNode(c1.childIds[0])!;
  assert(gc.name === 'Label', 'grandchild name roundtrip');
  assert(gc.text === 'Nested', 'grandchild text roundtrip');
}

// ─── 16. SceneJSON Envelope ───────────────────────────────────

section('SceneJSON envelope');
{
  const { graph, pageId } = createTestGraph();
  const frame = graph.createNode('FRAME', pageId, { name: 'Root', width: 300, height: 200 });

  // Add an image
  const imageData = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG header
  graph.images.set('abc123', imageData);

  const timeline: ITimeline = {
    name: 'intro',
    duration: 1000,
    loop: false,
    speed: 1,
    animations: [{
      nodeId: frame.id,
      name: 'fadeIn',
      duration: 500,
      delay: 0,
      keyframes: [
        { offset: 0, properties: { opacity: 0 } },
        { offset: 1, properties: { opacity: 1 } },
      ],
    }],
  };

  const sceneJson = serializeGraph(graph, frame.id, { timeline });

  assert(sceneJson.version === SERIALIZE_VERSION, 'version in envelope');
  assert(sceneJson.root.id === frame.id, 'root id');
  assert(sceneJson.timeline !== undefined, 'timeline in envelope');
  assert(sceneJson.timeline!.animations.length === 1, 'timeline animation count');
  assert(sceneJson.images !== undefined, 'images in envelope');
  assert(sceneJson.images!['abc123'] !== undefined, 'image hash present');

  // Full roundtrip
  const restored = deserializeScene(sceneJson);
  assert(restored.graph.images.has('abc123'), 'image restored');
  assert(restored.graph.images.get('abc123')!.length === 8, 'image data length');
  assert(restored.timeline !== undefined, 'timeline restored');
  assert(restored.timeline!.animations.length === 1, 'timeline anims restored');
  assert(restored.timeline!.name === 'intro', 'timeline name');
}

// ─── 17. Compact Mode Defaults ────────────────────────────────

section('Compact mode skips defaults');
{
  const { graph, pageId } = createTestGraph();
  const node = graph.createNode('FRAME', pageId, {
    name: 'Default', width: 100, height: 100,
    // All defaults — should be omitted in compact mode
  });

  const compact = serializeSceneNode(graph, node.id, { compact: true });
  const full = serializeSceneNode(graph, node.id, { compact: false });

  assert(compact.layoutMode === undefined, 'compact: layoutMode omitted');
  assert(compact.opacity === undefined, 'compact: opacity omitted');
  assert(compact.visible === undefined, 'compact: visible omitted');
  assert(compact.rotation === undefined, 'compact: rotation omitted');

  assert(full.layoutMode !== undefined, 'full: layoutMode present');
  assert(full.opacity !== undefined, 'full: opacity present');
  assert(full.visible !== undefined, 'full: visible present');
}

// ─── 18. Compact Still Includes Non-defaults ──────────────────

section('Compact mode preserves non-defaults');
{
  const { graph, pageId } = createTestGraph();
  const node = graph.createNode('FRAME', pageId, {
    name: 'NonDefault', width: 100, height: 100,
    opacity: 0.5, rotation: 30, layoutMode: 'VERTICAL',
    locked: true, flipX: true,
  });

  const compact = serializeSceneNode(graph, node.id, { compact: true });
  assert(compact.opacity === 0.5, 'compact: non-default opacity');
  assert(compact.rotation === 30, 'compact: non-default rotation');
  assert(compact.layoutMode === 'VERTICAL', 'compact: non-default layoutMode');
  assert(compact.locked === true, 'compact: non-default locked');
  assert(compact.flipX === true, 'compact: non-default flipX');
}

// ─── 19. INode Path Backward Compat ──────────────────────────

section('INode serialize backward compat');
{
  const { graph, pageId } = createTestGraph();
  const host = new StandaloneHost(graph);
  setHost(host);

  const frame = graph.createNode('FRAME', pageId, {
    name: 'Old', width: 200, height: 100,
    fills: [{ type: 'SOLID', color: { r: 0, g: 1, b: 0, a: 1 }, opacity: 1, visible: true }],
  });
  const rawFrame = graph.getNode(frame.id)!;
  const inode = new StandaloneNode(graph, rawFrame);

  // Old path still works
  const json = serializeNode(inode);
  assert(json.name === 'Old', 'INode serialize name');
  assert(json.type === 'FRAME', 'INode serialize type');

  const restored = deserializeNode(json);
  assert(restored.name === 'Old', 'INode deserialize name');
  assert(restored.width === 200, 'INode deserialize width');
}

// ─── 20. Double Roundtrip Stability ──────────────────────────

section('Double roundtrip stability');
{
  const { graph, pageId } = createTestGraph();
  const root = graph.createNode('FRAME', pageId, {
    name: 'Stable', width: 500, height: 300,
    layoutMode: 'HORIZONTAL', itemSpacing: 12,
    fills: [{ type: 'SOLID', color: { r: 0.2, g: 0.3, b: 0.4, a: 1 }, opacity: 1, visible: true }],
  });
  graph.createNode('TEXT', root.id, {
    name: 'Title', text: 'Stability', fontSize: 32, fontFamily: 'Roboto',
    fontWeight: 700, width: 200, height: 40,
  });

  // First roundtrip
  const json1 = serializeSceneNode(graph, root.id, { compact: false });
  const { graph: g2, rootId: r2 } = deserializeToGraph(json1);

  // Second roundtrip
  const json2 = serializeSceneNode(g2, r2, { compact: false });

  // Compare — should be identical except for IDs (which are regenerated)
  assert(json1.name === json2.name, 'double roundtrip name');
  assert(json1.width === json2.width, 'double roundtrip width');
  assert(json1.layoutMode === json2.layoutMode, 'double roundtrip layoutMode');
  assert(json1.itemSpacing === json2.itemSpacing, 'double roundtrip itemSpacing');
  assert(json1.children!.length === json2.children!.length, 'double roundtrip children count');
  assert(json1.children![0].name === json2.children![0].name, 'double roundtrip child name');
  assert(json1.children![0].text === json2.children![0].text, 'double roundtrip child text');
  assert(json1.children![0].fontWeight === json2.children![0].fontWeight, 'double roundtrip fontWeight');
}

// ─── 21. Timeline Serialization ──────────────────────────────

section('Timeline serialization');
{
  const timeline: ITimeline = {
    name: 'complex',
    duration: 2000,
    loop: true,
    speed: 1.5,
    animations: [
      {
        nodeId: 'node1',
        nodeName: 'Title',
        name: 'slideIn',
        duration: 800,
        delay: 200,
        iterations: 1,
        direction: 'normal',
        fillMode: 'both',
        keyframes: [
          { offset: 0, properties: { x: -100, opacity: 0 }, easing: 'ease-out' },
          { offset: 1, properties: { x: 0, opacity: 1 } },
        ],
      },
      {
        nodeId: 'node2',
        name: 'bounce',
        duration: 600,
        delay: 500,
        iterations: Infinity,
        direction: 'alternate',
        keyframes: [
          { offset: 0, properties: { scaleY: 1 }, easing: [0.68, -0.55, 0.265, 1.55] },
          { offset: 1, properties: { scaleY: 1.2 } },
        ],
      },
    ],
  };

  const json = serializeTimeline(timeline);
  assert(json.name === 'complex', 'timeline name');
  assert(json.loop === true, 'timeline loop');
  assert(json.speed === 1.5, 'timeline speed');
  assert(json.animations.length === 2, 'timeline anim count');

  const restored = deserializeTimeline(json);
  assert(restored.name === 'complex', 'timeline name roundtrip');
  assert(restored.animations[0].delay === 200, 'anim delay roundtrip');
  assert(restored.animations[1].direction === 'alternate', 'anim direction roundtrip');
}

// ─── 22. Special Node Types ──────────────────────────────────

section('Special node types (STAR, POLYGON)');
{
  const { graph, pageId } = createTestGraph();
  const star = graph.createNode('STAR', pageId, {
    name: 'Star', width: 48, height: 48,
    pointCount: 5,
    starInnerRadius: 0.38,
  });

  const json = serializeSceneNode(graph, star.id);
  assert(json.pointCount === 5, 'pointCount serialized');
  assert(json.starInnerRadius === 0.38, 'starInnerRadius serialized');

  const { graph: g2, rootId } = deserializeToGraph(json);
  const s2 = g2.getNode(rootId)!;
  assert(s2.pointCount === 5, 'pointCount roundtrip');
  assert(s2.starInnerRadius === 0.38, 'starInnerRadius roundtrip');
}

// ─── Results ──────────────────────────────────────────────────

console.log('\n═══════════════════════════════');
console.log(`Serialize tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('SOME TESTS FAILED');
  process.exit(1);
} else {
  console.log('ALL TESTS PASSED');
}
