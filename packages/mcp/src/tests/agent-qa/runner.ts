// Agent-QA runner — walks markdown scenarios that resolve Platform UI
// elements by their stable semantic path (composer-emitted), dispatches
// gestures, and asserts observable state. Unlike Playwright selectors
// (div:nth-child, class-based), semantic paths survive Yoga rewrites,
// theme changes, locale tweaks. The tests become tiny — most are just
// "click path X, expect semantic role Y to appear".
//
// A scenario file is markdown. Blocks starting with `- click <path>`
// or `- mount <panel>` are steps; `- assert <path> <predicate>` are
// assertions. One scenario = one HTTP sidecar interaction.
//
// Phase 5.6 ships the runner + two demo scenarios. Wider scenario
// coverage (full dashboard + editor + palette + inspector walks) lives
// in follow-up commits as we accumulate taste.
//
// Usage:
//   npx tsx packages/mcp/src/tests/agent-qa/runner.ts <scenario.md>

import { readFileSync } from 'fs';
import { resolve } from 'path';

type StepOk = { ok: true; step: string; elapsed: number; note?: string };
type StepFail = { ok: false; step: string; elapsed: number; reason: string };
type StepResult = StepOk | StepFail;

interface ScenarioContext {
  baseUrl: string;
  sessionId?: string;
  /** Last-known response body for assert steps. */
  lastBody?: any;
  /** Last HTML snapshot from fetch. */
  lastHtml?: string;
}

async function fetchJson(url: string, opts: RequestInit = {}): Promise<any> {
  const res = await fetch(url, opts);
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, body: JSON.parse(text) }; }
  catch { return { ok: res.ok, status: res.status, body: text }; }
}

async function fetchHtml(url: string): Promise<{ ok: boolean; status: number; html: string }> {
  const res = await fetch(url);
  const html = await res.text();
  return { ok: res.ok, status: res.status, html };
}

// ─── Step kinds ─────────────────────────────────────────────────

async function doMount(ctx: ScenarioContext, args: string): Promise<StepResult> {
  const t0 = performance.now();
  // args: "<panel-name> [key=value ...]"
  const parts = args.trim().split(/\s+/);
  const panel = parts[0];
  const config: Record<string, any> = {};
  for (const p of parts.slice(1)) {
    const [k, v] = p.split('=');
    if (k && v !== undefined) {
      // Coerce numeric strings.
      const n = Number(v);
      config[k] = Number.isFinite(n) && v.trim() !== '' ? n : v;
    }
  }
  const r = await fetchJson(`${ctx.baseUrl}/platform/api/panel-mount`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ panel, slot: 'right-panel', config }),
  });
  const elapsed = performance.now() - t0;
  if (!r.ok || !r.body?.ok) {
    return { ok: false, step: `mount ${args}`, elapsed, reason: JSON.stringify(r.body) };
  }
  ctx.lastBody = r.body;
  return { ok: true, step: `mount ${args}`, elapsed, note: `nodes=${r.body.nodeCount}` };
}

async function doNavigate(ctx: ScenarioContext, path: string): Promise<StepResult> {
  const t0 = performance.now();
  const r = await fetchHtml(`${ctx.baseUrl}${path.trim()}`);
  const elapsed = performance.now() - t0;
  if (!r.ok) return { ok: false, step: `navigate ${path}`, elapsed, reason: `http ${r.status}` };
  ctx.lastHtml = r.html;
  return { ok: true, step: `navigate ${path}`, elapsed, note: `${r.html.length} bytes` };
}

