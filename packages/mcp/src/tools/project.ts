/**
 * reframe_project — Project management for persistent .reframe directories.
 *
 * Actions: init, open, save, load, list, status, save_design.
 * When a project is open, produce/workflow auto-save scenes.
 */

import { z } from 'zod';
import {
  initProject,
  loadProject,
  projectExists,
  saveScene,
  loadSceneFromProject,
  listScenes,
  deleteScene,
  saveDesignSystem,
  loadDesignSystem,
  readSceneJson,
  listRegisteredBrands,
  setActiveBrand,
  loadBrandFromProject,
  loadSourceHtml,
} from '../../../core/src/project/io.js';
import { readOps, clearOps, historyFilePath } from '../../../core/src/project/history.js';
import {
  generateVariant,
  listVariants,
  refreshVariants,
} from '../../../core/src/project/variants.js';
import {
  saveMacro,
  loadMacro,
  listMacros,
  deleteMacro,
  applyMacro,
} from '../../../core/src/project/macros.js';
import {
  listComponents,
  loadComponentMaster,
  deleteComponent,
} from '../../../core/src/project/components.js';
import type { Operation } from '../../../core/src/ops/types.js';
import type { ProjectManifest, SceneEntry } from '../../../core/src/project/types.js';
import { detectBrandDrift } from '../../../core/src/project/types.js';
import { parseDesignMd } from '../../../core/src/design-system/index.js';
import { serializeGraph } from '../../../core/src/serialize.js';
import {
  getScene,
  storeScene,
  resaveScene,
  listScenes as listSessionScenes,
  setProjectDir as setStoreProjectDir,
} from '../store.js';
import { getSession } from '../session.js';
import { emitProjectEvent } from '../events.js';
import { resolve, normalize, relative } from 'path';

/**
 * Resolve and optionally constrain project dir to cwd (set REFRAME_PROJECT_ALLOW_ABSOLUTE=1 to skip).
 */
export function normalizeTrustedProjectDir(raw: string): string {
  if (typeof raw !== 'string' || raw.includes('\0')) {
    throw new Error('Invalid project directory path');
  }
  const dir = resolve(normalize(raw.trim()));
  if (!dir || dir.length > 4096) {
    throw new Error('Invalid project directory path');
  }
  const allowAbsolute =
    process.env.REFRAME_PROJECT_ALLOW_ABSOLUTE === '1' ||
    process.env.REFRAME_PROJECT_ALLOW_ABSOLUTE === 'true';
  if (!allowAbsolute) {
    const cwd = resolve(process.cwd());
    const rel = relative(cwd, dir);
    if (rel.startsWith('..') || rel === '..') {
      throw new Error(
        'Project dir must be under the current working directory (set REFRAME_PROJECT_ALLOW_ABSOLUTE=1 to allow other paths).',
      );
    }
  }
  return dir;
}

// ─── Session project state ───────────────────────────────────

let _projectDir: string | null = null;

export function getProjectDir(): string | null {
  return _projectDir;
}

/** Canonical workspace root for session store + `reframe_project` (always use this from scripts/tools). */
export function setProjectDir(dir: string | null): void {
  _projectDir = dir;
  setStoreProjectDir(dir);
}

// ─── Auto-save helper (called from produce/workflow after mutation) ───

export function autoSaveScene(
  sceneId: string,
  _graph?: any,
  _rootId?: string,
  _timeline?: any,
): void {
  // storeScene() now auto-saves on creation. This is kept for
  // post-mutation re-saves (after audit fix loops).
  resaveScene(sceneId);
}

// ─── Schema ──────────────────────────────────────────────────

