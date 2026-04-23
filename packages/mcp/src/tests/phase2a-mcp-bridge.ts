/**
 * Phase 2A — MCP bridge + token repaint + variant-picker end-to-end bench.
 *
 * Three threads of proof:
 *   1. Token-fast-path actually drives CSS var emission:
 *      - brand-palette HTML output contains `--color-*` custom-property
 *        definitions + `var(--color-*)` references on swatches.
 *      - Token-bound palette repaints come "for free" when client-side
 *        dispatcher patches `--color-<role>` on documentElement.
 *
 *   2. Variant-picker composes + mounts through the same infrastructure
 *      as brand-palette, proving the panel pattern generalizes beyond
 *      uniform-row UI to heterogeneous card layouts.
 *
 *   3. MCP bridge routes arbitrary tool+args:
 *      - reframe_edit op=applyVariant → scene:session-changed + auto-unmount
 *      - reframe_edit op=setToken normalizes to brand.setToken
 *      - unknown op → handled:false, no crash
 *
 * Invoke: `npx tsx packages/mcp/src/tests/phase2a-mcp-bridge.ts`
 * Exit 0 = all green.
 */

import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { handleAgentRuntimeApi } from '../platform/api/agent-runtime';
import type { PlatformContext } from '../platform/router';
import { onProjectEvent } from '../events';
import type { ProjectEvent } from '../../../core/src/project/types';
import { registerBrand, initProject } from '../../../core/src/project/io';

// ─── Mock req/res (same as Phase 1) ─────────────────────────────

class MockReq extends IncomingMessage {
  method: string;
  url: string;
  headers: any;
  private _body: Buffer;
  private _emitted = false;

  constructor(method: string, url: string, body?: unknown) {
    super(new Socket());
    this.method = method;
    this.url = url;
    this.headers = { host: 'localhost', 'content-type': 'application/json' };
    this._body = body == null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body), 'utf-8');
  }
  on(ev: string, fn: any): any {
    if (ev === 'data' && !this._emitted && this._body.length > 0) {
      this._emitted = true;
      queueMicrotask(() => fn(this._body));
    }
    if (ev === 'end') queueMicrotask(() => fn());
    return this;
  }
}

class MockRes extends ServerResponse {
  statusCode = 200;
  body = '';
  constructor(req: IncomingMessage) { super(req); }
  writeHead(code: number): any { this.statusCode = code; return this; }
  end(chunk?: any): any { if (chunk != null) this.body = String(chunk); return this; }
}

