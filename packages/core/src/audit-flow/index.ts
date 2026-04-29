/**
 * Flow audit registry + runner (T2 #22).
 *
 * Phase 0 ships 5 rules covering structural graph + label correctness:
 *
 *   flow.unreachable-step             (error)  step with no incoming transition
 *   flow.dead-end-step                (warn)   non-terminal step with no outgoing
 *   flow.invalid-transition-target    (error)  out-of-range from/to index
 *   flow.duplicate-step-id            (error)  slug collision after auto-naming
 *   flow.navigation-label-consistency (warn)   mixed Next/Continue/Submit labels
 *
 * Runs after Flow compilation; result attached to compile response
 * envelope as `flowAudit`. reframe_inspect surfaces it as a separate
 * section. ALWAYS advisory — error-severity issues do not fail compile;
 * the designer / agent acts on findings.
 *
 * ─── Future rule candidates (not implemented Phase 0) ──────
 *
 * Reserved for when the underlying mechanism wires up:
 *
 *   flow.unwritten-state-read        (when state-display lands)
 *   flow.unread-state-write
 *   flow.state-type-drift
 *   flow.step-rhythm                 (word-count / element-count disparity)
 *   flow.transition-condition-cycle  (when conditional evaluator ships)
 *
 * Adding a new rule = drop a file alongside the 5 existing ones,
 * register in FLOW_AUDIT_RULES below. No changes to compile.ts /
 * inspect.ts needed — they iterate the registry.
 */

import type { SceneGraph } from '../engine/scene-graph.js';
import type { FlowAuditRule, FlowAuditSpec, FlowAuditResult, FlowAuditIssue, FlowAuditSeverity } from './types.js';
import { unreachableStepRule } from './unreachable-step.js';
import { deadEndStepRule } from './dead-end-step.js';
import { invalidTransitionTargetRule } from './invalid-transition-target.js';
import { duplicateStepIdRule } from './duplicate-step-id.js';
import { navigationLabelConsistencyRule } from './navigation-label-consistency.js';

export const FLOW_AUDIT_RULES: FlowAuditRule[] = [
  unreachableStepRule,
  deadEndStepRule,
  invalidTransitionTargetRule,
  duplicateStepIdRule,
  navigationLabelConsistencyRule,
];

/** Severity rank for issue ordering — higher = surfaces first. */
const SEVERITY_RANK: Record<FlowAuditSeverity, number> = {
  error: 3,
  warn: 2,
  info: 1,
};

/**
 * Run every flow audit rule and return a deterministic, sorted result.
 *
 * Sort order (stable across runs):
 *   1. severity rank desc (error first, then warn, then info)
 *   2. ruleId asc (alphabetic — also stabilizes when severity ties)
 *   3. stepIndex asc (undefined → -1, surfaces at top within group)
 */
export function runFlowAudit(spec: FlowAuditSpec, stepScenes: SceneGraph[]): FlowAuditResult {
  const issues: FlowAuditIssue[] = [];
  for (const rule of FLOW_AUDIT_RULES) {
    try {
      issues.push(...rule.check(spec, stepScenes));
    } catch (err) {
      // A rule throwing is itself a bug worth surfacing — don't let it
      // tank the whole audit. Log + continue. Tests use real rules so
      // this path is defensive against future-rule regressions.
      console.warn(`[flow-audit] rule "${rule.id}" threw during check:`, err);
    }
  }

  issues.sort((a, b) => {
    const sa = SEVERITY_RANK[a.severity] ?? 0;
    const sb = SEVERITY_RANK[b.severity] ?? 0;
    if (sa !== sb) return sb - sa;
    if (a.ruleId !== b.ruleId) return a.ruleId.localeCompare(b.ruleId);
    const ai = a.stepIndex ?? -1;
    const bi = b.stepIndex ?? -1;
    return ai - bi;
  });

  const summary = { errors: 0, warnings: 0, info: 0 };
  for (const i of issues) {
    if (i.severity === 'error') summary.errors++;
    else if (i.severity === 'warn') summary.warnings++;
    else if (i.severity === 'info') summary.info++;
  }

  return { issues, summary };
}

export type { FlowAuditRule, FlowAuditIssue, FlowAuditResult, FlowAuditSpec, FlowAuditSeverity } from './types.js';