export const projectInputSchema = {
  action: z
    .enum([
      'init', 'open', 'save', 'load', 'list', 'status', 'delete', 'save_design',
      'list_brands', 'set_active_brand', 'show_source',
      'history', 'history_clear',
      'add_variant', 'list_variants', 'refresh_variants',
      'save_macro', 'list_macros', 'apply_macro', 'delete_macro',
      'list_components', 'show_component', 'delete_component',
    ])
    .describe(
      'Action: init, open, save, load, list, status, delete, save_design, list_brands, set_active_brand, show_source, history, history_clear, add_variant, list_variants, refresh_variants, save_macro, list_macros, apply_macro, delete_macro, list_components (show every component master stored in the project), show_component (return a component master with its slots + revisions), delete_component (remove a component master from disk — scenes that reference it by name will show as missing on next load)',
    ),
  dir: z.string().optional().describe('Project directory (required for init/open)'),
  name: z.string().optional().describe('Project name (for init) OR macro name (for save_macro/apply_macro/delete_macro)'),
  sceneId: z.string().optional().describe('Scene ID — session ID for save, project slug for load/delete/show_source/history/history_clear/add_variant/list_variants/refresh_variants/apply_macro'),
  tags: z.array(z.string()).optional().describe('Tags for the scene (for save)'),
  designMd: z.string().optional().describe('DESIGN.md content (for save_design)'),
  brand: z.string().optional().describe('Brand slug (for set_active_brand)'),
  viewport: z.object({
    name: z.string().describe('Viewport label used as the variant filename suffix (e.g. "mobile", "tablet")'),
    width: z.number().describe('Target width in px'),
    height: z.number().describe('Target height in px'),
  }).optional().describe('Target viewport (for add_variant)'),
  macroOps: z.array(z.any()).optional().describe('Op templates for save_macro. Each op may use $role:<role>[<index>?] as nodeId for placeholders.'),
  description: z.string().optional().describe('Human description (for save_macro)'),
};

// ─── Handler ─────────────────────────────────────────────────

export async function handleProject(input: {
  action: string;
  dir?: string;
  name?: string;
  sceneId?: string;
  tags?: string[];
  designMd?: string;
  brand?: string;
  viewport?: { name: string; width: number; height: number };
  macroOps?: any[];
  description?: string;
}) {
  try {
    switch (input.action) {
      case 'init': return doInit(input);
      case 'open': return doOpen(input);
      case 'save': return doSave(input);
      case 'load': return doLoad(input);
      case 'list': return doList();
      case 'status': return doStatus();
      case 'delete': return doDelete(input);
      case 'save_design': return doSaveDesign(input);
      case 'list_brands': return doListBrands();
      case 'set_active_brand': return doSetActiveBrand(input);
      case 'show_source': return doShowSource(input);
      case 'history': return doHistory(input);
      case 'history_clear': return doHistoryClear(input);
      case 'add_variant': return await doAddVariant(input);
      case 'list_variants': return doListVariants(input);
      case 'refresh_variants': return await doRefreshVariants(input);
      case 'save_macro': return doSaveMacro(input);
      case 'list_macros': return doListMacros();
      case 'apply_macro': return doApplyMacro(input);
      case 'delete_macro': return doDeleteMacro(input);
      case 'list_components': return doListComponents();
      case 'show_component': return doShowComponent(input);
      case 'delete_component': return doDeleteComponent(input);
      case 'render_project': return doRenderProject();
      case 'project_graph': return doProjectGraph();
      default:
        return err(
          `Unknown action "${input.action}". Use: init, open, save, load, list, status, delete, save_design, list_brands, set_active_brand, show_source, history, history_clear, add_variant, list_variants, refresh_variants, save_macro, list_macros, apply_macro, delete_macro, list_components, show_component, delete_component, render_project, project_graph`,
        );
    }
  } catch (e: any) {
    return err(e.message);
  }
}

// ─── Actions ─────────────────────────────────────────────────

function doInit(input: { dir?: string; name?: string }) {
  if (!input.dir) return err('dir is required for init');
  const name = input.name ?? 'Untitled Project';

  let projectDir: string;
  try {
    projectDir = normalizeTrustedProjectDir(input.dir);
  } catch (e: any) {
    return err(e.message);
  }

  if (projectExists(projectDir)) {
    return err(`Project already exists at ${projectDir}. Use "open" instead.`);
  }

  const manifest = initProject(projectDir, name);
  setProjectDir(projectDir);

  emitProjectEvent({ type: 'project:opened', manifest });

  return ok([
    `Project "${name}" created at ${projectDir}/.reframe/`,
    `Scenes will auto-save to this project.`,
    '',
    `Manifest: ${JSON.stringify(manifest, null, 2)}`,
  ].join('\n'));
}

