/**
 * Platform API — Agent-operable runtime endpoints (Phase 1).
 *
 * Three endpoints that make INode panels LIVE in the browser:
 *
 *   POST /platform/api/panel-mount     — compose a named panel + SSE broadcast
 *   POST /platform/api/panel-unmount   — SSE broadcast unmount
 *   POST /platform/api/agent-gesture   — dispatch data-gesture-* from the DOM
 *
 * Distinct from `/platform/api/gesture` which captures user intent via
 * threads/annotations. This module handles the newer "agent gestures"
 * emitted declaratively from INode panels via `data-gesture-click` /
 * `data-gesture-input` attributes.
 *
 * Dispatcher (brand.setToken, reframe_ui.unmount) is intentionally
 * thin — Phase 2 will open the door to full MCP tool invocation from
 * HTTP. For now we handle the two tools the brand-palette reference
 * panel needs, and log unknown tools for observability.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { PlatformContext } from '../router.js';
import { emitProjectEvent } from '../../events.js';
import { renderPanel, listRegisteredPanels } from '../panels.js';
import {
  registerBrand,
  loadBrandFromProject,
} from '../../../../core/src/project/io.js';

// ─── HTTP helpers ────────────────────────────────────────────────

async function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch {
        resolve({});
      }
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

// ─── Token writer ────────────────────────────────────────────────
// Best-effort surgical update of a single color token in DESIGN.md.
// Matches common bullet/heading patterns and replaces hex in place.
// Returns the new DESIGN.md content, or null if no pattern matched.

function patchTokenInDesignMd(
  designMd: string,
  tokenName: string,
  value: string,
): string | null {
  // Heuristic label extraction: 'color.primary' → try 'primary', 'Primary',
  // 'Primary Color'; 'color.accent' → 'accent', 'Accent', 'Accent Color'.
  const base = tokenName.replace(/^color\./, '');
  const candidates = [
    base,
    base.charAt(0).toUpperCase() + base.slice(1),
    `${base.charAt(0).toUpperCase() + base.slice(1)} Color`,
    tokenName,
  ];
  const hexRe = /#[0-9A-Fa-f]{3,8}\b/;

  // Match `- Label: #hex` or `Label: #hex` or `**Label**: #hex`.
  for (const label of candidates) {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      String.raw`(^|\n)(\s*[-*]?\s*(?:\*\*)?)(${esc})(?:\*\*)?\s*[:=]\s*` + hexRe.source,
      'gm',
    );
    if (pattern.test(designMd)) {
      return designMd.replace(pattern, (_m, pre, bullet, _name) =>
        `${pre}${bullet}${_name}: ${value}`,
      );
    }
  }
  return null;
}

// ─── Dispatcher — agent gestures ────────────────────────────────

interface GestureDispatchBody {
  tool: string;
  args: Record<string, any>;
  /** Runtime value (from {value} substitution — onInput only). */
  value?: unknown;
  /** Semantic path of dispatching node (from {path} substitution). */
  path?: string;
  /** Node id of dispatching node. */
  id?: string;
}

