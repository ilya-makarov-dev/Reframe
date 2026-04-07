/**
 * Reframe Standalone Engine — Scene Graph
 *
 * Map-based node tree with CRUD, clone, group, reparent, absolute position cache.
 * Based on OpenPencil's SceneGraph, adapted for reframe.
 */

import type {
  SceneNode, NodeType, SceneGraphEvents,
  Variable, VariableCollection, VariableType, VariableValue,
  Color, Vector,
} from './types';
import { CONTAINER_TYPES } from './types';
import { computeAbsolutePosition } from './geometry';

// ─── Simple Event Emitter ───────────────────────────────────────

type Listener<T extends (...args: any[]) => void> = T;

class Emitter<Events extends { [K: string]: (...args: any[]) => void }> {
  private listeners = new Map<string, Set<Function>>();

  on<K extends keyof Events & string>(event: K, fn: Listener<Events[K]>): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  emit<K extends keyof Events & string>(event: K, ...args: Parameters<Events[K]>): void {
    this.listeners.get(event)?.forEach(fn => (fn as any)(...args));
  }
}

// ─── ID Generator ───────────────────────────────────────────────

let _nextId = 1;

export function generateId(): string {
  return `0:${_nextId++}`;
}

export function resetIdCounter(start = 1): void {
  _nextId = start;
}

// ─── Default Node ───────────────────────────────────────────────

export function createDefaultNode(type: NodeType, id: string): SceneNode {
  return {
    id,
    type,
    name: type,
    parentId: null,
    childIds: [],

    x: 0, y: 0, width: 100, height: 100,
    rotation: 0, flipX: false, flipY: false,

    fills: [],
    strokes: [],
    effects: [],
    opacity: 1,
    blendMode: 'PASS_THROUGH',
    visible: true,
    locked: false,
    clipsContent: false,

    cornerRadius: 0,
    topLeftRadius: 0, topRightRadius: 0,
    bottomRightRadius: 0, bottomLeftRadius: 0,
    independentCorners: false,
    cornerSmoothing: 0,

    strokeCap: 'NONE',
    strokeJoin: 'MITER',
    dashPattern: [],
    borderTopWeight: 1, borderRightWeight: 1,
    borderBottomWeight: 1, borderLeftWeight: 1,
    independentStrokeWeights: false,
    strokeMiterLimit: 4,

    text: '',
    fontSize: 16,
    fontFamily: 'Inter',
    fontWeight: 400,
    italic: false,
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
    textAutoResize: 'NONE',
    textCase: 'ORIGINAL',
    textDecoration: 'NONE',
    lineHeight: null,
    letterSpacing: 0,
    maxLines: null,
    styleRuns: [],
    textTruncation: 'DISABLED',
    textPicture: null,

    horizontalConstraint: 'MIN',
    verticalConstraint: 'MIN',

    layoutMode: 'NONE',
    layoutWrap: 'NO_WRAP',
    primaryAxisAlign: 'MIN',
    counterAxisAlign: 'MIN',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    itemSpacing: 0,
    counterAxisSpacing: 0,
    paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,

    layoutPositioning: 'AUTO',
    layoutGrow: 0,
    layoutAlignSelf: 'AUTO',

    gridTemplateColumns: [],
    gridTemplateRows: [],
    gridColumnGap: 0,
    gridRowGap: 0,
    gridPosition: null,
    counterAxisAlignContent: 'AUTO',
    itemReverseZIndex: false,
    strokesIncludedInLayout: false,

    minWidth: null, maxWidth: null,
    minHeight: null, maxHeight: null,

    vectorNetwork: null,
    fillGeometry: [],
    strokeGeometry: [],
    arcData: null,

    isMask: false,
    maskType: 'ALPHA',

    pointCount: 3,
    starInnerRadius: 0.5,
    expanded: false,
    autoRename: true,

    semanticRole: null,
    slot: null,
    href: null,
    contentSlots: [],

    states: {},
    responsive: [],

    componentId: null,
    overrides: {},
    variantProperties: {},
    componentPropertyDefinitions: null,
    isDefaultVariant: false,
    boundVariables: {},
    internalOnly: false,
  };
}