function doOpen(input: { dir?: string }) {
  if (!input.dir) return err('dir is required for open');

  let projectDir: string;
  try {
    projectDir = normalizeTrustedProjectDir(input.dir);
  } catch (e: any) {
    return err(e.message);
  }

  const manifest = loadProject(projectDir);
  setProjectDir(projectDir);

  emitProjectEvent({ type: 'project:opened', manifest });

  const sceneList = manifest.scenes.map(s =>
    `  ${s.id} — "${s.name}" ${s.width}×${s.height}${s.tags?.length ? ` [${s.tags.join(', ')}]` : ''}`
  ).join('\n');

  return ok([
    `Opened project "${manifest.name}" (${manifest.scenes.length} scenes)`,
    manifest.designSystem ? `Design system: ${manifest.designSystem}` : 'No design system',
    '',
    sceneList || '  (no scenes yet)',
    '',
    'Scenes from produce/workflow will auto-save here.',
  ].join('\n'));
}

function doSave(input: { sceneId?: string; tags?: string[] }) {
  if (!_projectDir) return err('No project open. Use "init" or "open" first.');
  if (!input.sceneId) return err('sceneId is required for save');

  const stored = getScene(input.sceneId);
  if (!stored) return err(`Session scene "${input.sceneId}" not found`);

  const entry = saveScene(_projectDir, stored.graph, stored.rootId, {
    slug: stored.slug,
    name: stored.name,
    nodes: stored.nodeCount,
    tags: input.tags,
    timeline: stored.timeline,
    group: (stored as any).group,
    source: (stored as any).sourceFile,
  });

  emitProjectEvent({ type: 'scene:saved', sceneId: input.sceneId, entry });

  return ok([
    `Saved "${entry.name}" ${entry.width}×${entry.height} → ${entry.file}`,
    entry.tags?.length ? `Tags: ${entry.tags.join(', ')}` : '',
  ].filter(Boolean).join('\n'));
}

function doLoad(input: { sceneId?: string }) {
  if (!_projectDir) return err('No project open. Use "init" or "open" first.');
  if (!input.sceneId) return err('sceneId is required for load');

  const { graph, rootId, timeline, entry } = loadSceneFromProject(_projectDir, input.sceneId);

  // Store in session for use by other tools
  const sessionId = storeScene(graph, rootId, timeline, { slug: entry.slug ?? entry.id, name: entry.name });
  const slug = getScene(sessionId)?.slug ?? entry.slug ?? entry.id;

  return ok([
    `Loaded "${entry.name}" ${entry.width}×${entry.height} → **${sessionId}** (${slug})`,
    `Use sceneId: "${sessionId}" or slug: "${slug}" in subsequent tool calls.`,
  ].join('\n'));
}

function doList() {
  if (!_projectDir) return err('No project open. Use "init" or "open" first.');

  const manifest = loadProject(_projectDir);
  const scenes = listScenes(_projectDir);
  if (scenes.length === 0) {
    return ok('No scenes in project. Use reframe_compile or save a scene.');
  }

  // Group scenes for display
  const grouped = new Map<string, typeof scenes>();
  for (const s of scenes) {
    const group = s.group ?? '';
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group)!.push(s);
  }

  const lines: string[] = [`${scenes.length} scene(s):`];
  for (const [group, groupScenes] of grouped) {
    if (group) lines.push(`\n  [${group}]`);
    for (const s of groupScenes) {
      const prefix = group ? '    ' : '  ';
      const parts: string[] = [];
      parts.push(`${s.id} — "${s.name}" ${s.width}×${s.height}`);
      if (typeof s.revision === 'number') parts.push(`rev${s.revision}`);
      if (typeof s.nodes === 'number') parts.push(`${s.nodes} nodes`);
      if (s.brand) parts.push(`brand=${s.brand}`);
      if (s.tags?.length) parts.push(`[${s.tags.join(', ')}]`);
      if (s.source) parts.push(`← ${s.source}`);
      const drift = detectBrandDrift(manifest, s);
      if (drift) parts.push(`⚠ brand drifted (${drift.recorded.slice(0, 4)}→${drift.current.slice(0, 4)})`);
      lines.push(`${prefix}${parts.join(' · ')}`);
    }
  }

  return ok(lines.join('\n'));
}

