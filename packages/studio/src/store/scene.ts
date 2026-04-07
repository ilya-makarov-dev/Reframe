/**
 * Scene Store — multi-artboard, SceneGraph state, selection, undo/redo, audit, animation.
 *
 * The single source of truth for the entire studio.
 * Supports multiple artboards — each with its own graph, timeline, audit state.
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
import {
  audit, textOverflow, minFontSize, contrastMinimum, noEmptyText, noZeroSize,
  fontInPalette, colorInPalette, fontWeightCompliance, borderRadiusCompliance,
  spacingGridCompliance, fontSizeRoleMatch,
  visualHierarchy, contentDensity, visualBalance, ctaVisibility,
  nodeOverflow, noHiddenNodes, exportFidelity,
} from '@reframe/core/audit';
import type { AuditIssue, AuditRule } from '@reframe/core/audit';
import { parseDesignMd } from '@reframe/core/design-system';
import type { DesignSystem } from '@reframe/core/design-system';
import type { SceneNode } from '@reframe/core/engine/types';
import type { ITimeline } from '@reframe/core/animation/types';
import { serializeSceneNode, migrateScene, deserializeToGraph } from '@reframe/core/serialize';
import type { INode } from '@reframe/core/host/types';
import type { Fill } from '@reframe/core/engine/types';
import { artboardSizePatch } from '../lib/scene-stats';

// ─── Helpers — INode fill normalization ────────────────────────
// INode fills may be hex strings ('#FF0000') or IPaint objects.
// SceneGraph expects Fill[] with { type, color: {r,g,b,a}, opacity, visible }.

function hexToColor(hex: string): { r: number; g: number; b: number; a: number } {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { r: r || 0, g: g || 0, b: b || 0, a };
}

function normalizeFills(fills: any[]): Fill[] {
  if (!Array.isArray(fills)) return [];
  return fills.map((f): Fill | null => {
    if (!f) return null;
    // Hex string
    if (typeof f === 'string' && f.startsWith('#')) {
      const c = hexToColor(f);
      return { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b, a: 1 }, opacity: c.a, visible: true } as Fill;
    }
    // IPaint / Fill object
    if (typeof f === 'object') {
      const type = (f.type || 'SOLID') as Fill['type'];
      const color = f.color && typeof f.color === 'object' && 'r' in f.color
        ? { r: f.color.r ?? 0, g: f.color.g ?? 0, b: f.color.b ?? 0, a: f.color.a ?? 1 }
        : { r: 0, g: 0, b: 0, a: 1 };
      return { type, color, opacity: f.opacity ?? 1, visible: f.visible ?? true } as Fill;
    }
    return null;
  }).filter((f): f is Fill => f !== null);
}

// ─── Types ─────────────────────────────────────────────────────

export interface HistoryEntry {
  label: string;
  sceneJson: any;
}

export interface Artboard {
  id: string;
  name: string;
  /** When this artboard mirrors an MCP session scene (s1, s2, …), stable lookup key. */
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
}

/** Bottom toolbox tools — drives canvas placement + selection behavior */
export type CanvasTool = 'select' | 'frame' | 'rect' | 'pen' | 'text' | 'image';

export interface SceneStore {
  // Multi-artboard
  artboards: Artboard[];
  activeArtboardId: string;

  // Active artboard accessors (derived from active artboard)
  graph: SceneGraph | null;
  rootId: string | null;
  renderedHtml: string;

  /** Floating bottom toolbox (Figma-style) */
  canvasTool: CanvasTool;
  setCanvasTool: (tool: CanvasTool) => void;
  /** Add a primitive on the artboard root at design-space coordinates (centered on x,y) */
  addCanvasShape: (kind: 'frame' | 'rect' | 'text', x: number, y: number) => void;

  /**
   * While set, `updateNode` for this id is ignored unless `options.dragInternal` is true.
   * Prevents full HTML re-export mid-drag (would wipe CSS transform preview and teleport the node).
   */
  canvasPointerDragNodeId: string | null;

  // Selection (global — not per-artboard)
  selectedIds: string[];
  hoveredId: string | null;

  // Intelligence (global)
  auditIssues: AuditIssue[];
  designSystem: DesignSystem | null;
  designMd: string;

  // Animation (from active artboard)
  timeline: ITimeline | null;
  animPlaying: boolean;
  animTime: number;

