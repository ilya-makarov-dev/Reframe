/**
 * Platform API — rebrand + variations.
 *
 * Routes:
 *   POST /platform/api/rebrand/apply
 *        → Apply a brand's DESIGN.md to a scene: tokenize + autoBind + rebrandColorsFromTokens
 *        → Body: { sceneId, brand }
 *
 *   POST /platform/api/variations/apply
 *        → Apply a single variation axis to a scene in-place
 *        → Body: { sceneId, kind, value }
 *        → kinds: density | radius | shadows | typography | colorRotation | mode
 *
 *   POST /platform/api/variations/grid
 *        → Generate a variation grid (Cartesian product of axes)
 *        → Body: { sceneId, axes, namePrefix?, limit? }
 *        → Returns: list of generated scene IDs + labels
 *
 *   GET  /platform/api/variations/presets
 *        → Returns the catalog of available presets per axis for UI rendering
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { PlatformContext } from '../router.js';

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

async function getStore() {
  return import('../../store.js');
}

async function notifySceneChange() {
  try {
    const { emitEvent } = await import('../../http-server.js');
    emitEvent({ type: 'scene:saved' } as any);
  } catch {
    /* best-effort */
  }
}

// ─── Preset catalog (for UI rendering) ──────────────────────

const PRESET_CATALOG = {
  density: {
    label: 'Density',
    kind: 'slider',
    min: 0.5,
    max: 1.5,
    step: 0.1,
    default: 1.0,
    description: 'Multiplies all padding, gaps, and spacing. <1 = compact, >1 = spacious.',
  },
  radius: {
    label: 'Corner radius',
    kind: 'enum',
    options: [
      { value: 'sharp',     label: 'Sharp (0px)' },
      { value: 'editorial', label: 'Editorial (2–4px)' },
      { value: 'soft',      label: 'Soft (×1.5)' },
      { value: 'pill',      label: 'Pill (9999px)' },
    ],
    description: 'Transform corner radii across the whole design.',
  },
  shadows: {
    label: 'Shadows',
    kind: 'enum',
    options: [
      { value: 'flat',     label: 'Flat' },
      { value: 'subtle',   label: 'Subtle' },
      { value: 'normal',   label: 'Normal' },
      { value: 'dramatic', label: 'Dramatic' },
    ],
    description: 'Scale shadow blur, offset, and spread intensity.',
  },
  typography: {
    label: 'Typography',
    kind: 'enum',
    options: [
      { value: 'dramatic',  label: 'Dramatic (max contrast)' },
      { value: 'flat',      label: 'Flat (all 500)' },
      { value: 'editorial', label: 'Editorial (tight headings)' },
      { value: 'technical', label: 'Technical (wide tracking)' },
      { value: 'friendly',  label: 'Friendly (rounded)' },
    ],
    description: 'Reshape the type hierarchy — weights, line-height, letter-spacing.',
  },
  colorRotation: {
    label: 'Color rotation',
    kind: 'enum',
    options: [
      { value: 'invert-accent', label: 'Invert accent (primary ↔ accent)' },
      { value: 'invert-mode',   label: 'Invert mode (background ↔ text)' },
    ],
    description: 'Swap token role values for what-if color experiments.',
  },
  mode: {
    label: 'Mode',
    kind: 'enum',
    options: [
      { value: 'light', label: 'Light' },
      { value: 'dark',  label: 'Dark' },
    ],
    description: 'Switch between light and dark token values.',
  },
};

// ─── Rebrand / variations application ────────────────────────

async function loadBrandMd(ctx: PlatformContext, slug: string): Promise<string | undefined> {
  if (!ctx.projectDir) return undefined;
  try {
    const { loadBrandFromProject } = await import('../../../../core/src/project/io.js');
    const loaded = loadBrandFromProject(ctx.projectDir, slug);
    return loaded?.content;
  } catch {
    return undefined;
  }
}

export async function applyBrandToScene(sceneId: string, brandSlug: string, ctx: PlatformContext): Promise<{
  brand: string; tokens: number; bindings: number; rebranded: number; inheritance: any;
}> {
  const store = await getStore();
  const scene = store.getScene(sceneId);
  if (!scene) throw new Error(`scene "${sceneId}" not found`);

  const brandMd = await loadBrandMd(ctx, brandSlug);
  if (!brandMd) throw new Error(`brand "${brandSlug}" not found in project registry`);

  const { getSession } = await import('../../session.js');
  const session = getSession();
  const { parseDesignMd, applyBrandInheritance } = await import('../../../../core/src/design-system/index.js');
  const {
    tokenizeDesignSystem,
    autoBindTokensFromGraph,
    rebrandColorsFromTokens,
  } = await import('../../../../core/src/design-system/tokens.js');
  const { ensureSceneLayout } = await import('../../../../core/src/engine/layout.js');

  const parsed = session.getOrParseDesignMd(brandMd, parseDesignMd);
  const tokenIdx = tokenizeDesignSystem(scene.graph, parsed, { darkMode: true });
  const boundCount = autoBindTokensFromGraph(scene.graph, scene.rootId, tokenIdx);
  const rebranded = rebrandColorsFromTokens(scene.graph, scene.rootId, tokenIdx);

  // Full brand inheritance — apply component recipes (button/card/badge/input/nav
  // specs + typography hierarchy + shadow elevation). This is what makes a
  // Spotify rebrand actually look like Spotify and not Ferrari-in-green.
  const inheritance = applyBrandInheritance(scene.graph, scene.rootId, parsed);

  // Store the token index for subsequent setMode calls
  const sessId = store.findSessionId(sceneId);
  if (sessId) store.setTokenIndex(sessId, tokenIdx);

  ensureSceneLayout(scene.graph, scene.rootId);
  store.bumpSceneSessionRevision(sceneId);

  return {
    brand: brandSlug,
    tokens: tokenIdx.tokens.size,
    bindings: boundCount,
    rebranded,
    inheritance,
  };
}

