/**
 * Editor-state field registry.
 *
 * `SceneNode` currently holds a few fields that are NOT part of the design
 * AST — they're editor/UX bookkeeping that leaked in via the Figma-derived
 * shape. This module is the single source of truth for which fields are
 * editor state so that serializers, exporters, and bridges can drop them
 * uniformly.
 *
 * Long-term plan: extract each of these off `SceneNode` entirely and keep
 * them in `WorkspaceState` (selection, zoom, etc. already live there).
 * Short-term: leave the fields on the type so editor code continues to
 * compile, but DROP them from the persistence + export + bridge paths so
 * they don't pollute disk `.scene.json`, exported HTML/React, or the
 * round-trip through @open-pencil/core.
 *
 * Adding a new editor-only field? Add its key here, tag the field in
 * `types.ts` with an `@editorState` JSDoc block, and every downstream
 * path picks up the skip automatically.
 */

export const EDITOR_STATE_KEYS = new Set<string>([
  // UI lock — "prevent accidental drag" — no effect on layout/render/export.
  'locked',
  // LAYERS panel expand/collapse — tree-view UX state.
  'expanded',
  // Editor rename-on-type-change heuristic — UX toggle.
  'autoRename',
  // Component-master "hide from publish" flag — editor/compiler bookkeeping.
  'internalOnly',
]);

/**
 * Runtime / derived / cache fields. Recomputable on demand from other
 * data. Today they live on `SceneNode` for access convenience but
 * SHOULD live in a per-graph cache (keyed by nodeId), same place as
 * `absPosCache`. Serializer already skips them (see `serialize.ts`
 * — explicit comment about non-JSON-safe Uint8Array commandsBlob).
 *
 * Long-term move to `graph.runtimeCache.get(nodeId).fillGeometry`, etc.
 * Short-term this set documents intent + provides the strip helper for
 * any future boundary that needs to drop them explicitly.
 */
export const RUNTIME_CACHE_KEYS = new Set<string>([
  // Figma's glyph pre-rasterize cache — perf hack, zero semantic meaning.
  'textPicture',
  // Vector geometry cache — recomputable from vectorNetwork or strokes.
  'fillGeometry',
  'strokeGeometry',
]);

/**
 * All fields that are NOT part of the design AST — editor-state +
 * runtime-cache combined. Use for bridge / export / transport paths
 * that want to strip everything non-essential in one shot.
 */
export const NON_DESIGN_KEYS = new Set<string>([
  ...EDITOR_STATE_KEYS,
  ...RUNTIME_CACHE_KEYS,
]);

/**
 * Returns true if the field name is editor/UX state that should NOT
 * survive serialization, export, or cross-graph bridging.
 */
export function isEditorStateField(key: string): boolean {
  return EDITOR_STATE_KEYS.has(key);
}

/** Returns true if the field is a recomputable runtime cache, not AST. */
export function isRuntimeCacheField(key: string): boolean {
  return RUNTIME_CACHE_KEYS.has(key);
}

/** Returns true if the field is NOT pure design AST (either editor or cache). */
export function isNonDesignField(key: string): boolean {
  return NON_DESIGN_KEYS.has(key);
}

/**
 * Return a shallow copy of `obj` with all editor-state keys removed.
 * Use on the boundary between in-memory SceneNode and any form of
 * persistence / transport / export.
 */
export function stripEditorState<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k in obj) {
    if (!EDITOR_STATE_KEYS.has(k)) (out as any)[k] = obj[k];
  }
  return out;
}

/** Shallow copy with editor-state AND runtime-cache fields removed. */
export function stripNonDesign<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k in obj) {
    if (!NON_DESIGN_KEYS.has(k)) (out as any)[k] = obj[k];
  }
  return out;
}
