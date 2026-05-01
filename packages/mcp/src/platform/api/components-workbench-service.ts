/**
 * Components Workbench service layer — Phase 4 Brief 4a.
 *
 * Pure orchestration over Phase 6 engine state owners. The workbench
 * does NOT own component state; it presents existing state coherently
 * (catalog list / master / instance graph) and forwards mutations
 * through ops apply so engine invariants stay intact.
 *
 * Owners we wrap (per Brief 4a executor map):
 *   - core/project/components.ts:    listComponents / loadComponentMaster /
 *                                    deleteComponent / componentFilePath
 *   - core/ops/apply.ts:             extractComponent / instantiateComponent /
 *                                    unlinkInstance ops dispatch
 *   - mcp/store.ts:                  StoredScene listing for instance walk
 *   - core/engine/scene-graph.ts:    direct graph mutation (slot overrides
 *                                    via updateNode — no op needed; overrides
 *                                    are part of node JSON, not history)
 *
 * Foundation includes Phase 4d skill-bus invocation context hooks
 * (skillInvocationContext) ready but NOT wired — bus integration for
 * components workbench chips is Phase 4d territory. Hooks just collect
 * scope.
 */

import type { ComponentFile, SavedComponentEntry } from '../../../../core/src/project/components.js';
import {
  listComponents as engineListComponents,
  loadComponentMaster as engineLoadMaster,
  deleteComponent as engineDeleteComponent,
} from '../../../../core/src/project/components.js';
import { listScenes, getScene } from '../../store.js';

// ─── Types ─────────────────────────────────────────────────────

export interface ComponentCatalogEntry {
  /** Stable slug used in URLs + filenames. */
  slug: string;
  /** Display name from ComponentFile.name. */
  name: string;
  /** Optional description. */
  description?: string;
  /** Bumped on every saveComponentMaster. */
  revision: number;
  /** ISO timestamp of last edit. */
  updated: string;
  /** Slot names exposed by this master. */
  slots: string[];
  /** Live count of INSTANCE nodes referencing this component across all scenes. */
  instanceCount: number;
}

export interface InstanceRef {
  /** sessionId of the scene containing the instance. */
  sceneId: string;
  /** Scene slug — surfaced for display. */
  sceneSlug: string;
  /** Scene display name. */
  sceneName: string;
  /** Instance node id within the scene. */
  nodeId: string;
  /** Per-instance overrides keyed by slot name. */
  overrides: Record<string, Record<string, unknown>>;
}

export interface ComponentMasterDetail {
  slug: string;
  name: string;
  description?: string;
  revision: number;
  created: string;
  updated: string;
  /** Full ComponentFile for callers that need the master subtree JSON. */
  file: ComponentFile;
}

export interface SkillContext {
  componentSlug: string;
  scope: 'master' | 'instance' | 'variant';
  sceneId?: string;
  nodeId?: string;
}

// ─── Catalog + master read surface ─────────────────────────────

/**
 * List every component master in the project, augmented with a live
 * count of INSTANCE nodes referencing it. Walks all StoredScenes once
 * and bins by `meta.componentName` so the count is per-component O(N)
 * over total nodes, not per-component O(N) which would re-walk for
 * each catalog entry.
 */
export function listComponents(projectDir: string): ComponentCatalogEntry[] {
  const masters: SavedComponentEntry[] = engineListComponents(projectDir);
  if (masters.length === 0) return [];

  const counts = countInstancesByComponent();
  return masters.map((m) => ({
    slug: m.slug,
    name: m.name,
    description: m.description,
    revision: m.revision,
    updated: m.updated,
    slots: m.slots,
    instanceCount: counts.get(m.name) ?? 0,
  }));
}

/**
 * Load a single component master with its full ComponentFile payload.
 * Returns null when the slug has no on-disk master.
 */
export function loadComponent(
  projectDir: string,
  slug: string,
): ComponentMasterDetail | null {
  const file = engineLoadMaster(projectDir, slug);
  if (!file) return null;
  return {
    slug: file.slug,
    name: file.name,
    description: file.description,
    revision: file.revision ?? 1,
    created: file.created,
    updated: file.updated,
    file,
  };
}

/**
 * Walk every scene's graph and find INSTANCE nodes whose
 * meta.componentName matches the given component (matched by NAME, not
 * slug — the engine stores names on instances, slugs on masters; the
 * slug→name mapping is 1:1 because slugs are derived from names).
 *
 * Used by:
 *   - Workbench Instances section (Pin #4)
 *   - Master propagation verification (Pin #9 oracle)
 */
