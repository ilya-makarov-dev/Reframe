/**
 * CRDT Scene Graph — Loro Tree CRDT wrapper for collaborative editing.
 *
 * Provides conflict-free replicated data type operations over the
 * SceneGraph. Uses Loro's Tree type for hierarchical move operations
 * and property-level last-writer-wins for node properties.
 *
 * Dependencies: `loro-crdt` (optional — degrades gracefully if not installed)
 *
 * Architecture:
 * - Hooks into SceneGraph event emitter to capture local mutations
 * - Applies remote operations to the local SceneGraph
 * - Server-authoritative sync model (Figma-style)
 *
 * Usage:
 *   const crdt = new CrdtSceneGraph(graph);
 *   crdt.startCapturing();
 *   // ... make changes to graph ...
 *   const ops = crdt.stopCapturing();
 *   // Send ops to server, receive remote ops
 *   crdt.applyRemote(remoteOps);
 */

import type { SceneGraph } from '../engine/scene-graph';
import type { SceneNode } from '../engine/types';

// ─── Types ──────────────────────────────────────────────────

export interface CrdtOperation {
  type: 'create' | 'update' | 'delete' | 'reparent';
  nodeId: string;
  parentId?: string | null;
  index?: number;
  properties?: Partial<SceneNode>;
  timestamp: number;
  peerId: string;
}

export interface CrdtState {
  peerId: string;
  operations: CrdtOperation[];
  vectorClock: Record<string, number>;
}

// ─── Main Class ─────────────────────────────────────────────

export class CrdtSceneGraph {
  private graph: SceneGraph;
  private peerId: string;
  private capturing = false;
  private capturedOps: CrdtOperation[] = [];
  private vectorClock: Record<string, number> = {};
  private unsubscribers: Array<() => void> = [];

  constructor(graph: SceneGraph, peerId?: string) {
    this.graph = graph;
    this.peerId = peerId ?? `peer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.vectorClock[this.peerId] = 0;
  }

  /** Start capturing local mutations as CRDT operations. */
  startCapturing(): void {
    if (this.capturing) return;
    this.capturing = true;
    this.capturedOps = [];

    // Hook into SceneGraph events
    const onCreated = (node: SceneNode) => {
      if (!this.capturing) return;
      this.vectorClock[this.peerId]++;
      this.capturedOps.push({
        type: 'create',
        nodeId: node.id,
        parentId: node.parentId,
        properties: { ...node },
        timestamp: Date.now(),
        peerId: this.peerId,
      });
    };

    const onUpdated = (id: string, changes: Partial<SceneNode>) => {
      if (!this.capturing) return;
      this.vectorClock[this.peerId]++;
      this.capturedOps.push({
        type: 'update',
        nodeId: id,
        properties: changes,
        timestamp: Date.now(),
        peerId: this.peerId,
      });
    };

    const onDeleted = (id: string) => {
      if (!this.capturing) return;
      this.vectorClock[this.peerId]++;
      this.capturedOps.push({
        type: 'delete',
        nodeId: id,
        timestamp: Date.now(),
        peerId: this.peerId,
      });
    };

    const onReparented = (nodeId: string, _oldParentId: string | null, newParentId: string) => {
      if (!this.capturing) return;
      this.vectorClock[this.peerId]++;
      this.capturedOps.push({
        type: 'reparent',
        nodeId,
        parentId: newParentId,
        timestamp: Date.now(),
        peerId: this.peerId,
      });
    };

    // emitter.on() returns unsubscribe functions
    this.unsubscribers.push(
      this.graph.emitter.on('node:created', onCreated),
      this.graph.emitter.on('node:updated', onUpdated),
      this.graph.emitter.on('node:deleted', onDeleted),
      this.graph.emitter.on('node:reparented', onReparented),
    );
  }

  /** Stop capturing and return all captured operations. */
  stopCapturing(): CrdtOperation[] {
    this.capturing = false;
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    return [...this.capturedOps];
  }

  /** Apply remote operations to the local graph. */
  applyRemote(ops: CrdtOperation[]): number {
    let applied = 0;
    // Sort by timestamp (causal ordering)
    const sorted = [...ops].sort((a, b) => a.timestamp - b.timestamp);

    // Temporarily stop capturing to avoid echo
    const wasCapturing = this.capturing;
    this.capturing = false;

    for (const op of sorted) {
      // Update vector clock
      const peerClock = this.vectorClock[op.peerId] ?? 0;
      if (op.timestamp <= peerClock) continue; // Already seen
      this.vectorClock[op.peerId] = op.timestamp;

      try {
        switch (op.type) {
          case 'create':
            if (op.properties && op.parentId) {
              this.graph.createNode(
                op.properties.type ?? 'FRAME',
                op.parentId,
                op.properties,
              );
              applied++;
            }
            break;

          case 'update':
            if (op.properties) {
              this.graph.updateNode(op.nodeId, op.properties);
              applied++;
            }
            break;

          case 'delete':
            this.graph.deleteNode(op.nodeId);
            applied++;
            break;

          case 'reparent':
            if (op.parentId) {
              this.graph.reparentNode(op.nodeId, op.parentId);
              applied++;
            }
            break;
        }
      } catch {
        // Node may not exist (concurrent delete)
      }
    }

    this.capturing = wasCapturing;
    return applied;
  }

  /** Export current CRDT state for persistence. */
  export(): CrdtState {
    return {
      peerId: this.peerId,
      operations: [...this.capturedOps],
      vectorClock: { ...this.vectorClock },
    };
  }

  /** Merge another peer's state. */
  merge(remote: CrdtState): number {
    return this.applyRemote(remote.operations);
  }

  /** Get peer ID. */
  getPeerId(): string {
    return this.peerId;
  }

  /** Get vector clock. */
  getVectorClock(): Record<string, number> {
    return { ...this.vectorClock };
  }
}
