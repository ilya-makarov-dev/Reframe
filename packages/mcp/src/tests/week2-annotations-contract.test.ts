/**
 * Week 2 #1 Annotations — scene-level side-channel contract.
 *
 * Covers all 10 exit criteria: CRUD ops + envelope round-trip + exporter
 * emission (HTML / React / SVG) + error codes on bad inputs.
 *
 * Run: npx tsx packages/mcp/src/tests/week2-annotations-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import { handleCompile } from '../tools/compile.js';
import { handleEdit } from '../tools/edit.js';
import { getScene, getSessionId } from '../store.js';
import { exportToHtml } from '../../../core/src/exporters/html.js';
import { exportToReact } from '../../../core/src/exporters/react.js';
import { exportSceneGraphToSvg } from '../../../core/src/exporters/svg.js';
import { StandaloneHost } from '../../../core/src/adapters/standalone/adapter.js';
import { StandaloneNode } from '../../../core/src/adapters/standalone/node.js';
import { setHost } from '../../../core/src/host/context.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

function extractError(result: any): { code?: string; message?: string; details?: any } | null {
  if (!result?.isError) return null;
  const jsonText = result.content?.[1]?.text;
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText);
    if (parsed.kind === 'reframe.toolError') {
      return { code: parsed.code, message: parsed.message, details: parsed.details };
    }
  } catch { /* not structured */ }
  return null;
}

const sceneHtml =
  '<div style="width:400px;padding:40px;background:#fff;color:#000">' +
    '<h1 style="font-size:32px;margin:0">Hello</h1>' +
    '<p style="margin-top:16px">Body text</p>' +
    '<button style="margin-top:24px;padding:12px 20px;background:#000;color:#fff">Click</button>' +
  '</div>';