function doStatus() {
  const lines: string[] = [];

  if (_projectDir) {
    const manifest = loadProject(_projectDir);
    lines.push(`Project: "${manifest.name}" at ${_projectDir}`);
    const diskScenes = listScenes(_projectDir);
    lines.push(`Scenes on disk: ${diskScenes.length}`);
    const brandCount = Object.keys(manifest.brands ?? {}).length;
    if (brandCount > 0) {
      lines.push(`Brands registered: ${brandCount}${manifest.activeBrand ? ` (active: ${manifest.activeBrand})` : ''}`);
    } else if (manifest.designSystem) {
      lines.push(`Design system: ${manifest.designSystem} (legacy single-file)`);
    } else {
      lines.push('Design system: none');
    }
    // Surface drift early so agents see the warning at the top of status.
    const drifted = diskScenes
      .map(s => ({ s, drift: detectBrandDrift(manifest, s) }))
      .filter(x => x.drift !== null);
    if (drifted.length > 0) {
      lines.push(`⚠ ${drifted.length} scene(s) with brand drift — re-compile to refresh`);
      for (const { s, drift } of drifted) {
        lines.push(`  ${s.slug ?? s.id}: recorded=${drift!.recorded} current=${drift!.current}`);
      }
    }
    lines.push(`Last updated: ${manifest.updated}`);
  } else {
    lines.push('No project open.');
  }

  const sessionScenes = listSessionScenes();
  lines.push('');
  lines.push(`Session scenes: ${sessionScenes.length}`);
  for (const s of sessionScenes) {
    lines.push(`  ${s.id} — "${s.name}" ${s.size} (${s.nodes} nodes, ${s.age})`);
  }

  return ok(lines.join('\n'));
}

function doListBrands() {
  if (!_projectDir) return err('No project open. Use "init" or "open" first.');
  const manifest = loadProject(_projectDir);
  const brands = listRegisteredBrands(_projectDir);
  if (brands.length === 0) {
    return ok([
      'No brands registered in this project.',
      'Use reframe_design({ action: "extract", brand: "<slug>" }) to fetch + register a brand.',
    ].join('\n'));
  }
  const lines = [`${brands.length} brand(s) registered:`];
  for (const b of brands) {
    const active = manifest.activeBrand === b.slug ? ' ← active' : '';
    const label = b.label ? ` "${b.label}"` : '';
    lines.push(`  ${b.slug}${label} · hash=${b.hash} · ${b.path}${active}`);
  }
  return ok(lines.join('\n'));
}

function doSetActiveBrand(input: { brand?: string }) {
  if (!_projectDir) return err('No project open. Use "init" or "open" first.');
  if (!input.brand) return err('brand slug is required for set_active_brand');
  const entry = setActiveBrand(_projectDir, input.brand);
  // Emit a generic project:updated event so Studio / session listeners can
  // refresh their view — set_active_brand can change brand compliance results
  // for every scene without touching a single node.
  emitProjectEvent({ type: 'project:updated', manifest: loadProject(_projectDir) });
  return ok(`Active brand → "${entry.slug}" (${entry.path}, hash=${entry.hash})`);
}

