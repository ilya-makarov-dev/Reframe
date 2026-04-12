/**
 * Phase 4 — Multi-view variants built ON TOP of the resize pipeline.
 *
 * A "variant" is a responsive instance of a base scene at a different target
 * viewport (mobile 375, tablet 768, laptop 1024, etc.). Variants are generated
 * by calling `adaptFromGraph` from the resize subsystem — we are NOT
 * re-implementing resize or replacing it. The resize pipeline remains the
 * source of truth for how content reflows across sizes; this module only adds
 * the persistence + refresh loop that makes variants first-class project
 * citizens.
 *
 * Invariants:
 *   - A variant is a separate SceneEntry with `variantOf` + `viewport` set.
 *   - Variant file paths are `scenes/<baseSlug>.<viewportName>.scene.json`.
 *   - Variants do NOT have their own history log — edits go to the base log
 *     and propagate on refresh. This keeps edit ops canonical (one edit, one
 *     source of truth).
 *   - Regenerating a variant is idempotent: the same base + same viewport
 *     always yields the same result (up to adapt()'s own determinism).
 */

import * as fs from 'fs';
import * as path from 'path';
import { SceneGraph } from '../engine/scene-graph.js';
import { deserializeScene, serializeGraph } from '../serialize.js';
import type { SceneJSON } from '../serialize.js';
import { adaptFromGraph } from '../resize/adapt.js';
import { autoBindTokens } from '../ops/auto-bind-tokens.js';
import type { DesignSystem } from '../design-system/types.js';
import {
  loadProject,
  writeManifestRaw,
  loadSceneFromProject,
} from './io.js';
import type { SceneEntry, ProjectManifest } from './types.js';

// ─── Paths ───────────────────────────────────────────────────

function reframeDir(projectDir: string): string {
  return path.join(projectDir, '.reframe');
}

// ─── Phase 5b: per-project mutex for manifest RMW ──────────
//
// `generateVariant` does a read-modify-write on .reframe/project.json: read
// the manifest, generate the variant scene file, then write the manifest
// with the new entry. When two generateVariant calls run in parallel (the
// exact pattern we use in `refreshVariants` via Promise.all fan-out, or
// when an agent triggers two `add_variant` calls in quick succession),
// both read the SAME stale manifest, both write their own copy, and the
// second write WINS — the first variant's manifest entry is silently lost
// while its .scene.json file lives orphaned on disk.
//
// Classic lost-update race. Fix: a per-directory promise chain. Every
// generateVariant call appends its work onto the chain for its project
// dir, so concurrent callers serialize within a single process. Different
// projects run in parallel (no contention), same project runs in order.
//
// NOTE: this does not solve cross-process concurrency (two Node instances
// hammering the same .reframe/). That needs file locking (flock / atomic
// rename) and is out of scope for Phase 5b — the single-agent single-MCP
// case is the 99%.
const _manifestMutex = new Map<string, Promise<unknown>>();

function withManifestLock<T>(projectDir: string, fn: () => Promise<T>): Promise<T> {
  const prev = _manifestMutex.get(projectDir) ?? Promise.resolve();
  const next = prev.catch(() => { /* swallow so one failure doesn't block the queue */ })
    .then(fn);
  _manifestMutex.set(projectDir, next);
  // Clean up the entry once settled so the map doesn't leak. We only drop
  // it if this call is still the tail — otherwise a later call already
  // replaced the entry and owns the lifecycle.
  next.finally(() => {
    if (_manifestMutex.get(projectDir) === next) _manifestMutex.delete(projectDir);
  }).catch(() => { /* rejection handled by caller; suppress on cleanup chain */ });
  return next;
}

function variantSlug(baseSlug: string, viewportName: string): string {
  // Keep the base slug visible in the variant key so list/status output is
  // readable ("hero.mobile" → clearly a variant of hero).
  return `${baseSlug}.${viewportName}`;
}

function variantFilePath(projectDir: string, baseSlug: string, viewportName: string): string {
  return path.join(reframeDir(projectDir), 'scenes', `${variantSlug(baseSlug, viewportName)}.scene.json`);
}

// ─── Public API ──────────────────────────────────────────────

export interface Viewport {
  name: string;
  width: number;
  height: number;
}

