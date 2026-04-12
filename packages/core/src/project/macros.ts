/**
 * Phase 5 — Macros. A macro is a named, parameterized sequence of Operations
 * stored under `.reframe/macros/<name>.macro.json`. Agents build macros
 * ("brutalize", "darkmode", "appleify") as reusable pipelines that apply the
 * same transformation to any scene's base nodes by role instead of by id.
 *
 * Design:
 *   - A macro's ops reference target nodes with either (a) a concrete nodeId
 *     (works only on the scene where the macro was recorded) OR (b) a role
 *     selector like "$role:button" / "$role:heading" which the applier
 *     resolves against the target scene's semanticRole tree at apply time.
 *   - `applyMacro(dir, sceneSlug, macroName)` resolves placeholders, appends
 *     the resulting ops to the scene's history log, then the next compile
 *     will replay them — matching the Phase 3 contract.
 *   - There is deliberately NO execution here: macros write to the log, they
 *     don't touch the live graph. Replay + auto-refresh-variants already
 *     handle propagation correctly, and keeping one code path for "apply an
 *     op to a scene" avoids a second replay engine.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Operation } from '../ops/types.js';
import { loadSceneFromProject } from './io.js';
import { appendOps, nextOpId } from './history.js';

// ─── Types ───────────────────────────────────────────────────

/**
 * A stored macro — on-disk format under `.reframe/macros/<name>.macro.json`.
 * Ops are stored with TEMPLATE placeholders ("$role:button") instead of
 * concrete ids, so the same macro applies to any scene.
 */
export interface MacroFile {
  /** Macro name — the filesystem key. Must be unique within a project. */
  name: string;
  /** Human description. */
  description?: string;
  /** ISO date of creation. */
  created: string;
  /** Op templates. Each op may carry `$role:<role>` or literal ids as nodeId. */
  ops: MacroTemplate[];
}

/**
 * Template version of an Operation — `nodeId` may be a placeholder. Any other
 * field passes through unchanged. We do not lock down the shape further
 * because Operation is a discriminated union and each variant has its own
 * fields; the applier runtime-checks `type` and resolves nodeId accordingly.
 */
export type MacroTemplate =
  & Omit<Operation, 'nodeId' | 'id' | 'timestamp'>
  & { nodeId?: string };

// ─── Paths ───────────────────────────────────────────────────

function macrosDir(projectDir: string): string {
  return path.join(projectDir, '.reframe', 'macros');
}

function macroFilePath(projectDir: string, name: string): string {
  const safe = name.replace(/[\\/\0]/g, '_');
  return path.join(macrosDir(projectDir), `${safe}.macro.json`);
}

// ─── CRUD ────────────────────────────────────────────────────

/**
 * Save a macro to disk. Creates the macros directory lazily so a project
 * that never uses Phase 5 never grows a macros/ folder.
 *
 * The `ops` parameter takes the FULL Operation shape for convenience — we
 * strip the mutable fields (`id`, `timestamp`) and keep only the template
 * body. If the caller wants placeholder roles they must set `nodeId` to
 * `$role:button` etc. directly in the input ops.
 */
export function saveMacro(
  projectDir: string,
  name: string,
  ops: Operation[],
  description?: string,
): MacroFile {
  const templates: MacroTemplate[] = ops.map(op => {
    const { id: _id, timestamp: _ts, ...rest } = op as any;
    return rest as MacroTemplate;
  });
  const file: MacroFile = {
    name,
    description,
    created: new Date().toISOString(),
    ops: templates,
  };
  fs.mkdirSync(macrosDir(projectDir), { recursive: true });
  fs.writeFileSync(macroFilePath(projectDir, name), JSON.stringify(file, null, 2), 'utf-8');
  return file;
}

/** Read a macro by name. Returns null when the file doesn't exist. */
export function loadMacro(projectDir: string, name: string): MacroFile | null {
  const filePath = macroFilePath(projectDir, name);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as MacroFile;
  } catch {
    return null;
  }
}

/** List every macro file in the project. */
export function listMacros(projectDir: string): MacroFile[] {
  const dir = macrosDir(projectDir);
  if (!fs.existsSync(dir)) return [];
  const out: MacroFile[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.macro.json')) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8')) as MacroFile;
      out.push(raw);
    } catch { /* skip corrupt */ }
  }
  return out;
}