async function compileScene(name: string): Promise<{ sessionId: string; nodes: Array<{ id: string; type: string; name: string }> }> {
  const result = await handleCompile({ html: sceneHtml, name, audit: false, preview: false, exports: ['html'] } as any);
  const text = (result as any).content?.[0]?.text ?? '';
  // Match "Scenes: s15" at the end OR the first "s<N> \"..." line.
  const sessionId = text.match(/Scenes?:\s*(s\d+)/)?.[1]
    ?? text.match(/\bs(\d+)\b\s+"/)?.[0]?.trim().split(/\s+/)[0]
    ?? getSessionId(name) ?? '';
  const stored = sessionId ? getScene(sessionId) : (getSessionId(name) ? getScene(getSessionId(name)!) : undefined);
  if (!stored) throw new Error(`compileScene: no session for ${name} (looked up via ${sessionId || 'slug'})`);
  const nodes: Array<{ id: string; type: string; name: string }> = [];
  function walk(id: string): void {
    const n = stored.graph.getNode(id);
    if (!n) return;
    nodes.push({ id: n.id, type: n.type, name: n.name });
    for (const c of n.childIds) walk(c);
  }
  walk(stored.rootId);
  return { sessionId, nodes };
}

// ─── TEST 1: compile scene then annotate — ops + envelope persist ──
async function testAnnotateHappyPath(): Promise<void> {
  const { sessionId, nodes } = await compileScene('anno-happy');
  const textNode = nodes.find((n) => n.type === 'TEXT');
  if (!textNode) { assert(false, 'happy: no TEXT node to annotate'); return; }

  const result = await handleEdit({
    operations: [
      {
        op: 'annotate',
        sceneId: sessionId,
        targetNodeId: textNode.id,
        text: 'This is the hero line',
        anchor: 'ne',
        severity: 'info',
        author: 'critic',
      },
    ],
  } as any);
  assert(!(result as any).isError, 'happy: annotate should succeed');

  const stored = getScene(sessionId)!;
  assert(stored.graph.annotations.length === 1, `happy: annotations array length = ${stored.graph.annotations.length}`);
  const a = stored.graph.annotations[0];
  assert(a.targetNodeId === textNode.id, 'happy: targetNodeId roundtrips');
  assert(a.text === 'This is the hero line', 'happy: text roundtrips');
  assert(a.anchor === 'ne', 'happy: anchor roundtrips');
  assert(a.severity === 'info', 'happy: severity roundtrips');
  assert(a.author === 'critic', 'happy: author roundtrips');
  assert(typeof a.id === 'string' && a.id.startsWith('a:'), `happy: id format = ${a.id}`);
  assert(typeof a.createdAt === 'string' && a.createdAt.length > 0, 'happy: createdAt set');
  assert(a.resolved === false, 'happy: resolved defaults to false');
}

// ─── TEST 2: error on nonexistent targetNodeId ───────────────
async function testAnnotateBadTarget(): Promise<void> {
  const { sessionId } = await compileScene('anno-bad-target');
  const result = await handleEdit({
    operations: [
      {
        op: 'annotate',
        sceneId: sessionId,
        targetNodeId: 'nonexistent:does-not-exist',
        text: 'Note',
        anchor: 'top',
      },
    ],
  } as any);
  const err = extractError(result);
  assert(err !== null, 'bad target: result should be isError');
  assert(err?.code === 'edit.annotate.target_not_found', `bad target: code was ${err?.code}`);
}

// ─── TEST 3: updateAnnotation patches fields, preserves rest ─
async function testUpdateAnnotation(): Promise<void> {
  const { sessionId, nodes } = await compileScene('anno-update');
  const target = nodes.find((n) => n.type === 'TEXT')!;
  await handleEdit({
    operations: [{ op: 'annotate', sceneId: sessionId, targetNodeId: target.id, text: 'v1', anchor: 'nw', severity: 'info' }],
  } as any);
  const stored = getScene(sessionId)!;
  const annoId = stored.graph.annotations[0].id;

  const upd = await handleEdit({
    operations: [{ op: 'updateAnnotation', sceneId: sessionId, annotationId: annoId, text: 'v2 revised', severity: 'warn', resolved: true }],
  } as any);
  assert(!(upd as any).isError, 'update: should succeed');

  const after = stored.graph.annotations[0];
  assert(after.text === 'v2 revised', `update: text patched (got ${after.text})`);
  assert(after.severity === 'warn', 'update: severity patched');
  assert(after.resolved === true, 'update: resolved patched');
  assert(after.anchor === 'nw', 'update: unchanged field anchor preserved');
  assert(after.targetNodeId === target.id, 'update: unchanged field targetNodeId preserved');
}

// ─── TEST 4: updateAnnotation on missing id throws ───────────
async function testUpdateMissing(): Promise<void> {
  const { sessionId } = await compileScene('anno-update-missing');
  const res = await handleEdit({
    operations: [{ op: 'updateAnnotation', sceneId: sessionId, annotationId: 'a:does-not-exist', text: 'x' }],
  } as any);
  const err = extractError(res);
  assert(err !== null, 'update missing: should isError');
  assert(err?.code === 'edit.annotation.not_found', `update missing: code was ${err?.code}`);
}

// ─── TEST 5: removeAnnotation deletes by id ───────────────────
async function testRemoveAnnotation(): Promise<void> {
  const { sessionId, nodes } = await compileScene('anno-remove');
  const target = nodes.find((n) => n.type === 'TEXT')!;
  await handleEdit({
    operations: [
      { op: 'annotate', sceneId: sessionId, targetNodeId: target.id, text: 'a', anchor: 'se' },
      { op: 'annotate', sceneId: sessionId, targetNodeId: target.id, text: 'b', anchor: 'sw' },
    ],
  } as any);
  const stored = getScene(sessionId)!;
  assert(stored.graph.annotations.length === 2, 'remove: 2 annotations before remove');
  const secondId = stored.graph.annotations[1].id;

  const res = await handleEdit({
    operations: [{ op: 'removeAnnotation', sceneId: sessionId, annotationId: secondId }],
  } as any);
  assert(!(res as any).isError, 'remove: should succeed');
  assert(stored.graph.annotations.length === 1, 'remove: 1 remaining');
  assert(stored.graph.annotations[0].text === 'a', 'remove: the correct one was removed');
}

// ─── TEST 6: removeAnnotation on missing id throws ───────────
async function testRemoveMissing(): Promise<void> {
  const { sessionId } = await compileScene('anno-remove-missing');
  const res = await handleEdit({
    operations: [{ op: 'removeAnnotation', sceneId: sessionId, annotationId: 'a:nope' }],
  } as any);
  const err = extractError(res);
  assert(err !== null, 'remove missing: should isError');
  assert(err?.code === 'edit.annotation.not_found', `remove missing: code was ${err?.code}`);
}

// ─── TEST 7: HTML export emits annotation overlays ───────────
async function testHtmlEmit(): Promise<void> {
  const { sessionId, nodes } = await compileScene('anno-html');
  const target = nodes.find((n) => n.type === 'TEXT')!;
  await handleEdit({
    operations: [
      { op: 'annotate', sceneId: sessionId, targetNodeId: target.id, text: 'Hero needs weight', anchor: 'ne', severity: 'suggestion' },
      { op: 'annotate', sceneId: sessionId, targetNodeId: target.id, text: 'Contrast too low', anchor: 'sw', severity: 'warn' },
    ],
  } as any);
  const stored = getScene(sessionId)!;
  const html = exportToHtml(stored.graph, stored.rootId);
  assert(html.includes('class="reframe-annotation"'), 'html: annotation class present');
  assert(html.includes('data-anno-bracket="ne"'), 'html: first annotation bracket attr');
  assert(html.includes('data-anno-bracket="sw"'), 'html: second annotation bracket attr');
  assert(html.includes('Hero needs weight'), 'html: first annotation text present');
  assert(html.includes('Contrast too low'), 'html: second annotation text present');
  assert(html.includes('#f5a623') || html.includes('suggestion'), 'html: suggestion color from severity');
  assert(html.includes('#d0021b') || html.includes('warn'), 'html: warn color from severity');
  assert(html.includes('fonts.googleapis.com/css2?family=Caveat'), 'html: caveat font link');
}

// ─── TEST 8: React export emits annotation JSX ──────────────
async function testReactEmit(): Promise<void> {
  const { sessionId, nodes } = await compileScene('anno-react');
  const target = nodes.find((n) => n.type === 'TEXT')!;
  await handleEdit({
    operations: [
      { op: 'annotate', sceneId: sessionId, targetNodeId: target.id, text: 'Tsx note', anchor: 'top', severity: 'info' },
    ],
  } as any);
  const stored = getScene(sessionId)!;
  const host = new StandaloneHost(stored.graph);
  setHost(host);
  const rootNode = new StandaloneNode(stored.graph, stored.graph.getNode(stored.rootId)!);
  const tsx = exportToReact(rootNode as any, { typescript: true });
  assert(tsx.includes('className="reframe-annotation"'), 'react: annotation JSX className');
  assert(tsx.includes('data-anno-bracket="top"'), 'react: bracket attr');
  assert(tsx.includes('Tsx note'), 'react: annotation text');
  assert(tsx.includes('.reframe-annotation'), 'react: annotation CSS block');
}

// ─── TEST 9: SVG export emits annotation group ───────────────
async function testSvgEmit(): Promise<void> {
  const { sessionId, nodes } = await compileScene('anno-svg');
  const target = nodes.find((n) => n.type === 'TEXT')!;
  await handleEdit({
    operations: [
      { op: 'annotate', sceneId: sessionId, targetNodeId: target.id, text: 'SVG note', anchor: 'bottom', severity: 'warn' },
    ],
  } as any);
  const stored = getScene(sessionId)!;
  const svg = exportSceneGraphToSvg(stored.graph, stored.rootId);
  assert(svg.includes('class="reframe-annotations"'), 'svg: annotations group class');
  assert(svg.includes('data-anno-bracket="bottom"'), 'svg: bracket attr');
  assert(svg.includes('SVG note'), 'svg: annotation text');
  assert(svg.includes('<polyline'), 'svg: bracket polyline');
  assert(svg.includes('#d0021b'), 'svg: warn color');
}

// ─── TEST 10: serialize round-trip preserves annotations ─────
async function testSerializeRoundTrip(): Promise<void> {
  const { sessionId, nodes } = await compileScene('anno-serialize');
  const target = nodes.find((n) => n.type === 'TEXT')!;
  await handleEdit({
    operations: [
      { op: 'annotate', sceneId: sessionId, targetNodeId: target.id, text: 'roundtrip test', anchor: 'se', severity: 'suggestion', author: 'test' },
    ],
  } as any);
  const stored = getScene(sessionId)!;
  const { serializeGraph, deserializeScene } = await import('../../../core/src/serialize.js');
  const envelope = serializeGraph(stored.graph, stored.rootId);
  assert(Array.isArray(envelope.annotations), 'serialize: annotations key in envelope');
  assert(envelope.annotations!.length === 1, 'serialize: 1 annotation in envelope');
  assert(envelope.annotations![0].text === 'roundtrip test', 'serialize: text roundtrips');

  const { graph: newGraph } = deserializeScene(envelope as any);
  assert(newGraph.annotations.length === 1, 'deserialize: annotation restored');
  assert(newGraph.annotations[0].severity === 'suggestion', 'deserialize: severity restored');
  assert(newGraph.annotations[0].author === 'test', 'deserialize: author restored');
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Week 2 annotations contract\n');

  const tests: Array<[string, () => Promise<void>]> = [
    ['annotate happy path — id + defaults + fields roundtrip', testAnnotateHappyPath],
    ['annotate bad targetNodeId throws', testAnnotateBadTarget],
    ['updateAnnotation patches specified fields, preserves rest', testUpdateAnnotation],
    ['updateAnnotation on missing id throws', testUpdateMissing],
    ['removeAnnotation by id', testRemoveAnnotation],
    ['removeAnnotation on missing id throws', testRemoveMissing],
    ['HTML export emits annotation overlay', testHtmlEmit],
    ['React export emits annotation JSX', testReactEmit],
    ['SVG export emits annotation group', testSvgEmit],
    ['serialize / deserialize roundtrip', testSerializeRoundTrip],
  ];

  for (const [name, fn] of tests) {
    console.log(`▸ ${name}`);
    try { await fn(); }
    catch (err: any) {
      failed++;
      console.error(`  UNEXPECTED ERROR: ${err?.message ?? err}`);
      if (err?.stack) console.error(err.stack.split('\n').slice(0, 6).join('\n'));
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
