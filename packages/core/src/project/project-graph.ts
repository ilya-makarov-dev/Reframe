/**
 * ProjectGraph — the project manifest as a SceneGraph.
 *
 * Instead of a plain JSON manifest, the project itself is an INode tree:
 *
 *   PROJECT (root FRAME)
 *   ├── meta (GROUP)         — name, version, dates
 *   ├── registry (GROUP)     — brands, components, macros
 *   │   ├── brands (GROUP)
 *   │   ├── components (GROUP)
 *   │   └── macros (GROUP)
 *   └── scenes (GROUP)       — scene reference nodes
 *       ├── home (FRAME)     — meta.slug = "home", points to scenes/home.scene.json
 *       └── pricing (FRAME)  — meta.slug = "pricing"
 *
 * Scene-ref nodes are NOT embedded scene content — they're lightweight
 * FRAME nodes whose `meta` carries the slug, revision, brand, etc.
 * Actual scene graphs live in separate .scene.json files.
 *
 * This gives us: audit, diff, export, ops on the project structure itself.
 */

import { SceneGraph } from '../engine/scene-graph.js';
import type { SceneNode, NodeMeta } from '../engine/types.js';
import type { ProjectManifest, SceneEntry, BrandRegistryEntry } from './types.js';
import { PROJECT_VERSION } from './types.js';

// ─── Structure helpers ──────────────────────────────────────

const META_NAME = '__meta';
const REGISTRY_NAME = '__registry';
const SCENES_NAME = '__scenes';
const BRANDS_NAME = '__brands';
const COMPONENTS_NAME = '__components';
const MACROS_NAME = '__macros';

function findChildByName(graph: SceneGraph, parentId: string, name: string): SceneNode | undefined {
  const parent = graph.getNode(parentId);
  if (!parent) return undefined;
  for (const cid of parent.childIds) {
    const child = graph.getNode(cid);
    if (child?.name === name) return child;
  }
  return undefined;
}

function getOrCreateChild(graph: SceneGraph, parentId: string, name: string, type: 'GROUP' | 'FRAME' = 'GROUP'): SceneNode {
  const existing = findChildByName(graph, parentId, name);
  if (existing) return existing;
  return graph.createNode(type, parentId, { name });
}

function findChildBySlug(graph: SceneGraph, parentId: string, slug: string): SceneNode | undefined {
  const parent = graph.getNode(parentId);
  if (!parent) return undefined;
  for (const cid of parent.childIds) {
    const child = graph.getNode(cid);
    if (child?.meta?.slug === slug) return child;
  }
  return undefined;
}

// ─── ProjectGraph ───────────────────────────────────────────

export class ProjectGraph {
  readonly graph: SceneGraph;
  readonly rootId: string;

  constructor(graph: SceneGraph, rootId: string) {
    this.graph = graph;
    this.rootId = rootId;
  }

  // ── Factory ─────────────────────────────────────────────

  static create(name: string): ProjectGraph {
    const graph = new SceneGraph();
    const page = graph.addPage('Project');
    const root = graph.createNode('FRAME', page.id, {
      name,
      width: 1440,
      height: 900,
      semanticRole: 'main',
    });

    // Structure groups
    const meta = graph.createNode('GROUP', root.id, { name: META_NAME });
    graph.createNode('TEXT', meta.id, { name: 'project-name', text: name });
    graph.createNode('TEXT', meta.id, {
      name: 'project-version',
      text: String(PROJECT_VERSION),
    });
    graph.createNode('TEXT', meta.id, {
      name: 'project-created',
      text: new Date().toISOString(),
    });

    const registry = graph.createNode('GROUP', root.id, { name: REGISTRY_NAME });
    graph.createNode('GROUP', registry.id, { name: BRANDS_NAME });
    graph.createNode('GROUP', registry.id, { name: COMPONENTS_NAME });
    graph.createNode('GROUP', registry.id, { name: MACROS_NAME });

    graph.createNode('GROUP', root.id, {
      name: SCENES_NAME,
      semanticRole: 'section',
    });

    return new ProjectGraph(graph, root.id);
  }

