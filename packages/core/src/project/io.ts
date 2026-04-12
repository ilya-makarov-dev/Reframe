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
import type { DesignSystem } from '../design-system/types.js';
import type { ReplayResult } from '../ops/types.js';
import { importFromHtml, type HtmlImportOptions } from '../importers/html.js';
import { replayHistory, clearOps } from './history.js';
// Phase 5b Bug #7: static import of variants so compileHtmlIntoProject no
// longer pays a dynamic-import cost on every compile. Node ESM handles the
// circular edge (variants.ts imports loadProject + loadSceneFromProject +
// writeManifestRaw from this file) by resolving exports lazily — top-level
// code in both modules is side-effect-free, so the cycle is inert. The
// previous `await import('./variants.js')` worked but was misdiagnosed as
// "fragile under bundlers"; it's fine, we just prefer static for clarity.
import { refreshVariants as _refreshVariants } from './variants.js';
// Phase 6: component hydration/collapse bracket every save/load so on-disk
// scenes stay normalized (INSTANCE placeholders only) while in-memory
// scenes are fully hydrated for exporters and audits.
import {
  expandInstances,
  collapseInstances,
  saveComponentMaster,
  createInstancePlaceholder,
} from './components.js';
import {
  type ProjectManifest,
  type SceneEntry,
  type BrandRegistryEntry,
  PROJECT_VERSION,
  createManifest,
  createSceneEntry,
  hashDesignMdContent,
} from './types.js';
import { toSlug, uniqueSlug } from './slug.js';
import { ProjectGraph } from './project-graph.js';

// ─── Paths ───────────────────────────────────────────────────

function reframeDir(projectDir: string): string {
  return path.join(projectDir, '.reframe');
}

function manifestPath(projectDir: string): string {
  return path.join(reframeDir(projectDir), 'project.json');
}

