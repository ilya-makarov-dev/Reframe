/**
 * Block Library API — list / insert / AI-compose endpoints.
 *
 * The Constructor's old panel-based "pick a block" flow becomes a
 * floating BlockPalette + AI compose. This module exposes:
 *
 *   GET  /api/agent/blocks               — flat catalog: programmatic + HTML
 *   POST /api/agent/insert               — insert ONE block into a scene
 *   POST /api/agent/compose-page         — AI picks N blocks → composePage
 *
 * Programmatic blocks come from the in-memory blocks registry (17 starter
 * blocks defined in core/src/blocks/starter.ts). HTML sections come from
 * the file-based manifest (60+ tailblocks/kometa/hyperui sections).
 *
 * Insert merges into an EXISTING scene's page frame using the same
 * mergeSubtree primitive that composePage uses internally.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { getScene, storeScene, getWorkspaceRoot } from '../store.js';
import { spawnAgentSession } from '../agent/spawn.js';
import { emitProjectEvent } from '../events.js';

// ─── Body / response helpers ───────────────────────────────

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

// ─── /api/agent/blocks — list catalog ───────────────────────

export interface BlockListItem {
  /** "block:hero-centered" or "section:tailblocks/hero-a" — globally unique. */
  id: string;
  /** Display name. */
  name: string;
  /** Category — used for grouping in the palette. */
  category: string;
  /** Source: "block" (programmatic) or "section" (HTML manifest). */
  source: 'block' | 'section';
  /** Search keywords (name + tags). */
  keywords: string[];
  /** Optional one-liner shown as tooltip. */
  description?: string;
}

let cachedCatalog: BlockListItem[] | null = null;

async function buildCatalog(): Promise<BlockListItem[]> {
  if (cachedCatalog) return cachedCatalog;

  const items: BlockListItem[] = [];

  // ── Programmatic blocks ──
  try {
    const blocksMod = await import('../../../core/src/blocks/index.js');
    blocksMod.registerStarterBlocks?.();
    const programmatic = blocksMod.listBlocks?.() ?? [];
    for (const b of programmatic) {
      items.push({
        id: `block:${b.name}`,
        name: b.name,
        category: b.category,
        source: 'block',
        description: b.description,
        keywords: [b.name, b.category, ...(b.tags ?? [])],
      });
    }
  } catch {
    /* best-effort */
  }

  // ── HTML sections from manifest ──
  try {
    const manifestMod = await import('../../../core/src/sections/manifest.js');
    const sectionsDir = `${getWorkspaceRoot()}/packages/core/src/sections`;
    const sections = manifestMod.listSectionsByCategory(undefined, sectionsDir);
    for (const s of sections) {
      items.push({
        id: `section:${s.id}`,
        name: s.name,
        category: s.category,
        source: 'section',
        keywords: [s.name, s.category, s.library, s.variant, s.id],
      });
    }
  } catch {
    /* best-effort */
  }

  cachedCatalog = items;
  return items;
}

export async function handleListBlocks(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const items = await buildCatalog();
    // Group by category for the UI palette.
    const byCategory: Record<string, BlockListItem[]> = {};
    for (const it of items) {
      (byCategory[it.category] ??= []).push(it);
    }
    sendJson(res, 200, {
      ok: true,
      total: items.length,
      categories: Object.keys(byCategory).sort(),
      items,
      byCategory,
    });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: (err as Error).message });
  }
}

// ─── /api/agent/insert — add a block to an existing scene ──

