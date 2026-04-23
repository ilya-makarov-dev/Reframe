/**
 * Phase 2C — verify three fixes landed from Phase 2B reality-check:
 *
 *   F1  Panel composer loads real brand DESIGN.md colors (not demo palette)
 *       when (ctx.projectDir + brandSlug) resolves to a registered brand.
 *
 *   F2  Token writer regex now patches bold-parens form
 *       `**Label** (`#HEX`)` used by Ferrari / Linear / other brands whose
 *       DESIGN.md follows that markdown convention.
 *
 *   F3  Mount-slot is rendered on editor-shell-page — probed indirectly by
 *       exercising the full dispatch loop and verifying the panel HTML
 *       contains mountSlot attrs as expected.
 *
 * Uses mock req/res like Phase 1/2A — no live sidecar. Runs via tsx.
 *
 * Invoke: `npx tsx packages/mcp/src/tests/phase2c-fixes.ts`
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

// ─── Fixture — Ferrari-style DESIGN.md (bold-parens format) ────────

const FERRARI_STYLE_DESIGN_MD = [
  '# Ferrari Brand',
  '',
  '## Palette',
  '',
  '### Primary',
  '- **Pure White** (`#FFFFFF`): Primary surface for editorial content',
  '- **Racing Red** (`#FF2800`): Brand red for hero accents and CTA',
  '',
  '### Background',
  '- **Deep Black** (`#000000`): Cinematic background',
  '- **Near Black** (`#181818`): Body text on light surfaces',
  '',
  '### Surface',
  '- **Warm White** (`#F8F6F2`): Paper tone for editorial panels',
  '',
  '### Accent',
  '- **Signal Yellow** (`#FFD500`): Alert + call-out',
  '',
].join('\n');

function setupProject(): PlatformContext {
  const tmp = mkdtempSync(join(tmpdir(), 'rf-phase2c-'));
  initProject(tmp, 'phase2c-bench');
  registerBrand(tmp, 'ferrari', FERRARI_STYLE_DESIGN_MD, { label: 'Ferrari', setActive: true });
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
function fmt(s: 'green' | 'red') { return s === 'green' ? '🟢 GREEN' : '🔴 RED'; }
function line(n = 72) { return '─'.repeat(n); }

async function run() {
  console.log(line());
  console.log('  Phase 2C — Fix Verification (F1 real brand · F2 bold-parens regex · F3 slot attrs)');
  console.log(line());

  const ctx = setupProject();
  const { events, stop } = captureEvents();

  try {
    // ─── F1: real brand colors, not demo palette ────
    events.length = 0;
    const r1 = await callApi(ctx, 'POST', '/platform/api/panel-mount', {
      panel: 'brand-palette',
      slot: 'right-panel',
      config: { brandSlug: 'ferrari' },
    });
    const mountEvt = firstOf(events, 'panel:mount');
    const html = mountEvt?.html ?? '';
    // Demo palette colors (that SHOULD NOT be present when ctx.projectDir set):
    const hasDemoPrimary = html.includes('#635BFF');
    const hasDemoAccent = html.includes('#FF5A1F');
    // Ferrari's first few colors — parser picks Pure White first per the
    // `### Primary` heading, so Primary=#FFFFFF; Background=#000000.
    const hasFerrariColor = /#FF2800|#FFD500/.test(html);
    const hasWhiteAsPrimary = /--color-primary:\s*#FFFFFF/i.test(html);
    const f1Status: 'green' | 'red' =
      r1.body?.ok && !hasDemoPrimary && !hasDemoAccent && hasFerrariColor ? 'green' : 'red';

    console.log();
    console.log(`F1 ${fmt(f1Status)} real-brand palette loaded (not demo)`);
    console.log(`    demo palette absent: primary=${!hasDemoPrimary}  accent=${!hasDemoAccent}`);
    console.log(`    ferrari colors present: ${hasFerrariColor}   white-as-primary: ${hasWhiteAsPrimary}`);

    // ─── F2: bold-parens regex patches DESIGN.md on disk ──
    events.length = 0;
    const r2 = await callApi(ctx, 'POST', '/platform/api/agent-gesture', {
      tool: 'brand.setToken',
      args: { brand: 'ferrari', name: 'color.primary', value: '#00D9FF' },
    });
    const tokenEvt = firstOf(events, 'token:changed');
    const designPath = join(ctx.projectDir!, '.reframe', 'brands', 'ferrari', 'DESIGN.md');
    const patched = existsSync(designPath) ? readFileSync(designPath, 'utf-8') : '';
    // The first Primary bullet is `**Pure White** (\`#FFFFFF\`)` — regex
    // should have replaced the hex inside the backticks.
    const diskHas00D9FF = patched.includes('#00D9FF');
    // And the original #FFFFFF should be gone from the first bullet line.
    const firstPrimaryBullet = patched.split('\n').find(l => l.includes('Pure White')) ?? '';
    const firstBulletUpdated = firstPrimaryBullet.includes('#00D9FF');
    const f2Status: 'green' | 'red' =
      r2.body?.ok && tokenEvt?.value === '#00D9FF' && diskHas00D9FF && firstBulletUpdated ? 'green' : 'red';

    console.log();
    console.log(`F2 ${fmt(f2Status)} bold-parens regex patches Ferrari-style DESIGN.md`);
    console.log(`    SSE token:changed ${tokenEvt ? '✓' : '✗'}`);
    console.log(`    #00D9FF on disk: ${diskHas00D9FF}`);
    console.log(`    first Pure White bullet updated: ${firstBulletUpdated}`);
    if (firstPrimaryBullet) console.log(`    → "${firstPrimaryBullet.trim()}"`);

    // ─── F3: panel HTML carries mount-slot attrs (client-side consumable) ──
    const slotAttrs = (html.match(/data-mount-slot="/g) || []).length;
    const gestureClicks = (html.match(/data-gesture-click=/g) || []).length;
    const semanticPaths = (html.match(/data-semantic-path=/g) || []).length;
    const varRefs = (html.match(/var\(--color-/g) || []).length;
    const f3Status: 'green' | 'red' =
      slotAttrs > 0 && gestureClicks >= 3 && semanticPaths > 10 && varRefs > 0 ? 'green' : 'red';
    console.log();
    console.log(`F3 ${fmt(f3Status)} panel HTML carries agent-operable attrs`);
    console.log(`    data-mount-slot: ${slotAttrs}  data-gesture-click: ${gestureClicks}  data-semantic-path: ${semanticPaths}  var(--color-*): ${varRefs}`);

    // ─── Summary ────────────────────────────────────
    console.log();
    console.log(line());
    const all = [f1Status, f2Status, f3Status];
    const anyRed = all.some(s => s === 'red');
    console.log(`  VERDICT: ${anyRed ? '🔴 RED — fix before commit' : '🟢 ALL GREEN — Phase 2C complete'}`);
    console.log(line());
    if (anyRed) process.exit(1);
  } finally {
    stop();
  }
}

run().catch(err => {
  console.error('Phase 2C bench crashed:', err);
  process.exit(2);
});
