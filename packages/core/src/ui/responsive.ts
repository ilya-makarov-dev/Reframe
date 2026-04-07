/**
 * Responsive helpers — adapt layouts for different screen sizes.
 */

import type { NodeBlueprint, NodeProps } from '../builder.js';
import type { LayoutProps } from './layout.js';
import { page } from './layout.js';

/** Create a page that adapts to a target size with a design system theme. */
export function responsivePage(
  width: number, height: number,
  props: LayoutProps,
  ...children: NodeBlueprint[]
): NodeBlueprint {
  return page({ w: width, h: height, ...props }, ...children);
}

/** Scale a font size based on canvas area relative to 1080×1080. */
export function scaleFont(base: number, width: number, height: number): number {
  const area = width * height;
  const ref = 1080 * 1080;
  const scale = Math.max(0.4, Math.min(2.0, Math.sqrt(area / ref)));
  return Math.max(8, Math.round(base * scale));
}

/** Scale a spacing value based on canvas width relative to 1080. */
export function scaleSpace(base: number, width: number): number {
  const scale = Math.max(0.5, Math.min(2.0, width / 1080));
  return Math.round(base * scale);
}
