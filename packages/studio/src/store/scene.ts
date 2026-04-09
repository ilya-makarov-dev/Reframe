/**
 * Scene Store — multi-artboard SceneGraph state (single source: artboards[] only).
 */

import { create } from 'zustand';
import { SceneGraph } from '@reframe/core/engine/scene-graph';
import { StandaloneHost } from '@reframe/core/adapters/standalone/adapter';
import { StandaloneNode } from '@reframe/core/adapters/standalone/node';
import { setHost } from '@reframe/core/host/context';
import { exportToHtml } from '@reframe/core/exporters/html';
import { exportSceneGraphToSvg } from '@reframe/core/exporters/svg';
import { exportToReact } from '@reframe/core/exporters/react';
import { exportToAnimatedHtml } from '@reframe/core/exporters/animated-html';
import { exportToLottie } from '@reframe/core/exporters/lottie';
import { importFromHtml } from '@reframe/core/importers/html';
import { ensureSceneLayout } from '@reframe/core/engine/layout';
import { audit } from '@reframe/core/audit';
import type { AuditIssue } from '@reframe/core/audit';
import { buildInspectAuditRules } from '@reframe/core/inspect-audit-rules';
import { parseDesignMd } from '@reframe/core/design-system';
import type { DesignSystem } from '@reframe/core/design-system';
import type { SceneNode, Fill } from '@reframe/core/engine/types';
import type { ITimeline } from '@reframe/core/animation/types';
import {
  serializeSceneNode,
  serializeGraph,
  migrateScene,
  deserializeToGraph,
  deserializeScene,
  migrateSceneJSON,
  hydrateSceneImagesBase64,
  deserializeTimeline,
  SERIALIZE_VERSION,
  importSceneNodeFallback,
} from '@reframe/core/serialize';
import type { INode } from '@reframe/core/host/types';
import { artboardSizePatch } from '../lib/scene-stats';
import { bindStudioGraphPreview, cancelPendingStudioGraphPreview, disposeStudioGraphPreview } from '../document/graph-controller';
import { useProjectStore } from './project';

function markLocalDirty(artboardId: string) {
  useProjectStore.getState().markDirty(artboardId);
}

const AUDIT_DEBOUNCE_MS = 280;
let auditDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Coalesce rapid mutations into a single audit pass (Inspector still uses runAudit() directly). */
function scheduleDebouncedAudit(getScene: () => SceneStore) {
  if (auditDebounceTimer) clearTimeout(auditDebounceTimer);
  auditDebounceTimer = setTimeout(() => {
    auditDebounceTimer = null;
    getScene().runAudit();
  }, AUDIT_DEBOUNCE_MS);
}

export interface HistoryEntry {
  label: string;
  sceneJson: any;
}

export interface Artboard {
  id: string;
  name: string;
  mcpSceneId?: string;
  graph: SceneGraph | null;
  rootId: string | null;
  renderedHtml: string;
  width: number;
  height: number;
  timeline: ITimeline | null;
  auditIssues: AuditIssue[];
  history: HistoryEntry[];
  historyIndex: number;
  /** Last MCP session revision we pulled from GET /scenes/:id?format=json */
  lastKnownMcpRevision?: number;
}

export type CanvasTool = 'select' | 'frame' | 'rect' | 'pen' | 'text' | 'image';

export interface SceneStore {
  artboards: Artboard[];
  activeArtboardId: string;

  canvasTool: CanvasTool;
  setCanvasTool: (tool: CanvasTool) => void;
  addCanvasShape: (kind: 'frame' | 'rect' | 'text', x: number, y: number) => void;
  canvasPointerDragNodeId: string | null;
  /** After drag-to-move, suppress one click (ghost click). Cleared when picking a canvas tool. */
  canvasSuppressNextClick: boolean;
  /** Studio canvas: after add shape, fit view to this node (one-shot; Canvas clears). */
  canvasFitNodeId: string | null;

  selectedIds: string[];
  hoveredId: string | null;

  designSystem: DesignSystem | null;
  designMd: string;

  animPlaying: boolean;
  animTime: number;

  /** Agent changed the scene on MCP while the tab had local edits — user must pull or keep. */
  syncConflict: {
    artboardId: string;
    mcpSceneId: string;
    incomingRevision: number;
    message: string;
  } | null;
  clearSyncConflict: () => void;
  raiseSyncConflict: (
    artboardId: string,
    mcpSceneId: string,
    incomingRevision: number,
    message: string,
  ) => void;