// ─── SceneGraph ─────────────────────────────────────────────────

export class SceneGraph {
  readonly nodes = new Map<string, SceneNode>();
  readonly images = new Map<string, Uint8Array>();
  readonly variables = new Map<string, Variable>();
  readonly variableCollections = new Map<string, VariableCollection>();
  readonly activeMode = new Map<string, string>();
  readonly emitter = new Emitter<SceneGraphEvents>();

  rootId: string;

  // Caches
  private absPosCache = new Map<string, Vector>();
  private instanceIndex = new Map<string, Set<string>>();

  constructor() {
    const root = createDefaultNode('CANVAS', generateId());
    root.name = 'Document';
    this.rootId = root.id;
    this.nodes.set(root.id, root);
  }

  // ── Page Management ─────────────────────────────

  addPage(name = 'Page 1'): SceneNode {
    return this.createNode('CANVAS', this.rootId, { name });
  }

  getPages(includeInternal = false): SceneNode[] {
    const root = this.nodes.get(this.rootId);
    if (!root) return [];
    return root.childIds
      .map(id => this.nodes.get(id))
      .filter((n): n is SceneNode =>
        !!n && n.type === 'CANVAS' && (includeInternal || !n.internalOnly)
      );
  }

  // ── Node Access ─────────────────────────────────

  getNode(id: string): SceneNode | undefined {
    return this.nodes.get(id);
  }

  getAllNodes(): IterableIterator<SceneNode> {
    return this.nodes.values();
  }

  getChildren(id: string): SceneNode[] {
    const node = this.nodes.get(id);
    if (!node) return [];
    return node.childIds
      .map(cid => this.nodes.get(cid))
      .filter((n): n is SceneNode => !!n);
  }

  isContainer(id: string): boolean {
    const node = this.nodes.get(id);
    return !!node && CONTAINER_TYPES.has(node.type);
  }

  isDescendant(childId: string, ancestorId: string): boolean {
    let current = this.nodes.get(childId);
    while (current) {
      if (current.parentId === ancestorId) return true;
      if (!current.parentId) return false;
      current = this.nodes.get(current.parentId);
    }
    return false;
  }

  // ── CRUD ────────────────────────────────────────

  createNode(type: NodeType, parentId: string, overrides?: Partial<SceneNode>): SceneNode {
    const id = generateId();
    const node = createDefaultNode(type, id);
    node.parentId = parentId;

    if (overrides) {
      Object.assign(node, overrides);
      node.id = id; // preserve generated id
      node.parentId = parentId;
    }

    this.nodes.set(id, node);

    const parent = this.nodes.get(parentId);
    if (parent) {
      parent.childIds.push(id);
    }

    // Track instances
    if (type === 'INSTANCE' && node.componentId) {
      this._trackInstance(node.componentId, id);
    }

    this.emitter.emit('node:created', node);
    return node;
  }

  updateNode(id: string, changes: Partial<SceneNode>): void {
    const node = this.nodes.get(id);
    if (!node) return;

    Object.assign(node, changes);

    // Invalidate absolute position cache on geometry changes
    if ('x' in changes || 'y' in changes || 'width' in changes || 'height' in changes) {
      this.clearAbsPosCache();
    }

    this.emitter.emit('node:updated', id, changes);
  }

  deleteNode(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;

    // Recursively delete children
    for (const childId of [...node.childIds]) {
      this.deleteNode(childId);
    }

    // Remove from parent
    if (node.parentId) {
      const parent = this.nodes.get(node.parentId);
      if (parent) {
        parent.childIds = parent.childIds.filter(cid => cid !== id);
      }
    }

    // Untrack instance
    if (node.type === 'INSTANCE' && node.componentId) {
      this.instanceIndex.get(node.componentId)?.delete(id);
    }

    this.nodes.delete(id);
    this.absPosCache.delete(id);
    this.emitter.emit('node:deleted', id);
  }

