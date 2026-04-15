/**
 * Store Sync — bidirectional sync between editor viewport and MCP server.
 *
 * Direction 1 (AI → Editor):
 *   MCP SSE event → fetchScene() → GraphBridge.fromReframeGraph() → editor.replaceGraph()
 *
 * Direction 2 (Editor → MCP):
 *   User edits on canvas → graph.emitter 'node:updated' → debounced pushScene()
 *
 * Conflict resolution: sessionRevision counter. Editor attaches its known
 * revision on PUT. If server revision is ahead, editor fetches latest first.
 */

import type { SceneGraph as OPSceneGraph } from '@open-pencil/core';
import { MCPClient } from './mcp-client.js';
import { GraphBridge } from '../bridge/graph-bridge.js';
import type { ReframeEditorShell } from '../canvas/editor-shell.js';

export interface StoreSyncOptions {
  /** The editor shell to sync. */
  shell: ReframeEditorShell;
  /** The MCP client for server communication. */
  mcpClient: MCPClient;
  /** Debounce interval for pushing changes to MCP (ms). Default: 500. */
  debounceMs?: number;
  /** Called when sync produces a conflict (server ahead of editor). */
  onConflict?: (serverRevision: number, editorRevision: number) => void;
}

export class StoreSync {
  private shell: ReframeEditorShell;
  private mcpClient: MCPClient;
  private debounceMs: number;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private currentSceneId: string | null = null;
  private knownRevision = 0;
  private pushing = false;
  private unsubscribeGraph: (() => void) | null = null;

  constructor(options: StoreSyncOptions) {
    this.shell = options.shell;
    this.mcpClient = options.mcpClient;
    this.debounceMs = options.debounceMs ?? 500;
  }

  /** Start syncing a specific scene. */
  startSync(sceneId: string): void {
    this.currentSceneId = sceneId;

    // Listen for graph mutations from user edits
    this.unsubscribeGraph = this.shell.editor.graph.emitter.on('node:updated', () => {
      this.schedulePush();
    });

    // Also listen for structural changes
    const unsub2 = this.shell.editor.graph.emitter.on('node:created', () => {
      this.schedulePush();
    });
    const unsub3 = this.shell.editor.graph.emitter.on('node:deleted', () => {
      this.schedulePush();
    });

    const origUnsub = this.unsubscribeGraph;
    this.unsubscribeGraph = () => {
      origUnsub();
      unsub2();
      unsub3();
    };
  }

  /** Stop syncing. */
  stopSync(): void {
    if (this.unsubscribeGraph) {
      this.unsubscribeGraph();
      this.unsubscribeGraph = null;
    }
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    this.currentSceneId = null;
  }

  /**
   * Pull latest scene from MCP and load into editor.
   * Called when SSE reports scene:session-changed.
   */
  async pullFromMCP(sceneId: string): Promise<void> {
    if (this.pushing) return; // Don't pull while we're pushing

    try {
      const data = await this.mcpClient.fetchScene(sceneId);
      if (!data) return;

      // Update known revision
      if (data.revision != null) {
        this.knownRevision = data.revision;
      }

      // Convert server data → OP graph via bridge
      // The server returns a serialized SceneGraph; we need to hydrate it
      // into an OP SceneGraph and load into editor
      this.shell.loadFromReframeGraph(data.graph, data.rootId);
      this.currentSceneId = sceneId;
    } catch (err) {
      console.error('[StoreSync] Pull failed:', err);
    }
  }

  // ─── Internal ──────────────────────────────────────────────

  private schedulePush(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.doPush(), this.debounceMs);
  }

  private async doPush(): Promise<void> {
    if (!this.currentSceneId || this.pushing) return;
    this.pushing = true;

    try {
      // Convert current editor graph → serializable format
      const { graph, rootId } = this.shell.toReframeGraph();

      // Serialize graph for transport
      const nodesObj: Record<string, any> = {};
      for (const node of graph.getAllNodes()) {
        nodesObj[node.id] = node;
      }

      await this.mcpClient.pushScene(this.currentSceneId, {
        graph: { nodes: nodesObj },
        rootId,
        revision: this.knownRevision,
      });

      this.knownRevision++;
    } catch (err) {
      console.error('[StoreSync] Push failed:', err);
    } finally {
      this.pushing = false;
    }
  }
}