/** Delete a macro by name. Returns true on removal, false when absent. */
export function deleteMacro(projectDir: string, name: string): boolean {
  const filePath = macroFilePath(projectDir, name);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

// ─── Apply ───────────────────────────────────────────────────

export interface ApplyMacroResult {
  /** Ops that landed in the history log. */
  appendedOps: Operation[];
  /** Template ops that couldn't be resolved (placeholder didn't match anything). */
  skipped: Array<{ template: MacroTemplate; reason: string }>;
}

/**
 * Apply a macro to a scene. Resolution rules:
 *   - `nodeId: "$role:X"` → expand to the first semanticRole=X node in the
 *     scene. Multiple matches? We expand to ONE op per match — the macro
 *     becomes a fan-out, which is usually what "set every button to foo"
 *     means.
 *   - `nodeId: "$role:X[0]"` → expand to the N-th match only. Useful when
 *     the macro targets "the first hero" and the scene has two.
 *   - Literal `h:<hash>` id → passes through unchanged; only replays on the
 *     original scene but allows verbatim copies without placeholder work.
 *   - Ops without a `nodeId` field (currently only `autoBindTokens`) pass
 *     through unchanged — one op per macro entry.
 *
 * The resolved ops are appended to the scene's history log but NOT applied
 * to the current graph. The next reframe_compile will replay them via the
 * existing replay pipeline, which also auto-refreshes variants. One code
 * path, not two.
 */
export function applyMacro(
  projectDir: string,
  sceneSlug: string,
  macroName: string,
): ApplyMacroResult {
  const macro = loadMacro(projectDir, macroName);
  if (!macro) throw new Error(`Macro "${macroName}" not found`);

  // Load the scene once so we can resolve placeholders against its graph.
  const { graph, rootId } = loadSceneFromProject(projectDir, sceneSlug);

  // Collect semantic role → [nodeId] map for fast lookup.
  const byRole = new Map<string, string[]>();
  const walk = (id: string): void => {
    const n = graph.getNode(id);
    if (!n) return;
    const role = (n as any).semanticRole as string | null | undefined;
    if (role) {
      const bucket = byRole.get(role) ?? [];
      bucket.push(id);
      byRole.set(role, bucket);
    }
    for (const c of n.childIds) walk(c);
  };
  walk(rootId);

  const resolved: Operation[] = [];
  const skipped: ApplyMacroResult['skipped'] = [];

  for (const template of macro.ops) {
    const nodeIdRaw = (template as any).nodeId as string | undefined;

    // Ops without a nodeId field (autoBindTokens): append as-is, one op.
    if (!nodeIdRaw) {
      resolved.push({
        ...(template as any),
        id: nextOpId(),
        timestamp: new Date().toISOString(),
      });
      continue;
    }

    // Literal id — pass through if present in the target scene, skip otherwise.
    if (!nodeIdRaw.startsWith('$role:')) {
      if (graph.getNode(nodeIdRaw)) {
        resolved.push({
          ...(template as any),
          id: nextOpId(),
          timestamp: new Date().toISOString(),
        });
      } else {
        skipped.push({ template, reason: `literal nodeId "${nodeIdRaw}" not in scene` });
      }
      continue;
    }

    // Placeholder — extract role and optional index.
    const match = nodeIdRaw.match(/^\$role:([^[]+)(?:\[(\d+)\])?$/);
    if (!match) {
      skipped.push({ template, reason: `invalid placeholder "${nodeIdRaw}"` });
      continue;
    }
    const role = match[1];
    const index = match[2] ? parseInt(match[2], 10) : undefined;
    const bucket = byRole.get(role);
    if (!bucket || bucket.length === 0) {
      skipped.push({ template, reason: `no nodes with role "${role}"` });
      continue;
    }

    const targets = index !== undefined
      ? (bucket[index] ? [bucket[index]] : [])
      : bucket;
    if (targets.length === 0) {
      skipped.push({ template, reason: `role "${role}" index ${index} out of range` });
      continue;
    }

    for (const targetId of targets) {
      resolved.push({
        ...(template as any),
        id: nextOpId(),
        timestamp: new Date().toISOString(),
        nodeId: targetId,
      });
    }
  }

  if (resolved.length > 0) {
    appendOps(projectDir, sceneSlug, resolved);
  }

  return { appendedOps: resolved, skipped };
}
