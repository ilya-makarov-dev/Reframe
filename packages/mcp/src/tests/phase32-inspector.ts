/**
 * Phase 3.2 — Inspector panel + real scene mutations via MCP bridge.
 *
 * Composes the inspector panel against a fabricated target, verifies its
 * structure, then goes end-to-end: mount → rename gesture → verify scene
 * graph mutated + SSE fired → clone gesture → delete gesture.
 *
 * Real scene graph — uses @reframe/mcp store to register a scene, then
 * fires the agent-runtime dispatcher for each op and checks that the
 * stored graph changed as expected.
 *
 * Invoke: `npx tsx packages/mcp/src/tests/phase32-inspector.ts`
 * Exit 0 = all green.
 */

import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { handleAgentRuntimeApi } from '../platform/api/agent-runtime';
import type { PlatformContext } from '../platform/router';
import { onProjectEvent } from '../events';
import type { ProjectEvent } from '../../../core/src/project/types';
import { initProject, registerBrand } from '../../../core/src/project/io';
import { SceneGraph } from '../../../core/src/engine/scene-graph';
import { ensureSceneLayout } from '../../../core/src/engine/layout';
import { findNodeByPath } from '../../../core/src/engine/semantic-path';
import { storeScene } from '../store';
import { renderPanel } from '../platform/panels';

