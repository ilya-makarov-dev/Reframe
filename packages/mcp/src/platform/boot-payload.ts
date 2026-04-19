/**
 * Editor shell boot payload.
 *
 * Inlined as `<script>window.__REFRAME_BOOT__ = {...}</script>` in the
 * editor shell HTML so the client can paint without the initial fetch
 * waterfall (agent health, audit, scene tree, annotations, tokens, scene
 * root props — all fired on load from different UI modules).
 *
 * Client code reads `window.__REFRAME_BOOT__` synchronously during init
 * and falls back to the legacy fetch paths when the payload is absent
 * (legacy pages, subsequent scene switches, stale revisions).
 *
 * Only the ACTIVE scene is pre-serialized. Other scenes in the same
 * project are fetched lazily on canvas switch — inlining N-scene
 * projects would multiply HTML size N×.
 */
import type { PlatformContext } from './router.js';

export interface BootSceneData {
  id: string;
  slug?: string;
  name: string;
  width: number;
  height: number;
  brand?: string;
  revision: number;
  /** Scene root node props — powers the empty-selection Properties panel. */
  root: { id: string; width: number; height: number; background: string } | null;
  /** 37-rule audit result (may be null if the run failed). */
  audit: { score: number; counts: Record<string, number>; findings: any[] } | null;
  /** Layer tree — same shape as GET /platform/api/scene/tree. */
  tree: any;
  /** Annotations (marks + comments). */
  annotations: any[];
  /** Brand tokens. */
  tokens: any[];
}

export interface EditorBootPayload {
  agent: { claudeFound: boolean; claudePath: string | null };
  activeSceneId: string | null;
  scenes: Record<string, BootSceneData>;
  /** Active project slug (from the URL). Chat history is keyed on this. */
  projectSlug: string | null;
  /** Persisted chat for the active project — replayed on load. */
  chat: {
    sessionId: string | null;
    messages: any[];
  } | null;
  builtAt: number;
}

/**
 * Build the editor-shell boot payload for a project.
 *
 * Errors in any one section are isolated — we always return a structured
 * payload with null/empty fallbacks for the sections that failed, so the
 * client can trust "if the key is present, use it" without having to
 * distinguish stale data from a server crash.
 */
export async function buildEditorBoot(
  ctx: PlatformContext,
  activeSceneId: string | null,
  projectSlug: string | null,
): Promise<EditorBootPayload> {
  const payload: EditorBootPayload = {
    agent: await detectClaude(),
    activeSceneId,
    projectSlug,
    chat: null,
    scenes: {},
    builtAt: Date.now(),
  };
  if (activeSceneId) {
    try {
      payload.scenes[activeSceneId] = await buildSceneBoot(ctx, activeSceneId);
    } catch {
      /* swallow — client falls back to fetch */
    }
  }
  if (projectSlug) {
    try {
      const { loadChat } = await import('../chat-store.js');
      const history = loadChat(projectSlug);
      payload.chat = { sessionId: history.sessionId, messages: history.messages };
    } catch {
      /* leave null — client will GET /api/chat/<slug> lazily */
    }
  }
  return payload;
}

async function detectClaude(): Promise<{ claudeFound: boolean; claudePath: string | null }> {
  try {
    const { spawnSync } = await import('child_process');
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8' });
    const found = r.status === 0 && (r.stdout?.trim().length ?? 0) > 0;
    return {
      claudeFound: found,
      claudePath: found ? r.stdout.split(/\r?\n/)[0].trim() : null,
    };
  } catch {
    return { claudeFound: false, claudePath: null };
  }
}

async function buildSceneBoot(ctx: PlatformContext, sceneId: string): Promise<BootSceneData> {
  const { getScene } = await import('../store.js');
  const scene = getScene(sceneId);
  if (!scene) return emptySceneBoot(sceneId);

  const base: BootSceneData = {
    id: sceneId,
    slug: scene.slug,
    name: scene.name ?? scene.slug ?? sceneId,
    width: scene.width ?? 1440,
    height: scene.height ?? 900,
    brand: scene.brand,
    revision: scene.sessionRevision ?? 0,
    root: null,
    audit: null,
    tree: null,
    annotations: [],
    tokens: [],
  };

  const rootNode = scene.graph.getNode(scene.rootId);
  if (rootNode) {
    base.root = {
      id: scene.rootId,
      width: Math.round((rootNode as any).width ?? base.width),
      height: Math.round((rootNode as any).height ?? base.height),
      background: extractFillHex(rootNode as any) ?? '#FFFFFF',
    };
    base.tree = buildTreeNode(scene as any, scene.rootId, 0);
  }

  base.audit = await buildAuditResult(ctx, scene as any);
  base.annotations = await loadAnnotations(ctx, scene.slug ?? sceneId);
  base.tokens = loadTokens(scene as any);

  return base;
}