  // ── Clone ───────────────────────────────────────

  cloneTree(sourceId: string, parentId: string, overrides?: Partial<SceneNode>): SceneNode | null {
    const source = this.nodes.get(sourceId);
    if (!source) return null;

    const cloned = this.createNode(source.type, parentId, {
      ...this._cloneProps(source),
      ...overrides,
    });

    // Deep clone children
    for (const childId of source.childIds) {
      this.cloneTree(childId, cloned.id);
    }

    return cloned;
  }

  private _cloneProps(node: SceneNode): Partial<SceneNode> {
    return {
      name: node.name,
      x: node.x, y: node.y,
      width: node.width, height: node.height,
      rotation: node.rotation, flipX: node.flipX, flipY: node.flipY,
      fills: JSON.parse(JSON.stringify(node.fills)),
      strokes: JSON.parse(JSON.stringify(node.strokes)),
      effects: JSON.parse(JSON.stringify(node.effects)),
      opacity: node.opacity, blendMode: node.blendMode,
      visible: node.visible, locked: node.locked,
      clipsContent: node.clipsContent,
      cornerRadius: node.cornerRadius,
      topLeftRadius: node.topLeftRadius, topRightRadius: node.topRightRadius,
      bottomRightRadius: node.bottomRightRadius, bottomLeftRadius: node.bottomLeftRadius,
      independentCorners: node.independentCorners,
      cornerSmoothing: node.cornerSmoothing,
      text: node.text, fontSize: node.fontSize,
      fontFamily: node.fontFamily, fontWeight: node.fontWeight,
      italic: node.italic,
      textAlignHorizontal: node.textAlignHorizontal,
      textAlignVertical: node.textAlignVertical,
      textAutoResize: node.textAutoResize,
      textCase: node.textCase, textDecoration: node.textDecoration,
      lineHeight: node.lineHeight, letterSpacing: node.letterSpacing,
      maxLines: node.maxLines,
      styleRuns: JSON.parse(JSON.stringify(node.styleRuns)),
      layoutMode: node.layoutMode, layoutWrap: node.layoutWrap,
      primaryAxisAlign: node.primaryAxisAlign,
      counterAxisAlign: node.counterAxisAlign,
      primaryAxisSizing: node.primaryAxisSizing,
      counterAxisSizing: node.counterAxisSizing,
      itemSpacing: node.itemSpacing,
      counterAxisSpacing: node.counterAxisSpacing,
      paddingTop: node.paddingTop, paddingRight: node.paddingRight,
      paddingBottom: node.paddingBottom, paddingLeft: node.paddingLeft,
      layoutPositioning: node.layoutPositioning,
      layoutGrow: node.layoutGrow,
      layoutAlignSelf: node.layoutAlignSelf,
      horizontalConstraint: node.horizontalConstraint,
      verticalConstraint: node.verticalConstraint,
      componentId: node.componentId,
      overrides: JSON.parse(JSON.stringify(node.overrides)),
      variantProperties: { ...node.variantProperties },
      componentPropertyDefinitions: node.componentPropertyDefinitions
        ? JSON.parse(JSON.stringify(node.componentPropertyDefinitions)) : null,
      isDefaultVariant: node.isDefaultVariant,
      pointCount: node.pointCount,
      starInnerRadius: node.starInnerRadius,
    };
  }

  // ── Reparent & Reorder ──────────────────────────

  reparentNode(nodeId: string, newParentId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    const oldParentId = node.parentId;

    // Remove from old parent
    if (oldParentId) {
      const oldParent = this.nodes.get(oldParentId);
      if (oldParent) {
        oldParent.childIds = oldParent.childIds.filter(cid => cid !== nodeId);
      }
    }

    // Adjust coordinates to maintain visual position
    const oldAbs = this.getAbsolutePosition(nodeId);
    node.parentId = newParentId;
    const newParent = this.nodes.get(newParentId);
    if (newParent) {
      newParent.childIds.push(nodeId);
      const parentAbs = this.getAbsolutePosition(newParentId);
      node.x = oldAbs.x - parentAbs.x;
      node.y = oldAbs.y - parentAbs.y;
    }

    this.clearAbsPosCache();
    this.emitter.emit('node:reparented', nodeId, oldParentId, newParentId);
  }