export async function handleInsertBlock(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: any;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { ok: false, error: 'Invalid body' });
    return;
  }

  const blockId = String(body?.blockId ?? '');
  const sceneId = String(body?.sceneId ?? '');
  if (!blockId || !sceneId) {
    sendJson(res, 400, { ok: false, error: 'blockId + sceneId required' });
    return;
  }

  const scene = getScene(sceneId);
  if (!scene) {
    sendJson(res, 404, { ok: false, error: `Scene "${sceneId}" not found` });
    return;
  }

  // Resolve the block: parse "block:<name>" or "section:<id>".
  const [source, ...nameRest] = blockId.split(':');
  const blockName = nameRest.join(':');
  if (!blockName || (source !== 'block' && source !== 'section')) {
    sendJson(res, 400, { ok: false, error: 'blockId must be "block:<name>" or "section:<id>"' });
    return;
  }

  try {
    // Get a fresh subtree for the block, then merge into the active scene.
    let blockGraph: any, blockRootId: string;

    if (source === 'block') {
      const blocksMod = await import('../../../core/src/blocks/index.js');
      blocksMod.registerStarterBlocks?.();
      const def = blocksMod.getBlock?.(blockName);
      if (!def) {
        sendJson(res, 404, { ok: false, error: `Block "${blockName}" not found` });
        return;
      }
      const inst = blocksMod.instantiateBlock(def, body?.slots ?? undefined);
      blockGraph = inst.graph;
      blockRootId = inst.rootId;
    } else {
      const manifestMod = await import('../../../core/src/sections/manifest.js');
      const sectionsDir = `${getWorkspaceRoot()}/packages/core/src/sections`;
      const inst = await manifestMod.instantiateHtmlSection(blockName, sectionsDir);
      if (!inst) {
        sendJson(res, 404, { ok: false, error: `Section "${blockName}" not found` });
        return;
      }
      blockGraph = inst.graph;
      blockRootId = inst.rootId;
    }

    // Merge the block subtree into the active scene's root frame.
    // composePage exports mergeSubtree as a private helper — we
    // duplicate the minimal logic here so we don't have to refactor
    // compose.ts. See compose.ts for the full version.
    const newSectionRootId = mergeSubtreeInto(scene.graph, scene.rootId, blockGraph, blockRootId);
    if (!newSectionRootId) {
      sendJson(res, 500, { ok: false, error: 'Failed to merge block into scene' });
      return;
    }

    // Recompute layout & bump revision so the editor refreshes.
    try {
      const layoutMod = await import('../../../core/src/engine/layout.js');
      layoutMod.ensureSceneLayout(scene.graph, scene.rootId);
    } catch { /* best-effort */ }

    scene.sessionRevision = (scene.sessionRevision ?? 0) + 1;
    // Store re-emits scene:session-changed for us via storeScene's internals.
    storeScene(scene.graph, scene.rootId, scene.timeline, {
      slug: scene.slug,
      name: scene.name,
      brand: scene.brand,
    });
    emitProjectEvent({
      type: 'scene:session-changed',
      sceneId,
      revision: scene.sessionRevision,
    });

    sendJson(res, 200, {
      ok: true,
      sceneId,
      newSectionId: newSectionRootId,
      blockId,
    });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: (err as Error).message });
  }
}

/**
 * Minimal scene-graph merge: clone every node from `srcGraph` into
 * `dstGraph` under `dstParentId`, preserving the subtree structure.
 * Returns the merged subtree's root id in the destination graph.
 *
 * This is a stripped version of compose.ts's mergeSubtree so we avoid
 * exporting an internal helper. It walks the subtree DFS, creating
 * new nodes via dstGraph.createNode and copying properties.
 */
function mergeSubtreeInto(
  dstGraph: any,
  dstParentId: string,
  srcGraph: any,
  srcRootId: string,
): string | null {
  const srcRoot = srcGraph.getNode(srcRootId);
  if (!srcRoot) return null;

  const idMap = new Map<string, string>();

  function copy(srcId: string, parentId: string): string | null {
    const src = srcGraph.getNode(srcId);
    if (!src) return null;
    // Strip id/childIds/parentId so createNode generates fresh ones.
    const { id: _id, childIds: _ch, parentId: _p, ...props } = src as any;
    const newNode = dstGraph.createNode(src.type, parentId, props);
    if (!newNode) return null;
    idMap.set(srcId, newNode.id);
    const children = (src.childIds ?? []) as string[];
    for (const childId of children) copy(childId, newNode.id);
    return newNode.id;
  }

  return copy(srcRootId, dstParentId);
}