function doHistory(input: { sceneId?: string }) {
  if (!_projectDir) return err('No project open. Use "init" or "open" first.');
  if (!input.sceneId) return err('sceneId (project slug) is required for history');

  // Accept either the project slug or a session id that happens to be bound
  // to a project slug. We resolve to the slug so the history file lookup is
  // deterministic regardless of which id the caller held.
  const manifest = loadProject(_projectDir);
  const entry = manifest.scenes.find(
    s => s.slug === input.sceneId || s.id === input.sceneId,
  );
  const slug = entry?.slug ?? input.sceneId;

  const ops = readOps(_projectDir, slug);
  const file = historyFilePath(_projectDir, slug);
  if (ops.length === 0) {
    return ok([
      `No history for "${slug}".`,
      `(expected at ${file})`,
      entry
        ? `Scene is known (rev${entry.revision ?? '?'}) but has not been edited via reframe_edit since compile.`
        : `Scene not found in manifest — slug may be wrong.`,
    ].join('\n'));
  }
  const lines = [`History for "${slug}" (${ops.length} op(s), file: ${file}):`];
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i] as any;
    const label = o.label ? ` — ${o.label}` : '';
    const target = o.nodeId ? ` on ${o.nodeId}` : '';
    const detail =
      o.type === 'setProps' ? `(${Object.keys(o.props ?? {}).join(', ')})` :
      o.type === 'bindToken' ? `(${o.property}=${o.token})` :
      o.type === 'autoBindTokens' ? `(tol=${o.colorTolerance ?? 30})` :
      o.type === 'addState' ? `(${o.state})` :
      o.type === 'setResponsive' ? `(maxWidth=${o.maxWidth})` :
      '';
    lines.push(`  ${i + 1}. [${o.type}]${target} ${detail}${label}`);
  }
  lines.push('');
  lines.push('These ops will be replayed on the next reframe_compile for this scene.');
  return ok(lines.join('\n'));
}

function doHistoryClear(input: { sceneId?: string }) {
  if (!_projectDir) return err('No project open. Use "init" or "open" first.');
  if (!input.sceneId) return err('sceneId (project slug) is required for history_clear');

  const manifest = loadProject(_projectDir);
  const entry = manifest.scenes.find(
    s => s.slug === input.sceneId || s.id === input.sceneId,
  );
  const slug = entry?.slug ?? input.sceneId;
  const before = readOps(_projectDir, slug).length;
  clearOps(_projectDir, slug);
  return ok(
    before === 0
      ? `No history to clear for "${slug}".`
      : `Cleared ${before} op(s) from history for "${slug}". Next reframe_compile will produce a pristine scene.`,
  );
}

// ─── Phase 4: Variants ──────────────────────────────────────

/**
 * Resolve the active design system for variant generation. Priority:
 *   1. legacy single-file design.md (loadDesignSystem)
 *   2. active brand from the registry
 *   3. none — adapt runs without brand-aware classification
 *
 * We DO NOT accept a designMd from the caller here on purpose: variant
 * generation happens on a scene-by-scene basis and must stay consistent
 * with whatever the base scene was compiled against. Forcing callers to
 * pass design data would break the "one command, one variant" ergonomic.
 */
function resolveDesignSystemForVariants() {
  if (!_projectDir) return undefined;
  try {
    const md = loadDesignSystem(_projectDir);
    if (md) return parseDesignMd(md);
  } catch { /* ignore */ }
  return undefined;
}

async function doAddVariant(input: {
  sceneId?: string;
  viewport?: { name: string; width: number; height: number };
}) {
  if (!_projectDir) return err('No project open. Use "init" or "open" first.');
  if (!input.sceneId) return err('sceneId (base scene slug) is required for add_variant');
  if (!input.viewport) return err('viewport (name + width + height) is required for add_variant');
  const { name, width, height } = input.viewport;
  if (!name || typeof width !== 'number' || typeof height !== 'number') {
    return err('viewport must have { name, width, height }');
  }

  const manifest = loadProject(_projectDir);
  const baseEntry = manifest.scenes.find(
    s => (s.slug ?? s.id) === input.sceneId && !s.variantOf,
  );
  if (!baseEntry) {
    return err(`Base scene "${input.sceneId}" not found (or is itself a variant).`);
  }

  const ds = resolveDesignSystemForVariants();
  const entry = await generateVariant(
    _projectDir,
    baseEntry.slug ?? baseEntry.id,
    { name, width, height },
    { designSystem: ds },
  );
  emitProjectEvent({ type: 'scene:saved', sceneId: entry.slug ?? entry.id, entry });

  return ok([
    `Variant "${entry.slug}" created ${entry.width}×${entry.height} from base "${input.sceneId}"`,
    `File: ${entry.file}`,
    `Viewport: ${entry.viewport?.name}`,
  ].join('\n'));
}

