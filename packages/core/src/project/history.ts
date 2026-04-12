/**
 * Project history — append-only JSONL log of operations per scene.
 *
 * Layout: `.reframe/history/<slug>.ops.jsonl`
 *
 * Each line is a single JSON-encoded Operation. Append-only so a truncated
 * write never corrupts earlier lines, and so a concurrent reader sees a
 * consistent prefix. The log is the source of truth for replay: after a
 * re-compile that overwrites the serialized scene from source HTML, reading
 * and replaying the log rebuilds the accumulated edit state on top.
 *
 * This module deliberately has NO opinion on WHEN to replay — that's the job
 * of compileHtmlIntoProject and saveScene in ./io.ts. Here we only do disk
 * I/O and sequence management.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SceneGraph } from '../engine/scene-graph.js';
import type { DesignSystem } from '../design-system/types.js';
import type { Operation, ReplayResult } from '../ops/types.js';
import { replayOperations } from '../ops/apply.js';

// ─── Paths ───────────────────────────────────────────────────

function reframeDir(projectDir: string): string {
  return path.join(projectDir, '.reframe');
}

function historyDir(projectDir: string): string {
  return path.join(reframeDir(projectDir), 'history');
}

export function historyFilePath(projectDir: string, sceneSlug: string): string {
  return path.join(historyDir(projectDir), `${sanitizeSlug(sceneSlug)}.ops.jsonl`);
}

function sanitizeSlug(slug: string): string {
  // Defense in depth — slugs are already filesystem-safe per toSlug, but we
  // still strip path separators and nul bytes to avoid accidental directory
  // traversal from a caller that bypassed the project slug helpers.
  return slug.replace(/[\\/\0]/g, '_');
}

// ─── Write ───────────────────────────────────────────────────

/**
 * Append a single operation to a scene's history log. Creates the history
 * directory lazily so projects that never use Phase 3 never grow a history/
 * folder — keeps the .reframe layout clean for Phase 1/2-only consumers.
 */
export function appendOp(projectDir: string, sceneSlug: string, op: Operation): void {
  const filePath = historyFilePath(projectDir, sceneSlug);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // Single fs.appendFileSync call is atomic at the POSIX level for short
  // writes, which matters when Studio is tailing the file for live updates.
  fs.appendFileSync(filePath, JSON.stringify(op) + '\n', 'utf-8');
}

/** Append multiple ops in one write — used by batch edits and replays. */
export function appendOps(projectDir: string, sceneSlug: string, ops: Operation[]): void {
  if (ops.length === 0) return;
  const filePath = historyFilePath(projectDir, sceneSlug);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = ops.map(op => JSON.stringify(op)).join('\n') + '\n';
  fs.appendFileSync(filePath, payload, 'utf-8');
}

// ─── Read ────────────────────────────────────────────────────

/**
 * Read all operations for a scene in chronological (append) order. Skips
 * blank lines and lines that fail to parse so a partially-corrupt log never
 * blocks replay entirely — the rest of the edits still apply.
 */
export function readOps(projectDir: string, sceneSlug: string): Operation[] {
  const filePath = historyFilePath(projectDir, sceneSlug);
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const out: Operation[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as Operation);
    } catch {
      // Skip malformed lines. An append that got interrupted mid-flush would
      // produce an unparseable trailing line; losing that one op is far
      // cheaper than losing the whole log.
    }
  }
  return out;
}

