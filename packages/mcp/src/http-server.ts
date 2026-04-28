/**
 * Reframe MCP HTTP Server — Streamable HTTP transport + SSE events.
 *
 * Two modes:
 *   1. Standalone: `node http-server.js` — starts HTTP only
 *   2. Sidecar: `startHttpSidecar()` — starts HTTP alongside stdio in same process
 *      (shares store + session singletons = real-time sync with Platform UI)
 *
 * Endpoints:
 *   POST /mcp    — MCP JSON-RPC (tool calls)
 *   GET  /mcp    — SSE stream for MCP server-initiated messages
 *   GET  /events — SSE stream for real-time project events
 *   GET  /health — Health check
 *
 * Scenes (Platform sync), same session store as MCP tools:
 *   GET  /scenes              — list session scenes
 *   GET  /scenes/:id          — HTML preview fragment (layout ensured)
 *   GET  /scenes/:id?format=json — full SceneJSON envelope (version, root, images?, timeline?, revision);
 *       serializeGraph with explicitTimelineKey so `timeline` is always present (object or null).
 *   PUT  /scenes/:id          — replace live graph for that session id (must exist).
 *       Body: at minimum `{ root }` (migrated node tree). Rebuilds SceneGraph from root — without `images`,
 *       embedded rasters are not rehydrated (empty graph.images). For round-trip fidelity use the same shape as
 *       GET ?format=json: `serializeGraph` from Studio/core (`root`, `images`, `timeline`, `version`).
 *       `timeline`: omit key → keep previous session timeline; `null` → clear; object → replace (after deserialize).
 *   DELETE /scenes/:id, POST /scenes/remove — drop scene from session (+ project file when open)
 *
 * **Конверт сцены:** см. [packages/core/src/spec/scene-envelope.ts](../../core/src/spec/scene-envelope.ts).
 * Ошибки десериализации PUT: тело JSON с `error`, `kind: "reframe.deserialize"`, `code`.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';

// Top-level process guards — otherwise an uncaught error inside the
// async agent-chat generator silently kills the whole server with no
// stderr trace. Root cause diagnosis loses its loudest signal.
process.on('uncaughtException', (err) => {
  process.stderr.write(`[FATAL] uncaughtException: ${err?.stack || err}\n`);
});
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[FATAL] unhandledRejection: ${reason instanceof Error ? reason.stack : JSON.stringify(reason)}\n`);
});
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { onProjectEvent } from './events.js';
import { VERSION } from './version.js';
import { getReframeInstructions } from './instructions.js';
import type { ProjectEvent } from '../../core/src/project/types.js';
import type { INodeJSON, SceneJSON } from '../../core/src/serialize.js';
import { SERIALIZE_VERSION } from '../../core/src/serialize.js';
import { deserializeErrorHttpJson } from '../../core/src/deserialize-error.js';
import { handlePlatformRequest, type PlatformContext } from './platform/router.js';
import { getProjectDir as getToolsProjectDir } from './tools/project.js';

// ─── Port management ────────────────────────────────────────

/**
 * Reframe service identifier carried in the /api/health response so any
 * process trying to bind :4100 can tell whether the existing listener is
 * a sibling reframe-sidecar (share it, don't touch) vs an unrelated
 * service (give up, don't kill). Bumped when the probe contract changes.
 */
const REFRAME_SERVICE_TAG = 'reframe-sidecar';
const REFRAME_SERVICE_PROTOCOL = 1;

/**
 * Probe whether a reframe sidecar is already listening on the port.
 *
 *   returns 'reframe' → reframe-sidecar responded; share with it
 *   returns 'foreign' → something else owns the port; do NOT kill
 *   returns 'free'    → nothing is listening
 *
 * Uses a 500 ms timeout so slow ports don't stall the MCP subprocess
 * startup path. IPv6 `::1` is tried first to match the sidecar's
 * `httpListenHost()` default; failures fall back to `127.0.0.1`.
 */
