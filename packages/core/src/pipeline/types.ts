/**
 * Pipeline types — DAG-based task execution for design workflows.
 *
 * A pipeline is a directed acyclic graph of stages. Each stage declares
 * its dependencies and whether it mutates shared state. The executor
 * runs stages in rounds: mutating stages serialize, read-only stages
 * parallelize within each round.
 */

export type StageStatus = 'pending' | 'blocked' | 'running' | 'done' | 'failed' | 'skipped';

export interface PipelineStage<TCtx = any> {
  /** Unique stage ID (e.g. "import:1920x1080", "export:svg") */
  id: string;

  /** Human-readable name for reporting */
  name: string;

  /** Stage IDs this depends on. All must be 'done' before this can run. */
  dependsOn: string[];

  /** Whether this stage mutates shared context (graph, host singleton).
   *  Mutating stages run alone; read-only stages can parallelize. */
  mutates: boolean;

  /** Per-stage timeout in ms (overrides pipeline default). */
  timeout?: number;

  /** Per-stage retry count (overrides pipeline default). */
  retries?: number;

  /** Execute the stage. Receives shared context + results of dependencies. */
  execute(ctx: TCtx, depResults: Map<string, any>): Promise<any>;
}

/** Options for executePipeline(). */
export interface PipelineOptions {
  /** Default timeout per stage in ms (default: 30000). */
  timeout?: number;
  /** Default retry count per stage (default: 0). */
  retries?: number;
}

export interface PipelineResult {
  /** All stage results keyed by stage ID. */
  results: Map<string, any>;

  /** Stages that failed. */
  failures: Map<string, Error>;

  /** Stages skipped due to cascade failure. */
  skipped: string[];

  /** Execution trace for reporting. */
  rounds: RoundTrace[];

  /** Total duration in ms. */
  durationMs: number;
}

export interface RoundTrace {
  round: number;
  stages: string[];
  durationMs: number;
}
