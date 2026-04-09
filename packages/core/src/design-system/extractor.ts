/**
 * DesignSystem extractor — reverse-engineers a DesignSystem from a Figma frame.
 *
 * Analyzes a banner frame's nodes and extracts:
 *   - Typography hierarchy (font sizes, weights, line-heights)
 *   - Color palette (fills, strokes)
 *   - Component styles (button border-radius)
 *   - Layout spacing patterns
 *
 * This is the "killer feature" — load one banner, get a DESIGN.md,
 * then all subsequent resizes respect that brand's system.
 */

import { type INode, type IFontName, type ISolidPaint, NodeType, MIXED, type IPaint } from '../host';
import { collectAllDescendants, getBoundsInFrame } from '../resize/postprocess/layout-utils';
import type {
  DesignSystem,
  DesignSystemColors,
  TypographyRule,
  TypographyRole,
  ButtonSpec,
  ButtonStyle,
} from './types';

// ---------------------------------------------------------------------------
//  Color extraction
// ---------------------------------------------------------------------------

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function extractSolidFills(node: INode): { hex: string; opacity: number }[] {
  const fills = node.fills;
  if (fills === MIXED || !Array.isArray(fills)) return [];
  return fills
    .filter((f: any) => f.type === 'SOLID' && f.visible !== false)
    .map((f: any) => ({
      hex: rgbToHex(f.color.r, f.color.g, f.color.b),
      opacity: f.opacity ?? 1,
    }));
}

interface ColorFreq {
  hex: string;
  count: number;
  totalArea: number;
  contexts: Set<string>; // 'background' | 'text' | 'shape' | 'stroke'
}

function buildColorMap(nodes: INode[], frame: INode): Map<string, ColorFreq> {
  const W = frame.width;
  const H = frame.height;
  const areaFrame = W * H;
  const map = new Map<string, ColorFreq>();

  const add = (hex: string, area: number, context: string) => {
    hex = hex.toLowerCase();
    const existing = map.get(hex);
    if (existing) {
      existing.count++;
      existing.totalArea += area;
      existing.contexts.add(context);
    } else {
      map.set(hex, { hex, count: 1, totalArea: area, contexts: new Set([context]) });
    }
  };

  for (const node of nodes) {
    const b = getBoundsInFrame(node, frame);
    const area = (b.w * b.h) / areaFrame;

    // Fills
    const solidFills = extractSolidFills(node);
    for (const f of solidFills) {
      const context = node.type === NodeType.Text ? 'text' :
        area > 0.5 ? 'background' : 'shape';
      add(f.hex, area, context);
    }

    // Strokes
    if (node.strokes) {
      const strokes = node.strokes;
      if (Array.isArray(strokes)) {
        for (const s of strokes) {
          if (s.type === 'SOLID' && s.visible !== false) {
            const c = (s as ISolidPaint).color;
            add(rgbToHex(c.r, c.g, c.b), area * 0.1, 'stroke');
          }
        }
      }
    }
  }

  return map;
}

