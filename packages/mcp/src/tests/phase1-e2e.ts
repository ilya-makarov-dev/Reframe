/**
 * Phase 1 — Agent-operable runtime end-to-end bench.
 *
 * Exercises the full loop WITHOUT a real HTTP server by invoking the
 * Platform API handler directly with mock req/res, and listening to the
 * in-process event bus that SSE would broadcast. Same code paths, zero
 * network flake.
 *
 *   1. Subscribe to ProjectEvents (what SSE would fan out)
 *   2. POST /platform/api/panel-mount {panel: 'brand-palette'}
 *        → expect panel:mount event with HTML + nodeCount
 *   3. POST /platform/api/agent-gesture {tool: 'brand.setToken'}
 *        → expect token:changed event AND DESIGN.md patched on disk
 *   4. POST /platform/api/panel-unmount
 *        → expect panel:unmount event
 *   5. Verify unknown tools are logged-not-thrown (Phase 1 subset rule)
 *
 *   Bonus: run mount 10× back-to-back to bench agent-driven mounting
 *   under repeated invocation (Phase 1 analogue of H2).
 *
 * Invoke: `npx tsx packages/mcp/src/tests/phase1-e2e.ts`
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

// ─── Mock req/res ────────────────────────────────────────────────

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
    if (ev === 'data') {
      if (!this._emitted && this._body.length > 0) {
        this._emitted = true;
        queueMicrotask(() => fn(this._body));
      }
    }
    if (ev === 'end') queueMicrotask(() => fn());
    return this;
  }
}

class MockRes extends ServerResponse {
  statusCode = 200;
  headers: any = {};
  body: string = '';

  constructor(req: IncomingMessage) {
    super(req);
  }

  writeHead(code: number, headers?: any): any {
    this.statusCode = code;
    if (headers) Object.assign(this.headers, headers);
    return this;
  }

  end(chunk?: any): any {
    if (chunk != null) this.body = String(chunk);
    return this;
  }
}

async function callApi(ctx: PlatformContext, method: string, path: string, body?: unknown) {
  const req = new MockReq(method, path, body);
  const res = new MockRes(req as any);
  const handled = await handleAgentRuntimeApi(req as any, res as any, ctx);
  if (!handled) throw new Error(`handler did not claim path: ${path}`);
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

// ─── Fixture project ─────────────────────────────────────────────

function setupFixtureProject(): { ctx: PlatformContext; cleanup: () => void } {
  const tmp = mkdtempSync(join(tmpdir(), 'rf-phase1-'));
  initProject(tmp, 'phase1-bench');

  const designMd = [
    '# Phase 1 Brand',
    '',
    '## Palette',
    '',
    '- Primary: #635BFF',
    '- Background: #0B0B13',
    '- Surface: #14141C',
    '- Text: #FFFFFF',
    '- Muted: #9B9BA5',
    '- Accent: #FF5A1F',
  ].join('\n');

  registerBrand(tmp, 'phase1', designMd, { label: 'Phase 1', setActive: true });

  const ctx: PlatformContext = { projectDir: tmp } as PlatformContext;
  return {
    ctx,
    cleanup: () => { /* tmp dirs auto-clean on OS; no-op for simplicity */ },
  };
}

// ─── Event capture ───────────────────────────────────────────────

function captureEvents(): { events: ProjectEvent[]; stop: () => void } {
  const events: ProjectEvent[] = [];
  const stop = onProjectEvent((e) => events.push(e));
  return { events, stop };
}

function firstOf<T extends ProjectEvent['type']>(events: ProjectEvent[], type: T): Extract<ProjectEvent, { type: T }> | null {
  for (const e of events) if (e.type === type) return e as any;
  return null;
}

// ─── Bench ───────────────────────────────────────────────────────

function now() { return performance.now(); }
function line(n = 72) { return '─'.repeat(n); }
function fmt(status: 'green' | 'yellow' | 'red') {
  return status === 'green' ? '🟢 GREEN' : status === 'yellow' ? '🟡 YELLOW' : '🔴 RED';
}