async function doGesture(ctx: ScenarioContext, args: string): Promise<StepResult> {
  // args: "<tool> <json-args>"
  const t0 = performance.now();
  const space = args.indexOf(' ');
  const tool = space < 0 ? args : args.slice(0, space);
  const jsonStr = space < 0 ? '{}' : args.slice(space + 1);
  let payload: Record<string, any>;
  try { payload = JSON.parse(jsonStr); }
  catch { return { ok: false, step: `gesture ${args}`, elapsed: 0, reason: 'bad json' }; }
  const r = await fetchJson(`${ctx.baseUrl}/platform/api/agent-gesture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, args: payload }),
  });
  const elapsed = performance.now() - t0;
  if (!r.ok || !r.body?.ok) return { ok: false, step: `gesture ${tool}`, elapsed, reason: JSON.stringify(r.body) };
  ctx.lastBody = r.body;
  return { ok: true, step: `gesture ${tool}`, elapsed, note: r.body.handled ? 'handled' : 'echo-only' };
}

function doAssertPath(ctx: ScenarioContext, path: string): StepResult {
  if (!ctx.lastHtml) return { ok: false, step: `assert ${path}`, elapsed: 0, reason: 'no HTML context (run navigate first)' };
  const re = new RegExp(`data-semantic-path="${path.trim().replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}"`, 'i');
  if (re.test(ctx.lastHtml)) return { ok: true, step: `assert ${path}`, elapsed: 0 };
  return { ok: false, step: `assert ${path}`, elapsed: 0, reason: 'semantic path not found in HTML' };
}

function doAssertRole(ctx: ScenarioContext, role: string): StepResult {
  if (!ctx.lastHtml) return { ok: false, step: `assert-role ${role}`, elapsed: 0, reason: 'no HTML context' };
  const re = new RegExp(`data-intent-role="${role.trim()}"`, 'i');
  if (re.test(ctx.lastHtml)) return { ok: true, step: `assert-role ${role}`, elapsed: 0 };
  return { ok: false, step: `assert-role ${role}`, elapsed: 0, reason: 'intent role not found' };
}

function doAssertPanelMounted(ctx: ScenarioContext, panel: string): StepResult {
  if (!ctx.lastBody) return { ok: false, step: `mounted ${panel}`, elapsed: 0, reason: 'no last body' };
  if (ctx.lastBody.panel === panel.trim()) return { ok: true, step: `mounted ${panel}`, elapsed: 0 };
  return { ok: false, step: `mounted ${panel}`, elapsed: 0, reason: `panel was ${ctx.lastBody.panel}` };
}

// ─── Parser ─────────────────────────────────────────────────────

interface Scenario {
  name: string;
  steps: Array<{ kind: string; arg: string; raw: string }>;
}

function parseScenario(md: string): Scenario {
  const lines = md.split('\n');
  let name = 'unnamed';
  const steps: Scenario['steps'] = [];
  for (const line of lines) {
    const title = line.match(/^#\s+(.+)$/);
    if (title) { name = title[1].trim(); continue; }
    const step = line.match(/^-\s+(navigate|mount|gesture|assert|assert-role|mounted)\s+(.+)$/);
    if (step) steps.push({ kind: step[1], arg: step[2].trim(), raw: line });
  }
  return { name, steps };
}

// ─── Runner ─────────────────────────────────────────────────────

async function run(scenarioPath: string) {
  const md = readFileSync(scenarioPath, 'utf-8');
  const scenario = parseScenario(md);
  const ctx: ScenarioContext = {
    baseUrl: process.env.REFRAME_QA_URL ?? 'http://localhost:4100',
  };

  console.log('─'.repeat(72));
  console.log(`  Agent-QA scenario: ${scenario.name}`);
  console.log(`  Sidecar: ${ctx.baseUrl}`);
  console.log(`  Steps: ${scenario.steps.length}`);
  console.log('─'.repeat(72));

  let fails = 0;
  for (const step of scenario.steps) {
    let res: StepResult;
    switch (step.kind) {
      case 'navigate':      res = await doNavigate(ctx, step.arg); break;
      case 'mount':         res = await doMount(ctx, step.arg); break;
      case 'gesture':       res = await doGesture(ctx, step.arg); break;
      case 'assert':        res = doAssertPath(ctx, step.arg); break;
      case 'assert-role':   res = doAssertRole(ctx, step.arg); break;
      case 'mounted':       res = doAssertPanelMounted(ctx, step.arg); break;
      default:              res = { ok: false, step: step.raw, elapsed: 0, reason: `unknown step kind ${step.kind}` };
    }
    const mark = res.ok ? '🟢' : '🔴';
    const latency = res.elapsed > 0 ? `${res.elapsed.toFixed(2)}ms` : '';
    const note = res.ok ? (res.note ?? '') : res.reason;
    console.log(`  ${mark} ${step.kind.padEnd(12)} ${step.arg.slice(0, 50).padEnd(52)} ${latency.padEnd(10)} ${note}`);
    if (!res.ok) fails++;
  }

  console.log('─'.repeat(72));
  console.log(`  ${fails === 0 ? '🟢 PASS' : '🔴 FAIL'}  (${scenario.steps.length - fails}/${scenario.steps.length} steps green)`);
  console.log('─'.repeat(72));
  if (fails > 0) process.exit(1);
}

if (process.argv.length < 3) {
  console.error('usage: tsx runner.ts <scenario.md>');
  process.exit(2);
}
run(resolve(process.argv[2])).catch(err => {
  console.error('Runner crashed:', err);
  process.exit(2);
});