// ─── /api/agent/compose-page — AI picks blocks → assembles page ──

export async function handleComposePage(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: any;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { ok: false, error: 'Invalid body' });
    return;
  }

  const userPrompt = String(body?.prompt ?? '').trim();
  if (!userPrompt) {
    sendJson(res, 400, { ok: false, error: 'prompt required' });
    return;
  }

  // SSE: stream agent events back so the UI can show progress.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  res.write(': agent compose stream open\n\n');

  // Build a constrained prompt: the AI MUST pick blocks from our catalog
  // (no hallucination) and respond as JSON. We then call composePage.
  const catalog = await buildCatalog();
  const blockNames = catalog.map((c) => c.id).slice(0, 100);
  const cataloglines = catalog.slice(0, 80).map((c) => `  ${c.id}  (${c.category})`).join('\n');

  const composerPrompt = [
    'You are picking sections to compose a complete web page.',
    '',
    'User wants: ' + userPrompt,
    '',
    'Available blocks (pick ONLY from this list — do NOT invent names):',
    cataloglines,
    '',
    'TASK: Return a JSON array of 5-8 block ids in the order they should appear on the page. ',
    'Always start with a nav/header section, end with a footer. Pick varied sections that match the user intent. ',
    'Output ONLY the JSON array, no text before or after. Example:',
    '["section:tailblocks/header-a","section:tailblocks/hero-a","section:tailblocks/feature-c","section:tailblocks/pricing-a","section:tailblocks/cta-a","section:tailblocks/footer-a"]',
  ].join('\n');

  send('chat_id', { chatId: `compose-${Date.now()}` });

  let collectedText = '';
  let clientGone = false;
  req.on('close', () => { clientGone = true; });

  const session = spawnAgentSession({
    prompt: composerPrompt,
    // No reframe MCP needed — we just want JSON. Restrict to no tools
    // so claude responds quickly with text only.
    allowedTools: [],
  });

  try {
    for await (const ev of session.events) {
      if (clientGone) break;
      send(ev.type, ev);
      if (ev.type === 'text') collectedText += ev.text;
      if (ev.type === 'done') break;
    }
  } catch (err) {
    send('error', { message: (err as Error).message });
  }

  // Parse the JSON list from collectedText. Be tolerant of code fences
  // or extra whitespace.
  let pickedIds: string[] = [];
  try {
    const match = collectedText.match(/\[[\s\S]*\]/);
    if (match) pickedIds = JSON.parse(match[0]);
  } catch {
    /* fall through */
  }
  pickedIds = pickedIds.filter((id) => typeof id === 'string' && blockNames.includes(id));

  if (pickedIds.length === 0) {
    send('error', { message: 'AI did not return valid block ids' });
    if (!clientGone) try { res.end(); } catch { /* ignore */ }
    return;
  }

  send('picked', { blocks: pickedIds });

  // Now compose using the existing composePage helper.
  try {
    const composeMod = await import('../../../core/src/content/compose.js');
    const result = await composeMod.composePage(
      pickedIds.map((id) => ({ block: id.split(':').slice(1).join(':') })),
      { pageName: userPrompt.slice(0, 60) },
    );
    if (!result || result.blocks.length === 0) {
      send('error', { message: 'composePage returned no blocks' });
      if (!clientGone) try { res.end(); } catch { /* ignore */ }
      return;
    }

    try {
      const layoutMod = await import('../../../core/src/engine/layout.js');
      layoutMod.ensureSceneLayout(result.graph, result.rootId);
    } catch { /* best-effort */ }

    const newSceneId = storeScene(result.graph, result.rootId, undefined, {
      name: userPrompt.slice(0, 60) || 'AI composed page',
    });

    send('composed', {
      sceneId: newSceneId,
      blocks: result.blocks.map((b) => b.name),
      notFound: result.notFound,
    });
  } catch (err) {
    send('error', { message: (err as Error).message });
  }

  if (!clientGone) try { res.end(); } catch { /* ignore */ }
}

