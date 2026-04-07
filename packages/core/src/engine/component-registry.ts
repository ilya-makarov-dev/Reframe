/**
 * ComponentRegistry — index over SceneGraph for component operations.
 *
 * The registry does NOT own data. It indexes COMPONENT, COMPONENT_SET,
 * and INSTANCE nodes from the SceneGraph. Provides:
 *   - Define components from existing frames
 *   - Create component sets (variants)
 *   - Instantiate with variant selection + overrides
 *   - Resolve instances (master + variant + overrides merged)
 *   - Propagate master changes to all instances
 *   - Swap variants on existing instances
 */

import type { SceneGraph } from './scene-graph.js';
import type {
  SceneNode, ComponentPropertyDefinition, ComponentInfo, ResolvedInstance,
} from './types.js';

// ─── ComponentRegistry ────────────────────────────────────────────

export class ComponentRegistry {
  // Indices — rebuilt lazily from the graph
  private nameIndex = new Map<string, string>();          // name → componentId
  private setIndex = new Map<string, string[]>();         // setId → variant componentIds
  private dirty = true;

  constructor(private graph: SceneGraph) {}

  // ── Index Management ────────────────────────────────

  markDirty(): void { this.dirty = true; }

  private ensureIndex(): void {
    if (!this.dirty) return;
    this.nameIndex.clear();
    this.setIndex.clear();

    for (const node of this.graph.nodes.values()) {
      if (node.type === 'COMPONENT') {
        this.nameIndex.set(node.name, node.id);
      }
      if (node.type === 'COMPONENT_SET') {
        this.nameIndex.set(node.name, node.id);
        const variants = node.childIds.filter(cid => {
          const child = this.graph.getNode(cid);
          return child?.type === 'COMPONENT';
        });
        this.setIndex.set(node.id, variants);
      }
    }
    this.dirty = false;
  }

  // ── Define ──────────────────────────────────────────

  /**
   * Convert an existing FRAME/GROUP node into a COMPONENT.
   * Returns the component ID.
   */
  defineComponent(nodeId: string, name?: string): string {
    const node = this.graph.getNode(nodeId);
    if (!node) throw new Error(`Node "${nodeId}" not found`);
    if (node.type === 'COMPONENT') return node.id; // already a component

    this.graph.updateNode(nodeId, {
      type: 'COMPONENT' as any,
      name: name ?? node.name,
    });
    this.markDirty();
    return nodeId;
  }

  /**
   * Group multiple COMPONENT nodes into a COMPONENT_SET with variant definitions.
   * Each component must already have variantProperties set.
   */
  defineComponentSet(
    name: string,
    variantComponentIds: string[],
    propertyDefinitions: ComponentPropertyDefinition[],
  ): string {
    if (variantComponentIds.length === 0) throw new Error('Need at least one variant');

    // Validate all are COMPONENT type
    for (const id of variantComponentIds) {
      const node = this.graph.getNode(id);
      if (!node) throw new Error(`Node "${id}" not found`);
      if (node.type !== 'COMPONENT') {
        throw new Error(`Node "${id}" must be COMPONENT type, got ${node.type}`);
      }
    }

    // Find common parent or create set under first component's parent
    const first = this.graph.getNode(variantComponentIds[0])!;
    const parentId = first.parentId ?? this.graph.rootId;

    // Create the COMPONENT_SET node
    const set = this.graph.createNode('COMPONENT_SET', parentId, {
      name,
      componentPropertyDefinitions: propertyDefinitions,
      width: first.width,
      height: first.height,
      x: first.x,
      y: first.y,
    });

    // Reparent all variants under the set
    for (const id of variantComponentIds) {
      this.graph.reparentNode(id, set.id);
    }

    // Mark first as default if none is
    const hasDefault = variantComponentIds.some(id => {
      const n = this.graph.getNode(id);
      return n?.isDefaultVariant;
    });
    if (!hasDefault) {
      this.graph.updateNode(variantComponentIds[0], { isDefaultVariant: true });
    }

    this.markDirty();
    return set.id;
  }

  // ── Instantiate ─────────────────────────────────────

  /**
   * Create an instance of a component or variant.
   * If componentId points to a COMPONENT_SET, variant selection picks the right child.
   */
  createInstance(
    componentId: string,
    parentId: string,
    opts?: {
      variant?: Record<string, string>;
      overrides?: Record<string, Record<string, unknown>>;
      x?: number;
      y?: number;
    },
  ): string {
    const comp = this.graph.getNode(componentId);
    if (!comp) throw new Error(`Component "${componentId}" not found`);

    let targetCompId = componentId;

    // If it's a COMPONENT_SET, resolve the right variant
    if (comp.type === 'COMPONENT_SET') {
      targetCompId = this.resolveVariantId(componentId, opts?.variant ?? {});
    }

    const instance = this.graph.createInstance(targetCompId, parentId, {
      x: opts?.x ?? 0,
      y: opts?.y ?? 0,
      variantProperties: opts?.variant ?? {},
      overrides: opts?.overrides ?? {},
    });

    if (!instance) throw new Error(`Failed to create instance of "${targetCompId}"`);

    // Store and apply overrides
    if (opts?.overrides && Object.keys(opts.overrides).length > 0) {
      this.graph.updateNode(instance.id, { overrides: opts.overrides });
      this.applyOverrides(instance.id);
    }

    this.markDirty();
    return instance.id;
  }