  // ── Navigation ──────────────────────────────────────────

  get metaGroup(): SceneNode {
    return getOrCreateChild(this.graph, this.rootId, META_NAME);
  }

  get registryGroup(): SceneNode {
    return getOrCreateChild(this.graph, this.rootId, REGISTRY_NAME);
  }

  get scenesGroup(): SceneNode {
    return getOrCreateChild(this.graph, this.rootId, SCENES_NAME);
  }

  get brandsGroup(): SceneNode {
    return getOrCreateChild(this.graph, this.registryGroup.id, BRANDS_NAME);
  }

  get componentsGroup(): SceneNode {
    return getOrCreateChild(this.graph, this.registryGroup.id, COMPONENTS_NAME);
  }

  get macrosGroup(): SceneNode {
    return getOrCreateChild(this.graph, this.registryGroup.id, MACROS_NAME);
  }

  // ── Project metadata ────────────────────────────────────

  get name(): string {
    const nameNode = findChildByName(this.graph, this.metaGroup.id, 'project-name');
    return nameNode?.text ?? 'Untitled';
  }

  set name(value: string) {
    const nameNode = findChildByName(this.graph, this.metaGroup.id, 'project-name');
    if (nameNode) {
      this.graph.updateNode(nameNode.id, { text: value });
    }
    this.graph.updateNode(this.rootId, { name: value });
  }

  get activeBrand(): string | undefined {
    const root = this.graph.getNode(this.rootId);
    return root?.meta?.brand;
  }

  set activeBrand(slug: string | undefined) {
    const root = this.graph.getNode(this.rootId);
    if (!root) return;
    this.graph.updateNode(this.rootId, {
      meta: { ...root.meta, brand: slug },
    });
  }

  // ── Scene references ────────────────────────────────────

  addSceneRef(entry: SceneEntry): SceneNode {
    // Update existing if same slug
    const existing = findChildBySlug(this.graph, this.scenesGroup.id, entry.slug);
    if (existing) {
      this.graph.updateNode(existing.id, {
        name: entry.name,
        width: entry.width,
        height: entry.height,
        meta: {
          ...existing.meta,
          sourceTag: 'scene-ref',
          slug: entry.slug,
          revision: entry.revision,
          source: entry.source,
          brand: entry.brand,
          brandHash: entry.brandHash,
          group: entry.group,
          tags: entry.tags,
          nodeCount: entry.nodes,
          variantOf: entry.variantOf,
        },
      });
      return this.graph.getNode(existing.id)!;
    }

    return this.graph.createNode('FRAME', this.scenesGroup.id, {
      name: entry.name,
      width: entry.width,
      height: entry.height,
      semanticRole: 'card',
      meta: {
        sourceTag: 'scene-ref',
        slug: entry.slug,
        revision: entry.revision,
        source: entry.source,
        brand: entry.brand,
        brandHash: entry.brandHash,
        group: entry.group,
        tags: entry.tags,
        nodeCount: entry.nodes,
        variantOf: entry.variantOf,
      },
    });
  }

  getSceneRef(slug: string): SceneNode | null {
    return findChildBySlug(this.graph, this.scenesGroup.id, slug) ?? null;
  }

  removeSceneRef(slug: string): boolean {
    const node = findChildBySlug(this.graph, this.scenesGroup.id, slug);
    if (!node) return false;
    this.graph.deleteNode(node.id);
    return true;
  }

  listSceneRefs(): SceneEntry[] {
    const group = this.scenesGroup;
    return group.childIds
      .map(id => this.graph.getNode(id))
      .filter((n): n is SceneNode => !!n && n.meta?.sourceTag === 'scene-ref')
      .map(n => nodeToSceneEntry(n));
  }

  // ── Brands ──────────────────────────────────────────────

