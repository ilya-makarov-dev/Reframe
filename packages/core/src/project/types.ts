/**
 * Project system types — persistent .reframe directory format.
 *
 * A project is a directory containing a manifest (project.json),
 * scenes (SceneJSON files), and one or more registered brand DESIGN.mds.
 *
 * Both MCP and Studio read/write the same format.
 *
 * ── Brand orchestration (v2) ────────────────────────────────
 * Each scene can pin itself to a specific brand via {@link SceneEntry.brand}.
 * Brand DESIGN.mds are stored under `.reframe/brands/<slug>/DESIGN.md` and
 * registered in {@link ProjectManifest.brands} with a short content hash so
 * drift can be detected on re-compile. The legacy global `.reframe/design.md`
 * is still written as a convenience copy of the active brand (for tools that
 * only know the v1 layout), but the registry is the source of truth.
 */

import type { SceneJSON } from '../serialize.js';

// ─── Manifest ────────────────────────────────────────────────

/** Current manifest schema version */
export const PROJECT_VERSION = 1;

export interface BrandRegistryEntry {
  /** Brand slug (filesystem-safe key). Also the directory name under .reframe/brands/. */
  slug: string;
  /** Relative path from .reframe/ root: "brands/<slug>/DESIGN.md". */
  path: string;
  /**
   * Short md5 hash (first 12 chars) of the DESIGN.md content at registration
   * time. Scenes pin to a specific hash, so if the DESIGN.md is later edited
   * out-of-band, reframe can warn the agent that the scene was built against
   * a different version.
   */
  hash: string;
  /** Human-readable label (e.g. "Inspired by Ferrari"). */
  label?: string;
  /** ISO date of last registration/update. */
  updated: string;
}

