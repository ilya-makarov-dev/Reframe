/**
 * flow.navigation-label-consistency (severity: warn).
 *
 * Walks step scene graphs collecting button text content for buttons
 * whose label LOOKS like a forward-navigation cue ("Next", "Continue",
 * "Submit", "Forward", "Proceed", "→"). If the resulting label set
 * has more than one variant across steps, surfaces a warning naming
 * the most-common label as the suggested standard.
 *
 * ─── Phase 0 detection scope ───────────────────────────────
 *
 * Pure regex-on-button-text: any node carrying button-like semantics
 * (semanticRole === 'button' OR meta.sourceTag === 'button') whose
 * `text` matches NAV_LABEL_RE. Ignores "Cancel", "Back", form-submit
 * verbs unrelated to forward motion ("Sign up", "Pay", "Subscribe")
 * because those don't match the regex shapes.
 *
 * False-positive risk acknowledged: a button labelled "Next steps"
 * (informational, not a button trigger) would match — but those are
 * rare in practice. If real flows surface noise, switch to opt-in
 * detection via designer-marked attribute (data-flow-nav="next") —
 * documented in #22 brief escape hatch.
 *
 * ─── Why the most-common-as-standard heuristic ─────────────
 *
 * Picking the most-common label minimizes the number of changes the
 * designer has to make to silence the warning. Tied? Sort
 * alphabetically and pick the first — deterministic, predictable.
 */

import type { FlowAuditRule, FlowAuditIssue } from './types.js';
import type { SceneGraph } from '../engine/scene-graph.js';

const NAV_LABEL_RE = /^(next|continue|submit|forward|proceed|→|next\s*step)\b/i;

/**
 * Walk a scene graph collecting forward-nav button labels.
 * Returns labels in DOM (childIds) order, lower-cased + trimmed for
 * comparison stability.
 */
function collectNavLabels(graph: SceneGraph, rootId: string): string[] {
  const labels: string[] = [];
  function walk(id: string): void {
    const n = graph.getNode(id);
    if (!n) return;
    const isButton =
      n.semanticRole === 'button' ||
      (n.meta?.sourceTag === 'button');
    const text = (n.text ?? '').trim();
    if (isButton && text && NAV_LABEL_RE.test(text)) {
      labels.push(text);
    }
    if (n.childIds) for (const c of n.childIds) walk(c);
  }
  walk(rootId);
  return labels;
}

function rootIdOf(graph: SceneGraph): string | null {
  for (const [id, node] of graph.nodes) {
    if (node.parentId === null) return id;
  }
  return null;
}

export const navigationLabelConsistencyRule: FlowAuditRule = {
  id: 'flow.navigation-label-consistency',
  severity: 'warn',
  description: 'Forward-navigation button labels should be consistent across steps (pick one of "Next" / "Continue" / "Submit", not all three).',

  check(_spec, stepScenes): FlowAuditIssue[] {
    // Collect the set of forward-nav labels seen anywhere in the flow,
    // tracking which step contributed each. We only care about the
    // SHAPE of the set across steps — single-step variations within
    // one step are acceptable (e.g. a stepper UI showing both "Skip"
    // and "Continue" — different intents, not inconsistent).
    const labelToSteps = new Map<string, Set<number>>();
    for (let i = 0; i < stepScenes.length; i++) {
      const scene = stepScenes[i];
      if (!scene) continue;
      const rid = rootIdOf(scene);
      if (!rid) continue;
      const labels = collectNavLabels(scene, rid);
      // Treat case-insensitive equivalents as the same label for the
      // consistency check — "Next" and "NEXT" aren't a real divergence.
      const seenInThisStep = new Set<string>();
      for (const raw of labels) {
        const norm = raw.toLowerCase();
        if (seenInThisStep.has(norm)) continue;
        seenInThisStep.add(norm);
        if (!labelToSteps.has(norm)) labelToSteps.set(norm, new Set());
        labelToSteps.get(norm)!.add(i);
      }
    }

    if (labelToSteps.size <= 1) return [];

    // Multiple distinct labels in use across the flow. Pick the
    // most-common as the suggested standard (count = number of steps
    // using the label, NOT total occurrences — a single step using
    // the same label twice still counts once).
    const ranked = Array.from(labelToSteps.entries())
      .map(([label, steps]) => ({ label, count: steps.size }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label);
      });
    const suggested = ranked[0].label;
    const variants = ranked.map(r => r.label);

    return [
      {
        ruleId: 'flow.navigation-label-consistency',
        severity: 'warn',
        message: `Forward-navigation buttons use mixed labels across steps (${variants.map(v => `"${v}"`).join(', ')}); standardize on "${suggested}".`,
        details: {
          labels: variants,
          suggested,
          counts: Object.fromEntries(ranked.map(r => [r.label, r.count])),
        },
      },
    ];
  },
};
