/**
 * @reframe/ui — Standard library for programmable design.
 *
 * Three layers:
 *   1. Layout    — how things are arranged (stack, row, grid, ...)
 *   2. Atoms     — what things look like (heading, body, button, ...)
 *   3. Style     — shortcuts for visual properties (pad, gap, fill, ...)
 *
 * Everything returns NodeBlueprint — compose freely, nest infinitely.
 * Output: INode tree via build().
 *
 * Usage:
 *   import { stack, row, heading, body, button, card } from '@reframe/ui';
 *   const page = stack({ gap: 64, pad: 80 },
 *     heading('Hello world'),
 *     body('Welcome to reframe'),
 *     button('Get Started'),
 *   );
 *   const { graph, root } = build(page);
 */

export { DEFAULTS, STATUS_COLORS } from './defaults.js';
export * from './layout.js';
export * from './atoms.js';
export * from './composites.js';
export * from './data.js';
export * from './style.js';
export * from './responsive.js';
export * from './theme.js';
export * from './render.js';
export * from './navigation.js';
export * from './feedback.js';
export * from './forms.js';
export * from './sections.js';
export * from './blueprint.js';
