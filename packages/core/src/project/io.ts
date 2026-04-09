/**
 * Project I/O — read/write .reframe directories.
 *
 * All paths are relative to the project root (parent of .reframe/).
 * Files:
 *   .reframe/project.json          — manifest
 *   .reframe/design.md             — optional design system
 *   .reframe/scenes/<id>.scene.json — SceneJSON v2
 *
 * Scene JSON contract: {@link ../spec/scene-envelope.ts}
 */

import * as fs from 'fs';
import * as path from 'path';
import { serializeGraph, deserializeScene, migrateSceneJSON, SERIALIZE_VERSION } from '../serialize.js';
import type { SceneGraph } from '../engine/scene-graph.js';
import type { ITimeline } from '../animation/types.js';
import type { SceneJSON } from '../serialize.js';
import {
  type ProjectManifest,
  type SceneEntry,
  PROJECT_VERSION,
  createManifest,
  createSceneEntry,
} from './types.js';
import { toSlug, uniqueSlug } from './slug.js';

// ─── Paths ───────────────────────────────────────────────────

function reframeDir(projectDir: string): string {
  return path.join(projectDir, '.reframe');
}

function manifestPath(projectDir: string): string {
  return path.join(reframeDir(projectDir), 'project.json');
}

function scenesDir(projectDir: string): string {
  return path.join(reframeDir(projectDir), 'scenes');
}

function sceneFilePath(projectDir: string, entry: SceneEntry): string {
  return path.join(reframeDir(projectDir), entry.file);
}

// ─── Init ────────────────────────────────────────────────────

/** Create a new .reframe project. Returns the manifest. */
export function initProject(projectDir: string, name: string): ProjectManifest {
  const dir = reframeDir(projectDir);
  fs.mkdirSync(path.join(dir, 'scenes'), { recursive: true });

  const manifest = createManifest(name);
  writeManifest(projectDir, manifest);
  return manifest;
}

// ─── Manifest ────────────────────────────────────────────────

/** Read and validate the project manifest. */
export function loadProject(projectDir: string): ProjectManifest {
  const p = manifestPath(projectDir);
  if (!fs.existsSync(p)) {
    throw new Error(`No reframe project at ${projectDir} — missing .reframe/project.json`);
  }
  const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
  if (!raw.version || !raw.name || !Array.isArray(raw.scenes)) {
    throw new Error(`Invalid project.json at ${p}`);
  }
  return raw as ProjectManifest;
}

/** Write manifest to disk. */
function writeManifest(projectDir: string, manifest: ProjectManifest): void {
  manifest.updated = new Date().toISOString();
  fs.writeFileSync(manifestPath(projectDir), JSON.stringify(manifest, null, 2), 'utf-8');
}

/** Check if a .reframe project exists at the given path. */
export function projectExists(projectDir: string): boolean {
  return fs.existsSync(manifestPath(projectDir));
}

// ─── Scenes ──────────────────────────────────────────────────

/** Save a scene graph to the project. Creates or updates the entry. */
export function saveScene(
  projectDir: string,
  graph: SceneGraph,
  rootId: string,
  options?: {
    slug?: string;
    name?: string;
    nodes?: number;
    tags?: string[];
    group?: string;
    source?: string;
    timeline?: ITimeline;
  },
): SceneEntry {
  const manifest = loadProject(projectDir);
  const root = graph.getNode(rootId)!;

  const name = options?.name ?? root.name ?? 'Untitled';
  const width = Math.round(root.width);
  const height = Math.round(root.height);

  // Resolve slug — use provided, or generate from name
  const existingSlugs = new Set(manifest.scenes.map(s => s.slug ?? s.id));
  const slug = options?.slug && existingSlugs.has(options.slug)
    ? options.slug  // updating existing
    : uniqueSlug(options?.slug ?? toSlug(name), existingSlugs);

  // Serialize scene to SceneJSON
  const sceneJson = serializeGraph(graph, rootId, {
    compact: true,
    timeline: options?.timeline,
  });

  // Find or create entry (check both slug and legacy id)
  let entry = findSceneEntry(manifest, slug);
  if (entry) {
    entry.name = name;
    entry.width = width;
    entry.height = height;
    entry.nodes = options?.nodes;
    entry.updated = new Date().toISOString();
    if (options?.tags) entry.tags = options.tags;
    if (options?.group) entry.group = options.group;
    if (options?.source) entry.source = options.source;
  } else {
    entry = createSceneEntry(slug, name, width, height, { nodes: options?.nodes, tags: options?.tags });
    if (options?.group) entry.group = options.group;
    if (options?.source) entry.source = options.source;
    manifest.scenes.push(entry);
  }

  // Write scene file
  const filePath = sceneFilePath(projectDir, entry);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(sceneJson, null, 2), 'utf-8');

  // Update manifest
  writeManifest(projectDir, manifest);

  return entry;
}

/** Find a scene entry by slug or legacy id. */
function findSceneEntry(manifest: ProjectManifest, idOrSlug: string): SceneEntry | undefined {
  return manifest.scenes.find(s => s.slug === idOrSlug || s.id === idOrSlug);
}