function doListVariants(input: { sceneId?: string }) {
  if (!_projectDir) return err('No project open. Use "init" or "open" first.');
  if (!input.sceneId) return err('sceneId (base scene slug) is required for list_variants');

  const variants = listVariants(_projectDir, input.sceneId);
  if (variants.length === 0) {
    return ok(`No variants for base "${input.sceneId}". Use add_variant to create one.`);
  }
  const lines = [`${variants.length} variant(s) of "${input.sceneId}":`];
  for (const v of variants) {
    const vp = v.viewport ? ` [${v.viewport.name} ${v.viewport.width}×${v.viewport.height}]` : '';
    const rev = v.revision != null ? ` rev${v.revision}` : '';
    lines.push(`  ${v.slug ?? v.id}${vp}${rev} — ${v.nodes ?? '?'} nodes`);
  }
  return ok(lines.join('\n'));
}

async function doRefreshVariants(input: { sceneId?: string }) {
  if (!_projectDir) return err('No project open. Use "init" or "open" first.');
  if (!input.sceneId) return err('sceneId (base scene slug) is required for refresh_variants');

  const ds = resolveDesignSystemForVariants();
  const result = await refreshVariants(_projectDir, input.sceneId, { designSystem: ds });
  if (result.refreshed.length === 0 && result.errors.length === 0) {
    return ok(`No variants to refresh for "${input.sceneId}".`);
  }
  const lines: string[] = [`Refreshed ${result.refreshed.length} variant(s) of "${input.sceneId}":`];
  for (const v of result.refreshed) {
    lines.push(`  ✓ ${v.slug ?? v.id} ${v.width}×${v.height} rev${v.revision ?? '?'}`);
  }
  if (result.errors.length > 0) {
    lines.push('');
    lines.push(`${result.errors.length} error(s):`);
    for (const e of result.errors) lines.push(`  ✗ ${e.slug}: ${e.error}`);
  }
  return ok(lines.join('\n'));
}

// ─── Phase 5: Macros ──────────────────────────────────────

function doSaveMacro(input: { name?: string; macroOps?: any[]; description?: string }) {
  if (!_projectDir) return err('No project open. Use "init" or "open" first.');
  if (!input.name) return err('name is required for save_macro');
  if (!Array.isArray(input.macroOps) || input.macroOps.length === 0) {
    return err('macroOps (non-empty array of op templates) is required for save_macro');
  }
  const ops = input.macroOps as Operation[];
  const file = saveMacro(_projectDir, input.name, ops, input.description);
  return ok([
    `Macro "${file.name}" saved with ${file.ops.length} op template(s).`,
    input.description ? `Description: ${input.description}` : '',
    'Apply with: reframe_project({action:"apply_macro", name:"<macro>", sceneId:"<scene>"})',
  ].filter(Boolean).join('\n'));
}

function doListMacros() {
  if (!_projectDir) return err('No project open. Use "init" or "open" first.');
  const macros = listMacros(_projectDir);
  if (macros.length === 0) {
    return ok('No macros registered. Use save_macro to create one.');
  }
  const lines = [`${macros.length} macro(s):`];
  for (const m of macros) {
    const desc = m.description ? ` — ${m.description}` : '';
    lines.push(`  ${m.name}${desc} (${m.ops.length} op${m.ops.length === 1 ? '' : 's'})`);
  }
  return ok(lines.join('\n'));
}

