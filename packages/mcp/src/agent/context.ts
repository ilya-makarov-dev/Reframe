/**
 * Build the design-context preamble injected before the user's prompt
 * when spawning `claude -p`. Without this preamble, claude has no idea
 * it's running inside reframe — it sees an isolated user message and
 * answers in a vacuum (e.g. "header" → git commit header).
 *
 * The preamble teaches claude:
 *   1. It's the agent inside an open reframe session
 *   2. Which scene the user is currently looking at
 *   3. The active brand (so it pulls the right DESIGN.md)
 *   4. The reframe pipeline (compile/inspect/edit/export)
 *   5. The list of all scenes available in the session
 *
 * We deliberately keep it short — claude already has the MCP server's
 * built-in instructions (see src/instructions.ts) attached as system
 * prompt for the reframe MCP. This preamble is the *runtime* context.
 */

import { listScenes, getScene, getWorkspaceRoot } from '../store.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface ContextOptions {
  /** Currently selected scene in the UI (session id like "s2" or slug). */
  activeSceneId?: string;
  /** When true, include a short pipeline reminder. Default true. */
  includePipelineHint?: boolean;
}

/**
 * Assemble the preamble. Returns a string that should be prepended to
 * the user's raw prompt with a clear separator.
 */
export function buildAgentPreamble(opts: ContextOptions = {}): string {
  const lines: string[] = [];

  lines.push('You are the agent inside an open reframe design session.');
  lines.push('');

  // ── Active scene ──
  if (opts.activeSceneId) {
    const scene = getScene(opts.activeSceneId);
    if (scene) {
      lines.push(
        `Active scene: id=${getSceneId(scene)} slug="${scene.slug}" name="${scene.name}" ` +
        `size=${scene.width}×${scene.height} nodes=${scene.nodeCount}` +
        (scene.brand ? ` brand=${scene.brand}` : ''),
      );
    }
  }

  // ── Other scenes in session ──
  const all = listScenes();
  if (all.length > 0) {
    const others = opts.activeSceneId
      ? all.filter((s) => s.id !== opts.activeSceneId && s.slug !== opts.activeSceneId)
      : all;
    if (others.length > 0) {
      const list = others.slice(0, 10).map((s) => `${s.id}/${s.slug}`).join(', ');
      lines.push(`Other scenes available: ${list}${others.length > 10 ? ` (+${others.length - 10} more)` : ''}`);
    }
  }

  // ── Active brand from project manifest ──
  const activeBrand = readActiveBrand();
  if (activeBrand) {
    lines.push(`Active brand: ${activeBrand} (use it via reframe_design extract → reframe_compile)`);
  }

  // ── Pipeline reminder ──
  if (opts.includePipelineHint !== false) {
    lines.push('');
    lines.push('Pipeline (use the reframe MCP tools available to you):');
    lines.push('  - reframe_inspect → review the active scene tree + audit issues');
    lines.push('  - reframe_compile → write fresh HTML for a NEW design');
    lines.push('  - reframe_edit    → tweak nodes on existing scene (single ops or full HTML rewrite via edit op "update")');
    lines.push('  - reframe_export  → produce html/react/svg/png/pdf');
    lines.push('');
    lines.push('When the user asks for a small visual change, prefer reframe_edit on the active scene.');
    lines.push('When they describe a new layout or section, write fresh HTML and reframe_compile.');
    lines.push('Always inspect first if you do not already know the structure.');
    lines.push('Be concise in your text replies — the user sees your tool calls live.');
  }

  lines.push('');
  lines.push('---');
  lines.push('User says:');
  lines.push('');

  return lines.join('\n');
}

// ─── Helpers ───────────────────────────────────────────────

function getSceneId(stored: { graph: any; rootId: string }): string {
  // listScenes returns id, but getScene doesn't expose it directly. We
  // walk the listing to find a matching graph reference.
  const all = listScenes();
  for (const s of all) {
    const got = getScene(s.id);
    if (got && got.graph === stored.graph && got.rootId === stored.rootId) return s.id;
  }
  return '?';
}

function readActiveBrand(): string | null {
  try {
    const manifestPath = join(getWorkspaceRoot(), '.reframe', 'project.json');
    if (!existsSync(manifestPath)) return null;
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return typeof raw?.activeBrand === 'string' ? raw.activeBrand : null;
  } catch {
    return null;
  }
}