function emptySceneBoot(sceneId: string): BootSceneData {
  return {
    id: sceneId,
    name: sceneId,
    width: 1440,
    height: 900,
    revision: 0,
    root: null,
    audit: null,
    tree: null,
    annotations: [],
    tokens: [],
  };
}

function extractFillHex(node: any): string | null {
  const fills = node?.fills;
  if (!Array.isArray(fills) || fills.length === 0) return null;
  const color = fills[0]?.color;
  if (!color) return null;
  const r = Math.round((color.r ?? 0) * 255);
  const g = Math.round((color.g ?? 0) * 255);
  const b = Math.round((color.b ?? 0) * 255);
  const clamp = (n: number) => Math.max(0, Math.min(255, n));
  const toHex = (n: number) => clamp(n).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function buildTreeNode(scene: any, nodeId: string, depth: number): any | null {
  if (depth > 20) return null;
  const node = scene.graph.getNode(nodeId);
  if (!node) return null;
  const children: any[] = [];
  for (const cid of node.childIds ?? []) {
    const child = buildTreeNode(scene, cid, depth + 1);
    if (child) children.push(child);
  }
  return {
    id: node.id,
    name: node.name ?? '',
    type: node.type ?? '',
    text: node.text ? String(node.text).slice(0, 40) : undefined,
    childCount: children.length,
    children,
  };
}

async function buildAuditResult(ctx: PlatformContext, scene: any): Promise<BootSceneData['audit']> {
  try {
    // Layout MUST be fresh before running rules that look at bbox
    // positions (sibling-overlap, content-overflow, aesthetic-*). A
    // scene loaded from disk carries pre-layout coordinates — Yoga
    // has to recompute or every sibling looks overlapped at (0,0)
    // and the boot payload ships 6 phantom warnings the live
    // /api/audit (which does ensureSceneLayout) never reproduces.
    const { ensureSceneLayout } = await import('../../../core/src/engine/layout.js');
    try { ensureSceneLayout(scene.graph, scene.rootId); } catch { /* best-effort */ }

    const { StandaloneNode } = await import('../../../core/src/adapters/standalone/node.js');
    const rootNode = scene.graph.getNode(scene.rootId);
    if (!rootNode) return null;
    const wrappedRoot = new StandaloneNode(scene.graph, rootNode);

    const { buildInspectAuditRules } = await import('../../../core/src/inspect-audit-rules.js');
    let designSystem: any = undefined;
    if (ctx.projectDir) {
      try {
        const dsText = ctx.getDesignMd?.();
        if (dsText) {
          const dsMod = await import('../../../core/src/design-system/index.js');
          designSystem = dsMod.parseDesignMd(dsText);
        }
      } catch { /* no DS */ }
    }
    const rules = buildInspectAuditRules(designSystem);
    const { audit: runAudit } = await import('../../../core/src/audit.js');
    const issues = runAudit(wrappedRoot as any, rules, designSystem);

    const counts: Record<string, number> = { error: 0, warning: 0, info: 0 };
    for (const issue of issues) {
      if (issue.severity in counts) counts[issue.severity]++;
    }
    const score = Math.max(0, 100 - counts.error * 10 - counts.warning * 3 - counts.info);
    const findings = issues.map((i: any) => ({
      nodeId: i.nodeId ?? null,
      nodeName: i.nodeName ?? null,
      path: i.path ?? null,
      rule: i.rule,
      severity: i.severity,
      message: i.message,
      fix: i.fix ?? null,
    }));
    return { score, counts, findings };
  } catch {
    return null;
  }
}

async function loadAnnotations(ctx: PlatformContext, sceneSlug: string): Promise<any[]> {
  try {
    if (!ctx.projectDir) return [];
    const { listAnnotations } = await import('../../../core/src/project/annotations/index.js');
    const anns = listAnnotations(ctx.projectDir, { sceneSlug, limit: 50 } as any);
    return Array.isArray(anns) ? anns : [];
  } catch {
    return [];
  }
}

function loadTokens(scene: any): any[] {
  try {
    const idx = scene?.tokenIndex;
    if (!idx) return [];
    // TokenIndex may already be an array or a map-like. Be defensive.
    if (Array.isArray(idx)) return idx;
    if (Array.isArray(idx.tokens)) return idx.tokens;
    return [];
  } catch {
    return [];
  }
}
