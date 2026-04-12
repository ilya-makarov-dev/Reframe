/**
 * Phase 6 — Project-level Component Registry (first-class).
 *
 * Components live as individual files under `.reframe/components/<slug>.component.json`.
 * An INSTANCE node in a scene carries `meta.componentName` + `overrides` — a pure
 * placeholder. On load / compile, `expandInstances` resolves every placeholder by
 * cloning the master subtree as children, re-id'ing the clones, and applying
 * overrides. On save, `collapseInstances` drops the expanded children so disk
 * state stays normalized (placeholder + overrides, never the hydrated copy).
 *
 * Design choices:
 *
 *   1. **On-disk = placeholder, in-memory = expanded.** Scenes stay small on
 *      disk (one line per instance) and the master can be edited independently
 *      without touching every scene file. Cost: load/save round-trips must
 *      pair expand/collapse symmetrically.
 *
 *   2. **Re-id by prefix.** Cloned nodes get ids of the form `<instanceId>/<originalId>`
 *      so (a) they're unique within the scene, (b) they're deterministic across
 *      compile runs (Phase 3 replay-safe), and (c) the prefix tells the collapse
 *      pass which nodes to remove.
 *
 *   3. **Slot-based overrides.** Override keys match against `node.slot` inside
 *      the component tree. The HTML importer already preserves `data-reframe-slot`
 *      (Phase 1), so authors mark bindable nodes once and overrides are keyed
 *      by those slots. Unknown slots are ignored silently — the agent may
 *      reference slots that were renamed in the master.
 *
 *   4. **No auto-editing of masters.** Updating a component means either
 *      running `extractComponent` again on a new subtree with the same name,
 *      or compiling a new source HTML file into the master via the dedicated
 *      `compileComponentFromHtml` helper. Editing a master via ops is out of
 *      scope — masters are small enough that re-extracting is the ergonomic
 *      path, and in-place edits open too many ordering questions for MVP.
 */

import * as fs from 'fs';
import * as path from 'path';
import { SceneGraph, createDefaultNode, generateId } from '../engine/scene-graph.js';
import { serializeGraph, deserializeScene } from '../serialize.js';
import type { SceneJSON, INodeJSON } from '../serialize.js';
import type { SceneNode, ComponentPropertyDefinition } from '../engine/types.js';
import { toSlug } from './slug.js';

// ─── Types ───────────────────────────────────────────────────

/**
 * On-disk format for a saved component master.
 *
 * `root` is a full SceneJSON root (the subtree that was extracted), so it
 * can be round-tripped through deserializeScene. `propertyDefinitions`
 * are a hint for the agent UI but do not enforce any validation at apply
 * time — overrides are duck-typed by slot name.
 */
export interface ComponentFile {
  version: number;
  name: string;
  slug: string;
  description?: string;
  /** ISO date of first extract. */
  created: string;
  /** ISO date of latest master edit. */
  updated: string;
  /** Bumped on every saveComponentMaster call. */
  revision: number;
  /** Full SceneJSON root for the master subtree. */
  root: INodeJSON;
  /** Slot names exposed by this component (derived from node.slot during extract). */
  slots?: string[];
  /** Optional variant/property definitions, surfaced to agents via show_component. */
  propertyDefinitions?: ComponentPropertyDefinition[];
}

export interface SavedComponentEntry {
  name: string;
  slug: string;
  description?: string;
  revision: number;
  updated: string;
  slots: string[];
  /** Absolute path of the component file. */
  path: string;
}

const COMPONENT_FORMAT_VERSION = 1;

// ─── Paths ───────────────────────────────────────────────────

function componentsDir(projectDir: string): string {
  return path.join(projectDir, '.reframe', 'components');
}

export function componentFilePath(projectDir: string, nameOrSlug: string): string {
  return path.join(componentsDir(projectDir), `${toSlug(nameOrSlug)}.component.json`);
}

// ─── CRUD ────────────────────────────────────────────────────

/**
 * Serialize a subtree of `graph` starting at `rootId` and save it as a
 * component master under `.reframe/components/<slug>.component.json`.
 *
 * If a component with the same slug already exists, the new save bumps
 * the revision and preserves the original `created` timestamp — this is
 * the "re-extract updates in place" pattern.
 */
