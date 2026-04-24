/**
 * breakGrid is a TASTE macro, not a correctness rule.
 *
 * Engine does NOT auto-invoke this — invocation is explicit via
 * reframe_edit op='breakGrid', or agent-triggered when a scene's smell
 * table catches "3 equal cards" (see reframe-design SKILL.md smell row).
 *
 * This is intentionally NOT encoded as an AuditRule: intentional 3-equal
 * layouts are legitimate (pricing tiers, feature rows, hero grids). An
 * engine auto-fix loop that re-shuffles every 3-equal-of-anything would
 * override designer intent. Taste lives on the agent side (skill smell
 * tables, guidance in CLAUDE.md); correctness lives on the engine side
 * (audit rules police overflow, contrast, missing tokens, invalid tracks).
 * Keep the layers separate.
 *
 * ─── What this macro does when invoked ──────────────────────────
 *
 * Transform pattern = bento: middle child grows 2×, edges stay 1×,
 * middle region gets asymmetric vertical padding. Breaks visual symmetry
 * without touching inner content — that's other macros' scope.
 *
 * Detection (all required):
 *   1. Container has ≥3 children.
 *   2. Container layout is one of:
 *        - HORIZONTAL with NO_WRAP (flex-row of siblings)
 *        - GRID with all-1fr gridTemplateColumns
 *   3. All children have same computed width (±widthTolerance, default 8px).
 *   4. All children have same paddingTop + paddingBottom.
 *   5. Children subtree node counts within ±1 of each other (same visual
 *      density — prevents misfire on 3 heterogeneous siblings that happen
 *      to have equal width).
 *
 * Transform (Phase 1 pattern = 'bento'):
 *   N=3 → flex ratios [1, 2, 1] OR grid columns [1fr, 2fr, 1fr]
 *   N≥4 → [1, 2, 2, ..., 2, 1] — edges stay narrow, middle band grows
 *   Middle-band children (index 1 .. N-2) also get paddingTop/Bottom × 1.4
 *   to introduce vertical rhythm.
 *
 * Idempotency: a second call is a no-op. Detection predicate checks "all
 * children have layoutGrow=1 (or gridTemplateColumns all=1fr)" — if the
 * transform already ran, that predicate fails on pass 2.
 *
 * Scope: container only. Children's inner padding, colors, typography —
 * untouched. Use scaleSpacing / rotateColors / typographyPreset for those.
 */

import type { SceneGraph } from '../engine/scene-graph';
import type { GridTrack } from '../engine/types';

export interface BreakGridOptions {
  /** Pixel tolerance for "equal width" detection. Default 8. */
  widthTolerance?: number;
  /** Middle-band vertical padding multiplier. Default 1.4. */
  middlePaddingFactor?: number;
  /** Phase 1 supports only 'bento'. Reserved for future patterns. */
  pattern?: 'bento';
}

export interface BreakGridResult {
  /** Number of containers where the transform applied. */
  broken: number;
  /** Container node IDs whose ratios were rewritten. */
  containerIds: string[];
  /** Containers matched the detector but were skipped — already broken. */
  skippedIdempotent: string[];
}

export function breakGrid(
  graph: SceneGraph,
  rootId: string,
  options: BreakGridOptions = {},
): BreakGridResult {
  const widthTolerance = options.widthTolerance ?? 8;
  const middlePaddingFactor = options.middlePaddingFactor ?? 1.4;

  const broken: string[] = [];
  const skippedIdempotent: string[] = [];

  walk(rootId);

  function walk(nodeId: string): void {
    const n = graph.getNode(nodeId);
    if (!n) return;

    // Depth-first: recurse into children BEFORE considering this node.
    // Consistent with the rest of variations/ (spacing walks pre-order).
    for (const childId of n.childIds) walk(childId);

    // Only containers with children are candidates.
    if (!n.childIds || n.childIds.length < 3) return;

    const detect = detectEqualGrid(n, graph, widthTolerance);
    if (!detect.matched) return;

    // Idempotency: if ratios already asymmetric, this macro already ran
    // (or user manually asymmetric'd). Skip so repeated calls stay no-op.
    if (!detect.isCurrentlyEqualRatios) {
      skippedIdempotent.push(nodeId);
      return;
    }

    applyBento(nodeId, n.childIds, detect.mode, graph, middlePaddingFactor);
    broken.push(nodeId);
  }

  return {
    broken: broken.length,
    containerIds: broken,
    skippedIdempotent,
  };
}

// ─── Detection ─────────────────────────────────────────────

type GridMode = 'FLEX_ROW' | 'GRID';

