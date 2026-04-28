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
  | { kind: 'flow'; flowId: string; steps: SceneGraph[]; transitions: FlowTransition[]; state: FlowState }
  | { kind: 'sampler'; samplerId: string; name?: string; cells: SceneGraph[]; grid: SamplerGrid };

export type CompositionKind = SceneComposition['kind'];

// ── Sampler kind support types ───────────────────────────────
//
// Sampler = N×M grid of pre-compiled scene cells around one canonical
// composition (catalog view, specimen showcase). Use case: 20 versions of
// the same hero with brand × density × radius variations side-by-side.
//
// Cells are SceneGraph references — the sampler is a view, not an owner.
// Cell scenes live under .reframe/scenes/ like any other project scene
// and can be edited independently. The sampler.json on disk only carries
// cellSceneIds (slugs) + grid spec.
//
// Render strategy (see SamplerRenderer): skeleton-upfront +
// upgrade-on-click + LRU demote at MAX_ACTIVE_IFRAMES. Reuses the SVG
// skeleton exporter from #11 — each cell is a tiny <svg> until the user
// clicks to engage. See `packages/editor/src/canvas-dom/sampler-renderer.ts`
// for the canonical capability boundary doc (also referenced by T1 #6
// thumbnail and T2 #5 overlay).

export interface SamplerGrid {
  /** Number of columns. */
  columns: number;
  /** Number of rows. Auto = ceil(cells.length / columns) when omitted. */
  rows?: number;
  /** Pixels between cells. Default 16. */
  gap?: number;
  /** Fixed cell width. Default = (viewport - gaps) / columns. */
  cellWidth?: number;
  /** Fixed cell height. Default = max(cells.bbox.h). */
  cellHeight?: number;
  /** Per-cell captions; length must equal cells.length when set. */
  labels?: string[];
}

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

export function samplerComposition(
  samplerId: string,
  cells: SceneGraph[],
  grid: SamplerGrid,
  name?: string,
): SceneComposition {
  if (cells.length < 2) {
    throw new Error('samplerComposition requires at least 2 cells');
  }
  if (grid.columns < 1) {
    throw new Error('samplerComposition grid.columns must be >= 1');
  }
  if (grid.labels && grid.labels.length !== cells.length) {
    throw new Error('samplerComposition grid.labels length must match cells length');
  }
  return { kind: 'sampler', samplerId, name, cells, grid };
}

export function sceneCount(c: SceneComposition): number {
  switch (c.kind) {
    case 'single': return 1;
    case 'variants': return c.scenes.length;
    case 'flow': return c.steps.length;
    case 'sampler': return c.cells.length;
  }
}

export function scenesOf(c: SceneComposition): SceneGraph[] {
  switch (c.kind) {
    case 'single': return [c.scene];
    case 'variants': return c.scenes;
    case 'flow': return c.steps;
    case 'sampler': return c.cells;
  }
}
