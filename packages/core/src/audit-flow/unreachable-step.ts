/**
 * flow.unreachable-step (severity: error).
 *
 * A step exists in `spec.steps[]` but no transition leads to its
 * index. Step 0 is always reachable (the entry point), so it's
 * implicitly excluded — the rule only fires for indices 1..N-1.
 *
 * Why error and not warn: an unreachable step almost-certainly
 * indicates either a broken transition graph (missing wiring) or
 * dead/forgotten step content. Both are bugs, not stylistic choices.
 * If a designer genuinely wants a "reserved" step that's only
 * reachable conditionally, that's a future-signal feature for the
 * conditional-flow evaluator — Phase 0 ships linear flows where
 * unreachable = broken.
 */

import type { FlowAuditRule, FlowAuditIssue } from './types.js';

export const unreachableStepRule: FlowAuditRule = {
  id: 'flow.unreachable-step',
  severity: 'error',
  description: 'Every step except the entry (step 0) must have at least one incoming transition.',

  check(spec): FlowAuditIssue[] {
    const reachable = new Set<number>([0]);
    for (const t of spec.transitions) {
      reachable.add(t.to);
    }
    const issues: FlowAuditIssue[] = [];
    for (let i = 0; i < spec.steps.length; i++) {
      if (reachable.has(i)) continue;
      const step = spec.steps[i];
      issues.push({
        ruleId: 'flow.unreachable-step',
        severity: 'error',
        stepIndex: i,
        message: `Step ${i} (${step.name}) has no incoming transition — unreachable from the entry point.`,
        details: { stepName: step.name, transitionsInto: 0 },
      });
    }
    return issues;
  },
};
