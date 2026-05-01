/**
 * Variants persistence — `.reframe/variants/<variantsId>/variants.json`.
 *
 * Phase 4 Brief 4b Pin #1 — closes the storage asymmetry where sampler /
 * flow / overlay each had on-disk specs but variants was URL-param-only
 * (`?variants=a,b,c`). Variants now joins the composition-storage family
 * with the same shape as its siblings: a top-level dir under .reframe/,
 * one subdir per id, one spec JSON per subdir.
 *
 * A variants composition is the Cartesian product of N axes — e.g.
 *   axes: [
 *     { name: 'density',  values: ['compact', 'default', 'dense'] },
 *     { name: 'radius',   values: ['sharp', 'soft'] },
 *   ]
 * → 6 variant cells (3×2).
 *
 * Storage path mirrors sampler/flow/overlay: variants are a VIEW over
 * existing scenes, not their owners. The base scene lives in
 * `.reframe/scenes/<slug>.scene.json`; the variants spec carries
 * sceneId + axes + grid hints, and the renderer expands axes to
 * variant cells at render time.
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── Paths ───────────────────────────────────────────────────

function variantsRoot(projectDir: string): string {
  return path.join(projectDir, '.reframe', 'variants');
}

function variantsDir(projectDir: string, variantsId: string): string {
  return path.join(variantsRoot(projectDir), sanitizeId(variantsId));
}

export function variantsSpecPath(projectDir: string, variantsId: string): string {
  return path.join(variantsDir(projectDir, variantsId), 'variants.json');
}

function sanitizeId(id: string): string {
  return id.replace(/[\\/\0]/g, '_');
}

// ─── Spec (variants.json) ────────────────────────────────────

export interface VariantsAxis {
  /** Axis name — surfaces as the column/row label in the rendered grid. */
  name: string;
  /** Discrete values along the axis. Each combination of axis values
   *  produces one variant cell. */
  values: string[];
}

export interface VariantsSpec {
  /** Stable id; matches the directory name. */
  variantsId: string;
  /** Optional human-readable label. */
  name?: string;
  /** Base scene slug. The variants composition is the Cartesian product
   *  of this scene with each axis. */
  sceneId: string;
  /** N axes. Length 1 = linear strip. Length 2 = grid. Length 3+ = grid
   *  collapsed across higher axes (renderer typically restricts to 2). */
  axes: VariantsAxis[];
  /** Optional grid hint — explicit cols/rows. Defaults: cols = first
   *  axis length, rows = second axis length (or 1). */
  grid?: { columns?: number; rows?: number; gap?: number };
  /** Optional brand override. When set, all variant cells render under
   *  this brand slug regardless of the base scene's manifest brand. */
  brand?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VariantsSpecInput {
  variantsId: string;
  name?: string;
  sceneId: string;
  axes: VariantsAxis[];
  grid?: { columns?: number; rows?: number; gap?: number };
  brand?: string;
}

// ─── CRUD ────────────────────────────────────────────────────

export function readVariantsSpec(
  projectDir: string,
  variantsId: string,
): VariantsSpec | null {
  const p = variantsSpecPath(projectDir, variantsId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as VariantsSpec;
  } catch (err) {
    console.warn(`[variants-store] failed to parse ${p}:`, err);
    return null;
  }
}

export function writeVariantsSpec(
  projectDir: string,
  input: VariantsSpecInput,
): VariantsSpec {
  validateInput(input);
  const dir = variantsDir(projectDir, input.variantsId);
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const existing = readVariantsSpec(projectDir, input.variantsId);
  const spec: VariantsSpec = {
    variantsId: input.variantsId,
    name: input.name,
    sceneId: input.sceneId,
    axes: input.axes,
    grid: input.grid,
    brand: input.brand,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  fs.writeFileSync(
    variantsSpecPath(projectDir, input.variantsId),
    JSON.stringify(spec, null, 2),
    'utf-8',
  );
  return spec;
}

export function listVariants(projectDir: string): string[] {
  const root = variantsRoot(projectDir);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((name) => {
    const specFile = path.join(root, name, 'variants.json');
    return fs.existsSync(specFile);
  });
}

export function deleteVariants(projectDir: string, variantsId: string): boolean {
  const dir = variantsDir(projectDir, variantsId);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

// ─── Validation ──────────────────────────────────────────────

function validateInput(input: VariantsSpecInput): void {
  if (!input.variantsId || !/^[a-z][a-z0-9\-]*$/.test(input.variantsId)) {
    throw new Error(
      `invalid variantsId "${input.variantsId}" — must start with a letter, lowercase + dash only`,
    );
  }
  if (!input.sceneId || typeof input.sceneId !== 'string') {
    throw new Error('sceneId required');
  }
  if (!Array.isArray(input.axes) || input.axes.length === 0) {
    throw new Error('at least one axis required');
  }
  for (const axis of input.axes) {
    if (!axis.name || typeof axis.name !== 'string') {
      throw new Error('each axis must have a name');
    }
    if (!Array.isArray(axis.values) || axis.values.length === 0) {
      throw new Error(`axis "${axis.name}" must have at least one value`);
    }
  }
}

// ─── Rendering helpers ───────────────────────────────────────

/**
 * Expand axes to flat cell coordinates. Cell N carries one value from
 * each axis; total cell count = product of axis lengths. Used by the
 * renderer to drive the iframe grid in `?variants=<id>` mode.
 */
export function expandCells(spec: VariantsSpec): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  function recurse(idx: number, current: Record<string, string>): void {
    if (idx >= spec.axes.length) {
      out.push({ ...current });
      return;
    }
    const axis = spec.axes[idx];
    for (const value of axis.values) {
      current[axis.name] = value;
      recurse(idx + 1, current);
    }
  }
  recurse(0, {});
  return out;
}

export function defaultGrid(spec: VariantsSpec): { columns: number; rows: number } {
  if (spec.grid?.columns && spec.grid?.rows) {
    return { columns: spec.grid.columns, rows: spec.grid.rows };
  }
  const axisLens = spec.axes.map((a) => a.values.length);
  const columns = spec.grid?.columns ?? axisLens[0] ?? 1;
  const rows = spec.grid?.rows ?? axisLens[1] ?? 1;
  return { columns, rows };
}
