/**
 * Color variation — rotate token roles.
 *
 * Swaps color token values so that nodes bound to one role get the
 * visual treatment of another. Useful for "what if primary was accent"
 * experiments without touching the actual scene graph.
 *
 * Example: rotateColors(graph, index, ['color.primary', 'color.accent'])
 * — all buttons (bound to color.primary) now use the accent color,
 * and vice versa.
 *
 * Alternatively, apply a named rotation:
 *   'invert-accent'  — swap primary ↔ accent
 *   'invert-mode'    — swap background ↔ text (polarity flip)
 */

import type { SceneGraph } from '../engine/scene-graph';
import type { TokenIndex } from '../design-system/tokens';
import type { VariableValue } from '../engine/types';

export type ColorRotation =
  | 'invert-accent'
  | 'invert-mode'
  | [string, string];

export function rotateColors(
  graph: SceneGraph,
  index: TokenIndex,
  rotation: ColorRotation,
): number {
  const [a, b] = typeof rotation === 'string'
    ? rotation === 'invert-accent'
      ? ['color.primary', 'color.accent']
      : ['color.background', 'color.text']
    : rotation;

  const aId = index.tokens.get(a);
  const bId = index.tokens.get(b);
  if (!aId || !bId) return 0;

  const aVar = graph.variables.get(aId);
  const bVar = graph.variables.get(bId);
  if (!aVar || !bVar) return 0;

  const collection = graph.variableCollections.get(index.collectionId);
  if (!collection) return 0;

  let changed = 0;
  for (const mode of collection.modes) {
    const aVal: VariableValue | undefined = aVar.valuesByMode[mode.modeId];
    const bVal: VariableValue | undefined = bVar.valuesByMode[mode.modeId];
    if (aVal === undefined || bVal === undefined) continue;
    aVar.valuesByMode[mode.modeId] = bVal;
    bVar.valuesByMode[mode.modeId] = aVal;
    changed++;
  }

  return changed;
}