/** Remove the history log for a scene — called by deleteScene in io.ts. */
export function clearOps(projectDir: string, sceneSlug: string): void {
  const filePath = historyFilePath(projectDir, sceneSlug);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// ─── Phase 5b Bug #2: squash + compaction ──────────────────

/**
 * Collapse an op list into a minimal equivalent. Rules:
 *
 *   setProps(X, {color:red}) + setProps(X, {color:blue}) + setProps(X, {name:'Cta'})
 *     → setProps(X, {color:blue, name:'Cta'})
 *
 *   bindToken(X, 'fill', 'primary') + bindToken(X, 'fill', 'cta')
 *     → bindToken(X, 'fill', 'cta')              // last write wins per property
 *
 *   addState(X, 'hover', A) + addState(X, 'hover', B)
 *     → addState(X, 'hover', B)
 *
 *   autoBindTokens(R) + autoBindTokens(R)  → single op
 *
 *   addPresetAnimation(X, 'fadeIn') + addPresetAnimation(X, 'slideInUp')
 *     → KEEP both (stacking is meaningful)
 *
 *   clearAnimations(X) drops every earlier addAnimation/addPresetAnimation on X.
 *
 * The invariant: replaying the squashed list must yield the same graph state
 * as replaying the original. This is CORE to Phase 5b — without it a 500-op
 * scene compiles in seconds instead of milliseconds because replay runs
 * redundant mutations.
 */
export function squashOps(ops: Operation[]): Operation[] {
  if (ops.length < 2) return [...ops];

  // Work on a shallow copy — setProps merge rewrites the op in place, and
  // we don't want to mutate the caller's array.
  const out = ops.map(o => ({ ...(o as any) })) as Operation[];
  const keep = new Array<boolean>(out.length).fill(true);

  type SetPropsEntry = { index: number; props: Record<string, unknown> };
  const lastSetProps = new Map<string, SetPropsEntry>();
  const lastAddState = new Map<string, number>();
  const lastBindToken = new Map<string, number>();
  const lastSetResponsive = new Map<string, number>();
  const lastAutoBind = new Map<string, number>();

  for (let i = 0; i < out.length; i++) {
    const op = out[i] as any;
    switch (op.type) {
      case 'setProps': {
        const existing = lastSetProps.get(op.nodeId);
        if (existing) {
          // Merge later into earlier's props object (later wins per key).
          const merged = { ...existing.props, ...op.props };
          keep[existing.index] = false;
          op.props = merged;
          lastSetProps.set(op.nodeId, { index: i, props: merged });
        } else {
          lastSetProps.set(op.nodeId, { index: i, props: { ...op.props } });
        }
        break;
      }
      case 'addState': {
        const key = `${op.nodeId}|${op.state}`;
        const prev = lastAddState.get(key);
        if (prev !== undefined) keep[prev] = false;
        lastAddState.set(key, i);
        break;
      }
      case 'bindToken': {
        const key = `${op.nodeId}|${op.property}`;
        const prev = lastBindToken.get(key);
        if (prev !== undefined) keep[prev] = false;
        lastBindToken.set(key, i);
        break;
      }
      case 'setResponsive': {
        const key = `${op.nodeId}|${op.maxWidth}`;
        const prev = lastSetResponsive.get(key);
        if (prev !== undefined) keep[prev] = false;
        lastSetResponsive.set(key, i);
        break;
      }
      case 'autoBindTokens': {
        const scope = op.rootId ?? '*';
        const prev = lastAutoBind.get(scope);
        if (prev !== undefined) keep[prev] = false;
        lastAutoBind.set(scope, i);
        break;
      }
      case 'clearAnimations': {
        // Drop every earlier animation op on this node — they're about to
        // be wiped. The clearAnimations op itself stays so a cold replay
        // still sees the marker.
        for (let j = 0; j < i; j++) {
          if (!keep[j]) continue;
          const earlier = out[j] as any;
          if (earlier.nodeId !== op.nodeId) continue;
          if (earlier.type === 'addPresetAnimation'
              || earlier.type === 'addAnimation'
              || earlier.type === 'clearAnimations') {
            keep[j] = false;
          }
        }
        break;
      }
      default:
        break;  // addAnimation / addPresetAnimation: additive, keep all
    }
  }

  return out.filter((_, i) => keep[i]);
}

export interface CompactOptions {
  /** Max ops retained after squash. Older squashed ops are dropped first. */
  maxOps?: number;
  /** When false, this is a dry run. Default: true. */
  persist?: boolean;
}

/**
 * Compact a scene's history log: read → squash → (optionally) write back.
 * Returns stats on how much was removed. Safe on empty logs.
 */
export function compactHistory(
  projectDir: string,
  sceneSlug: string,
  options: CompactOptions = {},
): { before: number; after: number; removed: number } {
  const ops = readOps(projectDir, sceneSlug);
  if (ops.length === 0) return { before: 0, after: 0, removed: 0 };
  let squashed = squashOps(ops);
  const maxOps = options.maxOps;
  if (typeof maxOps === 'number' && squashed.length > maxOps) {
    squashed = squashed.slice(squashed.length - maxOps);
  }
  const before = ops.length;
  const after = squashed.length;
  if (options.persist !== false && after < before) {
    const filePath = historyFilePath(projectDir, sceneSlug);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const payload = squashed.length > 0
      ? squashed.map(o => JSON.stringify(o)).join('\n') + '\n'
      : '';
    fs.writeFileSync(filePath, payload, 'utf-8');
  }
  return { before, after, removed: before - after };
}

// ─── Replay ──────────────────────────────────────────────────

/**
 * Replay a scene's history log onto a freshly-compiled graph. Typically called
 * right after `importFromHtml` inside `compileHtmlIntoProject` — the log is
 * the "delta" between the pristine HTML output and the agent's iterative
 * refinements.
 *
 * Missing nodes (because the source HTML was edited to remove a subtree) are
 * reported in the result but do not abort the replay — the remaining ops
 * still apply. This is the degradation contract that makes Phase 3 safe to
 * combine with source HTML edits.
 */
export function replayHistory(
  graph: SceneGraph,
  rootId: string,
  projectDir: string,
  sceneSlug: string,
  designSystem?: DesignSystem,
  options?: {
    autoCompact?: boolean;
    compactThreshold?: number;
    /** Phase 6: inject component API so extract/instantiate ops can do I/O. */
    componentAPI?: any;
    /** Phase 6: inject projectDir for component ops (copied here to avoid
     *  the replay layer discovering it from an unrelated argument). */
    projectDir?: string;
  },
): ReplayResult & { opsRead: number; compacted?: { before: number; after: number } } {
  // Phase 5b Bug #2: auto-compact the log when it grows past a threshold
  // BEFORE we read it for replay. Default on — the degenerate case (agent
  // runs 500 edits on one scene) would otherwise turn every compile into
  // a seconds-long affair because replay does all 500 redundant writes.
  // Callers can disable with { autoCompact: false } for debugging.
  const autoCompact = options?.autoCompact !== false;
  const threshold = options?.compactThreshold ?? 32;
  let compacted: { before: number; after: number } | undefined;
  if (autoCompact) {
    const preRead = readOps(projectDir, sceneSlug);
    if (preRead.length >= threshold) {
      const result = compactHistory(projectDir, sceneSlug);
      if (result.removed > 0) compacted = { before: result.before, after: result.after };
    }
  }
  const ops = readOps(projectDir, sceneSlug);
  if (ops.length === 0) {
    return { applied: 0, failed: 0, results: [], opsRead: 0, compacted };
  }
  const replay = replayOperations(graph, ops, {
    rootId,
    designSystem,
    componentAPI: options?.componentAPI,
    projectDir: options?.projectDir ?? projectDir,
  } as any);
  return { ...replay, opsRead: ops.length, compacted };
}

/**
 * Generate a sequential op id. Not cryptographically unique — intended for
 * within-process append ordering only. A call site that needs stronger
 * guarantees should supply its own id.
 */
let _opCounter = 0;
export function nextOpId(): string {
  return `${Date.now().toString(36)}-${(_opCounter++).toString(36)}`;
}
