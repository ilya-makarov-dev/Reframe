/**
 * /api/agent/* — Chat surface for the embedded Claude Code agent.
 *
 * Endpoints:
 *   POST /api/agent/chat       — body: { prompt, sessionId?, allowedTools? }
 *                                response: SSE stream of agent events
 *   POST /api/agent/cancel     — body: { chatId }    -> { ok: true }
 *   GET  /api/agent/health     — { ok, claudeFound, mcpConfig }
 *
 * The chat endpoint holds the SSE connection open for the duration of
 * the agent run. Each parsed event from the spawned `claude -p` is
 * forwarded as `event: <type>\ndata: <json>\n\n`. Browser uses
 * EventSource on the same URL.
 *
 * EventSource only supports GET, but we want to send a JSON body with
 * the prompt — so we accept POST and let the browser use `fetch` +
 * ReadableStream parsing instead. Modern browsers handle this fine.
 *
 * We intentionally avoid the global SSE `/events` channel — the agent
 * stream is per-conversation and shouldn't be broadcast to every UI tab.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { spawnAgentSession, type AgentSession, type AgentEvent } from '../agent/spawn.js';
import { ensureMcpConfig } from '../agent/mcp-config.js';
import { buildAgentPreamble } from '../agent/context.js';

// Active chat sessions, indexed by chatId. Used by /cancel to find and
// kill an in-flight agent. Cleared on session completion.
const activeChats = new Map<string, AgentSession>();

let nextChatId = 1;
function newChatId(): string {
  return `chat-${Date.now().toString(36)}-${nextChatId++}`;
}

// ─── Body reader (small JSON only) ─────────────────────────

async function readJsonBody(req: IncomingMessage, maxBytes = 64_000): Promise<any> {
  return new Promise((resolve, reject) => {
    let buf = '';
    let bytes = 0;
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      buf += chunk.toString('utf8');
    });
    req.on('end', () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ─── SSE helpers ────────────────────────────────────────────

function openSse(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering
  });
  // Comment line keeps some proxies from holding the response.
  res.write(': agent stream open\n\n');
}

function sendSseEvent(res: ServerResponse, eventName: string, data: unknown): void {
  // Format per SSE spec: event: <name>\ndata: <line>\n\n
  // JSON is single-line, so no need to split on newlines.
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ─── Handlers ───────────────────────────────────────────────

export async function handleAgentChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: any;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { ok: false, error: `Invalid body: ${(err as Error).message}` });
    return;
  }

  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    sendJson(res, 400, { ok: false, error: 'prompt required' });
    return;
  }

  // Make sure the spawned agent will find a reframe MCP server. Best-effort:
  // we don't fail the request if writing fails — the user might have a
  // read-only fs or already have a config we're not detecting.
  const cfg = ensureMcpConfig();

  const chatId = newChatId();

  // Inject design context — without this, claude has no idea it's
  // running inside reframe and answers in a vacuum (e.g. "header" →
  // git commit header). For multi-turn (sessionId present), claude
  // already has the prior context, so we skip the preamble to avoid
  // bloating the conversation with the same info each turn.
  const sceneId = typeof body?.sceneId === 'string' ? body.sceneId : undefined;
  const isFollowUp = typeof body?.sessionId === 'string';
  const fullPrompt = isFollowUp
    ? prompt
    : buildAgentPreamble({ activeSceneId: sceneId }) + prompt;

  const session = spawnAgentSession({
    prompt: fullPrompt,
    sessionId: typeof body?.sessionId === 'string' ? body.sessionId : undefined,
    allowedTools: Array.isArray(body?.allowedTools) ? body.allowedTools : undefined,
  });
  activeChats.set(chatId, session);

  // ── Open the SSE response ──
  openSse(res);
  sendSseEvent(res, 'chat_id', { chatId, mcpConfig: cfg });

  // If the client disconnects we kill the spawned agent so we don't
  // burn tokens on an answer no one is reading.
  let clientGone = false;
  req.on('close', () => {
    clientGone = true;
    session.kill();
    activeChats.delete(chatId);
  });

  // ── Drain the agent stream ──
  try {
    for await (const ev of session.events) {
      if (clientGone) break;
      sendSseEvent(res, ev.type, ev);
    }
  } catch (err) {
    sendSseEvent(res, 'error', {
      type: 'error',
      code: 'STREAM_ERROR',
      message: (err as Error).message,
    });
  } finally {
    activeChats.delete(chatId);
    if (!clientGone) {
      try { res.end(); } catch { /* ignore */ }
    }
  }
}

export async function handleAgentCancel(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: any;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { ok: false, error: 'Invalid body' });
    return;
  }
  const chatId = String(body?.chatId ?? '');
  const session = activeChats.get(chatId);
  if (!session) {
    sendJson(res, 404, { ok: false, error: 'no such chat' });
    return;
  }
  session.kill();
  activeChats.delete(chatId);
  sendJson(res, 200, { ok: true });
}

export async function handleAgentHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Lightweight check: just confirm we can find the binary.
  const { spawnSync } = await import('child_process');
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8' });
  const claudeFound = r.status === 0 && (r.stdout?.trim().length ?? 0) > 0;
  const cfg = ensureMcpConfig();
  sendJson(res, 200, {
    ok: true,
    claudeFound,
    claudePath: claudeFound ? r.stdout.split(/\r?\n/)[0].trim() : null,
    mcpConfig: cfg,
    activeChats: activeChats.size,
  });
}

// ─── Router glue (called from api/router.ts) ───────────────

export async function handleAgentApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path === '/api/agent/chat' && method === 'POST') {
    await handleAgentChat(req, res);
    return true;
  }
  if (path === '/api/agent/cancel' && method === 'POST') {
    await handleAgentCancel(req, res);
    return true;
  }
  if (path === '/api/agent/health' && method === 'GET') {
    await handleAgentHealth(req, res);
    return true;
  }
  return false;
}