// ─── /api/agent/insert-smart — chat-first AI router ─────────
//
// The user types intent ("add pricing with 3 tiers") + optionally drops
// an image. AI decides which path:
//   - INSERT  — pick a block from the catalog and merge into scene
//   - COMPOSE — assemble a full page (used when scene is empty)
//   - GENERATE — write fresh HTML when no library block fits
//
// This is the single endpoint the chat-first floating UI talks to.
// The 80-block catalog stays — it becomes the AI's "vocabulary" not
// the user's burden.

export async function handleSmartInsert(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: any;
  try {
    body = await readJsonBody(req, 8 * 1024 * 1024); // bumped for base64 images
  } catch {
    sendJson(res, 400, { ok: false, error: 'Invalid body' });
    return;
  }

  const userPrompt = String(body?.prompt ?? '').trim();
  const sceneId = String(body?.sceneId ?? '');
  const imageDataUrl = typeof body?.image === 'string' ? body.image : null;
  if (!userPrompt && !imageDataUrl) {
    sendJson(res, 400, { ok: false, error: 'prompt or image required' });
    return;
  }

  // SSE response — we stream agent events + final action result.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  res.write(': smart-insert stream open\n\n');

  let clientGone = false;
  req.on('close', () => { clientGone = true; });

  // ── Save image to temp file if present so claude can Read it ──
  let imagePath: string | null = null;
  if (imageDataUrl) {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const tempDir = path.join(getWorkspaceRoot(), '.reframe', 'temp');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      // Strip data:image/png;base64, prefix
      const m = imageDataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
      if (m) {
        const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
        const buf = Buffer.from(m[2], 'base64');
        imagePath = path.join(tempDir, `agent-image-${Date.now()}.${ext}`);
        fs.writeFileSync(imagePath, buf);
      }
    } catch (err) {
      send('error', { message: 'Image save failed: ' + (err as Error).message });
    }
  }

  // ── Build catalog summary (compact for prompt) ──
  const catalog = await buildCatalog();

  // ── Detect scene state for routing decision ──
  const scene = sceneId ? getScene(sceneId) : null;
  const isEmpty = !scene || scene.nodeCount <= 2; // canvas + page only
  const existingSections = scene ? describeSceneSections(scene) : '';

  // ── Active brand ──
  let brandSummary = '';
  try {
    const fs = await import('fs');
    const path = await import('path');
    const manifestPath = path.join(getWorkspaceRoot(), '.reframe', 'project.json');
    if (fs.existsSync(manifestPath)) {
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (raw?.activeBrand) brandSummary = `Active brand: ${raw.activeBrand}`;
    }
  } catch { /* ignore */ }

  // ── Compact catalog: id + category, max 80 lines ──
  const catalogSummary = catalog.slice(0, 80)
    .map((c) => `  ${c.id} (${c.category})`)
    .join('\n');

  const composerPrompt = [
    'You are a design router inside a live editor. The user asked for something.',
    'Your job: pick ONE action and output ONE JSON object. No prose, no markdown.',
    '',
    `Scene state: ${isEmpty ? 'EMPTY (no sections yet)' : 'HAS CONTENT'}`,
    existingSections ? `Existing sections on the page:\n${existingSections}` : '',
    brandSummary,
    '',
    imagePath
      ? `Reference image attached at: ${imagePath}\nUse the Read tool to inspect it before deciding.`
      : '',
    '',
    'Available library blocks (PREFER these — they are production-ready, audited, brand-applied):',
    catalogSummary,
    '',
    'Pick action:',
    '  - "compose" if the scene is empty AND user described a full page → array of 5-8 block ids',
    '  - "insert" if user wants to add ONE more section to existing page → single block id',
    '  - "generate" if NO library block matches → fresh HTML (last resort)',
    '',
    'OUTPUT FORMATS (pick one, output ONLY the JSON):',
    '  {"action":"compose","blockIds":["section:tailblocks/header-a", ...]}',
    '  {"action":"insert","blockId":"section:tailblocks/pricing-a"}',
    '  {"action":"generate","html":"<section style=\'...\'>...</section>"}',
    '',
    'User request: ' + userPrompt,
  ].filter(Boolean).join('\n');

  send('chat_id', { chatId: `smart-${Date.now()}` });

  // Spawn claude. Allow Read tool for image inspection if image was attached.
  const allowedTools = imagePath ? ['Read'] : [];
  const session = spawnAgentSession({
    prompt: composerPrompt,
    allowedTools,
  });

  let collected = '';
  try {
    for await (const ev of session.events) {
      if (clientGone) break;
      send(ev.type, ev);
      if (ev.type === 'text') collected += ev.text;
      if (ev.type === 'done') break;
    }
  } catch (err) {
    send('error', { message: (err as Error).message });
  }

  // Parse JSON action
  let action: any = null;
  try {
    const m = collected.match(/\{[\s\S]*\}/);
    if (m) action = JSON.parse(m[0]);
  } catch {
    /* fallthrough */
  }

  if (!action || !action.action) {
    send('error', { message: 'AI did not return a valid action' });
    if (!clientGone) try { res.end(); } catch { /* ignore */ }
    return;
  }

  // Execute the action
  try {
    if (action.action === 'compose' && Array.isArray(action.blockIds)) {
      // Build a fresh page from picked blocks
      const composeMod = await import('../../../core/src/content/compose.js');
      const composeBlocks: string[] = action.blockIds.filter((id: unknown): id is string => typeof id === 'string');
      const result = await composeMod.composePage(
        composeBlocks.map((id) => ({ block: id.split(':').slice(1).join(':') })),
        { pageName: userPrompt.slice(0, 60) || 'AI page' },
      );
      if (!result || result.blocks.length === 0) {
        send('error', { message: 'composePage returned no blocks' });
      } else {
        try {
          const layoutMod = await import('../../../core/src/engine/layout.js');
          layoutMod.ensureSceneLayout(result.graph, result.rootId);
        } catch { /* best-effort */ }
        const newSceneId = storeScene(result.graph, result.rootId, undefined, {
          name: userPrompt.slice(0, 60) || 'AI composed page',
        });
        send('composed', {
          sceneId: newSceneId,
          blocks: result.blocks.map((b) => b.name),
        });
      }
    } else if (action.action === 'insert' && typeof action.blockId === 'string') {
      // Insert single block into existing scene
      if (!scene) {
        send('error', { message: 'No active scene to insert into' });
      } else {
        const newSectionId = await insertBlockHelper(action.blockId, scene);
        if (newSectionId) {
          scene.sessionRevision = (scene.sessionRevision ?? 0) + 1;
          emitProjectEvent({
            type: 'scene:session-changed',
            sceneId,
            revision: scene.sessionRevision,
          });
          send('inserted', {
            sceneId,
            newSectionId,
            blockId: action.blockId,
          });
        } else {
          send('error', { message: 'Failed to insert block' });
        }
      }
    } else if (action.action === 'generate' && typeof action.html === 'string') {
      // AI wrote fresh HTML — compile via importFromHtml + merge
      if (!scene) {
        send('error', { message: 'No active scene to add to' });
      } else {
        const importMod = await import('../../../core/src/importers/html.js');
        const imported = await importMod.importFromHtml(action.html, { name: 'generated-section' });
        if (!imported) {
          send('error', { message: 'AI HTML failed to compile' });
        } else {
          const newSectionId = mergeSubtreeInto(scene.graph, scene.rootId, imported.graph, imported.rootId);
          if (newSectionId) {
            try {
              const layoutMod = await import('../../../core/src/engine/layout.js');
              layoutMod.ensureSceneLayout(scene.graph, scene.rootId);
            } catch { /* best-effort */ }
            scene.sessionRevision = (scene.sessionRevision ?? 0) + 1;
            emitProjectEvent({
              type: 'scene:session-changed',
              sceneId,
              revision: scene.sessionRevision,
            });
            send('inserted', {
              sceneId,
              newSectionId,
              blockId: 'generated',
            });
          } else {
            send('error', { message: 'Failed to merge generated HTML' });
          }
        }
      }
    } else {
      send('error', { message: 'Unknown action: ' + JSON.stringify(action) });
    }
  } catch (err) {
    send('error', { message: (err as Error).message });
  }

  if (!clientGone) try { res.end(); } catch { /* ignore */ }
}

