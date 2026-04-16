/**
 * MCP Client — connects the editor to the MCP HTTP server via SSE.
 *
 * Listens for scene changes made by AI tools (compile, edit, etc.)
 * and pushes them to the editor viewport via GraphBridge.
 *
 * Data flow:
 *   AI tool call → MCP store.storeScene() → emitProjectEvent()
 *   → SSE /events → this client → fetch /scenes/:id?format=json
 *   → GraphBridge.fromReframeGraph() → editor.replaceGraph()
 */

export interface MCPClientOptions {
  /** Base URL of the MCP HTTP server (default: window.location.origin). */
  baseUrl?: string;
  /** Called when a scene has been updated by the AI pipeline. */
  onSceneChanged?: (sceneId: string, revision: number) => void;
  /** Called when design system changes (brand switch, token update). */
  onDesignSystemChanged?: (brandHash: string) => void;
  /** Called when connection status changes. */
  onConnectionChanged?: (connected: boolean) => void;
}

export class MCPClient {
  private es: EventSource | null = null;
  private baseUrl: string;
  private options: MCPClientOptions;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: MCPClientOptions = {}) {
    this.options = options;
    this.baseUrl = options.baseUrl ?? '';
  }

  /** Start listening for SSE events from the MCP server. */
  connect(): void {
    if (this.es) return;

    try {
      this.es = new EventSource(`${this.baseUrl}/events`);

      this.es.onopen = () => {
        this.options.onConnectionChanged?.(true);
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.es.onmessage = (evt) => {
        try {
          const event = JSON.parse(evt.data);
          this.handleEvent(event);
        } catch { /* ignore parse errors */ }
      };

      this.es.onerror = () => {
        this.options.onConnectionChanged?.(false);
        // EventSource auto-reconnects, but we track status
      };
    } catch {
      this.options.onConnectionChanged?.(false);
    }
  }

  /** Stop listening. */
  disconnect(): void {
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.options.onConnectionChanged?.(false);
  }

  /** Fetch a scene from the MCP server as JSON. */
  async fetchScene(idOrSlug: string): Promise<any> {
    const resp = await fetch(`${this.baseUrl}/scenes/${idOrSlug}?format=json`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    return resp.json();
  }

  /** Push scene graph changes to the MCP server. Returns revision on success. */
  async pushScene(sceneId: string, data: Record<string, any>): Promise<{ ok: boolean; revision?: number }> {
    try {
      const resp = await fetch(`${this.baseUrl}/scenes/${sceneId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!resp.ok) return { ok: false };
      try {
        const json = await resp.json();
        return { ok: true, revision: json.revision };
      } catch {
        return { ok: true };
      }
    } catch {
      return { ok: false };
    }
  }

  /** List all scenes in the MCP session. */
  async listScenes(): Promise<any[]> {
    const resp = await fetch(`${this.baseUrl}/scenes`);
    if (!resp.ok) return [];
    return resp.json();
  }

  // ─── Internal ──────────────────────────────────────────────

  private handleEvent(event: { type: string; [key: string]: any }): void {
    switch (event.type) {
      case 'scene:session-changed':
      case 'scene:saved':
        if (event.sceneId) {
          this.options.onSceneChanged?.(
            event.sceneId,
            event.revision ?? 0,
          );
        }
        break;

      case 'design-system:updated':
        if (event.brandHash) {
          this.options.onDesignSystemChanged?.(event.brandHash);
        }
        break;

      // Intent/annotation events — future use
      case 'intent:updated':
      case 'annotation:updated':
        break;
    }
  }
}