// ─── Mock req/res ────────────────────────────────────────────────
class MockReq extends IncomingMessage {
  method: string; url: string; headers: any;
  private _body: Buffer; private _emitted = false;
  constructor(method: string, url: string, body?: unknown) {
    super(new Socket());
    this.method = method; this.url = url;
    this.headers = { host: 'localhost', 'content-type': 'application/json' };
    this._body = body == null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body), 'utf-8');
  }
  on(ev: string, fn: any): any {
    if (ev === 'data' && !this._emitted && this._body.length > 0) { this._emitted = true; queueMicrotask(() => fn(this._body)); }
    if (ev === 'end') queueMicrotask(() => fn());
    return this;
  }
}
class MockRes extends ServerResponse {
  statusCode = 200; body = '';
  constructor(req: IncomingMessage) { super(req); }
  writeHead(code: number): any { this.statusCode = code; return this; }
  end(chunk?: any): any { if (chunk != null) this.body = String(chunk); return this; }
}
async function callApi(ctx: PlatformContext, method: string, path: string, body?: unknown) {
  const req = new MockReq(method, path, body);
  const res = new MockRes(req as any);
  const ok = await handleAgentRuntimeApi(req as any, res as any, ctx);
  if (!ok) throw new Error(`handler did not claim path: ${path}`);
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

function buildFixtureScene(): { graph: SceneGraph; rootId: string; heroId: string; ctaId: string } {
  const graph = new SceneGraph();
  const root = graph.getNode(graph.rootId)!;
  graph.updateNode(root.id, { name: 'home', width: 1440, height: 900, type: 'FRAME' as any, layoutMode: 'VERTICAL' } as any);
  const hero = graph.createNode('FRAME' as any, root.id, { name: 'hero', width: 1440, height: 400 } as any);
  const cta = graph.createNode('FRAME' as any, hero.id, {
    name: 'cta',
    width: 200, height: 60,
    semanticRole: 'button',
    meta: { tokenBindings: { fill: 'primary' } },
  } as any);
  ensureSceneLayout(graph, root.id);
  return { graph, rootId: root.id, heroId: hero.id, ctaId: cta.id };
}

function captureEvents(): { events: ProjectEvent[]; stop: () => void } {
  const events: ProjectEvent[] = [];
  const stop = onProjectEvent((e) => events.push(e));
  return { events, stop };
}

function fmt(s: 'green' | 'red') { return s === 'green' ? '🟢 GREEN' : '🔴 RED'; }
function line(n = 72) { return '─'.repeat(n); }
function now() { return performance.now(); }

async function run() {
  console.log(line());
  console.log('  Phase 3.2 — Inspector panel + real scene mutations');
  console.log(line());

  const tmp = mkdtempSync(join(tmpdir(), 'rf-phase32-'));
  initProject(tmp, 'phase32');
  registerBrand(tmp, 'test', [
    '# Test brand', '', '## Palette', '',
    '- Primary: #635BFF', '- Background: #0B0B13', '- Accent: #FF5A1F',
  ].join('\n'), { setActive: true });

  const ctx: PlatformContext = { projectDir: tmp } as PlatformContext;
  const { events, stop } = captureEvents();

  // Register a fixture scene in the store so sceneId resolves.
  const { graph, rootId } = buildFixtureScene();
  const sceneId = storeScene(graph, rootId, undefined, { slug: 'phase32-home', name: 'home' });

  try {
    // ─── T1: panel composes with full structure ──────
    const panelRendered = renderPanel('inspector', {
      sceneId,
      target: {
        id: 'dummy', name: 'cta', type: 'FRAME', semanticPath: 'hero/cta',
        semanticRole: 'button',
        intent: { role: 'cta', purpose: 'Primary CTA', editableBy: 'both' },
        bbox: { x: 620, y: 300, width: 200, height: 60 },
        tokenBindings: [{ field: 'fill', role: 'primary' }],
        auditIssues: [
          { severity: 'warning', rule: 'minTouchTarget', message: 'Height 60px below 44px recommended when padded' },
        ],
      },
      availableRoles: ['primary', 'background', 'accent', 'text', 'muted'],
    }, { projectDir: tmp });

    const checks = {
      title: /Inspector/.test(panelRendered.html),
      nameInput: /data-gesture-input/.test(panelRendered.html) && /rename/.test(panelRendered.html),
      path: /inspector\/path/.test(panelRendered.html) && /hero[^A-Za-z]{0,3}cta/.test(panelRendered.html),
      intent: /editableBy/.test(panelRendered.html),
      geometry: /Geometry/.test(panelRendered.html),
      pills: (panelRendered.html.match(/data-intent-role="inspector\/token-pill"/g) || []).length,
      audit: /minTouchTarget/.test(panelRendered.html),
      actions: /data-intent-role="inspector\/action-clone"/.test(panelRendered.html) && /data-intent-role="inspector\/action-delete"/.test(panelRendered.html),
    };
    const t1Status: 'green' | 'red' =
      checks.title && checks.nameInput && checks.path && checks.intent &&
      checks.geometry && checks.pills >= 3 && checks.audit && checks.actions
        ? 'green' : 'red';
    console.log();
    console.log(`T1 ${fmt(t1Status)} inspector panel structure`);
    console.log(`    nodes: ${panelRendered.nodeCount}  bytes: ${panelRendered.html.length}`);
    console.log(`    title: ${checks.title}  nameInput: ${checks.nameInput}  path: ${checks.path}`);
    console.log(`    intent: ${checks.intent}  geometry: ${checks.geometry}`);
    console.log(`    pills: ${checks.pills}  audit: ${checks.audit}  actions: ${checks.actions}`);

    // ─── T2: rename via MCP bridge mutates scene graph ──
    events.length = 0;
    const t2 = now();
    const r2 = await callApi(ctx, 'POST', '/platform/api/agent-gesture', {
      tool: 'reframe_edit',
      args: { op: 'rename', sceneId, targetPath: 'hero/cta', name: 'primary-cta' },
    });
    const t2ms = now() - t2;
    const cta = findNodeByPath(graph, 'hero/primary-cta');
    const sceneChangedEvt = events.find(e => e.type === 'scene:session-changed');
    const t2Status: 'green' | 'red' =
      r2.body?.ok && r2.body.handled && cta?.name === 'primary-cta' && !!sceneChangedEvt ? 'green' : 'red';
    console.log();
    console.log(`T2 ${fmt(t2Status)} rename cta → primary-cta (${t2ms.toFixed(2)}ms)`);
    console.log(`    node name now: ${cta?.name}  SSE scene-changed: ${!!sceneChangedEvt}`);

    // ─── T3: setTokenBinding swaps fill role ───────────
    events.length = 0;
    const r3 = await callApi(ctx, 'POST', '/platform/api/agent-gesture', {
      tool: 'reframe_edit',
      args: { op: 'setTokenBinding', sceneId, targetPath: 'hero/primary-cta', field: 'fill', role: 'accent' },
    });
    const ctaAfter = findNodeByPath(graph, 'hero/primary-cta');
    const newRole = (ctaAfter as any)?.meta?.tokenBindings?.fill;
    const t3Status: 'green' | 'red' = r3.body?.ok && newRole === 'accent' ? 'green' : 'red';
    console.log();
    console.log(`T3 ${fmt(t3Status)} setTokenBinding fill: primary → accent`);
    console.log(`    new binding: ${newRole}`);

    // ─── T4: clone creates sibling ─────────────────────
    events.length = 0;
    const r4 = await callApi(ctx, 'POST', '/platform/api/agent-gesture', {
      tool: 'reframe_edit',
      args: { op: 'clone', sceneId, targetPath: 'hero/primary-cta' },
    });
    // Sibling path should be `primary-cta:1` (sibling index disambiguation).
    const clone = findNodeByPath(graph, 'hero/primary-cta:1');
    const t4Status: 'green' | 'red' =
      r4.body?.ok && r4.body.handled && !!clone ? 'green' : r4.body?.handled === false ? 'red' : 'red';
    console.log();
    console.log(`T4 ${fmt(t4Status)} clone → sibling`);
    console.log(`    handled: ${r4.body?.handled}  note: ${r4.body?.note ?? ''}  clonePath resolves: ${!!clone}`);

    // ─── T5: delete removes node + auto-unmounts inspector ──
    // After clone at T4 the sibling collision makes paths `primary-cta:0`
    // (original) and `primary-cta:1` (clone). Delete the clone.
    events.length = 0;
    const r5 = await callApi(ctx, 'POST', '/platform/api/agent-gesture', {
      tool: 'reframe_edit',
      args: { op: 'delete', sceneId, targetPath: 'hero/primary-cta:1' },
    });
    const resolved = findNodeByPath(graph, 'hero/primary-cta:1');
    const unmountEvt = events.find(e => e.type === 'panel:unmount' && (e as any).panelName === 'inspector');
    const t5Status: 'green' | 'red' = r5.body?.ok && !resolved && !!unmountEvt ? 'green' : 'red';
    console.log();
    console.log(`T5 ${fmt(t5Status)} delete + auto-unmount inspector`);
    console.log(`    node gone: ${!resolved}  inspector unmount SSE: ${!!unmountEvt}`);

    // ─── Summary ───────────────────────────────────
    console.log();
    console.log(line());
    const all = [t1Status, t2Status, t3Status, t4Status, t5Status];
    const anyRed = all.some(s => s === 'red');
    console.log(`  VERDICT: ${anyRed ? '🔴 RED' : '🟢 ALL GREEN — inspector + real mutations work'}`);
    console.log(line());
    if (anyRed) process.exit(1);
  } finally {
    stop();
  }
}

run().catch(err => {
  console.error('Phase 3.2 bench crashed:', err);
  process.exit(2);
});
