/**
 * Skill bus REST router — Phase 3.5 Pin #2 + #4.
 *
 * One canonical invocation surface that all 8 surface clients
 * (workbench / Cmd+K palette / verbs / bottom chat / context menu /
 * toolbar / drawer / thread panel) route through. The bus does NOT
 * own state — it's a thin orchestration layer that:
 *
 *   1. Validates skill exists in the registry (Pin #3).
 *   2. Validates context shape against the skill's bus-context-types.
 *   3. Returns 202 + requestId immediately (async fire-and-stream).
 *   4. Emits SSE 'skill-bus:progress' events as the invocation advances.
 *   5. Emits SSE 'skill-bus:result' with the final payload.
 *
 * The actual skill EXECUTION is intentionally NOT wired in this brief —
 * skill bodies live in .claude/skills/<name>/SKILL.md and are run by
 * the agent-side Skill tool, not by the sidecar. The bus brokers the
 * INVOCATION CONTRACT (request shape + result shape + streaming
 * semantics) and the surfaces share one client library to consume it.
 *
 * For Phase 3.5, the sidecar emits a synthetic stub result so end-to-end
 * UI flows can be exercised end-to-end without an LLM call. Real skill
 * execution wiring is Phase 4 territory — the contract this brief
 * locks in stays stable when that lands.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { PlatformContext } from '../router.js';
import { getSkillRegistry } from '../skill-registry.js';

// ─── Helpers ───────────────────────────────────────────────────

async function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
      catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, code: number, message: string): void {
  sendJson(res, code, { ok: false, error: message });
}

// ─── Validation ────────────────────────────────────────────────

const REQUEST_ID_RE = /^r-[a-z0-9-]+$/i;

interface InvokeBody {
  skill?: string;
  context?: any;
  requestId?: string;
}

function validateContextShape(
  context: any,
  busContextTypes: string[] | undefined,
): { ok: true } | { ok: false; error: string } {
  // No declared types → any context shape is acceptable. This keeps
  // skills without bus metadata invocable.
  if (!busContextTypes || busContextTypes.length === 0) return { ok: true };
  if (!context || typeof context !== 'object') {
    return { ok: false, error: 'context object required' };
  }
  // The contract today: context.kind must be one of the declared types.
  // Skills declare WHAT contexts they accept; surfaces declare WHAT
  // context they're sending via context.kind. This keeps the validator
  // simple and the contract checkable.
  const kind = String(context.kind || '');
  if (!kind) {
    return { ok: false, error: `context.kind required (skill accepts: ${busContextTypes.join(', ')})` };
  }
  if (!busContextTypes.includes(kind)) {
    return { ok: false, error: `context.kind "${kind}" not in skill's bus-context-types: ${busContextTypes.join(', ')}` };
  }
  return { ok: true };
}

// ─── Stub invocation ───────────────────────────────────────────

/**
 * Phase 3.5 placeholder: emit a synthetic progress + result so end-to-end
 * UI flows work without a real LLM. The result shape per result-kind is
 * stable; Phase 4 wires real skill bodies onto the same contract.
 *
 * Each kind returns a small payload the result-rendering library knows
 * how to render. Sidecar fires events on a sub-millisecond cadence —
 * the streaming UX comes from the SSE plumbing being real, not from
 * the synthetic delay.
 */
async function dispatchStubInvocation(opts: {
  requestId: string;
  skill: string;
  context: any;
}): Promise<void> {
  const { requestId, skill, context } = opts;
  const { emitEvent } = await import('../../http-server.js');

  // Phase pulse: queued → running → result. Real Phase 4 dispatch will
  // emit additional 'streaming' frames as token chunks land.
  emitEvent({ type: 'skill-bus:progress', requestId, phase: 'queued', skill } as any);

  setTimeout(() => {
    emitEvent({ type: 'skill-bus:progress', requestId, phase: 'running', skill } as any);
    setTimeout(() => {
      emitEvent({
        type: 'skill-bus:result',
        requestId,
        ok: true,
        skill,
        payload: synthesisePayload(skill, context),
      } as any);
    }, 30);
  }, 10);
}

function synthesisePayload(skill: string, context: any): any {
  // Result kind defaults per skill name. Phase 4 swaps in real LLM output.
  switch (skill) {
    case 'reframe-critic':
      return {
        kind: 'critique-result',
        summary: 'Phase 3.5 stub — skill body lands in Phase 4',
        findings: [],
        context,
      };
    case 'reframe-design':
      return { kind: 'design-result', stub: true, context };
    case 'reframe-brand':
      return { kind: 'edit-result', stub: true, context };
    case 'reframe-to-react':
      return { kind: 'export-result', stub: true, context };
    case 'reframe-motion':
      return { kind: 'motion-result', stub: true, context };
    default:
      return { kind: 'generic', skill, stub: true, context };
  }
}

// ─── Public handler ────────────────────────────────────────────

export async function handleSkillBusApi(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PlatformContext,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;

  // ── POST /platform/api/skill-bus/invoke ────────────────────
  if (pathname === '/platform/api/skill-bus/invoke' && req.method === 'POST') {
    const workspaceDir = ctx.projectDir ?? process.cwd();
    const registry = getSkillRegistry(workspaceDir);
    const body = (await readJson(req)) as InvokeBody;

    const skillName = String(body.skill ?? '').trim();
    const requestId = String(body.requestId ?? '').trim();
    const context = body.context;

    if (!skillName) { sendError(res, 400, 'skill required'); return true; }
    if (!requestId) { sendError(res, 400, 'requestId required'); return true; }
    if (!REQUEST_ID_RE.test(requestId)) {
      sendError(res, 400, 'requestId format must match /^r-[a-z0-9-]+$/i');
      return true;
    }

    const skill = registry.get(skillName);
    if (!skill) {
      sendError(res, 404, `skill "${skillName}" not found in registry`);
      return true;
    }

    const validation = validateContextShape(context, skill.busContextTypes);
    if (!validation.ok) {
      sendError(res, 400, validation.error);
      return true;
    }

    // Async dispatch — fire and forget. SSE events deliver progress + result.
    dispatchStubInvocation({ requestId, skill: skillName, context }).catch(() => {
      // Stub never throws but defend against future real-impl errors.
    });

    sendJson(res, 202, { ok: true, requestId, skill: skillName });
    return true;
  }

  // ── GET /platform/api/skill-bus/registry ───────────────────
  // Diagnostic + UI discovery surface — list all skills with bus metadata.
  if (pathname === '/platform/api/skill-bus/registry' && req.method === 'GET') {
    const workspaceDir = ctx.projectDir ?? process.cwd();
    const registry = getSkillRegistry(workspaceDir);
    const skills = registry.list().map((s) => ({
      name: s.name,
      description: s.description,
      busContextTypes: s.busContextTypes ?? null,
      busResultKinds: s.busResultKinds ?? null,
      busStreaming: s.busStreaming ?? null,
    }));
    sendJson(res, 200, { ok: true, skills, stats: registry.stats() });
    return true;
  }

  return false;
}