async function probeSidecar(port: number): Promise<'reframe' | 'foreign' | 'free'> {
  const hosts = ['127.0.0.1', '::1'];
  for (const host of hosts) {
    try {
      const result = await new Promise<'reframe' | 'foreign' | 'free' | 'retry'>((resolve) => {
        const req = require('http').get({
          host,
          port,
          path: '/api/health',
          timeout: 500,
          headers: { 'user-agent': 'reframe-probe/1' },
        }, (res: any) => {
          let buf = '';
          res.on('data', (c: Buffer) => { buf += c.toString(); });
          res.on('end', () => {
            try {
              const j = JSON.parse(buf);
              if (j && j.service === REFRAME_SERVICE_TAG) return resolve('reframe');
              return resolve('foreign');
            } catch {
              return resolve('foreign');
            }
          });
        });
        req.on('error', (e: any) => {
          // ECONNREFUSED = nothing listening; let fallback host try too.
          if (e && (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND')) return resolve('free');
          if (e && e.code === 'EHOSTUNREACH') return resolve('retry');
          return resolve('foreign');
        });
        req.on('timeout', () => { req.destroy(); resolve('foreign'); });
      });
      if (result !== 'retry') return result;
    } catch {
      // Best-effort — if the probe itself throws, treat as free so
      // startup proceeds and EADDRINUSE path catches real conflicts.
      return 'free';
    }
  }
  return 'free';
}

import { registerReframeMcpTools } from './register-tools.js';

/**
 * Bind address:
 *   REFRAME_BIND_LOCAL=1  → 127.0.0.1 (IPv4 loopback only)
 *   REFRAME_HTTP_HOST=... → explicit override
 *   default               → "::" (IPv6 unspecified with dual-stack)
 *
 * The default binds to `::` which Node.js treats as a dual-stack socket:
 * it accepts both IPv6 and IPv4-mapped connections on the same listener.
 * This is critical for performance on Windows: `localhost` resolves to both
 * `::1` and `127.0.0.1`, and clients try `::1` first. If the server only
 * bound to `0.0.0.0` (IPv4 wildcard), every request ate a ~200ms TCP
 * connect penalty from the IPv6 refused→IPv4 fallback path. Binding to
 * `::` eliminates that penalty entirely — `::1` connects succeed natively
 * and the Platform UI loads 10-20× faster.
 */
function httpListenHost(): string {
  const bindLocal =
    process.env.REFRAME_BIND_LOCAL === '1' ||
    process.env.REFRAME_BIND_LOCAL === 'true';
  if (bindLocal) return '127.0.0.1';
  const h = process.env.REFRAME_HTTP_HOST?.trim();
  if (h) return h;
  return '::';
}

// ─── CORS ────────────────────────────────────────────────────

function setCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
}

function sceneIdFromPath(pathname: string): string {
  const raw = pathname.split('/')[2] ?? '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        if (!raw) {
          resolve(null);
          return;
        }
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

// ─── SSE Events endpoint ─────────────────────────────────────

const sseClients = new Set<ServerResponse>();

function handleEventsSSE(_req: IncomingMessage, res: ServerResponse): void {
  setCors(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write(`data: ${JSON.stringify({ type: 'connected', version: VERSION })}\n\n`);

  sseClients.add(res);
  res.on('close', () => sseClients.delete(res));
}

export function broadcastEvent(event: ProjectEvent): void {
  // Invalidate Platform caches on any state-changing event so the next
  // request rebuilds fresh. SSE is the only signal the server has that
  // something changed, so we piggy-back invalidation here.
  const t = (event as any)?.type as string | undefined;
  if (t && t !== 'connected' && t !== 'ping') {
    invalidatePlatformContextCache();

    // Invalidate cached preview HTML/SVG bytes + audit results for the
    // affected scene. The sessionRevision already changed (which is part
    // of the cache key), so stale entries wouldn't technically be served,
    // but keeping old keys around wastes memory — evict eagerly.
    const sceneId = (event as any)?.sceneId as string | undefined;
    if (sceneId) {
      invalidatePreviewCacheForScene(sceneId);
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { invalidateAuditCacheForScene } = require('./platform/api/node-edit.js');
        invalidateAuditCacheForScene?.(sceneId);
      } catch (_) { /* best-effort */ }
    }
    // Brand switch or design-system update affects ALL scenes via token
    // binding — drop the whole preview + audit caches to be safe.
    if (t === 'design-system:updated' || t === 'project:changed') {
      previewCache.clear();
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { invalidateAuditCacheAll } = require('./platform/api/node-edit.js');
        invalidateAuditCacheAll?.();
      } catch (_) { /* best-effort */ }
    }

    // Invalidate sidebar/brand caches only for events that could affect
    // them — scene mutations don't touch the component/macro/brand list.
    if (t === 'design-system:updated' || t === 'project:changed' || t.startsWith('component:') || t.startsWith('macro:') || t.startsWith('brand:')) {
      try {
        // Lazy import to avoid a cycle: router imports from http-server
        // via emitEvent, and http-server needs router's invalidator.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { invalidateSidebarCaches } = require('./platform/router.js');
        invalidateSidebarCaches?.();
      } catch (_) { /* best-effort */ }
    }
  }
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try { client.write(data); } catch (_) {}
  }
}

/** Alias for Platform API modules that import from http-server. */
export const emitEvent = broadcastEvent;

// ─── Platform context cache ──────────────────────────────────
//
// The Platform router rebuilds a PlatformContext on every /platform/*
// request. Before caching, this meant iterating session scenes + calling
// getScene() per scene on every page navigation, every SSE-triggered
// refresh, every API call. For a session with 10+ scenes this was the
// single biggest request latency hit.
//
// The cache holds the built context for a short TTL (2s). Any SSE event
// (scene saved, brand switched, annotation added, etc.) invalidates it
// so the next request rebuilds with fresh state.

let platformContextCache: { ctx: PlatformContext; builtAt: number } | null = null;
const PLATFORM_CTX_TTL_MS = 2000;

function invalidatePlatformContextCache(): void {
  platformContextCache = null;
}

// ─── Preview HTML/SVG cache ──────────────────────────────────
//
// Each /preview/:sceneId request runs `ensureSceneLayout` (Yoga layout
// pass) + full HTML export through the engine exporter. For a 266-node
// scene this is 15-100ms; for larger scenes it climbs to 300-500ms.
// `refreshViewports` fires `iframe.src = url + '?t=' + Date.now()` on
// every SSE event, so each burst of updates previously triggered N full
// re-renders per iframe.
//
// The cache is keyed by `sceneId:sessionRevision:ext`. The session
// revision increments on every mutation (bumpSceneSessionRevision), so
// a cache HIT means "the scene graph is byte-identical to what we last
// rendered". On MISS we run the full pipeline and store the result.
// LRU-style eviction at 64 entries prevents unbounded growth.

interface PreviewCacheEntry { body: string | Buffer; contentType: string; }
const previewCache = new Map<string, PreviewCacheEntry>();
const PREVIEW_CACHE_MAX = 64;

function previewCacheSet(key: string, entry: PreviewCacheEntry): void {
  // Simple LRU — delete+re-insert moves to most-recent position.
  if (previewCache.has(key)) previewCache.delete(key);
  previewCache.set(key, entry);
  while (previewCache.size > PREVIEW_CACHE_MAX) {
    const oldest = previewCache.keys().next().value as string | undefined;
    if (!oldest) break;
    previewCache.delete(oldest);
  }
}

/** Drop all cached preview renders for a scene (called when scene
 * graph mutates). */
function invalidatePreviewCacheForScene(sceneId: string): void {
  const prefix = `${sceneId}:`;
  for (const key of previewCache.keys()) {
    if (key.startsWith(prefix)) previewCache.delete(key);
  }
}

