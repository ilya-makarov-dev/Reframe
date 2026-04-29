/**
 * flow.dead-end-step (severity: warn).
 *
 * A step has zero outgoing transitions and is NOT the last step in
 * the array. The last step is exempt — terminal pages ("Thanks for
 * signing up!", "Order placed") are intentionally dead-ends. Mid-
 * flow dead-ends mean the user reaches step N with no way forward
 * and no explicit "you're done" cue.
 *
 * Why warn (not error): unlike unreachable-step, a mid-flow
 * dead-end might be a designer-intended "branch terminator" —
 * "you've answered no, this branch ends here". Marking it warn
 * surfaces the smell without blocking; designer can act on it.
 */

import type { FlowAuditRule, FlowAuditIssue } from './types.js';

export const deadEndStepRule: FlowAuditRule = {
  id: 'flow.dead-end-step',
  severity: 'warn',
  description: 'Non-terminal steps should have at least one outgoing transition.',

  check(spec): FlowAuditIssue[] {
    const hasOutgoing = new Set<number>();
    for (const t of spec.transitions) {
      hasOutgoing.add(t.from);
    }
    const lastIndex = spec.steps.length - 1;
    const issues: FlowAuditIssue[] = [];
    for (let i = 0; i < spec.steps.length; i++) {
      if (i === lastIndex) continue;       // terminal step exempt
      if (hasOutgoing.has(i)) continue;
      const step = spec.steps[i];
      issues.push({
        ruleId: 'flow.dead-end-step',
        severity: 'warn',
        stepIndex: i,
        message: `Step ${i} (${step.name}) has no outgoing transition — user reaches a dead end mid-flow.`,
        details: { stepName: step.name, isTerminal: false },
      });
    }
    return issues;
  },
};
