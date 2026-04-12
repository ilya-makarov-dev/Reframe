/**
 * Radius variation — transform corner radii with named strategies.
 *
 * Strategies:
 *   'sharp'   — set all radii to 0 (architectural, precise)
 *   'soft'    — multiply by 1.5, cap at 16 (friendly, approachable)
 *   'pill'    — small radii (< 32) become 9999 (full pill), larger stay (editorial)
 *   'editorial' — all radii become 2-4px (razor precision)
 *   { factor: N } — multiply by arbitrary factor
 *
 * Affects cornerRadius plus per-corner overrides (topLeftRadius, etc).
 */

import type { SceneGraph } from '../engine/scene-graph';

const RADIUS_FIELDS = [
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomLeftRadius',
  'bottomRightRadius',
] as const;

export type RadiusStrategy =
  | 'sharp'
  | 'soft'
  | 'pill'
  | 'editorial'
  | { factor: number }
  | { value: number };

export function scaleRadius(
  graph: SceneGraph,
  rootId: string,
  strategy: RadiusStrategy,
): number {
  const transform = (val: number): number => {
    if (val < 0) return val;
    if (typeof strategy === 'object') {
      if ('value' in strategy) return Math.max(0, strategy.value);
      if ('factor' in strategy) return Math.max(0, Math.round(val * strategy.factor));
    }
    switch (strategy) {
      case 'sharp':
        return 0;
      case 'soft':
        return Math.min(16, Math.round(val * 1.5));
      case 'pill':
        return val > 0 && val < 32 ? 9999 : val;
      case 'editorial':
        return val > 0 ? Math.min(4, val) : 0;
      default:
        return val;
    }
  };

  let changed = 0;

  function walk(nodeId: string) {
    const n = graph.getNode(nodeId);
    if (!n) return;

    for (const field of RADIUS_FIELDS) {
      const val = (n as any)[field];
      if (typeof val === 'number') {
        const next = transform(val);
        if (next !== val) {
          graph.updateNode(nodeId, { [field]: next });
          changed++;
        }
      }
    }

    for (const childId of n.childIds) walk(childId);
  }

  walk(rootId);
  return changed;
}