function projectGraphPath(projectDir: string): string {
  return path.join(reframeDir(projectDir), 'project.scene.json');
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

  // Dual-write: project as INode graph
  try {
    const pg = ProjectGraph.create(name);
    fs.writeFileSync(projectGraphPath(projectDir), JSON.stringify(pg.serialize(), null, 2), 'utf-8');
  } catch { /* best-effort — project.json is authoritative */ }

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

/** Write manifest to disk. Also syncs the project graph (dual-write). */
function writeManifest(projectDir: string, manifest: ProjectManifest): void {
  manifest.updated = new Date().toISOString();
  fs.writeFileSync(manifestPath(projectDir), JSON.stringify(manifest, null, 2), 'utf-8');

  // Dual-write: sync project.scene.json from manifest
  try {
    const pg = ProjectGraph.fromManifest(manifest);
    fs.writeFileSync(projectGraphPath(projectDir), JSON.stringify(pg.serialize(), null, 2), 'utf-8');
  } catch { /* best-effort — project.json remains authoritative */ }
}

/**
 * Public re-export of writeManifest so sibling modules (variants.ts) can
 * persist manifest changes without a circular import. Keeps the writer in a
 * single place so the ISO-date bump is applied consistently.
 */
export function writeManifestRaw(projectDir: string, manifest: ProjectManifest): void {
  writeManifest(projectDir, manifest);
}

/** Check if a .reframe project exists at the given path. */
export function projectExists(projectDir: string): boolean {
  return fs.existsSync(manifestPath(projectDir));
}

/**
 * Load the project as a ProjectGraph (INode representation).
 * Falls back to converting from project.json if project.scene.json doesn't exist.
 */
export function loadProjectGraph(projectDir: string): ProjectGraph {
  const pgPath = projectGraphPath(projectDir);
  if (fs.existsSync(pgPath)) {
    try {
      const json = JSON.parse(fs.readFileSync(pgPath, 'utf-8'));
      return ProjectGraph.deserialize(json);
    } catch { /* fall through to manifest conversion */ }
  }
  // Fallback: convert from manifest
  const manifest = loadProject(projectDir);
  return ProjectGraph.fromManifest(manifest);
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
    /** Brand slug this scene was compiled against (persisted on SceneEntry). */
    brand?: string;
    /** DESIGN.md hash at compile time — for drift detection. */
    brandHash?: string;
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

  // Phase 6: collapse hydrated instances before serialization so disk
  // state stores only placeholders (componentName + overrides). Track
  // whether anything collapsed so we can re-hydrate the live graph after
  // serialization — otherwise the caller's next read sees an empty
  // instance and breaks their edit flow.
  let hadCollapsed = 0;
  try {
    const r = collapseInstances(graph, rootId);
    hadCollapsed = r.collapsed;
  } catch { /* best-effort */ }

  // Serialize scene to SceneJSON. Timeline priority: explicit options →
  // the one attached to graph.timeline (Phase 5: set by animation ops /
  // replay). If both are absent the scene saves without animation state.
  const effectiveTimeline = options?.timeline ?? (graph.timeline as ITimeline | undefined) ?? undefined;
  const sceneJson = serializeGraph(graph, rootId, {
    compact: true,
    timeline: effectiveTimeline,
  });

  // Re-hydrate the live graph now that the on-disk snapshot is written.
  // expandInstances is cheap when instance count is low and its master
  // cache makes even 50+ instances negligible.
  if (hadCollapsed > 0) {
    try { expandInstances(graph, rootId, projectDir); } catch { /* best-effort */ }
  }

  // Find or create entry (check both slug and legacy id)
  let entry = findSceneEntry(manifest, slug);
  if (entry) {
    entry.name = name;
    entry.width = width;
    entry.height = height;
    entry.nodes = options?.nodes;
    entry.updated = new Date().toISOString();
    // Bump the revision so Studio/MCP listeners can detect this write
    // without having to diff the full graph. Starts from 1 on first save.
    entry.revision = (entry.revision ?? 0) + 1;
    if (options?.tags) entry.tags = options.tags;
    if (options?.group) entry.group = options.group;
    if (options?.source) entry.source = options.source;
    if (options?.brand !== undefined) entry.brand = options.brand;
    if (options?.brandHash !== undefined) entry.brandHash = options.brandHash;
  } else {
    entry = createSceneEntry(slug, name, width, height, { nodes: options?.nodes, tags: options?.tags });
    entry.revision = 1;
    if (options?.group) entry.group = options.group;
    if (options?.source) entry.source = options.source;
    if (options?.brand) entry.brand = options.brand;
    if (options?.brandHash) entry.brandHash = options.brandHash;
    manifest.scenes.push(entry);
  }

  // Write scene file
  const filePath = sceneFilePath(projectDir, entry);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(sceneJson, null, 2), 'utf-8');

  // Update manifest
  writeManifest(projectDir, manifest);

  // Phase 8: sweep orphaned annotations/threads for this scene. Any item
  // anchored to an INode that no longer exists in the live graph is
  // transitioned to 'orphaned' so the UI can surface it. Best-effort —
  // a broken annotation store must never break the scene save itself.
  try {
    // Defer the import so projects without annotation use (tests, CLI)
    // don't pay the cost of loading the subsystem.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { sweepOrphans } = require('./gc.js');
    sweepOrphans(projectDir, entry.slug ?? entry.id, graph, `save rev=${entry.revision}`);
  } catch { /* best-effort */ }

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
  // Phase 5: hydrate timeline onto the graph so subsequent exports/ops can
  // find it without the caller threading it through every call site.
  if (timeline) graph.timeline = timeline;
  // Phase 6: hydrate component instances — scene JSON stores placeholders
  // on disk, in-memory state is the fully expanded tree so exporters and
  // audit can walk a complete document.
  try { expandInstances(graph, rootId, projectDir); } catch { /* best-effort */ }
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
  const targetSlug = entry.slug ?? entry.id;

  // Remove file
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  // Remove any Phase 3 history log — dangling history on a deleted scene would
  // revive on next compile if someone reused the slug, which is confusing.
  try { clearOps(projectDir, targetSlug); } catch { /* best-effort */ }

  // Phase 4: cascade-delete variants of a base scene. Without this, deleting
  // "hero" would orphan "hero.mobile" / "hero.tablet" in the manifest, where
  // they'd point at a base that no longer exists. We only cascade when the
  // deleted scene is ITSELF a base (variantOf unset) — removing one variant
  // must not wipe sibling variants.
  const cascade: number[] = [];
  if (!entry.variantOf) {
    for (let i = manifest.scenes.length - 1; i >= 0; i--) {
      if (i === idx) continue;
      const s = manifest.scenes[i];
      if (s.variantOf === targetSlug) {
        const variantPath = sceneFilePath(projectDir, s);
        if (fs.existsSync(variantPath)) {
          try { fs.unlinkSync(variantPath); } catch { /* best-effort */ }
        }
        cascade.push(i);
      }
    }
  }

  // Remove from manifest. Splice higher indices first so earlier ones stay valid.
  for (const ci of cascade) manifest.scenes.splice(ci, 1);
  // Recompute the index of the primary target (cascade may have shifted it).
  const finalIdx = manifest.scenes.findIndex(s => (s.slug ?? s.id) === targetSlug);
  if (finalIdx >= 0) manifest.scenes.splice(finalIdx, 1);
  writeManifest(projectDir, manifest);
  return true;
}

