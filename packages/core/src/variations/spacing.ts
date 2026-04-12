/**
 * Spacing variation — scale padding, gaps, and spacing uniformly.
 *
 * Multiplies all structural spacing (padding*, itemSpacing, counterAxisSpacing)
 * by a factor. Factor < 1 = compact, > 1 = spacious. Does NOT touch widths,
 * heights, or fixed min/max dimensions — those would break layout.
 *
 * Semantic-aware: by default, content nodes (headings, paragraphs, buttons)
 * keep their internal padding. Only layout containers are scaled. This
 * preserves the visual weight of atomic components while reshaping the
 * overall rhythm of the design.
 */

import type { SceneGraph } from '../engine/scene-graph';

const SPACING_FIELDS = [
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'itemSpacing',
  'counterAxisSpacing',
] as const;

export interface ScaleSpacingOptions {
  /**
   * When true (default), preserves internal padding of atomic content
   * nodes (button, badge, tag, input) so their shape stays recognizable.
   * When false, scales everything.
   */
  preserveAtoms?: boolean;
  /** Minimum result value — smaller values snap to 0. Default: 1. */
  minValue?: number;
  /** Maximum clamp — larger values clamp to this. Default: Infinity. */
  maxValue?: number;
}

const ATOM_ROLES = new Set(['button', 'cta', 'badge', 'tag', 'input', 'avatar', 'logo']);

/**
 * Scale spacing fields on all nodes in the subtree.
 * Returns number of field mutations applied.
 */
export function scaleSpacing(
  graph: SceneGraph,
  rootId: string,
  factor: number,
  options: ScaleSpacingOptions = {},
): number {
  if (factor === 1 || !isFinite(factor) || factor < 0) return 0;

  const preserveAtoms = options.preserveAtoms ?? true;
  const minValue = options.minValue ?? 1;
  const maxValue = options.maxValue ?? Infinity;

  let changed = 0;

  function walk(nodeId: string) {
    const n = graph.getNode(nodeId);
    if (!n) return;

    const role = (n as any).semanticRole as string | null;
    const isAtom = preserveAtoms && role && ATOM_ROLES.has(role);

    if (!isAtom && n.type !== 'TEXT') {
      for (const field of SPACING_FIELDS) {
        const val = (n as any)[field];
        if (typeof val === 'number' && val > 0) {
          let next = Math.round(val * factor);
          if (next < minValue) next = 0;
          if (next > maxValue) next = maxValue;
          if (next !== val) {
            graph.updateNode(nodeId, { [field]: next });
            changed++;
          }
        }
      }
    }

    for (const childId of n.childIds) walk(childId);
  }

  walk(rootId);
  return changed;
}