function deriveColors(colorMap: Map<string, ColorFreq>): DesignSystemColors {
  const sorted = [...colorMap.values()].sort((a, b) => b.totalArea - a.totalArea);
  const roles = new Map<string, string>();
  const used = new Set<string>();

  // Background = largest area color
  const bgCandidate = sorted.find(c => c.contexts.has('background'));
  const background = bgCandidate?.hex;
  if (background) { roles.set('background', background); used.add(background); }

  // Text color = most frequent text-context color that CONTRASTS with background.
  // In dark themes, text must be light; in light themes, text must be dark.
  const bgIsDark = background ? hexLuminance(background) < 0.4 : false;
  const textCandidates = sorted
    .filter(c => c.contexts.has('text'))
    .filter(c => {
      // Text must contrast with background
      if (!background) return true;
      const textLight = hexLuminance(c.hex) > 0.4;
      return bgIsDark ? textLight : !textLight;
    })
    .sort((a, b) => b.count - a.count);
  const text = textCandidates[0]?.hex;
  if (text) { roles.set('text', text); used.add(text); }

  // Primary = most saturated shape color (brand colors are vivid, saturation > 0.15)
  const shapeCandidates = sorted
    .filter(c => c.contexts.has('shape') && !used.has(c.hex) && hexSaturation(c.hex) > 0.25)
    .sort((a, b) => hexSaturation(b.hex) - hexSaturation(a.hex));

  const primary = shapeCandidates[0]?.hex;
  if (primary) { roles.set('primary', primary); used.add(primary); }

  // Accent = second vivid shape color (saturation > 0.15, different hue from primary)
  const accent = shapeCandidates.find(c => c.hex !== primary && hexSaturation(c.hex) > 0.25)?.hex;
  if (accent) { roles.set('accent', accent); used.add(accent); }

  // Surface = card/container background — a desaturated color close in luminance to background
  // but distinctly different (slightly elevated). Not text, not vivid.
  const bgLum = background ? hexLuminance(background) : 0.5;
  const surfaceCandidate = sorted.find(c => {
    if (used.has(c.hex)) return false;
    if (c.hex === background) return false;
    if (c.totalArea < 0.005) return false;
    // Must be desaturated (not a brand color)
    if (hexSaturation(c.hex) > 0.25) return false;
    // Must be on the same luminance side as background
    const cLum = hexLuminance(c.hex);
    if (bgIsDark && cLum > 0.5) return false;  // too light for dark theme surface
    if (!bgIsDark && cLum < 0.3) return false;  // too dark for light theme surface
    // Must be different from background (not the same color)
    const lumDiff = Math.abs(cLum - bgLum);
    return lumDiff > 0.01 && lumDiff < 0.3;
  });
  if (surfaceCandidate) { roles.set('surface', surfaceCandidate.hex); used.add(surfaceCandidate.hex); }
  // Fallback surface: derive from background
  if (!roles.has('surface') && background) {
    roles.set('surface', bgIsDark ? lighten(background, 0.08) : darken(background, 0.04));
  }

  // Muted = desaturated secondary text. Must be different from primary text,
  // lower contrast, and preferably a gray (low saturation).
  const mutedCandidates = sorted
    .filter(c => c.contexts.has('text') && !used.has(c.hex))
    .map(c => {
      const sat = hexSaturation(c.hex);
      const lum = hexLuminance(c.hex);
      const contrastToBg = Math.abs(lum - bgLum);
      // Score: low saturation is good, moderate contrast is good (not too high, not too low)
      // Penalize very high luminance (>0.9 = near-white) and very low (<0.1 = near-black)
      const extremePenalty = (lum > 0.9 || lum < 0.1) ? 1 : 0;
      const score = sat + extremePenalty - contrastToBg * 0.3;
      return { c, score };
    })
    .sort((a, b) => a.score - b.score);
  if (mutedCandidates.length > 0) { roles.set('muted', mutedCandidates[0].c.hex); }

  // Border = stroke color, or desaturated color between background and surface
  const borderCandidate = sorted.find(c =>
    c.contexts.has('stroke') && !used.has(c.hex) && hexSaturation(c.hex) < 0.15
  );
  if (borderCandidate) {
    roles.set('border', borderCandidate.hex);
  } else if (background) {
    // Derive: slightly visible against background
    roles.set('border', bgIsDark ? lighten(background, 0.12) : darken(background, 0.08));
  }

  // Add remaining unique colors as numbered roles (skip desaturated near-duplicates)
  let colorIdx = 1;
  for (const c of sorted) {
    if (!used.has(c.hex) && !roles.has(c.hex) && colorIdx <= 5) {
      // Skip colors that are too close to already-assigned roles
      const isDuplicate = [...roles.values()].some(existing => {
        const lumDiff = Math.abs(hexLuminance(c.hex) - hexLuminance(existing));
        const satDiff = Math.abs(hexSaturation(c.hex) - hexSaturation(existing));
        return lumDiff < 0.05 && satDiff < 0.05;
      });
      if (isDuplicate) continue;
      roles.set(`color-${colorIdx}`, c.hex);
      colorIdx++;
    }
  }

  return { primary, background, text, accent, roles };
}

