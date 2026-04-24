/**
 * SceneComposition — additive wrapper over SceneGraph.
 *
 * Entry points (compile handlers, renderers) accept SceneComposition and
 * dispatch by kind. The existing 248 call-sites across core/mcp/editor that
 * consume SceneGraph are never touched: each kind branch unwraps to the
 * appropriate SceneGraph(s) and delegates to the existing pipeline.
 *
 * Kinds land one at a time when real use-cases appear, each with a full
 * type — no placeholder-throw handlers. Today: 'single', 'variants',
 * 'flow'. Next to land when signals appear: 'sampler', 'overlay',
 * 'component'.
 */
import type { SceneGraph } from './scene-graph';

export type SceneComposition =
  | { kind: 'single'; scene: SceneGraph }
  | { kind: 'variants'; scenes: SceneGraph[]; labels?: string[] }
  | { kind: 'flow'; flowId: string; steps: SceneGraph[]; transitions: FlowTransition[]; state: FlowState };

export type CompositionKind = SceneComposition['kind'];

// ── Flow kind support types ──────────────────────────────────
//
// Phase 0 Flow scope: linear transitions only (from → to by index).
// The `condition` field is reserved for future signal-triggered
// conditional-flow implementation — when the first real use-case arrives
// for "go to step N only if state.data.X matches", we'll pick the right
// evaluator (typed predicate / tagged DSL / safe sandbox) then. For now
// every transition evaluates to true; conditional field is kept on the
// type so data files written today don't need a migration when the
// evaluator ships.

export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

export interface FlowTransition {
  /** Source step index. */
  from: number;
  /** Destination step index. */
  to: number;
  /** UI button label — "Next", "Back", "Skip". Shown on the navigation button that triggers this transition. */
  label?: string;
  /** Reserved for future conditional evaluation (state.data → boolean). Phase 0: ignored, always true. */
  condition?: string;
}

export interface FlowState {
  /** Stable id; matches `.reframe/flows/<flowId>/` directory name. */
  flowId: string;
  /** Currently-active step index in the flow. */
  currentStep: number;
  /**
   * Opaque cross-step data bag. Flow authors read/write this from their
   * scenes (form inputs, user-entered values, conditional flags). The
   * engine does NOT interpret its shape — that's the flow author's
   * contract with themselves. Persisted to `.reframe/flows/<flowId>/state.json`
   * on every step transition.
   */
  data: Record<string, JsonValue>;
  /**
   * Steps the user has visited — used by nav UI to enable/disable back
   * buttons or render a breadcrumb. Append-only within one session;
   * persisted with the rest of state.
   */
  visitedSteps: number[];
  /** ISO 8601 timestamp of last persist. */
  updatedAt: string;
}

export function singleComposition(scene: SceneGraph): SceneComposition {
  return { kind: 'single', scene };
}

export function variantsComposition(
  scenes: SceneGraph[],
  labels?: string[],
): SceneComposition {
  if (scenes.length < 2) {
    throw new Error('variantsComposition requires at least 2 scenes');
  }
  if (labels && labels.length !== scenes.length) {
    throw new Error('variantsComposition labels length must match scenes length');
  }
  return { kind: 'variants', scenes, labels };
}

export function flowComposition(
  flowId: string,
  steps: SceneGraph[],
  transitions: FlowTransition[],
  state: FlowState,
): SceneComposition {
  if (steps.length < 2) {
    throw new Error('flowComposition requires at least 2 steps');
  }
  return { kind: 'flow', flowId, steps, transitions, state };
}

export function sceneCount(c: SceneComposition): number {
  switch (c.kind) {
    case 'single': return 1;
    case 'variants': return c.scenes.length;
    case 'flow': return c.steps.length;
  }
}

export function scenesOf(c: SceneComposition): SceneGraph[] {
  switch (c.kind) {
    case 'single': return [c.scene];
    case 'variants': return c.scenes;
    case 'flow': return c.steps;
  }
}
