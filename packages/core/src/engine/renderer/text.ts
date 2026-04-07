/**
 * Reframe Standalone Engine — Text Rendering & Measurement
 *
 * Builds CanvasKit Paragraphs with multi-run styling.
 * Provides text measurement for layout engine.
 */

import type { ICanvasKit, IRParagraph, IRTypefaceFontProvider, IRCanvas, IRPaint, IRFont } from './types';
import type { SceneNode } from '../types';
import { getCJKFallbackFamily } from '../fonts';

// ─── Constants ──────────────────────────────────────────────────

const DEFAULT_FONT_FAMILY = 'Inter';
const DEFAULT_FONT_SIZE = 16;

// ─── Text Alignment Mapping ─────────────────────────────────────

function getTextAlign(ck: ICanvasKit, align: string | undefined): number {
  // CanvasKit TextAlign: Left=0, Right=1, Center=2, Justify=3
  switch (align) {
    case 'CENTER': return 2;
    case 'RIGHT': return 1;
    case 'JUSTIFIED': return 3;
    default: return 0; // LEFT
  }
}

function getTextDecoration(ck: ICanvasKit, deco: string | undefined): number {
  // CanvasKit TextDecoration: NoDecoration=0, Underline=1, Overline=2, LineThrough=4
  switch (deco) {
    case 'UNDERLINE': return 1;
    case 'STRIKETHROUGH': return 4;
    default: return 0;
  }
}

// ─── Font Families Helper ───────────────────────────────────────

function buildFontFamilies(primary: string): string[] {
  const families = [primary];
  if (primary !== DEFAULT_FONT_FAMILY) families.push(DEFAULT_FONT_FAMILY);
  const cjk = getCJKFallbackFamily();
  if (cjk) families.push(cjk);
  return families;
}

// ─── Build Paragraph ────────────────────────────────────────────

/**
 * Build a styled CanvasKit Paragraph from a SceneNode.
 */
export function buildParagraph(
  ck: ICanvasKit,
  fontProvider: IRTypefaceFontProvider,
  node: SceneNode,
  color?: Float32Array,
  options?: { halfLeading?: boolean },
): IRParagraph {
  const baseColor = color ?? ck.BLACK;
  const baseFontSize = node.fontSize || DEFAULT_FONT_SIZE;
  const halfLeading = options?.halfLeading ?? false;

  const paraStyle = new ck.ParagraphStyle({
    textAlign: getTextAlign(ck, node.textAlignHorizontal),
    maxLines: node.maxLines ?? undefined,
    ellipsis: node.textTruncation === 'ENDING' ? '\u2026' : undefined,
    textStyle: {
      color: baseColor,
      fontFamilies: buildFontFamilies(node.fontFamily || DEFAULT_FONT_FAMILY),
      fontSize: baseFontSize,
      fontStyle: {
        weight: { value: node.fontWeight || 400 },
        slant: node.italic ? ck.FontSlant.Italic : ck.FontSlant.Upright,
      },
      letterSpacing: node.letterSpacing || 0,
      decoration: getTextDecoration(ck, node.textDecoration),
      heightMultiplier: node.lineHeight ? node.lineHeight / baseFontSize : undefined,
      halfLeading,
    },
  });

  const builder = ck.ParagraphBuilder.MakeFromFontProvider(paraStyle, fontProvider);
  const text = node.text || '';

  if (node.styleRuns.length === 0) {
    builder.addText(text);
  } else {
    let pos = 0;
    for (const run of node.styleRuns) {
      // Add unstyled text before this run
      if (run.start > pos) {
        builder.addText(text.slice(pos, run.start));
      }

      // Push run style
      const runFamily = run.style.fontFamily ?? node.fontFamily ?? DEFAULT_FONT_FAMILY;
      const runWeight = run.style.fontWeight ?? node.fontWeight ?? 400;
      const runItalic = run.style.italic ?? node.italic ?? false;
      const runFontSize = run.style.fontSize ?? baseFontSize;

      builder.pushStyle(new ck.TextStyle({
        color: run.style.fillColor
          ? ck.Color4f(run.style.fillColor.r, run.style.fillColor.g, run.style.fillColor.b, run.style.fillColor.a)
          : baseColor,
        fontFamilies: buildFontFamilies(runFamily),
        fontSize: runFontSize,
        fontStyle: {
          weight: { value: runWeight },
          slant: runItalic ? ck.FontSlant.Italic : ck.FontSlant.Upright,
        },
        letterSpacing: run.style.letterSpacing ?? node.letterSpacing ?? 0,
        decoration: getTextDecoration(ck, run.style.textDecoration ?? node.textDecoration),
        heightMultiplier: run.style.lineHeight
          ? run.style.lineHeight / runFontSize
          : (node.lineHeight ? node.lineHeight / runFontSize : undefined),
        halfLeading,
      }));

      builder.addText(text.slice(run.start, run.start + run.length));
      builder.pop();

      pos = run.start + run.length;
    }

    // Remaining text after last run
    if (pos < text.length) {
      builder.addText(text.slice(pos));
    }
  }

  const paragraph = builder.build();
  builder.delete();
  return paragraph;
}

// ─── Text Measurement ───────────────────────────────────────────

/**
 * Measure a text node's dimensions.
 */
export function measureTextNode(
  ck: ICanvasKit,
  fontProvider: IRTypefaceFontProvider,
  node: SceneNode,
  maxWidth?: number,
): { width: number; height: number } | null {
  const paragraph = buildParagraph(ck, fontProvider, node);
  const layoutWidth = maxWidth
    ?? (node.textAutoResize === 'WIDTH_AND_HEIGHT' ? 1e6 : (node.width || 1e6));

  paragraph.layout(layoutWidth);
  const width = paragraph.getLongestLine();
  const height = paragraph.getHeight();
  paragraph.delete();

  return { width: Math.ceil(width), height: Math.ceil(height) };
}

// ─── Render Text ────────────────────────────────────────────────

/**
 * Draw text content for a node onto a canvas.
 */
export function renderText(
  ck: ICanvasKit,
  canvas: IRCanvas,
  fontProvider: IRTypefaceFontProvider | null,
  node: SceneNode,
  fillPaint: IRPaint,
  textFont: IRFont | null,
): void {
  const text = node.text;
  if (!text) return;

  // Try CanvasKit paragraph rendering
  if (fontProvider) {
    const paragraph = buildParagraph(ck, fontProvider, node, fillPaint.getColor(), { halfLeading: true });
    const layoutWidth = node.textAutoResize === 'WIDTH_AND_HEIGHT' ? 1e6 : (node.width || 1e6);
    paragraph.layout(layoutWidth);
    canvas.drawParagraph(paragraph, 0, 0);
    paragraph.delete();
    return;
  }

  // Fallback: simple drawText
  if (textFont) {
    canvas.save();
    canvas.clipRect(ck.LTRBRect(0, 0, node.width, node.height), ck.ClipOp.Intersect, false);
    canvas.drawText(text, 0, node.fontSize || DEFAULT_FONT_SIZE, fillPaint, textFont);
    canvas.restore();
  }
}
