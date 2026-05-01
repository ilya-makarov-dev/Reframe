/**
 * Platform API — dynamic tweaks.
 *
 * Live-control knobs the agent declares after compile. Platform UI
 * reads them via GET, renders a sidebar panel of sliders / color
 * pickers / selects, and POSTs apply on change. Apply dispatches
 * directly against the engine — no chat turn, no token cost.
 *
 * Routes:
 *   GET  /platform/api/tweaks/get?sceneId=…
 *     → { ok: true, tweaks: TweakDecl[] }
 *   POST /platform/api/tweaks/declare
 *     body: { sceneId, tweaks: TweakDecl[] }
 *     → { ok: true, count }
 *   POST /platform/api/tweaks/apply
 *     body: { sceneId, tweakId, value }
 *     → { ok: true, applied: { tweakId, value } }
 *
 * Apply-time dispatch:
 *   - op.type === 'token'  → forwarded to /platform/api/scene/define-tokens
 *                           (single-entry tokenIndex update)
 *   - op.type === 'macro'  → forwarded to applyVariationToScene()
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { PlatformContext } from '../router.js';
import { getScene, type TweakDecl } from '../../store.js';

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
 * Accept-only validator — rejects obviously-malformed tweak rows before
 * we accept them into StoredScene. Throws on invalid; returns a cleaned
 * copy on success. Keeps the stored schema strict so the UI renderer
 * can trust every field.
 */
function validateTweaks(raw: unknown): TweakDecl[] {
  if (!Array.isArray(raw)) throw new Error('tweaks must be an array');
  const out: TweakDecl[] = [];
  const seenIds = new Set<string>();
  const validMacros = ['density', 'radius', 'shadows', 'typography', 'colorRotation', 'mode'];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i] as any;
    if (!t || typeof t !== 'object') throw new Error(`tweak[${i}] not an object`);
    if (typeof t.id !== 'string' || !t.id) throw new Error(`tweak[${i}].id required`);
    if (seenIds.has(t.id)) throw new Error(`tweak id "${t.id}" duplicated`);
    seenIds.add(t.id);
    if (typeof t.label !== 'string' || !t.label) throw new Error(`tweak[${i}].label required`);
    if (t.kind !== 'color' && t.kind !== 'number' && t.kind !== 'select') {
      throw new Error(`tweak[${i}].kind must be color|number|select`);
    }
    if (!t.op || typeof t.op !== 'object') throw new Error(`tweak[${i}].op required`);
    if (t.op.type !== 'token' && t.op.type !== 'macro') {
      throw new Error(`tweak[${i}].op.type must be token|macro`);
    }
    if (t.op.type === 'token' && (typeof t.op.tokenPath !== 'string' || !t.op.tokenPath)) {
      throw new Error(`tweak[${i}].op.tokenPath required for token ops`);
    }
    if (t.op.type === 'macro' && !validMacros.includes(t.op.kind)) {
      throw new Error(`tweak[${i}].op.kind must be one of ${validMacros.join('|')}`);
    }
    // Color tweaks need token-type ops so setTokenValue can write to the
    // bound color token directly. Mapping color→macro is ambiguous
    // (which macro? rotate? re-extract?) and has to be rejected early.
    if (t.kind === 'color' && t.op.type !== 'token') {
      throw new Error(`tweak[${i}]: color kind requires op.type="token"`);
    }
    if (t.kind === 'number') {
      if (typeof t.default !== 'number') throw new Error(`tweak[${i}].default must be a number`);
    } else {
      if (typeof t.default !== 'string') throw new Error(`tweak[${i}].default must be a string`);
    }
    if (t.kind === 'select' && (!Array.isArray(t.options) || t.options.length === 0)) {
      throw new Error(`tweak[${i}].options required for select`);
    }
    out.push({
      id: t.id,
      label: t.label,
      description: typeof t.description === 'string' ? t.description : undefined,
      kind: t.kind,
      default: t.default,
      min: typeof t.min === 'number' ? t.min : undefined,
      max: typeof t.max === 'number' ? t.max : undefined,
      step: typeof t.step === 'number' ? t.step : undefined,
      options: Array.isArray(t.options) ? t.options : undefined,
      unit: typeof t.unit === 'string' ? t.unit : undefined,
      op: t.op,
    });
  }
  return out;
}

