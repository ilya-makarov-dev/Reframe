/**
 * Overlay persistence — `.reframe/overlays/<overlayId>/overlay.json`.
 *
 * Each overlay is a first-class entity on disk, parallel to Flow and
 * Sampler. The overlay.json carries a baseSceneId (slug referencing a
 * standard project scene) + layers array + name. The base scene itself
 * lives under `.reframe/scenes/<slug>.scene.json` like any other scene
 * — overlay is a view-with-decoration, not an owner. The base scene
 * can be edited independently (and most overlay edits will be base-
 * scene edits + layer-config tweaks, never structural rewrites).
 *
 * Why a separate top-level dir (not under `.reframe/scenes/`): overlay
 * is a composition kind, sibling to flow/sampler. Folding it into
 * scenes would blur "renderable scene" vs "decorated view".
 *
 * Why baseSceneId not embedded SceneGraph: same reason Flow stores
 * stepSceneIds — scenes are independent first-class entities, the
 * overlay is a thin reference layer. Cross-overlay sharing (one base
 * scene, two overlay configs) lands free. GC walks slugs to find
 * orphan scenes.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SceneGraph } from '../engine/scene-graph.js';
import type { OverlayLayer } from '../engine/composition.js';
import { deserializeScene } from '../serialize.js';

// ─── Paths ───────────────────────────────────────────────────

function overlaysRoot(projectDir: string): string {
  return path.join(projectDir, '.reframe', 'overlays');
}

function overlayDir(projectDir: string, overlayId: string): string {
  return path.join(overlaysRoot(projectDir), sanitizeId(overlayId));
}

export function overlaySpecPath(projectDir: string, overlayId: string): string {
  return path.join(overlayDir(projectDir, overlayId), 'overlay.json');
}

function sanitizeId(id: string): string {
  return id.replace(/[\\/\0]/g, '_');
}

// ─── Spec (overlay.json) ─────────────────────────────────────

export interface OverlaySpec {
  /** Stable id; matches the directory name. */
  overlayId: string;
  /** Required human-readable label (overlay UI surfaces this prominently). */
  name: string;
  /**
   * Base scene slug. References a scene living under
   * `.reframe/scenes/<slug>.scene.json` — same pattern as Flow.stepSceneIds
   * and Sampler.cellSceneIds. The overlay does not own the scene.
   */
  baseSceneId: string;
  /**
   * Layers stacked over the base scene. Order in array = z-stack from
   * bottom to top when zIndex is omitted; explicit zIndex wins.
   */
  layers: OverlayLayer[];
  createdAt: string;
  updatedAt: string;
}

export function readOverlaySpec(projectDir: string, overlayId: string): OverlaySpec | null {
  const p = overlaySpecPath(projectDir, overlayId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as OverlaySpec;
  } catch (err) {
    console.warn(`[overlay-store] failed to parse ${p}:`, err);
    return null;
  }
}

export function writeOverlaySpec(projectDir: string, spec: OverlaySpec): void {
  const dir = overlayDir(projectDir, spec.overlayId);
  fs.mkdirSync(dir, { recursive: true });
  const nextSpec: OverlaySpec = { ...spec, updatedAt: new Date().toISOString() };
  fs.writeFileSync(overlaySpecPath(projectDir, spec.overlayId), JSON.stringify(nextSpec, null, 2), 'utf-8');
}

export function listOverlays(projectDir: string): string[] {
  const root = overlaysRoot(projectDir);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((name) => {
    const specFile = path.join(root, name, 'overlay.json');
    return fs.existsSync(specFile);
  });
}

export function deleteOverlay(projectDir: string, overlayId: string): boolean {
  const dir = overlayDir(projectDir, overlayId);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

// ─── Base scene loading ──────────────────────────────────────

/**
 * Resolve overlay.baseSceneId to a deserialized SceneGraph by reading
 * its `.reframe/scenes/<slug>.scene.json` envelope. Returns null when
 * the scene file is missing — caller decides how to surface (placeholder
 * with layers still active over empty base, error overlay, etc.).
 */
export function loadBaseScene(
  projectDir: string,
  spec: OverlaySpec,
): { graph: SceneGraph; rootId: string } | null {
  const scenePath = path.join(projectDir, '.reframe', 'scenes', `${spec.baseSceneId}.scene.json`);
  if (!fs.existsSync(scenePath)) return null;
  try {
    const envelope = JSON.parse(fs.readFileSync(scenePath, 'utf-8'));
    const { graph } = deserializeScene(envelope);
    const rootId = envelope.root?.id ?? envelope.rootId;
    if (!rootId) return null;
    return { graph, rootId };
  } catch (err) {
    console.warn(`[overlay-store] failed to load base scene ${spec.baseSceneId} for overlay ${spec.overlayId}:`, err);
    return null;
  }
}