async function applyVariationToScene(
  sceneId: string,
  kind: string,
  value: any,
) {
  const store = await getStore();
  const scene = store.getScene(sceneId);
  if (!scene) throw new Error(`scene "${sceneId}" not found`);

  const {
    scaleSpacing,
    scaleRadius,
    scaleShadows,
    rotateColors,
    applyTypographyPreset,
  } = await import('../../../../core/src/variations/index.js');
  const {
    rebuildTokenIndexFromGraph,
    switchTokenMode,
  } = await import('../../../../core/src/design-system/tokens.js');
  const { ensureSceneLayout } = await import('../../../../core/src/engine/layout.js');

  let changed = 0;

  switch (kind) {
    case 'density':
      changed = scaleSpacing(scene.graph, scene.rootId, Number(value));
      break;
    case 'radius':
      changed = scaleRadius(scene.graph, scene.rootId, value);
      break;
    case 'shadows':
      changed = scaleShadows(scene.graph, scene.rootId, value);
      break;
    case 'typography':
      changed = applyTypographyPreset(scene.graph, scene.rootId, value);
      break;
    case 'colorRotation': {
      const tokenIdx = rebuildTokenIndexFromGraph(scene.graph);
      if (!tokenIdx) throw new Error('no tokens defined — run rebrand or defineTokens first');
      changed = rotateColors(scene.graph, tokenIdx, value);
      break;
    }
    case 'mode': {
      const tokenIdx = rebuildTokenIndexFromGraph(scene.graph);
      if (!tokenIdx) throw new Error('no tokens defined — run rebrand or defineTokens first');
      const modeId = switchTokenMode(scene.graph, tokenIdx, String(value));
      if (!modeId) throw new Error(`mode "${value}" not found`);
      changed = 1;
      break;
    }
    default:
      throw new Error(`unknown variation kind: ${kind}`);
  }

  ensureSceneLayout(scene.graph, scene.rootId);
  store.bumpSceneSessionRevision(sceneId);

  // Persist to disk — without this the Platform UI macro buttons (Scale
  // spacing / Corner radius / Shadows / Rotate colors / Typography /
  // Toggle mode) only mutate the in-memory session. After a browser
  // reload the scene.json is re-read and the macro is silently gone,
  // which is indistinguishable from the app being broken.
  // reframe_edit's MCP path auto-saves post-mutation (tools/edit.ts
  // line ~2074) — this mirrors it for the Platform-UI path.
  try {
    const { autoSaveScene } = await import('../../tools/project.js');
    autoSaveScene(sceneId);
  } catch { /* best-effort */ }

  return { kind, value, changed };
}

// ─── Main API handler ───────────────────────────────────────

export async function handleVariationsApi(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PlatformContext,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;

  // ── GET /platform/api/variations/presets ──────────────────
  if (pathname === '/platform/api/variations/presets' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, presets: PRESET_CATALOG });
    return true;
  }

  // ── POST /platform/api/rebrand/apply ──────────────────────
  if (pathname === '/platform/api/rebrand/apply' && req.method === 'POST') {
    const body = await readJson(req);
    const sceneId = body.sceneId as string;
    const brand = body.brand as string;
    if (!sceneId || !brand) {
      sendError(res, 400, 'sceneId and brand required');
      return true;
    }
    try {
      const result = await applyBrandToScene(sceneId, brand, ctx);
      await notifySceneChange();
      sendJson(res, 200, { ok: true, ...result });
    } catch (e: any) {
      sendError(res, 400, e?.message ?? 'rebrand failed');
    }
    return true;
  }

  // ── POST /platform/api/variations/apply ───────────────────
  if (pathname === '/platform/api/variations/apply' && req.method === 'POST') {
    const body = await readJson(req);
    const sceneId = body.sceneId as string;
    const kind = body.kind as string;
    const value = body.value;
    if (!sceneId || !kind) {
      sendError(res, 400, 'sceneId and kind required');
      return true;
    }
    try {
      const result = await applyVariationToScene(sceneId, kind, value);
      await notifySceneChange();
      sendJson(res, 200, { ok: true, ...result });
    } catch (e: any) {
      sendError(res, 400, e?.message ?? 'variation failed');
    }
    return true;
  }

  // ── POST /platform/api/variations/grid ────────────────────
  if (pathname === '/platform/api/variations/grid' && req.method === 'POST') {
    const body = await readJson(req);
    const sceneId = body.sceneId as string;
    const axes = body.axes;
    const namePrefix = body.namePrefix as string | undefined;
    const limit = body.limit as number | undefined;
    if (!sceneId || !axes) {
      sendError(res, 400, 'sceneId and axes required');
      return true;
    }
    try {
      const { handleVary } = await import('../../tools/vary.js');
      const result = await handleVary({ sceneId, axes, namePrefix, limit });
      // Parse the result text to extract generated IDs
      const text = result.content[0]?.text ?? '';
      const generated: Array<{ sceneId: string; label: string }> = [];
      for (const line of text.split('\n')) {
        const m = line.match(/^\s+(s\d+)\s+(.+?)\s—/);
        if (m) generated.push({ sceneId: m[1], label: m[2].trim() });
      }
      await notifySceneChange();
      sendJson(res, 200, {
        ok: true,
        generated,
        raw: text,
      });
    } catch (e: any) {
      sendError(res, 400, e?.message ?? 'grid generation failed');
    }
    return true;
  }

  return false;
}