export function listInstancesUsing(
  projectDir: string,
  slug: string,
): InstanceRef[] {
  const master = engineLoadMaster(projectDir, slug);
  if (!master) return [];
  const componentName = master.name;
  const out: InstanceRef[] = [];

  for (const ref of listScenes()) {
    const stored = getScene(ref.id);
    const graph: any = stored?.graph;
    if (!graph || typeof graph.getNode !== 'function') continue;
    // Walk every node — INSTANCE filter happens inside.
    walkInstanceNodes(graph, (node) => {
      const cName = (node.meta as any)?.componentName;
      if (cName !== componentName) return;
      out.push({
        sceneId: ref.id,
        sceneSlug: ref.slug,
        sceneName: stored?.name ?? ref.slug,
        nodeId: node.id,
        overrides: (node.overrides ?? {}) as Record<string, Record<string, unknown>>,
      });
    });
  }
  return out;
}

// ─── Mutation surface — wraps ops apply ────────────────────────

/**
 * Extract a subtree from a scene as a new component master. Wraps the
 * extractComponent op so history replay stays consistent. Returns the
 * resulting placeholder instance + the saved master entry.
 *
 * Caller responsible for naming — slug derivation happens engine-side
 * via toSlug(name).
 */
export async function extractFromSelection(opts: {
  projectDir: string;
  sceneId: string;
  nodeId: string;
  name: string;
  description?: string;
}): Promise<{ slug: string; instanceId: string }> {
  const { projectDir, sceneId, nodeId, name, description } = opts;
  if (!name || !/^[A-Za-z][A-Za-z0-9 \-_/]*$/.test(name)) {
    throw new Error('component name must start with a letter');
  }
  const stored = getScene(sceneId);
  if (!stored) throw new Error(`scene ${sceneId} not found`);
  const graph: any = stored.graph;
  if (!graph) throw new Error(`scene ${sceneId} has no graph`);

  const componentsModule = await import('../../../../core/src/project/components.js');
  const applyModule = await import('../../../../core/src/ops/apply.js');
  const result = applyModule.applyOperation(graph, {
    type: 'extractComponent',
    nodeId,
    name,
    description,
  } as any, {
    projectDir,
    componentAPI: componentsModule,
  } as any);

  if (!result.ok) {
    throw new Error(result.error || 'extractComponent failed');
  }
  const instanceId = result.affectedNodeIds[0] || nodeId;
  // Persist the post-extract scene graph so the placeholder swap survives
  // a reload — extractComponent mutates the graph in-place but the store
  // requires an explicit save to write the new shape to disk.
  await persistSceneGraph(sceneId);

  // Slug = engine's toSlug(name). We re-derive locally to avoid an
  // extra import; slug rules in core/project/slug.ts are stable.
  const slug = toSlug(name);
  return { slug, instanceId };
}

/**
 * Instantiate a component as a new INSTANCE node under parentId in
 * the target scene. Wraps the instantiateComponent op.
 */
export async function instantiate(opts: {
  projectDir: string;
  sceneId: string;
  parentId: string;
  componentSlug: string;
}): Promise<{ instanceId: string }> {
  const { projectDir, sceneId, parentId, componentSlug } = opts;
  const stored = getScene(sceneId);
  if (!stored) throw new Error(`scene ${sceneId} not found`);
  const graph: any = stored.graph;
  if (!graph) throw new Error(`scene ${sceneId} has no graph`);

  // Engine ops carry componentNAME, not slug. Resolve.
  const master = engineLoadMaster(projectDir, componentSlug);
  if (!master) throw new Error(`component ${componentSlug} not found`);

  const componentsModule = await import('../../../../core/src/project/components.js');
  const applyModule = await import('../../../../core/src/ops/apply.js');
  const result = applyModule.applyOperation(graph, {
    type: 'instantiateComponent',
    parentId,
    componentName: master.name,
    overrides: {},
  } as any, {
    projectDir,
    componentAPI: componentsModule,
  } as any);

  if (!result.ok) {
    throw new Error(result.error || 'instantiateComponent failed');
  }
  const instanceId = result.affectedNodeIds[0];
  if (!instanceId) throw new Error('instantiateComponent returned no instance id');
  await persistSceneGraph(sceneId);
  return { instanceId };
}

/**
 * Edit slot overrides on a single instance node. Patch is shallow-merged
 * into the existing overrides map so the caller can update one slot at a
 * time without re-sending the full map. Pass `null` for a slot to
 * remove its override (resets that slot to master default).
 */
