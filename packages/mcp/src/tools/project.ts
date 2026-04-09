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
} from '../../../core/src/project/io.js';
import type { ProjectManifest, SceneEntry } from '../../../core/src/project/types.js';
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
    .enum(['init', 'open', 'save', 'load', 'list', 'status', 'delete', 'save_design'])
    .describe(
      'Action: init, open, save (session scene → disk), load (disk → session), list, status, delete (remove scene file from disk project only), save_design',
    ),
  dir: z.string().optional().describe('Project directory (required for init/open)'),
  name: z.string().optional().describe('Project name (for init)'),
  sceneId: z.string().optional().describe('Scene ID — session ID for save, project ID for load/delete'),
  tags: z.array(z.string()).optional().describe('Tags for the scene (for save)'),
  designMd: z.string().optional().describe('DESIGN.md content (for save_design)'),
};

// ─── Handler ─────────────────────────────────────────────────

export async function handleProject(input: {
  action: string;
  dir?: string;
  name?: string;
  sceneId?: string;
  tags?: string[];
  designMd?: string;
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
      default:
        return err(`Unknown action "${input.action}". Use: init, open, save, load, list, status, delete, save_design`);
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
      const source = s.source ? ` ← ${s.source}` : '';
      lines.push(`${prefix}${s.id} — "${s.name}" ${s.width}×${s.height}${s.tags?.length ? ` [${s.tags.join(', ')}]` : ''}${source}`);
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
    lines.push(`Design system: ${manifest.designSystem ?? 'none'}`);
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

// ─── Helpers ─────────────────────────────────────────────────

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function err(text: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${text}` }] };
}
