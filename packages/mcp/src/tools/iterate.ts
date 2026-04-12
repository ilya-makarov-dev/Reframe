/**
 * reframe_iterate — LLM-friendly refinement loop over a scene.
 *
 * Two modes:
 *
 *   mode: "auto"  (default)
 *     Runs the existing audit → auto-fix loop up to `maxRounds` times or
 *     until no more fixable issues remain. Returns a transcript of each
 *     round so the agent sees exactly what the engine changed. This is the
 *     quick path — "inspect, fix, re-inspect, repeat, stop when clean".
 *
 *   mode: "propose"
 *     Runs audit ONCE and returns a structured list of suggested operations
 *     the agent could apply (with rationale). No mutations. Use this when
 *     the agent wants to decide which fixes to accept rather than letting
 *     the engine auto-apply them.
 *
 * This is the final Phase 5 primitive — the "LLM loop" we've been building
 * toward. Combined with Phase 3 (ops as data + replay) and Phase 4 (variant
 * auto-refresh), one iterate call can take a scene from "compiled" to
 * "audit-clean + all variants refreshed" in a single tool invocation.
 */

import { z } from 'zod';
import { getScene } from '../store.js';
import { audit } from '../../../core/src/audit.js';
import { buildInspectAuditRules } from '../../../core/src/inspect-audit-rules.js';
import { runAutoFixLoop } from './_auto-fix.js';
import { StandaloneNode } from '../../../core/src/adapters/standalone/node.js';
import { parseDesignMd } from '../../../core/src/design-system/index.js';
import { getSession } from '../session.js';

// ─── Schema ──────────────────────────────────────────────────

export const iterateInputSchema = {
  sceneId: z.string().describe('Session scene id (e.g. "s1") — the scene to iterate over'),
  mode: z.enum(['auto', 'propose']).default('auto').describe(
    'auto: run audit+auto-fix loop up to maxRounds times (default). ' +
    'propose: run audit once and return suggested ops with rationale, no mutations.',
  ),
  maxRounds: z.number().optional().default(3).describe('Maximum audit+fix rounds in auto mode (default 3)'),
  goal: z.string().optional().describe('Free-text hint carried through into the transcript — helps the agent keep context across iterations'),
  minContrast: z.number().optional().default(3),
  minFontSize: z.number().optional().default(8),
};

// ─── Handler ─────────────────────────────────────────────────

export async function handleIterate(input: {
  sceneId: string;
  mode?: 'auto' | 'propose';
  maxRounds?: number;
  goal?: string;
  minContrast?: number;
  minFontSize?: number;
}) {
  const stored = getScene(input.sceneId);
  if (!stored) return err(`Scene "${input.sceneId}" not found`);

  const mode = input.mode ?? 'auto';
  const maxRounds = input.maxRounds ?? 3;
  const minContrast = input.minContrast ?? 3;
  const minFontSize = input.minFontSize ?? 8;

  // Resolve design system the same way compile does — prefer session brand,
  // then active brand on disk. Without DS, brand-aware rules silently no-op
  // which is fine for iterate's basic-rules-only path.
  const session = getSession();
  const md = input.goal && false  /* no goal-from-md path yet */ ? '' : (session.activeDesignMd ?? '');
  const ds = md ? session.getOrParseDesignMd(md, parseDesignMd) : undefined;

  const rules = buildInspectAuditRules(ds as any, { minFontSize, minContrast });
  const graph = stored.graph;
  const rootId = stored.rootId;

  if (mode === 'propose') {
    // ── Propose mode: one audit pass, surface suggestions as-is ──
    const wrapped = new StandaloneNode(graph, graph.getNode(rootId)!);
    const issues = audit(wrapped, rules, ds as any);
    const proposed = issues.filter(i => !!i.fix);
    const blockers = issues.filter(i => i.severity === 'error' && !i.fix);

    const lines: string[] = [
      `Iterate [propose] on ${input.sceneId} (${issues.length} issues, ${proposed.length} fixable)`,
    ];
    if (input.goal) lines.push(`Goal: ${input.goal}`);
    lines.push('');
    if (proposed.length > 0) {
      lines.push('Suggested operations:');
      for (const issue of proposed) {
        lines.push(`  [${issue.severity}] ${issue.rule}: ${issue.message}`);
        if (issue.fix?.css) lines.push(`    → ${issue.fix.css}`);
      }
    }
    if (blockers.length > 0) {
      lines.push('');
      lines.push('Blockers (no automatic fix):');
      for (const b of blockers) lines.push(`  [error] ${b.rule}: ${b.message}`);
    }
    if (proposed.length === 0 && blockers.length === 0) {
      lines.push('No issues — scene passes audit as-is.');
    }
    return ok(lines.join('\n'));
  }

  // ── Auto mode: re-run audit+fix up to maxRounds times ─────
  const transcript: string[] = [];
  transcript.push(`Iterate [auto] on ${input.sceneId}, max ${maxRounds} round(s)`);
  if (input.goal) transcript.push(`Goal: ${input.goal}`);

  let lastIssueCount = Infinity;
  let roundsRun = 0;
  let finalClean = false;

  for (let round = 1; round <= maxRounds; round++) {
    roundsRun = round;
    const result = runAutoFixLoop(
      graph,
      rootId,
      () => {
        const wrapped = new StandaloneNode(graph, graph.getNode(rootId)!);
        return audit(wrapped, rules, ds as any);
      },
      // Each iterate round is itself 1 auto-fix pass. The *outer* loop is
      // about LLM-style iteration (one tool call per conversation turn);
      // the *inner* runAutoFixLoop is the engine's micro-loop over rules.
      { autoFix: true, maxPasses: 1 },
    );

    const issues = result.finalIssues;
    const errors = issues.filter(i => i.severity === 'error').length;
    const warns = issues.filter(i => i.severity === 'warning').length;
    const fixes = result.allFixed.length;

    transcript.push(`  round ${round}: ${fixes} fix(es), ${errors} error(s), ${warns} warning(s) remain`);

    // Convergence check: if this round applied zero fixes AND the issue
    // count didn't shrink, iterating more is futile.
    if (fixes === 0 && issues.length >= lastIssueCount) {
      transcript.push(`  → converged (no progress at round ${round})`);
      finalClean = issues.length === 0;
      break;
    }
    lastIssueCount = issues.length;
    if (issues.length === 0) {
      transcript.push(`  → clean after round ${round}`);
      finalClean = true;
      break;
    }
  }

  transcript.push('');
  transcript.push(finalClean
    ? `✓ Scene is audit-clean after ${roundsRun} round(s).`
    : `⚠ Scene still has issues after ${roundsRun} round(s) — call reframe_inspect for details.`);
  return ok(transcript.join('\n'));
}

// ─── Helpers ─────────────────────────────────────────────────

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}
function err(text: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${text}` }] };
}