async function run() {
  console.log(line());
  console.log('  Phase 1 — Agent-Operable Runtime: End-to-End Bench');
  console.log(line());

  const { ctx, cleanup } = setupFixtureProject();
  const { events, stop } = captureEvents();

  try {
    // ─── T1: panel-mount round-trip ──────────────────
    const t1 = now();
    const r1 = await callApi(ctx, 'POST', '/platform/api/panel-mount', {
      panel: 'brand-palette',
      slot: 'right-panel',
      config: { brandSlug: 'phase1' },
    });
    const t1ms = now() - t1;

    const mountEvent = firstOf(events, 'panel:mount');
    const t1Status: 'green' | 'yellow' | 'red' =
      r1.status === 200 && r1.body?.ok && mountEvent && mountEvent.html.length > 0
        ? (t1ms < 50 ? 'green' : t1ms < 200 ? 'yellow' : 'red')
        : 'red';

    console.log();
    console.log(`T1 ${fmt(t1Status)} panel-mount round-trip (${t1ms.toFixed(2)}ms)`);
    console.log(`    status: ${r1.status}  panel: ${r1.body?.panel}  nodes: ${r1.body?.nodeCount}  htmlBytes: ${r1.body?.htmlBytes}  composeMs: ${r1.body?.composeMs}`);
    console.log(`    SSE emitted: ${mountEvent ? '✓ panel:mount' : '✗ missing'} slot=${mountEvent?.slot}`);

    // ─── T2: token-change gesture → SSE + disk ──────
    events.length = 0; // reset capture
    const t2 = now();
    const r2 = await callApi(ctx, 'POST', '/platform/api/agent-gesture', {
      tool: 'brand.setToken',
      args: { brand: 'phase1', name: 'color.primary', value: '#00FFAA' },
    });
    const t2ms = now() - t2;

    const tokenEvent = firstOf(events, 'token:changed');
    const designPath = join(ctx.projectDir!, '.reframe', 'brands', 'phase1', 'DESIGN.md');
    const patched = existsSync(designPath) ? readFileSync(designPath, 'utf-8') : '';
    const diskPatched = patched.includes('#00FFAA');

    const t2Status: 'green' | 'yellow' | 'red' =
      r2.status === 200 && r2.body?.ok && tokenEvent && tokenEvent.value === '#00FFAA' && diskPatched
        ? (t2ms < 30 ? 'green' : t2ms < 150 ? 'yellow' : 'red')
        : 'red';

    console.log();
    console.log(`T2 ${fmt(t2Status)} agent-gesture brand.setToken (${t2ms.toFixed(2)}ms)`);
    console.log(`    status: ${r2.status}  handled: ${r2.body?.handled}`);
    console.log(`    SSE emitted: ${tokenEvent ? '✓ token:changed' : '✗ missing'} value=${tokenEvent?.value}`);
    console.log(`    DESIGN.md on disk: ${diskPatched ? '✓ patched (#00FFAA present)' : '✗ not patched'}`);

    // ─── T3: unmount round-trip ──────────────────────
    events.length = 0;
    const t3 = now();
    const r3 = await callApi(ctx, 'POST', '/platform/api/panel-unmount', {
      panel: 'brand-palette',
      slot: 'right-panel',
    });
    const t3ms = now() - t3;

    const unmountEvent = firstOf(events, 'panel:unmount');
    const t3Status: 'green' | 'yellow' | 'red' =
      r3.status === 200 && r3.body?.ok && unmountEvent ? 'green' : 'red';

    console.log();
    console.log(`T3 ${fmt(t3Status)} panel-unmount round-trip (${t3ms.toFixed(2)}ms)`);
    console.log(`    SSE emitted: ${unmountEvent ? '✓ panel:unmount' : '✗ missing'}`);

    // ─── T4: unknown tool — logged, not thrown ───────
    events.length = 0;
    const t4 = now();
    const r4 = await callApi(ctx, 'POST', '/platform/api/agent-gesture', {
      tool: 'unknown.weird-tool',
      args: { foo: 'bar' },
    });
    const t4ms = now() - t4;

    const t4Status: 'green' | 'yellow' | 'red' =
      r4.status === 200 && r4.body?.ok && !r4.body.handled ? 'green' : 'red';

    console.log();
    console.log(`T4 ${fmt(t4Status)} unknown-tool graceful (${t4ms.toFixed(2)}ms)`);
    console.log(`    handled: ${r4.body?.handled}  note: ${r4.body?.note}`);

    // ─── T5: 10× mount burst ─────────────────────────
    events.length = 0;
    const mountLatencies: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t = now();
      await callApi(ctx, 'POST', '/platform/api/panel-mount', {
        panel: 'brand-palette',
        slot: 'right-panel',
        config: { brandSlug: 'phase1' },
      });
      mountLatencies.push(now() - t);
    }
    const avg = mountLatencies.reduce((a, b) => a + b, 0) / mountLatencies.length;
    const max = Math.max(...mountLatencies);
    const min = Math.min(...mountLatencies);
    const mountEventCount = events.filter(e => e.type === 'panel:mount').length;
    const t5Status: 'green' | 'yellow' | 'red' =
      mountEventCount === 10 && avg < 50 ? 'green' : mountEventCount === 10 && avg < 150 ? 'yellow' : 'red';

    console.log();
    console.log(`T5 ${fmt(t5Status)} 10× mount burst`);
    console.log(`    events emitted: ${mountEventCount}/10`);
    console.log(`    latency min:${min.toFixed(2)}ms  avg:${avg.toFixed(2)}ms  max:${max.toFixed(2)}ms`);

    // ─── Summary ────────────────────────────────────
    console.log();
    console.log(line());
    const all = [t1Status, t2Status, t3Status, t4Status, t5Status];
    const allGreen = all.every(s => s === 'green');
    const anyRed = all.some(s => s === 'red');
    console.log(`  VERDICT: ${allGreen ? '🟢 ALL GREEN — proceed to Phase 2' : anyRed ? '🔴 RED — fix before proceed' : '🟡 YELLOW — note issues, decide'}`);
    console.log(line());

    if (anyRed) process.exit(1);
  } finally {
    stop();
    cleanup();
  }
}

run().catch(err => {
  console.error('Phase 1 bench crashed:', err);
  process.exit(2);
});
