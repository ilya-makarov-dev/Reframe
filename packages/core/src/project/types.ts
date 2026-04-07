/**
 * Project system types — persistent .reframe directory format.
 *
 * A project is a directory containing a manifest (project.json),
 * scenes (SceneJSON files), and an optional design system (design.md).
 *
 * Both MCP and Studio read/write the same format.
 */

import type { SceneJSON } from '../serialize.js';

// ─── Manifest ────────────────────────────────────────────────

/** Current manifest schema version */
export const PROJECT_VERSION = 1;

export interface ProjectManifest {
  /** Schema version for migration */
  version: number;
  /** Human-readable project name */
  name: string;
  /** ISO date of creation */
  created: string;
  /** ISO date of last modification */
  updated: string;
  /** Relative path to DESIGN.md (if any) */
  designSystem?: string;
  /** Ordered list of scenes */
  scenes: SceneEntry[];
}

export interface SceneEntry {
  /** Unique scene ID — slug for new entries, UUID for legacy */
  id: string;
  /** Human-friendly slug (filesystem-safe, persistent across sessions) */
  slug: string;
  /** Human-readable name */
  name: string;
  /** Relative path from .reframe/ root: "scenes/<slug>.scene.json" */
  file: string;
  /** Canvas dimensions */
  width: number;
  height: number;
  /** Node count */
  nodes?: number;
  /** Arbitrary tags for filtering (e.g. "mobile", "dark") */
  tags?: string[];
  /** ISO date of creation */
  created: string;
  /** ISO date of last modification */
  updated: string;
}

// ─── Events (real-time sync) ─────────────────────────────────

/** Events emitted by the MCP server for real-time Studio updates */
export type ProjectEvent =
  | { type: 'scene:saved'; sceneId: string; entry: SceneEntry }
  | { type: 'scene:deleted'; sceneId: string; slug?: string }
  | { type: 'project:opened'; manifest: ProjectManifest }
  | { type: 'project:updated'; manifest: ProjectManifest }
  | { type: 'design-system:updated'; path: string };

// ─── Helpers ─────────────────────────────────────────────────

export function createManifest(name: string): ProjectManifest {
  const now = new Date().toISOString();
  return {
    version: PROJECT_VERSION,
    name,
    created: now,
    updated: now,
    scenes: [],
  };
}

export function createSceneEntry(
  slug: string,
  name: string,
  width: number,
  height: number,
  options?: { nodes?: number; tags?: string[] },
): SceneEntry {
  const now = new Date().toISOString();
  return {
    id: slug,
    slug,
    name,
    file: `scenes/${slug}.scene.json`,
    width,
    height,
    nodes: options?.nodes,
    tags: options?.tags,
    created: now,
    updated: now,
  };
}