// ─── Design System (legacy v1 single-file) ──────────────────

/**
 * @deprecated — writes the single global `.reframe/design.md`. Prefer
 * {@link registerBrand} which stores per-brand files under
 * `.reframe/brands/<slug>/DESIGN.md` and registers them in the manifest.
 *
 * This function is still called by older code paths and acts as a
 * convenience mirror of the active brand so v1 consumers keep working.
 */
export function saveDesignSystem(projectDir: string, content: string): string {
  const manifest = loadProject(projectDir);
  const relPath = 'design.md';
  const filePath = path.join(reframeDir(projectDir), relPath);

  fs.writeFileSync(filePath, content, 'utf-8');
  manifest.designSystem = relPath;
  writeManifest(projectDir, manifest);
  return filePath;
}

/**
 * Load DESIGN.md from the project. Prefers the active registered brand if
 * one exists; otherwise falls back to the legacy single-file location.
 */
export function loadDesignSystem(projectDir: string): string | null {
  const manifest = loadProject(projectDir);

  // v2 path: active brand from registry
  if (manifest.activeBrand && manifest.brands?.[manifest.activeBrand]) {
    const entry = manifest.brands[manifest.activeBrand];
    const filePath = path.join(reframeDir(projectDir), entry.path);
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf-8');
  }

  // v1 fallback
  if (manifest.designSystem) {
    const filePath = path.join(reframeDir(projectDir), manifest.designSystem);
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf-8');
  }

  return null;
}

// ─── Brand Registry (v2) ────────────────────────────────────

/**
 * Register a brand DESIGN.md in the project. Writes the content to
 * `.reframe/brands/<slug>/DESIGN.md`, adds/updates a {@link BrandRegistryEntry}
 * in the manifest, and mirrors the content to `.reframe/design.md` so legacy
 * consumers continue to work.
 *
 * If `setActive` is true (default), this brand becomes the active brand for
 * the project — used by scenes that don't pin their own.
 */
export function registerBrand(
  projectDir: string,
  slug: string,
  content: string,
  options?: { label?: string; setActive?: boolean },
): BrandRegistryEntry {
  const manifest = loadProject(projectDir);

  const relPath = `brands/${slug}/DESIGN.md`;
  const filePath = path.join(reframeDir(projectDir), relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');

  const now = new Date().toISOString();
  const entry: BrandRegistryEntry = {
    slug,
    path: relPath,
    hash: hashDesignMdContent(content),
    label: options?.label,
    updated: now,
  };

  if (!manifest.brands) manifest.brands = {};
  manifest.brands[slug] = entry;

  if (options?.setActive !== false) {
    manifest.activeBrand = slug;
    // Mirror to legacy .reframe/design.md so v1 consumers keep working.
    manifest.designSystem = 'design.md';
    fs.writeFileSync(
      path.join(reframeDir(projectDir), 'design.md'),
      content,
      'utf-8',
    );
  }

  writeManifest(projectDir, manifest);
  return entry;
}

/** Read a registered brand's DESIGN.md. Returns null if not registered. */
export function loadBrandFromProject(
  projectDir: string,
  slug: string,
): { content: string; entry: BrandRegistryEntry } | null {
  const manifest = loadProject(projectDir);
  const entry = manifest.brands?.[slug];
  if (!entry) return null;
  const filePath = path.join(reframeDir(projectDir), entry.path);
  if (!fs.existsSync(filePath)) return null;
  return { content: fs.readFileSync(filePath, 'utf-8'), entry };
}

/**
 * Change the active brand. Updates {@link ProjectManifest.activeBrand} and
 * mirrors the corresponding DESIGN.md to `.reframe/design.md` for legacy
 * consumers. Throws if the slug isn't registered.
 */
export function setActiveBrand(projectDir: string, slug: string): BrandRegistryEntry {
  const manifest = loadProject(projectDir);
  const entry = manifest.brands?.[slug];
  if (!entry) {
    const known = Object.keys(manifest.brands ?? {}).join(', ') || 'none';
    throw new Error(`Brand "${slug}" is not registered in this project. Known: ${known}`);
  }
  manifest.activeBrand = slug;
  manifest.designSystem = 'design.md';
  // Mirror content to legacy file
  const srcPath = path.join(reframeDir(projectDir), entry.path);
  if (fs.existsSync(srcPath)) {
    fs.writeFileSync(
      path.join(reframeDir(projectDir), 'design.md'),
      fs.readFileSync(srcPath, 'utf-8'),
      'utf-8',
    );
  }
  writeManifest(projectDir, manifest);
  return entry;
}

/** List all registered brands in the project. */
export function listRegisteredBrands(projectDir: string): BrandRegistryEntry[] {
  const manifest = loadProject(projectDir);
  return Object.values(manifest.brands ?? {});
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
      if (timeline) graph.timeline = timeline;
      // Phase 6: hydrate instances for every loaded scene — same
      // contract as loadSceneFromProject.
      try { expandInstances(graph, rootId, projectDir); } catch { /* best-effort */ }
      results.push({ graph, rootId, timeline, entry });
    } catch {
      // Skip corrupted scenes
    }
  }

  return results;
}

