/**
 * flow.duplicate-step-id (severity: error).
 *
 * Two or more steps resolve to the same name (slug). Since flow
 * scenes are persisted at `.reframe/scenes/<slug>.scene.json`, a
 * collision means later writes overwrite earlier ones — silent data
 * loss across compile cycles.
 *
 * Defense-in-depth — handleFlowCompile catches duplicates at compile
 * via its own duplicate_step_name guard. This rule runs anyway
 * because (a) flow.json on disk can be hand-edited to introduce
 * duplicates, (b) different code paths might construct flow specs
 * (future imports, third-party tools) and reuse the same audit
 * scaffold rather than re-implementing the check.
 */

import type { FlowAuditRule, FlowAuditIssue } from './types.js';

export const duplicateStepIdRule: FlowAuditRule = {
  id: 'flow.duplicate-step-id',
  severity: 'error',
  description: 'Each step must resolve to a unique name (slug). Duplicates cause silent overwrites on disk.',

  check(spec): FlowAuditIssue[] {
    // Track first occurrence by name, emit issue on each subsequent dup.
    const firstSeenAt = new Map<string, number>();
    const issues: FlowAuditIssue[] = [];
    for (let i = 0; i < spec.steps.length; i++) {
      const name = spec.steps[i].name;
      const prev = firstSeenAt.get(name);
      if (prev === undefined) {
        firstSeenAt.set(name, i);
        continue;
      }
      issues.push({
        ruleId: 'flow.duplicate-step-id',
        severity: 'error',
        stepIndex: i,
        message: `Step ${i} reuses the name "${name}" already taken by step ${prev}; persistence will overwrite the earlier scene.`,
        details: { name, firstSeenAt: prev, duplicateAt: i },
      });
    }
    return issues;
  },
};