  setLastKnownMcpRevision: (artboardId: string, revision: number) => void;

  /**
   * Which Documents tab receives MCP session scenes (s1, s2, …) when you pick one from the list.
   * Only one tab is bound so the canvas is not duplicated per scene.
   */
  mcpSessionArtboardId: string | null;
  setMcpSessionArtboardId: (id: string | null) => void;
  bindArtboardMcpSession: (artboardId: string, sessionSceneId: string, sceneLabel: string) => void;

  addArtboard: (
    name?: string,
    width?: number,
    height?: number,
    mcpSceneId?: string,
    options?: { activate?: boolean },
  ) => void;
  removeArtboard: (id: string) => void;
  switchArtboard: (id: string) => void;
  renameArtboard: (id: string, name: string) => void;
  clearArtboardGraph: (id: string) => void;

  importHtml: (html: string, targetArtboardId?: string, opts?: { fromMcp?: boolean }) => Promise<boolean>;
  loadSceneJson: (json: any, targetArtboardId?: string, opts?: { fromMcp?: boolean }) => boolean;
  select: (ids: string[]) => void;
  hover: (id: string | null) => void;
  updateNode: (
    id: string,
    changes: Partial<SceneNode>,
    options?: { recordHistory?: boolean; dragInternal?: boolean },
  ) => void;
  commitHistoryFrame: (label?: string) => void;
  deleteNode: (id: string) => void;
  runAudit: () => void;
  loadDesignMd: (md: string) => void;
  setDesignSystem: (ds: DesignSystem | null) => void;
  setTimeline: (timeline: ITimeline | null) => void;
  setAnimPlaying: (playing: boolean) => void;
  setAnimTime: (time: number) => void;
  undo: () => void;
  redo: () => void;
  getNode: (id: string) => SceneNode | null;
  getINode: (id: string) => INode | null;
  getRootINode: () => INode | null;
  getSelectedNode: () => SceneNode | null;
  exportHtml: () => string;
  exportSvg: () => string;
  exportReact: () => string;
  exportAnimatedHtml: () => string;
  exportLottieJson: () => string;
  rerender: () => void;
}

let nextArtboardNum = 1;

