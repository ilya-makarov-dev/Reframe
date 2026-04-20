/**
 * Platform API — direct node property editing.
 *
 * This is the backbone of the Properties Inspector. Every field change
 * in the right panel fires a POST here → engine applies → preview
 * updates. No intent queue, no AI agent — pure direct manipulation.
 *
 * Routes:
 *   GET  /platform/api/node/get?sceneId=s1&nodeId=n-xyz
 *        → returns CSS-named properties for the selected node
 *   POST /platform/api/node/edit
 *        → applies property changes, appends to ops history, re-renders
 *   POST /platform/api/undo
 *        → pops the last op from history, re-renders from scratch
 *   GET  /platform/api/export/:sceneId/:format
 *        → returns exported file for download
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { PlatformContext } from '../router.js';

// Lazy imports to avoid pulling the whole engine at module load time.
async function getStore() {
  return import('../../store.js');
}

async function getSceneGraph() {
  return import('../../../../core/src/engine/scene-graph.js');
}

// ─── Helpers ────────────────────────────────────────────────

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

/**
 * Parse the virtual project slug out of a Referer like
 * `http://host/platform/project/<slug>[?...]`. Returns `undefined` when the
 * request didn't originate from a project page (dashboard, components page,
 * direct API call, etc.) so the caller can fall back to the global active
 * brand. This is the backstop for endpoints whose body doesn't carry the
 * virtual slug explicitly.
 */
