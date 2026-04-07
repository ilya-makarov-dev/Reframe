/**
 * Reframe — Standalone Host Adapter
 *
 * Implements IHost using the standalone engine's SceneGraph.
 * No Figma dependency — pure reframe engine.
 */

import { MIXED, type IHost, type Mixed, type INode, type IFontName } from '../../host/types';
import type { SceneGraph } from '../../engine/scene-graph';
import { loadFont } from '../../engine/fonts';
import { StandaloneNode } from './node';

// ─── Node Cache Helper ──────────────────────────────────────────

function wrapNode(graph: SceneGraph, id: string): INode | null {
  const raw = graph.getNode(id);
  if (!raw) return null;
  return new StandaloneNode(graph, raw);
}

// ─── StandaloneHost ─────────────────────────────────────────────

export class StandaloneHost implements IHost {
  readonly MIXED: Mixed = MIXED;
  private graph: SceneGraph;
  private selection: INode[] = [];

  constructor(graph: SceneGraph) {
    this.graph = graph;
  }

  // ── Node access ─────────────────────────────────

  getNodeById(id: string): INode | null {
    return wrapNode(this.graph, id);
  }

  async getNodeByIdAsync(id: string): Promise<INode | null> {
    return wrapNode(this.graph, id);
  }

  // ── Font loading ────────────────────────────────

  async loadFont(font: IFontName): Promise<void> {
    await loadFont(font.family, font.style);
  }

  // ── Grouping ────────────────────────────────────

  groupNodes(nodes: INode[], parent: INode, insertIndex?: number): INode {
    const nodeIds = nodes.map(n => n.id);
    const grouped = this.graph.groupNodes(nodeIds, parent.id, insertIndex);
    return new StandaloneNode(this.graph, grouped);
  }

  // ── UI (no-op for standalone) ───────────────────

  notify(message: string, options?: { error?: boolean; timeout?: number }): void {
    const prefix = options?.error ? '[ERROR]' : '[INFO]';
    console.log(`${prefix} ${message}`);
  }

  getSelection(): INode[] {
    return this.selection;
  }

  setSelection(nodes: INode[]): void {
    this.selection = nodes;
  }

  focusView(_nodes: INode[]): void {
    // No-op in standalone mode
  }

  // ── Metadata ────────────────────────────────────

  getEditorType(): string {
    return 'standalone';
  }

  getFileKey(): string {
    return 'standalone-session';
  }

  // ── Engine access (not part of IHost, but useful) ──

  getGraph(): SceneGraph {
    return this.graph;
  }
}