export function buildPlatformContext(): PlatformContext {
  const now = Date.now();
  if (platformContextCache && now - platformContextCache.builtAt < PLATFORM_CTX_TTL_MS) {
    return platformContextCache.ctx;
  }
  const sessionScenes = listSessionScenes().map(s => {
    const stored = getScene(s.id);
    return {
      id: s.id,
      slug: stored?.slug ?? s.id,
      name: s.name ?? stored?.name ?? 'Untitled',
      size: s.size,
      nodes: s.nodes ?? 0,
      width: stored?.width,
      height: stored?.height,
    };
  });
  // Late-bind projectDir: if the sidecar booted against an empty cwd
  // (no .reframe/ yet), the tools/project global stays null forever.
  // An agent or a seed script that writes .reframe/project.json AFTER
  // boot would be invisible — the dashboard's self-heal route calls
  // refreshScenesFromDisk(projectDir) with a null dir and quietly
  // no-ops, so "I just saved a scene, why don't I see it?" until
  // sidecar restart. Falling back to cwd whenever a project.json
  // suddenly exists makes the flow reload-free.
  let dir = getToolsProjectDir();
  if (!dir) {
    try {
      const fs = require('fs');
      const path = require('path');
      const candidate = path.join(process.cwd(), '.reframe', 'project.json');
      if (fs.existsSync(candidate)) {
        const { setProjectDir: setToolsProjectDir } = require('./tools/project.js');
        setToolsProjectDir(process.cwd());
        dir = process.cwd();
      }
    } catch { /* best-effort */ }
  }
  const ctx: PlatformContext = {
    projectDir: dir,
    sessionScenes,
    getScene: (id: string) => {
      const s = getScene(id);
      if (!s) return null;
      return {
        id,
        slug: s.slug ?? id,
        graph: s.graph,
        rootId: s.rootId,
        name: s.name,
        brand: (s as any).brand,
      };
    },
    getDesignMd: () => null,
    getAuditScore: () => undefined,
  };
  platformContextCache = { ctx, builtAt: now };
  return ctx;
}

// ─── Shared: broadcast scene store changes via SSE ───────────
// When stdio MCP creates/updates scenes, push to Platform via SSE

import {
  listScenes as listSessionScenes,
  getScene,
  storeScene,
  getWorkspaceRoot,
  deleteScene as deleteSessionScene,
  replaceSessionSceneGraph,
  resolveSessionId,
} from './store.js';

/** Broadcast current scene list to all SSE clients. */
function broadcastSceneList(): void {
  const scenes = listSessionScenes();
  const data = `data: ${JSON.stringify({ type: 'session:scenes', scenes })}\n\n`;
  for (const client of sseClients) {
    try { client.write(data); } catch (_) {}
  }
}

// ─── Start HTTP sidecar (exported for use from index.ts) ─────

let sidecarStarted = false;
let sidecarPort = 4100;
/** Flipped to true by tryListen() once httpServer.listen() callback fires.
 *  Distinguishes "this process bound the port" from "this process only
 *  registered as a sibling consumer" when ensureHttpSidecar is re-entered. */
let _listening = false;

/**
 * Ensure the HTTP sidecar is running. Safe to call repeatedly — no-op
 * after the first successful bind AND no-op when a sibling reframe
 * process already owns the port.
 *
 * The port-sharing protocol:
 *
 *   1. If REFRAME_SKIP_HTTP_SIDECAR is set → skip entirely (tests).
 *   2. If REFRAME_HTTP_PORT<=0 → skip (parent told us to shut up).
 *   3. Probe /api/health on the requested port:
 *      - reframe-sidecar responds → sibling is alive; we ride on its
 *        data (same filesystem, same scenes, same project.json).
 *        Mark started, record port, DO NOT listen, DO NOT kill.
 *      - foreign service responds → log + disable. Never taskkill
 *        someone else's server.
 *      - nothing responds → proceed with listen as usual.
 *
 * Historical trap (pre-2026-04-24): we used to just try to listen,
 * hit EADDRINUSE, and run killPort(). If the occupant was a PARENT
 * reframe-sidecar (which happens every time an MCP subprocess is
 * spawned via .mcp.json), killPort would terminate the user's live
 * dashboard process — with no recovery. The probe-first approach
 * makes the subprocess path safe by default.
 */
/** Outcome of ensureHttpSidecar. Callers use this to decide whether to
 *  keep the Node process alive (when we bound the port) vs exit
 *  cleanly (when a sibling already owns it). */
export type EnsureSidecarResult = 'bound' | 'sibling' | 'foreign' | 'skipped';

export async function ensureHttpSidecar(port?: number): Promise<EnsureSidecarResult> {
  const skip = process.env.REFRAME_SKIP_HTTP_SIDECAR;
  if (skip === '1' || skip === 'true') return 'skipped';
  const envPort = process.env.REFRAME_HTTP_PORT;
  if (envPort !== undefined && Number(envPort) <= 0) return 'skipped';
  if (sidecarStarted) return _listening ? 'bound' : 'sibling';

  const targetPort = port ?? (envPort ? Number(envPort) : sidecarPort);
  const occupant = await probeSidecar(targetPort);
  if (occupant === 'reframe') {
    sidecarStarted = true;
    sidecarPort = targetPort;
    process.stderr.write(
      `reframe HTTP: sibling reframe-sidecar already on :${targetPort} — sharing, not re-binding\n`,
    );
    return 'sibling';
  }
  if (occupant === 'foreign') {
    process.stderr.write(
      `reframe HTTP: port ${targetPort} held by a non-reframe service — sidecar disabled (set REFRAME_HTTP_PORT to a free port or REFRAME_SKIP_HTTP_SIDECAR=1)\n`,
    );
    sidecarStarted = true;
    return 'foreign';
  }
  startHttpSidecar(targetPort);
  return 'bound';
}

