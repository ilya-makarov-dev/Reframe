/**
 * Reframe — Transform Pipes
 *
 * Composable INode → INode transformations with context passing and tracing.
 *
 *   const pipeline = pipe(
 *     classify(),
 *     applyRules(designSystem),
 *     scale({ width: 1080, height: 1080 }),
 *     audit(),
 *   );
 *
 *   const result = await pipeline.run(rootNode);
 *   console.log(result.trace);  // step-by-step diagnostics
 */

import type { INode } from '../host/types';

// ─── Core Types ────────────────────────────────────────────────

/**
 * Shared context passed through the pipeline.
 * Transforms read/write to context to share state.
 */
export interface PipeContext {
  /** Arbitrary key-value store for inter-transform communication. */
  readonly state: Map<string, unknown>;

  /** Design system rules, if loaded. */
  designSystem?: unknown;

  /** Root frame dimensions (set automatically). */
  rootWidth: number;
  rootHeight: number;

  /** Trace entries from completed steps. */
  readonly trace: TraceEntry[];
}

/** One trace entry per transform step. */
export interface TraceEntry {
  name: string;
  durationMs: number;
  error?: string;
}

/** Result of running a pipeline. */
export interface PipeResult {
  /** The root node (same reference, mutated in place). */
  root: INode;
  /** The final context with all accumulated state. */
  ctx: PipeContext;
  /** Shortcut to ctx.trace. */
  trace: readonly TraceEntry[];
  /** Total pipeline duration in ms. */
  totalMs: number;
}

/**
 * A single transform — the unit of composition.
 *
 * Transforms mutate the INode tree in place (INode is mutable by design).
 * They can read/write context.state to pass data downstream.
 * Async is supported for transforms that load fonts, fetch data, etc.
 */
export interface Transform {
  /** Human-readable name for tracing. */
  readonly name: string;
  /** The transform function. */
  run(root: INode, ctx: PipeContext): void | Promise<void>;
}

// ─── Transform Constructor ─────────────────────────────────────

/**
 * Create a named transform from a function.
 *
 * @example
 *   const logTree = transform('log-tree', (root) => {
 *     console.log(root.name, root.children?.length);
 *   });
 */
export function transform(
  name: string,
  fn: (root: INode, ctx: PipeContext) => void | Promise<void>,
): Transform {
  return { name, run: fn };
}

// ─── Pipeline ──────────────────────────────────────────────────

/** A composed pipeline of transforms. */
export interface Pipeline {
  /** The ordered transforms. */
  readonly steps: readonly Transform[];
  /** Run the pipeline on a root node. */
  run(root: INode, initialState?: Map<string, unknown>): Promise<PipeResult>;
}

/**
 * Compose transforms into a pipeline.
 *
 * Transforms run sequentially in order. Each receives the same root node
 * and a shared PipeContext. Use context.state to pass data between steps.
 *
 * @example
 *   const pipeline = pipe(
 *     transform('classify', (root, ctx) => {
 *       const types = classifyNodes(root);
 *       ctx.state.set('semanticTypes', types);
 *     }),
 *     transform('scale', (root, ctx) => {
 *       const types = ctx.state.get('semanticTypes') as Map<string, string>;
 *       scaleWithTypes(root, types);
 *     }),
 *   );
 *
 *   const { root, trace } = await pipeline.run(myNode);
 */
export function pipe(...transforms: Transform[]): Pipeline {
  return {
    steps: transforms,
    async run(root: INode, initialState?: Map<string, unknown>): Promise<PipeResult> {
      const ctx: PipeContext = {
        state: initialState ?? new Map(),
        rootWidth: root.width,
        rootHeight: root.height,
        trace: [],
      };

      const t0 = Date.now();

      for (const step of transforms) {
        const stepStart = Date.now();
        try {
          await step.run(root, ctx);
          ctx.trace.push({
            name: step.name,
            durationMs: Date.now() - stepStart,
          });
        } catch (err) {
          ctx.trace.push({
            name: step.name,
            durationMs: Date.now() - stepStart,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
      }

      return {
        root,
        ctx,
        trace: ctx.trace,
        totalMs: Date.now() - t0,
      };
    },
  };
}

// ─── Composition Helpers ───────────────────────────────────────

/**
 * Merge multiple pipelines into one sequential pipeline.
 *
 *   const full = concat(preparation, scaling, postprocess);
 */
export function concat(...pipelines: Pipeline[]): Pipeline {
  return pipe(...pipelines.flatMap(p => p.steps));
}

/**
 * Conditionally include a transform.
 *
 *   pipe(
 *     classify(),
 *     when(hasDesignSystem, applyRules(ds)),
 *     scale(target),
 *   )
 */
export function when(
  predicate: (root: INode, ctx: PipeContext) => boolean,
  ...transforms: Transform[]
): Transform {
  const names = transforms.map(t => t.name).join('+');
  return {
    name: `when(${names})`,
    async run(root, ctx) {
      if (predicate(root, ctx)) {
        for (const t of transforms) {
          await t.run(root, ctx);
        }
      }
    },
  };
}

/**
 * Run a transform on each child of the root (or matching children).
 *
 *   pipe(
 *     forEach(child => child.type === NodeType.Text, fixTypography),
 *   )
 */
export function forEach(
  filter: (node: INode) => boolean,
  ...transforms: Transform[]
): Transform {
  const names = transforms.map(t => t.name).join('+');
  return {
    name: `forEach(${names})`,
    async run(root, ctx) {
      const targets = collectAll(root, filter);
      for (const node of targets) {
        for (const t of transforms) {
          await t.run(node, ctx);
        }
      }
    },
  };
}

/**
 * Tap into the pipeline for side effects (logging, snapshots) without transforming.
 *
 *   pipe(
 *     classify(),
 *     tap('after-classify', (root, ctx) => console.log(ctx.state.get('types'))),
 *     scale(target),
 *   )
 */
export function tap(
  name: string,
  fn: (root: INode, ctx: PipeContext) => void,
): Transform {
  return { name: `tap:${name}`, run: fn };
}

// ─── Tree Walking Helper ───────────────────────────────────────

/** Collect all descendants matching a predicate (DFS, includes root if matched). */
function collectAll(root: INode, predicate: (n: INode) => boolean): INode[] {
  const result: INode[] = [];
  const walk = (node: INode) => {
    if (predicate(node)) result.push(node);
    if (node.children) {
      for (const child of node.children) walk(child);
    }
  };
  walk(root);
  return result;
}
