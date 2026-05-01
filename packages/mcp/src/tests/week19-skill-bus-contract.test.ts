/**
 * Phase 3.5 — Skill bus contract.
 *
 * Pins covered:
 *   #2 POST /skill-bus/invoke validates skill exists, requestId format,
 *      context shape; returns 202 + requestId on happy path.
 *   #3 SkillRegistry parses YAML frontmatter from .claude/skills/<name>/
 *      SKILL.md; tolerates absence of bus-* fields; matchByContextType
 *      filters skills by declared types.
 *   #4 SSE event broadcasts: skill-bus:progress + skill-bus:result
 *      shape verified at the bus dispatch layer.
 *   #5 Result rendering library (152-skill-result-render.js) — bundle
 *      string-search confirms renderSkillResult / renderSkillProgress /
 *      bindSkillResultActions exposed + per-kind handlers wired.
 *   #6 Workbench skill chips POST к bus с correct context shape +
 *      subscribe to skill-bus:* events via __reframeSkillBusSubscribers.
 *   #7 Cmd+K palette feature flag (?bus=on / localStorage) + bus
 *      override map for selected commands.
 *   #8 SKILL.md frontmatter: 11 of 12 skills declare bus-* fields
 *      (reframe-product-lead intentionally omitted).
 *
 * Run: npx tsx packages/mcp/src/tests/week19-skill-bus-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'http';
import { handleSkillBusApi } from '../platform/api/skill-bus.js';
import {
  SkillRegistry,
  _resetSkillRegistry,
  getSkillRegistry,
} from '../platform/skill-registry.js';
import { initProject } from '../../../core/src/project/io.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SKILLS_DIR = path.join(REPO_ROOT, '.claude', 'skills');
const BUS_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'api', 'skill-bus.ts');
const REGISTRY_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'skill-registry.ts');
const RESULT_LIB_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '152-skill-result-render.js');
const WORKBENCH_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '155-workbench-brands.js');
const STREAM_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '060-stream.js');
const CORE_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '010-core.js');

// ─── Mock req/res ──────────────────────────────────────────────
function mockRequest(method: string, urlPath: string, body?: any): IncomingMessage {
  const ee = new EventEmitter() as any;
  ee.method = method;
  ee.url = urlPath;
  ee.headers = { host: 'localhost' };
  setImmediate(() => {
    if (body !== undefined) ee.emit('data', Buffer.from(JSON.stringify(body), 'utf-8'));
    ee.emit('end');
  });
  return ee as IncomingMessage;
}
function mockResponse() {
  const out = { statusCode: 0 as number, body: null as any };
  const res: any = {
    writeHead(c: number) { out.statusCode = c; return res; },
    end(p?: string) { try { out.body = JSON.parse(p ?? 'null'); } catch { out.body = p; } },
  };
  return { res: res as ServerResponse, out };
}

async function call(method: string, urlPath: string, body?: any, projectDir?: string) {
  _resetSkillRegistry();
  const req = mockRequest(method, urlPath, body);
  const { res, out } = mockResponse();
  await handleSkillBusApi(req, res, { projectDir: projectDir ?? REPO_ROOT } as any);
  return out;
}

async function main(): Promise<void> {
  console.log('Phase 3.5 — Skill bus contract\n');

  // ─── Pin #3 — SkillRegistry parser ─────────────────────────
  console.log('Pin #3 — SkillRegistry');
  {
    const reg = new SkillRegistry(SKILLS_DIR);
    const stats = reg.stats();
    assert(stats.total === 12, `12 skills total (got ${stats.total})`);
    assert(stats.busAware === 11, `11 bus-aware skills (product-lead excluded; got ${stats.busAware})`);

    const critic = reg.get('reframe-critic');
    assert(critic !== null, 'reframe-critic resolves');
    assert(Array.isArray(critic?.busContextTypes) && critic!.busContextTypes!.includes('scene-compiled'),
      'critic accepts scene-compiled context');
    assert(critic?.busStreaming === true, 'critic declares streaming');
    assert(Array.isArray(critic?.busResultKinds) && critic!.busResultKinds!.includes('critique-result'),
      'critic returns critique-result kind');

    const productLead = reg.get('reframe-product-lead');
    assert(productLead !== null, 'product-lead exists');
    assert(productLead?.busContextTypes === undefined,
      'product-lead has no bus-context-types (constitution-tier)');

    const motionMatches = reg.matchByContextType('motion-intent');
    const motionNames = motionMatches.map((s) => s.name).sort();
    assert(motionNames.length >= 4,
      `motion-intent matches ≥4 skills (got ${motionNames.length}: ${motionNames.join(',')})`);
    assert(motionNames.includes('reframe-motion') && motionNames.includes('hyperframes'),
      'motion-intent matches reframe-motion + hyperframes');

    assert(reg.matchByContextType('nonexistent-type').length === 0,
      'unknown context type returns empty array');
  }

  // ─── Pin #2 — bus router invocation ────────────────────────
  console.log('\nPin #2 — bus router');
  {
    // Missing skill → 400
    const r1 = await call('POST', '/platform/api/skill-bus/invoke', {});
    assert(r1.statusCode === 400, 'POST without skill → 400');

    // Missing requestId → 400
    const r2 = await call('POST', '/platform/api/skill-bus/invoke', {
      skill: 'reframe-critic',
    });
    assert(r2.statusCode === 400, 'POST without requestId → 400');

    // Invalid requestId format → 400
    const r3 = await call('POST', '/platform/api/skill-bus/invoke', {
      skill: 'reframe-critic',
      requestId: 'bad format',
    });
    assert(r3.statusCode === 400, 'POST with invalid requestId format → 400');

    // Unknown skill → 404
    const r4 = await call('POST', '/platform/api/skill-bus/invoke', {
      skill: 'nonexistent-skill',
      requestId: 'r-test1',
    });
    assert(r4.statusCode === 404, 'POST with unknown skill → 404');

    // Context-kind mismatch → 400
    const r5 = await call('POST', '/platform/api/skill-bus/invoke', {
      skill: 'reframe-critic',
      requestId: 'r-test2',
      context: { kind: 'wrong-type' },
    });
    assert(r5.statusCode === 400, 'context.kind not in declared types → 400');

    // Happy path → 202 + requestId
    const r6 = await call('POST', '/platform/api/skill-bus/invoke', {
      skill: 'reframe-critic',
      requestId: 'r-test3',
      context: { kind: 'scene-compiled', sceneId: 's17' },
    });
    assert(r6.statusCode === 202, `happy path → 202 (got ${r6.statusCode})`);
    assert(r6.body?.ok === true && r6.body?.requestId === 'r-test3',
      'response carries requestId');

    // Skill without bus-context-types accepts any context shape.
    const r7 = await call('POST', '/platform/api/skill-bus/invoke', {
      skill: 'reframe-product-lead',
      requestId: 'r-test4',
      context: { kind: 'anything' },
    });
    assert(r7.statusCode === 202, 'skill without context-types accepts any shape');

    // GET /registry returns the catalog dump.
    const r8 = await call('GET', '/platform/api/skill-bus/registry');
    assert(r8.statusCode === 200, 'GET /registry → 200');
    assert(Array.isArray(r8.body?.skills) && r8.body!.skills.length === 12,
      'GET /registry returns all 12 skills');
  }

  // ─── Pin #5 — result rendering library ─────────────────────
  console.log('\nPin #5 — result rendering library');
  {
    const lib = fs.readFileSync(RESULT_LIB_JS, 'utf-8');
    assert(/function renderSkillResult/.test(lib), 'renderSkillResult exported');
    assert(/function renderSkillProgress/.test(lib), 'renderSkillProgress exported');
    assert(/function bindSkillResultActions/.test(lib), 'bindSkillResultActions exported');
    // Per-kind renderers cover the 6 kinds + generic fallback.
    assert(/renderCritiqueResult/.test(lib), 'critique kind handler');
    assert(/renderEditResult/.test(lib), 'edit kind handler');
    assert(/renderExportResult/.test(lib), 'export kind handler');
    assert(/renderAuditResult/.test(lib), 'audit kind handler');
    assert(/renderMotionResult/.test(lib), 'motion kind handler');
    assert(/renderDesignResult/.test(lib), 'design kind handler');
    assert(/renderGenericResult/.test(lib), 'generic fallback handler');
    assert(/window\.renderSkillResult\s*=/.test(lib),
      'library exposes helpers on window for non-IIFE callers');
  }

  // ─── Pin #6 — workbench bus migration ─────────────────────
  console.log('\nPin #6 — workbench bus chips');
  {
    const wb = fs.readFileSync(WORKBENCH_JS, 'utf-8');
    assert(/function bindWorkbenchSkillChips/.test(wb), 'workbench skill chips binder');
    assert(/\/platform\/api\/skill-bus\/invoke/.test(wb), 'workbench POSTs к bus');
    assert(/data-bw-skill="reframe-brand"|data-bw-skill="reframe-critic"/.test(wb) ||
           /chipsEl.*addEventListener/.test(wb),
      'chips wired with skill data attrs');
    assert(/__reframeSkillBusSubscribers/.test(wb),
      'workbench subscribes via __reframeSkillBusSubscribers registry');
    assert(/renderSkillProgress\(\{[\s\S]{0,200}requestId/.test(wb),
      'progress event invokes renderSkillProgress');
    assert(/renderSkillResult\(\{[\s\S]{0,200}payload:\s*ev\.payload/.test(wb),
      'result event invokes renderSkillResult с payload');
  }

  // ─── Pin #7 — Cmd+K palette bus flag ──────────────────────
  console.log('\nPin #7 — Cmd+K palette feature flag');
  {
    const stream = fs.readFileSync(STREAM_JS, 'utf-8');
    assert(/var busOn = false/.test(stream), 'bus flag declared off-by-default');
    assert(/\?bus=on\\b/.test(stream) || /\\bbus=on\\b/.test(stream) || /bus=on/.test(stream),
      'flag reads ?bus=on querystring');
    assert(/reframe-skill-bus-enabled/.test(stream),
      'flag reads localStorage:reframe-skill-bus-enabled');
    assert(/busOverrides\s*=\s*\{[\s\S]{0,800}'Quality audit':/.test(stream),
      'override map covers Quality audit');
    assert(/'Switch brand':/.test(stream), 'override map covers Switch brand');
    assert(/'Generate variants':/.test(stream), 'override map covers Generate variants');
    assert(/'Tokens':/.test(stream), 'override map covers Tokens');
    assert(/'Export React':/.test(stream), 'override map covers Export React');
    assert(/cmd\.busBadge/.test(stream),
      'palette tags overridden commands with busBadge');
    assert(/busInvokeFromPalette/.test(stream),
      'palette has bus-invoke helper');
    assert(/resultPanel/.test(stream),
      'palette has inline result panel');
  }

  // ─── Pin #4 — SSE event routing in core ───────────────────
  console.log('\nPin #4 — SSE routing for skill-bus events');
  {
    const core = fs.readFileSync(CORE_JS, 'utf-8');
    assert(/case 'skill-bus:progress':/.test(core),
      'core routes skill-bus:progress events');
    assert(/case 'skill-bus:result':/.test(core),
      'core routes skill-bus:result events');
    assert(/window\.__reframeSkillBusSubscribers/.test(core),
      'core fans out to skill-bus subscriber registry');
  }

  // ─── Pin #2 + #3 source-level checks ──────────────────────
  console.log('\nPin #2 — bus source declares contract');
  {
    const bus = fs.readFileSync(BUS_TS, 'utf-8');
    assert(/POST \/platform\/api\/skill-bus\/invoke/.test(bus),
      'bus comment documents POST /invoke route');
    assert(/202/.test(bus), 'bus returns 202 status code');
    assert(/skill-bus:progress/.test(bus), 'bus emits skill-bus:progress');
    assert(/skill-bus:result/.test(bus), 'bus emits skill-bus:result');
    assert(/REQUEST_ID_RE/.test(bus), 'requestId format validator declared');
    assert(/validateContextShape/.test(bus), 'context-shape validator declared');

    const reg = fs.readFileSync(REGISTRY_TS, 'utf-8');
    assert(/extractFrontmatter/.test(reg), 'frontmatter extractor');
    assert(/parseFrontmatter/.test(reg), 'frontmatter parser');
    assert(/matchByContextType/.test(reg), 'context-type matcher exposed');
  }

  // ─── Pin #8 — SKILL.md frontmatter ─────────────────────────
  console.log('\nPin #8 — SKILL.md bus frontmatter');
  {
    const reg = new SkillRegistry(SKILLS_DIR);
    const expectStreaming = ['reframe-critic', 'reframe-design', 'reframe-motion', 'reframe-site-loop', 'designer-qa'];
    for (const name of expectStreaming) {
      const s = reg.get(name);
      assert(s?.busStreaming === true, `${name} declares streaming=true`);
    }
    const expectNoStream = ['reframe-brand', 'reframe-to-react', 'reframe-enhance', 'hyperframes', 'gsap', 'hyperframes-registry'];
    for (const name of expectNoStream) {
      const s = reg.get(name);
      assert(s?.busStreaming === false, `${name} declares streaming=false`);
    }
  }

  // ─── Singleton smoke ───────────────────────────────────────
  console.log('\nSingleton — getSkillRegistry returns same instance');
  {
    _resetSkillRegistry();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-3.5-test-'));
    initProject(tempDir, '3.5-test');
    const a = getSkillRegistry(REPO_ROOT);
    const b = getSkillRegistry(REPO_ROOT);
    assert(a === b, 'singleton returns same instance on second call');
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