/** Synchronous version for legacy call sites that can't await. */
export function ensureHttpSidecarSync(port?: number): void {
  ensureHttpSidecar(port).catch((err) => {
    process.stderr.write(`reframe HTTP: ensureHttpSidecar failed — ${err?.message || err}\n`);
  });
}

export function startHttpSidecar(port = 4100): void {
  if (sidecarStarted) return;
  sidecarStarted = true;
  sidecarPort = port;

  // ── Crash guardrails ─────────────────────────────────────────
  // The sidecar process hosts the Platform UI for a live browser
  // session. If a single async operation (a runaway subprocess MCP,
  // a rogue scene autosave race, an SSE write to a closed socket)
  // throws and nobody catches it, Node kills the process — which
  // takes down the UI the user is actively looking at. Installing
  // process-level handlers lets the sidecar log and keep running.
  // This is specifically for the "platform falls together with the
  // agent" class of bugs where a crash in one flow shouldn't kill
  // everything.
  if (!(process as any).__reframeCrashGuardInstalled) {
    (process as any).__reframeCrashGuardInstalled = true;
    process.on('uncaughtException', (err) => {
      process.stderr.write(`reframe HTTP: uncaughtException — ${err?.stack || err}\n`);
    });
    process.on('unhandledRejection', (reason) => {
      process.stderr.write(`reframe HTTP: unhandledRejection — ${(reason as any)?.stack || reason}\n`);
    });
    // Diagnostics: log every exit vector so we know WHAT killed the
    // sidecar. The "silent shutdown after compile" bug is a graceful
    // exit code 0 — which means something is calling process.exit(0),
    // sending a signal, or draining the event loop. These handlers
    // print a traceable line before the process dies.
    process.on('exit', (code) => {
      process.stderr.write(`reframe HTTP: process.exit code=${code}\n`);
    });
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
      try {
        process.on(sig, () => {
          process.stderr.write(`reframe HTTP: received ${sig} — shutting down\n`);
          // DON'T exit — let the sidecar stay alive. If the signal was
          // accidental (e.g. our own killPort hitting us during a
          // grandchild subprocess's EADDRINUSE retry), we refuse to die.
          // The user can Ctrl+C the terminal to actually stop the sidecar.
        });
      } catch { /* some platforms reject some signals */ }
    }
  }
  const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

  function createSession(): { server: McpServer; transport: StreamableHTTPServerTransport } {
    const mcpServer = new McpServer({ name: 'reframe', version: VERSION }, {
      instructions: getReframeInstructions(),
    });
    registerReframeMcpTools(mcpServer);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    return { server: mcpServer, transport };
  }

  // Subscribe event bus → SSE broadcast + scene list update
  onProjectEvent((event) => {
    broadcastEvent(event);
    // Also broadcast updated scene list after any scene change
    if (
      event.type === 'scene:saved'
      || event.type === 'scene:deleted'
      || event.type === 'scene:session-changed'
    ) {
      broadcastSceneList();
    }
  });

  const httpServer = createServer(async (req, res) => {
    setCors(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // ── Headless API routes (/api/*) ───────────────────────────
    if (url.pathname.startsWith('/api/')) {
      const { handleApiRequest } = await import('./api/router.js');
      const handled = await handleApiRequest(req, res, url);
      if (handled) return;
    }

    // ── CanvasKit WASM — serve at root for UMD compat ───────
    // canvaskit-wasm UMD fetches canvaskit.wasm from the same origin root
    // regardless of locateFile config. Serve it here so the fetch succeeds.
    if (url.pathname === '/canvaskit.wasm' && req.method === 'GET') {
      const { readFileSync, existsSync } = await import('fs');
      const { join } = await import('path');
      const wasmPath = join(process.cwd(), 'node_modules', 'canvaskit-wasm', 'bin', 'canvaskit.wasm');
      if (existsSync(wasmPath)) {
        res.writeHead(200, {
          'Content-Type': 'application/wasm',
          'Cache-Control': 'public, max-age=604800, immutable',
        });
        res.end(readFileSync(wasmPath));
        return;
      }
    }

    // ── Phase 7.1: Platform routes ───────────────────────────
    // `/platform/*` is dispatched to the new platform router before any of
    // the legacy handlers. When the router returns false the request falls
    // through to the existing sidecar endpoints below — keeps backward
    // compat for Studio / preview URLs.
    if (url.pathname === '/platform' || url.pathname.startsWith('/platform/')) {
      const ctx = buildPlatformContext();
      const handled = await handlePlatformRequest(req, res, ctx);
      if (handled) return;
    }

    // Health check.
    //
    // Two routes land here:
    //   /health       — human / ops  (full status + session counts + scenes)
    //   /api/health   — machine probe (tiny, contract-versioned, used by
    //                   sibling reframe processes to decide whether to
    //                   share this port or disable their own sidecar)
    //
    // /api/health MUST stay stable — changing its shape breaks the
    // probe in older reframe processes still running on the machine.
    // Bump REFRAME_SERVICE_PROTOCOL (top of file) when adding required
    // fields; old siblings treating an unknown protocol as foreign is
    // the fail-safe, but a mismatch triggers the "sidecar disabled"
    // path which is visible in user-facing logs.
    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        service: REFRAME_SERVICE_TAG,
        protocol: REFRAME_SERVICE_PROTOCOL,
        pid: process.pid,
        version: VERSION,
        port: sidecarPort,
      }));
      return;
    }
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        service: REFRAME_SERVICE_TAG,
        protocol: REFRAME_SERVICE_PROTOCOL,
        pid: process.pid,
        version: VERSION,
        mode: 'sidecar',
        sessions: sessions.size,
        sseClients: sseClients.size,
        scenes: listSessionScenes(),
      }));
      return;
    }

    // ── Preview UI ─────────────────────────────────────────────
    // Root and /preview are NOT served — only /platform is exposed as the
    // user-facing entry. Return 404 for discovery while keeping /preview/:id
    // (iframe contents), /site, /events, /scenes, /mcp intact.

    if (url.pathname === '/') {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!DOCTYPE html><html><body style="font-family:system-ui;padding:40px;max-width:540px;margin:0 auto"><h1>reframe</h1><p>This endpoint is not available. Open <a href="/platform">/platform</a> instead.</p></body></html>');
      return;
    }

    if (url.pathname === '/preview') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found. Use /platform instead.');
      return;
    }

    // Multi-page site preview — bundles all scenes into one clickable app
    if (url.pathname === '/site' && req.method === 'GET') {
      const scenes = listSessionScenes();
      if (scenes.length === 0) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;color:#666"><p>No scenes yet. Create scenes with reframe MCP tools first.</p></body></html>');
        return;
      }
      const { exportSite } = await import('../../core/src/exporters/site.js');
      const { ensureSceneLayout } = await import('../../core/src/engine/layout.js');
      const sitePages = [];
      for (const s of scenes) {
        const stored = getScene(s.id);
        if (!stored) continue;
        ensureSceneLayout(stored.graph, stored.rootId);
        sitePages.push({ slug: stored.slug, name: s.name || stored.slug, graph: stored.graph, rootId: stored.rootId });
      }
      const html = exportSite(sitePages, { title: 'reframe site preview', transition: 'fadeSlideUp' });
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }

    // ── Cover endpoint: /cover/<sceneId>.svg ──
    // Deterministic, always-works SVG cover for dashboard project
    // cards. Used as a layer behind the real PNG thumbnail so the grid
    // never shows broken-image icons. Also served as the `onerror`
    // fallback when CanvasKit rasterization fails.
    if (url.pathname.startsWith('/cover/') && req.method === 'GET') {
      const covTail = url.pathname.split('/cover/')[1];
      const covDot = covTail.lastIndexOf('.');
      const covSceneId = covDot >= 0 ? covTail.slice(0, covDot) : covTail;
      // Memory + disk-fallback so the cover endpoint serves real skeletons
      // for scenes compiled in another process. Without resolveSessionId
      // we'd silently degrade to procedural cover for any on-disk-only scene.
      const covSessionId = resolveSessionId(covSceneId);
      const covStored = covSessionId ? getScene(covSessionId) : undefined;
      // Two-mode resolver (#6): skeleton when scene exists, procedural fallback
      // otherwise. Same URL, different content + cache profile per mode.
      const { resolveCover } = await import('./platform/cover.js');
      const projectDir = getWorkspaceRoot();
      // Cache key uses the stable slug (matches `.reframe/scenes/<slug>.scene.json`
      // pattern); the URL may carry session id (s1) OR slug. getScene handles
      // both lookups, then we read .slug from the result.
      const cacheKey = covStored?.slug ?? covSceneId;
      const resolved = await resolveCover(
        {
          name: covStored?.name ?? covStored?.slug ?? covSceneId,
          sceneId: cacheKey,
          brand: (covStored as any)?.brand,
          width: covStored?.width,
          height: covStored?.height,
          variants: Number(url.searchParams?.get('variants') ?? 0) || undefined,
        },
        {
          projectDir,
          getScene: () => {
            const s = covStored;
            if (!s) return null;
            return { graph: s.graph, rootId: s.rootId, brand: (s as any).brand, name: s.name, width: s.width, height: s.height };
          },
        },
      );
      // ETag short-circuit — if client sent matching If-None-Match, 304.
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch && ifNoneMatch === resolved.etag) {
        res.writeHead(304, { ETag: resolved.etag });
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': `public, max-age=${resolved.maxAge}`,
        ETag: resolved.etag,
        'X-Cover-Mode': resolved.mode,
      });
      res.end(resolved.svg);
      return;
    }

    // ── Thumbnail endpoint: /thumbnail/<sceneId>.png?scale=1 ──
    if (url.pathname.startsWith('/thumbnail/') && req.method === 'GET') {
      const thumbTail = url.pathname.split('/thumbnail/')[1];
      const thumbDot = thumbTail.lastIndexOf('.');
      const thumbSceneId = thumbDot >= 0 ? thumbTail.slice(0, thumbDot) : thumbTail;
      const thumbStored = getScene(thumbSceneId);
      if (!thumbStored) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Scene not found');
        return;
      }

      const thumbScale = parseFloat(url.searchParams?.get('scale') ?? '1') || 1;
      const thumbCacheKey = `${thumbSceneId}:${thumbStored.sessionRevision ?? 0}:thumb:${thumbScale}`;
      const thumbCached = previewCache.get(thumbCacheKey);
      if (thumbCached) {
        res.writeHead(200, { 'Content-Type': 'image/png', 'X-Preview-Cache': 'hit', 'Cache-Control': 'public, max-age=60' });
        res.end(thumbCached.body);
        return;
      }

      try {
        const { ensureSceneLayout } = await import('../../core/src/engine/layout.js');
        ensureSceneLayout(thumbStored.graph, thumbStored.rootId);
        const { exportToRaster, initCanvasKit } = await import('../../core/src/exporters/raster.js');
        await initCanvasKit();
        const pngBytes = await exportToRaster(thumbStored.graph, thumbStored.rootId, { format: 'png', scale: thumbScale });
        const pngBuf = Buffer.from(pngBytes);
        previewCacheSet(thumbCacheKey, { body: pngBuf, contentType: 'image/png' });
        res.writeHead(200, { 'Content-Type': 'image/png', 'X-Preview-Cache': 'miss', 'Cache-Control': 'public, max-age=60' });
        res.end(pngBuf);
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Thumbnail error: ${err.message}`);
      }
      return;
    }

    if (url.pathname.startsWith('/preview/') && req.method === 'GET') {
      // Split `<sceneId>[.<ext>]` — the optional extension selects the
      // export format (`.svg`, `.tsx`, `.lottie`, `.transition`) so the
      // agent can link each `reframe_export` result to its own URL
      // instead of all formats sharing the same `/preview/s10` and
      // silently overwriting the last rendered format.
      const tail = url.pathname.split('/preview/')[1];
      const dotIdx = tail.lastIndexOf('.');
      const sceneId = dotIdx >= 0 ? tail.slice(0, dotIdx) : tail;
      const ext = dotIdx >= 0 ? tail.slice(dotIdx + 1).toLowerCase() : 'html';
      // Disk fallback handled by resolveSessionId — covers both the
      // manifest-listed and direct-file paths. Cross-process state
      // divergence between the HTTP sidecar and MCP stdio resolves
      // cleanly here. Falls through to 404 only if the scene file
      // genuinely doesn't exist.
      const sessionId = resolveSessionId(sceneId);
      const stored = sessionId ? getScene(sessionId) : undefined;
      if (!stored) {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>Scene not found</h1>');
        return;
      }

      // ── Preview cache ────────────────────────────────────
      // Each /preview/:id request used to re-run Yoga layout + HTML export,
      // which is 15-100ms for non-trivial scenes. Now we cache the rendered
      // HTML (or SVG) keyed by `sceneId:revision:ext`. If the scene's
      // sessionRevision hasn't changed, we serve the cached bytes directly.
      // refreshViewports cache-busts via `?t=<ts>` but that only invalidates
      // the BROWSER cache — the server can still reuse its own rendered
      // bytes because the revision alone decides freshness.
      const cacheKey = `${sceneId}:${stored.sessionRevision ?? 0}:${ext}`;
      const cached = previewCache.get(cacheKey);
      if (cached) {
        res.writeHead(200, { 'Content-Type': cached.contentType, 'X-Preview-Cache': 'hit' });
        res.end(cached.body);
        return;
      }

      const { ensureSceneLayout } = await import('../../core/src/engine/layout.js');
      ensureSceneLayout(stored.graph, stored.rootId);

      if (ext === 'svg') {
        const { exportSvgFromGraph } = await import('./engine.js');
        const svg = exportSvgFromGraph(stored.graph, stored.rootId);
        previewCacheSet(cacheKey, { body: svg, contentType: 'image/svg+xml' });
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'X-Preview-Cache': 'miss' });
        res.end(svg);
        return;
      }
      if (ext === 'tsx' || ext === 'react') {
        const { exportToReact } = await import('../../core/src/exporters/react.js');
        const { StandaloneHost } = await import('../../core/src/adapters/standalone/adapter.js');
        const { StandaloneNode } = await import('../../core/src/adapters/standalone/node.js');
        const { setHost } = await import('../../core/src/host/context.js');
        const host = new StandaloneHost(stored.graph);
        setHost(host);
        const rootNode = new StandaloneNode(stored.graph, stored.graph.getNode(stored.rootId)!);
        const tsx = exportToReact(rootNode as any, { typescript: true });
        // Render as HTML showing the TSX source — browsers can't
        // execute React source directly, so the next best thing is a
        // readable code view.
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${stored.name} — TSX</title>
<style>body{margin:0;background:#0b0b0d;color:#f5f5f7;font-family:ui-monospace,SF Mono,Menlo,monospace;padding:24px;font-size:13px;line-height:1.6}pre{margin:0;white-space:pre-wrap}</style>
</head><body><pre>${tsx.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre></body></html>`);
        return;
      }
      if (ext === 'pptx') {
        // Binary PPTX export. Run the exporter, stream with the right
        // MIME so the browser triggers a download instead of trying to
        // render a zip in an iframe. Content-Disposition hints at the
        // filename so "Save As" gets the correct default.
        const { exportToPptx } = await import('../../core/src/exporters/pptx.js');
        const buf = await exportToPptx(
          { graph: stored.graph, rootId: stored.rootId, title: stored.name },
          { deckTitle: stored.name, author: 'reframe', scale: 2 },
        );
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'Content-Disposition': `attachment; filename="${(stored.slug || sceneId).replace(/[^a-z0-9-]+/gi, '-')}.pptx"`,
          'Content-Length': String(buf.length),
        });
        res.end(buf);
        return;
      }
      if (ext === 'lottie' || ext === 'json') {
        const { exportToLottie } = await import('../../core/src/exporters/lottie.js');
        const { buildLottiePreviewHtml } = await import('../../core/src/exporters/lottie-preview.js');
        const lottieTimeline = stored.timeline ?? { animations: [], loop: true, speed: 1 };
        let lottieJson: object;
        try {
          lottieJson = exportToLottie(stored.graph, stored.rootId, lottieTimeline);
        } catch {
          const rootNode = stored.graph.getNode(stored.rootId);
          lottieJson = { v: '5.7.4', fr: 60, ip: 0, op: 60, w: Math.round(rootNode?.width ?? 1440), h: Math.round(rootNode?.height ?? 900), nm: stored.name, ddd: 0, assets: [], layers: [] };
        }
        const html = buildLottiePreviewHtml(lottieJson, stored.name ?? stored.slug);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      // Default: HTML render (same as old /preview/<id> behavior).
      // Phase 8: enable `inodeAnchors` so every element carries
      // `data-reframe-inode="<id>"` for the annotation subsystem, and
      // splice the preview inject script before </body> so hover/click
      // events bubble up to the Platform UI via postMessage.
      const { exportToHtml } = await import('../../core/src/exporters/html.js');
      const { injectPreviewScript } = await import('./preview-inject.js');
      const raw = exportToHtml(stored.graph, stored.rootId, {
        fullDocument: true,
        inodeAnchors: true,
      });
      const html = injectPreviewScript(raw);
      previewCacheSet(cacheKey, { body: html, contentType: 'text/html; charset=utf-8' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Preview-Cache': 'miss' });
      res.end(html);
      return;
    }

    // SSE events endpoint
    if (url.pathname === '/events' && req.method === 'GET') {
      handleEventsSSE(req, res);
      // Send current scene list immediately
      const scenes = listSessionScenes();
      if (scenes.length > 0) {
        res.write(`data: ${JSON.stringify({ type: 'session:scenes', scenes })}\n\n`);
      }
      return;
    }

    // Scene list API (REST)
    if (url.pathname === '/scenes' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      });
      res.end(JSON.stringify(listSessionScenes()));
      return;
    }

    // POST remove (avoids some proxies/clients blocking DELETE)
    if (url.pathname === '/scenes/remove' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const sceneId = typeof body?.sceneId === 'string' ? body.sceneId : typeof body?.id === 'string' ? body.id : '';
      if (!sceneId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'JSON body must include sceneId or id (string)' }));
        return;
      }
      if (!deleteSessionScene(sceneId)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Scene ${sceneId} not found` }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Drop a scene from the MCP session store (and project file when a project is open)
    if (url.pathname.startsWith('/scenes/') && req.method === 'DELETE') {
      const sceneId = sceneIdFromPath(url.pathname);
      if (!sceneId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Scene id required in path /scenes/:id' }));
        return;
      }
      if (!deleteSessionScene(sceneId)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Scene ${sceneId} not found` }));
        return;
      }
      res.writeHead(204);
      res.end();
      return;
    }

    // PUT /scenes/:id — see file header for body contract (root + optional images, timeline).
    if (url.pathname.startsWith('/scenes/') && req.method === 'PUT') {
      const sceneId = sceneIdFromPath(url.pathname);
      if (!sceneId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(deserializeErrorHttpJson('Scene id required in path /scenes/:id', 'SCENE_ID_REQUIRED')));
        return;
      }
      const existing = getScene(sceneId);
      if (!existing) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(deserializeErrorHttpJson(`Scene ${sceneId} not found`, 'SCENE_NOT_FOUND')));
        return;
      }
      const body = await readJsonBody(req);
      const root = body?.root;
      if (!root || typeof root !== 'object' || Array.isArray(root)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(deserializeErrorHttpJson('JSON body must include root (object)', 'ROOT_MISSING')));
        return;
      }
      const { deserializeScene, deserializeTimeline } = await import('../../core/src/serialize.js');
      const envelope: SceneJSON = {
        version: typeof body.version === 'number' ? body.version : SERIALIZE_VERSION,
        root: root as INodeJSON,
      };
      const imgs = body?.images;
      if (imgs !== null && imgs !== undefined && typeof imgs === 'object' && !Array.isArray(imgs)) {
        envelope.images = imgs as Record<string, string>;
      }
      let graph: import('../../core/src/engine/scene-graph.js').SceneGraph;
      let rootId: string;
      try {
        ({ graph, rootId } = deserializeScene(envelope));
      } catch (e: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify(
            deserializeErrorHttpJson(e?.message ?? 'deserialize failed', 'DESERIALIZE_FAILED'),
          ),
        );
        return;
      }
      let updateTimeline = false;
      let timeline: import('../../core/src/animation/types.js').ITimeline | null | undefined;
      if ('timeline' in body) {
        updateTimeline = true;
        if (body.timeline === null) {
          timeline = undefined;
        } else if (body.timeline && typeof body.timeline === 'object' && !Array.isArray(body.timeline)) {
          timeline = deserializeTimeline(body.timeline as any);
        } else {
          timeline = undefined;
        }
      }
      const out = replaceSessionSceneGraph(sceneId, graph, rootId, timeline, { updateTimeline });
      if (!out) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify(
            deserializeErrorHttpJson('replaceSessionSceneGraph failed', 'REPLACE_GRAPH_FAILED'),
          ),
        );
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ ok: true, sessionId: out.sessionId, revision: out.revision }));
      return;
    }

    // Scene export API — HTML fragment (preview) or ?format=json (SceneJSON envelope: root, images?, timeline?, version + revision)
    if (url.pathname.startsWith('/scenes/') && req.method === 'GET') {
      const sceneId = sceneIdFromPath(url.pathname);
      const stored = getScene(sceneId);
      if (!stored) {
        res.writeHead(404, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
        });
        res.end(JSON.stringify({ error: `Scene ${sceneId} not found` }));
        return;
      }
      const { ensureSceneLayout } = await import('../../core/src/engine/layout.js');
      ensureSceneLayout(stored.graph, stored.rootId);

      if (url.searchParams.get('format') === 'json') {
        const { serializeGraph } = await import('../../core/src/serialize.js');
        const payload = serializeGraph(stored.graph, stored.rootId, {
          compact: true,
          timeline: stored.timeline,
          explicitTimelineKey: true,
        });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
        });
        res.end(JSON.stringify({
          ...payload,
          revision: stored.sessionRevision ?? 1,
        }));
        return;
      }

      const { exportToHtml } = await import('../../core/src/exporters/html.js');
      const html = exportToHtml(stored.graph, stored.rootId, { fullDocument: false, dataAttributes: true });
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      });
      res.end(html);
      return;
    }

    // MCP endpoint
    if (url.pathname === '/mcp') {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        await session.transport.handleRequest(req, res);
        return;
      }

      if (req.method === 'POST' && !sessionId) {
        const session = createSession();
        session.transport.onclose = () => {
          if (session.transport.sessionId) {
            sessions.delete(session.transport.sessionId);
          }
        };
        await session.server.connect(session.transport);
        await session.transport.handleRequest(req, res);
        if (session.transport.sessionId) {
          sessions.set(session.transport.sessionId, session);
        }
        return;
      }

      if (sessionId) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found', code: -32000 }));
        return;
      }

      if (req.method === 'GET') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'POST to initialize a session first.' }));
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  let retries = 0;
  const maxRetries = 3;

  const listenHost = httpListenHost();
  // Wildcards (::/0.0.0.0) are shown as "localhost" in user-facing logs;
  // explicit hosts (REFRAME_HTTP_HOST) are printed verbatim.
  const isWildcard = listenHost === '::' || listenHost === '0.0.0.0';
  const displayHost = isWildcard ? 'localhost' : listenHost;

  function tryListen(): void {
    httpServer.listen(port, listenHost, () => {
      _listening = true;
      process.stderr.write(
        `reframe HTTP sidecar on http://${displayHost}:${port} (bind ${listenHost}; scenes + events + MCP)\n`,
      );
      // Auto-load .reframe/ project from cwd if present so scenes survive
      // server restarts. Without this every restart wipes the in-memory
      // session store, breaking already-open Platform tabs.
      try {
        const fs = require('fs');
        const path = require('path');
        // loadAllScenes/loadProject expect the workspace dir (parent of
        // .reframe), not the .reframe directory itself — they append the
        // .reframe segment internally.
        const workspace = process.cwd();
        const projectFile = path.join(workspace, '.reframe', 'project.json');
        if (fs.existsSync(projectFile)) {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { loadProjectScenes } = require('./store.js');
          // Use tools/project's setProjectDir which keeps BOTH the
          // store and the reframe_project tool's internal _projectDir
          // in sync. PlatformContext.projectDir reads from this; the
          // tokens/audit/gesture/intent endpoints check it. Without
          // this call those endpoints all 400 with "No project open".
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { setProjectDir: setToolsProjectDir, getProjectDir: getToolsProjectDir } = require('./tools/project.js');
          // Respect an already-set project dir — a test harness or
          // explicit caller (phase7-platform-http, an embedding app)
          // may have pointed the tools/store at a tmp dir before boot.
          // Overwriting that here silently hijacked their reads/writes
          // back to cwd's .reframe/, leaking real-project intents into
          // tests and leaving the tmp dir half-wired.
          if (!getToolsProjectDir()) {
            setToolsProjectDir(workspace);
            const n = loadProjectScenes(workspace);
            process.stderr.write(`reframe HTTP: auto-loaded ${n} scenes from .reframe/\n`);
          } else {
            process.stderr.write(`reframe HTTP: project dir pre-set to ${getToolsProjectDir()}, skipping cwd auto-load\n`);
          }
        } else {
          // No .reframe/ yet. Defer project init so the first `storeScene`
          // (e.g. the user clicking "Create Canvas" on the empty dashboard)
          // creates project.json + scenes/ automatically in cwd. Without
          // this, new scenes live only in memory and vanish on restart —
          // the exact "project disappears" bug the user hit after wiping
          // .reframe/.
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { setDeferredProjectInit } = require('./store.js');
          setDeferredProjectInit(workspace);
          process.stderr.write(`reframe HTTP: no .reframe/ yet — will init on first scene in ${workspace}\n`);
        }
      } catch (err: any) {
        process.stderr.write(`reframe HTTP: auto-load failed: ${err?.message || err}\n`);
      }
    });
  }

  httpServer.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      // Port-sharing protocol fix (2026-04-24): we USED to taskkill the
      // occupant here. That was catastrophic when the occupant was a
      // parent reframe-sidecar (spawned MCP subprocess → tried to bind
      // same port → killed the user's dashboard). ensureHttpSidecar now
      // probe-first-bind-second; if we hit EADDRINUSE here it means the
      // probe missed something (race condition, slow port), so disable
      // cleanly and let the parent handle the request instead of
      // fighting for ownership. killPort() stays defined for last-resort
      // manual shutdown but is never auto-invoked.
      process.stderr.write(
        `reframe HTTP: port ${port} occupied (probe missed it? race with another start?) — sidecar disabled for this process\n`,
      );
      try { httpServer.close(); } catch {}
      sidecarStarted = true; // short-circuit future ensureHttpSidecar calls
    } else {
      process.stderr.write(`reframe HTTP error: ${err.message}\n`);
    }
  });

  tryListen();
}

