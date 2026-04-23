// Workflow format types — the `.rfx.yml` schema.
//
// A workflow is a DAG of adapter invocations. Each step has an id,
// a target adapter, and an inputs object. Later steps can reference
// outputs of earlier steps via `{{step-id.output.path}}` interpolation.
//
// Cribbed straight from bbx's `.bbx` workflow model. Kept YAML-first
// because it's diff-friendly, human-writable, and every agent can
// produce it.

export interface WorkflowStep {
  /** Step identifier — must be unique within the workflow. */
  id: string;
  /** Adapter id to invoke (e.g. `reframe.compile`). */
  adapter: string;
  /** Human-readable label — surfaced in logs + CLI output. */
  name?: string;
  /** Inputs passed to the adapter. Values support `{{ref}}` interpolation. */
  inputs?: Record<string, unknown>;
  /** Upstream step ids this step depends on. Usually inferred from refs. */
  needs?: string[];
  /** When true, step failure doesn't abort the workflow. */
  continueOnError?: boolean;
  /** When true, run this step in parallel with siblings at the same DAG level. */
  parallel?: boolean;
  /** Per-step timeout in milliseconds. */
  timeoutMs?: number;
  /** Retry count for transient failures. */
  retry?: number;
  /** Skip when the referenced previous-step output is falsy. */
  when?: string;
}

export interface WorkflowDef {
  /** Workflow format version. Current: "1". */
  reframe: string;
  /** Stable id for the workflow (used by caching + registry). */
  id: string;
  /** Title for CLI output. */
  name?: string;
  /** Semver — shown when listing installed workflows. */
  version?: string;
  /** Workflow-level inputs resolvable via `{{inputs.x}}` in step refs. */
  inputs?: Record<string, unknown>;
  /** Final workflow output definitions — map of exposed-name → step-ref. */
  outputs?: Record<string, string>;
  /** Ordered steps. Execution order derived from `needs` + inferred refs. */
  steps: WorkflowStep[];
}

export interface WorkflowRunResult {
  ok: boolean;
  workflow: string;
  /** Per-step result snapshots. */
  steps: Record<string, StepRunResult>;
  /** Resolved final outputs. */
  outputs: Record<string, unknown>;
  /** Error when `ok: false`. */
  error?: string;
  /** Total wall-clock. */
  elapsedMs: number;
}

export interface StepRunResult {
  id: string;
  ok: boolean;
  output?: Record<string, unknown>;
  error?: string;
  elapsedMs?: number;
  adapter: string;
  /** When we skipped due to `when:` evaluating falsy. */
  skipped?: boolean;
}