export interface GenerateVariantOptions {
  /** DesignSystem for brand-aware adaptation (same as compileHtmlIntoProject). */
  designSystem?: DesignSystem;
  /** Forward to adapt(): 'smart' (default), 'contain', 'cover', 'stretch', 'reflow'. */
  strategy?: 'smart' | 'contain' | 'cover' | 'stretch' | 'reflow';
}

/**
 * Generate (or refresh) a single variant for a base scene.
 *
 * Loads the base scene JSON from disk, deserializes it into a FRESH graph so
 * the base graph held in caller memory is not mutated by resize, runs the
 * full adapt pipeline at the target viewport, saves the result as a sibling
 * scene file, and updates the manifest.
 *
 * Returns the freshly-saved variant entry. Throws if the base slug doesn't
 * exist in the manifest — callers that want no-throw semantics should check
 * `listVariants` / manifest first.
 */
export function generateVariant(
  projectDir: string,
  baseSlug: string,
  viewport: Viewport,
  options: GenerateVariantOptions = {},
): Promise<SceneEntry> {
  // Phase 5b Bug #X: serialize manifest RMW on this dir. Without the
  // mutex, Promise.all-dispatched variant generation races on
  // project.json and one entry silently clobbers the other.
  return withManifestLock(projectDir, () => _generateVariantImpl(projectDir, baseSlug, viewport, options));
}

async function _generateVariantImpl(
  projectDir: string,
  baseSlug: string,
  viewport: Viewport,
  options: GenerateVariantOptions = {},
): Promise<SceneEntry> {
  const manifest = loadProject(projectDir);
  const baseEntry = manifest.scenes.find(
    s => (s.slug ?? s.id) === baseSlug && !s.variantOf,
  );
  if (!baseEntry) {
    throw new Error(
      `generateVariant: base scene "${baseSlug}" not found (or is itself a variant).`,
    );
  }

  // Load base via a fresh graph — cloneTree / deserializeScene gives us a
  // detached instance so adapt()'s mutations don't leak back into the base.
  const baseFilePath = path.join(reframeDir(projectDir), baseEntry.file);
  const rawJson = JSON.parse(fs.readFileSync(baseFilePath, 'utf-8')) as SceneJSON;
  const { graph, rootId, timeline: baseTimeline } = deserializeScene(rawJson);

  // Phase 5: hydrate the base timeline onto the graph so adapt() can consult
  // it if it wants. Under strategies that preserve the tree (contain/cover/
  // stretch + smart without reflow) the animations remain correctly targeted
  // at the post-adapt node ids because the ids themselves are preserved.
  // Under reflow the tree is rebuilt from scratch — we detect that via the
  // rootId change below and drop animations gracefully rather than carrying
  // broken references into the variant.
  if (baseTimeline) graph.timeline = baseTimeline;

  // Run adapt — this is the whole Phase 4 value proposition: reuse the
  // existing resize pipeline, don't replace it.
  const result = await adaptFromGraph(graph, rootId, viewport.width, viewport.height, {
    strategy: options.strategy ?? 'smart',
    designSystem: options.designSystem,
  });
  const adaptedRootId = result.root.id;
  const treePreserved = adaptedRootId === rootId && graph.nodes.has(rootId);

  // If reflow rebuilt the tree, the old timeline's nodeIds are stale —
  // clear it rather than emitting broken CSS. Tree-preserving strategies
  // keep the same ids so the timeline is automatically valid.
  if (!treePreserved) {
    graph.timeline = null;
  }

  // ── Phase 3+4 integration: re-run auto-binding on the variant ──
  // The reflow strategy (triggered by extreme aspect ratio changes like
  // 1440 landscape → 375 portrait mobile) rebuilds the tree from scratch,
  // so meta.tokenBindings on base nodes does not survive into the variant.
  // Re-running autoBindTokens post-adapt fixes this: the variant's fresh
  // nodes get their own bindings derived from the same DS, which is the
  // right contract anyway — binding is a property of "this rendered node
  // matches this brand role", and the variant's rendered nodes should be
  // checked against the DS in their own right.
  if (options.designSystem) {
    try {
      autoBindTokens(graph, adaptedRootId, options.designSystem);
    } catch { /* best-effort — a bind failure must not block variant save */ }
  }

  // Count nodes for the manifest entry (cheap — just graph.nodes.size minus
  // the CANVAS ancestors, but nodes.size is a good proxy).
  const nodeCount = graph.nodes.size;

  // Serialize the ADAPTED graph into a fresh JSON blob. Pass graph.timeline
  // explicitly so tree-preserving adapt strategies carry animations into the
  // variant's on-disk scene, and exporters emit them as @keyframes.
  const variantJson = serializeGraph(graph, adaptedRootId, {
    compact: true,
    timeline: (graph.timeline as any) ?? undefined,
  });

  // Write the file, append/update the manifest entry.
  const slug = variantSlug(baseSlug, viewport.name);
  const relFile = `scenes/${slug}.scene.json`;
  const absFile = path.join(reframeDir(projectDir), relFile);
  fs.mkdirSync(path.dirname(absFile), { recursive: true });
  fs.writeFileSync(absFile, JSON.stringify(variantJson, null, 2), 'utf-8');

  const now = new Date().toISOString();
  let entry = manifest.scenes.find(s => (s.slug ?? s.id) === slug);
  if (entry) {
    entry.width = viewport.width;
    entry.height = viewport.height;
    entry.nodes = nodeCount;
    entry.revision = (entry.revision ?? 0) + 1;
    entry.updated = now;
    entry.variantOf = baseSlug;
    entry.viewport = { ...viewport };
  } else {
    entry = {
      id: slug,
      slug,
      name: `${baseEntry.name} (${viewport.name})`,
      file: relFile,
      width: viewport.width,
      height: viewport.height,
      nodes: nodeCount,
      revision: 1,
      variantOf: baseSlug,
      viewport: { ...viewport },
      created: now,
      updated: now,
      // Inherit group/tags from base so list/status output stays tidy.
      group: baseEntry.group,
      tags: baseEntry.tags,
      brand: baseEntry.brand,
      brandHash: baseEntry.brandHash,
    };
    manifest.scenes.push(entry);
  }
  writeManifestRaw(projectDir, manifest);
  return entry;
}

