/**
 * ProjectPanel — MCP connection + live scene list.
 *
 * Shows above Layers in left panel.
 * Displays MCP status, scene count, and scene cards.
 * New scenes auto-load as artboards.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useProjectStore } from '../store/project';
import { useSceneStore, type Artboard } from '../store/scene';
import { useMcpConnection } from '../mcp/hooks';
import { countSceneNodes } from '../lib/scene-stats';

/** Large compile outputs can be slow; abort so one scene does not block the whole queue forever. */
const MCP_HTTP_TIMEOUT_MS = 120_000;

/**
 * Exactly one MCP pull (fetch + loadSceneJson/importHtml) at a time across the app.
 * Parallel hydrate + sync + user click caused setHost / zustand races — looked like “only s3 loads”.
 */
let studioMcpPullChain: Promise<void> = Promise.resolve();

function enqueueStudioMcpPull<T>(task: () => Promise<T>): Promise<T> {
  const p = studioMcpPullChain.then(() => task());
  studioMcpPullChain = p.then(
    () => {},
    e => {
      console.warn('[Studio] MCP pull queue:', e);
    },
  );
  return p;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), MCP_HTTP_TIMEOUT_MS);
  try {
    const { signal: _ignore, ...rest } = init;
    return await fetch(url, { cache: 'no-store', ...rest, signal: c.signal });
  } finally {
    clearTimeout(t);
  }
}

function findArtboardForScene(artboards: Artboard[], sceneId: string): Artboard | undefined {
  const raw = String(sceneId).trim();
  const sid = raw.toLowerCase();
  const byId = artboards.find(
    ab => ab.mcpSceneId && String(ab.mcpSceneId).trim().toLowerCase() === sid,
  );
  if (byId) return byId;
  const marker = ` (${raw})`;
  const markerLc = ` (${sid})`;
  return artboards.find(
    ab =>
      (ab.name.endsWith(marker) || ab.name.toLowerCase().endsWith(markerLc)) &&
      (!ab.mcpSceneId || String(ab.mcpSceneId).trim().toLowerCase() === sid),
  );
}

/** Session id s1,s2,… from MCP artboard (field or "Name (s4)" suffix). */
function getMcpSessionIdFromArtboard(ab: Pick<Artboard, 'mcpSceneId' | 'name'>): string | undefined {
  const raw = ab.mcpSceneId?.trim();
  if (raw) return raw;
  const m = ab.name.match(/ \(([sS]\d+)\)\s*$/);
  return m ? m[1].toLowerCase() : undefined;
}

async function pullMcpSceneIntoArtboard(
  baseUrl: string,
  sceneSessionId: string,
  targetArtboardId: string,
  fallbackSlug?: string,
): Promise<boolean> {
  const getStore = () => useSceneStore.getState();
  const primary = String(sceneSessionId).trim();
  let data = await fetchMcpSceneJson(baseUrl, primary);
  const slug = fallbackSlug?.trim();
  if ((!data?.root || typeof data.root !== 'object' || Array.isArray(data.root)) && _slug_valid(slug, primary)) {
    data = await fetchMcpSceneJson(baseUrl, slug!);
  }
  const rootOk = data?.root && typeof data.root === 'object' && !Array.isArray(data.root);
  if (rootOk) {
    try {
      const clone = JSON.parse(JSON.stringify(data)) as { root: unknown };
      if (getStore().loadSceneJson(clone, targetArtboardId)) return true;
    } catch (e) {
      console.warn('[Studio] scene JSON clone failed, using raw', e);
      if (getStore().loadSceneJson(data, targetArtboardId)) return true;
    }
  }
  let htmlResp: Response | null = null;
  try {
    htmlResp = await fetchWithTimeout(`${baseUrl}/scenes/${encodeURIComponent(primary)}`);
  } catch (e) {
    console.warn('[Studio] MCP HTML fetch failed', primary, e);
  }
  if ((!htmlResp || !htmlResp.ok) && _slug_valid(slug, primary)) {
    try {
      htmlResp = await fetchWithTimeout(`${baseUrl}/scenes/${encodeURIComponent(slug!)}`);
    } catch (e) {
      console.warn('[Studio] MCP HTML fetch failed (slug)', slug, e);
    }
  }
  if (!htmlResp?.ok) return false;
  const html = await htmlResp.text();
  if (!html.trim()) return false;
  return getStore().importHtml(html, targetArtboardId);
}