function createArtboardId(): string {
  return `ab_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function createEmptyArtboard(name?: string, width?: number, height?: number, mcpSceneId?: string): Artboard {
  return {
    id: createArtboardId(),
    name: name ?? `Artboard ${nextArtboardNum++}`,
    mcpSceneId,
    graph: null,
    rootId: null,
    renderedHtml: '',
    width: width ?? 0,
    height: height ?? 0,
    timeline: null,
    auditIssues: [],
    history: [],
    historyIndex: -1,
  };
}

/** Canonical path: deserializeToGraph; fallback: core `importSceneNodeFallback` — see core `src/spec/scene-envelope.ts`. */
function buildGraphFromSceneRootJson(root: unknown): { graph: SceneGraph; rootId: string } | null {
  if (!root || typeof root !== 'object' || Array.isArray(root)) return null;
  const migratedRoot = migrateScene(root);
  try {
    const { graph, rootId } = deserializeToGraph(migratedRoot);
    setHost(new StandaloneHost(graph));
    return { graph, rootId };
  } catch {
    try {
      const graph = new SceneGraph();
      setHost(new StandaloneHost(graph));
      const page = graph.addPage('Design');
      const rootId = importSceneNodeFallback(graph, page.id, migratedRoot);
      return { graph, rootId };
    } catch (e2) {
      console.error('buildGraphFromSceneRootJson: deserialize and importSceneNode both failed', e2);
      return null;
    }
  }
}

function exportSceneJson(graph: SceneGraph, nodeId: string): any {
  return serializeSceneNode(graph, nodeId, { compact: true });
}

/** Full scene envelope for undo/redo (root + images + timeline when present). */
function historySnapshot(graph: SceneGraph, rootId: string, timeline: ITimeline | null | undefined) {
  return serializeGraph(graph, rootId, {
    compact: true,
    timeline: timeline ?? undefined,
  });
}

/** Full envelope: @reframe/core `spec/scene-envelope` — `deserializeScene` then `importSceneNodeFallback` + hydrate on failure. */
function deserializeStudioSceneJson(json: {
  root?: unknown;
  version?: number;
  images?: unknown;
  timeline?: unknown;
}): { graph: SceneGraph; rootId: string; timeline: ITimeline | null } | null {
  if (!json?.root || typeof json.root !== 'object' || Array.isArray(json.root)) return null;
  const envelope: Record<string, unknown> = {
    version: typeof json.version === 'number' ? json.version : SERIALIZE_VERSION,
    root: json.root,
  };
  if (json.images != null && typeof json.images === 'object' && !Array.isArray(json.images)) {
    envelope.images = json.images;
  }
  if ('timeline' in json) {
    if (json.timeline === null) {
      envelope.timeline = null;
    } else if (typeof json.timeline === 'object' && !Array.isArray(json.timeline)) {
      envelope.timeline = json.timeline;
    }
  }
  let graph: SceneGraph;
  let rootId: string;
  let timelineOut: ITimeline | null = null;
  try {
    const r = deserializeScene(migrateSceneJSON(envelope as any));
    graph = r.graph;
    rootId = r.rootId;
    timelineOut = r.timeline ?? null;
    setHost(new StandaloneHost(graph));
  } catch {
    const built = buildGraphFromSceneRootJson(json.root);
    if (!built) return null;
    graph = built.graph;
    rootId = built.rootId;
    hydrateSceneImagesBase64(graph, json.images as Record<string, unknown> | null | undefined);
    if ('timeline' in json && json.timeline === null) {
      timelineOut = null;
    } else if (json.timeline != null && typeof json.timeline === 'object' && !Array.isArray(json.timeline)) {
      try {
        timelineOut = deserializeTimeline(json.timeline as any);
      } catch {
        timelineOut = null;
      }
    }
  }
  return { graph, rootId, timeline: timelineOut };
}

export function renderSceneHtml(graph: SceneGraph | null, rootId: string | null): string {
  if (!graph || !rootId) return '';
  try {
    return exportToHtml(graph, rootId, { fullDocument: false, dataAttributes: true });
  } catch { return ''; }
}

function wrapINode(graph: SceneGraph, id: string): INode | null {
  const raw = graph.getNode(id);
  if (!raw) return null;
  return new StandaloneNode(graph, raw);
}

function updateActiveArtboard(artboards: Artboard[], activeId: string, patch: Partial<Artboard>): Artboard[] {
  return artboards.map(ab => ab.id === activeId ? { ...ab, ...patch } : ab);
}

export function getActiveArtboard(
  state: Pick<SceneStore, 'artboards' | 'activeArtboardId'>,
): Artboard | undefined {
  return state.artboards.find(ab => ab.id === state.activeArtboardId);
}

/** Document fields for the active tab (no mirrored root state). */
export function activeDocSlice(state: Pick<SceneStore, 'artboards' | 'activeArtboardId'>) {
  const ab = getActiveArtboard(state);
  return {
    graph: ab?.graph ?? null,
    rootId: ab?.rootId ?? null,
    renderedHtml: ab?.renderedHtml ?? '',
    history: ab?.history ?? [],
    historyIndex: ab?.historyIndex ?? -1,
    timeline: ab?.timeline ?? null,
    auditIssues: ab?.auditIssues ?? [],
  };
}

function persistCurrentArtboardSize(state: SceneStore): Artboard[] {
  const cur = getActiveArtboard(state);
  if (!cur) return state.artboards;
  const sz = artboardSizePatch(cur.graph, cur.rootId);
  return updateActiveArtboard(state.artboards, state.activeArtboardId, { ...cur, ...(sz ?? {}) });
}

function rebindGraphPreview(get: () => SceneStore, set: (fn: any) => void) {
  const st = get();
  const ab = getActiveArtboard(st);
  bindStudioGraphPreview(ab?.graph ?? null, () => {
    const s = get();
    if (s.canvasPointerDragNodeId) return;
    const row = getActiveArtboard(s);
    if (!row?.graph || !row.rootId) return;
    const html = renderSceneHtml(row.graph, row.rootId);
    const sz = artboardSizePatch(row.graph, row.rootId);
    set({
      artboards: updateActiveArtboard(s.artboards, s.activeArtboardId, {
        renderedHtml: html,
        ...(sz ?? {}),
      }),
    });
  });
}

function applyLayoutBestEffort(graph: SceneGraph, rootId: string) {
  ensureSceneLayout(graph, rootId);
}

const initialArtboard = createEmptyArtboard('Untitled');

export const useSceneStore = create<SceneStore>((set, get) => ({
  artboards: [initialArtboard],
  activeArtboardId: initialArtboard.id,
  mcpSessionArtboardId: null,

  selectedIds: [],
  canvasTool: 'select',
  canvasPointerDragNodeId: null,
  canvasSuppressNextClick: false,
  canvasFitNodeId: null,
  hoveredId: null,
  designSystem: null,
  designMd: '',
  animPlaying: false,
  animTime: 0,
  syncConflict: null,

  clearSyncConflict: () => set({ syncConflict: null }),

  raiseSyncConflict: (artboardId, mcpSceneId, incomingRevision, message) =>
    set({ syncConflict: { artboardId, mcpSceneId, incomingRevision, message } }),

  setLastKnownMcpRevision: (artboardId, revision) => {
    set(state => ({
      artboards: state.artboards.map(ab =>
        ab.id === artboardId ? { ...ab, lastKnownMcpRevision: revision } : ab,
      ),
    }));
  },

  setMcpSessionArtboardId: (id) => set({ mcpSessionArtboardId: id }),

  bindArtboardMcpSession: (artboardId, sessionSceneId, sceneLabel) => {
    const sid = String(sessionSceneId).trim();
    const label = (sceneLabel || sid).trim();
    set(state => ({
      artboards: state.artboards.map(ab =>
        ab.id === artboardId ? { ...ab, mcpSceneId: sid, name: `${label} (${sid})` } : ab,
      ),
    }));
  },

  addArtboard: (name?: string, width?: number, height?: number, mcpSceneId?: string, options?: { activate?: boolean }) => {
    const activate = options?.activate !== false;
    const ab = createEmptyArtboard(name, width, height, mcpSceneId);

    if (width && height) {
      const graph = new SceneGraph();
      const host = new StandaloneHost(graph);
      setHost(host);
      const page = graph.addPage('Design');
      const root = graph.createNode('FRAME', page.id, {
        name: ab.name,
        width, height,
        fills: [{ type: 'SOLID' as const, color: { r: 0.1, g: 0.1, b: 0.1, a: 1 }, opacity: 1, visible: true }],
      });
      applyLayoutBestEffort(graph, root.id);
      ab.graph = graph;
      ab.rootId = root.id;
      ab.renderedHtml = renderSceneHtml(graph, root.id);
      ab.width = width;
      ab.height = height;
      ab.history = [{ label: 'Create artboard', sceneJson: historySnapshot(graph, root.id, null) }];
      ab.historyIndex = 0;
    }

    set(state => {
      const boards = persistCurrentArtboardSize(state);
      const nextBoards = [...boards, ab];
      if (!activate) {
        return { artboards: nextBoards };
      }
      return {
        artboards: nextBoards,
        activeArtboardId: ab.id,
        selectedIds: [],
        hoveredId: null,
      };
    });
    if (activate) {
      const st = get();
      const added = st.artboards.find(b => b.id === ab.id);
      if (added?.graph) setHost(new StandaloneHost(added.graph));
      rebindGraphPreview(get, set);
    }
  },

  removeArtboard: (id: string) => {
    const state = get();
    if (state.artboards.length <= 1) return;
    const remaining = state.artboards.filter(ab => ab.id !== id);
    const newActiveId = id === state.activeArtboardId ? remaining[0].id : state.activeArtboardId;
    set({
      artboards: remaining,
      activeArtboardId: newActiveId,
      selectedIds: [],
      hoveredId: null,
      ...(state.mcpSessionArtboardId === id ? { mcpSessionArtboardId: null } : {}),
    });
    const active = getActiveArtboard(get());
    if (active?.graph) setHost(new StandaloneHost(active.graph));
    else disposeStudioGraphPreview();
    rebindGraphPreview(get, set);
  },

  switchArtboard: (id: string) => {
    const state = get();
    if (id === state.activeArtboardId) return;
    const boards = persistCurrentArtboardSize(state);
    const target = boards.find(ab => ab.id === id);
    if (!target) return;

    if (target.graph) {
      setHost(new StandaloneHost(target.graph));
    } else {
      setHost(new StandaloneHost(new SceneGraph()));
    }

    set({
      artboards: boards,
      activeArtboardId: id,
      selectedIds: [],
      hoveredId: null,
      animPlaying: false,
      animTime: 0,
    });
    rebindGraphPreview(get, set);
  },

  renameArtboard: (id: string, name: string) => {
    set(state => ({
      artboards: state.artboards.map(ab => ab.id === id ? { ...ab, name } : ab),
    }));
  },

  clearArtboardGraph: (id: string) => {
    set(state => {
      const blank = {
        graph: null as SceneGraph | null,
        rootId: null as string | null,
        renderedHtml: '',
        width: 0,
        height: 0,
        history: [] as HistoryEntry[],
        historyIndex: -1,
        auditIssues: [] as AuditIssue[],
        timeline: null as ITimeline | null,
        lastKnownMcpRevision: undefined as number | undefined,
      };
      const artboards = state.artboards.map(ab => (ab.id === id ? { ...ab, ...blank } : ab));
      const isActive = state.activeArtboardId === id;
      return {
        artboards,
        ...(isActive
          ? {
              selectedIds: [],
              hoveredId: null,
              animPlaying: false,
              animTime: 0,
            }
          : {}),
      };
    });
    if (get().activeArtboardId === id) {
      disposeStudioGraphPreview();
    }
  },

  importHtml: (html: string, targetArtboardIdArg?: string, opts?: { fromMcp?: boolean }): Promise<boolean> => {
    const targetArtboardId = targetArtboardIdArg ?? get().activeArtboardId;
    const fromMcp = opts?.fromMcp === true;
    return importFromHtml(html)
      .then((result) => {
        const { graph, rootId } = result;
        const host = new StandaloneHost(graph);
        setHost(host);
        applyLayoutBestEffort(graph, rootId);
        const renderedHtml = renderSceneHtml(graph, rootId);
        const root = graph.getNode(rootId);
        const snap = historySnapshot(graph, rootId, null);

        set(state => {
          const targetAb = state.artboards.find(ab => ab.id === targetArtboardId);
          const prevHistory = targetAb?.history ?? [];
          const prevHistoryIndex = targetAb?.historyIndex ?? -1;
          const newHistory = [...prevHistory.slice(0, prevHistoryIndex + 1), { label: 'Import HTML', sceneJson: snap }];
          const newHistoryIndex = prevHistoryIndex + 1;
          return {
            artboards: updateActiveArtboard(state.artboards, targetArtboardId, {
              graph, rootId, renderedHtml,
              width: root?.width ?? 0,
              height: root?.height ?? 0,
              auditIssues: [],
              history: newHistory,
              historyIndex: newHistoryIndex,
            }),
            ...(state.activeArtboardId === targetArtboardId
              ? { selectedIds: [], hoveredId: null }
              : {}),
          };
        });
        if (!fromMcp) markLocalDirty(targetArtboardId);
        const vis = getActiveArtboard(get());
        if (vis?.graph) setHost(new StandaloneHost(vis.graph));
        rebindGraphPreview(get, set);
        if (get().activeArtboardId === targetArtboardId) {
          scheduleDebouncedAudit(get);
        }
        return true;
      })
      .catch(e => {
        console.error('Import failed:', e);
        return false;
      });
  },

  loadSceneJson: (json: any, targetArtboardId?: string, opts?: { fromMcp?: boolean }): boolean => {
    const fromMcp = opts?.fromMcp === true;
    if (!json?.root || typeof json.root !== 'object' || Array.isArray(json.root)) {
      console.error('loadSceneJson: missing or invalid json.root');
      return false;
    }
    const rowId = targetArtboardId ?? get().activeArtboardId;
    if (!get().artboards.some(a => a.id === rowId)) {
      console.error('loadSceneJson: artboard not in store', rowId);
      return false;
    }
    const decoded = deserializeStudioSceneJson(json);
    if (!decoded) {
      console.error('loadSceneJson: envelope deserialize and importSceneNode both failed');
      return false;
    }
    const { graph, rootId, timeline: timelineOut } = decoded;
    applyLayoutBestEffort(graph, rootId);
    const renderedHtml = renderSceneHtml(graph, rootId);
    const root = graph.getNode(rootId);

    set(state => {
      const tid = targetArtboardId ?? state.activeArtboardId;
      const targetAb = state.artboards.find(ab => ab.id === tid);
      const prevHistory = targetAb?.history ?? [];
      const prevHistoryIndex = targetAb?.historyIndex ?? -1;
      const newHistory = [
        ...prevHistory.slice(0, prevHistoryIndex + 1),
        { label: 'Load scene', sceneJson: historySnapshot(graph, rootId, timelineOut) },
      ];
      const newHistoryIndex = prevHistoryIndex + 1;
      return {
        artboards: updateActiveArtboard(state.artboards, tid, {
          graph,
          rootId,
          renderedHtml,
          width: root?.width ?? 0,
          height: root?.height ?? 0,
          timeline: timelineOut,
          history: newHistory,
          historyIndex: newHistoryIndex,
        }),
        ...(state.activeArtboardId === tid ? { selectedIds: [], hoveredId: null } : {}),
      };
    });

    const ab = getActiveArtboard(get());
    if (ab?.graph) setHost(new StandaloneHost(ab.graph));
    rebindGraphPreview(get, set);

    if (!targetArtboardId || get().activeArtboardId === targetArtboardId) {
      scheduleDebouncedAudit(get);
    }
    if (!fromMcp) markLocalDirty(rowId);
    return true;
  },

  select: (ids) => set({ selectedIds: ids }),
  hover: (id) => set({ hoveredId: id }),

  setCanvasTool: (canvasTool) => set({ canvasTool, canvasSuppressNextClick: false }),

  addCanvasShape: (kind, atX, atY) => {
    const { graph, rootId } = activeDocSlice(get());
    if (!graph || !rootId) return;

    const solid = (r: number, g: number, b: number): Fill => ({
      type: 'SOLID',
      color: { r, g, b, a: 1 },
      opacity: 1,
      visible: true,
    });

    const abs = { layoutPositioning: 'ABSOLUTE' as const };
    let node: SceneNode;

    if (kind === 'frame') {
      const w = 280;
      const h = 180;
      node = graph.createNode('FRAME', rootId, {
        ...abs,
        name: 'Frame',
        x: Math.round(atX - w / 2),
        y: Math.round(atY - h / 2),
        width: w,
        height: h,
        layoutMode: 'NONE',
        fills: [solid(0.15, 0.14, 0.22)],
        cornerRadius: 8,
      });
    } else if (kind === 'rect') {
      const w = 160;
      const h = 100;
      node = graph.createNode('RECTANGLE', rootId, {
        ...abs,
        name: 'Rectangle',
        x: Math.round(atX - w / 2),
        y: Math.round(atY - h / 2),
        width: w,
        height: h,
        fills: [solid(0.39, 0.4, 0.95)],
        cornerRadius: 6,
      });
    } else {
      const w = 220;
      const h = 48;
      node = graph.createNode('TEXT', rootId, {
        ...abs,
        name: 'Text',
        x: Math.round(atX - w / 2),
        y: Math.round(atY - h / 2),
        width: w,
        height: h,
        text: 'Text',
        fontSize: 20,
        fontWeight: 500,
        fills: [solid(0.92, 0.92, 0.94)],
      });
    }

    cancelPendingStudioGraphPreview();
    const tl = getActiveArtboard(get())?.timeline ?? null;
    const snap = historySnapshot(graph, rootId, tl);
    const renderedHtml = renderSceneHtml(graph, rootId);
    const sz = artboardSizePatch(graph, rootId);
    const aid = get().activeArtboardId;
    set(state => {
      const row = getActiveArtboard(state);
      const h0 = row?.history ?? [];
      const hi = row?.historyIndex ?? -1;
      const newHistory = [...h0.slice(0, hi + 1), { label: `Add ${kind}`, sceneJson: snap }];
      const newHistoryIndex = hi + 1;
      return {
        selectedIds: [node.id],
        canvasTool: 'select',
        canvasFitNodeId: node.id,
        artboards: updateActiveArtboard(state.artboards, state.activeArtboardId, {
          ...sz,
          renderedHtml,
          history: newHistory,
          historyIndex: newHistoryIndex,
        }),
      };
    });
    markLocalDirty(aid);
    scheduleDebouncedAudit(get);
  },

  updateNode: (id, changes, options) => {
    const dragId = get().canvasPointerDragNodeId;
    if (dragId !== null && id === dragId && !options?.dragInternal) {
      return;
    }
    const recordHistory = options?.recordHistory !== false;
    const { graph, rootId, history, historyIndex } = activeDocSlice(get());
    if (!graph || !rootId) return;
    graph.updateNode(id, changes);
    const sz = artboardSizePatch(graph, rootId);
    const aid = get().activeArtboardId;

    if (recordHistory) {
      cancelPendingStudioGraphPreview();
      const tl = getActiveArtboard(get())?.timeline ?? null;
      const snap = historySnapshot(graph, rootId, tl);
      const renderedHtml = renderSceneHtml(graph, rootId);
      set(state => {
        const h0 = getActiveArtboard(state)?.history ?? history;
        const hi = getActiveArtboard(state)?.historyIndex ?? historyIndex;
        const newHistory = [...h0.slice(0, hi + 1), { label: `Update ${id}`, sceneJson: snap }];
        const newHistoryIndex = hi + 1;
        return {
          artboards: updateActiveArtboard(state.artboards, state.activeArtboardId, {
            ...sz,
            renderedHtml,
            history: newHistory,
            historyIndex: newHistoryIndex,
          }),
        };
      });
    } else {
      set(state => ({
        artboards: updateActiveArtboard(state.artboards, state.activeArtboardId, {
          ...sz,
        }),
      }));
    }
    markLocalDirty(aid);
    scheduleDebouncedAudit(get);
  },

  commitHistoryFrame: (label) => {
    const { graph, rootId, history, historyIndex } = activeDocSlice(get());
    if (!graph || !rootId) return;
    const tl = getActiveArtboard(get())?.timeline ?? null;
    const snap = historySnapshot(graph, rootId, tl);
    const aid = get().activeArtboardId;
    set(state => {
      const h0 = getActiveArtboard(state)?.history ?? history;
      const hi = getActiveArtboard(state)?.historyIndex ?? historyIndex;
      const newHistory = [
        ...h0.slice(0, hi + 1),
        { label: label ?? 'Edit', sceneJson: snap },
      ];
      const newHistoryIndex = hi + 1;
      return {
        artboards: updateActiveArtboard(state.artboards, state.activeArtboardId, {
          history: newHistory,
          historyIndex: newHistoryIndex,
        }),
      };
    });
    markLocalDirty(aid);
    cancelPendingStudioGraphPreview();
    const row = getActiveArtboard(get());
    if (row?.graph && row.rootId) {
      const renderedHtml = renderSceneHtml(row.graph, row.rootId);
      set(state => ({
        artboards: updateActiveArtboard(state.artboards, state.activeArtboardId, {
          renderedHtml,
        }),
      }));
    }
    scheduleDebouncedAudit(get);
  },

  deleteNode: (id) => {
    const { graph, rootId, history, historyIndex } = activeDocSlice(get());
    if (!graph || !rootId || id === rootId) return;
    graph.deleteNode(id);
    cancelPendingStudioGraphPreview();
    const tl = getActiveArtboard(get())?.timeline ?? null;
    const snap = historySnapshot(graph, rootId, tl);
    const renderedHtml = renderSceneHtml(graph, rootId);
    const sz = artboardSizePatch(graph, rootId);
    const aid = get().activeArtboardId;
    set(state => {
      const h0 = getActiveArtboard(state)?.history ?? history;
      const hi = getActiveArtboard(state)?.historyIndex ?? historyIndex;
      const newHistory = [...h0.slice(0, hi + 1), { label: `Delete ${id}`, sceneJson: snap }];
      const newHistoryIndex = hi + 1;
      return {
        selectedIds: state.selectedIds.filter(s => s !== id),
        artboards: updateActiveArtboard(state.artboards, state.activeArtboardId, {
          ...sz,
          renderedHtml,
          history: newHistory,
          historyIndex: newHistoryIndex,
        }),
      };
    });
    markLocalDirty(aid);
    scheduleDebouncedAudit(get);
  },

  runAudit: () => {
    const { graph, rootId } = activeDocSlice(get());
    const { designSystem } = get();
    if (!graph || !rootId) return;
    try {
      applyLayoutBestEffort(graph, rootId);
      const rootINode = wrapINode(graph, rootId);
      if (!rootINode) return;
      const rules = buildInspectAuditRules(designSystem ?? undefined, {
        minFontSize: 8,
        minContrast: 3,
      });
      const issues = audit(rootINode, rules, designSystem ?? undefined);
      set(state => ({
        artboards: updateActiveArtboard(state.artboards, state.activeArtboardId, { auditIssues: issues }),
      }));
    } catch (e) {
      console.error('Audit failed:', e);
    }
  },

  loadDesignMd: (md: string) => {
    try {
      const ds = parseDesignMd(md);
      set({ designMd: md, designSystem: ds });
      scheduleDebouncedAudit(get);
    } catch (e) {
      console.error('Failed to parse DESIGN.md:', e);
    }
  },

  setDesignSystem: (ds) => set({ designSystem: ds }),

  setTimeline: (timeline) => {
    set(state => ({
      artboards: updateActiveArtboard(state.artboards, state.activeArtboardId, { timeline }),
    }));
  },

  setAnimPlaying: (playing) => set({ animPlaying: playing }),
  setAnimTime: (time) => set({ animTime: time }),

  undo: () => {
    const { history, historyIndex } = activeDocSlice(get());
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    const entry = history[newIndex];
    const decoded = deserializeStudioSceneJson(entry.sceneJson);
    if (!decoded) return;
    const { graph, rootId, timeline: timelineOut } = decoded;
    applyLayoutBestEffort(graph, rootId);
    const renderedHtml = renderSceneHtml(graph, rootId);
    const sz = artboardSizePatch(graph, rootId);
    const aid = get().activeArtboardId;
    set(state => ({
      selectedIds: [],
      artboards: updateActiveArtboard(state.artboards, state.activeArtboardId, {
        graph, rootId, renderedHtml, historyIndex: newIndex, timeline: timelineOut,
        ...(sz ?? {}),
      }),
    }));
    markLocalDirty(aid);
    rebindGraphPreview(get, set);
    scheduleDebouncedAudit(get);
  },

  redo: () => {
    const { history, historyIndex } = activeDocSlice(get());
    if (historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    const entry = history[newIndex];
    const decoded = deserializeStudioSceneJson(entry.sceneJson);
    if (!decoded) return;
    const { graph, rootId, timeline: timelineOut } = decoded;
    applyLayoutBestEffort(graph, rootId);
    const renderedHtml = renderSceneHtml(graph, rootId);
    const sz = artboardSizePatch(graph, rootId);
    const aid = get().activeArtboardId;
    set(state => ({
      selectedIds: [],
      artboards: updateActiveArtboard(state.artboards, state.activeArtboardId, {
        graph, rootId, renderedHtml, historyIndex: newIndex, timeline: timelineOut,
        ...(sz ?? {}),
      }),
    }));
    markLocalDirty(aid);
    rebindGraphPreview(get, set);
    scheduleDebouncedAudit(get);
  },

  getNode: (id) => activeDocSlice(get()).graph?.getNode(id) ?? null,

  getINode: (id) => {
    const { graph } = activeDocSlice(get());
    return graph ? wrapINode(graph, id) : null;
  },

  getRootINode: () => {
    const { graph, rootId } = activeDocSlice(get());
    return (graph && rootId) ? wrapINode(graph, rootId) : null;
  },

  getSelectedNode: () => {
    const { graph } = activeDocSlice(get());
    const { selectedIds } = get();
    if (!graph || selectedIds.length === 0) return null;
    return graph.getNode(selectedIds[0]) ?? null;
  },

  exportHtml: () => {
    const { graph, rootId } = activeDocSlice(get());
    if (!graph || !rootId) return '';
    return exportToHtml(graph, rootId, { fullDocument: true });
  },

  exportSvg: () => {
    const { graph, rootId } = activeDocSlice(get());
    if (!graph || !rootId) return '';
    return exportSceneGraphToSvg(graph, rootId);
  },

  exportReact: () => {
    const { graph, rootId } = activeDocSlice(get());
    if (!graph || !rootId) return '';
    const inode = wrapINode(graph, rootId);
    if (!inode) return '';
    return exportToReact(inode);
  },

  exportAnimatedHtml: () => {
    const { graph, rootId, timeline } = activeDocSlice(get());
    if (!graph || !rootId || !timeline) return '';
    return exportToAnimatedHtml(graph, rootId, timeline, { controls: true });
  },

  exportLottieJson: () => {
    const { graph, rootId, timeline } = activeDocSlice(get());
    if (!graph || !rootId || !timeline) return '';
    return JSON.stringify(exportToLottie(graph, rootId, timeline), null, 2);
  },

  rerender: () => {
    const { graph, rootId } = activeDocSlice(get());
    const sz = artboardSizePatch(graph, rootId);
    set(state => ({
      artboards: updateActiveArtboard(state.artboards, state.activeArtboardId, {
        renderedHtml: renderSceneHtml(graph, rootId),
        ...(sz ?? {}),
      }),
    }));
  },
}));

rebindGraphPreview(() => useSceneStore.getState(), useSceneStore.setState);
