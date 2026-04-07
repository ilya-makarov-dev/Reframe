/**
 * Reframe Standalone Engine — Renderer Exports
 */

export { Renderer } from './renderer';
export { EffectCache, renderEffects } from './effects';
export { applyFill, applySolidFill, applyLinearGradient, applyRadialGradient, applySweepGradient, applyImageFill } from './fills';
export { configureStrokePaint, drawStrokeWithAlign, drawIndividualSideStrokes, mapStrokeCap, mapStrokeJoin } from './strokes';
export { makeNodeShapePath, makeRRect, nodeRect, hasRadius, clipNodeShape } from './shapes';
export { buildParagraph, measureTextNode, renderText } from './text';

export type {
  ICanvasKit,
  IRPaint, IRCanvas, IRSurface, IRPath,
  IRShader, IRImageFilter, IRMaskFilter, IRPathEffect,
  IRImage, IRParagraph, IRPicture, IRFont,
  IRPictureRecorder, IRTypefaceFontProvider,
  Viewport,
} from './types';