/** Helper: list direct children of the page root with friendly labels. */
function describeSceneSections(scene: any): string {
  try {
    const root = scene.graph.getNode(scene.rootId);
    if (!root) return '';
    // Find the page node — usually a single FRAME child of CANVAS
    let pageNode = root;
    if (root.type === 'CANVAS' && root.childIds?.length > 0) {
      const first = scene.graph.getNode(root.childIds[0]);
      if (first) pageNode = first;
    }
    const lines: string[] = [];
    for (let i = 0; i < (pageNode.childIds?.length ?? 0); i++) {
      const child = scene.graph.getNode(pageNode.childIds[i]);
      if (!child) continue;
      lines.push(`  ${i + 1}. ${child.name || child.type}`);
    }
    return lines.join('\n');
  } catch {
    return '';
  }
}

/** Helper: instantiate + merge a block into a scene. Returns new section root id. */
async function insertBlockHelper(blockId: string, scene: any): Promise<string | null> {
  const [source, ...nameRest] = blockId.split(':');
  const blockName = nameRest.join(':');
  if (!blockName) return null;
  let blockGraph: any, blockRootId: string;
  if (source === 'block') {
    const blocksMod = await import('../../../core/src/blocks/index.js');
    blocksMod.registerStarterBlocks?.();
    const def = blocksMod.getBlock?.(blockName);
    if (!def) return null;
    const inst = blocksMod.instantiateBlock(def);
    blockGraph = inst.graph;
    blockRootId = inst.rootId;
  } else if (source === 'section') {
    const manifestMod = await import('../../../core/src/sections/manifest.js');
    const sectionsDir = `${getWorkspaceRoot()}/packages/core/src/sections`;
    const inst = await manifestMod.instantiateHtmlSection(blockName, sectionsDir);
    if (!inst) return null;
    blockGraph = inst.graph;
    blockRootId = inst.rootId;
  } else {
    return null;
  }
  const newId = mergeSubtreeInto(scene.graph, scene.rootId, blockGraph, blockRootId);
  if (newId) {
    try {
      const layoutMod = await import('../../../core/src/engine/layout.js');
      layoutMod.ensureSceneLayout(scene.graph, scene.rootId);
    } catch { /* best-effort */ }
  }
  return newId;
}

// ─── Router glue ───────────────────────────────────────────

export async function handleBlocksApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path === '/api/agent/blocks' && method === 'GET') {
    await handleListBlocks(req, res);
    return true;
  }
  if (path === '/api/agent/insert' && method === 'POST') {
    await handleInsertBlock(req, res);
    return true;
  }
  if (path === '/api/agent/insert-smart' && method === 'POST') {
    await handleSmartInsert(req, res);
    return true;
  }
  if (path === '/api/agent/compose-page' && method === 'POST') {
    await handleComposePage(req, res);
    return true;
  }
  return false;
}