// ─── Standalone entry point ──────────────────────────────────

async function main() {
  const { initYoga } = await import('../../core/src/engine/yoga-init.js');
  await initYoga();

  const port = parseInt(process.env.REFRAME_PORT ?? '4100', 10);
  // ensureHttpSidecar runs the probe-first protocol — if a sibling
  // reframe-sidecar is already on this port, it exits cleanly instead
  // of fighting for ownership. startHttpSidecar is still called when
  // the probe reports the port free, so the single-instance path is
  // unchanged. Prior behaviour (direct startHttpSidecar) skipped probe
  // and relied on EADDRINUSE retry with killPort — which used to take
  // down the occupant's process (parent sidecar in MCP subprocess
  // scenarios). See ensureHttpSidecar JSDoc for the full protocol.
  const outcome = await ensureHttpSidecar(port);

  // For the standalone entry (`node http-server.js`, `npm start`), exit
  // cleanly when another reframe process already owns the port. The
  // ensureHttpSidecar result is authoritative — no async race vs
  // _listening to second-guess. Keeps `npm start` idempotent: running
  // it twice doesn't leave two half-alive Node processes.
  if (outcome === 'sibling') {
    process.stderr.write('reframe HTTP: sibling owns the port — exiting standalone starter\n');
    process.exit(0);
  }
  if (outcome === 'foreign') {
    process.stderr.write('reframe HTTP: port held by non-reframe service — exiting\n');
    process.exit(1);
  }
  // 'bound' → httpServer.listen callback keeps the event loop alive;
  // nothing else to do here.
  // 'skipped' → user explicitly disabled sidecar via env. Stay alive
  // in case they attached an MCP stdio transport separately.
}

// Only run standalone if this is the entry point
const isMain = process.argv[1]?.endsWith('http-server.js');
if (isMain) {
  main().catch((err) => {
    console.error(`reframe MCP HTTP server error: ${err.message}`);
    process.exit(1);
  });
}
