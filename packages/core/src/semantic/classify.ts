/**
 * Reframe Semantic Layer — public entry point.
 *
 * Bridges the resize subsystem's semantic classifier (which was originally
 * built for ad-banner adaptation) into the rest of the engine, so any
 * INode tree can be tagged with semantic roles regardless of whether it
 * came from a banner pipeline.
 *
 * The classifier itself lives in resize/postprocess/semantic-classifier.ts
 * because moving it would touch ~10 internal callers; this module wraps it
 * with a clean public API and writes the classifications back to the
 * engine's `node.semanticRole` field so downstream consumers (compile,
 * inspect, edit, export) can read them without depending on resize/.
 */

import { SceneGraph } from '../engine/scene-graph';
import { ensureSceneLayout } from '../engine/layout';
import { initYoga } from '../engine/yoga-init';
import { assignSemanticTypes } from '../resize/postprocess/semantic-classifier';
import { collectAllDescendants } from '../resize/postprocess/layout-utils';
import { getStandaloneNode } from '../adapters/standalone/node';
import { StandaloneHost } from '../adapters/standalone/adapter';
import { setHost } from '../host/context';
import type { DesignSystem } from '../design-system/types';
import type { BannerElementType } from '../resize/contracts/types';
import type { SemanticRole } from '../engine/types';

// ─── Public API ──────────────────────────────────────────────────

export interface ClassifyOptions {
  /** Design system for DS-informed heuristics (font size matching, button shape, etc.). */
  designSystem?: DesignSystem;
  /** Permit multiple matches per role. Default: true. Set false for banner-style single-CTA designs. */
  multiSlot?: boolean;
  /** Skip writing roles back to `node.semanticRole`. Default: false (writes). */
  dryRun?: boolean;
  /**
   * When true (default), nodes that already carry a `semanticRole` are left
   * alone and the classifier only fills in untagged nodes. This keeps
   * inspect → edit → inspect cycles deterministic: each edit subtly shifts
   * the scoring heuristics (x/y moved, fills changed), and re-running the
   * banner scoring from scratch would silently flip already-confirmed
   * roles ("Three things…" goes from paragraph to heading between two
   * inspects because its relative position in the frame changed slightly).
   * Pass `false` to force a clean re-classification — compile does this on
   * first import when the scene has no tags yet.
   */
  preserveExisting?: boolean;
}

export interface ClassifyResult {
  /** Map of nodeId → role using the legacy banner enum (kept for backward compat). */
  semanticTypes: Map<string, BannerElementType>;
  /** Histogram of role assignments. */
  distribution: Record<string, number>;
  /** Number of nodes that received a semantic role. */
  classified: number;
  /** Number of candidate nodes considered (descendants of root). */
  candidates: number;
}

/**
 * Map the resize subsystem's `BannerElementType` enum to the engine's
 * `SemanticRole` enum. The banner enum is narrower and a-banner-shaped;
 * the engine's enum is the canonical surface that compile/inspect/export
 * already understand.
 */
const BANNER_TO_SEMANTIC: Record<BannerElementType, SemanticRole | null> = {
  title: 'heading',
  description: 'paragraph',
  button: 'button',
  disclaimer: 'caption',
  ageRating: 'badge',
  logo: 'logo',
  background: 'section',
  other: null,
};

/**
 * Reverse of BANNER_TO_SEMANTIC — used when displaying a semantic skeleton
 * so the inspect/compile output stays in the same vocabulary (`title=4`,
 * `description=2`) that the banner-classifier produced upstream.
 */
export const SEMANTIC_TO_BANNER: Partial<Record<SemanticRole, BannerElementType>> = {
  heading: 'title',
  paragraph: 'description',
  button: 'button',
  caption: 'disclaimer',
  badge: 'ageRating',
  logo: 'logo',
  section: 'background',
};