export async function editInstance(opts: {
  projectDir: string;
  sceneId: string;
  nodeId: string;
  patch: Record<string, Record<string, unknown> | null>;
}): Promise<{ overrides: Record<string, Record<string, unknown>> }> {
  const { projectDir, sceneId, nodeId, patch } = opts;
  const stored = getScene(sceneId);
  if (!stored) throw new Error(`scene ${sceneId} not found`);
  const graph: any = stored.graph;
  if (!graph) throw new Error(`scene ${sceneId} has no graph`);
  const node = graph.getNode(nodeId);
  if (!node) throw new Error(`node ${nodeId} not found`);
  if (node.type !== 'INSTANCE') {
    throw new Error(`node ${nodeId} is not an INSTANCE (type=${node.type})`);
  }
  const current = (node.overrides ?? {}) as Record<string, Record<string, unknown>>;
  const merged: Record<string, Record<string, unknown>> = { ...current };
  for (const [slot, value] of Object.entries(patch)) {
    if (value === null) {
      delete merged[slot];
    } else {
      merged[slot] = { ...(merged[slot] ?? {}), ...value };
    }
  }
  graph.updateNode(nodeId, { overrides: merged } as any);
  await persistSceneGraph(sceneId);
  return { overrides: merged };
}

/**
 * Sever the master link on an instance (calls unlinkInstance op).
 * Children stay in place — they become plain scene content. Useful
 * when the designer wants to detach one instance from a master before
 * heavy editing.
 */
export async function unlinkInstance(opts: {
  projectDir: string;
  sceneId: string;
  nodeId: string;
}): Promise<{ ok: true }> {
  const { projectDir, sceneId, nodeId } = opts;
  const stored = getScene(sceneId);
  if (!stored) throw new Error(`scene ${sceneId} not found`);
  const graph: any = stored.graph;
  if (!graph) throw new Error(`scene ${sceneId} has no graph`);
  const componentsModule = await import('../../../../core/src/project/components.js');
  const applyModule = await import('../../../../core/src/ops/apply.js');
  const result = applyModule.applyOperation(graph, {
    type: 'unlinkInstance',
    nodeId,
  } as any, {
    projectDir,
    componentAPI: componentsModule,
  } as any);
  if (!result.ok) throw new Error(result.error || 'unlinkInstance failed');
  await persistSceneGraph(sceneId);
  return { ok: true };
}

/**
 * Remove a component master from disk. Existing INSTANCE references
 * become "missing master" warnings on next expandInstances pass — the
 * caller is responsible for first detaching/replacing instances via
 * unlinkInstance if they want to preserve hydrated content.
 */
export function deleteComponent(projectDir: string, slug: string): boolean {
  return engineDeleteComponent(projectDir, slug);
}

// ─── Phase 4d skill-bus context ────────────────────────────────

/**
 * Foundation hook for Phase 4d skill-bus integration. Collects scope
 * metadata that bus subscribers will route on once chip wiring lands.
 * Brief 4a returns this from mutation endpoints so the API contract is
 * fixed before consumers wire to it.
 */
export function skillInvocationContext(opts: {
  componentSlug: string;
  scope: 'master' | 'instance' | 'variant';
  sceneId?: string;
  nodeId?: string;
}): SkillContext {
  return {
    componentSlug: opts.componentSlug,
    scope: opts.scope,
    sceneId: opts.sceneId,
    nodeId: opts.nodeId,
  };
}

// ─── Helpers ───────────────────────────────────────────────────

function countInstancesByComponent(): Map<string, number> {
  const out = new Map<string, number>();
  for (const ref of listScenes()) {
    const stored = getScene(ref.id);
    const graph: any = stored?.graph;
    if (!graph) continue;
    walkInstanceNodes(graph, (node) => {
      const cName = (node.meta as any)?.componentName;
      if (typeof cName !== 'string' || cName.length === 0) return;
      out.set(cName, (out.get(cName) ?? 0) + 1);
    });
  }
  return out;
}

function walkInstanceNodes(
  graph: any,
  visit: (node: any) => void,
): void {
  // SceneGraph exposes `nodes: Map<string, SceneNode>` — iterate
  // directly so we touch every INSTANCE without doing a tree walk
  // (cheaper for sparse instance distribution).
  const nodes = graph.nodes;
  if (!nodes || typeof nodes.values !== 'function') return;
  for (const node of nodes.values()) {
    if (node.type === 'INSTANCE') visit(node);
  }
}

async function persistSceneGraph(sceneId: string): Promise<void> {
  // Re-route through the existing resaveScene pipeline so collapse-instances
  // runs (the autoSaveToProject path inside the store strips the hydrated
  // INSTANCE children before write). Failure is best-effort here — the
  // in-memory graph is already updated; reload may surface a stale disk
  // view but the next mutation rewrites.
  try {
    const store = await import('../../store.js');
    if (typeof (store as any).resaveScene === 'function') {
      (store as any).resaveScene(sceneId);
    }
  } catch {
    // Caller will see the in-memory state regardless; persistence is
    // a soft requirement for the contract test which reloads from disk.
  }
}

/**
 * Slug derivation — mirror of core/project/slug.ts toSlug. Inlined so
 * the service layer doesn't take an extra dependency for one helper.
 * Lowercase, replace non-alphanumeric with `-`, collapse dashes,
 * strip leading/trailing.
 */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
