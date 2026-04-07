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
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { createConnection } from 'net';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { onProjectEvent } from './events.js';
import { VERSION } from './version.js';
import type { ProjectEvent } from '../../core/src/project/types.js';

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

// ─── Tool registration (5 tools + project) ─────────────────

import { designInputSchema, handleDesign } from './tools/design.js';
import { compileInputSchema, handleCompile } from './tools/compile.js';
import { editInputSchema, handleEdit } from './tools/edit.js';
import { exportInputSchema, handleExport } from './tools/export.js';
import { inspectInputSchema, handleInspect } from './tools/inspect.js';
import { projectInputSchema, handleProject } from './tools/project.js';

function registerTools(server: McpServer): void {
  server.tool('reframe_design', 'Extract brand DESIGN.md from HTML, or generate AI prompt. 54 pre-built brands available.', designInputSchema, handleDesign);
  server.tool('reframe_compile', 'Build designs from blueprint (120 UI components), content template, or HTML import. Pass designMd for brand theming.', compileInputSchema, handleCompile);
  server.tool('reframe_edit', 'Edit INode scenes: create/add/update/delete/clone/resize/move/adapt/component/tokens.', editInputSchema, handleEdit);
  server.tool('reframe_export', 'Export scene to html/svg/png/react/animated_html/lottie.', exportInputSchema, handleExport);
  server.tool('reframe_inspect', 'Feedback loop: tree + 19-rule audit + assertions + diff. See issues, fix, re-inspect.', inspectInputSchema, handleInspect);
  server.tool('reframe_project', 'Project management: init/open/save/load/list.', projectInputSchema, handleProject);
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

import { listScenes as listSessionScenes, getScene, deleteScene as deleteSessionScene } from './store.js';

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
  if (sidecarStarted) return;
  startHttpSidecar(port ?? sidecarPort);
}

export function startHttpSidecar(port = 4100): void {
  if (sidecarStarted) return;
  sidecarStarted = true;
  sidecarPort = port;
  const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

  function createSession(): { server: McpServer; transport: StreamableHTTPServerTransport } {
    const mcpServer = new McpServer({ name: 'reframe', version: VERSION });
    registerTools(mcpServer);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    return { server: mcpServer, transport };
  }

  // Subscribe event bus → SSE broadcast + scene list update
  onProjectEvent((event) => {
    broadcastEvent(event);
    // Also broadcast updated scene list after any scene change
    if (event.type === 'scene:saved' || event.type === 'scene:deleted') {
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
      const { computeAllLayouts } = await import('../../core/src/engine/layout.js');
      const sitePages = [];
      for (const s of scenes) {
        const stored = getScene(s.id);
        if (!stored) continue;
        try { computeAllLayouts(stored.graph, stored.rootId); } catch {}
        sitePages.push({ slug: stored.slug, name: s.name || stored.slug, graph: stored.graph, rootId: stored.rootId });
      }
      const html = exportSite(sitePages, { title: 'reframe site preview', transition: 'fadeSlideUp' });
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }

    if (url.pathname.startsWith('/preview/') && req.method === 'GET') {
      const sceneId = url.pathname.split('/preview/')[1];
      const stored = getScene(sceneId);
      if (!stored) {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>Scene not found</h1>');
        return;
      }
      const { computeAllLayouts } = await import('../../core/src/engine/layout.js');
      try { computeAllLayouts(stored.graph, stored.rootId); } catch {}
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

    // Scene export API — HTML fragment (Studio preview) or ?format=json (full INode tree, no HTML round-trip)
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
      const { computeAllLayouts } = await import('../../core/src/engine/layout.js');
      try {
        computeAllLayouts(stored.graph, stored.rootId);
      } catch {
        /* best-effort */
      }

      if (url.searchParams.get('format') === 'json') {
        const { serializeSceneNode, SERIALIZE_VERSION } = await import('../../core/src/serialize.js');
        const root = serializeSceneNode(stored.graph, stored.rootId, { compact: true });
        (root as { version?: number }).version = SERIALIZE_VERSION;
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
        });
        res.end(JSON.stringify({ root }));
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

  function tryListen(): void {
    httpServer.listen(port, () => {
      process.stderr.write(`reframe HTTP sidecar on http://localhost:${port} (scenes + events + MCP)\n`);
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
        if (data.type === 'scene:updated' || data.type === 'scene:created' || data.type === 'session:scenes') {
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