async function dispatchAgentGesture(
  body: GestureDispatchBody,
  ctx: PlatformContext,
): Promise<{ ok: boolean; tool: string; handled: boolean; note?: string }> {
  const tool = body.tool;
  const args = body.args ?? {};

  // ── brand.setToken — the only mutation the brand-palette panel makes.
  if (tool === 'brand.setToken' || (tool === 'reframe_edit' && args.op === 'setToken')) {
    if (!ctx.projectDir) return { ok: false, tool, handled: true, note: 'No project open.' };
    const brandSlug = String(args.brand ?? '');
    const tokenName = String(args.name ?? '');
    const value = String(args.value ?? body.value ?? '');
    if (!brandSlug || !tokenName || !value) {
      return { ok: false, tool, handled: true, note: 'brand + name + value required' };
    }

    // Fast-path SSE first — all clients repaint immediately.
    emitProjectEvent({ type: 'token:changed', brand: brandSlug, tokenName, value });

    // Persist to disk best-effort. Failures are advisory — the live patch
    // already shipped to clients.
    try {
      const loaded = loadBrandFromProject(ctx.projectDir, brandSlug);
      if (loaded) {
        const patched = patchTokenInDesignMd(loaded.content, tokenName, value);
        if (patched) {
          registerBrand(ctx.projectDir, brandSlug, patched, { setActive: false });
        }
      }
    } catch {
      /* telemetry only */
    }

    return { ok: true, tool, handled: true };
  }

  // ── reframe_ui.unmount — agent-triggered panel close from inside a panel.
  if (tool === 'reframe_ui' && args.action === 'unmount') {
    const panelName = String(args.panel ?? '');
    const slot = String(args.slot ?? 'right-panel');
    if (!panelName) return { ok: false, tool, handled: true, note: 'panel name required' };
    emitProjectEvent({ type: 'panel:unmount', slot, panelName });
    return { ok: true, tool, handled: true };
  }

  // Unknown tool — logged, not failed. Phase 2 adds full MCP invocation.
  return { ok: true, tool, handled: false, note: 'tool not handled by HTTP dispatcher (Phase 1 subset)' };
}

// ─── Route handler ───────────────────────────────────────────────

export async function handleAgentRuntimeApi(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PlatformContext,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  // ── GET /platform/api/panels — introspection for the client runtime.
  if (pathname === '/platform/api/panels' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, panels: listRegisteredPanels() });
    return true;
  }

  // ── POST /platform/api/panel-mount — compose + SSE broadcast.
  if (pathname === '/platform/api/panel-mount' && req.method === 'POST') {
    const body = await readJson(req);
    const panelName = String(body.panel ?? body.panelName ?? '');
    const slot = String(body.slot ?? 'right-panel');
    const config = (body.config ?? {}) as Record<string, unknown>;
    if (!panelName) {
      sendError(res, 400, 'panel name required');
      return true;
    }
    try {
      const t0 = performance.now();
      const rendered = renderPanel(panelName, config);
      const composeMs = performance.now() - t0;
      emitProjectEvent({
        type: 'panel:mount',
        slot,
        panelName: rendered.panelName,
        html: rendered.html,
        nodeCount: rendered.nodeCount,
      });
      sendJson(res, 200, {
        ok: true,
        panel: rendered.panelName,
        slot,
        nodeCount: rendered.nodeCount,
        htmlBytes: rendered.html.length,
        composeMs: Math.round(composeMs * 100) / 100,
      });
    } catch (e: any) {
      sendError(res, 400, e?.message ?? String(e));
    }
    return true;
  }

  // ── POST /platform/api/panel-unmount — SSE broadcast only.
  if (pathname === '/platform/api/panel-unmount' && req.method === 'POST') {
    const body = await readJson(req);
    const panelName = String(body.panel ?? body.panelName ?? '');
    const slot = String(body.slot ?? 'right-panel');
    if (!panelName) {
      sendError(res, 400, 'panel name required');
      return true;
    }
    emitProjectEvent({ type: 'panel:unmount', slot, panelName });
    sendJson(res, 200, { ok: true, panel: panelName, slot });
    return true;
  }

  // ── POST /platform/api/agent-gesture — DOM-originated gesture dispatch.
  if (pathname === '/platform/api/agent-gesture' && req.method === 'POST') {
    const body = await readJson(req);
    if (!body.tool) {
      sendError(res, 400, 'tool required');
      return true;
    }
    try {
      const result = await dispatchAgentGesture(body, ctx);
      sendJson(res, 200, result);
    } catch (e: any) {
      sendError(res, 500, e?.message ?? String(e));
    }
    return true;
  }

  return false;
}

// Opt-out preflight for the router: pathnames this module claims.
export function isAgentRuntimePath(pathname: string): boolean {
  return (
    pathname === '/platform/api/panels' ||
    pathname === '/platform/api/panel-mount' ||
    pathname === '/platform/api/panel-unmount' ||
    pathname === '/platform/api/agent-gesture'
  );
}

