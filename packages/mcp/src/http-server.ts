/**
 * Reframe MCP HTTP Server — Streamable HTTP transport + SSE events.
 *
 * Two modes:
 *   1. Standalone: `node http-server.js` — starts HTTP only
 *   2. Sidecar: `startHttpSidecar()` — starts HTTP alongside stdio in same process
 *      (shares store + session singletons = real-time sync with Studio)
 *
 * Endpoints:
 *   POST /mcp    — MCP JSON-RPC (tool calls)
 *   GET  /mcp    — SSE stream for MCP server-initiated messages
 *   GET  /events — SSE stream for real-time project events
 *   GET  /health — Health check
 *
 * Scenes (Studio sync), same session store as MCP tools:
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
import { createConnection } from 'net';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { onProjectEvent } from './events.js';
import { VERSION } from './version.js';
import { getReframeInstructions } from './instructions.js';
import type { ProjectEvent } from '../../core/src/project/types.js';
import type { INodeJSON, SceneJSON } from '../../core/src/serialize.js';
import { SERIALIZE_VERSION } from '../../core/src/serialize.js';
import { deserializeErrorHttpJson } from '../../core/src/deserialize-error.js';

// ─── Port management ────────────────────────────────────────

/** Kill whatever process is occupying a TCP port (Windows + Unix). */
async function killPort(port: number): Promise<void> {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8' });
      const pids = new Set(
        out.split('\n')
          .map(l => l.trim().split(/\s+/).pop())
          .filter((p): p is string => !!p && /^\d+$/.test(p) && p !== '0' && p !== String(process.pid))
      );
      for (const pid of pids) {
        try { execSync(`taskkill /PID ${pid} /F`, { encoding: 'utf8' }); } catch {}
      }
    } else {
      execSync(`lsof -ti :${port} | xargs -r kill -9`, { encoding: 'utf8' });
    }
  } catch {
    // Port may already be free
  }
}

import { registerReframeMcpTools } from './register-tools.js';

