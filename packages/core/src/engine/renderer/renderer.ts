/**
 * Reframe Standalone Engine — Main Renderer
 *
 * CanvasKit-based renderer with paint caching, picture recording,
 * and compositing. Manages the full render pipeline:
 * transform → effects → fills → strokes → children.
 */

import type {
  ICanvasKit, IRSurface, IRCanvas, IRPaint, IRImage,
  IRFont, IRTypefaceFontProvider, IRPicture, IRPictureRecorder,
  Viewport,
} from './types';
import type { SceneNode } from '../types';
import { CONTAINER_TYPES } from '../types';
import type { SceneGraph } from '../scene-graph';
import { EffectCache, renderEffects } from './effects';
import { applyFill } from './fills';
import { configureStrokePaint, drawStrokeWithAlign } from './strokes';
import { makeNodeShapePath, nodeRect, clipNodeShape, hasRadius as nodeHasRadius } from './shapes';
import { renderText } from './text';
import { degToRad } from '../geometry';

// ─── Renderer ───────────────────────────────────────────────────

export class Renderer {
  readonly ck: ICanvasKit;
  private surface: IRSurface;
  private canvas: IRCanvas;

  // Pre-allocated paints
  fillPaint: IRPaint;
  strokePaint: IRPaint;
  auxPaint: IRPaint;
  opacityPaint: IRPaint;
  effectLayerPaint: IRPaint;

  // Caches
  effectCache: EffectCache;
  private imageCache = new Map<string, IRImage>();

  // Font
  fontProvider: IRTypefaceFontProvider | null = null;
  textFont: IRFont | null = null;

  // Viewport
  panX = 0;
  panY = 0;
  zoom = 1;
  dpr = 1;
  worldViewport: Viewport = { x: 0, y: 0, width: 0, height: 0 };

  constructor(ck: ICanvasKit, surface: IRSurface) {
    this.ck = ck;
    this.surface = surface;
    this.canvas = surface.getCanvas();

    this.fillPaint = new ck.Paint();
    this.fillPaint.setStyle(ck.PaintStyle.Fill);
    this.fillPaint.setAntiAlias(true);

    this.strokePaint = new ck.Paint();
    this.strokePaint.setStyle(ck.PaintStyle.Stroke);
    this.strokePaint.setAntiAlias(true);

    this.auxPaint = new ck.Paint();
    this.auxPaint.setAntiAlias(true);

    this.opacityPaint = new ck.Paint();
    this.effectLayerPaint = new ck.Paint();

    this.effectCache = new EffectCache(ck);
  }

  // ── Image Management ──────────────────────────

  addImage(hash: string, data: ArrayBuffer | Uint8Array): void {
    const img = this.ck.MakeImageFromEncoded(data instanceof Uint8Array ? data : new Uint8Array(data));
    if (img) {
      this.imageCache.set(hash, img);
    }
  }

  getImage(hash: string): IRImage | null {
    return this.imageCache.get(hash) ?? null;
  }

  // ── Main Render Pipeline ──────────────────────

  render(graph: SceneGraph, pageId?: string): void {
    const ck = this.ck;
    const canvas = this.canvas;

    // Clear
    canvas.clear(ck.WHITE);

    // Transform: DPR → Pan → Zoom
    canvas.save();
    canvas.scale(this.dpr, this.dpr);
    canvas.translate(this.panX, this.panY);
    canvas.scale(this.zoom, this.zoom);

    // Render page
    const page = pageId ? graph.getNode(pageId) : graph.getPages()[0];
    if (page) {
      for (const childId of page.childIds) {
        this.renderNode(canvas, graph, childId, 0, 0);
      }
    }

    canvas.restore();
    this.surface.flush();
  }

  // ── Node Rendering ────────────────────────────

