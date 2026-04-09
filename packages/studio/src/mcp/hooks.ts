/**
 * MCP React Hooks — connect Studio components to MCP tools.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { serializeGraph } from '@reframe/core/serialize';
import type { SceneGraph } from '@reframe/core/engine/scene-graph';
import type { ITimeline } from '@reframe/core/animation/types';
import { bridge, type ToolResult } from './bridge';
import { parseInspectAuditSection } from './parse-inspect-audit';
import { parseStructuralDiffFromInspectContent, type StructuralDiffPayload } from './parse-structural-diff';
import { useProjectStore } from '../store/project';
import { useSceneStore } from '../store/scene';

/** Push Studio scene into the MCP session store (PUT /scenes/:id). Full SceneJSON envelope (root, images, timeline) — matches GET ?format=json. */
export async function pushSessionSceneToMcp(
  mcpUrl: string,
  sessionSceneId: string,
  graph: SceneGraph,
  rootId: string,
  timeline?: ITimeline | null,
): Promise<{ ok: boolean; revision?: number; error?: string }> {
  try {
    const envelope = serializeGraph(graph, rootId, {
      compact: true,
      timeline: timeline ?? undefined,
      explicitTimelineKey: true,
    });
    const res = await fetch(`${mcpUrl.replace(/\/$/, '')}/scenes/${encodeURIComponent(sessionSceneId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      kind?: string;
      code?: string;
      revision?: number;
    };
    if (!res.ok) {
      const msg = data.error ?? data.message ?? `HTTP ${res.status}`;
      const extra = data.code ? ` [${data.code}]` : '';
      return { ok: false, error: `${msg}${extra}` };
    }
    return { ok: true, revision: data.revision };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'push failed' };
  }
}

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

/** Run reframe_inspect (audit section) via MCP and parse structured issues. */
export function useMcpAudit() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAudit = useCallback(async (sceneId: string, designMd?: string) => {
    setLoading(true);
    setError(null);
    try {
      const args: Record<string, unknown> = {
        sceneId,
        tree: false,
        audit: true,
      };
      if (designMd) args.designMd = designMd;

      const res = await bridge.callTool('reframe_inspect', args);
      if (res.isError) {
        setError(res.content[0]?.text ?? 'Inspect failed');
        return null;
      }

      const text = res.content[0]?.text ?? '';
      const parsed = parseInspectAuditSection(text);
      setResult({
        issues: parsed.issues.map(i => ({
          rule: i.rule,
          severity: i.severity,
          message: i.message,
          nodeId: i.nodeId,
          fix: i.fix,
        })),
        passed: parsed.passed,
        total: parsed.total,
      });
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

/**
 * Structural diff via reframe_inspect (diffWith + optional diffStructured).
 * Parses `content[1]` JSON when present; main report text remains in `text`.
 */
export function useMcpInspectDiff() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [structuralDiff, setStructuralDiff] = useState<StructuralDiffPayload | null>(null);

  const runDiff = useCallback(
    async (
      sceneId: string,
      diffWith: string,
      options?: { diffStructured?: boolean; diffStructuredDetail?: 'full' | 'summary'; diffTextDetail?: 'full' | 'summary' },
    ) => {
      setLoading(true);
      setError(null);
      setStructuralDiff(null);
      try {
        const args: Record<string, unknown> = {
          sceneId,
          diffWith,
          tree: false,
          audit: false,
        };
        if (options?.diffStructured !== undefined) args.diffStructured = options.diffStructured;
        if (options?.diffStructuredDetail) args.diffStructuredDetail = options.diffStructuredDetail;
        if (options?.diffTextDetail) args.diffTextDetail = options.diffTextDetail;

        const res = await bridge.callTool('reframe_inspect', args);
        if (res.isError) {
          setError(res.content[0]?.text ?? 'Inspect failed');
          setText(null);
          return null;
        }
        const bodyText = res.content[0]?.text ?? '';
        setText(bodyText);
        setStructuralDiff(parseStructuralDiffFromInspectContent(res.content as { type: string; text?: string }[]));
        return res;
      } catch (err: any) {
        setError(err.message);
        setText(null);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { runDiff, loading, error, text, structuralDiff };
}

export type { StructuralDiffPayload } from './parse-structural-diff';

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
    const url = useProjectStore.getState().mcpUrl;
    const sid = String(sceneId).trim();
    const linked = useSceneStore
      .getState()
      .artboards.find(
        a =>
          (a.mcpSceneId && a.mcpSceneId.trim().toLowerCase() === sid.toLowerCase()) ||
          a.name.toLowerCase().endsWith(` (${sid.toLowerCase()})`),
      );
    if (linked?.graph && linked.rootId) {
      const push = await pushSessionSceneToMcp(url, sid, linked.graph, linked.rootId, linked.timeline ?? undefined);
      if (!push.ok) {
        return {
          content: [{ type: 'text' as const, text: `Studio push to MCP failed: ${push.error}. Fix connection or discard local changes.` }],
          isError: true,
        };
      }
      useProjectStore.getState().markClean(linked.id);
      if (push.revision != null) {
        useSceneStore.getState().setLastKnownMcpRevision(linked.id, push.revision);
      }
    }
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

  const pushSessionScene = useCallback(
    async (sessionSceneId: string, graph: SceneGraph, rootId: string, timeline?: ITimeline | null) => {
      const url = useProjectStore.getState().mcpUrl;
      return pushSessionSceneToMcp(url, sessionSceneId, graph, rootId, timeline);
    },
    [],
  );

  return {
    manifest,
    connected,
    initProject,
    openProject,
    saveScene,
    pushSessionScene,
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
