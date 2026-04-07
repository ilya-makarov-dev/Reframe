/**
 * Text Measurement with opentype.js
 *
 * Provides accurate glyph-level text measurement for layout computation.
 * Falls back to heuristic estimation when fonts are not available.
 *
 * Usage:
 *   import { createTextMeasurer } from './text-measure';
 *   setTextMeasurer(createTextMeasurer());
 */

import type { SceneNode } from './types';
import type { TextMeasurer } from './layout';

// opentype.js types (subset we use)
interface OpentypeGlyph {
  advanceWidth: number;
}

interface OpentypeFont {
  unitsPerEm: number;
  charToGlyph(char: string): OpentypeGlyph;
  getAdvanceWidth(text: string, fontSize: number): number;
  ascender: number;
  descender: number;
}

type OpentypeModule = {
  load(url: string, callback: (err: any, font: OpentypeFont) => void): void;
  loadSync(url: string): OpentypeFont;
  parse(buffer: ArrayBuffer): OpentypeFont;
};

let opentype: OpentypeModule | null = null;
const fontCache = new Map<string, OpentypeFont>();

/**
 * Initialize opentype.js module.
 * Must be called before using font-based measurement.
 */
export async function initTextMeasurer(): Promise<void> {
  if (opentype) return;
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<any>;
    const mod = await dynamicImport('opentype.js');
    opentype = mod.default ?? mod;
  } catch {
    // opentype.js not available — will use heuristic fallback
  }
}

/**
 * Load a font file (.ttf, .otf, .woff) for accurate measurement.
 */
export function loadFontForMeasurement(fontFamily: string, buffer: ArrayBuffer): void {
  if (!opentype) return;
  try {
    const font = opentype.parse(buffer);
    fontCache.set(normalizeFamilyKey(fontFamily), font);
  } catch {
    // Font parse failed — will use fallback
  }
}

/**
 * Load a font file from a file path (Node.js only).
 */
export async function loadFontFile(fontFamily: string, filePath: string): Promise<boolean> {
  if (!opentype) return false;

  return new Promise<boolean>((resolve) => {
    opentype!.load(filePath, (err, font) => {
      if (err || !font) {
        resolve(false);
        return;
      }
      fontCache.set(normalizeFamilyKey(fontFamily), font);
      resolve(true);
    });
  });
}

function normalizeFamilyKey(family: string): string {
  return family.toLowerCase().replace(/\s+/g, '-');
}

function getFont(fontFamily: string): OpentypeFont | null {
  return fontCache.get(normalizeFamilyKey(fontFamily)) ?? null;
}

// ─── Measurement ────────────────────────────────────────────────

interface MeasureResult {
  width: number;
  height: number;
}

/**
 * Measure text using opentype.js if the font is loaded,
 * otherwise fall back to heuristic estimation.
 */
function measureText(
  text: string,
  fontSize: number,
  fontFamily: string,
  lineHeight: number | null,
  maxWidth?: number,
): MeasureResult {
  const font = getFont(fontFamily);
  const lh = lineHeight ?? fontSize * 1.2;

  if (font) {
    return measureWithFont(font, text, fontSize, lh, maxWidth);
  }

  return measureHeuristic(text, fontSize, lh, maxWidth);
}

function measureWithFont(
  font: OpentypeFont,
  text: string,
  fontSize: number,
  lineHeight: number,
  maxWidth?: number,
): MeasureResult {
  if (!text) return { width: 0, height: lineHeight };

  const lines = text.split('\n');
  let totalHeight = 0;
  let maxLineWidth = 0;

  for (const line of lines) {
    if (!maxWidth || maxWidth >= 1e5) {
      // No wrapping — single line
      const w = font.getAdvanceWidth(line, fontSize);
      maxLineWidth = Math.max(maxLineWidth, w);
      totalHeight += lineHeight;
    } else {
      // Word-wrap within maxWidth
      const wrapped = wrapLine(font, line, fontSize, maxWidth);
      for (const wrappedLine of wrapped) {
        const w = font.getAdvanceWidth(wrappedLine, fontSize);
        maxLineWidth = Math.max(maxLineWidth, w);
        totalHeight += lineHeight;
      }
    }
  }

  return { width: maxLineWidth, height: totalHeight };
}

function wrapLine(
  font: OpentypeFont,
  text: string,
  fontSize: number,
  maxWidth: number,
): string[] {
  const words = text.split(/(\s+)/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine + word;
    const testWidth = font.getAdvanceWidth(testLine, fontSize);

    if (testWidth > maxWidth && currentLine.length > 0) {
      lines.push(currentLine.trimEnd());
      currentLine = word.trimStart();
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine.trimEnd());
  }

  return lines.length > 0 ? lines : [''];
}

// ─── Heuristic Fallback ────────────────────────────────────────

// Average character width ratios by font category
const MONOSPACE_RATIO = 0.6;
const SERIF_RATIO = 0.52;
const SANS_RATIO = 0.5;

function getWidthRatio(fontFamily: string): number {
  const lower = fontFamily.toLowerCase();
  if (lower.includes('mono') || lower.includes('courier') || lower.includes('consolas')) {
    return MONOSPACE_RATIO;
  }
  if (lower.includes('serif') && !lower.includes('sans')) {
    return SERIF_RATIO;
  }
  return SANS_RATIO;
}

function measureHeuristic(
  text: string,
  fontSize: number,
  lineHeight: number,
  maxWidth?: number,
): MeasureResult {
  if (!text) return { width: 0, height: lineHeight };

  const charWidth = fontSize * SANS_RATIO;
  const lines = text.split('\n');
  let totalHeight = 0;
  let maxLineWidth = 0;

  for (const line of lines) {
    const naturalWidth = line.length * charWidth;

    if (!maxWidth || maxWidth >= 1e5) {
      maxLineWidth = Math.max(maxLineWidth, naturalWidth);
      totalHeight += lineHeight;
    } else {
      const numLines = Math.max(1, Math.ceil(naturalWidth / maxWidth));
      maxLineWidth = Math.max(maxLineWidth, Math.min(naturalWidth, maxWidth));
      totalHeight += numLines * lineHeight;
    }
  }

  return { width: maxLineWidth, height: totalHeight };
}

// ─── TextMeasurer Factory ──────────────────────────────────────

/**
 * Create a TextMeasurer compatible with the layout engine.
 * Use with setTextMeasurer() from layout.ts.
 */
export function createTextMeasurer(): TextMeasurer {
  return (node: SceneNode, maxWidth?: number): MeasureResult | null => {
    if (node.type !== 'TEXT' || !node.text) return null;

    return measureText(
      node.text,
      node.fontSize || 16,
      node.fontFamily || 'sans-serif',
      node.lineHeight,
      maxWidth,
    );
  };
}

/**
 * Get the number of loaded fonts available for measurement.
 */
export function getLoadedFontCount(): number {
  return fontCache.size;
}

/**
 * Check if opentype.js is available.
 */
export function isOpentypeAvailable(): boolean {
  return opentype !== null;
}