function doApplyMacro(input: { name?: string; sceneId?: string }) {
  if (!_projectDir) return err('No project open. Use "init" or "open" first.');
  if (!input.name) return err('name (macro name) is required for apply_macro');
  if (!input.sceneId) return err('sceneId (target scene slug) is required for apply_macro');

  // Resolve the scene slug — callers may pass a session id, so fall back to
  // the manifest lookup we already use elsewhere.
  const manifest = loadProject(_projectDir);
  const entry = manifest.scenes.find(
    s => (s.slug ?? s.id) === input.sceneId || s.id === input.sceneId,
  );
  const slug = entry?.slug ?? input.sceneId;

  const result = applyMacro(_projectDir, slug, input.name);
  const lines: string[] = [];
  lines.push(`Macro "${input.name}" → scene "${slug}": appended ${result.appendedOps.length} op(s).`);
  if (result.skipped.length > 0) {
    lines.push(`Skipped ${result.skipped.length} template(s):`);
    for (const s of result.skipped) {
      lines.push(`  • ${s.reason}`);
    }
  }
  lines.push('');
  lines.push('Run reframe_compile to replay the appended ops and refresh variants.');
  return ok(lines.join('\n'));
}

function doDeleteMacro(input: { name?: string }) {
  if (!_projectDir) return err('No project open. Use "init" or "open" first.');
  if (!input.name) return err('name is required for delete_macro');
  const ok_ = deleteMacro(_projectDir, input.name);
  return ok_
    ? ok(`Deleted macro "${input.name}".`)
    : err(`Macro "${input.name}" not found.`);
}

// ─── Phase 6: Components ──────────────────────────────────

function doListComponents() {
  if (!_projectDir) return err('No project open. Use "init" or "open" first.');
  const components = listComponents(_projectDir);
  if (components.length === 0) {
    return ok([
      'No components registered in this project.',
      'Extract one via reframe_edit with the extractComponent op,',
      'or author a scene with data-reframe-component="Name" on any element.',
    ].join('\n'));
  }
  const lines = [`${components.length} component(s):`];
  for (const c of components) {
    const slots = c.slots.length > 0 ? ` [slots: ${c.slots.join(', ')}]` : '';
    const desc = c.description ? ` — ${c.description}` : '';
    lines.push(`  ${c.name} (${c.slug}) rev${c.revision}${slots}${desc}`);
  }
  return ok(lines.join('\n'));
}

function doShowComponent(input: { name?: string }) {
  if (!_projectDir) return err('No project open. Use "init" or "open" first.');
  if (!input.name) return err('name is required for show_component');
  const comp = loadComponentMaster(_projectDir, input.name);
  if (!comp) return err(`Component "${input.name}" not found`);
  const lines: string[] = [
    `Component "${comp.name}" (${comp.slug})`,
    `Revision: ${comp.revision}`,
    `Updated: ${comp.updated}`,
  ];
  if (comp.description) lines.push(`Description: ${comp.description}`);
  if (comp.slots && comp.slots.length > 0) lines.push(`Slots: ${comp.slots.join(', ')}`);
  if (comp.propertyDefinitions && comp.propertyDefinitions.length > 0) {
    lines.push('Property definitions:');
    for (const pd of comp.propertyDefinitions) {
      lines.push(`  ${pd.name} (${pd.type}) default=${pd.defaultValue}`);
    }
  }
  lines.push('');
  lines.push('Master subtree (truncated):');
  const rootName = (comp.root as any).name ?? (comp.root as any).type ?? 'root';
  const childCount = Array.isArray((comp.root as any).children) ? (comp.root as any).children.length : 0;
  lines.push(`  ${rootName}: ${childCount} direct children`);
  return ok(lines.join('\n'));
}

function doDeleteComponent(input: { name?: string }) {
  if (!_projectDir) return err('No project open. Use "init" or "open" first.');
  if (!input.name) return err('name is required for delete_component');
  const ok_ = deleteComponent(_projectDir, input.name);
  return ok_
    ? ok([
        `Deleted component "${input.name}".`,
        'Any scene that references this component by name will show "missing master" on the next load.',
        'Re-extract the subtree or remove the instance via reframe_edit unlinkInstance.',
      ].join('\n'))
    : err(`Component "${input.name}" not found.`);
}