export function saveComponentMaster(
  projectDir: string,
  name: string,
  graph: SceneGraph,
  rootId: string,
  options: { description?: string; propertyDefinitions?: ComponentPropertyDefinition[] } = {},
): ComponentFile {
  const slug = toSlug(name);
  // Serialize the subtree. We reuse serializeGraph which already handles
  // the full set of SceneNode fields, so components are round-trip safe.
  const sceneJson = serializeGraph(graph, rootId, { compact: true });

  // Collect exposed slots by walking the SceneJSON tree — useful for the
  // agent UI to suggest override keys without re-reading the master.
  const slots = new Set<string>();
  (function walk(n: any): void {
    if (!n || typeof n !== 'object') return;
    if (typeof n.slot === 'string' && n.slot.length > 0) slots.add(n.slot);
    if (Array.isArray(n.children)) for (const c of n.children) walk(c);
  })(sceneJson.root);

  const filePath = componentFilePath(projectDir, slug);
  const now = new Date().toISOString();

  let file: ComponentFile;
  if (fs.existsSync(filePath)) {
    const prev = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ComponentFile;
    file = {
      ...prev,
      name,
      slug,
      description: options.description ?? prev.description,
      propertyDefinitions: options.propertyDefinitions ?? prev.propertyDefinitions,
      updated: now,
      revision: (prev.revision ?? 0) + 1,
      root: sceneJson.root,
      slots: [...slots],
    };
  } else {
    file = {
      version: COMPONENT_FORMAT_VERSION,
      name,
      slug,
      description: options.description,
      created: now,
      updated: now,
      revision: 1,
      root: sceneJson.root,
      slots: [...slots],
      propertyDefinitions: options.propertyDefinitions,
    };
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(file, null, 2), 'utf-8');
  return file;
}

/** Read a component master by name/slug. Returns null if missing. */
export function loadComponentMaster(projectDir: string, nameOrSlug: string): ComponentFile | null {
  const filePath = componentFilePath(projectDir, nameOrSlug);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ComponentFile;
  } catch {
    return null;
  }
}

