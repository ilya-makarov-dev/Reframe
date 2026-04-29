/**
 * flow.invalid-transition-target (severity: error).
 *
 * Detects transitions whose `from` or `to` fall outside the legal
 * step-index range [0, steps.length - 1]. Either side out-of-range
 * indicates a broken graph — likely a stale transition referencing
 * a step that was renamed/removed without updating the array, or
 * a typo'd index.
 *
 * Defense-in-depth — handleFlowCompile already validates indices at
 * compile time and throws on out-of-range. This rule still runs
 * because (a) flow.json files can be hand-edited on disk between
 * compiles, (b) future external tooling might write transitions
 * directly, (c) it costs nothing to verify.
 */

import type { FlowAuditRule, FlowAuditIssue } from './types.js';

export const invalidTransitionTargetRule: FlowAuditRule = {
  id: 'flow.invalid-transition-target',
  severity: 'error',
  description: 'Transition `from` and `to` must be valid step indices in [0, steps.length - 1].',

  check(spec): FlowAuditIssue[] {
    const issues: FlowAuditIssue[] = [];
    const max = spec.steps.length - 1;
    for (let i = 0; i < spec.transitions.length; i++) {
      const t = spec.transitions[i];
      const fromBad = t.from < 0 || t.from > max;
      const toBad = t.to < 0 || t.to > max;
      if (!fromBad && !toBad) continue;
      const which = fromBad && toBad ? '`from` and `to`' : fromBad ? '`from`' : '`to`';
      issues.push({
        ruleId: 'flow.invalid-transition-target',
        severity: 'error',
        // Emit on the from-step when only `to` is bad (user can locate the
        // transition by the step it leaves); on -1 sentinel when from is bad.
        stepIndex: fromBad ? undefined : t.from,
        message: `Transition #${i} (${t.from}→${t.to}) has out-of-range ${which}; valid range is [0, ${max}].`,
        details: {
          transitionIndex: i,
          from: t.from,
          to: t.to,
          maxStepIndex: max,
        },
      });
    }
    return issues;
  },
};