interface DetectResult {
  matched: boolean;
  mode: GridMode;
  /** True = all ratios are equal (1/1/1 or 1fr/1fr/1fr) — candidate for transform. */
  isCurrentlyEqualRatios: boolean;
}

function detectEqualGrid(
  container: any,
  graph: SceneGraph,
  widthTolerance: number,
): DetectResult {
  const children = container.childIds.map((id: string) => graph.getNode(id)).filter(Boolean);
  const n = children.length;
  const failed: DetectResult = { matched: false, mode: 'FLEX_ROW', isCurrentlyEqualRatios: false };

  // Layout mode check.
  let mode: GridMode | null = null;
  let isCurrentlyEqualRatios = false;

  if (container.layoutMode === 'HORIZONTAL' && container.layoutWrap === 'NO_WRAP') {
    mode = 'FLEX_ROW';
    // "Equal ratios" = all children have the same layoutGrow value. Usually
    // that value is 1 (flex-row with flex:1 children) but could be any
    // uniform value. Idempotency means "uniform", not specifically "1".
    const grows = children.map((c: any) => c.layoutGrow ?? 0);
    isCurrentlyEqualRatios = grows.every((g: number) => g === grows[0]);
  } else if (container.layoutMode === 'GRID') {
    const cols: GridTrack[] = container.gridTemplateColumns ?? [];
    if (cols.length !== n) return failed; // explicit 1fr-per-child, not repeat(auto)
    const allFr = cols.every((t) => t.type === 'FR');
    if (!allFr) return failed;
    const values = cols.map((t: any) => t.value);
    isCurrentlyEqualRatios = values.every((v: number) => v === values[0]);
    mode = 'GRID';
  }

  if (!mode) return failed;

  // Equal widths (Yoga-resolved).
  const widths = children.map((c: any) => c.width ?? 0);
  const w0 = widths[0];
  const widthsEqual = widths.every((w: number) => Math.abs(w - w0) <= widthTolerance);
  if (!widthsEqual) return failed;

  // Equal vertical padding.
  const padPairs = children.map((c: any) => [c.paddingTop ?? 0, c.paddingBottom ?? 0]);
  const [pt0, pb0] = padPairs[0];
  const padsEqual = padPairs.every(([pt, pb]: [number, number]) => pt === pt0 && pb === pb0);
  if (!padsEqual) return failed;

  // Children subtree node counts within ±1.
  const counts = children.map((c: any) => countSubtreeNodes(c.id, graph));
  const minC = Math.min(...counts);
  const maxC = Math.max(...counts);
  if (maxC - minC > 1) return failed;

  return { matched: true, mode, isCurrentlyEqualRatios };
}

function countSubtreeNodes(nodeId: string, graph: SceneGraph): number {
  const n = graph.getNode(nodeId);
  if (!n) return 0;
  let count = 1;
  for (const c of n.childIds) count += countSubtreeNodes(c, graph);
  return count;
}

// ─── Transform (bento) ─────────────────────────────────────

function applyBento(
  containerId: string,
  childIds: string[],
  mode: GridMode,
  graph: SceneGraph,
  middlePaddingFactor: number,
): void {
  const n = childIds.length;
  // Ratio pattern: [1, 2, 2, …, 2, 1]. Edges 1, middle band 2.
  const ratioFor = (i: number): number => (i === 0 || i === n - 1 ? 1 : 2);
  const isMiddle = (i: number): boolean => i > 0 && i < n - 1;

  if (mode === 'FLEX_ROW') {
    childIds.forEach((childId, i) => {
      const child = graph.getNode(childId);
      if (!child) return;
      const patch: any = { layoutGrow: ratioFor(i) };
      if (isMiddle(i)) {
        patch.paddingTop = Math.round((child as any).paddingTop * middlePaddingFactor);
        patch.paddingBottom = Math.round((child as any).paddingBottom * middlePaddingFactor);
      }
      graph.updateNode(childId, patch);
    });
  } else if (mode === 'GRID') {
    // Rewrite parent's gridTemplateColumns to asymmetric.
    const nextCols: GridTrack[] = Array.from({ length: n }, (_, i) => ({
      type: 'FR' as const,
      value: ratioFor(i),
    }));
    graph.updateNode(containerId, { gridTemplateColumns: nextCols });
    // Middle-band vertical padding bump (same as flex path).
    childIds.forEach((childId, i) => {
      if (!isMiddle(i)) return;
      const child = graph.getNode(childId);
      if (!child) return;
      graph.updateNode(childId, {
        paddingTop: Math.round((child as any).paddingTop * middlePaddingFactor),
        paddingBottom: Math.round((child as any).paddingBottom * middlePaddingFactor),
      });
    });
  }
}
