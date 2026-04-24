/**
 * PPTX Exporter — Scene Graph → PowerPoint Deck
 *
 * Emits one slide per scene graph. The slide carries a full-bleed PNG
 * rasterization of the scene, authored via `exportToRaster` (CanvasKit).
 * Sizing keeps the scene's native aspect ratio within a 10×5.625"
 * default slide (16:9) — if a scene is taller, the slide grows
 * vertically rather than cropping so pitch decks don't lose content.
 *
 * Why PNG-backed and not shape-based:
 *   PowerPoint shapes can approximate rectangles + text + images, but
 *   text wrapping, flex-layout, gradients, and the full CSS model don't
 *   round-trip cleanly. A designer who wants to edit in PPT would be
 *   fighting divergent layout engines. PNG-per-slide ships pixel-perfect
 *   fidelity NOW and keeps the round-trip story honest: "to edit, open
 *   reframe". Future shape-based export lives behind `shapeMode: true`
 *   in PptxExportOptions.
 *
 * Multi-scene decks:
 *   `exportToPptx` accepts either a single {graph, rootId} OR an array
 *   of them to emit a multi-slide deck in one pass. Slide order follows
 *   array order. Each slide gets an optional title from scene.name.
 *
 * Lazy pptxgenjs:
 *   pptxgenjs is ~600 KB. We dynamic-import it inside the function so
 *   bundlers / cold-starts don't pay the cost until someone exports PPTX.
 */

import type { SceneGraph } from '../engine/scene-graph.js';
import { exportToRaster, initCanvasKit } from './raster.js';

export interface PptxScene {
  graph: SceneGraph;
  rootId: string;
  /** Optional slide title (shown in the slide's notes, not on-canvas). */
  title?: string;
}

export interface PptxExportOptions {
  /** Slide aspect. Default 16:9 ("LAYOUT_WIDE" in pptxgenjs). */
  layout?: 'LAYOUT_16x9' | 'LAYOUT_4x3' | 'LAYOUT_WIDE' | 'LAYOUT_USER';
  /** Title shown on the deck's first "section" property (metadata only). */
  deckTitle?: string;
  /** Author metadata (set in the deck's core properties). */
  author?: string;
  /**
   * Raster scale factor. 2 = retina. Higher = sharper slides but larger
   * file. Default 2 gives print-quality slides without ballooning size
   * past a few MB per scene.
   */
  scale?: number;
  /**
   * When true, draw the PNG at the scene's native aspect inside the
   * slide — black letterbox on overflow axes. When false (default),
   * stretch PNG to fill the slide (standard "fit" behavior).
   */
  letterbox?: boolean;
}

/**
 * Emit a PPTX deck from one or many scene graphs. Returns a Buffer.
 *
 * @param scenes  One scene or an array of {graph, rootId, title?}.
 * @param options Deck-wide options (layout, metadata, raster scale).
 */
export async function exportToPptx(
  scenes: PptxScene | PptxScene[],
  options: PptxExportOptions = {},
): Promise<Buffer> {
  const list = Array.isArray(scenes) ? scenes : [scenes];
  if (list.length === 0) {
    throw new Error('exportToPptx: no scenes provided');
  }

  if (!initCanvasKit) throw new Error('raster exporter not available');
  await initCanvasKit();

  // Lazy-import pptxgenjs — its module graph is ~600 KB and we don't
  // want to pay that cost on cold-start if the caller never exports PPTX.
  const pptxMod = await import('pptxgenjs');
  const PptxGen = (pptxMod.default ?? pptxMod) as any;
  const pres = new PptxGen();

  pres.layout = options.layout ?? 'LAYOUT_WIDE';
  if (options.deckTitle) pres.title = options.deckTitle;
  if (options.author)    pres.author = options.author;

  // Standard LAYOUT_WIDE is 13.333 x 7.5 inches. Slides auto-fit within.
  const SLIDE_W_IN = pres.width  ?? 13.333;
  const SLIDE_H_IN = pres.height ?? 7.5;
  const scale = options.scale ?? 2;
  const letterbox = options.letterbox ?? false;

  for (const scene of list) {
    const root = scene.graph.getNode(scene.rootId);
    if (!root) continue;

    const png = await exportToRaster(scene.graph, scene.rootId, {
      format: 'png',
      scale,
    });
    const pngBase64 = Buffer.from(png).toString('base64');
    const pngDataUri = `data:image/png;base64,${pngBase64}`;

    const slide = pres.addSlide();

    if (letterbox) {
      // Fit the image inside the slide preserving aspect. Center the
      // image and let pptxgenjs handle the aspect-preserving scale.
      const sceneW = root.width;
      const sceneH = root.height;
      const sceneAspect = sceneW / sceneH;
      const slideAspect = SLIDE_W_IN / SLIDE_H_IN;
      let w: number;
      let h: number;
      let x: number;
      let y: number;
      if (sceneAspect >= slideAspect) {
        w = SLIDE_W_IN;
        h = SLIDE_W_IN / sceneAspect;
        x = 0;
        y = (SLIDE_H_IN - h) / 2;
      } else {
        h = SLIDE_H_IN;
        w = SLIDE_H_IN * sceneAspect;
        y = 0;
        x = (SLIDE_W_IN - w) / 2;
      }
      slide.addImage({ data: pngDataUri, x, y, w, h });
      // Dark background so letterbox bars read as intentional, not empty.
      slide.background = { color: '111111' };
    } else {
      slide.addImage({ data: pngDataUri, x: 0, y: 0, w: SLIDE_W_IN, h: SLIDE_H_IN });
    }

    if (scene.title) {
      // Add to speaker notes (non-destructive, keeps the slide clean
      // for presentation). Speaker notes also surface in screen readers.
      slide.addNotes(scene.title);
    }
  }

  // pptxgenjs's `write('nodebuffer')` returns the PPTX as a Buffer
  // instead of writing to disk — caller decides where to persist.
  const buf = (await pres.write({ outputType: 'nodebuffer' })) as Buffer;
  return buf;
}
