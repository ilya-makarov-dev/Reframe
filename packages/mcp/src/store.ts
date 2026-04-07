/**
 * Scene Store — dual-ID session state for MCP tools.
 *
 * Every scene gets two identifiers:
 *   - Session ID (s1, s2, ...): ephemeral, for quick agent context
 *   - Slug (hero-dark-saas): persistent, human-friendly, filesystem-safe
 *
 * Both resolve to the same StoredScene. Scenes auto-persist to
 * .reframe/scenes/<slug>.scene.json when a project is active.
 */

import { SceneGraph } from '../../core/src/engine/scene-graph.js';
import { createSceneFromJson } from './engine.js';
import type { ITimeline } from '../../core/src/animation/types.js';
import type { TokenIndex } from '../../core/src/design-system/tokens.js';
import { emitProjectEvent } from './events.js';
import { toSlug, uniqueSlug } from '../../core/src/project/slug.js';

export interface StoredScene {
  graph: SceneGraph;
  rootId: string;
  name: string;
  slug: string;
  width: number;
  height: number;
  nodeCount: number;
  createdAt: number;
  timeline?: ITimeline;
}

// ─── Internal state ─────────────────────────────────────────

const scenes = new Map<string, StoredScene>();     // sessionId → StoredScene
const slugIndex = new Map<string, string>();        // slug → sessionId
const tokenIndices = new Map<string, TokenIndex>(); // sessionId → TokenIndex
let nextId = 1;

/** Project directory for auto-persistence. Set on startup or first scene. */
let _projectDir: string | null = null;

/** Deferred: create .reframe/ on first storeScene() if this is set. */
let _deferredProjectDir: string | null = null;

// ─── Project directory management ───────────────────────────

export function setProjectDir(dir: string | null): void {
  _projectDir = dir;
}

export function getProjectDir(): string | null {
  return _projectDir;
}

export function setDeferredProjectInit(dir: string): void {
  _deferredProjectDir = dir;
}

function countNodes(graph: SceneGraph, rootId: string): number {
  let count = 0;
  function walk(nid: string) {
    const n = graph.getNode(nid);
    if (!n) return;
    count++;
    for (const c of n.childIds) walk(c);
  }
  walk(rootId);
  return count;
}

// ─── Store operations ───────────────────────────────────────

/** Store a scene graph. Returns session ID (sN). */
export function storeScene(
  graph: SceneGraph,
  rootId: string,
  timeline?: ITimeline,
  options?: { slug?: string; name?: string },
): string {
  // Ensure HTTP sidecar is up
  import('./http-server.js').then(m => m.ensureHttpSidecar()).catch(() => {});

  const root = graph.getNode(rootId)!;
  const sessionId = `s${nextId++}`;
  const name = options?.name ?? root.name ?? 'Untitled';
  const nodeCount = countNodes(graph, rootId);
  const width = Math.round(root.width);
  const height = Math.round(root.height);

  // Generate unique slug
  const allSlugs = new Set(slugIndex.keys());
  // Also include on-disk slugs if project exists
  if (_projectDir) {
    try {
      const { loadProject } = require('../../core/src/project/io.js');
      const manifest = loadProject(_projectDir);
      for (const s of manifest.scenes) allSlugs.add(s.slug ?? s.id);
    } catch {}
  }
  const slug = uniqueSlug(options?.slug ?? toSlug(name), allSlugs);

  const stored: StoredScene = {
    graph, rootId, name, slug, width, height, nodeCount, createdAt: Date.now(), timeline,
  };

  scenes.set(sessionId, stored);
  slugIndex.set(slug, sessionId);

  // Broadcast to SSE — sceneId is session id (s1…) so Studio matches GET /scenes and fetch URLs
  emitProjectEvent({
    type: 'scene:saved',
    sceneId: sessionId,
    entry: {
      id: sessionId,
      slug,
      name,
      file: `scenes/${slug}.scene.json`,
      width, height,
      nodes: nodeCount,
      tags: [],
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    },
  } as any);

  // Auto-persist to disk
  autoSaveToProject(stored);

  return sessionId;
}

/** Get a stored scene by session ID or slug. */
export function getScene(idOrSlug: string): StoredScene | undefined {
  // Try session ID first (s1, s2...)
  const direct = scenes.get(idOrSlug);
  if (direct) return direct;

  // Try slug
  const sessionId = slugIndex.get(idOrSlug);
  if (sessionId) return scenes.get(sessionId);

  return undefined;
}

/** Get session ID for a slug. */
export function getSessionId(slug: string): string | undefined {
  return slugIndex.get(slug);
}

/** List all active scenes. */
export function listScenes(): Array<{
  id: string;
  slug: string;
  name: string;
  size: string;
  nodes: number;
  age: string;
}> {
  const now = Date.now();
  return [...scenes.entries()].map(([id, s]) => {
    const ageSec = Math.round((now - s.createdAt) / 1000);
    const age = ageSec < 60 ? `${ageSec}s` : `${Math.round(ageSec / 60)}m`;
    const root = s.graph.getNode(s.rootId);
    const displayName = (root?.name && root.name.trim()) ? root.name : s.name;
    return {
      id,
      slug: s.slug,
      name: displayName,
      size: `${s.width}×${s.height}`,
      nodes: s.nodeCount,
      age,
    };
  });
}

/**
 * Resolve scene from sceneId (session ID or slug) or raw JSON.
 * Session ID takes precedence, then slug, then raw JSON.
 */
