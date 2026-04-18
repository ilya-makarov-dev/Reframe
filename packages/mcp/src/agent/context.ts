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
  /** Optional selected node id — when present we inline its props so the
   * agent can edit directly without calling reframe_inspect. */
  activeNodeId?: string | null;
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
  let activeScene: ReturnType<typeof getScene> = undefined;
  if (opts.activeSceneId) {
    activeScene = getScene(opts.activeSceneId);
    if (activeScene) {
      lines.push(
        `Active scene: id=${getSceneId(activeScene)} slug="${activeScene.slug}" name="${activeScene.name}" ` +
        `size=${activeScene.width}×${activeScene.height} nodes=${activeScene.nodeCount}` +
        (activeScene.brand ? ` brand=${activeScene.brand}` : ''),
      );
    }
  }

  // ── Selected node snapshot ──
  // The single biggest latency win: if the user right-clicked a node,
  // give the agent that node's properties directly so it can call
  // reframe_edit immediately, skipping the expensive reframe_inspect
  // round-trip that otherwise wastes 2-5 seconds on cold MCP boot.
  if (opts.activeNodeId && activeScene?.graph) {
    const snapshot = describeNode(activeScene.graph, opts.activeNodeId);
    if (snapshot) {
      lines.push('');
      lines.push('Selected node (apply edits HERE — no need to inspect):');
      lines.push(snapshot);
    }
  }

  // ── Full project context: all scenes with name + rough status ──
  // Stitch-style "agent sees the whole project, not just one screen".
  // Lists every scene with name, slug, size, and a built-out hint from
  // node count (empty / sparse / built / dense). Agent can reason about
  // cross-scene decisions ("reuse home's hero pattern on about") without
  // calling reframe_inspect on each.
  const all = listScenes();
  if (all.length > 0) {
    lines.push('');
    lines.push('Project scenes:');
    for (const s of all) {
      const isActive = opts.activeSceneId && (s.id === opts.activeSceneId || s.slug === opts.activeSceneId);
      const marker = isActive ? '→' : ' ';
      const nodes = typeof s.nodes === 'number' ? s.nodes : 0;
      const status = nodes === 0 ? 'empty' : nodes < 10 ? 'sparse' : nodes < 50 ? 'built' : 'dense';
      lines.push(`  ${marker} ${s.slug} "${s.name}" — ${s.size}, ${nodes} nodes (${status})`);
    }
  }

  // ── Active brand: include name + first-page summary of DESIGN.md ──
  // The agent doesn't need to call reframe_design just to know what
  // brand is active. Pull the first ~600 chars of DESIGN.md (usually
  // covers Visual Atmosphere + start of Color Palette) inline.
  const brand = readActiveBrand();
  if (brand) {
    lines.push('');
    lines.push(`Active brand: ${brand}`);
    const brandSummary = readBrandSummary(brand);
    if (brandSummary) {
      lines.push('Brand summary (top of DESIGN.md, use these values):');
      lines.push('  ' + brandSummary.split('\n').join('\n  '));
    }
  }

  // ── Pipeline reminder ──
  if (opts.includePipelineHint !== false) {
    lines.push('');
    lines.push('HOW TO WORK — you are inside an interactive UI, the user is waiting:');
    lines.push('');
    lines.push('Plan first.');
    lines.push('  • Any request that takes more than ONE tool call (e.g. read brand → write HTML → compile) starts with TodoWrite listing the steps. Mark each completed as you go — the UI renders this as a live checklist, so the user sees progress.');
    lines.push('  • Skip TodoWrite ONLY for single-shot asks: one reframe_edit property tweak, a Q&A with no tools, a brand extract.');
    lines.push('');
    lines.push('Target the ACTIVE scene by default.');
    lines.push('  • The "Active scene" listed above is the canvas the user is currently looking at. Your edits MUST land there unless the user explicitly asks otherwise.');
    lines.push('  • When you call mcp__reframe__reframe_compile, pass `name` = the active scene\'s slug (e.g. if Active scene slug="imported", use `name: "imported"`). The engine treats same-slug as UPDATE, not CREATE — so the open canvas shows the result.');
    lines.push('  • Write HTML sources to `.reframe/src/<activeSlug>.html` so re-compiles stay consistent with the active scene.');
    lines.push('');
    lines.push('Create a NEW scene only on an EXPLICIT signal from the user:');
    lines.push('  • "новая страница" / "new page" / "another page" / multi-page sitemap / site-loop workflows.');
    lines.push('  • "тёмная версия" / "dark version" / "variant" / "alternative" — write a new source file like `<activeSlug>-dark.html` and compile with a new name.');
    lines.push('  • "копия" / "скопируй" / "clone" — use mcp__reframe__reframe_project action="clone" or compile with a new name.');
    lines.push('  Without such a signal, assume the user means "edit THIS canvas".');
    lines.push('');
    lines.push('Use the fastest path.');
    lines.push('  • Visual tweaks (color/spacing/text/style) on an existing node → mcp__reframe__reframe_edit op "update". No inspect first — scene context is already above.');
    lines.push('  • New sections / layouts / big rewrites on the active canvas → mcp__reframe__reframe_compile with `name` = active slug.');
    lines.push('  • Review / critique / "how does this look" → route through the reframe-critic skill.');
    lines.push('');
    lines.push('Finish with a compact summary. 2-4 lines max: what you did + 2-3 "Next steps if useful:" suggestions. No headers, no restating the prompt.');
    lines.push('');
    lines.push('ONE compile per turn. After mcp__reframe__reframe_compile returns — even with audit errors — STOP and summarize. Do NOT automatically loop into reframe_inspect → reframe_edit to fix errors. List the top 2-3 findings in your summary and let the user decide ("want me to fix those?"). Auto-fix loops feel like a hang in the UI.');
    lines.push('');
    lines.push('File I/O shortcut: any `.reframe/src/<slug>.html` file you overwrite needs a Read-before-Write (Claude Code safety). One Read of the existing file (it\'s small) unlocks the Write. Don\'t `ls` the directory first — just Read the path directly and swallow the error if missing.');
    lines.push('');
    lines.push('The 6 reframe MCP tools (callable DIRECTLY by their full prefixed name — do NOT wrap in ToolSearch, they are first-class tools):');
    lines.push('  mcp__reframe__reframe_design   — brand load/list/extract');
    lines.push('  mcp__reframe__reframe_compile  — HTML → INode scene + audit');
    lines.push('  mcp__reframe__reframe_inspect  — tree + 37-rule audit + aesthetics');
    lines.push('  mcp__reframe__reframe_edit     — ALL mutations (update/add/delete/clone/theme/vary/…)');
    lines.push('  mcp__reframe__reframe_export   — html/react/svg/png/pdf/lottie/site');
    lines.push('  mcp__reframe__reframe_project  — save/load/history/macros/brands');
    lines.push('');
    lines.push('FORBIDDEN fallbacks — if a reframe tool errors, STOP and report. Do NOT:');
    lines.push('  • curl/fetch http://localhost:4100/* — there is no REST API, the sidecar is MCP-only.');
    lines.push('  • run `node -e` / `require()` to load the MCP server manually — it is already running in another process.');
    lines.push('  • invent Bash pipelines to DIY compile/edit/export. The only supported path is the mcp__reframe__* tools above.');
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

/**
 * Build a compact one-block snapshot of a node so the agent can edit
 * it directly. Includes type, name, dimensions, fills (top-level),
 * text content (truncated), and direct children count. Skips heavy
 * fields (full strokes, effects, full subtree) — those are inferable
 * if the agent actually needs them via reframe_inspect, but for 90%
 * of edits this snapshot is enough to skip inspect entirely.
 */
function describeNode(graph: any, nodeId: string): string | null {
  try {
    const n = graph.getNode?.(nodeId);
    if (!n) return null;
    const lines: string[] = [];
    lines.push(`  id: ${nodeId}`);
    lines.push(`  type: ${n.type}${n.semanticRole ? ` (role: ${n.semanticRole})` : ''}`);
    if (n.name) lines.push(`  name: "${String(n.name).slice(0, 64)}"`);
    if (typeof n.width === 'number' && typeof n.height === 'number') {
      lines.push(`  size: ${Math.round(n.width)}×${Math.round(n.height)}`);
    }
    if (Array.isArray(n.fills) && n.fills.length > 0) {
      const summary = n.fills
        .slice(0, 2)
        .map((f: any) => describePaint(f))
        .filter(Boolean)
        .join(', ');
      if (summary) lines.push(`  fills: [${summary}]`);
    }
    if (typeof n.cornerRadius === 'number' && n.cornerRadius > 0) {
      lines.push(`  cornerRadius: ${n.cornerRadius}`);
    }
    if (n.type === 'TEXT' && typeof n.characters === 'string') {
      const text = n.characters.slice(0, 80);
      lines.push(`  text: "${text}${n.characters.length > 80 ? '\u2026' : ''}"`);
      if (n.fontSize) lines.push(`  fontSize: ${n.fontSize}${n.fontWeight ? ` weight=${n.fontWeight}` : ''}`);
    }
    if (Array.isArray(n.childIds) && n.childIds.length > 0) {
      lines.push(`  children: ${n.childIds.length}`);
    }
    return lines.join('\n');
  } catch {
    return null;
  }
}

function describePaint(p: any): string | null {
  if (!p) return null;
  if (p.type === 'SOLID' && p.color) {
    const { r, g, b, a } = p.color;
    if ([r, g, b].every((v) => typeof v === 'number')) {
      const hex = '#' + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
      return a !== undefined && a < 1 ? `${hex} α=${a.toFixed(2)}` : hex;
    }
  }
  if (p.type === 'GRADIENT_LINEAR' || p.type === 'GRADIENT_RADIAL') return p.type.toLowerCase();
  if (p.type === 'IMAGE') return 'image';
  return p.type ?? null;
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

/**
 * Pull the first ~600 chars of the active brand's DESIGN.md so the
 * agent has top-of-file context (atmosphere + color palette start)
 * without having to call reframe_design itself. We strip headings
 * lines to save tokens and keep just the substantive bullets.
 *
 * Returns null if the brand file isn't cached locally yet.
 */
function readBrandSummary(brandSlug: string): string | null {
  try {
    const candidates = [
      join(getWorkspaceRoot(), '.reframe', 'brands', `${brandSlug}.md`),
      join(getWorkspaceRoot(), '.reframe', 'brands', brandSlug, 'DESIGN.md'),
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        const raw = readFileSync(p, 'utf8');
        // Trim to ~600 chars and break at next sensible boundary.
        const slice = raw.slice(0, 600);
        const lastBreak = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n## '));
        return (lastBreak > 200 ? slice.slice(0, lastBreak) : slice).trim();
      }
    }
  } catch { /* best-effort */ }
  return null;
}