  // ── Variant Resolution ──────────────────────────────

  /**
   * Find the variant COMPONENT ID that matches the given property selection.
   * Falls back to default variant.
   */
  resolveVariantId(setId: string, selection: Record<string, string>): string {
    this.ensureIndex();
    const variantIds = this.setIndex.get(setId);
    if (!variantIds || variantIds.length === 0) {
      throw new Error(`Component set "${setId}" has no variants`);
    }

    // Try exact match
    for (const vid of variantIds) {
      const node = this.graph.getNode(vid);
      if (!node) continue;
      if (matchesVariant(node.variantProperties, selection)) return vid;
    }

    // Try closest match (most matching properties)
    let bestId = variantIds[0];
    let bestScore = -1;
    for (const vid of variantIds) {
      const node = this.graph.getNode(vid);
      if (!node) continue;
      let score = 0;
      for (const [key, val] of Object.entries(selection)) {
        if (node.variantProperties[key] === val) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestId = vid;
      }
    }

    // Fall back to default variant
    if (bestScore === 0) {
      for (const vid of variantIds) {
        const node = this.graph.getNode(vid);
        if (node?.isDefaultVariant) return vid;
      }
    }

    return bestId;
  }

  /**
   * Swap variant on an existing INSTANCE node.
   * Re-clones children from the new variant master while preserving overrides.
   */
  swapVariant(instanceId: string, changes: Record<string, string>): void {
    const instance = this.graph.getNode(instanceId);
    if (!instance || instance.type !== 'INSTANCE') {
      throw new Error(`"${instanceId}" is not an instance`);
    }
    if (!instance.componentId) throw new Error('Instance has no componentId');

    // Find the COMPONENT_SET
    const master = this.graph.getNode(instance.componentId);
    if (!master) throw new Error('Master component not found');

    const setId = master.type === 'COMPONENT_SET' ? master.id
      : master.parentId ? this.graph.getNode(master.parentId)?.type === 'COMPONENT_SET' ? master.parentId : null
      : null;

    if (!setId) throw new Error('Component is not part of a variant set');

    // Merge current + new variant properties
    const newVariant = { ...instance.variantProperties, ...changes };
    const newCompId = this.resolveVariantId(setId, newVariant);

    // Preserve overrides
    const savedOverrides = JSON.parse(JSON.stringify(instance.overrides));

    // Delete old children
    for (const childId of [...instance.childIds]) {
      this.graph.deleteNode(childId);
    }

    // Clone new variant's children into instance
    const newComp = this.graph.getNode(newCompId)!;
    for (const childId of newComp.childIds) {
      this.graph.cloneTree(childId, instanceId);
    }

    // Update instance metadata
    this.graph.updateNode(instanceId, {
      componentId: newCompId,
      variantProperties: newVariant,
      overrides: savedOverrides,
      width: newComp.width,
      height: newComp.height,
    });

    // Re-apply overrides to new children
    this.applyOverrides(instanceId);
    this.markDirty();
  }

  // ── Override Resolution ─────────────────────────────

  /**
   * Apply stored overrides to an instance's children.
   * Overrides keyed by path (e.g. "Label", "Container/Icon").
   */
  applyOverrides(instanceId: string): void {
    const instance = this.graph.getNode(instanceId);
    if (!instance) return;

    for (const [path, props] of Object.entries(instance.overrides)) {
      if (path === '.') {
        // Root-level overrides — apply to instance itself (except structural)
        const { type, id, parentId, childIds, ...safeProps } = props as any;
        this.graph.updateNode(instanceId, safeProps);
        continue;
      }

      const targetId = this.resolvePathToId(instanceId, path);
      if (targetId) {
        const { type, id, parentId, childIds, ...safeProps } = props as any;
        this.graph.updateNode(targetId, safeProps);
      }
    }
  }

  /**
   * Set overrides on an instance. Merges with existing overrides.
   */
  setOverrides(instanceId: string, overrides: Record<string, Record<string, unknown>>): void {
    const instance = this.graph.getNode(instanceId);
    if (!instance || instance.type !== 'INSTANCE') {
      throw new Error(`"${instanceId}" is not an instance`);
    }

    const merged = { ...instance.overrides };
    for (const [path, props] of Object.entries(overrides)) {
      merged[path] = { ...(merged[path] ?? {}), ...props };
    }

    this.graph.updateNode(instanceId, { overrides: merged });
    this.applyOverrides(instanceId);
  }

  // ── Resolve ─────────────────────────────────────────

