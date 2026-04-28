/**
 * Week 4 #20 Stateful prototype — single-file React SPA contract.
 *
 * 8 tests:
 *   1. happy 3-step flow — vendor blocks + Step0/1/2 + FlowApp + mount
 *   2. composition validation — single-scene + sampler throw
 *   3. step JSX matches React exporter (after wrap)
 *   4. fonts inlined as @font-face data: URI
 *   5. images inlined
 *   6. annotations preserved
 *   7. data-flow-state binding emits value+onChange
 *   8. determinism — two exports byte-identical
 *
 * Run: npx tsx packages/mcp/src/tests/week4-react-spa-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { handleCompile } from '../tools/compile.js';
import { handleEdit } from '../tools/edit.js';
import { handleExport } from '../tools/export.js';
import { getScene, setProjectDir } from '../store.js';
import { initProject } from '../../../core/src/project/io.js';
import { exportFlowToReactSpa } from '../../../core/src/exporters/react-spa.js';
import { wrapStepBody } from '../../../core/src/exporters/react-step-wrapper.js';
import { exportToReact } from '../../../core/src/exporters/react.js';
import { StandaloneNode } from '../../../core/src/adapters/standalone/node.js';
import { StandaloneHost } from '../../../core/src/adapters/standalone/adapter.js';
import { setHost } from '../../../core/src/host/context.js';
import type { ResourceFetcher } from '../../../core/src/exporters/inline-fonts.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

function extractError(result: any): { code?: string; message?: string } | null {
  if (!result?.isError) return null;
  const jsonText = result.content?.[1]?.text;
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText);
    if (parsed.kind === 'reframe.toolError') return { code: parsed.code, message: parsed.message };
  } catch {}
  return null;
}

let projectDir: string;
function setupProject(): void {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-spa-test-'));
  initProject(projectDir, 'spa-test');
  setProjectDir(projectDir);
  process.env.REFRAME_WORKSPACE = projectDir;
}

const stepHtml = (label: string) =>
  '<div style="width:600px;padding:32px;background:#fff;color:#111;font-family:system-ui">' +
    `<h1 style="font-size:32px;margin:0">${label}</h1>` +
    '<p>Body</p>' +
  '</div>';

async function compileFlow(flowId: string, stepCount = 3) {
  const cells = Array.from({ length: stepCount }, (_, i) => ({
    html: stepHtml(`Step ${i + 1}`),
    audit: false,
    exports: [] as string[],
  }));
  await handleCompile({
    flow: { flowId, name: flowId, steps: cells },
  } as any);
}

const fakeWoff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0xfa, 0xfa, 0xbe, 0xbe]);
const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde]);

function fontMockFetcher(fontUrl: string): ResourceFetcher {
  const css = `@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/inter/v1/inter-400.woff2) format('woff2');
}`;
  return {
    async fetchText(url) { if (url === fontUrl) return css; throw new Error(`mock no text ${url}`); },
    async fetchBinary(url) {
      if (url === 'https://fonts.gstatic.com/s/inter/v1/inter-400.woff2') return fakeWoff2;
      if (url === 'https://example.com/img.png') return fakePng;
      throw new Error(`mock no binary ${url}`);
    },
  };
}

async function makeFlowInput(flowId: string) {
  const { readFlowSpec, readFlowState } = await import('../../../core/src/project/flow-store.js');
  const spec = readFlowSpec(projectDir, flowId)!;
  const state = readFlowState(projectDir, flowId);
  const { deserializeScene } = await import('../../../core/src/serialize.js');
  const steps = spec.stepSceneIds.map((slug) => {
    const env = JSON.parse(fs.readFileSync(path.join(projectDir, '.reframe', 'scenes', `${slug}.scene.json`), 'utf8'));
    const { graph } = deserializeScene(env);
    return { graph, rootId: env.root?.id ?? env.rootId };
  });
  return {
    flowId,
    flowName: spec.name,
    steps: steps.map((s) => s.graph),
    stepRootIds: steps.map((s) => s.rootId),
    transitions: spec.transitions,
    state,
  };
}

// ─── TEST 1: happy 3-step flow ──
async function testHappyPath(): Promise<void> {
  setupProject();
  await compileFlow('spa-happy', 3);
  const input = await makeFlowInput('spa-happy');
  const result = await exportFlowToReactSpa(input, {});
  assert(result.html.includes('<title>'), 'has title');
  // Vendor scripts inlined → output is multi-MB. Look for at least 3
  // <script> tags before the body (one per vendor) and total HTML > 1MB.
  const scriptCount = (result.html.match(/<script>/g) ?? []).length;
  assert(scriptCount >= 3, `at least 3 raw <script> tags for vendor (got ${scriptCount})`);
  assert(result.html.length > 1_000_000, `output > 1MB (got ${result.html.length})`);
  assert(result.html.includes('function Step0(props)'), 'Step0 declared as function(props)');
  assert(result.html.includes('function Step1(props)'), 'Step1 declared');
  assert(result.html.includes('function Step2(props)'), 'Step2 declared');
  assert(result.html.includes('function FlowApp()'), 'FlowApp wrapper present');
  assert(result.html.includes('React.useState'), 'useState wired');
  assert(result.html.includes('ReactDOM.createRoot(document.getElementById(\'root\'))'), 'mount call wired');
  // FlowApp emits via React.createElement with single-quoted string args.
  assert(result.html.includes("'Next'"), 'Next button label inlined');
  assert(result.html.includes("'Prev'"), 'Prev button label inlined');
}

// ─── TEST 2: composition validation throws ──
async function testCompositionValidation(): Promise<void> {
  setupProject();
  // Single-scene compile.
  await handleCompile({
    html: stepHtml('Single'),
    name: 'just-one-scene',
    audit: false,
    preview: false,
    exports: [],
  } as any);
  const r1 = await handleExport({ sceneId: 'just-one-scene', format: 'react-spa' } as any);
  const e1 = extractError(r1);
  assert(e1?.code === 'export.react-spa.unsupported_composition', `single-scene -> code (got ${e1?.code})`);

  // Sampler.
  await handleCompile({
    sampler: {
      samplerId: 'spa-sampler',
      cells: Array.from({ length: 4 }, () => ({ html: stepHtml('cell'), audit: false, exports: [] })),
      grid: { columns: 2 },
    },
  } as any);
  const r2 = await handleExport({ sceneId: 'spa-sampler', format: 'react-spa' } as any);
  const e2 = extractError(r2);
  assert(e2?.code === 'export.react-spa.unsupported_composition', `sampler -> code (got ${e2?.code})`);

  // Missing flow.
  const r3 = await handleExport({ sceneId: 'no-such-flow', format: 'react-spa' } as any);
  const e3 = extractError(r3);
  assert(e3?.code === 'export.react-spa.flow_not_found', `missing -> flow_not_found (got ${e3?.code})`);
}

// ─── TEST 3: step JSX matches exporter output (after wrap) ──
async function testStepJsxMatchesExporter(): Promise<void> {
  setupProject();
  await compileFlow('spa-equiv', 2);
  const input = await makeFlowInput('spa-equiv');
  const result = await exportFlowToReactSpa(input, {});
  for (let i = 0; i < input.steps.length; i++) {
    const graph = input.steps[i];
    const rootId = input.stepRootIds[i];
    const root = graph.getNode(rootId)!;
    const host = new StandaloneHost(graph);
    setHost(host);
    const wrapped = new StandaloneNode(graph, root) as any;
    const direct = exportToReact(wrapped, { typescript: false, cssModules: false, componentName: `Step${i}` });
    const wrappedDirect = wrapStepBody(direct, { index: i });
    assert(result.html.includes(wrappedDirect), `step ${i}: wrapped exporter output embedded byte-equal`);
  }
}

// ─── TEST 4: fonts inlined ──
async function testFontsInlined(): Promise<void> {
  setupProject();
  // Compile flow whose steps use Inter.
  await handleCompile({
    flow: {
      flowId: 'spa-fonts', name: 'spa-fonts',
      steps: [
        { html: '<div style="width:300px;font-family:Inter,sans-serif;background:#fff"><h1 style="font-weight:400">A</h1></div>', audit: false, exports: [] },
        { html: '<div style="width:300px;font-family:Inter,sans-serif;background:#fff"><h1 style="font-weight:400">B</h1></div>', audit: false, exports: [] },
      ],
    },
  } as any);
  const input = await makeFlowInput('spa-fonts');
  // Construct expected URL — html.ts requests Inter@400.
  const fontsUrl = 'https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap';
  const result = await exportFlowToReactSpa(input, { fetcher: fontMockFetcher(fontsUrl) });
  assert(result.inlinedAssets.fonts >= 1, `at least 1 font face inlined (got ${result.inlinedAssets.fonts})`);
  assert(result.html.includes('@font-face'), '@font-face block present');
  assert(result.html.includes('data:font/woff2;base64,'), 'woff2 data URI present');
  assert(!/<link[^>]*fonts\.googleapis\.com/i.test(result.html), 'no external font link');
}

// ─── TEST 5: images inlined ──
async function testImagesInlined(): Promise<void> {
  setupProject();
  await handleCompile({
    flow: {
      flowId: 'spa-img', name: 'spa-img',
      steps: [
        { html: '<div style="width:300px;background:#fff"><img src="https://example.com/img.png" style="width:50px;height:50px"></div>', audit: false, exports: [] },
        { html: '<div style="width:300px;background:#fff">step 2</div>', audit: false, exports: [] },
      ],
    },
  } as any);
  const input = await makeFlowInput('spa-img');
  const result = await exportFlowToReactSpa(input, { fetcher: fontMockFetcher('https://fonts.googleapis.com/css2?family=foo:wght@400&display=swap') });
  assert(result.inlinedAssets.images === 1, `1 image inlined (got ${result.inlinedAssets.images})`);
  assert(result.html.includes('data:image/png;base64,'), 'png data URI present');
  assert(!result.html.includes('https://example.com/img.png'), 'external image src removed');
}

// ─── TEST 6: annotations preserved in step JSX ──
async function testAnnotationsPreserved(): Promise<void> {
  setupProject();
  await compileFlow('spa-anno', 2);
  // Add annotations to step 0.
  const flowId = 'spa-anno';
  const stepSlug = `${flowId}-step-0`;
  const stored = getScene(stepSlug)!;
  let textNode: any = null;
  function walk(id: string): void {
    const n = stored.graph.getNode(id); if (!n) return;
    if (n.type === 'TEXT' && !textNode) textNode = n;
    for (const c of n.childIds) walk(c);
  }
  walk(stored.rootId);
  await handleEdit({
    operations: [
      { op: 'annotate', sceneId: stepSlug, targetNodeId: textNode.id, text: 'note A', anchor: 'ne', severity: 'info', author: 'critic' },
      { op: 'annotate', sceneId: stepSlug, targetNodeId: textNode.id, text: 'note B', anchor: 'sw', severity: 'warn', author: 'critic' },
    ],
  } as any);
  const input = await makeFlowInput(flowId);
  const result = await exportFlowToReactSpa(input, {});
  // Step 0 JSX should contain both annotations.
  const step0Match = result.html.match(/function Step0\(props\)\s*\{([\s\S]*?)\nfunction Step1/);
  assert(!!step0Match, 'Step0 body extractable');
  const step0Body = step0Match![1];
  assert(step0Body.includes('note A'), 'annotation A text in step 0 JSX');
  assert(step0Body.includes('note B'), 'annotation B text in step 0 JSX');
}

// ─── TEST 7: data-flow-state binding ──
async function testFlowStateBinding(): Promise<void> {
  setupProject();
  // Flow with input in step 0, display in step 1.
  await handleCompile({
    flow: {
      flowId: 'spa-bind', name: 'spa-bind',
      steps: [
        { html: '<div style="width:300px;padding:24px;background:#fff"><label>Name<input data-flow-state="userName" type="text" style="width:200px"></label></div>', audit: false, exports: [] },
        { html: '<div style="width:300px;padding:24px;background:#fff">Hello world</div>', audit: false, exports: [] },
      ],
    },
  } as any);
  const input = await makeFlowInput('spa-bind');
  const result = await exportFlowToReactSpa(input, {});
  // Find step 0 body.
  const step0Match = result.html.match(/function Step0\(props\)\s*\{([\s\S]*?)\nfunction Step1/);
  assert(!!step0Match, 'Step0 body extractable');
  const step0Body = step0Match![1];
  assert(step0Body.includes('<input'), `input element emitted (body: ${step0Body.slice(0, 200)})`);
  assert(step0Body.includes('value={(props.state'), 'value bound to props.state');
  assert(step0Body.includes('onChange={e => props.setState'), 'onChange wired to setState');
  assert(step0Body.includes('"userName"'), 'field name "userName" embedded in binding');
}

// ─── TEST 8: determinism ──
async function testDeterminism(): Promise<void> {
  setupProject();
  await compileFlow('spa-det', 3);
  const input = await makeFlowInput('spa-det');
  const a = await exportFlowToReactSpa(input, {});
  const b = await exportFlowToReactSpa(input, {});
  assert(a.html === b.html, `byte-identical (a=${a.html.length} b=${b.html.length})`);
  assert(a.sizeBytes === b.sizeBytes, 'sizeBytes identical');
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Week 4 #20 React-SPA contract\n');
  const tests: Array<[string, () => Promise<void>]> = [
    ['happy 3-step flow', testHappyPath],
    ['composition validation throws', testCompositionValidation],
    ['step JSX matches exporter (after wrap)', testStepJsxMatchesExporter],
    ['fonts inlined as @font-face data URI', testFontsInlined],
    ['images inlined', testImagesInlined],
    ['annotations preserved in step JSX', testAnnotationsPreserved],
    ['data-flow-state binding (value+onChange)', testFlowStateBinding],
    ['determinism — two exports byte-identical', testDeterminism],
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