function extractVirtualSlugFromReferer(req: IncomingMessage): string | undefined {
  const ref = req.headers.referer;
  if (!ref || typeof ref !== 'string') return undefined;
  const match = ref.match(/\/platform\/project\/([^/?#]+)/);
  return match?.[1];
}

function sendError(res: ServerResponse, code: number, message: string): void {
  sendJson(res, code, { ok: false, error: message });
}

// ─── Audit result cache ─────────────────────────────────────
//
// Keyed by `sceneId:sessionRevision`. Cold audit is 30-100ms for
// moderate scenes (full graph walk + 20+ rules). Hits return in <1ms.
// LRU with max 64 entries — eagerly evicted via the broadcastEvent
// hook in http-server.ts when the scene's revision bumps.

const auditCache = new Map<string, string>();
const AUDIT_CACHE_MAX = 64;

function auditCacheGet(key: string): string | undefined {
  return auditCache.get(key);
}

function auditCacheSet(key: string, body: string): void {
  if (auditCache.has(key)) auditCache.delete(key);
  auditCache.set(key, body);
  while (auditCache.size > AUDIT_CACHE_MAX) {
    const oldest = auditCache.keys().next().value as string | undefined;
    if (!oldest) break;
    auditCache.delete(oldest);
  }
}

/** Drop all cached audit results for a specific scene. */
export function invalidateAuditCacheForScene(sceneId: string): void {
  const prefix = `${sceneId}:`;
  for (const key of auditCache.keys()) {
    if (key.startsWith(prefix)) auditCache.delete(key);
  }
}

/** Drop all cached audit results (brand switch / design-system update). */
export function invalidateAuditCacheAll(): void {
  auditCache.clear();
}

// ─── Color helpers ──────────────────────────────────────────

function hexToRgba(hex: string): { r: number; g: number; b: number; a: number } | null {
  const m = hex.match(/^#?([a-f0-9]{6}|[a-f0-9]{8})$/i);
  if (!m) return null;
  const h = m[1];
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
    a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  };
}

function rgbaToHex(c: { r: number; g: number; b: number; a?: number }): string {
  const r = Math.round((c.r ?? 0) * 255).toString(16).padStart(2, '0');
  const g = Math.round((c.g ?? 0) * 255).toString(16).padStart(2, '0');
  const b = Math.round((c.b ?? 0) * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

/**
 * Convert a SceneNode's rich property set into CSS-named flat key-value
 * pairs for the Properties Inspector. This is the "language bridge"
 * between engine internals (fills[], strokes[], SceneNode fields) and
 * what the designer sees (background: #533AFD, font-size: 16px).
 */
function nodeToCssProps(node: any): Record<string, any> {
  const out: Record<string, any> = {};

  // Identity
  out['name'] = node.name ?? '';
  out['type'] = node.type ?? '';
  out['id'] = node.id ?? '';
  if (node.semanticRole) out['role'] = node.semanticRole;

  // Layout / geometry
  out['width'] = Math.round(node.width ?? 0);
  out['height'] = Math.round(node.height ?? 0);
  out['x'] = Math.round(node.x ?? 0);
  out['y'] = Math.round(node.y ?? 0);

  // Flex layout
  if (node.layoutMode) out['display'] = node.layoutMode === 'VERTICAL' ? 'flex-col' : node.layoutMode === 'HORIZONTAL' ? 'flex-row' : node.layoutMode;
  if (node.itemSpacing != null) out['gap'] = node.itemSpacing;
  if (node.primaryAxisAlign) out['justify-content'] = node.primaryAxisAlign;
  if (node.counterAxisAlign) out['align-items'] = node.counterAxisAlign;

  // Padding
  out['padding-top'] = node.paddingTop ?? 0;
  out['padding-right'] = node.paddingRight ?? 0;
  out['padding-bottom'] = node.paddingBottom ?? 0;
  out['padding-left'] = node.paddingLeft ?? 0;

  // Fill → background
  if (node.fills?.length > 0) {
    const fill = node.fills[0];
    if (fill?.color) {
      out['background'] = rgbaToHex(fill.color);
      out['background-opacity'] = fill.opacity ?? 1;
    }
  }

  // Stroke → border
  if (node.strokes?.length > 0) {
    const stroke = node.strokes[0];
    if (stroke?.color) {
      out['border-color'] = rgbaToHex(stroke.color);
      out['border-width'] = stroke.weight ?? 1;
    }
  }

  // Typography
  if (node.fontSize != null) out['font-size'] = node.fontSize;
  if (node.fontFamily) out['font-family'] = node.fontFamily;
  if (node.fontWeight != null) out['font-weight'] = node.fontWeight;
  if (node.lineHeight != null) out['line-height'] = typeof node.lineHeight === 'object' ? node.lineHeight.value : node.lineHeight;
  if (node.letterSpacing != null) out['letter-spacing'] = typeof node.letterSpacing === 'object' ? node.letterSpacing.value : node.letterSpacing;
  if (node.text != null) out['text-content'] = node.text;
  if (node.textAlignHorizontal) out['text-align'] = node.textAlignHorizontal.toLowerCase();

  // Text color (from fills on TEXT nodes)
  if (node.type === 'TEXT' && node.fills?.length > 0) {
    const fill = node.fills[0];
    if (fill?.color) {
      out['color'] = rgbaToHex(fill.color);
    }
  }

  // Effects
  out['border-radius'] = node.cornerRadius ?? 0;
  out['opacity'] = node.opacity ?? 1;
  if (node.effects?.length > 0) {
    out['effects'] = node.effects.map((e: any) => ({
      type: e.type,
      color: e.color ? rgbaToHex(e.color) : undefined,
      offset: e.offset,
      radius: e.radius,
      spread: e.spread,
      visible: e.visible,
    }));
  }

  out['visible'] = node.visible !== false;
  out['clips-content'] = !!node.clipsContent;

  // Token bindings (Phase 3b)
  if (node.meta?.tokenBindings) {
    out['token-bindings'] = node.meta.tokenBindings;
  }

  // ── Interaction states (hover/active/focus/disabled) ──
  if (node.states && typeof node.states === 'object') {
    out['states'] = node.states;
  }

  // ── Responsive breakpoints ──
  if (Array.isArray(node.responsive) && node.responsive.length > 0) {
    out['responsive'] = node.responsive;
  }

  // ── Grid layout ──
  if (Array.isArray(node.gridTemplateColumns)) out['grid-columns'] = node.gridTemplateColumns;
  if (Array.isArray(node.gridTemplateRows)) out['grid-rows'] = node.gridTemplateRows;
  if (node.gridColumnGap != null) out['grid-col-gap'] = node.gridColumnGap;
  if (node.gridRowGap != null) out['grid-row-gap'] = node.gridRowGap;

  // ── Corner smoothing ──
  if (node.cornerSmoothing != null) out['corner-smoothing'] = node.cornerSmoothing;
  if (node.independentCorners) {
    out['radius-tl'] = node.topLeftRadius ?? 0;
    out['radius-tr'] = node.topRightRadius ?? 0;
    out['radius-br'] = node.bottomRightRadius ?? 0;
    out['radius-bl'] = node.bottomLeftRadius ?? 0;
  }

  // ── Stroke details ──
  if (node.strokes?.length > 0) {
    const s = node.strokes[0];
    if (s.weight != null) out['stroke-weight'] = s.weight;
    if (s.align) out['stroke-align'] = s.align;
    if (s.cap) out['stroke-cap'] = s.cap;
    if (s.join) out['stroke-join'] = s.join;
    if (Array.isArray(s.dashPattern) && s.dashPattern.length > 0) out['stroke-dash'] = s.dashPattern.join(',');
  }

  // ── OpenType ──
  if (Array.isArray(node.fontFeatureSettings) && node.fontFeatureSettings.length > 0) {
    out['font-features'] = node.fontFeatureSettings;
  }

  // ── Sizing constraints ──
  if (node.minWidth != null) out['min-width'] = node.minWidth;
  if (node.maxWidth != null) out['max-width'] = node.maxWidth;
  if (node.minHeight != null) out['min-height'] = node.minHeight;
  if (node.maxHeight != null) out['max-height'] = node.maxHeight;
  if (node.primaryAxisSizing) out['main-sizing'] = node.primaryAxisSizing;
  if (node.counterAxisSizing) out['cross-sizing'] = node.counterAxisSizing;

  // ── Semantic ──
  if (node.href) out['href'] = node.href;
  if (node.slot) out['slot'] = node.slot;
  if (node.componentId) out['component-id'] = node.componentId;

  // ── Rich text runs ──
  if (Array.isArray(node.styleRuns) && node.styleRuns.length > 0) {
    out['style-runs'] = node.styleRuns.length;
  }

  return out;
}

/**
 * Convert CSS-named property edits from the Properties Inspector
 * into engine-level SceneNode partial. Handles the translation:
 *   'background' → fills[0].color
 *   'font-size' → fontSize
 *   etc.
 */
function cssPropsToNodePartial(edits: Record<string, any>): Record<string, any> {
  const partial: Record<string, any> = {};

  for (const [key, value] of Object.entries(edits)) {
    switch (key) {
      case 'width':         partial.width = Number(value); break;
      case 'height':        partial.height = Number(value); break;
      case 'x':             partial.x = Number(value); partial.layoutPositioning = 'ABSOLUTE'; break;
      case 'y':             partial.y = Number(value); partial.layoutPositioning = 'ABSOLUTE'; break;
      // Layout primitives used by the "Detach" button. Without these
      // cases the server silently dropped these edits, so the browser's
      // OP graph kept the old AUTO layoutMode even after detach →
      // Yoga kept overriding x/y and drag felt dead.
      case 'layoutPositioning': partial.layoutPositioning = String(value); break;
      case 'primaryAxisSizing': partial.primaryAxisSizing = String(value); break;
      case 'counterAxisSizing': partial.counterAxisSizing = String(value); break;
      case 'layoutAlignSelf':   partial.layoutAlignSelf = String(value); break;
      case 'layoutGrow':        partial.layoutGrow = Number(value); break;
      case 'layoutMode':        partial.layoutMode = String(value); break;
      case 'gap':           partial.itemSpacing = Number(value); break;
      case 'padding-top':   partial.paddingTop = Number(value); break;
      case 'padding-right': partial.paddingRight = Number(value); break;
      case 'padding-bottom':partial.paddingBottom = Number(value); break;
      case 'padding-left':  partial.paddingLeft = Number(value); break;
      case 'font-size':     partial.fontSize = Number(value); break;
      case 'font-family':   partial.fontFamily = String(value); break;
      case 'font-weight':   partial.fontWeight = Number(value); break;
      case 'line-height':   partial.lineHeight = { value: Number(value), unit: 'PIXELS' }; break;
      case 'letter-spacing':partial.letterSpacing = { value: Number(value), unit: 'PIXELS' }; break;
      case 'text-content':  partial.text = String(value); break;
      case 'text-align':    partial.textAlignHorizontal = String(value).toUpperCase(); break;
      case 'border-radius': partial.cornerRadius = Number(value); break;
      case 'opacity':       partial.opacity = Number(value); break;
      case 'visible':       partial.visible = !!value; break;
      case 'clips-content': partial.clipsContent = !!value; break;
      case 'background': {
        const rgba = hexToRgba(String(value));
        if (rgba) {
          partial.fills = [{ type: 'SOLID', color: rgba, opacity: 1, visible: true }];
        }
        break;
      }
      case 'color': {
        // Text color — same as background but semantically distinct.
        const rgba = hexToRgba(String(value));
        if (rgba) {
          partial.fills = [{ type: 'SOLID', color: rgba, opacity: 1, visible: true }];
        }
        break;
      }
      case 'border-color': {
        const rgba = hexToRgba(String(value));
        if (rgba) {
          partial.strokes = [{ color: rgba, weight: 1, opacity: 1, visible: true, align: 'INSIDE' }];
        }
        break;
      }
      case 'border-width': {
        // Stroke weight — needs existing stroke or creates one.
        partial.strokes = [{ color: { r: 0, g: 0, b: 0, a: 1 }, weight: Number(value), opacity: 1, visible: true, align: 'INSIDE' }];
        break;
      }
      case 'display': {
        const v = String(value);
        if (v === 'flex-row') partial.layoutMode = 'HORIZONTAL';
        else if (v === 'flex-col') partial.layoutMode = 'VERTICAL';
        else if (v === 'none') partial.layoutMode = 'NONE';
        break;
      }
      case 'justify-content': partial.primaryAxisAlign = String(value); break;
      case 'align-items':     partial.counterAxisAlign = String(value); break;
      case 'corner-smoothing':partial.cornerSmoothing = Number(value); break;
      case 'radius-tl':      partial.topLeftRadius = Number(value); partial.independentCorners = true; break;
      case 'radius-tr':      partial.topRightRadius = Number(value); partial.independentCorners = true; break;
      case 'radius-br':      partial.bottomRightRadius = Number(value); partial.independentCorners = true; break;
      case 'radius-bl':      partial.bottomLeftRadius = Number(value); partial.independentCorners = true; break;
      case 'min-width':       partial.minWidth = Number(value); break;
      case 'max-width':       partial.maxWidth = Number(value); break;
      case 'min-height':      partial.minHeight = Number(value); break;
      case 'max-height':      partial.maxHeight = Number(value); break;
      case 'main-sizing':     partial.primaryAxisSizing = String(value); break;
      case 'cross-sizing':    partial.counterAxisSizing = String(value); break;
      case 'grid-col-gap':    partial.gridColumnGap = Number(value); break;
      case 'grid-row-gap':    partial.gridRowGap = Number(value); break;
      case 'href':            partial.href = String(value); break;
      case 'stroke-weight': {
        if (!partial.strokes) partial.strokes = [{ color: { r: 0, g: 0, b: 0, a: 1 }, weight: 1, opacity: 1, visible: true, align: 'INSIDE' }];
        (partial.strokes as any[])[0].weight = Number(value);
        break;
      }
      case 'stroke-cap': {
        if (!partial.strokes) partial.strokes = [{ color: { r: 0, g: 0, b: 0, a: 1 }, weight: 1, opacity: 1, visible: true, align: 'INSIDE' }];
        (partial.strokes as any[])[0].cap = String(value);
        break;
      }
      case 'stroke-join': {
        if (!partial.strokes) partial.strokes = [{ color: { r: 0, g: 0, b: 0, a: 1 }, weight: 1, opacity: 1, visible: true, align: 'INSIDE' }];
        (partial.strokes as any[])[0].join = String(value);
        break;
      }
      case 'font-features': {
        partial.fontFeatureSettings = Array.isArray(value) ? value : String(value).split(',').map(s => s.trim());
        break;
      }
    }
  }

  return partial;
}

// ─── Route handler ──────────────────────────────────────────

export async function handleNodeEditApi(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PlatformContext,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  // ── GET /platform/api/node/get ──────────
  if (pathname === '/platform/api/node/get' && req.method === 'GET') {
    const sceneId = url.searchParams.get('sceneId') ?? '';
    const nodeId = url.searchParams.get('nodeId') ?? '';
    if (!sceneId || !nodeId) {
      sendError(res, 400, 'sceneId + nodeId required');
      return true;
    }
    const store = await getStore();
    const scene = store.getScene(sceneId);
    if (!scene) {
      sendError(res, 404, `scene ${sceneId} not found`);
      return true;
    }
    // Resolve "root" to the actual root node ID
    const resolvedNodeId = nodeId === 'root' ? scene.rootId : nodeId;
    const node = scene.graph.getNode(resolvedNodeId);
    if (!node) {
      sendError(res, 404, `node ${nodeId} not found in scene ${sceneId}`);
      return true;
    }
    const props = nodeToCssProps(node);
    sendJson(res, 200, { ok: true, nodeId: resolvedNodeId, sceneId, props });
    return true;
  }

  // ── POST /platform/api/node/edit ────────
  if (pathname === '/platform/api/node/edit' && req.method === 'POST') {
    const body = await readJson(req);
    const sceneId = body.sceneId as string;
    let nodeId = body.nodeId as string;
    const edits = body.props as Record<string, any>;
    if (!sceneId || !nodeId || !edits || typeof edits !== 'object') {
      sendError(res, 400, 'sceneId + nodeId + props required');
      return true;
    }
    // Resolve "root" to actual root node ID
    {
      const store2 = await getStore();
      const scene2 = store2.getScene(sceneId);
      if (scene2 && nodeId === 'root') nodeId = scene2.rootId;
    }

    const store = await getStore();
    const scene = store.getScene(sceneId);
    if (!scene) {
      sendError(res, 404, `scene ${sceneId} not found`);
      return true;
    }
    const node = scene.graph.getNode(nodeId);
    if (!node) {
      sendError(res, 404, `node ${nodeId} not found`);
      return true;
    }

    // Reparent shortcut: `parent-id` moves node to a new parent.
    if (edits['parent-id'] && typeof edits['parent-id'] === 'string') {
      const newParentId = edits['parent-id'] as string;
      const newParent = scene.graph.getNode(newParentId);
      if (!newParent) {
        sendError(res, 404, `parent ${newParentId} not found`);
        return true;
      }
      const prevParentId = node.parentId;
      scene.graph.reparentNode(nodeId, newParentId);
      // Record reparent op for undo.
      if (ctx.projectDir && scene.slug) {
        try {
          const { appendOp, nextOpId } = await import('../../../../core/src/project/history.js');
          appendOp(ctx.projectDir, scene.slug, {
            id: nextOpId(),
            type: 'reparent',
            nodeId,
            props: { parentId: newParentId },
            prevProps: { parentId: prevParentId },
            timestamp: new Date().toISOString(),
          } as any);
        } catch { /* best-effort */ }
      }
      store.replaceSessionSceneGraph(sceneId, scene.graph, scene.rootId, scene.timeline ?? null);
      try {
        const { emitEvent } = await import('../../http-server.js');
        emitEvent({ type: 'scene:session-changed', sceneId } as any);
      } catch { /* best-effort */ }
      sendJson(res, 200, { ok: true, nodeId, sceneId, reparented: newParentId });
      return true;
    }

    // Capture previous values for undo.
    const partial = cssPropsToNodePartial(edits);
    const prevValues: Record<string, any> = {};
    for (const key of Object.keys(partial)) {
      prevValues[key] = (node as any)[key];
    }

    // Apply changes.
    scene.graph.updateNode(nodeId, partial);

    // Append to ops history so Cmd+Z can revert.
    if (ctx.projectDir && scene.slug) {
      try {
        const { appendOp, nextOpId } = await import('../../../../core/src/project/history.js');
        appendOp(ctx.projectDir, scene.slug, {
          id: nextOpId(),
          type: 'setProps',
          nodeId,
          props: partial,
          prevProps: prevValues,
          timestamp: new Date().toISOString(),
        } as any);
      } catch { /* best-effort */ }
    }

    // Bump session revision so SSE listeners can detect the change.
    store.replaceSessionSceneGraph(
      sceneId,
      scene.graph,
      scene.rootId,
      scene.timeline ?? null,
    );

    // Emit SSE event for live refresh.
    try {
      const { emitEvent } = await import('../../http-server.js');
      emitEvent({ type: 'scene:session-changed', sceneId } as any);
    } catch { /* best-effort */ }

    // Return updated node props so the Properties panel can confirm.
    const updatedNode = scene.graph.getNode(nodeId);
    const updatedProps = updatedNode ? nodeToCssProps(updatedNode) : {};
    sendJson(res, 200, { ok: true, nodeId, sceneId, props: updatedProps });
    return true;
  }

  // ── POST /platform/api/undo ─────────────
  if (pathname === '/platform/api/undo' && req.method === 'POST') {
    const body = await readJson(req);
    const sceneId = body.sceneId as string;
    if (!sceneId) {
      sendError(res, 400, 'sceneId required');
      return true;
    }

    const store = await getStore();
    const scene = store.getScene(sceneId);
    if (!scene) {
      sendError(res, 404, `scene ${sceneId} not found`);
      return true;
    }

    // Read ops, pop last one, rewrite.
    if (!ctx.projectDir || !scene.slug) {
      sendError(res, 400, 'no project open — cannot undo');
      return true;
    }

    try {
      const historyMod = await import('../../../../core/src/project/history.js');
      const ops = historyMod.readOps(ctx.projectDir, scene.slug);
      if (ops.length === 0) {
        sendJson(res, 200, { ok: true, undone: false, message: 'nothing to undo' });
        return true;
      }

      const lastOp = ops[ops.length - 1] as any;

      // If the last op has prevProps, apply the reverse directly.
      if (lastOp.prevProps && lastOp.nodeId) {
        const node = scene.graph.getNode(lastOp.nodeId);
        if (node) {
          scene.graph.updateNode(lastOp.nodeId, lastOp.prevProps);
        }
      }

      // Rewrite history without the last op.
      const fs = await import('fs');
      const histFile = historyMod.historyFilePath(ctx.projectDir, scene.slug);
      const remaining = ops.slice(0, -1);
      const payload = remaining.length > 0
        ? remaining.map((o: any) => JSON.stringify(o)).join('\n') + '\n'
        : '';
      fs.writeFileSync(histFile, payload, 'utf-8');

      // Update session graph.
      store.replaceSessionSceneGraph(sceneId, scene.graph, scene.rootId, scene.timeline ?? null);

      // SSE
      try {
        const { emitEvent } = await import('../../http-server.js');
        emitEvent({ type: 'scene:session-changed', sceneId } as any);
      } catch { /* best-effort */ }

      sendJson(res, 200, {
        ok: true,
        undone: true,
        op: { type: lastOp.type, nodeId: lastOp.nodeId ?? null },
      });
    } catch (e: any) {
      sendError(res, 500, e?.message ?? 'undo failed');
    }
    return true;
  }

  // ── POST /platform/api/node/add ───────────────
  // Adds a new child node under the selected parent.
  if (pathname === '/platform/api/node/add' && req.method === 'POST') {
    const body = await readJson(req);
    const { sceneId, parentId, type, name } = body;
    if (!sceneId || !parentId) { sendError(res, 400, 'sceneId + parentId required'); return true; }
    const store = await getStore();
    const scene = store.getScene(sceneId);
    if (!scene) { sendError(res, 404, 'scene not found'); return true; }
    const parent = scene.graph.getNode(parentId);
    if (!parent) { sendError(res, 404, 'parent not found'); return true; }

    const nodeType = type || 'FRAME';
    const newNode = scene.graph.createNode(nodeType, parentId, {
      name: name || (nodeType === 'TEXT' ? 'Text' : 'Frame'),
      width: nodeType === 'TEXT' ? 200 : 100,
      height: nodeType === 'TEXT' ? 24 : 100,
      ...(nodeType === 'TEXT' ? { text: 'New text', fontSize: 16, fontFamily: 'Inter' } : {}),
    } as any);

    store.replaceSessionSceneGraph(sceneId, scene.graph, scene.rootId, scene.timeline ?? null);
    try { const { emitEvent } = await import('../../http-server.js'); emitEvent({ type: 'scene:session-changed' } as any); } catch {}
    sendJson(res, 200, { ok: true, nodeId: newNode.id, type: nodeType });
    return true;
  }

  // ── POST /platform/api/scene/auto-fix ───────
  // Runs the iterate loop: audit → auto-fix → re-audit up to N rounds.
  if (pathname === '/platform/api/scene/auto-fix' && req.method === 'POST') {
    const body = await readJson(req);
    const { sceneId, maxRounds } = body;
    if (!sceneId) { sendError(res, 400, 'sceneId required'); return true; }
    const store = await getStore();
    const scene = store.getScene(sceneId);
    if (!scene) { sendError(res, 404, 'scene not found'); return true; }

    try {
      const { StandaloneNode } = await import('../../../../core/src/adapters/standalone/node.js');
      const { buildInspectAuditRules } = await import('../../../../core/src/inspect-audit-rules.js');
      const { audit: runAudit } = await import('../../../../core/src/audit.js');
      const rootSceneNode = scene.graph.getNode(scene.rootId);
      if (!rootSceneNode) { sendError(res, 500, 'root missing'); return true; }

      let ds: any = undefined;
      if (ctx.projectDir) {
        try {
          const dsText = ctx.getDesignMd?.();
          if (dsText) {
            const dsMod = await import('../../../../core/src/design-system/index.js');
            ds = dsMod.parseDesignMd(dsText);
          }
        } catch {}
      }
      const rules = buildInspectAuditRules(ds);
      let totalFixed = 0;
      const rounds = maxRounds || 3;

      for (let round = 0; round < rounds; round++) {
        const wrapped = new StandaloneNode(scene.graph, rootSceneNode);
        const issues = runAudit(wrapped as any, rules, ds);
        const fixable = issues.filter((i: any) => i.fix && i.nodeId);
        if (fixable.length === 0) break;

        for (const issue of fixable) {
          const fix = (issue as any).fix;
          const node = scene.graph.getNode((issue as any).nodeId);
          if (!node || !fix) continue;
          const edits: Record<string, any> = {};
          edits[fix.property] = fix.suggested;
          const partial = cssPropsToNodePartial(edits);
          scene.graph.updateNode((issue as any).nodeId, partial);
          totalFixed++;
        }
      }

      store.replaceSessionSceneGraph(sceneId, scene.graph, scene.rootId, scene.timeline ?? null);
      try { const { emitEvent } = await import('../../http-server.js'); emitEvent({ type: 'scene:session-changed' } as any); } catch {}
      sendJson(res, 200, { ok: true, fixed: totalFixed, rounds });
    } catch (e: any) {
      sendError(res, 500, e?.message ?? 'auto-fix failed');
    }
    return true;
  }

  // ── POST /platform/api/scene/define-tokens ──
  // Auto-binds all matching fills/strokes/fonts to design system tokens.
  if (pathname === '/platform/api/scene/define-tokens' && req.method === 'POST') {
    const body = await readJson(req);
    const { sceneId } = body;
    if (!sceneId) { sendError(res, 400, 'sceneId required'); return true; }
    const store = await getStore();
    const scene = store.getScene(sceneId);
    if (!scene) { sendError(res, 404, 'scene not found'); return true; }
    if (!ctx.projectDir) { sendError(res, 400, 'no project open'); return true; }

    try {
      // Use the edit tool's defineTokens operation path.
      const dsText = ctx.getDesignMd?.();
      if (!dsText) { sendError(res, 400, 'no DESIGN.md loaded — load a brand first'); return true; }
      const dsMod = await import('../../../../core/src/design-system/index.js');
      const ds = dsMod.parseDesignMd(dsText);

      // Walk all nodes, try to bind fills/strokes to DS colors, fonts to DS fonts.
      let bound = 0;
      for (const node of scene.graph.getAllNodes()) {
        const meta = (node as any).meta || {};
        const bindings = meta.tokenBindings || {};
        // Try fill → color token.
        if (node.fills?.length > 0 && node.fills[0]?.color && !bindings.fill) {
          const hex = rgbaToHex(node.fills[0].color);
          if (ds.colors?.primary && hex.toLowerCase() === ds.colors.primary.toLowerCase()) {
            bindings.fill = 'primary';
            bound++;
          } else if (ds.colors?.accent && hex.toLowerCase() === ds.colors.accent.toLowerCase()) {
            bindings.fill = 'accent';
            bound++;
          }
        }
        if (Object.keys(bindings).length > 0) {
          (node as any).meta = { ...meta, tokenBindings: bindings };
        }
      }

      store.replaceSessionSceneGraph(sceneId, scene.graph, scene.rootId, scene.timeline ?? null);
      try { const { emitEvent } = await import('../../http-server.js'); emitEvent({ type: 'scene:session-changed' } as any); } catch {}
      sendJson(res, 200, { ok: true, bound });
    } catch (e: any) {
      sendError(res, 500, e?.message ?? 'define-tokens failed');
    }
    return true;
  }

  // ── GET /platform/api/scene/source?sceneId=s1 ─
  // Returns the source HTML for the scene (if compiled from HTML).
  if (pathname === '/platform/api/scene/source' && req.method === 'GET') {
    const sceneId = url.searchParams.get('sceneId') ?? '';
    if (!sceneId) { sendError(res, 400, 'sceneId required'); return true; }
    const store = await getStore();
    const scene = store.getScene(sceneId);
    if (!scene || !ctx.projectDir || !scene.slug) {
      sendJson(res, 200, { ok: true, source: null });
      return true;
    }
    try {
      const { loadSourceHtml } = await import('../../../../core/src/project/io.js');
      const source = loadSourceHtml(ctx.projectDir, scene.slug);
      sendJson(res, 200, { ok: true, source: source ?? null, slug: scene.slug });
    } catch {
      sendJson(res, 200, { ok: true, source: null });
    }
    return true;
  }

  // ── POST /platform/api/node/duplicate ────────
  if (pathname === '/platform/api/node/duplicate' && req.method === 'POST') {
    const body = await readJson(req);
    const { sceneId, nodeId } = body;
    if (!sceneId || !nodeId) { sendError(res, 400, 'sceneId + nodeId required'); return true; }
    const store = await getStore();
    const scene = store.getScene(sceneId);
    if (!scene) { sendError(res, 404, 'scene not found'); return true; }
    const node = scene.graph.getNode(nodeId);
    if (!node) { sendError(res, 404, 'node not found'); return true; }
    // Clone tree under the same parent, next to the original.
    const parentId = node.parentId;
    if (!parentId) { sendError(res, 400, 'cannot duplicate root node'); return true; }
    const cloned = scene.graph.cloneTree(nodeId, parentId);
    if (!cloned) { sendError(res, 500, 'clone failed'); return true; }
    store.replaceSessionSceneGraph(sceneId, scene.graph, scene.rootId, scene.timeline ?? null);
    try { const { emitEvent } = await import('../../http-server.js'); emitEvent({ type: 'scene:session-changed' } as any); } catch {}
    sendJson(res, 200, { ok: true, newNodeId: cloned.id });
    return true;
  }

  // ── POST /platform/api/node/delete ──────────
  if (pathname === '/platform/api/node/delete' && req.method === 'POST') {
    const body = await readJson(req);
    const { sceneId, nodeId } = body;
    if (!sceneId || !nodeId) { sendError(res, 400, 'sceneId + nodeId required'); return true; }
    const store = await getStore();
    const scene = store.getScene(sceneId);
    if (!scene) { sendError(res, 404, 'scene not found'); return true; }
    if (nodeId === scene.rootId) { sendError(res, 400, 'cannot delete root node'); return true; }
    scene.graph.deleteNode(nodeId);
    store.replaceSessionSceneGraph(sceneId, scene.graph, scene.rootId, scene.timeline ?? null);
    try { const { emitEvent } = await import('../../http-server.js'); emitEvent({ type: 'scene:session-changed' } as any); } catch {}
    sendJson(res, 200, { ok: true, deleted: nodeId });
    return true;
  }

  // ── POST /platform/api/node/wrap ────────────
  // Wraps the selected node in a new FRAME container.
  if (pathname === '/platform/api/node/wrap' && req.method === 'POST') {
    const body = await readJson(req);
    const { sceneId, nodeId } = body;
    if (!sceneId || !nodeId) { sendError(res, 400, 'sceneId + nodeId required'); return true; }
    const store = await getStore();
    const scene = store.getScene(sceneId);
    if (!scene) { sendError(res, 404, 'scene not found'); return true; }
    const node = scene.graph.getNode(nodeId);
    if (!node || !node.parentId) { sendError(res, 400, 'cannot wrap root'); return true; }
    const wrapper = scene.graph.groupNodes([nodeId], node.parentId);
    wrapper.name = 'Container';
    store.replaceSessionSceneGraph(sceneId, scene.graph, scene.rootId, scene.timeline ?? null);
    try { const { emitEvent } = await import('../../http-server.js'); emitEvent({ type: 'scene:session-changed' } as any); } catch {}
    sendJson(res, 200, { ok: true, wrapperId: wrapper.id });
    return true;
  }

  // ── POST /platform/api/node/state ────────────
  // Adds or updates an interaction state (hover/active/focus/disabled)
  // on a node. States are property overrides keyed by state name.
  if (pathname === '/platform/api/node/state' && req.method === 'POST') {
    const body = await readJson(req);
    const { sceneId, nodeId, stateName, props: stateProps } = body;
    if (!sceneId || !nodeId || !stateName) {
      sendError(res, 400, 'sceneId + nodeId + stateName required');
      return true;
    }
    const store = await getStore();
    const scene = store.getScene(sceneId);
    if (!scene) { sendError(res, 404, 'scene not found'); return true; }
    const node = scene.graph.getNode(nodeId);
    if (!node) { sendError(res, 404, 'node not found'); return true; }

    // Merge state overrides.
    const states = (node as any).states || {};
    states[stateName] = { ...(states[stateName] || {}), ...stateProps };
    scene.graph.updateNode(nodeId, { states } as any);

    store.replaceSessionSceneGraph(sceneId, scene.graph, scene.rootId, scene.timeline ?? null);
    try {
      const { emitEvent } = await import('../../http-server.js');
      emitEvent({ type: 'scene:session-changed', sceneId } as any);
    } catch {}

    sendJson(res, 200, { ok: true, nodeId, stateName, states });
    return true;
  }

  // ── POST /platform/api/node/animate ─────────
  // Applies an animation preset to a node.
  if (pathname === '/platform/api/node/animate' && req.method === 'POST') {
    const body = await readJson(req);
    const { sceneId, nodeId, preset, duration, delay } = body;
    if (!sceneId || !nodeId || !preset) {
      sendError(res, 400, 'sceneId + nodeId + preset required');
      return true;
    }
    const store = await getStore();
    const scene = store.getScene(sceneId);
    if (!scene) { sendError(res, 404, 'scene not found'); return true; }
    const node = scene.graph.getNode(nodeId);
    if (!node) { sendError(res, 404, 'node not found'); return true; }

    // Try to apply via ops system.
    if (ctx.projectDir && scene.slug) {
      try {
        const { appendOp, nextOpId } = await import('../../../../core/src/project/history.js');
        appendOp(ctx.projectDir, scene.slug, {
          id: nextOpId(),
          type: 'addPresetAnimation',
          nodeId,
          preset,
          config: { duration: duration ?? 600, delay: delay ?? 0 },
          timestamp: new Date().toISOString(),
        } as any);
      } catch {}
    }

    store.replaceSessionSceneGraph(sceneId, scene.graph, scene.rootId, scene.timeline ?? null);
    try {
      const { emitEvent } = await import('../../http-server.js');
      emitEvent({ type: 'scene:session-changed', sceneId } as any);
    } catch {}

    sendJson(res, 200, { ok: true, nodeId, preset });
    return true;
  }

  // ── POST /platform/api/publish-shell ─────────
  // Export a scene as a platform page shell. Writes to .reframe/platform/html/.
  if (pathname === '/platform/api/publish-shell' && req.method === 'POST') {
    const body = await readJson(req);
    const page = body.page as string;
    const sceneId = body.sceneId as string;
    if (!page || !sceneId) {
      sendError(res, 400, 'page + sceneId required');
      return true;
    }
    const store = await getStore();
    const scene = store.getScene(sceneId);
    if (!scene) {
      sendError(res, 404, `scene ${sceneId} not found`);
      return true;
    }
    if (!ctx.projectDir) {
      sendError(res, 400, 'No project open — publish requires a project directory');
      return true;
    }
    // Export scene to full HTML
    const { exportToHtml } = await import('../../../../core/src/exporters/html.js');
    const { ensureSceneLayout } = await import('../../../../core/src/engine/layout.js');
    ensureSceneLayout(scene.graph, scene.rootId);
    const html = exportToHtml(scene.graph, scene.rootId, {
      fullDocument: true,
      dataAttributes: true,
    });
    // Write to .reframe/platform/html/<page>.html
    const { publishShell } = await import('../hydrate.js');
    publishShell(ctx.projectDir, page, html);
    // Emit SSE event
    try {
      const { emitEvent } = await import('../../http-server.js');
      emitEvent({ type: 'scene:session-changed', sceneId } as any);
    } catch { /* best-effort */ }
    sendJson(res, 200, { ok: true, page, sceneId, path: `.reframe/platform/html/${page}.html` });
    return true;
  }

  // ── GET /platform/api/project/health ─────────
  // Returns project-level health: per-scene audit scores, variant
  // coverage, brand consistency, AI thread counts. Used by the
  // Project Overview (dashboard).
  if (pathname === '/platform/api/project/health' && req.method === 'GET') {
    const store = await getStore();
    const scenes = store.listScenes();
    const sceneHealth: Array<{
      id: string;
      slug: string;
      name: string;
      width: number;
      height: number;
      nodeCount: number;
      auditScore: number | null;
      brand: string | null;
      variantCount: number;
      threadCount: number;
    }> = [];

    for (const s of scenes) {
      let auditScore: number | null = null;
      let threadCount = 0;

      // Quick audit score (try cached or compute).
      if (ctx.getAuditScore) {
        auditScore = ctx.getAuditScore(s.id) ?? null;
      }

      // Count active threads for this scene.
      if (ctx.projectDir) {
        try {
          const threadsMod = await import('../../../../core/src/project/threads/index.js');
          const threads = threadsMod.listThreads(ctx.projectDir, {
            sceneSlug: s.slug,
            status: 'active',
          });
          threadCount = threads.length;
        } catch { /* best-effort */ }
      }

      // Count variants.
      let variantCount = 0;
      if (ctx.projectDir) {
        try {
          const variantsMod = await import('../../../../core/src/project/variants.js');
          const variants = variantsMod.listVariants(ctx.projectDir, s.slug);
          variantCount = variants.length;
        } catch { /* best-effort */ }
      }

      // Parse size string "1440x900" into width/height.
      const sizeParts = (s.size || '1440x900').split(/[x×]/);
      const w = parseInt(sizeParts[0]) || 1440;
      const h = parseInt(sizeParts[1]) || 900;
      sceneHealth.push({
        id: s.id,
        slug: s.slug,
        name: s.name,
        width: w,
        height: h,
        nodeCount: s.nodes ?? 0,
        auditScore,
        brand: (s as any).brand ?? null,
        variantCount,
        threadCount,
      });
    }

    // Project-level aggregates.
    const totalScenes = sceneHealth.length;
    const cleanScenes = sceneHealth.filter(s => s.auditScore !== null && s.auditScore >= 90).length;
    const warnScenes = sceneHealth.filter(s => s.auditScore !== null && s.auditScore < 90 && s.auditScore >= 70).length;
    const failScenes = sceneHealth.filter(s => s.auditScore !== null && s.auditScore < 70).length;
    const responsiveScenes = sceneHealth.filter(s => s.variantCount > 0).length;
    const totalThreads = sceneHealth.reduce((sum, s) => sum + s.threadCount, 0);

    let activeBrand: string | null = null;
    if (ctx.projectDir) {
      try {
        const ioMod = await import('../../../../core/src/project/io.js');
        const manifest = ioMod.loadProject(ctx.projectDir);
        activeBrand = manifest.activeBrand ?? null;
      } catch { /* best-effort */ }
    }

    sendJson(res, 200, {
      ok: true,
      scenes: sceneHealth,
      summary: {
        total: totalScenes,
        clean: cleanScenes,
        warn: warnScenes,
        fail: failScenes,
        responsive: responsiveScenes,
        totalThreads,
        activeBrand,
      },
    });
    return true;
  }

  // ── GET /platform/api/scene/tree?sceneId=s1 ──
  // Returns the node tree for the scene — used by the sidebar LAYERS
  // section. Lightweight: just id, name, type, childCount, depth.
  if (pathname === '/platform/api/scene/tree' && req.method === 'GET') {
    const sceneId = url.searchParams.get('sceneId') ?? '';
    if (!sceneId) { sendError(res, 400, 'sceneId required'); return true; }
    const store = await getStore();
    const scene = store.getScene(sceneId);
    if (!scene) { sendError(res, 404, `scene ${sceneId} not found`); return true; }

    interface TreeNode {
      id: string;
      name: string;
      type: string;
      text?: string;
      childCount: number;
      children: TreeNode[];
    }

    function buildTree(nodeId: string, depth: number): TreeNode | null {
      if (depth > 20) return null; // Safety guard.
      const node = scene!.graph.getNode(nodeId);
      if (!node) return null;
      const children: TreeNode[] = [];
      for (const cid of (node.childIds ?? [])) {
        const child = buildTree(cid, depth + 1);
        if (child) children.push(child);
      }
      return {
        id: node.id,
        name: node.name ?? '',
        type: node.type ?? '',
        text: node.text ? node.text.slice(0, 40) : undefined,
        childCount: children.length,
        children,
      };
    }

    const tree = buildTree(scene.rootId, 0);
    sendJson(res, 200, { ok: true, tree });
    return true;
  }

  // ── GET /platform/api/brands ─────────────
  // Returns registered brands for the brand browser overlay.
  if (pathname === '/platform/api/brands' && req.method === 'GET') {
    if (!ctx.projectDir) {
      sendJson(res, 200, { ok: true, brands: [] });
      return true;
    }
    try {
      const { listRegisteredBrands } = await import('../../../../core/src/project/io.js');
      const brands = listRegisteredBrands(ctx.projectDir);
      sendJson(res, 200, { ok: true, brands });
    } catch (e: any) {
      sendJson(res, 200, { ok: true, brands: [] });
    }
    return true;
  }

  // ── POST /platform/api/brand/switch ─────
  // Switches the active brand. Re-tokenizes but does NOT re-compile —
  // the user needs to manually re-compile to see the effect.
  if (pathname === '/platform/api/brand/switch' && req.method === 'POST') {
    const body = await readJson(req);
    const slug = body.slug as string;
    if (!slug) {
      sendError(res, 400, 'slug required');
      return true;
    }
    if (!ctx.projectDir) {
      sendError(res, 400, 'no project open');
      return true;
    }
    try {
      const { setActiveBrand } = await import('../../../../core/src/project/io.js');
      // Virtual project slug comes from request body (preferred) or referer
      // URL `/platform/project/<slug>`. When set, the brand choice is
      // scoped to that virtual project instead of leaking across siblings.
      const virtualSlug = (body.project as string | undefined)
        ?? extractVirtualSlugFromReferer(req);
      const entry = setActiveBrand(ctx.projectDir, slug, virtualSlug);
      // SSE notify.
      try {
        const { emitEvent } = await import('../../http-server.js');
        emitEvent({ type: 'design-system:updated' } as any);
      } catch { /* best-effort */ }
      sendJson(res, 200, { ok: true, brand: entry });
    } catch (e: any) {
      sendError(res, 400, e?.message ?? 'brand switch failed');
    }
    return true;
  }

  // ── POST /platform/api/brand/apply ──────────────────────
  //
  // Single-step designer flow: take a brand slug, ensure it's in the
  // project registry (extract via getdesign npm if missing), then set it
  // active. Powers the dashboard brand chips so clicking "Linear" does
  // what a designer expects — loads the brand + activates — in one
  // round-trip. Previously the chips were decorative `<span>`s with no
  // handler; brand activation was only reachable via MCP `reframe_design`.
  //
  // Body: { slug }
  // Response: { ok, brand, extracted: boolean } — extracted=true when
  // the brand was fetched fresh, false when it was already on disk.
  if (pathname === '/platform/api/brand/apply' && req.method === 'POST') {
    const body = await readJson(req);
    const slug = body.slug as string;
    if (!slug) { sendError(res, 400, 'slug required'); return true; }
    try {
      const projectIo = await import('../../../../core/src/project/io.js');
      // Ensure .reframe project exists. First call on a fresh workspace
      // hits this path, so init lazily — the dashboard brand chips are
      // the typical entry point for a brand-new user.
      let projectDir = ctx.projectDir;
      if (!projectDir) {
        projectDir = process.cwd();
        if (!projectIo.projectExists(projectDir)) {
          projectIo.initProject(projectDir, 'Reframe project');
        }
        (ctx as any).projectDir = projectDir;
      }
      const manifest = projectIo.loadProject(projectDir);
      const alreadyRegistered = !!manifest?.brands?.[slug];
      let extracted = false;
      let entry;
      const virtualSlug = (body.project as string | undefined)
        ?? extractVirtualSlugFromReferer(req);
      if (!alreadyRegistered) {
        // Fetch via getdesign + write to .reframe/brands/<slug>/DESIGN.md.
        // Reuse the engine's canonical extract (MCP tools/design.ts uses
        // the same helper) so CLI/UI/agent all share one code path.
        const { loadBrandDesignMd } = await import('../../tools/compile.js');
        const md = await loadBrandDesignMd(slug);
        if (!md) {
          sendError(res, 404, `brand "${slug}" not found via getdesign`);
          return true;
        }
        entry = projectIo.registerBrand(projectDir, slug, md, { setActive: true });
        // registerBrand({setActive:true}) uses the global slot — follow up
        // with an explicit per-project write so subsequent visits to this
        // virtual project see this brand as default.
        if (virtualSlug) {
          projectIo.setActiveBrand(projectDir, slug, virtualSlug);
        }
        extracted = true;
      } else {
        entry = projectIo.setActiveBrand(projectDir, slug, virtualSlug);
      }
      try {
        const { emitEvent } = await import('../../http-server.js');
        emitEvent({ type: 'design-system:updated' } as any);
      } catch { /* best-effort */ }
      sendJson(res, 200, { ok: true, brand: entry, extracted });
    } catch (e: any) {
      sendError(res, 400, e?.message ?? 'brand apply failed');
    }
    return true;
  }

  // ── GET /platform/api/ops?sceneId=s1 ─────
  // Returns the ops history for the scene's slug — used by the
  // History dropdown in the header (revision log) and the old
  // timeline scrubber in the bottom bar.
  if (pathname === '/platform/api/ops' && req.method === 'GET') {
    const sceneId = url.searchParams.get('sceneId') ?? '';
    if (!sceneId) { sendError(res, 400, 'sceneId required'); return true; }
    const store = await getStore();
    const scene = store.getScene(sceneId);
    if (!scene || !ctx.projectDir || !scene.slug) {
      sendJson(res, 200, { ok: true, ops: [] });
      return true;
    }
    try {
      const { readOps } = await import('../../../../core/src/project/history.js');
      const ops = readOps(ctx.projectDir, scene.slug);
      // Return lightweight summaries for the timeline, not full op payloads.
      const summaries = ops.map((o: any) => ({
        id: o.id,
        type: o.type,
        nodeId: o.nodeId ?? null,
        timestamp: o.timestamp ?? null,
      }));
      sendJson(res, 200, { ok: true, ops: summaries, total: ops.length });
    } catch {
      sendJson(res, 200, { ok: true, ops: [], total: 0 });
    }
    return true;
  }

  // ── POST /platform/api/history/revert-to ────
  //
  // Atomic revert: undo all ops from the current HEAD back to a target
  // index in one call. Replaces the old N×/platform/api/undo loop that
  // took ~N × 40ms. Applies prevProps in reverse order (tail → target+1),
  // writes the truncated history file once, emits one SSE event.
  if (pathname === '/platform/api/history/revert-to' && req.method === 'POST') {
    const body = await readJson(req);
    const sceneId = body.sceneId as string;
    const targetIndex = typeof body.targetIndex === 'number' ? body.targetIndex : -1;
    if (!sceneId) { sendError(res, 400, 'sceneId required'); return true; }
    if (targetIndex < -1) { sendError(res, 400, 'targetIndex must be >= -1 (-1 = revert to pristine)'); return true; }

    const store = await getStore();
    const scene = store.getScene(sceneId);
    if (!scene) { sendError(res, 404, `scene ${sceneId} not found`); return true; }
    if (!ctx.projectDir || !scene.slug) {
      sendError(res, 400, 'no project open — cannot revert');
      return true;
    }

    try {
      const historyMod = await import('../../../../core/src/project/history.js');
      const ops = historyMod.readOps(ctx.projectDir, scene.slug);
      if (ops.length === 0 || targetIndex >= ops.length - 1) {
        sendJson(res, 200, { ok: true, reverted: 0, message: 'already at target' });
        return true;
      }

      // Apply reverse of each op from tail back to targetIndex + 1.
      // Iterate in reverse order so dependent ops unwind in the correct
      // sequence. Each op may carry prevProps for a single-node undo;
      // ops without prevProps (legacy entries) are skipped — their
      // forward state was not reversible from history alone.
      let reverted = 0;
      for (let i = ops.length - 1; i > targetIndex; i--) {
        const op = ops[i] as any;
        if (op.prevProps && op.nodeId) {
          const node = scene.graph.getNode(op.nodeId);
          if (node) {
            scene.graph.updateNode(op.nodeId, op.prevProps);
            reverted++;
          }
        }
      }

      // Rewrite history once.
      const fs = await import('fs');
      const histFile = historyMod.historyFilePath(ctx.projectDir, scene.slug);
      const remaining = ops.slice(0, targetIndex + 1);
      const payload = remaining.length > 0
        ? remaining.map((o: any) => JSON.stringify(o)).join('\n') + '\n'
        : '';
      fs.writeFileSync(histFile, payload, 'utf-8');

      // Update session graph (single SSE emit).
      store.replaceSessionSceneGraph(sceneId, scene.graph, scene.rootId, scene.timeline ?? null);

      sendJson(res, 200, {
        ok: true,
        reverted,
        remaining: remaining.length,
      });
    } catch (e: any) {
      sendError(res, 500, e?.message ?? 'revert failed');
    }
    return true;
  }

  // ── POST /platform/api/history/save ─────────
  //
  // Snapshot the current scene graph into the in-memory snapshot store.
  // The caller can later POST /platform/api/history/restore with the
  // returned snapshot id to load it back — a single atomic graph swap,
  // no op replay. Think of these as named checkpoints (Git tags); the
  // ops log is the continuous edit trail (Git reflog).
  if (pathname === '/platform/api/history/save' && req.method === 'POST') {
    const body = await readJson(req);
    const sceneId = body.sceneId as string;
    const label = body.label as string | undefined;
    if (!sceneId) { sendError(res, 400, 'sceneId required'); return true; }

    const store = await getStore();
    const scene = store.getScene(sceneId);
    if (!scene) { sendError(res, 404, `scene ${sceneId} not found`); return true; }

    try {
      const snapMod = await import('../../snapshots.js');
      // Count nodes for display (walk scene.graph rooted at scene.rootId).
      let nodeCount = 0;
      function walk(id: string) {
        const n = scene!.graph.getNode(id);
        if (!n) return;
        nodeCount++;
        for (const cid of n.childIds) walk(cid);
      }
      walk(scene.rootId);

      const snap = snapMod.createSnapshot(
        sceneId,
        scene.slug ?? sceneId,
        scene.graph,
        scene.rootId,
        (scene as any).sessionRevision ?? 0,
        nodeCount,
        label,
      );

      sendJson(res, 200, {
        ok: true,
        snapshot: {
          id: snap.id,
          label: snap.label,
          createdAt: snap.createdAt,
          revision: snap.revision,
          nodeCount: snap.nodeCount,
        },
      });
    } catch (e: any) {
      sendError(res, 500, e?.message ?? 'snapshot failed');
    }
    return true;
  }

  // ── GET /platform/api/history/snapshots?sceneId=s1 ──
  // List all saved snapshots for a scene (newest first).
  if (pathname === '/platform/api/history/snapshots' && req.method === 'GET') {
    const sceneId = url.searchParams.get('sceneId') ?? '';
    if (!sceneId) { sendError(res, 400, 'sceneId required'); return true; }
    try {
      const snapMod = await import('../../snapshots.js');
      const list = snapMod.listSnapshots(sceneId).map(s => ({
        id: s.id,
        label: s.label,
        createdAt: s.createdAt,
        revision: s.revision,
        nodeCount: s.nodeCount,
      }));
      sendJson(res, 200, { ok: true, snapshots: list });
    } catch (e: any) {
      sendError(res, 500, e?.message ?? 'list failed');
    }
    return true;
  }

  // ── POST /platform/api/history/restore ──────
  //
  // Load a previously-saved snapshot back into the scene. The
  // operation is atomic: deserialize → replaceSessionSceneGraph →
  // single SSE event. Ops history is preserved so the user can
  // continue editing from the restored state.
  if (pathname === '/platform/api/history/restore' && req.method === 'POST') {
    const body = await readJson(req);
    const sceneId = body.sceneId as string;
    const snapshotId = body.snapshotId as string;
    if (!sceneId || !snapshotId) { sendError(res, 400, 'sceneId and snapshotId required'); return true; }

    const store = await getStore();
    const scene = store.getScene(sceneId);
    if (!scene) { sendError(res, 404, `scene ${sceneId} not found`); return true; }

    try {
      const snapMod = await import('../../snapshots.js');
      const snap = snapMod.getSnapshot(sceneId, snapshotId);
      if (!snap) { sendError(res, 404, 'snapshot not found'); return true; }

      const restored = snapMod.restoreSnapshot(snap);
      if (!restored) { sendError(res, 500, 'snapshot deserialization failed'); return true; }

      store.replaceSessionSceneGraph(sceneId, restored.graph, restored.rootId, scene.timeline ?? null);

      sendJson(res, 200, {
        ok: true,
        restored: { id: snap.id, label: snap.label, revision: snap.revision },
      });
    } catch (e: any) {
      sendError(res, 500, e?.message ?? 'restore failed');
    }
    return true;
  }

  // ── POST /platform/api/history/snapshot-delete ──
  if (pathname === '/platform/api/history/snapshot-delete' && req.method === 'POST') {
    const body = await readJson(req);
    const sceneId = body.sceneId as string;
    const snapshotId = body.snapshotId as string;
    if (!sceneId || !snapshotId) { sendError(res, 400, 'sceneId and snapshotId required'); return true; }
    try {
      const snapMod = await import('../../snapshots.js');
      const ok = snapMod.deleteSnapshot(sceneId, snapshotId);
      sendJson(res, 200, { ok: true, deleted: ok });
    } catch (e: any) {
      sendError(res, 500, e?.message ?? 'delete failed');
    }
    return true;
  }

  // ── POST /platform/api/history/clear ─────
  // Wipe the scene's recorded op log. Next reframe_compile will
  // produce a pristine scene (no replayed edits). Used by the History
  // dropdown's "Clear history" button in the top header.
  if (pathname === '/platform/api/history/clear' && req.method === 'POST') {
    const body = await readJson(req);
    const sceneId = body.sceneId as string;
    if (!sceneId) { sendError(res, 400, 'sceneId required'); return true; }
    const store = await getStore();
    const scene = store.getScene(sceneId);
    if (!scene || !ctx.projectDir || !scene.slug) {
      sendError(res, 404, 'scene not found or no project');
      return true;
    }
    try {
      const { clearOps } = await import('../../../../core/src/project/history.js');
      clearOps(ctx.projectDir, scene.slug);
      // Notify any other open dashboards via SSE.
      try {
        const { emitEvent } = await import('../../http-server.js');
        emitEvent({ type: 'scene:saved', sceneId } as any);
      } catch { /* best-effort */ }
      sendJson(res, 200, { ok: true, cleared: true });
    } catch (e: any) {
      sendError(res, 500, e?.message ?? 'clear failed');
    }
    return true;
  }

  // ── GET /platform/api/audit?sceneId=s1 ───
  // Runs the REAL 19-25 rule audit on the scene and returns per-node
  // findings with fix suggestions. Used by the inline audit badges
  // on the viewport and the bottom bar findings strip.
  //
  // Cached by `sceneId:sessionRevision`. Audit walks the full graph and
  // runs 20+ rules — 50-100ms for non-trivial scenes. Since the result
  // is a pure function of the graph state, we memoize it and invalidate
  // when the revision bumps. UI calls this on every scene mutation +
  // debounced refreshes, so the cache hit rate is very high in steady
  // state.
  if (pathname === '/platform/api/audit' && req.method === 'GET') {
    const sceneId = url.searchParams.get('sceneId') ?? '';
    if (!sceneId) {
      sendError(res, 400, 'sceneId required');
      return true;
    }
    const store = await getStore();
    const scene = store.getScene(sceneId);
    if (!scene) {
      sendError(res, 404, `scene ${sceneId} not found`);
      return true;
    }

    const revision = (scene as any).sessionRevision ?? 0;
    const cacheKey = `${sceneId}:${revision}`;
    const cached = auditCacheGet(cacheKey);
    if (cached) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Audit-Cache': 'hit',
      });
      res.end(cached);
      return true;
    }

    try {
      // Build INode wrapper from SceneGraph (the bridge).
      const { StandaloneNode } = await import('../../../../core/src/adapters/standalone/node.js');
      const rootNode = scene.graph.getNode(scene.rootId);
      if (!rootNode) {
        sendError(res, 500, 'root node missing');
        return true;
      }
      const wrappedRoot = new StandaloneNode(scene.graph, rootNode);

      // Build audit rules — use design system if loaded.
      const { buildInspectAuditRules } = await import('../../../../core/src/inspect-audit-rules.js');
      let designSystem: any = undefined;
      if (ctx.projectDir) {
        try {
          const dsText = ctx.getDesignMd?.();
          if (dsText) {
            const dsMod = await import('../../../../core/src/design-system/index.js');
            designSystem = dsMod.parseDesignMd(dsText);
          }
        } catch { /* no DS — run base rules only */ }
      }
      const rules = buildInspectAuditRules(designSystem);

      // Run audit.
      const { audit: runAudit } = await import('../../../../core/src/audit.js');
      const issues = runAudit(wrappedRoot as any, rules, designSystem);

      // Group by severity for summary.
      const counts = { error: 0, warning: 0, info: 0 };
      for (const issue of issues) {
        if (issue.severity in counts) (counts as any)[issue.severity]++;
      }
      const score = Math.max(0, 100 - counts.error * 10 - counts.warning * 3 - counts.info);

      // Return findings with per-node info — UI renders badges from this.
      const findings = issues.map(i => ({
        nodeId: i.nodeId ?? null,
        nodeName: i.nodeName ?? null,
        path: i.path ?? null,
        rule: i.rule,
        severity: i.severity,
        message: i.message,
        fix: i.fix ? {
          property: i.fix.property,
          current: i.fix.current,
          suggested: i.fix.suggested,
          css: i.fix.css,
        } : null,
      }));

      // Brand Fidelity Score (when design system available)
      let brandFidelity: any = null;
      if (designSystem) {
        try {
          const { computeBrandFidelity } = await import('../../../../core/src/brand-fidelity.js');
          brandFidelity = computeBrandFidelity(wrappedRoot as any, designSystem);
        } catch { /* brand fidelity optional */ }
      }

      const body = JSON.stringify({ ok: true, score, counts, findings, brandFidelity });
      auditCacheSet(cacheKey, body);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Audit-Cache': 'miss',
      });
      res.end(body);
    } catch (e: any) {
      sendError(res, 500, e?.message ?? 'audit failed');
    }
    return true;
  }

  // ── POST /platform/api/audit/fix ────────
  // Applies a single auto-fix suggestion from the audit. Takes nodeId +
  // the fix's property + suggested value and applies it as a setProps op.
  if (pathname === '/platform/api/audit/fix' && req.method === 'POST') {
    const body = await readJson(req);
    const sceneId = body.sceneId as string;
    const nodeId = body.nodeId as string;
    const property = body.property as string;
    const suggested = body.suggested as string;
    if (!sceneId || !nodeId || !property || suggested === undefined) {
      sendError(res, 400, 'sceneId + nodeId + property + suggested required');
      return true;
    }

    const store = await getStore();
    const scene = store.getScene(sceneId);
    if (!scene) {
      sendError(res, 404, `scene ${sceneId} not found`);
      return true;
    }
    const node = scene.graph.getNode(nodeId);
    if (!node) {
      sendError(res, 404, `node ${nodeId} not found`);
      return true;
    }

    // Map the audit fix property (CSS name) → engine prop change.
    const edits: Record<string, any> = {};
    edits[property] = suggested;
    const partial = cssPropsToNodePartial(edits);

    // Capture prev values for undo.
    const prevValues: Record<string, any> = {};
    for (const key of Object.keys(partial)) {
      prevValues[key] = (node as any)[key];
    }

    scene.graph.updateNode(nodeId, partial);

    // Ops history.
    if (ctx.projectDir && scene.slug) {
      try {
        const { appendOp, nextOpId } = await import('../../../../core/src/project/history.js');
        appendOp(ctx.projectDir, scene.slug, {
          id: nextOpId(),
          type: 'setProps',
          nodeId,
          props: partial,
          prevProps: prevValues,
          timestamp: new Date().toISOString(),
        } as any);
      } catch { /* best-effort */ }
    }

    store.replaceSessionSceneGraph(sceneId, scene.graph, scene.rootId, scene.timeline ?? null);

    try {
      const { emitEvent } = await import('../../http-server.js');
      emitEvent({ type: 'scene:session-changed', sceneId } as any);
    } catch { /* best-effort */ }

    sendJson(res, 200, { ok: true, nodeId, property, applied: suggested });
    return true;
  }

  // ── POST /platform/api/import ──────────
  // Import HTML from a URL or raw HTML string. Creates a new scene.
  if (pathname === '/platform/api/import' && req.method === 'POST') {
    const body = await readJson(req);
    const url: string = body?.url ?? '';
    let html: string = body?.html ?? '';

    if (!url && !html) {
      sendError(res, 400, 'url or html required');
      return true;
    }

    try {
      // Fetch HTML from URL if provided
      if (url && !html) {
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'reframe/1.0 (+https://github.com/ilya-makarov-dev/reframe)' },
          redirect: 'follow',
        });
        if (!resp.ok) {
          sendError(res, 502, `Failed to fetch URL: ${resp.status}`);
          return true;
        }
        html = await resp.text();
      }

      const store = await getStore();

      // Import using the core HTML importer
      const { importFromHtml } = await import('../../../../core/src/importers/html.js');
      const result = await importFromHtml(html, { width: 1440 });

      // Store the scene
      const name = url ? new URL(url).hostname.replace(/^www\./, '') : 'imported';
      const sessionId = store.storeScene(result.graph, result.rootId, undefined, { name });
      const scene = store.getScene(sessionId);
      const slug = scene?.slug ?? sessionId;

      // Save source HTML
      const fs = await import('fs');
      const path = await import('path');
      const srcDir = path.join(process.cwd(), '.reframe', 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, `${slug}.html`), html, 'utf-8');

      // Emit SSE
      try {
        const { emitEvent } = await import('../../http-server.js');
        emitEvent({ type: 'scene:session-changed', sceneId: sessionId } as any);
      } catch { /* best-effort */ }

      sendJson(res, 200, { ok: true, sceneId: sessionId, slug, name });
    } catch (err: any) {
      sendError(res, 500, `Import failed: ${err?.message ?? String(err)}`);
    }
    return true;
  }

  // ── GET /platform/api/scene/sections ──────────
  // Returns top-level sections of a scene (root children) with semantic roles.
  // Used by the Sections tab in the workspace.
  if (pathname === '/platform/api/scene/sections' && req.method === 'GET') {
    const sceneId = url.searchParams.get('sceneId') ?? '';
    if (!sceneId) { sendError(res, 400, 'sceneId required'); return true; }
    const store = await getStore();
    const scene = store.getScene(sceneId);
    if (!scene) { sendError(res, 404, `scene ${sceneId} not found`); return true; }
    const root = scene.graph.getNode(scene.rootId);
    if (!root) { sendError(res, 404, 'root node not found'); return true; }

    const sections: Array<{
      nodeId: string; name: string; role: string;
      bounds: { x: number; y: number; w: number; h: number };
      childCount: number; textPreview: string;
    }> = [];

    for (const childId of root.childIds ?? []) {
      const child = scene.graph.getNode(childId);
      if (!child) continue;
      // Determine section role from semantic tag, name, or heuristics
      let role = child.semanticRole || '';
      if (!role) {
        const nm = (child.name || '').toLowerCase();
        if (nm.includes('nav') || nm.includes('header')) role = 'nav';
        else if (nm.includes('hero') || nm.includes('banner')) role = 'hero';
        else if (nm.includes('footer')) role = 'footer';
        else if (nm.includes('cta') || nm.includes('call')) role = 'cta';
        else if (nm.includes('stat')) role = 'stats';
        else if (nm.includes('card') || nm.includes('grid') || nm.includes('product')) role = 'content';
        else if (nm.includes('filter') || nm.includes('category')) role = 'filters';
        else role = 'section';
      }
      // Collect first text from descendants for preview
      let textPreview = '';
      const findText = (id: string, depth: number) => {
        if (depth > 4 || textPreview.length > 60) return;
        const n = scene.graph.getNode(id);
        if (!n) return;
        if (n.type === 'TEXT' && n.text) {
          if (textPreview) textPreview += ' · ';
          textPreview += n.text.slice(0, 40);
          return;
        }
        for (const cid of (n.childIds ?? []).slice(0, 5)) findText(cid, depth + 1);
      };
      findText(childId, 0);

      // Count all descendant nodes
      let childCount = 0;
      const countNodes = (id: string) => {
        childCount++;
        const n = scene.graph.getNode(id);
        if (n) for (const cid of n.childIds ?? []) countNodes(cid);
      };
      countNodes(childId);

      sections.push({
        nodeId: childId,
        name: child.name || `Section ${sections.length + 1}`,
        role,
        bounds: { x: child.x, y: child.y, w: child.width, h: child.height },
        childCount,
        textPreview: textPreview.slice(0, 80),
      });
    }

    sendJson(res, 200, { ok: true, sceneId, sections });
    return true;
  }

  // ── GET /platform/api/aesthetic/:sceneId ──
  const aestheticMatch = pathname.match(/^\/platform\/api\/aesthetic\/(.+)$/);
  if (aestheticMatch && req.method === 'GET') {
    const sceneId = aestheticMatch[1];
    const store = await getStore();
    const scene = store.getScene(sceneId);
    if (!scene) {
      sendError(res, 404, `scene ${sceneId} not found`);
      return true;
    }
    try {
      const { ensureSceneLayout } = await import('../../../../core/src/engine/layout.js');
      ensureSceneLayout(scene.graph, scene.rootId);
      const { computeAestheticScore, scoreToRating } = await import('../../../../core/src/aesthetic/index.js');
      const score = computeAestheticScore(scene.graph, scene.rootId);
      const metrics = Object.entries(score)
        .filter(([key]) => key !== 'overall')
        .map(([key, value]) => ({
          name: key,
          score: Math.round((value as number) * 100),
          rating: scoreToRating(value as number),
        }));
      sendJson(res, 200, {
        ok: true,
        sceneId,
        overall: Math.round(score.overall * 100),
        overallRating: scoreToRating(score.overall),
        metrics,
      });
    } catch (err: any) {
      sendError(res, 500, `Aesthetic scoring failed: ${err.message}`);
    }
    return true;
  }

  // ── GET /platform/api/tokens/:sceneId ──
  const tokensMatch = pathname.match(/^\/platform\/api\/tokens\/(.+)$/);
  if (tokensMatch && req.method === 'GET') {
    const sceneId = tokensMatch[1];
    const store = await getStore();
    const scene = store.getScene(sceneId);
    if (!scene) {
      sendError(res, 404, `scene ${sceneId} not found`);
      return true;
    }
    try {
      const tokens: Array<{ name: string; type: string; value: unknown }> = [];
      for (const variable of scene.graph.variables.values()) {
        const firstModeValue = Object.values(variable.valuesByMode)[0];
        let displayValue: unknown = firstModeValue;
        if (variable.type === 'COLOR' && typeof firstModeValue === 'object' && firstModeValue !== null && 'r' in (firstModeValue as any)) {
          const c = firstModeValue as { r: number; g: number; b: number };
          displayValue = `#${Math.round(c.r * 255).toString(16).padStart(2, '0')}${Math.round(c.g * 255).toString(16).padStart(2, '0')}${Math.round(c.b * 255).toString(16).padStart(2, '0')}`;
        }
        tokens.push({
          name: variable.name,
          type: variable.type,
          value: displayValue,
        });
      }
      tokens.sort((a, b) => a.name.localeCompare(b.name));
      sendJson(res, 200, { ok: true, sceneId, count: tokens.length, tokens });
    } catch (err: any) {
      sendError(res, 500, `Token listing failed: ${err.message}`);
    }
    return true;
  }

  return false;
}