export async function handleTweaksApi(
  req: IncomingMessage,
  res: ServerResponse,
  _ctx: PlatformContext,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;

  // ── GET /platform/api/tweaks/get?sceneId=… ────────────────
  if (pathname === '/platform/api/tweaks/get' && req.method === 'GET') {
    const sceneId = url.searchParams.get('sceneId') ?? '';
    if (!sceneId) {
      sendJson(res, 400, { ok: false, error: 'sceneId required' });
      return true;
    }
    const stored = getScene(sceneId);
    if (!stored) {
      sendJson(res, 404, { ok: false, error: `scene ${sceneId} not found` });
      return true;
    }
    sendJson(res, 200, { ok: true, tweaks: stored.tweaks ?? [] });
    return true;
  }

  // ── POST /platform/api/tweaks/declare ─────────────────────
  if (pathname === '/platform/api/tweaks/declare' && req.method === 'POST') {
    const body = await readJson(req);
    const sceneId = String(body.sceneId || '').trim();
    if (!sceneId) { sendJson(res, 400, { ok: false, error: 'sceneId required' }); return true; }
    const stored = getScene(sceneId);
    if (!stored) { sendJson(res, 404, { ok: false, error: `scene ${sceneId} not found` }); return true; }
    let tweaks: TweakDecl[];
    try {
      tweaks = validateTweaks(body.tweaks);
    } catch (e: any) {
      sendJson(res, 400, { ok: false, error: e?.message ?? 'invalid tweaks' });
      return true;
    }
    stored.tweaks = tweaks;

    // Soft warnings for token-op tweaks that reference tokens the scene
    // doesn't currently have. Declaration still succeeds — tokens may be
    // defined later via defineTokens — but the agent / UI wants to know
    // early so the user isn't surprised by a 400 on first apply.
    const warnings: string[] = [];
    const tokenOps = tweaks.filter(t => t.op.type === 'token');
    if (tokenOps.length > 0) {
      const { rebuildTokenIndexFromGraph } = await import(
        '../../../../core/src/design-system/tokens.js'
      );
      const idx = stored.tokenIndex ?? rebuildTokenIndexFromGraph(stored.graph);
      if (!idx) {
        warnings.push(
          `${tokenOps.length} tweak(s) reference design tokens but the scene has none defined yet — run reframe_edit op=defineTokens (or apply a brand) before the Tweaks panel will work for those controls`,
        );
      } else {
        for (const t of tokenOps) {
          const path = (t.op as { type: 'token'; tokenPath: string }).tokenPath;
          if (!idx.tokens.has(path)) {
            warnings.push(`tweak "${t.id}" targets unknown token "${path}" — available: ${[...idx.tokens.keys()].slice(0, 6).join(', ')}${idx.tokens.size > 6 ? ', …' : ''}`);
          }
        }
      }
    }

    // SSE parity with /update + /remove (Brief 2b carry-over from 2a).
    // Without this, agent-side and external-script /declare calls leave
    // any open Tweaks panel stale until the next poll. Designer-side
    // declare-via-modal already triggers a manual refresh, so this
    // closes the divergence rather than altering existing UI flows.
    try {
      const { emitEvent } = await import('../../http-server.js');
      emitEvent({ type: 'scene:session-changed', sceneId } as any);
    } catch { /* best-effort */ }

    sendJson(res, 200, { ok: true, count: tweaks.length, warnings });
    return true;
  }

  // ── POST /platform/api/tweaks/apply ───────────────────────
  if (pathname === '/platform/api/tweaks/apply' && req.method === 'POST') {
    const body = await readJson(req);
    const sceneId = String(body.sceneId || '').trim();
    const tweakId = String(body.tweakId || '').trim();
    const value = body.value;
    if (!sceneId || !tweakId) {
      sendJson(res, 400, { ok: false, error: 'sceneId and tweakId required' });
      return true;
    }
    const stored = getScene(sceneId);
    if (!stored) { sendJson(res, 404, { ok: false, error: `scene ${sceneId} not found` }); return true; }
    const tweak = (stored.tweaks || []).find(t => t.id === tweakId);
    if (!tweak) { sendJson(res, 404, { ok: false, error: `tweak ${tweakId} not declared` }); return true; }

    try {
      let coerced: any = value;
      if (tweak.op.type === 'macro') {
        // Value type per macro kind:
        //   density/shadows/colorRotation → number (scale factor, degrees)
        //   radius                         → 'sharp' | 'soft' | 'pill' | number
        //   typography                     → 'editorial' | 'mono' | 'humanist' | ...
        //   mode                           → string (mode id)
        // Coerce numeric-looking strings so HTML form submissions don't
        // need to care about typing.
        const expectsNumber = tweak.op.kind === 'density'
                           || tweak.op.kind === 'shadows'
                           || tweak.op.kind === 'colorRotation';
        if (expectsNumber && typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
          coerced = Number(value);
        }
        const { applyVariationToScene } = await import('./variations.js');
        await applyVariationToScene(sceneId, tweak.op.kind, coerced, _ctx);
      } else {
        // token op: write via setTokenValue so bound node properties
        // update too. The scene must have a TokenIndex — if it doesn't,
        // rebuild from the graph; if THAT also fails the scene has no
        // tokens defined at all and the tweak can't resolve.
        const { setTokenValue, rebuildTokenIndexFromGraph } = await import(
          '../../../../core/src/design-system/tokens.js'
        );
        const { ensureSceneLayout } = await import('../../../../core/src/engine/layout.js');
        let tokenIdx = stored.tokenIndex;
        if (!tokenIdx) {
          tokenIdx = rebuildTokenIndexFromGraph(stored.graph);
          if (tokenIdx) stored.tokenIndex = tokenIdx;
        }
        if (!tokenIdx) {
          throw new Error('scene has no design tokens — run reframe_edit op=defineTokens first');
        }
        // Number tweaks may arrive as strings from HTML range inputs.
        if (tweak.kind === 'number' && typeof value === 'string' && value.trim() !== '') {
          const n = Number(value);
          if (Number.isFinite(n)) coerced = n;
        }
        setTokenValue(stored.graph, tokenIdx, tweak.op.tokenPath, coerced);
        ensureSceneLayout(stored.graph, stored.rootId);
        stored.sessionRevision = (stored.sessionRevision ?? 0) + 1;
      }
      sendJson(res, 200, { ok: true, applied: { tweakId, value: coerced } });
    } catch (e: any) {
      sendJson(res, 400, { ok: false, error: e?.message ?? 'apply failed' });
    }
    return true;
  }

  // ── POST /platform/api/tweaks/update ──────────────────────
  // Phase 2 Brief 2a Pin #5 — designer-side authoring.
  //
  // Replaces a single tweak in-place. Body shape:
  //   { sceneId, id, updates: Partial<TweakDecl> }
  // Reuses validateTweaks via a single-element array so the same
  // schema rules apply (id immutable here — `updates.id` is ignored,
  // identity is the path param). Broadcasts SSE so any open Tweaks
  // panel re-renders the row.
  if (pathname === '/platform/api/tweaks/update' && req.method === 'POST') {
    const body = await readJson(req);
    const sceneId = String(body.sceneId || '').trim();
    const id = String(body.id || '').trim();
    if (!sceneId || !id) {
      sendJson(res, 400, { ok: false, error: 'sceneId and id required' });
      return true;
    }
    const stored = getScene(sceneId);
    if (!stored) { sendJson(res, 404, { ok: false, error: `scene ${sceneId} not found` }); return true; }
    const tweaks = stored.tweaks || [];
    const idx = tweaks.findIndex((t) => t.id === id);
    if (idx < 0) {
      sendJson(res, 404, { ok: false, error: `tweak ${id} not declared` });
      return true;
    }
    const updates = body.updates && typeof body.updates === 'object' ? body.updates : {};
    // Build the merged candidate; force id to be authoritative from path param.
    const merged = { ...tweaks[idx], ...updates, id };
    let validated: TweakDecl[];
    try {
      validated = validateTweaks([merged]);
    } catch (e: any) {
      sendJson(res, 400, { ok: false, error: e?.message ?? 'invalid update' });
      return true;
    }
    tweaks[idx] = validated[0];
    stored.tweaks = tweaks;
    stored.sessionRevision = (stored.sessionRevision ?? 0) + 1;
    try {
      const { emitEvent } = await import('../../http-server.js');
      emitEvent({ type: 'scene:session-changed', sceneId } as any);
    } catch { /* best-effort */ }
    sendJson(res, 200, { ok: true, updated: validated[0] });
    return true;
  }

  // ── POST /platform/api/tweaks/remove ──────────────────────
  // Phase 2 Brief 2a Pin #5. Hard delete; no soft-delete state since
  // tweaks are scene-scoped editor metadata, not user content. The
  // SSE broadcast triggers panel re-render → row fades out.
  if (pathname === '/platform/api/tweaks/remove' && req.method === 'POST') {
    const body = await readJson(req);
    const sceneId = String(body.sceneId || '').trim();
    const id = String(body.id || '').trim();
    if (!sceneId || !id) {
      sendJson(res, 400, { ok: false, error: 'sceneId and id required' });
      return true;
    }
    const stored = getScene(sceneId);
    if (!stored) { sendJson(res, 404, { ok: false, error: `scene ${sceneId} not found` }); return true; }
    const tweaks = stored.tweaks || [];
    const idx = tweaks.findIndex((t) => t.id === id);
    if (idx < 0) {
      sendJson(res, 404, { ok: false, error: `tweak ${id} not declared` });
      return true;
    }
    tweaks.splice(idx, 1);
    stored.tweaks = tweaks;
    stored.sessionRevision = (stored.sessionRevision ?? 0) + 1;
    try {
      const { emitEvent } = await import('../../http-server.js');
      emitEvent({ type: 'scene:session-changed', sceneId } as any);
    } catch { /* best-effort */ }
    sendJson(res, 200, { ok: true, removed: id });
    return true;
  }

  return false;
}
