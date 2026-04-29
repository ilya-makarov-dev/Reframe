/**
 * Flow-specific audit rule contract (T2 #22).
 *
 * Single-scene audit (audit.ts, 37 rules) catches per-element correctness
 * — overflow, contrast, font legality, etc. Flow compositions add
 * cross-step concerns: broken navigation graphs, unreachable steps,
 * inconsistent button labels. Those don't fit the per-node rule shape
 * because they read the FlowSpec + the set of step scenes together.
 *
 * ─── Why a parallel directory, not nested in audit.ts ──────
 *
 * audit.ts rules are `(node, graph) → issue[]`. Flow rules are
 * `(spec, scenes[]) → issue[]`. Different input shape = separate
 * registry. Trying to unify would either bloat the single-scene rule
 * input (carry FlowSpec when irrelevant) or fork rule.check at the
 * branch level. Two parallel registries with their own runners is
 * the cleaner factoring — same approach future overlay-rules /
 * sampler-rules subsystems would take when those primitives
 * accumulate cross-element concerns.
 *
 * ─── Advisory, not blocking ────────────────────────────────
 *
 * Every issue (including severity 'error') is reported, NOT thrown.
 * Compile success criterion is unchanged — structural compile errors
 * (missing brand, schema violation) still throw, but graph integrity
 * issues (unreachable step, dead-end) surface in the response envelope's
 * `flowAudit` field. Designer / agent decides whether to fix.
 *
 * Severity convention:
 *   error  — almost-certainly-a-bug (broken graph, dup id, OOB transition)
 *   warn   — likely smell (dead-end mid-flow, label inconsistency)
 *   info   — diagnostic / observability (reserved for future rules)
 *
 * ─── Determinism ───────────────────────────────────────────
 *
 * Same FlowSpec + step SceneGraphs → same issue array. Issues sorted
 * by (severity rank, ruleId, stepIndex ascending) so rendering / diff
 * tools see stable ordering.
 */

import type { JsonValue, FlowTransition } from '../engine/composition.js';
import type { SceneGraph } from '../engine/scene-graph.js';

/**
 * Slim view of the spec the audit needs — keeps the rules independent
 * of the on-disk FlowSpec shape (which carries timestamps, file paths,
 * etc. that don't influence audit). The compile handler maps from its
 * in-memory FlowSpec to this shape before invoking runFlowAudit.
 */
export interface FlowAuditSpec {
  flowId: string;
  /** One entry per step, in order. `name` is the resolved slug. */
  steps: Array<{ name: string; index: number }>;
  /** Transition graph as compiled. */
  transitions: FlowTransition[];
}

export type FlowAuditSeverity = 'error' | 'warn' | 'info';

export interface FlowAuditIssue {
  ruleId: string;
  severity: FlowAuditSeverity;
  /** Human-readable explanation of the specific instance. */
  message: string;
  /** Step index the issue is anchored to (when applicable). */
  stepIndex?: number;
  /** Structured context for tooling — keys are rule-specific. */
  details?: Record<string, JsonValue>;
}

export interface FlowAuditRule {
  /** Stable id, format `flow.<kebab-name>`. */
  id: string;
  /** Default severity for issues this rule emits. */
  severity: FlowAuditSeverity;
  /** Short rule-level description. Issue.message holds the per-instance text. */
  description: string;
  /**
   * Pure detection function. Receives the audit spec + compiled step
   * scene graphs (one per spec.steps[i]). Rules that only care about
   * the spec ignore stepScenes; rules that walk scene content (e.g.
   * navigation-label-consistency) read it.
   *
   * Must be deterministic — same input → same output.
   */
  check(spec: FlowAuditSpec, stepScenes: SceneGraph[]): FlowAuditIssue[];
}

/** Result envelope produced by runFlowAudit(). */
export interface FlowAuditResult {
  issues: FlowAuditIssue[];
  summary: { errors: number; warnings: number; info: number };
}