/** List every component registered in the project. Skips unreadable files. */
export function listComponents(projectDir: string): SavedComponentEntry[] {
  const dir = componentsDir(projectDir);
  if (!fs.existsSync(dir)) return [];
  const out: SavedComponentEntry[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.component.json')) continue;
    try {
      const full = path.join(dir, entry);
      const parsed = JSON.parse(fs.readFileSync(full, 'utf-8')) as ComponentFile;
      out.push({
        name: parsed.name,
        slug: parsed.slug,
        description: parsed.description,
        revision: parsed.revision ?? 1,
        updated: parsed.updated,
        slots: parsed.slots ?? [],
        path: full,
      });
    } catch {
      // Skip corrupt — listing is best-effort.
    }
  }
  // Alphabetical by name so UI output is stable.
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Remove a component master. Returns true on removal. */
export function deleteComponent(projectDir: string, nameOrSlug: string): boolean {
  const filePath = componentFilePath(projectDir, nameOrSlug);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

// ─── Instance placeholder helpers ────────────────────────────

/**
 * Mint an INSTANCE placeholder node under `parentId`. No children are
 * created here — `expandInstances` will hydrate them on the next load or
 * compile. This keeps the authoring flow symmetric with on-disk format.
 */
export function createInstancePlaceholder(
  graph: SceneGraph,
  parentId: string,
  componentName: string,
  overrides: Record<string, Record<string, unknown>> = {},
  options: { id?: string; name?: string; x?: number; y?: number } = {},
): SceneNode {
  const node = graph.createNode('INSTANCE', parentId, {
    id: options.id,
    name: options.name ?? componentName,
    overrides,
    meta: { componentName },
    x: options.x ?? 0,
    y: options.y ?? 0,
  } as any);
  return node;
}

// ─── Expand / Collapse ───────────────────────────────────────

/**
 * Walk the graph, find every INSTANCE node with `meta.componentName` set,
 * load its master from disk, and hydrate its children from the master
 * subtree. Applies overrides keyed by slot name. Safe to call repeatedly:
 * an instance that's already hydrated (has children) is skipped.
 *
 * Re-id scheme: cloned child ids are `${instanceId}::${originalId}` — the
 * "::" delimiter is distinct from the stable-id `h:<hash>` and legacy `0:N`
 * formats, so `collapseInstances` can reliably detect and strip them.
 *
 * Missing masters (referenced by name but not on disk) do NOT throw —
 * they're recorded in the return value so the caller can surface a warning.
 */
export function expandInstances(
  graph: SceneGraph,
  rootId: string,
  projectDir: string,
): { expanded: number; missing: string[] } {
  const missing = new Set<string>();
  let expanded = 0;

  // Cache masters per invocation so 50 instances of the same component
  // read the file once. Also avoid loading the same master twice.
  const masterCache = new Map<string, ComponentFile | null>();
  function getMaster(name: string): ComponentFile | null {
    if (masterCache.has(name)) return masterCache.get(name) ?? null;
    const m = loadComponentMaster(projectDir, name);
    masterCache.set(name, m);
    return m;
  }

  const visit = (nodeId: string): void => {
    const node = graph.getNode(nodeId);
    if (!node) return;

    if (node.type === 'INSTANCE' && (node.meta as any)?.componentName) {
      const componentName = (node.meta as any).componentName as string;
      // If this instance is already hydrated (has non-empty children) skip.
      if (node.childIds.length === 0) {
        const master = getMaster(componentName);
        if (!master) {
          missing.add(componentName);
        } else {
          hydrateInstance(graph, node, master);
          expanded++;
        }
      }
    }

    // Recurse children — note we walk the ORIGINAL list, not anything we
    // just created, to avoid infinite loops when a component references
    // itself (not supported here but we defend against it anyway).
    for (const cid of [...node.childIds]) visit(cid);
  };
  visit(rootId);

  return { expanded, missing: [...missing] };
}

/**
 * Hydrate a single instance with its master's subtree. Cloned nodes get
 * prefixed ids and overrides are applied to nodes whose slot matches the
 * override key.
 */
function hydrateInstance(
  graph: SceneGraph,
  instance: SceneNode,
  master: ComponentFile,
): void {
  const instanceId = instance.id;
  const overrides = (instance.overrides ?? {}) as Record<string, Record<string, unknown>>;

  // Walk the master root's CHILDREN (not the root itself — the root
  // properties are carried by the instance node, so the master root is
  // effectively a container whose children become the instance's
  // children).
  const rootChildren = (master.root.children ?? []) as INodeJSON[];
  for (const child of rootChildren) {
    cloneSubtreeIntoInstance(graph, child, instance.id, instanceId, overrides);
  }
}

/**
 * Recursively clone a SceneJSON subtree into the target parent, re-id'ing
 * every node with a `<instanceId>::<originalId>` prefix and applying
 * overrides for matching slots.
 */
function cloneSubtreeIntoInstance(
  graph: SceneGraph,
  nodeJson: INodeJSON,
  parentId: string,
  instanceId: string,
  overrides: Record<string, Record<string, unknown>>,
): string {
  const originalId = nodeJson.id ?? `anon:${graph.nodes.size}`;
  const newId = `${instanceId}::${originalId}`;
  const slot = (nodeJson as any).slot as string | undefined;
  const slotOverride = slot && overrides[slot];

  // Build the override bag for this node. Spread the raw json fields we
  // want first, then apply overrides on top so override keys always win.
  const { children: _children, id: _id, ...rest } = nodeJson as any;
  const props: Record<string, unknown> = { ...rest, id: newId };
  if (slotOverride) {
    for (const [k, v] of Object.entries(slotOverride)) {
      props[k] = v;
    }
  }
  // Cloned nodes are not themselves components — they're plain nodes now.
  // If the original was a COMPONENT or INSTANCE, downgrade to FRAME so
  // expand doesn't recurse into a nested master we haven't loaded.
  if (props.type === 'COMPONENT' || props.type === 'COMPONENT_SET') {
    props.type = 'FRAME';
  }
  const type = props.type as any;
  delete props.type;

  const node = graph.createNode(type, parentId, props as any);

  // Recurse children
  const kids = (nodeJson.children ?? []) as INodeJSON[];
  for (const k of kids) {
    cloneSubtreeIntoInstance(graph, k, node.id, instanceId, overrides);
  }
  return node.id;
}

/**
 * Walk the graph and strip every hydrated INSTANCE back to its placeholder
 * form — deleting all children whose id carries the instance-clone prefix.
 * Called BEFORE serializeGraph in saveScene so disk state stays normalized
 * (one line per instance, never the exploded clone tree).
 *
 * Non-placeholder INSTANCE nodes (legacy Figma imports) are left alone:
 * we only collapse nodes whose children match the `::` re-id pattern.
 */
export function collapseInstances(graph: SceneGraph, rootId: string): { collapsed: number } {
  let collapsed = 0;
  const visit = (nodeId: string): void => {
    const node = graph.getNode(nodeId);
    if (!node) return;

    if (node.type === 'INSTANCE' && (node.meta as any)?.componentName) {
      // Does this instance have hydrated children? Any child whose id
      // starts with `${node.id}::` is a clone and should be removed.
      const clones = node.childIds.filter(cid => cid.startsWith(`${node.id}::`));
      if (clones.length > 0) {
        for (const cid of [...clones]) {
          graph.deleteNode(cid);
        }
        collapsed++;
      }
    }

    for (const cid of [...node.childIds]) visit(cid);
  };
  visit(rootId);
  return { collapsed };
}
