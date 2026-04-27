/**
 * Sampler persistence — `.reframe/samplers/<samplerId>/sampler.json`.
 *
 * Each sampler is a first-class entity on disk, parallel to Flow. The
 * sampler.json carries cellSceneIds (slugs referencing standard project
 * scenes) + grid spec + sharedBrand + name. Cell scenes themselves live
 * under `.reframe/scenes/<slug>.scene.json` like any other scene — the
 * sampler is a view, not an owner. A scene can be edited independently
 * of any sampler that references it.
 *
 * Why a separate top-level dir (not under `.reframe/scenes/`): a sampler
 * is a composition, same level as a flow. Folding it into scenes would
 * blur the distinction between "this is a renderable scene" and "this is
 * a view over scenes". Both Flow and Sampler get sibling subdirs.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SceneGraph } from '../engine/scene-graph.js';
import type { SamplerGrid } from '../engine/composition.js';
import { deserializeScene } from '../serialize.js';

// ─── Paths ───────────────────────────────────────────────────

function samplersRoot(projectDir: string): string {
  return path.join(projectDir, '.reframe', 'samplers');
}

function samplerDir(projectDir: string, samplerId: string): string {
  return path.join(samplersRoot(projectDir), sanitizeId(samplerId));
}

export function samplerSpecPath(projectDir: string, samplerId: string): string {
  return path.join(samplerDir(projectDir, samplerId), 'sampler.json');
}

function sanitizeId(id: string): string {
  return id.replace(/[\\/\0]/g, '_');
}

// ─── Spec (sampler.json) ─────────────────────────────────────

export interface SamplerSpec {
  /** Stable id; matches the directory name. */
  samplerId: string;
  /** Optional human-readable label. */
  name?: string;
  /** Brand slug shared by every cell (Phase 0 invariant). */
  sharedBrand?: string;
  /**
   * Cell scene slugs in order. These reference scenes living under
   * `.reframe/scenes/<slug>.scene.json`. Same model as Flow.stepSceneIds:
   * sampler is a view, scenes are independent first-class entities.
   *
   * Slugs are NAMESPACED by samplerId (e.g. `mySampler-cell-0`). This
   * prevents cross-sampler collisions: two samplers that both auto-name
   * cells "cell-0" would otherwise share storage. Also lets storage tools
   * spot orphan cell scenes (no sampler.json references them) by prefix.
   */
  cellSceneIds: string[];
  /** Grid layout spec — columns / rows / gap / cell sizing / labels. */
  grid: SamplerGrid;
  createdAt: string;
  updatedAt: string;
}

export function readSamplerSpec(projectDir: string, samplerId: string): SamplerSpec | null {
  const p = samplerSpecPath(projectDir, samplerId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as SamplerSpec;
  } catch (err) {
    console.warn(`[sampler-store] failed to parse ${p}:`, err);
    return null;
  }
}

export function writeSamplerSpec(projectDir: string, spec: SamplerSpec): void {
  const dir = samplerDir(projectDir, spec.samplerId);
  fs.mkdirSync(dir, { recursive: true });
  const nextSpec: SamplerSpec = { ...spec, updatedAt: new Date().toISOString() };
  fs.writeFileSync(samplerSpecPath(projectDir, spec.samplerId), JSON.stringify(nextSpec, null, 2), 'utf-8');
}

export function listSamplers(projectDir: string): string[] {
  const root = samplersRoot(projectDir);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((name) => {
    const specFile = path.join(root, name, 'sampler.json');
    return fs.existsSync(specFile);
  });
}

export function deleteSampler(projectDir: string, samplerId: string): boolean {
  const dir = samplerDir(projectDir, samplerId);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

// ─── Cell scene loading ──────────────────────────────────────

/**
 * Resolve a sampler's cellSceneIds to deserialized SceneGraphs by
 * reading their `.reframe/scenes/<slug>.scene.json` envelopes.
 *
 * Returns one entry per cell with the deserialized graph + rootId. Cells
 * whose scene file is missing are returned as `null` in the array — the
 * caller decides how to surface a partial sampler (skeleton placeholder,
 * error overlay, etc.). Throwing on first missing would punish the user
 * for a single rotted cell; partial degrade is friendlier.
 */
export function loadCellScenes(
  projectDir: string,
  spec: SamplerSpec,
): Array<{ slug: string; graph: SceneGraph; rootId: string } | null> {
  const out: Array<{ slug: string; graph: SceneGraph; rootId: string } | null> = [];
  for (const slug of spec.cellSceneIds) {
    const scenePath = path.join(projectDir, '.reframe', 'scenes', `${slug}.scene.json`);
    if (!fs.existsSync(scenePath)) {
      out.push(null);
      continue;
    }
    try {
      const envelope = JSON.parse(fs.readFileSync(scenePath, 'utf-8'));
      const { graph } = deserializeScene(envelope);
      const rootId = envelope.root?.id ?? envelope.rootId;
      if (!rootId) { out.push(null); continue; }
      out.push({ slug, graph, rootId });
    } catch (err) {
      console.warn(`[sampler-store] failed to load cell ${slug} for sampler ${spec.samplerId}:`, err);
      out.push(null);
    }
  }
  return out;
}
