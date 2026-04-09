/**
 * Project Store — Zustand store for .reframe project management in Studio.
 *
 * Tracks: project state, MCP connection, dirty artboards.
 * Syncs with MCP HTTP server via bridge for real-time updates.
 */

import { create } from 'zustand';
import type { ProjectManifest, SceneEntry, ProjectEvent } from '@reframe/core/project/types';

// ─── Types ───────────���───────────────────────────────────────

/** A scene in the MCP session (in-memory, not persisted to project). */
export interface SessionScene {
  id: string;
  slug?: string;
  name: string;
  size: string;
  nodes: number;
  age: string;
}

export interface ProjectStore {
  // State
  manifest: ProjectManifest | null;
  mcpUrl: string;
  connected: boolean;
  connecting: boolean;
  error: string | null;
  dirty: Set<string>;  // artboard IDs with unsaved changes
  sessionScenes: SessionScene[];  // live scenes from MCP session
  /** Latest MCP graph revision hint (SSE). Studio pulls or shows conflict when dirty. */
  remoteSessionScene: { sceneId: string; revision: number } | null;

  // Actions
  setManifest: (manifest: ProjectManifest | null) => void;
  setConnected: (connected: boolean) => void;
  setConnecting: (connecting: boolean) => void;
  setError: (error: string | null) => void;
  setMcpUrl: (url: string) => void;
  markDirty: (artboardId: string) => void;
  markClean: (artboardId: string) => void;
  markAllClean: () => void;
  setSessionScenes: (scenes: SessionScene[]) => void;
  clearRemoteSessionScene: () => void;

  // Project events from SSE
  handleEvent: (event: ProjectEvent | { type: string; [key: string]: any }) => void;
}

// ─── Store ──────────��────────────────────────────────────────

export const useProjectStore = create<ProjectStore>((set, get) => ({
  manifest: null,
  mcpUrl: 'http://localhost:4100',
  connected: false,
  connecting: false,
  error: null,
  dirty: new Set(),
  sessionScenes: [],
  remoteSessionScene: null,

  setManifest: (manifest) => set({ manifest }),
  setConnected: (connected) => set({ connected, error: connected ? null : get().error }),
  setConnecting: (connecting) => set({ connecting }),
  setError: (error) => set({ error }),
  setMcpUrl: (url) => set({ mcpUrl: url }),

  markDirty: (artboardId) => set((s) => {
    const next = new Set(s.dirty);
    next.add(artboardId);
    return { dirty: next };
  }),

  markClean: (artboardId) => set((s) => {
    const next = new Set(s.dirty);
    next.delete(artboardId);
    return { dirty: next };
  }),

  markAllClean: () => set({ dirty: new Set() }),

  setSessionScenes: (scenes) => set({ sessionScenes: scenes }),

  clearRemoteSessionScene: () => set({ remoteSessionScene: null }),

  handleEvent: (event) => {
    const state = get();
    switch (event.type) {
      case 'session:scenes':
        // Live scene list from MCP session store
        set({ sessionScenes: (event as any).scenes ?? [] });
        break;
      case 'project:opened':
      case 'project:updated':
        set({ manifest: (event as any).manifest });
        break;
      case 'scene:saved': {
        // Update session scenes — add or update the entry
        const entry = (event as any).entry;
        if (entry) {
          const existing = [...state.sessionScenes];
          const idx = existing.findIndex(s => s.id === (event as any).sceneId);
          const sessionScene: SessionScene = {
            id: (event as any).sceneId,
            slug: entry.slug as string | undefined,
            name: entry.name,
            size: `${entry.width}×${entry.height}`,
            nodes: entry.nodes ?? 0,
            age: '0s',
          };
          if (idx >= 0) {
            existing[idx] = sessionScene;
          } else {
            existing.push(sessionScene);
          }
          set({ sessionScenes: existing });
        }
        // Also update manifest if project is open
        if (state.manifest) {
          const scenes = [...state.manifest.scenes];
          const evSlug = entry.slug as string | undefined;
          const idx = scenes.findIndex(s =>
            (evSlug && s.slug === evSlug) || s.id === (event as any).sceneId || s.id === evSlug,
          );
          const manifestEntry = { ...entry, id: evSlug ?? entry.id };
          if (idx >= 0) {
            scenes[idx] = { ...scenes[idx], ...manifestEntry };
          } else if (entry.file) {
            scenes.push(manifestEntry);
          }
          set({ manifest: { ...state.manifest, scenes, updated: entry.updated } });
        }
        break;
      }
      case 'scene:deleted': {
        const sceneId = (event as ProjectEvent & { type: 'scene:deleted' }).sceneId;
        const slug = (event as ProjectEvent & { type: 'scene:deleted' }).slug;
        const dropSession = (s: SessionScene) =>
          s.id === sceneId ||
          s.slug === sceneId ||
          (!!slug && (s.slug === slug || s.id === slug));
        const dropManifest = (e: SceneEntry) =>
          e.id === sceneId ||
          e.slug === sceneId ||
          (!!slug && (e.slug === slug || e.id === slug));
        set({
          sessionScenes: state.sessionScenes.filter(s => !dropSession(s)),
          ...(state.manifest
            ? {
                manifest: {
                  ...state.manifest,
                  scenes: state.manifest.scenes.filter(e => !dropManifest(e)),
                },
              }
            : {}),
        });
        break;
      }
      case 'design-system:updated':
        break;
      case 'scene:session-changed': {
        const ev = event as ProjectEvent & { type: 'scene:session-changed' };
        set({ remoteSessionScene: { sceneId: ev.sceneId, revision: ev.revision } });
        break;
      }
    }
  },
}));