  // History (from active artboard)
  history: HistoryEntry[];
  historyIndex: number;

  // Artboard actions
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
  /** Clear graph/HTML for an artboard (e.g. MCP scene removed while it is the only tab). */
  clearArtboardGraph: (id: string) => void;

  // Scene actions
  importHtml: (html: string, targetArtboardId?: string) => Promise<boolean>;
  loadSceneJson: (json: any, targetArtboardId?: string) => boolean;
  select: (ids: string[]) => void;
  hover: (id: string | null) => void;
  updateNode: (
    id: string,
    changes: Partial<SceneNode>,
    options?: { recordHistory?: boolean; dragInternal?: boolean },
  ) => void;
  /** One undo step after a gesture that used updateNode(..., { recordHistory: false }) (e.g. drag). */
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

// ─── Helpers ───────────────────────────────────────────────────

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

function importSceneNode(graph: SceneGraph, parentId: string, json: any): string {
  const migrated = migrateScene(json);
  const overrides: Record<string, any> = {};
  const skip = new Set(['type', 'children', 'name', 'id', 'version', 'timeline', 'strokeWeight']);
  for (const [key, value] of Object.entries(migrated)) {
    if (skip.has(key) || value === undefined) continue;
    overrides[key] = value;
  }
  // Normalize INode fills (hex strings / IPaint) → SceneNode Fill[]
  if (overrides.fills) {
    overrides.fills = normalizeFills(overrides.fills);
  }
  // Normalize constraints → engine fields
  if (migrated.constraints) {
    overrides.horizontalConstraint = migrated.constraints.horizontal;
    overrides.verticalConstraint = migrated.constraints.vertical;
    delete overrides.constraints;
  }
  // Normalize characters → text
  if ('characters' in overrides && !('text' in overrides)) {
    overrides.text = overrides.characters;
    delete overrides.characters;
  }
  const node = graph.createNode(migrated.type ?? 'FRAME', parentId, {
    name: migrated.name ?? migrated.type ?? 'Node',
    ...overrides,
  });
  if (migrated.children) {
    for (const child of migrated.children) {
      importSceneNode(graph, node.id, child);
    }
  }
  return node.id;
}

function exportSceneJson(graph: SceneGraph, nodeId: string): any {
  return serializeSceneNode(graph, nodeId, { compact: true });
}

function renderHtml(graph: SceneGraph | null, rootId: string | null): string {
  if (!graph || !rootId) return '';
  try {
    return exportToHtml(graph, rootId, { fullDocument: false, dataAttributes: true });
  } catch { return ''; }
}

function getDefaultRules(ds?: DesignSystem): AuditRule[] {
  const rules: AuditRule[] = [
    textOverflow(), nodeOverflow(), minFontSize(10),
    contrastMinimum(4.5), noEmptyText(), noZeroSize(), noHiddenNodes(),
  ];
  if (ds) {
    rules.push(
      fontInPalette(), colorInPalette(), fontWeightCompliance(),
      borderRadiusCompliance(), spacingGridCompliance(), fontSizeRoleMatch(),
    );
  }
  rules.push(visualHierarchy(), contentDensity(), visualBalance(), ctaVisibility());
  rules.push(exportFidelity());
  return rules;
}

function wrapINode(graph: SceneGraph, id: string): INode | null {
  const raw = graph.getNode(id);
  if (!raw) return null;
  return new StandaloneNode(graph, raw);
}

/** Update the active artboard in the artboards array */
function updateActiveArtboard(artboards: Artboard[], activeId: string, patch: Partial<Artboard>): Artboard[] {
  return artboards.map(ab => ab.id === activeId ? { ...ab, ...patch } : ab);
}

/** Get current active artboard */
function getActiveArtboard(state: { artboards: Artboard[]; activeArtboardId: string }): Artboard | undefined {
  return state.artboards.find(ab => ab.id === state.activeArtboardId);
}

/**
 * Effective document for the active tab. Prefer the artboard row — it can be ahead of duplicated
 * top-level fields after async MCP loads (fixes “No scene loaded” while s4 graph exists on the tab).
 */
function activeDocSlice(state: {
  artboards: Artboard[];
  activeArtboardId: string;
  graph: SceneGraph | null;
  rootId: string | null;
  renderedHtml: string;
  history: HistoryEntry[];
  historyIndex: number;
  timeline: ITimeline | null;
  auditIssues: AuditIssue[];
}) {
  const ab = state.artboards.find(a => a.id === state.activeArtboardId);
  return {
    graph: ab?.graph ?? state.graph,
    rootId: ab?.rootId ?? state.rootId,
    renderedHtml: (ab?.graph && ab?.rootId)
      ? (ab.renderedHtml ?? state.renderedHtml)
      : state.renderedHtml,
    history: ab?.history ?? state.history,
    historyIndex: ab?.historyIndex ?? state.historyIndex,
    timeline: ab?.timeline !== undefined ? ab.timeline : state.timeline,
    auditIssues: ab?.auditIssues ?? state.auditIssues,
  };
}

// ─── Store ─────────────────────────────────────────────────────

const initialArtboard = createEmptyArtboard('Artboard 1');

export const useSceneStore = create<SceneStore>((set, get) => ({
  artboards: [initialArtboard],
  activeArtboardId: initialArtboard.id,

  graph: null,
  rootId: null,
  renderedHtml: '',
  selectedIds: [],
  canvasTool: 'select',
  canvasPointerDragNodeId: null,
  auditIssues: [],
  hoveredId: null,
  designSystem: null,
  designMd: '',
  timeline: null,
  animPlaying: false,
  animTime: 0,
  history: [],
  historyIndex: -1,

  // ─── Artboard actions ──────────────────────────────────────

  addArtboard: (name?: string, width?: number, height?: number, mcpSceneId?: string, options?: { activate?: boolean }) => {
    const activate = options?.activate !== false;
    const ab = createEmptyArtboard(name, width, height, mcpSceneId);

    // If width/height specified, create a scene with an empty frame
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
      ab.graph = graph;
      ab.rootId = root.id;
      ab.renderedHtml = renderHtml(graph, root.id);
      ab.width = width;
      ab.height = height;
      const sceneJson = exportSceneJson(graph, root.id);
      ab.history = [{ label: 'Create artboard', sceneJson: { root: sceneJson } }];
      ab.historyIndex = 0;
    }

    set(state => {
      const sizePatch = artboardSizePatch(state.graph, state.rootId);
      // Save current artboard state before switching
      const savedArtboards = updateActiveArtboard(state.artboards, state.activeArtboardId, {
        graph: state.graph,
        rootId: state.rootId,
        renderedHtml: state.renderedHtml,
        timeline: state.timeline,
        auditIssues: state.auditIssues,
        history: state.history,
        historyIndex: state.historyIndex,
        ...(sizePatch ?? {}),
      });

      const nextBoards = [...savedArtboards, ab];
      if (!activate) {
        return { artboards: nextBoards };
      }

      return {
        artboards: nextBoards,
        activeArtboardId: ab.id,
        graph: ab.graph,
        rootId: ab.rootId,
        renderedHtml: ab.renderedHtml,
        timeline: ab.timeline,
        auditIssues: ab.auditIssues,
        history: ab.history,
        historyIndex: ab.historyIndex,
        selectedIds: [],
        hoveredId: null,
      };
    });
  },

  removeArtboard: (id: string) => {
    const state = get();
    if (state.artboards.length <= 1) return;
    const remaining = state.artboards.filter(ab => ab.id !== id);
    const newActiveId = id === state.activeArtboardId ? remaining[0].id : state.activeArtboardId;
    const active = remaining.find(ab => ab.id === newActiveId)!;

    set({
      artboards: remaining,
      activeArtboardId: newActiveId,
      graph: active.graph,
      rootId: active.rootId,
      renderedHtml: active.renderedHtml,
      timeline: active.timeline,
      auditIssues: active.auditIssues,
      history: active.history,
      historyIndex: active.historyIndex,
      selectedIds: [],
      hoveredId: null,
    });
  },

  switchArtboard: (id: string) => {
    const state = get();
    if (id === state.activeArtboardId) return;

    const sizePatch = artboardSizePatch(state.graph, state.rootId);
    // Save current state to current artboard
    const updatedArtboards = updateActiveArtboard(state.artboards, state.activeArtboardId, {
      graph: state.graph,
      rootId: state.rootId,
      renderedHtml: state.renderedHtml,
      timeline: state.timeline,
      auditIssues: state.auditIssues,
      history: state.history,
      historyIndex: state.historyIndex,
      ...(sizePatch ?? {}),
    });

    const target = updatedArtboards.find(ab => ab.id === id);
    if (!target) return;

    // Restore host context if graph exists
    if (target.graph) {
      const host = new StandaloneHost(target.graph);
      setHost(host);
    }

    set({
      artboards: updatedArtboards,
      activeArtboardId: id,
      graph: target.graph,
      rootId: target.rootId,
      renderedHtml: target.renderedHtml,
      timeline: target.timeline,
      auditIssues: target.auditIssues,
      history: target.history,
      historyIndex: target.historyIndex,
      selectedIds: [],
      hoveredId: null,
      animPlaying: false,
      animTime: 0,
    });
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
      };
      const artboards = state.artboards.map(ab => (ab.id === id ? { ...ab, ...blank } : ab));
      const isActive = state.activeArtboardId === id;
      return {
        artboards,
        ...(isActive
          ? {
              ...blank,
              selectedIds: [],
              hoveredId: null,
              animPlaying: false,
              animTime: 0,
            }
          : {}),
      };
    });
  },

  // ─── Scene actions ─────────────────────────────────────────

  importHtml: (html: string, targetArtboardIdArg?: string): Promise<boolean> => {
    // Capture target artboard ID now — by the time the promise resolves
      // the user may have switched to a different artboard.
      const targetArtboardId = targetArtboardIdArg ?? get().activeArtboardId;
    return importFromHtml(html)
      .then((result) => {
        const { graph, rootId } = result;
        const host = new StandaloneHost(graph);
        setHost(host);
        const renderedHtml = renderHtml(graph, rootId);
        const sceneJson = exportSceneJson(graph, rootId);
        const root = graph.getNode(rootId);

        set(state => {
          const isStillActive = state.activeArtboardId === targetArtboardId;
          const targetAb = state.artboards.find(ab => ab.id === targetArtboardId);
          const prevHistory = isStillActive ? state.history : (targetAb?.history ?? []);
          const prevHistoryIndex = isStillActive ? state.historyIndex : (targetAb?.historyIndex ?? -1);
          const newHistory = [...prevHistory.slice(0, prevHistoryIndex + 1), { label: 'Import HTML', sceneJson: { root: sceneJson } }];
          const newHistoryIndex = prevHistoryIndex + 1;
          return {
            // Only update top-level props when this artboard is still active
            ...(isStillActive ? {
              graph, rootId, renderedHtml,
              selectedIds: [], hoveredId: null, auditIssues: [],
              history: newHistory,
              historyIndex: newHistoryIndex,
            } : {}),
            artboards: updateActiveArtboard(state.artboards, targetArtboardId, {
              graph, rootId, renderedHtml,
              width: root?.width ?? 0,
              height: root?.height ?? 0,
              auditIssues: [],
              history: newHistory,
              historyIndex: newHistoryIndex,
            }),
          };
        });
        const vis = activeDocSlice(get());
        if (vis.graph) setHost(new StandaloneHost(vis.graph));
        // Auto-audit only when still active
        if (get().activeArtboardId === targetArtboardId) {
          setTimeout(() => get().runAudit(), 50);
        }
        return true;
      })
      .catch(e => {
        console.error('Import failed:', e);
        return false;
      });
  },

  loadSceneJson: (json: any, targetArtboardId?: string): boolean => {
    if (!json?.root || typeof json.root !== 'object' || Array.isArray(json.root)) {
      console.error('loadSceneJson: missing or invalid json.root');
      return false;
    }
    const rowId = targetArtboardId ?? get().activeArtboardId;
    if (!get().artboards.some(a => a.id === rowId)) {
      console.error('loadSceneJson: artboard not in store', rowId);
      return false;
    }
    let graph: SceneGraph;
    let rootId: string;
    try {
      graph = new SceneGraph();
      const host = new StandaloneHost(graph);
      setHost(host);
      const page = graph.addPage('Design');
      rootId = importSceneNode(graph, page.id, json.root);
    } catch (e1) {
      console.warn('loadSceneJson: importSceneNode failed, trying deserializeToGraph', e1);
      try {
        ({ graph, rootId } = deserializeToGraph(json.root));
        const host = new StandaloneHost(graph);
        setHost(host);
      } catch (e2) {
        console.error('loadSceneJson: failed to build graph', e2);
        return false;
      }
    }
    const renderedHtml = renderHtml(graph, rootId);
    const root = graph.getNode(rootId);
    const sceneJsonRoot = exportSceneJson(graph, rootId);

    set(state => {
      const tid = targetArtboardId ?? state.activeArtboardId;
      const isStillActive = state.activeArtboardId === tid;
      const targetAb = state.artboards.find(ab => ab.id === tid);
      const prevHistory = isStillActive ? state.history : (targetAb?.history ?? []);
      const prevHistoryIndex = isStillActive ? state.historyIndex : (targetAb?.historyIndex ?? -1);
      const newHistory = [
        ...prevHistory.slice(0, prevHistoryIndex + 1),
        { label: 'Load scene', sceneJson: { root: sceneJsonRoot } },
      ];
      const newHistoryIndex = prevHistoryIndex + 1;
      return {
        ...(isStillActive
          ? {
              graph,
              rootId,
              renderedHtml,
              selectedIds: [],
              hoveredId: null,
              history: newHistory,
              historyIndex: newHistoryIndex,
            }
          : {}),
        artboards: updateActiveArtboard(state.artboards, tid, {
          graph,
          rootId,
          renderedHtml,
          width: root?.width ?? 0,
          height: root?.height ?? 0,
          history: newHistory,
          historyIndex: newHistoryIndex,
        }),
      };
    });

    const st = get();
    const tidFinal = targetArtboardId ?? st.activeArtboardId;
    if (st.activeArtboardId === tidFinal) {
      const ab = st.artboards.find(a => a.id === tidFinal);
      if (ab?.graph && ab.rootId && (st.graph !== ab.graph || st.rootId !== ab.rootId)) {
        set({
          graph: ab.graph,
          rootId: ab.rootId,
          renderedHtml: ab.renderedHtml,
          history: ab.history,
          historyIndex: ab.historyIndex,
        });
      }
    }

    const vis = activeDocSlice(get());
    if (vis.graph) setHost(new StandaloneHost(vis.graph));

    setTimeout(() => {
      const s = get();
      if (!targetArtboardId || s.activeArtboardId === targetArtboardId) s.runAudit();
    }, 50);
    return true;
  },

  select: (ids) => set({ selectedIds: ids }),
  hover: (id) => set({ hoveredId: id }),

  setCanvasTool: (canvasTool) => set({ canvasTool }),

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

    const renderedHtml = renderHtml(graph, rootId);
    const sceneJson = exportSceneJson(graph, rootId);
    const sz = artboardSizePatch(graph, rootId);
    set(state => {
      const newHistory = [
        ...state.history.slice(0, state.historyIndex + 1),
        { label: `Add ${kind}`, sceneJson: { root: sceneJson } },
      ];
      const newHistoryIndex = state.historyIndex + 1;
      return {
        renderedHtml,
        selectedIds: [node.id],
        history: newHistory,
        historyIndex: newHistoryIndex,
        artboards: updateActiveArtboard(state.artboards, state.activeArtboardId, {
          renderedHtml,
          history: newHistory,
          historyIndex: newHistoryIndex,
          ...(sz ?? {}),
        }),
      };
    });
    setTimeout(() => get().runAudit(), 50);
  },

  updateNode: (id, changes, options) => {
    const dragId = get().canvasPointerDragNodeId;
    if (dragId !== null && id === dragId && !options?.dragInternal) {
      return;
    }
    const recordHistory = options?.recordHistory !== false;
    const { graph, rootId } = activeDocSlice(get());
    if (!graph || !rootId) return;
    graph.updateNode(id, changes);
    const renderedHtml = renderHtml(graph, rootId);
    const sz = artboardSizePatch(graph, rootId);
    if (recordHistory) {
      const sceneJson = exportSceneJson(graph, rootId);
      set(state => {
        const newHistory = [...state.history.slice(0, state.historyIndex + 1), { label: `Update ${id}`, sceneJson: { root: sceneJson } }];
        const newHistoryIndex = state.historyIndex + 1;
        return {
          renderedHtml,
          history: newHistory,
          historyIndex: newHistoryIndex,
          artboards: updateActiveArtboard(state.artboards, state.activeArtboardId, {
            renderedHtml,
            history: newHistory,
            historyIndex: newHistoryIndex,
            ...(sz ?? {}),
          }),
        };
      });
    } else {
      set(state => ({
        renderedHtml,
        artboards: updateActiveArtboard(state.artboards, state.activeArtboardId, {
          renderedHtml,
          ...(sz ?? {}),
        }),
      }));
    }
  },

  commitHistoryFrame: (label) => {
    const { graph, rootId } = activeDocSlice(get());
    if (!graph || !rootId) return;
    const sceneJson = exportSceneJson(graph, rootId);
    set(state => {
      const newHistory = [
        ...state.history.slice(0, state.historyIndex + 1),
        { label: label ?? 'Edit', sceneJson: { root: sceneJson } },
      ];
      const newHistoryIndex = state.historyIndex + 1;
      return {
        history: newHistory,
        historyIndex: newHistoryIndex,
        artboards: updateActiveArtboard(state.artboards, state.activeArtboardId, {
          history: newHistory,
          historyIndex: newHistoryIndex,
        }),
      };
    });
  },

  deleteNode: (id) => {
    const { graph, rootId } = activeDocSlice(get());
    if (!graph || !rootId || id === rootId) return;
    graph.deleteNode(id);
    const renderedHtml = renderHtml(graph, rootId);
    const sceneJson = exportSceneJson(graph, rootId);
    const sz = artboardSizePatch(graph, rootId);
    set(state => {
      const newHistory = [...state.history.slice(0, state.historyIndex + 1), { label: `Delete ${id}`, sceneJson: { root: sceneJson } }];
      const newHistoryIndex = state.historyIndex + 1;
      return {
        renderedHtml, selectedIds: state.selectedIds.filter(s => s !== id),
        history: newHistory,
        historyIndex: newHistoryIndex,
        artboards: updateActiveArtboard(state.artboards, state.activeArtboardId, {
          renderedHtml,
          history: newHistory,
          historyIndex: newHistoryIndex,
          ...(sz ?? {}),
        }),
      };
    });
  },

  runAudit: () => {
    const { graph, rootId } = activeDocSlice(get());
    const { designSystem } = get();
    if (!graph || !rootId) return;
    try {
      const rootINode = wrapINode(graph, rootId);
      if (!rootINode) return;
      const rules = getDefaultRules(designSystem ?? undefined);
      const issues = audit(rootINode, rules, designSystem ?? undefined);
      set(state => ({
        auditIssues: issues,
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
      setTimeout(() => get().runAudit(), 50);
    } catch (e) {
      console.error('Failed to parse DESIGN.md:', e);
    }
  },

  setDesignSystem: (ds) => set({ designSystem: ds }),

  setTimeline: (timeline) => {
    set(state => ({
      timeline,
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
    const graph = new SceneGraph();
    const host = new StandaloneHost(graph);
    setHost(host);
    const page = graph.addPage('Design');
    const rootId = importSceneNode(graph, page.id, entry.sceneJson.root);
    const renderedHtml = renderHtml(graph, rootId);
    const sz = artboardSizePatch(graph, rootId);
    set(state => ({
      graph, rootId, renderedHtml, historyIndex: newIndex, selectedIds: [],
      artboards: updateActiveArtboard(state.artboards, state.activeArtboardId, {
        graph, rootId, renderedHtml, historyIndex: newIndex,
        ...(sz ?? {}),
      }),
    }));
  },

  redo: () => {
    const { history, historyIndex } = activeDocSlice(get());
    if (historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    const entry = history[newIndex];
    const graph = new SceneGraph();
    const host = new StandaloneHost(graph);
    setHost(host);
    const page = graph.addPage('Design');
    const rootId = importSceneNode(graph, page.id, entry.sceneJson.root);
    const renderedHtml = renderHtml(graph, rootId);
    const sz = artboardSizePatch(graph, rootId);
    set(state => ({
      graph, rootId, renderedHtml, historyIndex: newIndex, selectedIds: [],
      artboards: updateActiveArtboard(state.artboards, state.activeArtboardId, {
        graph, rootId, renderedHtml, historyIndex: newIndex,
        ...(sz ?? {}),
      }),
    }));
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
      renderedHtml: renderHtml(graph, rootId),
      ...(sz
        ? { artboards: updateActiveArtboard(state.artboards, state.activeArtboardId, sz) }
        : {}),
    }));
  },
}));