  /**
   * Resolve an instance: compute effective properties from master + overrides.
   */
  resolveInstance(instanceId: string): ResolvedInstance {
    const instance = this.graph.getNode(instanceId);
    if (!instance || instance.type !== 'INSTANCE') {
      throw new Error(`"${instanceId}" is not an instance`);
    }

    return {
      instanceId,
      componentId: instance.componentId ?? '',
      variantKey: normalizeVariantKey(instance.variantProperties),
      overriddenPaths: Object.keys(instance.overrides),
      childCount: instance.childIds.length,
    };
  }

  // ── Propagate ───────────────────────────────────────

  /**
   * Push master component changes to all instances.
   * Re-clones children, re-applies overrides.
   */
  propagateChanges(componentId: string): number {
    const instances = this.graph.getInstances(componentId);
    let updated = 0;

    for (const instance of instances) {
      const savedOverrides = JSON.parse(JSON.stringify(instance.overrides));
      const savedVariant = { ...instance.variantProperties };
      const savedPos = { x: instance.x, y: instance.y };

      // Delete old children
      for (const childId of [...instance.childIds]) {
        this.graph.deleteNode(childId);
      }

      // Clone master children
      const master = this.graph.getNode(componentId);
      if (!master) continue;

      for (const childId of master.childIds) {
        this.graph.cloneTree(childId, instance.id);
      }

      // Restore instance properties
      this.graph.updateNode(instance.id, {
        width: master.width,
        height: master.height,
        overrides: savedOverrides,
        variantProperties: savedVariant,
        ...savedPos,
      });

      // Re-apply overrides
      this.applyOverrides(instance.id);
      updated++;
    }

    return updated;
  }

  // ── Detach ──────────────────────────────────────────

  detachInstance(instanceId: string): void {
    this.graph.detachInstance(instanceId);
    this.markDirty();
  }

  // ── Query ───────────────────────────────────────────

  listComponents(): ComponentInfo[] {
    this.ensureIndex();
    const result: ComponentInfo[] = [];

    for (const node of this.graph.nodes.values()) {
      if (node.type === 'COMPONENT_SET') {
        const variants = this.setIndex.get(node.id) ?? [];
        let instanceCount = 0;
        for (const vid of variants) {
          instanceCount += this.graph.getInstances(vid).length;
        }
        result.push({
          id: node.id,
          name: node.name,
          type: 'COMPONENT_SET',
          variantCount: variants.length,
          instanceCount,
          propertyDefinitions: node.componentPropertyDefinitions ?? [],
        });
      } else if (node.type === 'COMPONENT') {
        // Only list top-level components (not those inside a set)
        const parent = node.parentId ? this.graph.getNode(node.parentId) : null;
        if (parent?.type === 'COMPONENT_SET') continue;

        result.push({
          id: node.id,
          name: node.name,
          type: 'COMPONENT',
          variantCount: 0,
          instanceCount: this.graph.getInstances(node.id).length,
          propertyDefinitions: node.componentPropertyDefinitions ?? [],
        });
      }
    }

    return result;
  }

  listInstances(componentId: string): Array<{ id: string; name: string; overrideCount: number }> {
    const instances = this.graph.getInstances(componentId);
    return instances.map(inst => ({
      id: inst.id,
      name: inst.name,
      overrideCount: Object.keys(inst.overrides).length,
    }));
  }

  getComponentByName(name: string): SceneNode | undefined {
    this.ensureIndex();
    const id = this.nameIndex.get(name);
    return id ? this.graph.getNode(id) : undefined;
  }

  // ── Path Resolution ─────────────────────────────────

  /**
   * Resolve a dot-separated path like "Container/Label" to a node ID
   * within an instance's subtree.
   */
  private resolvePathToId(rootId: string, path: string): string | null {
    const parts = path.split('/');
    let currentId = rootId;

    for (const part of parts) {
      const parent = this.graph.getNode(currentId);
      if (!parent) return null;

      // Handle indexed names: "Label[1]"
      const indexMatch = part.match(/^(.+)\[(\d+)\]$/);
      const targetName = indexMatch ? indexMatch[1] : part;
      const targetIndex = indexMatch ? parseInt(indexMatch[2]) : 0;

      let found = false;
      let matchIndex = 0;
      for (const childId of parent.childIds) {
        const child = this.graph.getNode(childId);
        if (child?.name === targetName) {
          if (matchIndex === targetIndex) {
            currentId = childId;
            found = true;
            break;
          }
          matchIndex++;
        }
      }

      if (!found) return null;
    }

    return currentId === rootId ? null : currentId;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

function matchesVariant(
  nodeVariant: Record<string, string>,
  selection: Record<string, string>,
): boolean {
  for (const [key, val] of Object.entries(selection)) {
    if (nodeVariant[key] !== val) return false;
  }
  // All selection keys must match, but node can have extra props
  return Object.keys(selection).length > 0;
}

export function normalizeVariantKey(props: Record<string, string>): string {
  return Object.entries(props)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
}
