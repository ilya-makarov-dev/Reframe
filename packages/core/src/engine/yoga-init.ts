/**
 * Yoga WASM Auto-Initialization
 *
 * Loads yoga-layout (WASM) and registers it with the layout engine.
 * Call initYoga() once at startup before computing layouts.
 */

import { setYoga, setTextMeasurer } from './layout';
import type { YogaInstance } from './layout';
import { initTextMeasurer, createTextMeasurer } from './text-measure';

let initialized = false;

/**
 * Initialize the Yoga WASM layout engine and text measurer.
 * Safe to call multiple times — only initializes once.
 */
export async function initYoga(): Promise<void> {
  if (initialized) return;

  // Use Function constructor to prevent TypeScript from converting import() to require()
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<any>;
  const Yoga = await dynamicImport('yoga-layout');
  const y = Yoga.default ?? Yoga;

  const instance: YogaInstance = {
    Node: { create: () => y.Node.create() },
    DIRECTION_LTR: y.DIRECTION_LTR,
    FLEX_DIRECTION_ROW: y.FLEX_DIRECTION_ROW,
    FLEX_DIRECTION_COLUMN: y.FLEX_DIRECTION_COLUMN,
    WRAP_NO_WRAP: y.WRAP_NO_WRAP,
    WRAP_WRAP: y.WRAP_WRAP,
    JUSTIFY_FLEX_START: y.JUSTIFY_FLEX_START,
    JUSTIFY_CENTER: y.JUSTIFY_CENTER,
    JUSTIFY_FLEX_END: y.JUSTIFY_FLEX_END,
    JUSTIFY_SPACE_BETWEEN: y.JUSTIFY_SPACE_BETWEEN,
    ALIGN_FLEX_START: y.ALIGN_FLEX_START,
    ALIGN_CENTER: y.ALIGN_CENTER,
    ALIGN_FLEX_END: y.ALIGN_FLEX_END,
    ALIGN_STRETCH: y.ALIGN_STRETCH,
    ALIGN_BASELINE: y.ALIGN_BASELINE,
    ALIGN_SPACE_BETWEEN: y.ALIGN_SPACE_BETWEEN,
    ALIGN_AUTO: y.ALIGN_AUTO,
    DISPLAY_FLEX: y.DISPLAY_FLEX,
    DISPLAY_NONE: y.DISPLAY_NONE,
    POSITION_TYPE_RELATIVE: y.POSITION_TYPE_RELATIVE,
    POSITION_TYPE_ABSOLUTE: y.POSITION_TYPE_ABSOLUTE,
    OVERFLOW_HIDDEN: y.OVERFLOW_HIDDEN,
    OVERFLOW_VISIBLE: y.OVERFLOW_VISIBLE,
    EDGE_TOP: y.EDGE_TOP,
    EDGE_RIGHT: y.EDGE_RIGHT,
    EDGE_BOTTOM: y.EDGE_BOTTOM,
    EDGE_LEFT: y.EDGE_LEFT,
    GUTTER_COLUMN: y.GUTTER_COLUMN,
    GUTTER_ROW: y.GUTTER_ROW,
  };

  setYoga(instance);

  // Initialize text measurement (opentype.js)
  await initTextMeasurer();
  setTextMeasurer(createTextMeasurer());

  initialized = true;
}