  addBrand(entry: BrandRegistryEntry): SceneNode {
    const existing = findChildBySlug(this.graph, this.brandsGroup.id, entry.slug);
    if (existing) {
      this.graph.updateNode(existing.id, {
        name: entry.slug,
        meta: {
          ...existing.meta,
          sourceTag: 'brand-ref',
          slug: entry.slug,
          brandHash: entry.hash,
          brandLabel: entry.label,
          source: entry.path,
          registeredAt: entry.updated,
        },
      });
      return this.graph.getNode(existing.id)!;
    }

    return this.graph.createNode('FRAME', this.brandsGroup.id, {
      name: entry.slug,
      semanticRole: 'badge',
      meta: {
        sourceTag: 'brand-ref',
        slug: entry.slug,
        brandHash: entry.hash,
        brandLabel: entry.label,
        source: entry.path,
        registeredAt: entry.updated,
      },
    });
  }

  listBrands(): BrandRegistryEntry[] {
    const group = this.brandsGroup;
    return group.childIds
      .map(id => this.graph.getNode(id))
      .filter((n): n is SceneNode => !!n && n.meta?.sourceTag === 'brand-ref')
      .map(n => ({
        slug: n.meta.slug!,
        path: n.meta.source ?? `brands/${n.meta.slug}/DESIGN.md`,
        hash: n.meta.brandHash ?? '',
        label: n.meta.brandLabel,
        updated: n.meta.registeredAt ?? new Date().toISOString(),
      }));
  }

  // ── Manifest compatibility ──────────────────────────────

  toManifest(): ProjectManifest {
    const root = this.graph.getNode(this.rootId);
    const createdNode = findChildByName(this.graph, this.metaGroup.id, 'project-created');

    const brands: Record<string, BrandRegistryEntry> = {};
    for (const b of this.listBrands()) {
      brands[b.slug] = b;
    }

    return {
      version: PROJECT_VERSION,
      name: this.name,
      created: createdNode?.text ?? new Date().toISOString(),
      updated: new Date().toISOString(),
      brands,
      activeBrand: root?.meta?.brand,
      scenes: this.listSceneRefs(),
    };
  }

  static fromManifest(manifest: ProjectManifest): ProjectGraph {
    const pg = ProjectGraph.create(manifest.name);

    // Set created date
    const createdNode = findChildByName(pg.graph, pg.metaGroup.id, 'project-created');
    if (createdNode) {
      pg.graph.updateNode(createdNode.id, { text: manifest.created });
    }

    // Active brand
    if (manifest.activeBrand) {
      pg.activeBrand = manifest.activeBrand;
    }

    // Brands
    if (manifest.brands) {
      for (const entry of Object.values(manifest.brands)) {
        pg.addBrand(entry);
      }
    }

    // Scenes
    for (const entry of manifest.scenes) {
      pg.addSceneRef(entry);
    }

    return pg;
  }

  // ── Serialize / Deserialize ─────────────────────────────

  serialize(): object {
    // Use core serializer for round-trip fidelity
    const { serializeSceneNode } = require('../serialize.js');
    return serializeSceneNode(this.graph, this.rootId, { compact: true });
  }

  static deserialize(json: object): ProjectGraph {
    const { deserializeToGraph } = require('../serialize.js');
    const { graph, rootId } = deserializeToGraph(json);
    return new ProjectGraph(graph, rootId);
  }
}

// ─── Helpers ────────────────────────────────────────────────

function nodeToSceneEntry(n: SceneNode): SceneEntry {
  const m = n.meta ?? {};
  const slug = m.slug ?? n.name;
  return {
    id: slug,
    slug,
    name: n.name,
    file: `scenes/${slug}.scene.json`,
    width: n.width,
    height: n.height,
    nodes: m.nodeCount,
    group: m.group,
    tags: m.tags,
    source: m.source,
    revision: m.revision,
    variantOf: m.variantOf,
    brand: m.brand,
    brandHash: m.brandHash,
    created: m.registeredAt ?? new Date().toISOString(),
    updated: new Date().toISOString(),
  };
}