  reorderChild(nodeId: string, parentId: string, insertIndex: number): void {
    const parent = this.nodes.get(parentId);
    if (!parent) return;

    parent.childIds = parent.childIds.filter(cid => cid !== nodeId);
    parent.childIds.splice(insertIndex, 0, nodeId);

    this.emitter.emit('node:reordered', nodeId, parentId, insertIndex);
  }

  // ── Grouping ────────────────────────────────────

  groupNodes(nodeIds: string[], parentId: string, insertIndex?: number): SceneNode {
    const group = this.createNode('GROUP', parentId, { name: 'Group' });

    // Compute group bounds
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const nid of nodeIds) {
      const n = this.nodes.get(nid);
      if (!n) continue;
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }

    group.x = minX;
    group.y = minY;
    group.width = maxX - minX;
    group.height = maxY - minY;

    // Move nodes into group
    for (const nid of nodeIds) {
      const n = this.nodes.get(nid);
      if (!n) continue;

      // Remove from old parent
      if (n.parentId) {
        const old = this.nodes.get(n.parentId);
        if (old) {
          old.childIds = old.childIds.filter(cid => cid !== nid);
        }
      }

      n.parentId = group.id;
      n.x -= minX;
      n.y -= minY;
      group.childIds.push(nid);
    }

    // Reorder if specified
    if (insertIndex !== undefined) {
      this.reorderChild(group.id, parentId, insertIndex);
    }