function doShowSource(input: { sceneId?: string }) {
  if (!_projectDir) return err('No project open. Use "init" or "open" first.');
  if (!input.sceneId) return err('sceneId (project slug) is required for show_source');

  // Resolve the scene so we can look up its recorded source path.
  const manifest = loadProject(_projectDir);
  const entry = manifest.scenes.find(
    s => s.slug === input.sceneId || s.id === input.sceneId,
  );
  if (!entry) {
    const known = manifest.scenes.map(s => s.slug ?? s.id).join(', ') || 'none';
    return err(`Scene "${input.sceneId}" not found. Known: ${known}`);
  }
  // Prefer the explicit source path recorded on the entry, fall back to slug.
  const locator = entry.source ?? entry.slug ?? entry.id;
  const content = loadSourceHtml(_projectDir, locator);
  if (!content) {
    return err(
      `No source HTML on disk for "${entry.slug ?? entry.id}". Recompile with reframe_compile({html:...}) to persist source.`,
    );
  }
  return ok([
    `Source HTML for "${entry.name}" (${entry.slug ?? entry.id}, rev${entry.revision ?? '?'}):`,
    `Path: ${entry.source ?? `(derived from slug)`}`,
    `Size: ${content.length} chars`,
    '',
    '```html',
    content,
    '```',
  ].join('\n'));
}

function doDelete(input: { sceneId?: string }) {
  if (!_projectDir) return err('No project open. Use "init" or "open" first.');
  if (!input.sceneId) return err('sceneId is required for delete');

  const deleted = deleteScene(_projectDir, input.sceneId);
  if (!deleted) return err(`Scene "${input.sceneId}" not found in project`);

  emitProjectEvent({ type: 'scene:deleted', sceneId: input.sceneId });

  return ok(`Deleted scene "${input.sceneId}" from project.`);
}

function doSaveDesign(input: { designMd?: string }) {
  if (!_projectDir) return err('No project open. Use "init" or "open" first.');
  if (!input.designMd) return err('designMd content is required for save_design');

  const filePath = saveDesignSystem(_projectDir, input.designMd);

  emitProjectEvent({ type: 'design-system:updated', path: filePath });

  return ok(`Design system saved to ${filePath}`);
}

// ─── Project-as-INode ───────────────────────────────────────

function doRenderProject() {
  if (!_projectDir) return err('No project open.');
  const { loadProjectGraph } = require('../../../core/src/project/io.js');
  const pg = loadProjectGraph(_projectDir);
  const scenes = pg.listSceneRefs();
  const brands = pg.listBrands();

  const lines: string[] = [];
  lines.push(`# Project: ${pg.name}`);
  lines.push(`Active brand: ${pg.activeBrand ?? 'none'}`);
  lines.push(`Scenes: ${scenes.length} | Brands: ${brands.length}`);
  lines.push('');

  if (brands.length > 0) {
    lines.push('## Brands');
    for (const b of brands) {
      lines.push(`- **${b.slug}** (hash: ${b.hash.slice(0, 8)})${b.label ? ` — ${b.label}` : ''}`);
    }
    lines.push('');
  }

  if (scenes.length > 0) {
    lines.push('## Scenes');
    for (const s of scenes) {
      const variant = s.variantOf ? ` (variant of ${s.variantOf})` : '';
      const brand = s.brand ? ` [${s.brand}]` : '';
      lines.push(`- **${s.name}** (${s.slug}) — ${s.width}×${s.height}, ${s.nodes ?? '?'} nodes, rev ${s.revision ?? 1}${brand}${variant}`);
    }
    lines.push('');
  }

  lines.push('## Project Graph');
  lines.push(`Root node: ${pg.rootId}`);
  lines.push(`Total graph nodes: ${pg.graph.getAllNodes().length}`);

  return ok(lines.join('\n'));
}

function doProjectGraph() {
  if (!_projectDir) return err('No project open.');
  const { loadProjectGraph } = require('../../../core/src/project/io.js');
  const pg = loadProjectGraph(_projectDir);
  const json = pg.serialize();
  return {
    content: [
      { type: 'text' as const, text: `Project graph for "${pg.name}" — ${pg.graph.getAllNodes().length} nodes in INode space.` },
      { type: 'text' as const, text: JSON.stringify(json, null, 2) },
    ],
  };
}

// ─── Helpers ─────────────────────────────────────────────────

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function err(text: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${text}` }] };
}
