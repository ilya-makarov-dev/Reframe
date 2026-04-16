/**
 * Store Sync — bidirectional sync between editor viewport and MCP server.
 *
 * Channel C: Full graph sync (fallback for whole-graph replacements).
 *
 * Pull (Server → Editor):
 *   MCP SSE event → pullFromMCP() → fetchScene() → loadFromReframeGraph()
 *
 * Push (Editor → Server):
 *   graph.emitter events → debounced serializeGraph() → PUT /scenes/:id
 *
 * Echo suppression: selfCausedRevisions set prevents re-pulling changes
 * that we just pushed or that scripts.ts panel edits caused.
 */

import { MCPClient } from './mcp-client.js';
import type { ReframeEditorShell } from '../canvas/editor-shell.js';
import { serializeGraph, deserializeToGraph } from '@reframe/core';

export interface StoreSyncOptions {
  /** The editor shell to sync. */
  shell: ReframeEditorShell;
  /** The MCP client for server communication. */
  mcpClient: MCPClient;
  /** Debounce interval for pushing changes to MCP (ms). Default: 500. */
  debounceMs?: number;
}

export class StoreSync {
  private shell: ReframeEditorShell;
  private mcpClient: MCPClient;
  private debounceMs: number;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private currentSceneId: string | null = null;
  private knownRevision = 0;
  private pushing = false;
  private pulling = false;
  private unsubscribers: Array<() => void> = [];

  /** Revisions we caused (push or panel edit) — skip pull for these. */
  private selfCausedRevisions = new Set<number>();

  constructor(options: StoreSyncOptions) {
    this.shell = options.shell;
    this.mcpClient = options.mcpClient;
    this.debounceMs = options.debounceMs ?? 500;
  }

  /** Whether we're currently pulling (loading from server). */
  get isPulling(): boolean {
    return this.pulling;
  }

  /** Start syncing a specific scene. Listens to all graph emitter events. */
  startSync(sceneId: string): void {
    this.stopSync();
    this.currentSceneId = sceneId;

    const emitter = this.shell.editor.graph.emitter;
    const push = () => this.schedulePush();

    this.unsubscribers.push(
      emitter.on('node:updated', push),
      emitter.on('node:created', push),
      emitter.on('node:deleted', push),
      emitter.on('node:reparented', push),
      emitter.on('node:reordered', push),
    );
  }

  /** Stop syncing. */
  stopSync(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    this.currentSceneId = null;
  }

  /**
   * Mark a revision as self-caused (skip pull for it).
   * Called by platform-bootstrap.ts when scripts.ts panel edits cause a revision bump.
   */
  suppressNextPull(revision: number): void {
    this.selfCausedRevisions.add(revision);
    // Auto-clean after 10s to prevent memory leak from missed SSE events
    setTimeout(() => this.selfCausedRevisions.delete(revision), 10_000);
  }

  /**
   * Pull latest scene from MCP and load into editor.
   * Called when SSE reports scene:session-changed from an external source.
   */
  async pullFromMCP(sceneId: string, revision?: number): Promise<void> {
    // Skip if we caused this revision (echo suppression)
    if (revision != null && this.selfCausedRevisions.has(revision)) {
      this.selfCausedRevisions.delete(revision);
      return;
    }

    // Don't pull while we're pushing
    if (this.pushing) return;

    this.pulling = true;
    // Set a window-global suppression flag so scripts.ts canvas listeners
    // (reframe:node-created / -moved / -resized / -deleted / -reparented)
    // skip their POST /api/node/add|edit|delete persistence calls during
    // pull. Without this, every pull → loadFromReframeGraph rebuilds the
    // OP graph which fires "created" events for each newly-instantiated
    // node — those events POST `add` to a server that already has the
    // nodes, returning 404 and producing log spam (and worse: real edits
    // racing the rebuild get clobbered).
    (window as any).__reframeSyncing = true;
    try {
      const data = await this.mcpClient.fetchScene(sceneId);
      if (!data) return;

      if (data.revision != null) {
        this.knownRevision = data.revision;
      }

      // /scenes/:id?format=json returns a SERIALIZED tree (plain JSON),
      // not a SceneGraph instance. We MUST deserialize before passing
      // to loadFromReframeGraph — otherwise GraphBridge.fromReframeGraph
      // calls .getNode on undefined and the whole pull-on-SSE flow
      // throws on every scene mutation.
      const rfData = deserializeToGraph(data.root || data);
      if (!rfData || !rfData.graph) return;

      this.shell.loadFromReframeGraph(rfData.graph, rfData.rootId);
      this.currentSceneId = sceneId;
    } catch (err) {
      console.error('[StoreSync] Pull failed:', err);
    } finally {
      this.pulling = false;
      // Wider window: late OP layout/text-shaping events can fire 1-2s
      // after rebuild. First real user pointer event will clear earlier
      // (see canvas pointerdown listener in platform-bootstrap).
      setTimeout(() => { (window as any).__reframeSyncing = false; }, 2000);
    }
  }

  // ─── Internal ──────────────────────────────────────────────

  private schedulePush(): void {
    // Don't push back changes we just pulled
    if (this.pulling) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.doPush(), this.debounceMs);
  }

  private async doPush(): Promise<void> {
    if (!this.currentSceneId || this.pushing) return;
    this.pushing = true;

    try {
      const { graph, rootId } = this.shell.toReframeGraph();

      // Serialize to the SceneJSON format the server expects
      const envelope = serializeGraph(graph, rootId);

      const result = await this.mcpClient.pushScene(this.currentSceneId, {
        root: envelope.root,
        version: envelope.version,
      });

      if (result.ok && result.revision != null) {
        this.knownRevision = result.revision;
        // Mark our own revision so we skip the SSE echo
        this.selfCausedRevisions.add(result.revision);
        setTimeout(() => this.selfCausedRevisions.delete(result.revision!), 10_000);
      }
    } catch (err) {
      console.error('[StoreSync] Push failed:', err);
    } finally {
      this.pushing = false;
    }
  }
}