    this.clearAbsPosCache();
    return group;
  }

  // ── Absolute Position ───────────────────────────

  clearAbsPosCache(): void {
    this.absPosCache.clear();
  }

  getAbsolutePosition(id: string): Vector {
    const cached = this.absPosCache.get(id);
    if (cached) return cached;

    const pos = computeAbsolutePosition(
      id,
      (nid) => this.nodes.get(nid),
      'CANVAS',
    );

    this.absPosCache.set(id, pos);
    return pos;
  }

  getAbsoluteBounds(id: string): { x: number; y: number; width: number; height: number } {
    const pos = this.getAbsolutePosition(id);
    const node = this.nodes.get(id);
    return {
      x: pos.x,
      y: pos.y,
      width: node?.width ?? 0,
      height: node?.height ?? 0,
    };
  }

  // ── Flatten ─────────────────────────────────────

  flattenTree(parentId?: string, depth = 0): Array<{ node: SceneNode; depth: number }> {
    const id = parentId ?? this.rootId;
    const node = this.nodes.get(id);
    if (!node) return [];

    const result: Array<{ node: SceneNode; depth: number }> = [{ node, depth }];
    for (const childId of node.childIds) {
      result.push(...this.flattenTree(childId, depth + 1));
    }
    return result;
  }

  // ── Instances ───────────────────────────────────

  private _trackInstance(componentId: string, instanceId: string): void {
    if (!this.instanceIndex.has(componentId)) {
      this.instanceIndex.set(componentId, new Set());
    }
    this.instanceIndex.get(componentId)!.add(instanceId);
  }

  getInstances(componentId: string): SceneNode[] {
    const ids = this.instanceIndex.get(componentId);
    if (!ids) return [];
    return [...ids]
      .map(id => this.nodes.get(id))
      .filter((n): n is SceneNode => !!n);
  }

  getMainComponent(instanceId: string): SceneNode | undefined {
    const instance = this.nodes.get(instanceId);
    if (!instance?.componentId) return undefined;
    return this.nodes.get(instance.componentId);
  }

  createInstance(
    componentId: string,
    parentId: string,
    overrides?: Partial<SceneNode>,
  ): SceneNode | null {
    const comp = this.nodes.get(componentId);
    if (!comp) return null;

    const instance = this.cloneTree(componentId, parentId, {
      ...overrides,
      componentId,
    });

    if (instance) {
      // Fix type to INSTANCE
      instance.type = 'INSTANCE' as any;
      this._trackInstance(componentId, instance.id);
    }

    return instance;
  }

  detachInstance(instanceId: string): void {
    const instance = this.nodes.get(instanceId);
    if (!instance) return;

    if (instance.componentId) {
      this.instanceIndex.get(instance.componentId)?.delete(instanceId);
    }

    this.updateNode(instanceId, {
      type: 'FRAME' as any,
      componentId: null,
      overrides: {},
    });
  }

  // ── Variables ───────────────────────────────────

  createCollection(name: string): VariableCollection {
    const id = generateId();
    const defaultModeId = generateId();
    const collection: VariableCollection = {
      id,
      name,
      modes: [{ modeId: defaultModeId, name: 'Mode 1' }],
      defaultModeId,
      variableIds: [],
    };
    this.variableCollections.set(id, collection);
    this.activeMode.set(id, defaultModeId);
    return collection;
  }

  addVariable(variable: Variable): void {
    this.variables.set(variable.id, variable);
    const collection = this.variableCollections.get(variable.collectionId);
    if (collection && !collection.variableIds.includes(variable.id)) {
      collection.variableIds.push(variable.id);
    }
  }

  createVariable(
    name: string,
    type: VariableType,
    collectionId: string,
    value?: VariableValue,
  ): Variable {
    const id = generateId();
    const collection = this.variableCollections.get(collectionId);
    const valuesByMode: Record<string, VariableValue> = {};

    if (collection) {
      const defaultValue = value ?? (type === 'COLOR'
        ? { r: 0, g: 0, b: 0, a: 1 }
        : type === 'FLOAT' ? 0
        : type === 'STRING' ? ''
        : false);

      for (const mode of collection.modes) {
        valuesByMode[mode.modeId] = defaultValue;
      }
    }

    const variable: Variable = {
      id, name, type, collectionId, valuesByMode,
      description: '',
      hiddenFromPublishing: false,
    };

    this.addVariable(variable);
    return variable;
  }

  removeVariable(id: string): void {
    const v = this.variables.get(id);
    if (!v) return;

    const collection = this.variableCollections.get(v.collectionId);
    if (collection) {
      collection.variableIds = collection.variableIds.filter(vid => vid !== id);
    }

    // Unbind from all nodes
    for (const node of this.nodes.values()) {
      for (const [field, varId] of Object.entries(node.boundVariables)) {
        if (varId === id) {
          delete node.boundVariables[field];
        }
      }
    }

    this.variables.delete(id);
  }

  resolveVariable(variableId: string, modeId?: string, visited = new Set<string>()): VariableValue | undefined {
    if (visited.has(variableId)) return undefined; // cycle
    visited.add(variableId);

    const variable = this.variables.get(variableId);
    if (!variable) return undefined;

    const effectiveModeId = modeId
      ?? this.activeMode.get(variable.collectionId)
      ?? this.variableCollections.get(variable.collectionId)?.defaultModeId;

    if (!effectiveModeId) return undefined;

    const value = variable.valuesByMode[effectiveModeId];

    // Resolve alias
    if (value && typeof value === 'object' && 'aliasId' in value) {
      return this.resolveVariable((value as { aliasId: string }).aliasId, undefined, visited);
    }

    return value;
  }

  resolveColorVariable(variableId: string): Color | undefined {
    const value = this.resolveVariable(variableId);
    if (value && typeof value === 'object' && 'r' in value) {
      return value as Color;
    }
    return undefined;
  }

  resolveNumberVariable(variableId: string): number | undefined {
    const value = this.resolveVariable(variableId);
    return typeof value === 'number' ? value : undefined;
  }

  bindVariable(nodeId: string, field: string, variableId: string): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.boundVariables[field] = variableId;
    }
  }

  unbindVariable(nodeId: string, field: string): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      delete node.boundVariables[field];
    }
  }
}
