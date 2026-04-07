/**
 * Pipeline executor — rounds-based DAG runner.
 *
 * Executes stages in waves:
 *   1. Find all stages whose dependencies are satisfied
 *   2. Separate into mutating (serial) and read-only (parallel)
 *   3. Run mutating stages first (they change shared state)
 *   4. Run all read-only stages in parallel
 *   5. On failure, cascade-skip all dependents
 *   6. Repeat until no more stages are ready
 *
 * Adapted from open-multi-agent's TaskQueue execution loop and
 * Claude Code's toolOrchestration read/write batching.
 */

import type { PipelineStage, PipelineResult, RoundTrace, StageStatus, PipelineOptions } from './types.js';

interface StageState {
  stage: PipelineStage;
  status: StageStatus;
  result?: any;
  error?: Error;
  retriesLeft: number;
}

/** Run a function with a timeout. Rejects with a descriptive error on timeout. */
async function runWithTimeout<T>(fn: () => Promise<T>, ms: number, stageId: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Stage "${stageId}" timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer!));
}

export async function executePipeline<TCtx>(
  stages: PipelineStage<TCtx>[],
  ctx: TCtx,
  options?: PipelineOptions,
): Promise<PipelineResult> {
  const t0 = Date.now();

  const defaultTimeout = options?.timeout ?? 30_000;
  const defaultRetries = options?.retries ?? 0;

  // Initialize state map
  const state = new Map<string, StageState>();
  for (const stage of stages) {
    const blocked = stage.dependsOn.length > 0;
    state.set(stage.id, {
      stage,
      status: blocked ? 'blocked' : 'pending',
      retriesLeft: stage.retries ?? defaultRetries,
    });
  }

  const rounds: RoundTrace[] = [];
  const results = new Map<string, any>();
  const failures = new Map<string, Error>();
  const skipped: string[] = [];

  let roundNum = 0;

  while (true) {
    // Unblock stages whose deps are all done
    for (const [, s] of state) {
      if (s.status === 'blocked') {
        const allDone = s.stage.dependsOn.every(dep => state.get(dep)?.status === 'done');
        if (allDone) s.status = 'pending';
      }
    }

    // Collect ready stages
    const ready = [...state.values()].filter(s => s.status === 'pending');
    if (ready.length === 0) break;

    const roundStart = Date.now();
    const roundStages: string[] = [];

    // Split: mutating stages must run alone, read-only can parallel
    const writers = ready.filter(s => s.stage.mutates);
    const readers = ready.filter(s => !s.stage.mutates);

    // Helper: run a stage with timeout + retry
    async function runStage(s: StageState): Promise<void> {
      s.status = 'running';
      roundStages.push(s.stage.id);
      const stageTimeout = s.stage.timeout ?? defaultTimeout;

      while (true) {
        try {
          const depResults = collectDepResults(s.stage, results);
          s.result = await runWithTimeout(
            () => s.stage.execute(ctx, depResults),
            stageTimeout,
            s.stage.id,
          );
          s.status = 'done';
          results.set(s.stage.id, s.result);
          return;
        } catch (err: any) {
          if (s.retriesLeft > 0) {
            s.retriesLeft--;
            continue; // retry
          }
          s.status = 'failed';
          s.error = err;
          failures.set(s.stage.id, err);
          cascadeFail(s.stage.id, state, skipped);
          return;
        }
      }
    }

    // Run writers first (sequential — they mutate shared state)
    for (const s of writers) {
      await runStage(s);
    }

    // Run readers in parallel (they don't mutate — safe to batch)
    if (readers.length > 0) {
      await Promise.all(readers.map(runStage));
    }

    rounds.push({
      round: roundNum++,
      stages: roundStages,
      durationMs: Date.now() - roundStart,
    });
  }

  return {
    results,
    failures,
    skipped,
    rounds,
    durationMs: Date.now() - t0,
  };
}

/** Collect results of a stage's dependencies into a Map. */
function collectDepResults(stage: PipelineStage, results: Map<string, any>): Map<string, any> {
  const deps = new Map<string, any>();
  for (const depId of stage.dependsOn) {
    if (results.has(depId)) deps.set(depId, results.get(depId));
  }
  return deps;
}

/** Cascade failure: skip all stages that depend (transitively) on a failed stage. */
function cascadeFail(failedId: string, state: Map<string, StageState>, skipped: string[]): void {
  for (const [, s] of state) {
    if (s.status !== 'blocked' && s.status !== 'pending') continue;
    if (!s.stage.dependsOn.includes(failedId)) continue;
    s.status = 'skipped';
    skipped.push(s.stage.id);
    // Recurse for transitive dependents
    cascadeFail(s.stage.id, state, skipped);
  }
}

/** Format pipeline result as human-readable report. */
export function formatPipelineResult(result: PipelineResult): string {
  const lines: string[] = [];

  for (const round of result.rounds) {
    const label = round.stages.length === 1
      ? round.stages[0]
      : `${round.stages.length} parallel: ${round.stages.join(', ')}`;
    lines.push(`  Round ${round.round}: ${label} (${round.durationMs}ms)`);
  }

  if (result.failures.size > 0) {
    lines.push('');
    for (const [id, err] of result.failures) {
      lines.push(`  FAILED ${id}: ${err.message}`);
    }
  }
  if (result.skipped.length > 0) {
    lines.push(`  Skipped (cascade): ${result.skipped.join(', ')}`);
  }

  lines.push(`  Total: ${result.durationMs}ms, ${result.rounds.length} rounds`);
  return lines.join('\n');
}