async function callApi(ctx: PlatformContext, method: string, path: string, body?: unknown) {
  const req = new MockReq(method, path, body);
  const res = new MockRes(req as any);
  const handled = await handleAgentRuntimeApi(req as any, res as any, ctx);
  if (!handled) throw new Error(`handler did not claim path: ${path}`);
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

function setupProject(): PlatformContext {
  const tmp = mkdtempSync(join(tmpdir(), 'rf-phase2a-'));
  initProject(tmp, 'phase2a-bench');
  const designMd = [
    '# Phase 2A Brand', '', '## Palette', '',
    '- Primary: #635BFF',
    '- Background: #0B0B13',
    '- Text: #FFFFFF',
  ].join('\n');
  registerBrand(tmp, 'phase2a', designMd, { label: 'Phase 2A', setActive: true });
  return { projectDir: tmp } as PlatformContext;
}

function captureEvents(): { events: ProjectEvent[]; stop: () => void } {
  const events: ProjectEvent[] = [];
  const stop = onProjectEvent((e) => events.push(e));
  return { events, stop };
}

function firstOf<T extends ProjectEvent['type']>(events: ProjectEvent[], type: T): Extract<ProjectEvent, { type: T }> | null {
  for (const e of events) if (e.type === type) return e as any;
  return null;
}

function fmt(s: 'green' | 'yellow' | 'red') {
  return s === 'green' ? '🟢 GREEN' : s === 'yellow' ? '🟡 YELLOW' : '🔴 RED';
}
function now() { return performance.now(); }
function line(n = 72) { return '─'.repeat(n); }

async function run() {
  console.log(line());
  console.log('  Phase 2A — MCP Bridge + Token Repaint + Variant-Picker Bench');
  console.log(line());

  const ctx = setupProject();
  const { events, stop } = captureEvents();

  try {
    // ─── T1: brand-palette HTML carries CSS vars + bindings ──
    const t1 = now();
    const r1 = await callApi(ctx, 'POST', '/platform/api/panel-mount', {
      panel: 'brand-palette',
      slot: 'right-panel',
      config: { brandSlug: 'phase2a' },
    });
    const t1ms = now() - t1;

    const mountEvent = firstOf(events, 'panel:mount');
    const html = mountEvent?.html ?? '';
    const hasRootVars = /--color-primary:/.test(html) || /--color-background:/.test(html);
    const hasVarRefs = /var\(--color-/.test(html);
    const rootVarCount = (html.match(/--color-\w+:/g) || []).length;
    const varRefCount = (html.match(/var\(--color-/g) || []).length;

    const t1Status: 'green' | 'yellow' | 'red' =
      r1.status === 200 && r1.body?.ok && hasRootVars && hasVarRefs && varRefCount >= 3
        ? 'green' : 'red';

    console.log();
    console.log(`T1 ${fmt(t1Status)} brand-palette with CSS var bindings (${t1ms.toFixed(2)}ms)`);
    console.log(`    nodes:${r1.body?.nodeCount}  htmlBytes:${r1.body?.htmlBytes}`);
    console.log(`    :root --color-* defs: ${rootVarCount}  var(--color-*) refs: ${varRefCount}  hasRoot:${hasRootVars}  hasRefs:${hasVarRefs}`);

    // ─── T2: variant-picker mount (different panel shape) ────
    events.length = 0;
    const t2 = now();
    const r2 = await callApi(ctx, 'POST', '/platform/api/panel-mount', {
      panel: 'variant-picker',
      slot: 'right-panel',
      config: { sceneId: 'home', targetPath: 'home/hero' },
    });
    const t2ms = now() - t2;

    const mountEvt2 = firstOf(events, 'panel:mount');
    const html2 = mountEvt2?.html ?? '';
    const cardCount = (html2.match(/data-intent-role="variant-picker\/card"/g) || []).length;
    const colorSegCount = (html2.match(/data-intent-role="variant-picker\/color-segment"/g) || []).length;

    const t2Status: 'green' | 'yellow' | 'red' =
      r2.status === 200 && r2.body?.ok && cardCount === 4 && colorSegCount >= 12
        ? 'green' : 'red';

    console.log();
    console.log(`T2 ${fmt(t2Status)} variant-picker panel (${t2ms.toFixed(2)}ms)`);
    console.log(`    nodes:${r2.body?.nodeCount}  htmlBytes:${r2.body?.htmlBytes}`);
    console.log(`    variant cards: ${cardCount}  color segments: ${colorSegCount}`);

    // ─── T3: reframe_edit op=applyVariant via MCP bridge ─────
    events.length = 0;
    const t3 = now();
    const r3 = await callApi(ctx, 'POST', '/platform/api/agent-gesture', {
      tool: 'reframe_edit',
      args: { op: 'applyVariant', sceneId: 'home', targetPath: 'home/hero', variantId: 'editorial' },
    });
    const t3ms = now() - t3;

    const sceneChanged = firstOf(events, 'scene:session-changed');
    const unmount = firstOf(events, 'panel:unmount');
    const t3Status: 'green' | 'yellow' | 'red' =
      r3.status === 200 && r3.body?.ok && r3.body.handled && sceneChanged?.sceneId === 'home' && unmount?.panelName === 'variant-picker'
        ? 'green' : 'red';

    console.log();
    console.log(`T3 ${fmt(t3Status)} reframe_edit applyVariant → MCP bridge (${t3ms.toFixed(2)}ms)`);
    console.log(`    result: ${JSON.stringify(r3.body?.result)}`);
    console.log(`    SSE: scene:session-changed ${sceneChanged ? '✓' : '✗'}  panel:unmount(variant-picker) ${unmount ? '✓' : '✗'}`);

    // ─── T4: reframe_edit op=setToken normalizes to brand.setToken ──
    events.length = 0;
    const t4 = now();
    const r4 = await callApi(ctx, 'POST', '/platform/api/agent-gesture', {
      tool: 'reframe_edit',
      args: { op: 'setToken', brand: 'phase2a', name: 'color.primary', value: '#00D9FF' },
    });
    const t4ms = now() - t4;

    const tokenEvt = firstOf(events, 'token:changed');
    const designPath = join(ctx.projectDir!, '.reframe', 'brands', 'phase2a', 'DESIGN.md');
    const patched = existsSync(designPath) ? readFileSync(designPath, 'utf-8') : '';
    const diskPatched = patched.includes('#00D9FF');
    const t4Status: 'green' | 'yellow' | 'red' =
      r4.status === 200 && r4.body?.ok && r4.body.handled && tokenEvt?.value === '#00D9FF' && diskPatched
        ? 'green' : 'red';

    console.log();
    console.log(`T4 ${fmt(t4Status)} reframe_edit setToken normalized (${t4ms.toFixed(2)}ms)`);
    console.log(`    result: ${JSON.stringify(r4.body?.result)}`);
    console.log(`    SSE token:changed ${tokenEvt ? '✓' : '✗'}  DESIGN.md patched ${diskPatched ? '✓' : '✗'}`);

    // ─── T5: reframe_ui mount via MCP bridge (chained agent call) ──
    events.length = 0;
    const t5 = now();
    const r5 = await callApi(ctx, 'POST', '/platform/api/agent-gesture', {
      tool: 'reframe_ui',
      args: { action: 'mount', panel: 'brand-palette', slot: 'right-panel', config: { brandSlug: 'phase2a' } },
    });
    const t5ms = now() - t5;

    const mountFromBridge = firstOf(events, 'panel:mount');
    const t5Status: 'green' | 'yellow' | 'red' =
      r5.status === 200 && r5.body?.ok && r5.body.handled && mountFromBridge?.panelName === 'brand-palette'
        ? 'green' : 'red';

    console.log();
    console.log(`T5 ${fmt(t5Status)} reframe_ui mount via MCP bridge (${t5ms.toFixed(2)}ms)`);
    console.log(`    result: ${JSON.stringify(r5.body?.result)}`);
    console.log(`    SSE panel:mount from bridge ${mountFromBridge ? '✓' : '✗'}`);

    // ─── T6: Unknown ops still graceful ──────────────────────
    events.length = 0;
    const r6a = await callApi(ctx, 'POST', '/platform/api/agent-gesture', {
      tool: 'reframe_edit',
      args: { op: 'somethingNotYetSupported', x: 1 },
    });
    const r6b = await callApi(ctx, 'POST', '/platform/api/agent-gesture', {
      tool: 'totally.unknown.tool',
      args: { x: 1 },
    });
    const t6Status: 'green' | 'yellow' | 'red' =
      r6a.status === 200 && r6a.body?.ok && !r6a.body.handled &&
      r6b.status === 200 && r6b.body?.ok && !r6b.body.handled
        ? 'green' : 'red';
    console.log();
    console.log(`T6 ${fmt(t6Status)} unknown op / tool → handled:false, no crash`);
    console.log(`    reframe_edit/unknown-op: note="${r6a.body?.note}"`);
    console.log(`    totally.unknown.tool:    note="${r6b.body?.note}"`);

    // ─── T7: 20× mount burst (scaled-up hot-path from Phase 1) ──
    events.length = 0;
    const latencies: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = now();
      await callApi(ctx, 'POST', '/platform/api/panel-mount', {
        panel: i % 2 === 0 ? 'brand-palette' : 'variant-picker',
        slot: 'right-panel',
        config: i % 2 === 0 ? { brandSlug: 'phase2a' } : { sceneId: 'home', targetPath: 'home/hero' },
      });
      latencies.push(now() - t);
    }
    const mountEvents = events.filter(e => e.type === 'panel:mount').length;
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const max = Math.max(...latencies);
    const min = Math.min(...latencies);
    const t7Status: 'green' | 'yellow' | 'red' =
      mountEvents === 20 && avg < 10 ? 'green' : mountEvents === 20 && avg < 50 ? 'yellow' : 'red';
    console.log();
    console.log(`T7 ${fmt(t7Status)} 20× alternating panel mount burst`);
    console.log(`    events:${mountEvents}/20  latency min:${min.toFixed(2)}ms avg:${avg.toFixed(2)}ms max:${max.toFixed(2)}ms`);

    // ─── Summary ────────────────────────────────────
    console.log();
    console.log(line());
    const all = [t1Status, t2Status, t3Status, t4Status, t5Status, t6Status, t7Status];
    const anyRed = all.some(s => s === 'red');
    const allGreen = all.every(s => s === 'green');
    console.log(`  VERDICT: ${allGreen ? '🟢 ALL GREEN — proceed to Phase 2B (live Chrome reality check)' : anyRed ? '🔴 RED — fix before proceed' : '🟡 YELLOW — note issues'}`);
    console.log(line());

    if (anyRed) process.exit(1);
  } finally {
    stop();
  }
}

run().catch(err => {
  console.error('Phase 2A bench crashed:', err);
  process.exit(2);
});