export function resolveScene(input: { sceneId?: string; scene?: any }): { graph: SceneGraph; rootId: string } {
  if (input.sceneId) {
    const stored = getScene(input.sceneId);
    if (!stored) {
      const available = listScenes();
      const hint = available.length > 0
        ? `Active scenes: ${available.map(s => `${s.id} [${s.slug}] (${s.name} ${s.size})`).join(', ')}`
        : 'No active scenes. Import HTML first with reframe_compile or reframe_compile.';
      throw new Error(`Scene "${input.sceneId}" not found. ${hint}`);
    }
    return { graph: stored.graph, rootId: stored.rootId };
  }

  if (input.scene?.root) {
    return createSceneFromJson(input.scene);
  }

  throw new Error(
    'Provide sceneId (session ID like "s1" or slug like "hero-dark") or scene JSON. ' +
    'Recommended: use reframe_compile or reframe_compile first, then reference by sceneId.'
  );
}

// ─── Token index operations ─────────────────────────────────

/** Store a token index for a scene. */
export function setTokenIndex(sessionId: string, index: TokenIndex): void {
  tokenIndices.set(sessionId, index);
}

/** Get the token index for a scene (by session ID or slug). */
export function getTokenIndex(idOrSlug: string): TokenIndex | undefined {
  const direct = tokenIndices.get(idOrSlug);
  if (direct) return direct;
  const sessionId = slugIndex.get(idOrSlug);
  if (sessionId) return tokenIndices.get(sessionId);
  return undefined;
}

/** Find session ID for a given scene (by session ID or slug). */
export function findSessionId(idOrSlug: string): string | undefined {
  if (scenes.has(idOrSlug)) return idOrSlug;
  return slugIndex.get(idOrSlug);
}

/** Remove a scene by session ID or slug. */
export function deleteScene(idOrSlug: string): boolean {
  let sessionId = idOrSlug;
  if (!scenes.has(sessionId)) {
    const mapped = slugIndex.get(idOrSlug);
    if (!mapped) return false;
    sessionId = mapped;
  }

  const stored = scenes.get(sessionId);
  if (!stored) return false;
  const slug = stored.slug;
  slugIndex.delete(stored.slug);
  tokenIndices.delete(sessionId);
  scenes.delete(sessionId);
  emitProjectEvent({ type: 'scene:deleted', sceneId: sessionId, slug });

  const dir = getProjectDir();
  if (dir) {
    try {
      const { deleteScene: deleteSceneFromDisk, projectExists } = require('../../core/src/project/io.js');
      if (projectExists(dir)) {
        deleteSceneFromDisk(dir, slug);
      }
    } catch {
      /* disk delete is best-effort */
    }
  }
  return true;
}

/** Clear all scenes. */
export function clearScenes(): void {
  scenes.clear();
  slugIndex.clear();
  tokenIndices.clear();
  nextId = 1;
}

// ─── Auto-persistence ───────────────────────────────────────

/** Ensure .reframe/ project exists (deferred init). */
function ensureProject(): string | null {
  if (_projectDir) return _projectDir;

  if (_deferredProjectDir) {
    try {
      const { projectExists, initProject } = require('../../core/src/project/io.js');
      if (!projectExists(_deferredProjectDir)) {
        initProject(_deferredProjectDir, 'reframe');
      }
      _projectDir = _deferredProjectDir;
      _deferredProjectDir = null;
      return _projectDir;
    } catch {
      return null;
    }
  }
  return null;
}

/** Auto-save a scene to the project directory. Fire-and-forget. */
function autoSaveToProject(stored: StoredScene): void {
  const dir = ensureProject();
  if (!dir) return;

  try {
    const { saveScene: saveSceneToDisk } = require('../../core/src/project/io.js');
    saveSceneToDisk(dir, stored.graph, stored.rootId, {
      slug: stored.slug,
      name: stored.name,
      nodes: stored.nodeCount,
      timeline: stored.timeline,
    });
  } catch {
    // Auto-save is best-effort
  }
}

/** Re-save a scene after mutation (e.g. audit auto-fix). */
export function resaveScene(sessionId: string): void {
  const stored = scenes.get(sessionId);
  if (!stored) return;
  autoSaveToProject(stored);
}

// ─── Startup: load existing project ─────────────────────────

/** Load all scenes from a .reframe/ project into the session store. Returns count loaded. */
export function loadProjectScenes(projectDir: string): number {
  try {
    const { loadAllScenes } = require('../../core/src/project/io.js');
    const loaded = loadAllScenes(projectDir) as Array<{
      graph: SceneGraph;
      rootId: string;
      timeline?: ITimeline;
      entry: { slug?: string; id: string; name: string };
    }>;

    for (const { graph, rootId, timeline, entry } of loaded) {
      const slug = entry.slug ?? entry.id;
      const sessionId = `s${nextId++}`;
      const nodeCount = countNodes(graph, rootId);
      const root = graph.getNode(rootId)!;

      const stored: StoredScene = {
        graph, rootId,
        name: entry.name,
        slug,
        width: Math.round(root.width),
        height: Math.round(root.height),
        nodeCount,
        createdAt: Date.now(),
        timeline,
      };

      scenes.set(sessionId, stored);
      slugIndex.set(slug, sessionId);
    }

    return loaded.length;
  } catch {
    return 0;
  }
}