function _slug_valid(slug: string | undefined, primary: string): slug is string {
  return !!slug && slug !== primary;
}

async function fetchMcpSceneJson(baseUrl: string, sceneId: string): Promise<{ root?: unknown } | null> {
  const key = String(sceneId).trim();
  let j: Response;
  try {
    j = await fetchWithTimeout(`${baseUrl}/scenes/${encodeURIComponent(key)}?format=json`, {
      headers: { Accept: 'application/json' },
    });
  } catch (e) {
    console.warn('[Studio] MCP JSON fetch failed', key, e);
    return null;
  }
  if (!j.ok) return null;
  const text = await j.text();
  const ct = j.headers.get('content-type') ?? '';
  try {
    if (ct.includes('application/json')) return JSON.parse(text) as { root?: unknown };
    return JSON.parse(text) as { root?: unknown };
  } catch {
    return null;
  }
}

export function ProjectPanel() {
  const { connected, connecting, connect, disconnect, error } = useMcpConnection();
  const sessionScenes = useProjectStore(s => s.sessionScenes);
  const addArtboard = useSceneStore(s => s.addArtboard);
  const switchArtboard = useSceneStore(s => s.switchArtboard);
  const clearArtboardGraph = useSceneStore(s => s.clearArtboardGraph);

  const [loadingId, setLoadingId] = useState<string | null>(null);
  const loadedScenes = useRef<Set<string>>(new Set());
  /** Stops tight retry loops when JSON + HTML import both fail for a scene id. */
  const mcpPullFailedRef = useRef(new Set<string>());

  const activeArtboardId = useSceneStore(s => s.activeArtboardId);
  const artboards = useSceneStore(s => s.artboards);

  const autoLoadScene = useCallback(async (sceneId: string, name: string, _size: string, slug?: string) => {
    try {
      const url = useProjectStore.getState().mcpUrl;
      const getStore = () => useSceneStore.getState();
      const rawId = String(sceneId).trim();
      let tab = findArtboardForScene(getStore().artboards, rawId);
      if (!tab) {
        getStore().addArtboard(`${name} (${rawId})`, undefined, undefined, rawId, { activate: false });
        tab = findArtboardForScene(getStore().artboards, rawId);
      }

      const targetArtboardId = tab?.id;
      if (!targetArtboardId) return;

      const fresh = getStore().artboards.find(ab => ab.id === targetArtboardId);
      if (fresh?.graph && fresh.rootId) return;

      const ok = await enqueueStudioMcpPull(() => pullMcpSceneIntoArtboard(url, rawId, targetArtboardId, slug));
      const sidKey = rawId.toLowerCase();
      if (ok) mcpPullFailedRef.current.delete(sidKey);
      else mcpPullFailedRef.current.add(sidKey);
    } catch (e) {
      console.error('autoLoadScene:', e);
    }
  }, []);

  /** Catch-up session scenes; pulls are serialized by enqueueStudioMcpPull. */
  const syncMissingSessionScenes = useCallback(async () => {
    const scenes = [...useProjectStore.getState().sessionScenes].sort(
      (a, b) => (a.nodes ?? 0) - (b.nodes ?? 0),
    );
    for (const scene of scenes) {
      const sid = String(scene.id).trim();
      if (mcpPullFailedRef.current.has(sid.toLowerCase())) continue;
      const ab = findArtboardForScene(useSceneStore.getState().artboards, sid);
      if (ab?.graph && ab.rootId) continue;
      await autoLoadScene(sid, scene.name, scene.size, scene.slug);
    }
  }, [autoLoadScene]);

  // Poll session scenes
  const fetchScenes = useCallback(async () => {
    try {
      const url = useProjectStore.getState().mcpUrl;
      const resp = await fetch(`${url}/scenes`, { cache: 'no-store' });
      if (resp.ok) {
        const scenes = await resp.json();
        useProjectStore.getState().setSessionScenes(scenes);
        void syncMissingSessionScenes();
      }
    } catch (_) {}
  }, [syncMissingSessionScenes]);

  useEffect(() => {
    if (!connected) return;
    mcpPullFailedRef.current.clear();
    fetchScenes();
    const interval = setInterval(fetchScenes, 3000);
    return () => clearInterval(interval);
  }, [connected, fetchScenes]);

  // Catch-up for SSE-driven list updates (no HTTP poll yet) without aborting mid-loop.
  useEffect(() => {
    if (!connected) return;
    void syncMissingSessionScenes();
    const id = setInterval(() => void syncMissingSessionScenes(), 700);
    return () => clearInterval(id);
  }, [connected, syncMissingSessionScenes]);

  // When user switches to an MCP-linked artboard tab, load tree if still empty (fixes “No scene loaded”).
  useEffect(() => {
    if (!connected) return;
    const ab = artboards.find(a => a.id === activeArtboardId);
    if (!ab) return;
    const sid = getMcpSessionIdFromArtboard(ab);
    if (!sid || (ab.graph && ab.rootId)) return;

    const url = useProjectStore.getState().mcpUrl;
    const targetId = ab.id;

    void (async () => {
      try {
        const sidKey = String(sid).trim().toLowerCase();
        mcpPullFailedRef.current.delete(sidKey);
        const meta = useProjectStore
          .getState()
          .sessionScenes.find(s => String(s.id).trim().toLowerCase() === sidKey);
        const ok = await enqueueStudioMcpPull(() => pullMcpSceneIntoArtboard(url, sid, targetId, meta?.slug));
        if (ok) mcpPullFailedRef.current.delete(sidKey);
        else mcpPullFailedRef.current.add(sidKey);
      } catch (e) {
        console.error('hydrateMcpArtboard:', sid, e);
      }
    })();
  }, [connected, activeArtboardId, artboards]);

  const handleLoadScene = useCallback(async (sceneId: string, sceneName: string, slug?: string) => {
    const rawId = String(sceneId).trim();
    setLoadingId(rawId);
    try {
      const url = useProjectStore.getState().mcpUrl;
      const getStore = () => useSceneStore.getState();
      let existing = findArtboardForScene(getStore().artboards, rawId);

      if (!existing) {
        addArtboard(`${sceneName} (${rawId})`, undefined, undefined, rawId);
        existing = findArtboardForScene(getStore().artboards, rawId);
      }
      if (!existing) {
        setLoadingId(null);
        return;
      }
      const targetArtboardId = existing.id;
      if (existing.id !== getStore().activeArtboardId) {
        switchArtboard(existing.id);
      }

      mcpPullFailedRef.current.delete(rawId.toLowerCase());
      await enqueueStudioMcpPull(() => pullMcpSceneIntoArtboard(url, rawId, targetArtboardId, slug));
      setLoadingId(null);
      return;
    } catch (e) {
      console.error('handleLoadScene:', e);
    }
    setLoadingId(null);
  }, [addArtboard, switchArtboard]);

  const handleRemoveScene = useCallback(async (e: React.MouseEvent, sceneId: string) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const proj = useProjectStore.getState();
      const url = proj.mcpUrl;
      const sceneMeta = proj.sessionScenes.find(s => s.id === sceneId);
      let removed = false;

      try {
        const post = await fetch(`${url}/scenes/remove`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sceneId }),
        });
        removed = post.ok;
        if (!post.ok) {
          const body = await post.text().catch(() => '');
          console.warn('POST /scenes/remove', sceneId, post.status, body);
        }
      } catch (fe) {
        console.warn('POST /scenes/remove failed:', sceneId, fe);
      }

      if (!removed) {
        try {
          const res = await fetch(`${url}/scenes/${encodeURIComponent(sceneId)}`, { method: 'DELETE' });
          removed = res.ok;
          if (!res.ok) {
            const body = await res.text().catch(() => '');
            console.warn('DELETE /scenes/', sceneId, res.status, body);
          }
        } catch (fe) {
          console.warn('DELETE /scenes fetch failed:', sceneId, fe);
        }
      }

      if (!removed) return;

      const slug = sceneMeta?.slug;
      proj.setSessionScenes(
        proj.sessionScenes.filter(s => s.id !== sceneId && (!slug || s.slug !== slug) && s.slug !== sceneId),
      );

      loadedScenes.current.delete(sceneId);
      const store = useSceneStore.getState();
      const ab = findArtboardForScene(store.artboards, sceneId);
      if (ab) {
        if (store.artboards.length > 1) store.removeArtboard(ab.id);
        else store.clearArtboardGraph(ab.id);
      }
      await fetchScenes();
    } catch (err) {
      console.error('handleRemoveScene:', err);
    }
  }, [fetchScenes]);

  return (
    <div className="project-panel">
      {/* MCP status header */}
      <div className="project-panel__header">
        <div className="project-panel__status">
          <span className={`project-panel__dot ${connected ? 'project-panel__dot--on' : ''}`} />
          <span>{connected ? 'MCP' : 'MCP'}</span>
        </div>
        {connected ? (
          <span className="project-panel__meta">
            {sessionScenes.length} scene{sessionScenes.length !== 1 ? 's' : ''}
          </span>
        ) : (
          <button
            className="project-panel__connect"
            onClick={connect}
            disabled={connecting}
          >
            {connecting ? '...' : 'Connect'}
          </button>
        )}
      </div>

      {/* Scene list */}
      {connected && sessionScenes.length > 0 && (
        <div className="project-panel__scenes">
          {sessionScenes.map(scene => {
            const sid = String(scene.id).trim();
            const linked = findArtboardForScene(artboards, sid);
            const live =
              linked?.graph && linked.rootId
                ? (() => {
                    const root = linked.graph.getNode(linked.rootId);
                    if (!root) return null;
                    return {
                      size: `${Math.round(root.width)}×${Math.round(root.height)}`,
                      nodes: countSceneNodes(linked.graph, linked.rootId),
                    };
                  })()
                : null;
            const metaSize = live?.size ?? scene.size;
            const metaNodes = live?.nodes ?? scene.nodes;
            return (
            <div key={scene.id} className="project-panel__scene-card">
              <button
                type="button"
                className="project-panel__scene-open"
                onClick={() => handleLoadScene(scene.id, scene.name, scene.slug)}
                disabled={loadingId === String(scene.id).trim()}
              >
                <div className="project-panel__scene-info">
                  <span className="project-panel__scene-name">{scene.name}</span>
                  <span
                    className="project-panel__scene-meta"
                    title={
                      live
                        ? 'Size and node count from the artboard loaded in Studio (MCP list is a compile-time snapshot and may differ).'
                        : 'Snapshot from MCP when the scene was stored (storeScene).'
                    }
                  >
                    {scene.id} · {metaSize} · {metaNodes}n
                  </span>
                </div>
              </button>
              <button
                type="button"
                className="project-panel__scene-remove"
                title="Remove from MCP session and disk"
                aria-label="Remove scene"
                onPointerDown={e => e.stopPropagation()}
                onClick={e => handleRemoveScene(e, scene.id)}
              >
                ×
              </button>
            </div>
            );
          })}
        </div>
      )}

      {error && !connected && (
        <div style={{ padding: '6px 16px 10px', color: 'var(--error)', fontSize: 10 }}>{error}</div>
      )}
    </div>
  );
}
