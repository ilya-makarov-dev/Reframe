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
import { generateAgentVariants } from '../agent/variants.js';
import { onProjectEvent, emitProjectEvent } from '../events.js';
import { refreshScenesFromDisk, getWorkspaceRoot, getScene } from '../store.js';
import { listPresets, getPreset, applyPreset } from '../agent/presets.js';
import { ensureSceneLayout } from '../../../core/src/engine/layout.js';

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

function openSse(res: ServerResponse): NodeJS.Timeout {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering
  });
  // Comment line keeps some proxies from holding the response.
  res.write(': agent stream open\n\n');
  // Heartbeat — comment-line ping every 15s so intermediate proxies
  // AND client runtimes (browser EventSource, Node undici with default
  // 5-min bodyTimeout) never see the connection as idle when the agent
  // is thinking between tool calls. Pure comment lines are valid SSE
  // that clients ignore — they cost nothing to emit, they guarantee
  // the TCP stream stays warm. Returns the interval handle so the
  // caller can clear it on stream end / client disconnect.
  const heartbeat = setInterval(() => {
    try { res.write(`: ping ${Date.now()}\n\n`); }
    catch { /* writable stream torn down — ignore */ }
  }, 15_000);
  return heartbeat;
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
  const nodeId = typeof body?.nodeId === 'string' ? body.nodeId : null;
  const isFollowUp = typeof body?.sessionId === 'string';
  const fullPrompt = isFollowUp
    ? prompt
    : buildAgentPreamble({ activeSceneId: sceneId, activeNodeId: nodeId }) + prompt;

  // Variant count: 1 = no fanout (default), 2 or 4 = generate
  // additional engine-vary'd alternatives after the AI finishes. The
  // UI segmented control (1/2/4) maps to this.
  const variantCount = (() => {
    const n = Number(body?.variants ?? 1);
    if (n === 2 || n === 4) return n;
    return 1;
  })();

  // Track scene IDs that emit "saved" / "session-changed" events
  // during the spawn — that's how we discover which scene the agent
  // touched (compile/edit go through store.storeScene which emits).
  // We can't ask claude to tell us — too brittle. The event bus is
  // the authoritative signal.
  const touchedScenes = new Set<string>();
  const unsubscribeEvents = onProjectEvent((ev: any) => {
    const t = ev?.type as string | undefined;
    if (!t) return;
    if (t === 'scene:saved' || t === 'scene:session-changed') {
      const sid = ev.sceneId;
      if (typeof sid === 'string') touchedScenes.add(sid);
    }
  });

  // cwd must be the workspace root (not the mcp sidecar's cwd) so
  // claude subprocess picks up .claude/skills/ + CLAUDE.md + .reframe/.
  // Without this, agents spawn in whatever dir the sidecar launched
  // from — skills silently don't load and CLAUDE.md is invisible.
  const { getWorkspaceRoot } = await import('../store.js');
  // Deep-think toggle: the bottom-chat "thinking" toggle maps to a CLI
  // `--max-thinking-tokens` budget. Cap at 10k so a runaway thinking
  // loop doesn't eat the whole context; UI only exposes an on/off
  // switch, not a budget slider, so the number is a server decision.
  const thinking = body?.thinking === true;
  const maxThinkingTokens = thinking ? 10000 : 0;

  // Project-scoped chat persistence. The UI passes the project slug so
  // each project gets its own on-disk chat log. Empty slug = ephemeral
  // (legacy pages, dev scratch) — still streams, just not saved.
  const projectSlug = typeof body?.projectSlug === 'string' ? body.projectSlug : '';
  const chatStore = projectSlug ? await import('../chat-store.js') : null;
  // If the client didn't provide a sessionId but we have one on disk
  // from an earlier turn in this project's chat, use it so `--resume`
  // picks up the conversation across page reloads.
  let resumeSessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined;
  if (!resumeSessionId && chatStore && projectSlug) {
    const hist = chatStore.loadChat(projectSlug);
    if (hist.sessionId) resumeSessionId = hist.sessionId;
  }
  if (chatStore && projectSlug && prompt) {
    chatStore.appendMessage(projectSlug, { role: 'user', text: prompt, at: Date.now() });
  }

  // Resolve the user's active canvas → slug. Pinning the spawn to this
  // slug via REFRAME_ACTIVE_SCENE_SLUG makes `reframe_compile` default
  // its `name` to this slug, so "make a pricing section" while inside
  // canvas X lands IN canvas X instead of a sibling scene called
  // "pricing". The model can still override by explicitly passing
  // `name` (e.g. for a -dark variant).
  let activeSceneSlug: string | undefined;
  if (sceneId) {
    const stored = getScene(sceneId);
    if (stored?.slug) activeSceneSlug = stored.slug;
  }
  if (!activeSceneSlug && projectSlug) {
    // Fall back to the URL project slug — for single-scene projects
    // this matches the active scene. Safer than leaving undefined.
    activeSceneSlug = projectSlug;
  }

  // Default tool whitelist — Claude Code defers any tool not in its
  // primary set when the total tool count is too high, forcing the
  // agent into a ToolSearch round-trip before every call. By pre-
  // declaring exactly which tools the design flow needs, everything
  // on this list stays non-deferred → direct calls, no lookup. The UI
  // can still override via body.allowedTools for narrower flows.
  const defaultAllowedTools = [
    'TodoWrite',
    'Read',
    'Write',
    'Edit',
    'Glob',
    'Grep',
    'Bash',
    'mcp__reframe__reframe_design',
    'mcp__reframe__reframe_compile',
    'mcp__reframe__reframe_inspect',
    'mcp__reframe__reframe_edit',
    'mcp__reframe__reframe_export',
    'mcp__reframe__reframe_project',
  ];
  const allowedTools = Array.isArray(body?.allowedTools) && body.allowedTools.length > 0
    ? body.allowedTools
    : defaultAllowedTools;

  const session = spawnAgentSession({
    prompt: fullPrompt,
    sessionId: resumeSessionId,
    allowedTools,
    cwd: getWorkspaceRoot(),
    maxThinkingTokens,
    activeSceneSlug,
  });
  activeChats.set(chatId, session);

  // ── Open the SSE response ──
  const heartbeat = openSse(res);
  sendSseEvent(res, 'chat_id', { chatId, mcpConfig: cfg });

  // If the client disconnects we kill the spawned agent so we don't
  // burn tokens on an answer no one is reading.
  let clientGone = false;
  req.on('close', () => {
    clientGone = true;
    clearInterval(heartbeat);
    session.kill();
    activeChats.delete(chatId);
  });

  // ── Drain the agent stream ──
  let agentSucceeded = false;
  // Coalesce consecutive assistant text deltas into one persisted
  // message. Claude streams `text` events in small chunks; saving each
  // one produces a shredded transcript. We flush when we hit anything
  // non-text (tool_use / done / error).
  let pendingAssistantText = '';
  const flushAssistant = (): void => {
    if (!pendingAssistantText) return;
    if (chatStore && projectSlug) {
      chatStore.appendMessage(projectSlug, { role: 'assistant', text: pendingAssistantText, at: Date.now() });
    }
    pendingAssistantText = '';
  };
  try {
    for await (const ev of session.events) {
      if (clientGone) break;
      try {
        sendSseEvent(res, ev.type, ev);
      } catch { /* response already closed */ }

      if (chatStore && projectSlug) {
        switch (ev.type) {
          case 'session_start':
            if ((ev as any).sessionId) chatStore.setChatSessionId(projectSlug, (ev as any).sessionId);
            break;
          case 'text':
            pendingAssistantText += (ev as any).text ?? '';
            break;
          case 'tool_use':
            flushAssistant();
            chatStore.appendMessage(projectSlug, {
              role: 'tool_use',
              toolName: (ev as any).toolName,
              input: (ev as any).input,
              toolUseId: (ev as any).toolUseId,
              at: Date.now(),
            });
            break;
          case 'tool_result':
            chatStore.appendMessage(projectSlug, {
              role: 'tool_result',
              toolUseId: (ev as any).toolUseId,
              ok: !!(ev as any).ok,
              preview: String((ev as any).preview ?? ''),
              at: Date.now(),
            });
            break;
          case 'done':
          case 'error':
            flushAssistant();
            break;
        }
      }

      if (ev.type === 'done' && (ev as any).reason === 'success') {
        agentSucceeded = true;
      }
    }
  } catch (err) {
    try {
      sendSseEvent(res, 'error', {
        type: 'error',
        code: 'STREAM_ERROR',
        message: (err as Error).message,
      });
    } catch { /* response already closed */ }
  } finally {
    // Persist any trailing assistant text (e.g. when the stream ends
    // without a `done` event because the client aborted mid-sentence).
    flushAssistant();
    // Stop tracking scene events before doing variants (the variants
    // themselves emit scene:session-changed events, and we don't want
    // those to count as "agent touched a scene").
    try { unsubscribeEvents(); } catch { /* ignore */ }

    // The spawned claude's reframe MCP runs in its own subprocess with
    // its own in-memory store. Its scene mutations were autosaved to
    // .reframe/scenes/ but our in-memory copy is stale. Re-sync from
    // disk regardless of agent outcome — a mid-stream error or cancel
    // can still leave a half-compiled scene on disk, and skipping this
    // sync on failure means the dashboard silently hides that scene
    // until the sidecar is restarted. Better to always pick up whatever
    // landed.
    let diskChanged: string[] = [];
    try {
      diskChanged = refreshScenesFromDisk(getWorkspaceRoot());
      // Treat disk-detected changes as "touched" by the agent so the
      // variant fan-out below picks one of them.
      for (const sid of diskChanged) touchedScenes.add(sid);
    } catch { /* best-effort */ }

    // Variant fan-out — only when agent completed cleanly, the user
    // asked for >1, and we identified at least one scene the agent
    // touched. Otherwise variants would be meaningless (vary an
    // unrelated scene = confusing).
    if (!clientGone && agentSucceeded && variantCount > 1) {
      // Pick the most-recently-touched scene: prefer disk-detected
      // changes (last-write wins). Falls back to spawn-emitted events.
      let lastTouched: string | undefined;
      for (const sid of touchedScenes) lastTouched = sid;

      if (lastTouched) {
        try {
          const result = generateAgentVariants(lastTouched, variantCount);
          if (result.variants.length > 1) {
            sendSseEvent(res, 'variants_ready', {
              type: 'variants_ready',
              sourceSceneId: result.sourceSceneId,
              variants: result.variants,
            });
          }
        } catch (err) {
          sendSseEvent(res, 'error', {
            type: 'error',
            code: 'VARIANTS_FAILED',
            message: (err as Error).message,
          });
        }
      }
    }

    activeChats.delete(chatId);
    clearInterval(heartbeat);
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

// ─── Preset endpoints ──────────────────────────────────────
//
// Presets bypass the AI entirely — the user clicks an explicit chip
// ("playful", "compact", ...) and we apply the corresponding engine
// transforms directly. Tens of milliseconds, zero tokens.

export async function handleAgentPresets(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendJson(res, 200, { ok: true, presets: listPresets() });
}

export async function handleAgentPresetApply(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: any;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { ok: false, error: 'Invalid body' });
    return;
  }

  const presetId = String(body?.presetId ?? '');
  const sceneId = String(body?.sceneId ?? '');
  const nodeId = typeof body?.nodeId === 'string' ? body.nodeId : null;

  const preset = getPreset(presetId);
  if (!preset) {
    sendJson(res, 404, { ok: false, error: `Unknown preset "${presetId}"` });
    return;
  }
  const scene = getScene(sceneId);
  if (!scene) {
    sendJson(res, 404, { ok: false, error: `Scene "${sceneId}" not found` });
    return;
  }

  // Apply to the selected node's subtree if provided, else the scene root.
  const targetRootId = nodeId && scene.graph.getNode(nodeId) ? nodeId : scene.rootId;

  let changed = 0;
  try {
    changed = applyPreset(scene.graph, targetRootId, preset);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: (err as Error).message });
    return;
  }

  // Recompute layout and bump revision so the editor pulls the new state.
  try { ensureSceneLayout(scene.graph, scene.rootId); } catch { /* best-effort */ }
  scene.sessionRevision = (scene.sessionRevision ?? 0) + 1;

  // Tell the UI a scene changed — same event the AI path emits, so the
  // canvas auto-refreshes via the existing SSE → StoreSync pull path.
  emitProjectEvent({
    type: 'scene:session-changed',
    sceneId,
    revision: scene.sessionRevision,
  });

  sendJson(res, 200, {
    ok: true,
    presetId,
    label: preset.label,
    sceneId,
    nodeId: nodeId ?? null,
    changedFields: changed,
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
  if (path === '/api/agent/presets' && method === 'GET') {
    await handleAgentPresets(req, res);
    return true;
  }
  if (path === '/api/agent/preset/apply' && method === 'POST') {
    await handleAgentPresetApply(req, res);
    return true;
  }

  // Project-scoped chat history — GET replays, DELETE starts fresh.
  // Path shape: /api/chat/<projectSlug> (URI-encoded slug).
  if (path.startsWith('/api/chat/')) {
    const slug = decodeURIComponent(path.slice('/api/chat/'.length));
    if (!slug) {
      sendJson(res, 400, { ok: false, error: 'projectSlug required' });
      return true;
    }
    const chatStore = await import('../chat-store.js');
    if (method === 'GET') {
      const history = chatStore.loadChat(slug);
      sendJson(res, 200, { ok: true, history });
      return true;
    }
    if (method === 'DELETE') {
      chatStore.clearChat(slug);
      sendJson(res, 200, { ok: true });
      return true;
    }
    sendJson(res, 405, { ok: false, error: 'method not allowed' });
    return true;
  }

  return false;
}
