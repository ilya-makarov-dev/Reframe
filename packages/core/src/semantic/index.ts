/**
 * Reframe Semantic Layer — public entry point.
 *
 * Two complementary classifiers ship out of this module:
 *
 *   1. {@link detectSemanticRole} / {@link autoDetectRoles} from `./auto-detect`
 *      — fast node-property predicates ("small frame with text + radius =
 *      button"). Operates on one node at a time. Good for general scenes
 *      where you want a quick semantic pass; banner-agnostic.
 *
 *   2. {@link classify} from `./classify` — frame-aware multi-slot
 *      classifier built on the resize subsystem's heuristics. Walks the
 *      whole tree, runs a Yoga layout pass first so positions are real,
 *      and identifies many titles/CTAs/sections in long-form designs
 *      (emails, landings) where the per-node detector loses context.
 *
 * Both write to `node.semanticRole`. Use whichever fits your scene shape;
 * for typical compile workflows the frame-aware {@link classify} is the
 * better default because it integrates with the design system.
 *
 * Also re-exports HTML/ARIA tag mapping helpers used by the HTML exporter
 * (`semanticTag`, `ariaRole`, `headingLevel`).
 */

export {
  detectSemanticRole,
  autoDetectRoles,
  semanticTag,
  ariaRole,
  headingLevel,
  type DetectedRole,
} from './auto-detect';

export {
  classifyScene,
  readSemanticSkeleton,
  SEMANTIC_TO_BANNER,
  type ClassifyOptions,
  type ClassifyResult,
  type SemanticSlot,
} from './classify';