/** Bind address: REFRAME_BIND_LOCAL=1 → 127.0.0.1; else REFRAME_HTTP_HOST or 0.0.0.0 */
function httpListenHost(): string {
  const bindLocal =
    process.env.REFRAME_BIND_LOCAL === '1' ||
    process.env.REFRAME_BIND_LOCAL === 'true';
  if (bindLocal) return '127.0.0.1';
  const h = process.env.REFRAME_HTTP_HOST?.trim();
  if (h) return h;
  return '0.0.0.0';
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

/** Quick TCP check — is something listening on this port? */
function isPortOpen(port: number, timeout = 300): Promise<boolean> {
  return new Promise(resolve => {
    const sock = createConnection({ port, host: '127.0.0.1' });
    sock.setTimeout(timeout);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
    sock.on('error', () => { resolve(false); });
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

function broadcastEvent(event: ProjectEvent): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try { client.write(data); } catch (_) {}
  }
}

// ─── Shared: broadcast scene store changes via SSE ───────────
// When stdio MCP creates/updates scenes, push to Studio

import {
  listScenes as listSessionScenes,
  getScene,
  deleteScene as deleteSessionScene,
  replaceSessionSceneGraph,
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

/** Ensure sidecar is running. Safe to call multiple times — no-op after first. */
export function ensureHttpSidecar(port?: number): void {
  const skip = process.env.REFRAME_SKIP_HTTP_SIDECAR;
  if (skip === '1' || skip === 'true') return;
  if (sidecarStarted) return;
  startHttpSidecar(port ?? sidecarPort);
}

export function startHttpSidecar(port = 4100): void {
  if (sidecarStarted) return;
  sidecarStarted = true;
  sidecarPort = port;
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

    // Health check
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        version: VERSION,
        mode: 'sidecar',
        sessions: sessions.size,
        sseClients: sseClients.size,
        scenes: listSessionScenes(),
      }));
      return;
    }

    // ── Preview UI ─────────────────────────────────────────────
    // If Studio (port 3000) is running → redirect there.
    // Otherwise → lightweight preview dashboard with auto-refresh.

    if (url.pathname === '/' || url.pathname === '/preview') {
      // Check if Studio is running by testing port 3000
      const studioRunning = await isPortOpen(3000);
      if (studioRunning && url.pathname === '/') {
        res.writeHead(302, { 'Location': 'http://localhost:3000' });
        res.end();
        return;
      }
      const scenes = listSessionScenes();
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(renderPreviewDashboard(scenes, url.searchParams.get('scene') ?? undefined));
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
      const stored = getScene(sceneId);
      if (!stored) {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>Scene not found</h1>');
        return;
      }
      const { ensureSceneLayout } = await import('../../core/src/engine/layout.js');
      ensureSceneLayout(stored.graph, stored.rootId);

      if (ext === 'svg') {
        const { exportSvgFromGraph } = await import('./engine.js');
        const svg = exportSvgFromGraph(stored.graph, stored.rootId);
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
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
      if (ext === 'lottie' || ext === 'json') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html><html><body><h1>Lottie preview requires a player</h1><p>Open <code>.reframe/exports/${stored.slug}.lottie.json</code> with lottiefiles.com or a native Lottie viewer.</p></body></html>`);
        return;
      }
      // Default: HTML render (same as old /preview/<id> behavior).
      const { exportToHtml } = await import('../../core/src/exporters/html.js');
      const html = exportToHtml(stored.graph, stored.rootId, { fullDocument: true });
      res.writeHead(200, { 'Content-Type': 'text/html' });
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

    // Scene list API (simple REST for Studio polling)
    if (url.pathname === '/scenes' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      });
      res.end(JSON.stringify(listSessionScenes()));
      return;
    }

    // Studio-friendly remove (POST avoids some proxies/clients blocking DELETE)
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

    // Scene export API — HTML fragment (Studio preview) or ?format=json (SceneJSON envelope: root, images?, timeline?, version + revision)
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
  const displayHost = listenHost === '0.0.0.0' ? 'localhost' : listenHost;

  function tryListen(): void {
    httpServer.listen(port, listenHost, () => {
      process.stderr.write(
        `reframe HTTP sidecar on http://${displayHost}:${port} (bind ${listenHost}; scenes + events + MCP)\n`,
      );
    });
  }

  httpServer.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE' && retries < maxRetries) {
      retries++;
      process.stderr.write(`reframe HTTP: port ${port} in use — killing occupant (attempt ${retries}/${maxRetries})...\n`);
      killPort(port).then(() => {
        setTimeout(() => {
          httpServer.close(() => {});
          tryListen();
        }, 500);
      });
    } else if (err.code === 'EADDRINUSE') {
      process.stderr.write(`reframe HTTP: port ${port} still blocked after ${maxRetries} attempts, sidecar disabled\n`);
    } else {
      process.stderr.write(`reframe HTTP error: ${err.message}\n`);
    }
  });

  tryListen();
}

// ─── Preview Dashboard ─────────────────────────────────────

