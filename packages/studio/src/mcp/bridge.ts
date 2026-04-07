/**
 * MCP Bridge — Studio ↔ MCP HTTP server connection.
 *
 * Two channels:
 *   1. Tool calls: POST /mcp (JSON-RPC over Streamable HTTP)
 *   2. Events: GET /events (SSE for real-time project updates)
 *
 * The bridge manages session lifecycle, auto-reconnect, and
 * provides a clean `callTool(name, args)` API for React hooks.
 */

import { useProjectStore } from '../store/project';
import type { ProjectEvent } from '@reframe/core/project/types';

// ─── Types ───────────────────────────────────────────────────

export interface ToolResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ─── Bridge class ────────────────────────────────────────────

class McpBridge {
  private sessionId: string | null = null;
  private eventSource: EventSource | null = null;
  private nextId = 1;
  private initialized = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;

  get baseUrl(): string {
    return useProjectStore.getState().mcpUrl;
  }

  get isConnected(): boolean {
    return this.initialized && this.eventSource?.readyState === EventSource.OPEN;
  }

  /** MCP JSON-RPC session initialized (tools can be called). */
  get isRpcReady(): boolean {
    return this.initialized;
  }

  // ── Connect ──────────────────────────────────────────────

  async connect(): Promise<void> {
    const store = useProjectStore.getState();
    if (store.connecting) return;

    store.setConnecting(true);
    store.setError(null);

    try {
      // 1. Initialize MCP session with an `initialize` JSON-RPC call
      const initResp = await this.rawPost({
        jsonrpc: '2.0',
        id: this.nextId++,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'reframe-studio', version: '1.0.0' },
        },
      });

      if (initResp.error) {
        throw new Error(initResp.error.message);
      }

      // 2. Send `initialized` notification
      await this.rawPost({
        jsonrpc: '2.0',
        id: this.nextId++,
        method: 'notifications/initialized',
      });

      this.initialized = true;
      this.reconnectDelay = 1000;

      // 3. Connect SSE for real-time events
      this.connectSSE();

      store.setConnected(true);
    } catch (err: any) {
      store.setError(err.message ?? 'Connection failed');
      store.setConnected(false);
      this.scheduleReconnect();
    } finally {
      store.setConnecting(false);
    }
  }

  disconnect(): void {
    this.initialized = false;
    this.sessionId = null;
    this.eventSource?.close();
    this.eventSource = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    useProjectStore.getState().setConnected(false);
  }

  // ── Tool calls ───────────────────────────────────────────

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    if (!this.initialized) {
      throw new Error('MCP bridge not connected. Call connect() first.');
    }

    const resp = await this.rawPost({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'tools/call',
      params: { name, arguments: args },
    });

    if (resp.error) {
      return {
        content: [{ type: 'text', text: resp.error.message }],
        isError: true,
      };
    }

    return resp.result as ToolResult;
  }

  /** List available tools from the server. */
  async listTools(): Promise<Array<{ name: string; description: string }>> {
    const resp = await this.rawPost({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'tools/list',
    });

    if (resp.error) return [];
    const result = resp.result as { tools: Array<{ name: string; description: string }> };
    return result.tools ?? [];
  }

  // ── SSE Events ───────────────────────────────────────────

  private connectSSE(): void {
    if (this.eventSource) {
      this.eventSource.close();
    }

    this.eventSource = new EventSource(`${this.baseUrl}/events`);

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ProjectEvent | { type: 'connected' };
        if (data.type === 'connected') return;
        useProjectStore.getState().handleEvent(data as ProjectEvent);
      } catch (_) {}
    };

    this.eventSource.onerror = () => {
      if (this.initialized) {
        useProjectStore.getState().setConnected(false);
        this.scheduleReconnect();
      }
    };
  }

  // ── HTTP transport ───────────────────────────────────────

  private async rawPost(body: JsonRpcRequest): Promise<JsonRpcResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    };
    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId;
    }

    const resp = await fetch(`${this.baseUrl}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    // Capture session ID from response
    const sid = resp.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    }

    const contentType = resp.headers.get('content-type') ?? '';

    // Streamable HTTP may return SSE stream for long-running requests
    if (contentType.includes('text/event-stream')) {
      return this.readSSEResponse(resp);
    }

    // Direct JSON response
    const json = await resp.json();
    // Response may be an array (batched) or single
    if (Array.isArray(json)) {
      return json.find((m: any) => m.id === body.id) ?? json[0];
    }
    return json;
  }

  private async readSSEResponse(resp: Response): Promise<JsonRpcResponse> {
    const reader = resp.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let result: JsonRpcResponse | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.jsonrpc === '2.0' && data.id != null) {
              result = data;
            }
          } catch (_) {}
        }
      }
    }

    if (!result) throw new Error('No JSON-RPC response in SSE stream');
    return result;
  }

  // ── Reconnect ────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
      this.connect();
    }, this.reconnectDelay);
  }
}

// ─── Singleton ───────────────────────────────────────────────

export const bridge = new McpBridge();
