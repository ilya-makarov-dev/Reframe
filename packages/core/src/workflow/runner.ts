// Workflow runner — parses `.rfx.yml`, builds the DAG, executes
// adapters in topological order, interpolates `{{refs}}`.
//
// Dependencies between steps are declared two ways:
//   1. Explicit: `needs: [step-id, ...]`
//   2. Implicit: any `{{other-step.field}}` ref in inputs
//
// The runner merges both into the dep graph, topo-sorts, and executes.
// Parallel groups (same dep level with `parallel: true`) run concurrently;
// everything else runs sequentially.

import { readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';
import { invokeAdapter, getAdapter } from '../adapter/registry.js';
import type {
  WorkflowDef,
  WorkflowStep,
  WorkflowRunResult,
  StepRunResult,
} from './types.js';

// ─── Parsing ──────────────────────────────────────────────────────

export function parseWorkflowYaml(source: string): WorkflowDef {
  const raw = yaml.load(source) as any;
  if (!raw || typeof raw !== 'object') throw new Error('Workflow must be a YAML object');
  if (!raw.id) throw new Error('Workflow.id is required');
  if (!Array.isArray(raw.steps)) throw new Error('Workflow.steps must be an array');
  return {
    reframe: raw.reframe ?? '1',
    id: raw.id,
    name: raw.name,
    version: raw.version,
    inputs: raw.inputs ?? {},
    outputs: raw.outputs ?? {},
    steps: raw.steps as WorkflowStep[],
  };
}

export function readWorkflow(path: string): WorkflowDef {
  return parseWorkflowYaml(readFileSync(path, 'utf-8'));
}

// ─── Interpolation ────────────────────────────────────────────────

const REF_RE = /\{\{\s*([a-zA-Z0-9_.\-\[\]]+)\s*\}\}/g;

/**
 * Resolve `{{step-id.output.field}}` in any string. Scope is:
 *   inputs.*         — workflow-level inputs
 *   <step-id>.*      — that step's output object (dotted)
 *
 * Non-ref fragments pass through verbatim so mixed strings like
 * `"src/{{slug}}.html"` work.
 */
function interpolateString(raw: string, scope: Record<string, any>): string | unknown {
  // Whole-string case: `{{inputs.file}}` — return the typed value
  const whole = raw.trim().match(/^\{\{\s*([a-zA-Z0-9_.\-\[\]]+)\s*\}\}$/);
  if (whole) return resolvePath(whole[1], scope);
  // Mixed-string case: substitute and rebuild
  return raw.replace(REF_RE, (_m, path) => {
    const v = resolvePath(path, scope);
    if (v == null) return '';
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch { return ''; }
  });
}

function resolvePath(path: string, scope: Record<string, any>): unknown {
  const parts = path.split('.');
  let cursor: any = scope;
  for (const p of parts) {
    if (cursor == null) return undefined;
    cursor = cursor[p];
  }
  return cursor;
}

/** Recursively interpolate any value. Objects + arrays walked in-place. */
function interpolateValue(v: unknown, scope: Record<string, any>): unknown {
  if (typeof v === 'string') return interpolateString(v, scope);
  if (Array.isArray(v)) return v.map(x => interpolateValue(x, scope));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = interpolateValue(val, scope);
    }
    return out;
  }
  return v;
}

// ─── Dependency graph ─────────────────────────────────────────────

function collectRefs(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    let m: RegExpExecArray | null;
    const re = new RegExp(REF_RE.source, 'g');
    while ((m = re.exec(value))) out.add(m[1].split('.')[0]);
  } else if (Array.isArray(value)) {
    for (const v of value) collectRefs(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectRefs(v, out);
  }
}