/**
 * Find all variants of a base scene. Used by list/status displays and by
 * `refreshVariants` to drive auto-regeneration on re-compile.
 */
export function listVariants(projectDir: string, baseSlug: string): SceneEntry[] {
  const manifest = loadProject(projectDir);
  return manifest.scenes.filter(s => s.variantOf === baseSlug);
}

/**
 * Re-generate every variant of a base scene from its current state. Typically
 * called from `compileHtmlIntoProject` after replay, so when an agent edits
 * the base, every variant stays in sync without manual refresh calls.
 *
 * Errors during individual variant generation are captured but do not abort
 * the rest — one broken variant should not block the others.
 */
export async function refreshVariants(
  projectDir: string,
  baseSlug: string,
  options: GenerateVariantOptions = {},
): Promise<{ refreshed: SceneEntry[]; errors: Array<{ slug: string; error: string }> }> {
  const variants = listVariants(projectDir, baseSlug);
  const refreshed: SceneEntry[] = [];
  const errors: Array<{ slug: string; error: string }> = [];
  for (const v of variants) {
    if (!v.viewport) {
      errors.push({ slug: v.slug, error: 'variant has no viewport — skipping' });
      continue;
    }
    try {
      const entry = await generateVariant(projectDir, baseSlug, v.viewport, options);
      refreshed.push(entry);
    } catch (e: any) {
      errors.push({ slug: v.slug, error: e?.message ?? String(e) });
    }
  }
  return { refreshed, errors };
}

/**
 * Convenience: load both a base scene and all its variants in one call.
 * Returns the base plus every variant with its graph ready to export.
 */
export function loadSceneWithVariants(
  projectDir: string,
  baseSlug: string,
): {
  base: { graph: SceneGraph; rootId: string; entry: SceneEntry };
  variants: Array<{ graph: SceneGraph; rootId: string; entry: SceneEntry }>;
} {
  const base = loadSceneFromProject(projectDir, baseSlug);
  const variants = listVariants(projectDir, baseSlug).map(v =>
    loadSceneFromProject(projectDir, v.slug),
  );
  return { base, variants };
}