export interface ProjectManifest {
  /** Schema version for migration */
  version: number;
  /** Human-readable project name */
  name: string;
  /** ISO date of creation */
  created: string;
  /** ISO date of last modification */
  updated: string;
  /**
   * @deprecated — v1 layout only. New code should use {@link brands} +
   * {@link activeBrand}. Kept for backwards-compat reads and populated by the
   * registry writer as a convenience mirror of the active brand.
   */
  designSystem?: string;
  /**
   * Registered brands keyed by slug. A project with no registered brands is
   * valid — scenes in such a project run without brand-specific audit rules.
   */
  brands?: Record<string, BrandRegistryEntry>;
  /**
   * Default brand for scenes that don't pin their own. Also used as the
   * "currently selected" brand for UI / MCP session startup.
   */
  activeBrand?: string;
  /**
   * Per-virtual-project active brand overrides. Keyed by virtual project
   * slug (owner scene slug from `groupScenesIntoProjects`). Lets the user
   * switch brand in one project on the dashboard without leaking it into
   * sibling projects that share this `.reframe/` dir. Readers fall back to
   * {@link activeBrand} when the virtual key is absent — no migration.
   */
  activeBrandPerProject?: Record<string, string>;
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
  /** Scene group for organization (e.g. "site", "app", "email", "social") */
  group?: string;
  /** Arbitrary tags for filtering (e.g. "mobile", "dark") */
  tags?: string[];
  /** Source HTML path relative to .reframe/ (e.g. "src/home.html") */
  source?: string;
  /**
   * Monotonically-increasing mutation counter. Bumped on every saveScene call
   * (including re-compile), so Studio/MCP listeners can detect whether a scene
   * has changed since their last read without diffing the full graph. Starts
   * at 1 on first save.
   */
  revision?: number;
  /**
   * Phase 4: when set, this entry is a responsive/sized variant of another
   * scene. The value is the base scene's slug. Variants are auto-generated
   * by running the resize pipeline on a base at a target viewport and saved
   * as separate scene files so they can be exported independently while
   * still being refreshed from the base on every re-compile.
   *
   * A base scene has this field unset; a mobile variant of "hero" has
   * `variantOf: "hero"`.
   */
  variantOf?: string;
  /**
   * Phase 4: target viewport this variant was generated at. Required when
   * `variantOf` is set — without it we'd have no way to re-run adapt() on
   * refresh. Base scenes leave this unset and use their own width/height as
   * the canonical dimensions.
   */
  viewport?: {
    /** Human-readable name used as the filename suffix (e.g. "mobile", "tablet"). */
    name: string;
    /** Target width in px. */
    width: number;
    /** Target height in px. */
    height: number;
  };
  /**
   * Brand slug this scene was designed/compiled against. Resolves via
   * {@link ProjectManifest.brands}. When absent, falls back to
   * {@link ProjectManifest.activeBrand}.
   */
  brand?: string;
  /**
   * DESIGN.md hash at the scene's last compile. If the brand's registered
   * hash differs, reframe can surface a "brand drifted" warning so the agent
   * knows to re-compile / re-audit.
   */
  brandHash?: string;
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
  /** Session graph changed (edit, compile, or Studio push). Studio pulls when the tab matches sceneId. */
  | { type: 'scene:session-changed'; sceneId: string; revision: number }
  | { type: 'project:opened'; manifest: ProjectManifest }
  | { type: 'project:updated'; manifest: ProjectManifest }
  | { type: 'design-system:updated'; path: string }
  /** Snapshot of MCP session list (HTTP sidecar). Not persisted to disk. */
  | { type: 'session:scenes'; scenes: unknown[] }
  /** Agent-operable UI: an INode-rendered panel mounted into a named shell slot. */
  | { type: 'panel:mount'; slot: string; panelName: string; html: string; nodeCount?: number }
  /** Agent-operable UI: panel removed from a named shell slot. */
  | { type: 'panel:unmount'; slot: string; panelName: string }
  /**
   * Fast-path token change for live SSE re-paint without full scene re-compile.
   * Emitted by the gesture dispatcher when brand.setToken is invoked so every
   * connected client can patch the running document's CSS custom properties
   * immediately, while the underlying DESIGN.md write + design-system:updated
   * flow does its full-recompile work in the background.
   */
  | { type: 'token:changed'; brand: string; tokenName: string; value: string }

// ─── Helpers ─────────────────────────────────────────────────

export function createManifest(name: string): ProjectManifest {
  const now = new Date().toISOString();
  return {
    version: PROJECT_VERSION,
    name,
    created: now,
    updated: now,
    brands: {},
    scenes: [],
  };
}

/**
 * Compute a short content hash for a DESIGN.md. Used both at registration
 * time (stored in BrandRegistryEntry.hash) and at scene save time (stored in
 * SceneEntry.brandHash). Deterministic and stable across processes.
 */
export function hashDesignMdContent(md: string): string {
  // Simple FNV-1a 32-bit hash → 8 hex chars. Not cryptographic, but stable
  // and dependency-free (avoids pulling crypto into @reframe/core which
  // must also work in the browser Studio build).
  let h = 0x811c9dc5;
  for (let i = 0; i < md.length; i++) {
    h ^= md.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Resolve the effective brand slug for a scene — scene.brand ?? manifest.activeBrand. */
export function resolveSceneBrand(
  manifest: ProjectManifest,
  entry: SceneEntry,
): string | undefined {
  return entry.brand ?? manifest.activeBrand;
}

/**
 * Check whether a scene's recorded brandHash still matches what's in the
 * registry. Returns null when no drift is detectable (no brand or no hash),
 * or {recorded, current} when the two disagree.
 */
export function detectBrandDrift(
  manifest: ProjectManifest,
  entry: SceneEntry,
): { slug: string; recorded: string; current: string } | null {
  const slug = resolveSceneBrand(manifest, entry);
  if (!slug || !entry.brandHash) return null;
  const registry = manifest.brands?.[slug];
  if (!registry) return null;
  if (registry.hash === entry.brandHash) return null;
  return { slug, recorded: entry.brandHash, current: registry.hash };
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