/** Get relative luminance from hex (0-1). Used for contrast-aware role assignment. */
function hexLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Lighten a hex color by amount (0-1). */
function lighten(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const r = Math.min(255, Math.round(parseInt(h.slice(0, 2), 16) + 255 * amount));
  const g = Math.min(255, Math.round(parseInt(h.slice(2, 4), 16) + 255 * amount));
  const b = Math.min(255, Math.round(parseInt(h.slice(4, 6), 16) + 255 * amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/** Darken a hex color by amount (0-1). */
function darken(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const r = Math.max(0, Math.round(parseInt(h.slice(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(h.slice(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(h.slice(4, 6), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/** Get HSL saturation from hex (0-1). Used to identify vivid brand colors. */
function hexSaturation(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return 0;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

// ---------------------------------------------------------------------------
//  Typography extraction
// ---------------------------------------------------------------------------

interface TextMetrics {
  fontSize: number;
  fontWeight: number;
  fontFamily: string;
  lineHeight: number;     // multiplier
  letterSpacing: number;  // px
  area: number;           // relative to frame
  y: number;              // relative top position
  characters: string;
}

function extractTextMetrics(node: INode, frame: INode): TextMetrics | null {
  if (node.type !== NodeType.Text) return null;

  const fontSize = typeof node.fontSize === 'number' ? node.fontSize : null;
  if (!fontSize) return null;

  const b = getBoundsInFrame(node, frame);
  const W = frame.width;
  const H = frame.height;

  let fontWeight = 400;
  // Direct fontWeight property (from HTML importer / StandaloneNode)
  if (node.fontWeight != null) {
    fontWeight = node.fontWeight;
  } else if (node.fontName && node.fontName !== MIXED) {
    const style = ((node.fontName as IFontName).style ?? '').toLowerCase();
    if (/bold/i.test(style)) fontWeight = 700;
    else if (/semi\s*bold/i.test(style)) fontWeight = 600;
    else if (/medium/i.test(style)) fontWeight = 500;
    else if (/light/i.test(style)) fontWeight = 300;
    else if (/thin/i.test(style)) fontWeight = 100;
  }

  const fontFamily = (node.fontName && node.fontName !== MIXED)
    ? (node.fontName as IFontName).family ?? ''
    : '';

  let lineHeight = 1.4;
  if (node.lineHeight && node.lineHeight !== MIXED && typeof node.lineHeight === 'object') {
    const lh = node.lineHeight;
    if (lh.unit === 'PIXELS' && fontSize > 0) {
      lineHeight = lh.value / fontSize;
    } else if (lh.unit === 'PERCENT') {
      lineHeight = lh.value / 100;
    }
  }

  let letterSpacing = 0;
  if (node.letterSpacing && node.letterSpacing !== MIXED && typeof node.letterSpacing === 'object') {
    const ls = node.letterSpacing;
    if (ls.unit === 'PIXELS') {
      letterSpacing = ls.value;
    } else if (ls.unit === 'PERCENT' && fontSize > 0) {
      letterSpacing = (ls.value / 100) * fontSize;
    }
  }

  return {
    fontSize,
    fontWeight,
    fontFamily,
    lineHeight: Math.round(lineHeight * 100) / 100,
    letterSpacing: Math.round(letterSpacing * 100) / 100,
    area: (b.w * b.h) / (W * H),
    y: b.y / H,
    characters: node.characters ?? '',
  };
}

function assignTypographyRoles(metrics: TextMetrics[]): TypographyRule[] {
  if (metrics.length === 0) return [];

  // Sort by fontSize descending
  const sorted = [...metrics].sort((a, b) => b.fontSize - a.fontSize);

  // Classify each text by context BEFORE grouping
  for (const m of sorted) {
    (m as any)._isButton = isButtonText(m);
    (m as any)._isLabel = m.characters.length <= 15 && m.fontWeight >= 500 && m.fontSize <= 14;
  }

  // Separate button/label text from content text
  const buttonTexts = sorted.filter(m => (m as any)._isButton);
  const labelTexts = sorted.filter(m => (m as any)._isLabel && !(m as any)._isButton);
  const contentTexts = sorted.filter(m => !(m as any)._isButton && !(m as any)._isLabel);

  // Group content text by similar fontSize (±15%)
  const groups: TextMetrics[][] = [];
  for (const m of contentTexts) {
    const existing = groups.find(g => {
      const ref = g[0].fontSize;
      return Math.abs(m.fontSize - ref) / ref < 0.15;
    });
    if (existing) existing.push(m);
    else groups.push([m]);
  }

  const rules: TypographyRule[] = [];

  // Assign content roles by size (largest = display, then heading, subhead, body, caption)
  const contentRoles: TypographyRole[] = ['hero', 'title', 'subtitle', 'body', 'caption', 'disclaimer'];

  // Special case: if only 1-2 content groups
  if (groups.length <= 2) {
    // If largest text is >= 40px, it's a hero/display, not just a title
    const isHeroSize = groups[0] && groups[0][0].fontSize >= 40;
    const simple: TypographyRole[] = groups.length === 1
      ? [isHeroSize ? 'hero' : 'title']
      : [isHeroSize ? 'hero' : 'title', 'body'];
    for (let i = 0; i < Math.min(groups.length, simple.length); i++) {
      const rep = groups[i][0];
      rules.push(makeRule(simple[i], rep));
    }
  } else {
    for (let i = 0; i < Math.min(groups.length, contentRoles.length); i++) {
      const rep = groups[i][0];
      let role = contentRoles[i];
      // Hero only if significantly larger than next (≥1.5x)
      if (i === 0 && groups.length >= 3) {
        const ratio = groups[0][0].fontSize / groups[1][0].fontSize;
        if (ratio < 1.5) role = 'title';
      }
      rules.push(makeRule(role, rep));
    }
  }

  // Add button role from detected button text
  if (buttonTexts.length > 0) {
    const rep = buttonTexts[0];
    rules.push(makeRule('button', rep));
  }

  // Add caption from label text if not already assigned
  if (labelTexts.length > 0 && !rules.some(r => r.role === 'caption')) {
    const rep = labelTexts[0];
    rules.push(makeRule('caption', rep));
  }

  return rules;
}

/** Detect button text: short text with high weight, small font, typically in UI controls. */
function isButtonText(m: TextMetrics): boolean {
  // Button text is SMALL (never hero-sized), short, and bold
  if (m.fontSize > 20) return false;    // hero/heading text is NOT a button
  if (m.characters.length > 25) return false;
  if (m.fontWeight < 500) return false;
  // Check for common button words (only for small text)
  const lower = m.characters.toLowerCase().trim();
  const buttonWords = /^(get started|sign up|subscribe|buy|shop|learn more|try free|start|join|download|install|contact|book|order|add to|checkout|register|launch|log in|sign in|cancel|delete|save|send|share|confirm|submit|apply)/;
  if (buttonWords.test(lower)) return true;
  // Short + bold + small = likely button
  if (m.characters.length <= 15 && m.fontWeight >= 600 && m.fontSize <= 16) return true;
  return false;
}

function makeRule(role: TypographyRole, m: TextMetrics): TypographyRule {
  return {
    role,
    fontFamily: m.fontFamily || undefined,
    fontSize: m.fontSize,
    fontWeight: m.fontWeight,
    lineHeight: m.lineHeight,
    letterSpacing: m.letterSpacing,
  };
}

// ---------------------------------------------------------------------------
//  Component extraction
// ---------------------------------------------------------------------------

function extractButtonSpec(nodes: INode[], frame: INode): ButtonSpec | undefined {
  const W = frame.width;
  const H = frame.height;
  const areaFrame = W * H;

  // Score candidates by button-likelihood
  let bestScore = 0;
  let bestSpec: ButtonSpec | undefined;

  for (const node of nodes) {
    if (node.type !== NodeType.Frame && node.type !== NodeType.Component) continue;
    const b = getBoundsInFrame(node, frame);
    const area = (b.w * b.h) / areaFrame;
    if (area < 0.002 || area > 0.4) continue;

    const hasText = node.children?.some(c => (c as INode).type === NodeType.Text);
    if (!hasText) continue;

    // Score this candidate
    let score = 0;

    // Has border radius → strong signal
    const cr = node.cornerRadius;
    const crNum = (cr !== MIXED && typeof cr === 'number') ? cr : 0;
    if (crNum > 0) score += 3;

    // Has background fill (not transparent) → strong signal
    const fills = extractSolidFills(node);
    if (fills.length > 0 && fills[0].opacity > 0.5) score += 2;

    // Name contains button/btn/cta → very strong
    const name = (node.name ?? '').toLowerCase();
    if (/button|btn|cta/i.test(name)) score += 5;

    // Small, wide aspect ratio → button-like
    const aspect = b.w / (b.h || 1);
    if (aspect > 1.5 && aspect < 10 && area < 0.15) score += 2;

    // Short text content → button-like
    const textChild = node.children?.find(c => (c as INode).type === NodeType.Text) as INode | undefined;
    if (textChild && (textChild.characters ?? '').length < 25) score += 1;

    if (score > bestScore && score >= 3) {
      bestScore = score;
      const radius = crNum;
      let style: ButtonStyle = 'rounded';
      if (radius >= 100 || radius >= Math.min(b.w, b.h) / 2 - 2) style = 'pill';
      else if (radius === 0) style = 'square';
      bestSpec = { borderRadius: radius, style };
    }
  }

  return bestSpec;
}

// ---------------------------------------------------------------------------
//  Spacing detection
// ---------------------------------------------------------------------------

/** Detect the base spacing unit by analyzing gaps between sibling elements. */
function detectSpacingUnit(nodes: INode[], frame: INode): number {
  const gaps: number[] = [];

  // For each frame/group node, look at gaps between consecutive children
  for (const node of nodes) {
    if (node.type !== NodeType.Frame && node.type !== NodeType.Group) continue;
    const children = node.children;
    if (!children || children.length < 2) continue;

    // Get bounds of children sorted by position
    const childBounds = children
      .map(c => {
        const child = c as INode;
        return { y: child.y ?? 0, x: child.x ?? 0, h: child.height ?? 0, w: child.width ?? 0 };
      })
      .filter(b => b.w > 0 && b.h > 0);

    // Vertical gaps
    const sortedY = [...childBounds].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sortedY.length; i++) {
      const gap = sortedY[i].y - (sortedY[i - 1].y + sortedY[i - 1].h);
      if (gap > 0 && gap < 200) gaps.push(Math.round(gap));
    }

    // Horizontal gaps
    const sortedX = [...childBounds].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sortedX.length; i++) {
      const gap = sortedX[i].x - (sortedX[i - 1].x + sortedX[i - 1].w);
      if (gap > 0 && gap < 200) gaps.push(Math.round(gap));
    }
  }

  if (gaps.length === 0) return 8; // safe default

  // Find the GCD of the most common gaps as spacing unit
  const freq = new Map<number, number>();
  for (const g of gaps) {
    freq.set(g, (freq.get(g) ?? 0) + 1);
  }

  // Sort by frequency, take top values
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const topGaps = sorted.slice(0, 5).map(([g]) => g);

  if (topGaps.length === 0) return 8;

  // Find GCD of top gaps
  let result = topGaps[0];
  for (let i = 1; i < topGaps.length; i++) {
    result = gcd(result, topGaps[i]);
  }

  // Clamp to reasonable range (4-32px)
  return Math.max(4, Math.min(32, result || 8));
}

function gcd(a: number, b: number): number {
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

// ---------------------------------------------------------------------------
//  Main extractor
// ---------------------------------------------------------------------------

/**
 * Extract a DesignSystem from a Figma frame by analyzing its visual properties.
 *
 * @param frame - The banner/design frame to analyze
 * @param brandName - Optional brand name (defaults to frame name)
 * @returns DesignSystem with extracted typography, colors, components, layout rules
 */
export function extractDesignSystemFromFrame(frame: INode, brandName?: string): DesignSystem {
  // Include the frame itself — its fills contain the background color
  const allNodes = collectAllDescendants(frame);

  // Colors
  const colorMap = buildColorMap(allNodes, frame);
  const colors = deriveColors(colorMap);

  // Typography
  const textMetrics: TextMetrics[] = [];
  for (const node of allNodes) {
    const m = extractTextMetrics(node, frame);
    if (m) textMetrics.push(m);
  }
  const hierarchy = assignTypographyRoles(textMetrics);

  // Components
  const button = extractButtonSpec(allNodes, frame);

  // Layout: derive spacing unit from actual gaps between sibling elements
  const spacingUnit = detectSpacingUnit(allNodes, frame);

  // Border radius scale from observed values
  const radii = new Set<number>();
  for (const node of allNodes) {
    const cr = node.cornerRadius;
    if (typeof cr === 'number' && cr >= 0 && cr < 10000) {
      radii.add(cr);
    }
  }
  const borderRadiusScale = [...radii].sort((a, b) => a - b);
  if (borderRadiusScale.length === 0) borderRadiusScale.push(0, 4, 8);

  return {
    brand: brandName ?? frame.name ?? 'Extracted',
    colors,
    typography: { hierarchy },
    components: { button },
    layout: {
      spacingUnit,
      borderRadiusScale,
    },
    responsive: {
      breakpoints: [],
      typographyOverrides: [],
    },
  };
}
