/**
 * Shadow variation — scale elevation intensity.
 *
 * Transforms all DROP_SHADOW and INNER_SHADOW effects by scaling
 * blur, offset, and spread. Factor < 1 = flatter, > 1 = more lifted.
 * Factor = 0 flattens completely (good for minimalist brands).
 *
 * Named strategies:
 *   'flat'     — remove all shadows
 *   'subtle'   — factor 0.5
 *   'normal'   — factor 1.0 (no change)
 *   'dramatic' — factor 2.0
 *   { factor: N }
 */

import type { SceneGraph } from '../engine/scene-graph';

export type ShadowStrategy = 'flat' | 'subtle' | 'normal' | 'dramatic' | { factor: number };

function strategyToFactor(s: ShadowStrategy): number {
  if (typeof s === 'object') return Math.max(0, s.factor);
  switch (s) {
    case 'flat': return 0;
    case 'subtle': return 0.5;
    case 'normal': return 1;
    case 'dramatic': return 2;
  }
}

export function scaleShadows(
  graph: SceneGraph,
  rootId: string,
  strategy: ShadowStrategy,
): number {
  const factor = strategyToFactor(strategy);
  if (factor === 1) return 0;

  let changed = 0;

  function walk(nodeId: string) {
    const n = graph.getNode(nodeId);
    if (!n) return;

    const effects = (n as any).effects as any[] | undefined;
    if (Array.isArray(effects) && effects.length > 0) {
      let touched = false;
      const newEffects = factor === 0
        // Remove shadow effects entirely when flattening
        ? effects.filter(e => e && e.type !== 'DROP_SHADOW' && e.type !== 'INNER_SHADOW')
        : effects.map(e => {
            if (!e || (e.type !== 'DROP_SHADOW' && e.type !== 'INNER_SHADOW')) return e;
            touched = true;
            return {
              ...e,
              blurRadius: typeof e.blurRadius === 'number' ? Math.round(e.blurRadius * factor) : e.blurRadius,
              offset: e.offset
                ? { x: Math.round((e.offset.x ?? 0) * factor), y: Math.round((e.offset.y ?? 0) * factor) }
                : e.offset,
              spread: typeof e.spread === 'number' ? Math.round(e.spread * factor) : e.spread,
            };
          });
      if (newEffects.length !== effects.length || touched) {
        graph.updateNode(nodeId, { effects: newEffects });
        changed++;
      }
    }

    for (const childId of n.childIds) walk(childId);
  }

  walk(rootId);
  return changed;
}