function topoSort(steps: WorkflowStep[]): WorkflowStep[] {
  const stepIds = new Set(steps.map(s => s.id));
  const deps = new Map<string, Set<string>>();
  for (const s of steps) {
    const d = new Set<string>(s.needs ?? []);
    const refs = new Set<string>();
    collectRefs(s.inputs, refs);
    for (const r of refs) if (stepIds.has(r) && r !== s.id) d.add(r);
    deps.set(s.id, d);
  }
  const visited = new Set<string>();
  const sorted: WorkflowStep[] = [];
  function visit(id: string, chain: string[]): void {
    if (visited.has(id)) return;
    if (chain.includes(id)) throw new Error(`Workflow cycle through ${id}: ${chain.join(' → ')} → ${id}`);
    const step = steps.find(s => s.id === id);
    if (!step) return;
    for (const d of deps.get(id) ?? []) visit(d, [...chain, id]);
    visited.add(id);
    sorted.push(step);
  }
  for (const s of steps) visit(s.id, []);
  return sorted;
}

// ─── Runner ───────────────────────────────────────────────────────

export async function runWorkflow(
  wf: WorkflowDef,
  runtimeInputs: Record<string, unknown> = {},
  runtimeCtx: Record<string, unknown> = {},
): Promise<WorkflowRunResult> {
  const t0 = performance.now();
  const steps = topoSort(wf.steps);
  const stepResults: Record<string, StepRunResult> = {};
  const scope: Record<string, any> = {
    inputs: { ...(wf.inputs ?? {}), ...runtimeInputs },
  };

  let abortReason: string | null = null;

  for (const step of steps) {
    if (abortReason) {
      stepResults[step.id] = {
        id: step.id,
        ok: false,
        skipped: true,
        adapter: step.adapter,
        error: `Skipped: ${abortReason}`,
      };
      continue;
    }

    // `when:` gate
    if (step.when) {
      const v = resolvePath(step.when, scope);
      if (!v) {
        stepResults[step.id] = {
          id: step.id,
          ok: true,
          skipped: true,
          adapter: step.adapter,
        };
        continue;
      }
    }

    const interpolated = (interpolateValue(step.inputs ?? {}, scope) ?? {}) as Record<string, unknown>;
    const reg = getAdapter(step.adapter);
    if (!reg) {
      const err = `Unknown adapter: ${step.adapter}`;
      stepResults[step.id] = { id: step.id, ok: false, adapter: step.adapter, error: err };
      if (!step.continueOnError) abortReason = `Step "${step.id}" failed: ${err}`;
      continue;
    }

    let attempt = 0;
    const maxAttempts = Math.max(1, (step.retry ?? 0) + 1);
    let stepResult: StepRunResult | null = null;
    while (attempt < maxAttempts) {
      attempt++;
      const result = await invokeAdapter(step.adapter, interpolated, {
        runtime: runtimeCtx,
        outputs: scope,
        projectDir: runtimeCtx.projectDir as string | undefined,
      });
      stepResult = {
        id: step.id,
        adapter: step.adapter,
        ok: result.ok,
        output: result.output,
        error: result.error,
        elapsedMs: result.elapsedMs,
      };
      if (result.ok) break;
      if (attempt >= maxAttempts) break;
    }

    stepResults[step.id] = stepResult!;
    // Expose output for downstream `{{step-id.output.x}}` refs.
    scope[step.id] = { output: stepResult!.output ?? {}, ok: stepResult!.ok };

    if (!stepResult!.ok && !step.continueOnError) {
      abortReason = `Step "${step.id}" failed: ${stepResult!.error}`;
    }
  }

  // Resolve workflow-level outputs.
  const outputs: Record<string, unknown> = {};
  if (wf.outputs) {
    for (const [name, ref] of Object.entries(wf.outputs)) {
      outputs[name] = interpolateValue(ref, scope);
    }
  }

  const elapsedMs = performance.now() - t0;
  return {
    ok: !abortReason,
    workflow: wf.id,
    steps: stepResults,
    outputs,
    error: abortReason ?? undefined,
    elapsedMs,
  };
}