/** Load a scene from the project by slug or legacy ID. */
export function loadSceneFromProject(
  projectDir: string,
  sceneId: string,
): { graph: SceneGraph; rootId: string; timeline?: ITimeline; entry: SceneEntry } {
  const manifest = loadProject(projectDir);
  const entry = findSceneEntry(manifest, sceneId);
  if (!entry) {
    const available = manifest.scenes.map(s => `${s.slug ?? s.id} (${s.name})`).join(', ');
    throw new Error(`Scene "${sceneId}" not found. Available: ${available || 'none'}`);
  }

  const filePath = sceneFilePath(projectDir, entry);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Scene file missing: ${filePath}`);
  }

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SceneJSON;
  const migrated = migrateSceneJSON(raw);
  const { graph, rootId, timeline } = deserializeScene(migrated);
  return { graph, rootId, timeline, entry };
}

/** List all scenes in the project (only those with files on disk). */
export function listScenes(projectDir: string): SceneEntry[] {
  const manifest = loadProject(projectDir);
  return manifest.scenes.filter(s => fs.existsSync(sceneFilePath(projectDir, s)));
}

/** Delete a scene from the project by slug or legacy ID. */
export function deleteScene(projectDir: string, sceneId: string): boolean {
  const manifest = loadProject(projectDir);
  const idx = manifest.scenes.findIndex(s => s.slug === sceneId || s.id === sceneId);
  if (idx === -1) return false;

  const entry = manifest.scenes[idx];
  const filePath = sceneFilePath(projectDir, entry);

  // Remove file
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  // Remove from manifest
  manifest.scenes.splice(idx, 1);
  writeManifest(projectDir, manifest);
  return true;
}

// ─── Design System ───────────────────────────────────────────

/** Save DESIGN.md content to the project. */
export function saveDesignSystem(projectDir: string, content: string): string {
  const manifest = loadProject(projectDir);
  const relPath = 'design.md';
  const filePath = path.join(reframeDir(projectDir), relPath);

  fs.writeFileSync(filePath, content, 'utf-8');
  manifest.designSystem = relPath;
  writeManifest(projectDir, manifest);
  return filePath;
}

/** Load DESIGN.md from the project (if any). */
export function loadDesignSystem(projectDir: string): string | null {
  const manifest = loadProject(projectDir);
  if (!manifest.designSystem) return null;

  const filePath = path.join(reframeDir(projectDir), manifest.designSystem);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

// ─── Scene JSON direct access ────────────────────────────────

/** Read raw SceneJSON for a scene (for transfer without deserialization). */
export function readSceneJson(projectDir: string, sceneId: string): SceneJSON {
  const manifest = loadProject(projectDir);
  const entry = findSceneEntry(manifest, sceneId);
  if (!entry) throw new Error(`Scene "${sceneId}" not found in project`);

  const filePath = sceneFilePath(projectDir, entry);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SceneJSON;
}

/** Write raw SceneJSON for a scene (for transfer without serialization). */
export function writeSceneJson(
  projectDir: string,
  sceneId: string,
  sceneJson: SceneJSON,
  name?: string,
): SceneEntry {
  const manifest = loadProject(projectDir);
  const root = sceneJson.root;

  let entry = findSceneEntry(manifest, sceneId);
  if (entry) {
    entry.name = name ?? root.name ?? entry.name;
    entry.width = Math.round(root.width);
    entry.height = Math.round(root.height);
    entry.updated = new Date().toISOString();
  } else {
    const existingSlugs = new Set(manifest.scenes.map(s => s.slug ?? s.id));
    const slug = uniqueSlug(toSlug(name ?? root.name ?? 'Untitled'), existingSlugs);
    entry = createSceneEntry(
      slug,
      name ?? root.name ?? 'Untitled',
      Math.round(root.width),
      Math.round(root.height),
    );
    manifest.scenes.push(entry);
  }

  const filePath = sceneFilePath(projectDir, entry);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(sceneJson, null, 2), 'utf-8');
  writeManifest(projectDir, manifest);
  return entry;
}

// ─── Bulk load ──────────────────────────────────────────────

/** Load all scenes from a project at once (for session startup). */
export function loadAllScenes(projectDir: string): Array<{
  graph: SceneGraph;
  rootId: string;
  timeline?: ITimeline;
  entry: SceneEntry;
}> {
  const manifest = loadProject(projectDir);
  const results: Array<{ graph: SceneGraph; rootId: string; timeline?: ITimeline; entry: SceneEntry }> = [];

  for (const entry of manifest.scenes) {
    try {
      const filePath = sceneFilePath(projectDir, entry);
      if (!fs.existsSync(filePath)) continue;
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SceneJSON;
      const migrated = migrateSceneJSON(raw);
      const { graph, rootId, timeline } = deserializeScene(migrated);
      results.push({ graph, rootId, timeline, entry });
    } catch {
      // Skip corrupted scenes
    }
  }

  return results;
}