/**
 * Classify a scene's descendants by semantic role.
 *
 * Pipeline:
 *   1. Initialize Yoga (idempotent) — needed by ensureSceneLayout.
 *   2. Run a layout pass — without computed (x, y) the classifier's
 *      position-based heuristics return all-or-nothing degenerate results.
 *   3. Walk all descendants of the root and run the classifier with
 *      multi-slot mode by default (long-form designs have many CTAs etc.).
 *   4. Write each classification back to `node.semanticRole` via the
 *      banner→engine role map (skips `other` which has no semantic meaning).
 *   5. Return the raw map plus a distribution histogram.
 *
 * Distinct from {@link classify} in `resize/transforms` — that one is a
 * pipeline `Transform` returning ctx state; this one is a direct
 * graph→result async function with side-effects on `node.semanticRole`.
 */
export async function classifyScene(
  graph: SceneGraph,
  rootId: string,
  options: ClassifyOptions = {},
): Promise<ClassifyResult> {
  await initYoga();
  ensureSceneLayout(graph, rootId);

  // The classifier needs an INode wrapper. Use the cached factory so
  // descendants reached via `child.parent` share identity with the root —
  // otherwise isDirectChild() silently fails for everything.
  const host = new StandaloneHost(graph);
  setHost(host);
  const root = getStandaloneNode(graph, rootId);
  if (!root) throw new Error(`Node ${rootId} not found`);

  const descendants = collectAllDescendants(root).filter(n => n !== root);
  const semanticTypes = assignSemanticTypes(
    descendants,
    root,
    options.designSystem,
    { multiSlot: options.multiSlot ?? true },
  );

  const preserveExisting = options.preserveExisting ?? true;

  if (!options.dryRun) {
    for (const [nodeId, role] of semanticTypes) {
      const semanticRole = BANNER_TO_SEMANTIC[role];
      if (!semanticRole) continue;
      if (preserveExisting) {
        // Don't overwrite roles that previous runs locked in. Without this
        // guard, every inspect call re-scores every node and the classifier
        // drifts: text that slipped to role=heading in one pass can become
        // role=paragraph the next, breaking updateSlot lookups mid-session.
        const existing = graph.getNode(nodeId);
        if (existing && (existing as any).semanticRole) continue;
      }
      graph.updateNode(nodeId, { semanticRole });
    }
  }

  // Distribution histogram should reflect what's actually tagged on the
  // graph right now (preserved + newly assigned), not just what this pass
  // scored — otherwise the caller sees numbers that disagree with
  // readSemanticSkeleton run a moment later.
  const distribution: Record<string, number> = {};
  if (options.dryRun) {
    for (const role of semanticTypes.values()) {
      distribution[role] = (distribution[role] ?? 0) + 1;
    }
  } else {
    const reverse: Partial<Record<SemanticRole, BannerElementType>> = {
      heading: 'title',
      paragraph: 'description',
      button: 'button',
      caption: 'disclaimer',
      badge: 'ageRating',
      logo: 'logo',
      section: 'background',
    };
    for (const n of descendants) {
      const engineRole = (n as any).semanticRole as SemanticRole | undefined;
      if (!engineRole) continue;
      const bannerRole = reverse[engineRole] ?? (engineRole as unknown as BannerElementType);
      distribution[bannerRole] = (distribution[bannerRole] ?? 0) + 1;
    }
  }

  return {
    semanticTypes,
    distribution,
    classified: semanticTypes.size,
    candidates: descendants.length,
  };
}

/**
 * Read the semantic skeleton of an already-classified scene.
 *
 * Returns a flat list of `(nodeId, role, name, geometry)` tuples sorted
 * by depth-first order. Useful for `reframe_inspect` semantic view and
 * for tests / regression scripts.
 */
export interface SemanticSlot {
  nodeId: string;
  role: SemanticRole;
  name: string;
  text?: string;
  bounds: { x: number; y: number; w: number; h: number };
}

export function readSemanticSkeleton(graph: SceneGraph, rootId: string): SemanticSlot[] {
  const out: SemanticSlot[] = [];
  const walk = (id: string) => {
    const n = graph.getNode(id);
    if (!n) return;
    if (n.semanticRole) {
      out.push({
        nodeId: n.id,
        role: n.semanticRole,
        name: n.name,
        text: n.type === 'TEXT' ? (n.text || undefined) : undefined,
        bounds: { x: n.x, y: n.y, w: n.width, h: n.height },
      });
    }
    for (const cid of n.childIds ?? []) walk(cid);
  };
  walk(rootId);
  return out;
}