// ─── Source HTML persistence ────────────────────────────────

/**
 * Persist raw source HTML under `.reframe/src/<slug>.html` (or under a group
 * subdirectory when slug contains "/"). Returns the relative path that can be
 * stored on `SceneEntry.source`. This is the engine-level counterpart to the
 * MCP-side writer — exposing it here lets CLI/Studio/tests use the same
 * layout without reaching into the MCP package.
 */
export function saveSourceHtml(
  projectDir: string,
  slug: string,
  html: string,
): string {
  const parts = slug.split('/');
  const leaf = parts[parts.length - 1];
  const group = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
  const srcDir = group
    ? path.join(reframeDir(projectDir), 'src', group)
    : path.join(reframeDir(projectDir), 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, `${leaf}.html`), html, 'utf-8');
  return group ? `src/${group}/${leaf}.html` : `src/${leaf}.html`;
}

/**
 * Read source HTML stored by {@link saveSourceHtml} or by the MCP compile
 * tool. Accepts either a raw slug ("home", "site/home") or an already-resolved
 * relative path ("src/home.html"). Returns null when no file is present.
 */
export function loadSourceHtml(projectDir: string, slugOrPath: string): string | null {
  let relPath: string;
  if (slugOrPath.startsWith('src/') || slugOrPath.endsWith('.html')) {
    relPath = slugOrPath;
  } else {
    const parts = slugOrPath.split('/');
    const leaf = parts[parts.length - 1];
    const group = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    relPath = group ? `src/${group}/${leaf}.html` : `src/${leaf}.html`;
  }
  const filePath = path.join(reframeDir(projectDir), relPath);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

// ─── Compile helper: HTML → Project ─────────────────────────

/**
 * One-shot compile: take HTML, import it with stable ids enabled, persist the
 * source file under `.reframe/src/`, and save the resulting scene into the
 * project. Returns the saved entry plus the live graph for follow-up edits.
 *
 * This is the canonical way for non-MCP callers (CLI, tests, Studio headless
 * mode) to seed a project from authored HTML. The MCP compile tool has its own
 * path because it also runs audit, semantic classification and autofix — but
 * the project-level contract is the same: one HTML file → one named scene,
 * round-trippable via stable ids.
 */
export async function compileHtmlIntoProject(
  projectDir: string,
  html: string,
  options: {
    /** Scene name + slug base (required — projects must have named scenes). */
    name: string;
    /** Override the derived slug — otherwise `toSlug(name)` is used. */
    slug?: string;
    /** Viewport width. Propagated to importFromHtml. Default 1440. */
    width?: number;
    /** Viewport height. Propagated to importFromHtml. Default 900. */
    height?: number;
    /** Scene group tag for organization. */
    group?: string;
    /** Brand slug this scene was compiled against (for drift detection). */
    brand?: string;
    /** Extra tags to persist on the entry. */
    tags?: string[];
    /** When false, stable DOM-path ids are skipped. Default true — round-trip is the whole point of this helper. */
    stableIds?: boolean;
    /** Pass-through overrides for the HTML importer (e.g. forceRootSize). */
    importerOptions?: Omit<HtmlImportOptions, 'name' | 'width' | 'height' | 'stableIds'>;
    /**
     * Phase 3: when true, after import + save, read the scene's op history
     * log (`.reframe/history/<slug>.ops.jsonl`) and replay it on top. This
     * is what makes re-compile non-destructive: source HTML edits go via the
     * fresh import, agent edits are preserved via replay. Defaults to true
     * when the history file exists, false otherwise.
     */
    replayHistory?: boolean;
    /**
     * Active DesignSystem — required for operations that reference tokens
     * (bindToken, autoBindTokens). Optional otherwise: ops that only touch
     * raw SceneNode props work fine without a design system.
     */
    designSystem?: DesignSystem;
    /**
     * Phase 4: when true (default), auto-regenerate every variant of this
     * scene after saving the base. Set to false to compile just the base
     * without touching variants — useful when you want to batch-refresh
     * variants manually or when running inside a variant-generation loop.
     */
    refreshVariants?: boolean;
  },
): Promise<{
  entry: SceneEntry;
  graph: SceneGraph;
  rootId: string;
  stats: { elements: number; textNodes: number; images: number; unsupported: string[] };
  /** Undefined when no history replay happened. */
  replay?: ReplayResult & { opsRead: number; compacted?: { before: number; after: number } };
  /** Undefined when there were no variants to refresh. */
  variantRefresh?: { refreshed: number; errors: Array<{ slug: string; error: string }> };
}> {
  if (!projectExists(projectDir)) {
    throw new Error(
      `compileHtmlIntoProject: no .reframe project at ${projectDir}. Call initProject first.`,
    );
  }
  const width = options.width ?? 1440;
  const height = options.height ?? 900;

  const { graph, rootId, stats } = await importFromHtml(html, {
    ...(options.importerOptions ?? {}),
    name: options.name,
    width,
    height,
    stableIds: options.stableIds !== false,
  });

  // Decide on the slug ahead of saveScene so source HTML and scene file share
  // the same filesystem key — otherwise a caller who passes name="Home Page"
  // would end up with src/Home Page.html but a scene called home-page.
  const manifest = loadProject(projectDir);
  const existingSlugs = new Set(manifest.scenes.map(s => s.slug ?? s.id));
  const baseSlug = options.slug ?? toSlug(options.name);
  const slug = existingSlugs.has(baseSlug) ? baseSlug : uniqueSlug(baseSlug, existingSlugs);

  const srcPath = saveSourceHtml(projectDir, slug, html);

  // ── Phase 3 replay ─────────────────────────────────────────
  // Default: replay whenever a history file exists. Callers can force-disable
  // via { replayHistory: false } to get a pristine re-compile (e.g. when
  // inspecting the raw import output without agent edits on top).
  //
  // Phase 6: inject the component API into the replay context so
  // extractComponent / instantiateComponent ops can do filesystem work.
  let replay: (ReplayResult & { opsRead: number; compacted?: { before: number; after: number } }) | undefined;
  const wantReplay = options.replayHistory !== false;
  if (wantReplay) {
    const result = replayHistory(graph, rootId, projectDir, slug, options.designSystem, {
      componentAPI: {
        saveComponentMaster,
        createInstancePlaceholder,
      },
      projectDir,
    } as any);
    if (result.opsRead > 0) {
      replay = result;
    }
  }

  // Phase 6: hydrate any instance placeholders created during import
  // (via data-reframe-component) or by replayed instantiateComponent ops.
  try { expandInstances(graph, rootId, projectDir); } catch { /* best-effort */ }

  // Save AFTER replay so the serialized scene file reflects the final edited
  // state. Without this, the next load would miss all agent mutations.
  const entry = saveScene(projectDir, graph, rootId, {
    slug,
    name: options.name,
    nodes: graph.nodes.size,
    group: options.group,
    tags: options.tags,
    source: srcPath,
    brand: options.brand,
  });

  // ── Phase 4: auto-refresh variants ────────────────────────
  // If this base scene has any variants on disk, regenerate them now so
  // agent edits to the base (via replay) propagate automatically. Failures
  // in a single variant don't abort the compile — we surface them in the
  // return value for the caller to decide.
  let variantRefresh: { refreshed: number; errors: Array<{ slug: string; error: string }> } | undefined;
  if (options.refreshVariants !== false) {
    try {
      const result = await _refreshVariants(projectDir, slug, {
        designSystem: options.designSystem,
      });
      if (result.refreshed.length > 0 || result.errors.length > 0) {
        variantRefresh = { refreshed: result.refreshed.length, errors: result.errors };
      }
    } catch {
      /* best-effort — variant refresh is a non-blocking convenience */
    }
  }

  return { entry, graph, rootId, stats, replay, variantRefresh };
}