function renderPreviewDashboard(
  scenes: Array<{ id: string; slug: string; name: string; size: string; nodes: number; age: string }>,
  activeScene?: string,
): string {
  const sceneCards = scenes.map(s => {
    const isActive = activeScene === s.id || activeScene === s.slug;
    return `
      <a href="/?scene=${s.id}" class="scene-card ${isActive ? 'active' : ''}" data-id="${s.id}">
        <div class="scene-preview">
          <iframe src="/scenes/${s.id}" frameborder="0" loading="lazy"></iframe>
        </div>
        <div class="scene-info">
          <strong>${esc(s.name || s.slug)}</strong>
          <span>${s.size} &middot; ${s.nodes} nodes</span>
        </div>
      </a>`;
  }).join('\n');

  const activeIframe = activeScene
    ? `<iframe class="main-preview" src="/preview/${esc(activeScene)}" frameborder="0"></iframe>`
    : scenes.length > 0
      ? `<iframe class="main-preview" src="/preview/${esc(scenes[0].id)}" frameborder="0"></iframe>`
      : '<div class="empty">No scenes yet. Use reframe MCP tools to create designs.</div>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>reframe preview</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e5e5e5; height: 100vh; display: flex; flex-direction: column; }
    header { padding: 12px 20px; border-bottom: 1px solid #222; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
    header h1 { font-size: 15px; font-weight: 600; color: #fff; }
    header h1 span { color: #6366f1; }
    header .status { font-size: 12px; color: #666; display: flex; align-items: center; gap: 8px; }
    .site-btn { background: #6366f1; color: #fff; padding: 5px 12px; border-radius: 6px; font-size: 12px; font-weight: 500; text-decoration: none; transition: opacity 0.15s; }
    .site-btn:hover { opacity: 0.85; }
    .container { display: flex; flex: 1; min-height: 0; }
    .sidebar { width: 240px; border-right: 1px solid #222; overflow-y: auto; padding: 12px; flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; }
    .scene-card { display: block; border-radius: 8px; border: 1px solid #222; overflow: hidden; text-decoration: none; color: inherit; transition: border-color 0.15s; cursor: pointer; }
    .scene-card:hover { border-color: #444; }
    .scene-card.active { border-color: #6366f1; }
    .scene-preview { height: 100px; overflow: hidden; background: #111; position: relative; }
    .scene-preview iframe { width: 400%; height: 400%; transform: scale(0.25); transform-origin: 0 0; pointer-events: none; }
    .scene-info { padding: 8px 10px; }
    .scene-info strong { display: block; font-size: 13px; font-weight: 500; color: #fff; }
    .scene-info span { font-size: 11px; color: #666; }
    .main { flex: 1; display: flex; align-items: center; justify-content: center; padding: 20px; background: #111; min-width: 0; }
    .main-preview { width: 100%; height: 100%; border: none; border-radius: 8px; background: #fff; }
    .empty { color: #555; font-size: 14px; text-align: center; }
    .badge { display: inline-block; background: #1a1a2e; color: #6366f1; font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 500; }
  </style>
</head>
<body>
  <header>
    <h1><span>reframe</span> preview</h1>
    <div class="status">
      ${scenes.length >= 2 ? '<a href="/site" target="_blank" class="site-btn">View as Site</a>' : ''}
      <span class="badge">${scenes.length} scene${scenes.length !== 1 ? 's' : ''}</span>
    </div>
  </header>
  <div class="container">
    <div class="sidebar" id="sidebar">
      ${sceneCards || '<div class="empty">No scenes</div>'}
    </div>
    <div class="main" id="main">
      ${activeIframe}
    </div>
  </div>
  <script>
    // Auto-refresh when scenes change via SSE
    var es = new EventSource('/events');
    es.onmessage = function(e) {
      try {
        var data = JSON.parse(e.data);
        if (
          data.type === 'scene:updated'
          || data.type === 'scene:created'
          || data.type === 'session:scenes'
          || data.type === 'scene:session-changed'
        ) {
          // Reload sidebar + preview
          setTimeout(function() { location.reload(); }, 300);
        }
      } catch(err) {}
    };
  </script>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Standalone entry point ──────────────────────────────────

async function main() {
  const { initYoga } = await import('../../core/src/engine/yoga-init.js');
  await initYoga();

  const port = parseInt(process.env.REFRAME_PORT ?? '4100', 10);
  startHttpSidecar(port);
}

// Only run standalone if this is the entry point
const isMain = process.argv[1]?.endsWith('http-server.js');
if (isMain) {
  main().catch((err) => {
    console.error(`reframe MCP HTTP server error: ${err.message}`);
    process.exit(1);
  });
}
