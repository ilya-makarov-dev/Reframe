/**
 * MCP React Hooks — connect Studio components to MCP tools.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { bridge, type ToolResult } from './bridge';
import { useProjectStore } from '../store/project';

// ─── Connection hook ─────────────────────────────────────────

/** Manage MCP bridge connection lifecycle. */
export function useMcpConnection() {
  const connected = useProjectStore(s => s.connected);
  const connecting = useProjectStore(s => s.connecting);
  const error = useProjectStore(s => s.error);
  const mcpUrl = useProjectStore(s => s.mcpUrl);

  const connect = useCallback(() => bridge.connect(), []);
  const disconnect = useCallback(() => bridge.disconnect(), []);

  return { connected, connecting, error, mcpUrl, connect, disconnect };
}

// ─── Tool call hook ──────────────────────────────────────────

export interface UseToolState {
  call: (args?: Record<string, unknown>) => Promise<ToolResult | null>;
  loading: boolean;
  error: string | null;
  result: ToolResult | null;
}

/** Call a specific MCP tool. */
export function useMcpTool(toolName: string): UseToolState {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ToolResult | null>(null);

  const call = useCallback(async (args: Record<string, unknown> = {}) => {
    setLoading(true);
    setError(null);
    try {
      const res = await bridge.callTool(toolName, args);
      setResult(res);
      if (res.isError) {
        setError(res.content[0]?.text ?? 'Unknown error');
      }
      return res;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [toolName]);

  return { call, loading, error, result };
}

// ─── Audit hook ──────────────────────────────────────────────

export interface AuditResult {
  issues: Array<{ rule: string; severity: string; message: string; nodeId?: string; fix?: string }>;
  passed: boolean;
  total: number;
}

/** Run reframe_audit via MCP and parse results. */
export function useMcpAudit() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAudit = useCallback(async (sceneId: string, designMd?: string) => {
    setLoading(true);
    setError(null);
    try {
      const args: Record<string, unknown> = { sceneId };
      if (designMd) args.designMd = designMd;

      const res = await bridge.callTool('reframe_audit', args);
      if (res.isError) {
        setError(res.content[0]?.text ?? 'Audit failed');
        return null;
      }

      // Parse audit text response
      const text = res.content[0]?.text ?? '';
      const passed = text.includes('PASS') || text.includes('0 issues');
      setResult({ issues: [], passed, total: 0 });
      return res;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { runAudit, loading, result, error };
}

// ─── Project hook ────────────────────────────────────────────

/** Manage project via MCP. */
export function useMcpProject() {
  const manifest = useProjectStore(s => s.manifest);
  const connected = useProjectStore(s => s.connected);

  const initProject = useCallback(async (dir: string, name: string) => {
    return bridge.callTool('reframe_project', { action: 'init', dir, name });
  }, []);

  const openProject = useCallback(async (dir: string) => {
    return bridge.callTool('reframe_project', { action: 'open', dir });
  }, []);

  const saveScene = useCallback(async (sceneId: string, tags?: string[]) => {
    return bridge.callTool('reframe_project', { action: 'save', sceneId, tags });
  }, []);

  const loadScene = useCallback(async (sceneId: string) => {
    return bridge.callTool('reframe_project', { action: 'load', sceneId });
  }, []);

  const listScenes = useCallback(async () => {
    return bridge.callTool('reframe_project', { action: 'list' });
  }, []);

  const deleteScene = useCallback(async (sceneId: string) => {
    return bridge.callTool('reframe_project', { action: 'delete', sceneId });
  }, []);

  const saveDesign = useCallback(async (designMd: string) => {
    return bridge.callTool('reframe_project', { action: 'save_design', designMd });
  }, []);

  return {
    manifest,
    connected,
    initProject,
    openProject,
    saveScene,
    loadScene,
    listScenes,
    deleteScene,
    saveDesign,
  };
}

// ─── Auto-connect hook ──────────────────────────────────────

/** Auto-connect to MCP on mount if URL is set. */
export function useMcpAutoConnect() {
  const connected = useProjectStore(s => s.connected);
  const mcpUrl = useProjectStore(s => s.mcpUrl);
  const attempted = useRef(false);

  useEffect(() => {
    if (!connected && mcpUrl && !attempted.current) {
      attempted.current = true;
      bridge.connect();
    }
  }, [connected, mcpUrl]);
}
