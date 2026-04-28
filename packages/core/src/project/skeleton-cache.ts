/**
 * Skeleton thumbnail cache for #6 (Week 4).
 *
 * Sits next to scene.json on disk:
 *   .reframe/scenes/<sceneId>.scene.json    — source of truth
 *   .reframe/scenes/<sceneId>.skeleton.svg  — cached output of #11 exporter
 *
 * Cache, not source of truth: the SVG is recomputable from scene.json +
 * exporter at any time. Safe to delete; the cover endpoint regenerates
 * lazily on miss.
 *
 * Lifecycle:
 *   - reframe_compile (success, single-scene path) → writeSkeleton (eager)
 *   - reframe_edit (any mutation) → invalidateSkeleton (delete)
 *   - GET /cover/<id>.svg → readSkeleton; on miss, lazy regen via exporter
 *
 * Eager-on-compile + lazy-on-miss avoids two separate latency costs:
 *   - first user view of newly-compiled scene reads cache (no cold-start delay)
 *   - edit-then-view doesn't pay regen latency on the edit response
 *     (it pays it on the next cover request, which the user expects to wait
 *     for anyway since they just edited)
 */

import * as fs from 'fs';
import * as path from 'path';

function skeletonPath(projectDir: string, sceneId: string): string {
  return path.join(projectDir, '.reframe', 'scenes', `${sceneId}.skeleton.svg`);
}

/** Write the skeleton SVG to disk. Caller produces the SVG string via the exporter. */
export function writeSkeleton(projectDir: string, sceneId: string, svg: string): void {
  const p = skeletonPath(projectDir, sceneId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, svg, 'utf8');
}

/**
 * Read the cached skeleton + its mtime (for ETag derivation).
 * Returns null on cache miss — caller decides whether to regenerate.
 */
export function readSkeleton(projectDir: string, sceneId: string): { svg: string; mtime: Date } | null {
  const p = skeletonPath(projectDir, sceneId);
  if (!fs.existsSync(p)) return null;
  try {
    const svg = fs.readFileSync(p, 'utf8');
    const mtime = fs.statSync(p).mtime;
    return { svg, mtime };
  } catch {
    return null;
  }
}

/**
 * Delete the cached skeleton. Called by edit ops after successful mutation
 * so the next cover request regenerates from the updated scene. No-op when
 * the file doesn't exist.
 */
export function invalidateSkeleton(projectDir: string, sceneId: string): void {
  const p = skeletonPath(projectDir, sceneId);
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch { /* best-effort */ }
}

/** Test/diagnostic helper — does the cache file exist on disk? */
export function skeletonExists(projectDir: string, sceneId: string): boolean {
  return fs.existsSync(skeletonPath(projectDir, sceneId));
}

/** Test helper — full path for assertions. */
export function getSkeletonPath(projectDir: string, sceneId: string): string {
  return skeletonPath(projectDir, sceneId);
}