  private renderNode(
    canvas: IRCanvas,
    graph: SceneGraph,
    nodeId: string,
    parentAbsX: number,
    parentAbsY: number,
  ): void {
    const ck = this.ck;
    const node = graph.getNode(nodeId);
    if (!node || !node.visible) return;

    // Frustum culling (optional, based on worldViewport)
    // ... skipped for simplicity, can be added later

    canvas.save();
    canvas.translate(node.x, node.y);

    const absX = parentAbsX + node.x;
    const absY = parentAbsY + node.y;

    // Opacity layer
    if (node.opacity < 1) {
      this.opacityPaint.setAlphaf(node.opacity);
      canvas.saveLayer(this.opacityPaint);
    }

    // Layer blur
    const layerBlur = node.effects.find(
      e => e.visible && (e.type === 'LAYER_BLUR' || e.type === 'FOREGROUND_BLUR'),
    );
    if (layerBlur) {
      this.effectLayerPaint.setImageFilter(
        this.effectCache.getBlur(layerBlur.radius / 2),
      );
      canvas.saveLayer(this.effectLayerPaint);
    }

    // Rotation & flip
    if (node.rotation !== 0) {
      canvas.rotate(node.rotation, node.width / 2, node.height / 2);
    }
    if (node.flipX) canvas.scale(-1, 1);
    if (node.flipY) canvas.scale(1, -1);

    // Render content
    if (node.type === 'TEXT') {
      this.renderTextNode(canvas, node);
    } else if (!CONTAINER_TYPES.has(node.type) || node.fills.length > 0 || node.strokes.length > 0) {
      this.renderShape(canvas, graph, node);
    }

    // Render children
    if (CONTAINER_TYPES.has(node.type)) {
      if (node.clipsContent) {
        canvas.save();
        clipNodeShape(ck, canvas as any, node);
      }

      for (const childId of node.childIds) {
        this.renderNode(canvas, graph, childId, absX, absY);
      }

      if (node.clipsContent) {
        canvas.restore();
      }
    }

    // Restore layers
    if (layerBlur) {
      canvas.restore();
      this.effectLayerPaint.setImageFilter(null);
    }
    if (node.opacity < 1) canvas.restore();
    canvas.restore();
  }

  // ── Shape Rendering ───────────────────────────

  private renderShape(canvas: IRCanvas, graph: SceneGraph, node: SceneNode): void {
    const ck = this.ck;
    const rect = nodeRect(ck, node);
    const shapePath = makeNodeShapePath(ck, node);
    const hr = nodeHasRadius(node);

    // Behind effects (drop shadow, background blur)
    renderEffects(ck, canvas, this.effectCache, this.auxPaint, this.effectLayerPaint,
      node, shapePath, rect, 'behind');

    // Fills
    for (const fill of node.fills) {
      if (!fill.visible) continue;
      const applied = applyFill(ck, this.fillPaint, fill, node, (h) => this.getImage(h));
      if (applied) {
        this.fillPaint.setAlphaf(fill.opacity);
        this.drawNodeFill(canvas, node, shapePath, rect);
        this.fillPaint.setShader(null);
        this.fillPaint.setAlphaf(1);
      }
    }

    // Strokes
    for (const stroke of node.strokes) {
      if (!stroke.visible) continue;
      configureStrokePaint(ck, this.strokePaint, stroke);
      drawStrokeWithAlign(ck, canvas, this.strokePaint, stroke, shapePath, rect);
      this.strokePaint.setPathEffect(null);
    }

    // Front effects (inner shadow)
    renderEffects(ck, canvas, this.effectCache, this.auxPaint, this.effectLayerPaint,
      node, shapePath, rect, 'front');

    shapePath.delete();
  }

  private drawNodeFill(
    canvas: IRCanvas,
    node: SceneNode,
    shapePath: any,
    rect: Float32Array,
  ): void {
    const ck = this.ck;
    switch (node.type) {
      case 'ELLIPSE':
        canvas.drawOval(rect, this.fillPaint);
        break;
      case 'LINE':
        canvas.drawLine(0, 0, node.width, 0, this.fillPaint);
        break;
      default:
        canvas.drawPath(shapePath, this.fillPaint);
        break;
    }
  }

  // ── Text Rendering ────────────────────────────

  private renderTextNode(canvas: IRCanvas, node: SceneNode): void {
    // Behind effects for text
    const ck = this.ck;

    for (const effect of node.effects) {
      if (!effect.visible || effect.type !== 'DROP_SHADOW') continue;
      const c = effect.color;
      const sigma = effect.radius / 2;
      const shadowColor = ck.Color4f(c.r, c.g, c.b, c.a);
      const dropFilter = this.effectCache.getDropShadow(
        effect.offset.x, effect.offset.y, sigma, shadowColor,
      );
      this.effectLayerPaint.setImageFilter(dropFilter);
      canvas.saveLayer(this.effectLayerPaint);
      renderText(ck, canvas, this.fontProvider, node, this.fillPaint, this.textFont);
      canvas.restore();
      this.effectLayerPaint.setImageFilter(null);
    }

    // Main text
    renderText(ck, canvas, this.fontProvider, node, this.fillPaint, this.textFont);
  }

  // ── Cleanup ───────────────────────────────────

  destroy(): void {
    this.fillPaint.delete();
    this.strokePaint.delete();
    this.auxPaint.delete();
    this.opacityPaint.delete();
    this.effectLayerPaint.delete();
    this.effectCache.clear();
    for (const img of this.imageCache.values()) img.delete();
    this.imageCache.clear();
    this.surface.delete();
  }
}
