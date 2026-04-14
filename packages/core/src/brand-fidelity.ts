/**
 * Brand Fidelity Score — single 0-100 metric for brand compliance.
 *
 * Measures how well a design matches its DESIGN.md specification:
 * - Token coverage (% of brand palette/scale used vs custom values)
 * - Spacing adherence (gaps/padding from scale, not magic numbers)
 * - Typography hierarchy (sizes/weights match spec roles)
 * - Color role consistency (palette colors used correctly)
 * - Component spec match (buttons/cards/badges match DESIGN.md variants)
 *
 * Different from audit (pass/fail rules) and aesthetic (brand-independent).
 * This is "how well does this design follow the brand?" as a number.
 */

import type { INode, IPaint, ISolidPaint } from './host/types';
import { NodeType, MIXED } from './host/types';
import type { DesignSystem } from './design-system/types';

// ─── Types ────────────────────────────────────────────────────

export interface BrandFidelityBreakdown {
  /** What % of node colors come from the brand palette (0-1). */
  colorCompliance: number;
  /** What % of text nodes match a typography role (0-1). */
  typographyCompliance: number;
  /** What % of spacing values are on the spacing scale (0-1). */
  spacingCompliance: number;
  /** What % of border radii are on the radius scale (0-1). */
  radiusCompliance: number;
  /** How well components match their specs (0-1). */
  componentCompliance: number;
  /** How many of the brand's color roles are actually used (0-1). */
  paletteUsage: number;
}

export interface BrandFidelityResult {
  /** Composite score 0-100. */
  score: number;
  /** Per-dimension breakdown (each 0-1). */
  breakdown: BrandFidelityBreakdown;
  /** Rating string. */
  rating: 'Poor' | 'Fair' | 'Good' | 'Excellent';
  /** Total nodes analyzed. */
  totalNodes: number;
  /** Summary of worst dimensions. */
  weakest: string[];
}

// ─── Weights ──────────────────────────────────────────────────

const WEIGHTS = {
  colorCompliance: 0.25,
  typographyCompliance: 0.20,
  spacingCompliance: 0.20,
  radiusCompliance: 0.10,
  componentCompliance: 0.15,
  paletteUsage: 0.10,
};

// ─── Helpers ──────────────────────────────────────────────────

function hexNormalize(hex: string): string {
  let h = hex.replace('#', '').toLowerCase();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length === 8) h = h.slice(0, 6); // strip alpha
  return h;
}

function colorDistance(a: string, b: string): number {
  const ha = hexNormalize(a);
  const hb = hexNormalize(b);
  const r1 = parseInt(ha.slice(0, 2), 16);
  const g1 = parseInt(ha.slice(2, 4), 16);
  const b1 = parseInt(ha.slice(4, 6), 16);
  const r2 = parseInt(hb.slice(0, 2), 16);
  const g2 = parseInt(hb.slice(2, 4), 16);
  const b2 = parseInt(hb.slice(4, 6), 16);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

function extractSolidColor(paint: IPaint): string | null {
  if (paint.type !== 'SOLID') return null;
  const sp = paint as ISolidPaint;
  if (!sp.color) return null;
  const { r, g, b } = sp.color;
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function isOnScale(value: number, scale: number[], tolerance = 1): boolean {
  if (value === 0) return true; // zero spacing is always valid
  return scale.some(s => Math.abs(value - s) <= tolerance);
}

function collectNodes(root: INode): INode[] {
  const nodes: INode[] = [];
  function walk(node: INode) {
    nodes.push(node);
    if (node.children) {
      for (const child of node.children) walk(child);
    }
  }
  walk(root);
  return nodes;
}

// ─── Dimension scorers ────────────────────────────────────────

function scoreColorCompliance(nodes: INode[], ds: DesignSystem): number {
  const paletteColors = Array.from(ds.colors.roles.values());
  if (paletteColors.length === 0) return 1;

  let checked = 0;
  let compliant = 0;

  for (const node of nodes) {
    const fills = node.fills;
    if (!fills || fills === MIXED) continue;
    for (const fill of fills as IPaint[]) {
      const hex = extractSolidColor(fill);
      if (!hex) continue;
      checked++;
      // Color is compliant if close to any palette color (distance < 20)
      const match = paletteColors.some(pc => colorDistance(hex, pc) < 20);
      if (match) compliant++;
    }
  }

  return checked === 0 ? 1 : compliant / checked;
}

function scoreTypographyCompliance(nodes: INode[], ds: DesignSystem): number {
  const textNodes = nodes.filter(n => n.type === NodeType.Text && typeof n.fontSize === 'number' && n.fontSize > 0);
  if (textNodes.length === 0) return 1;

  const allowedSizes = ds.typography.allSizes ?? ds.typography.hierarchy.map(h => h.fontSize);
  if (allowedSizes.length === 0) return 1;

  let compliant = 0;
  for (const node of textNodes) {
    const fontSize = node.fontSize as number;
    // ±10% tolerance
    const match = allowedSizes.some(s => {
      const ratio = fontSize / s;
      return ratio >= 0.9 && ratio <= 1.1;
    });
    if (match) compliant++;
  }

  return compliant / textNodes.length;
}

function scoreSpacingCompliance(nodes: INode[], ds: DesignSystem): number {
  const scale = ds.layout.spacingScale;
  if (!scale || scale.length === 0) return 1;

  let checked = 0;
  let onScale = 0;

  for (const node of nodes) {
    const spacingValues = [
      node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft,
      node.itemSpacing,
    ].filter((v): v is number => typeof v === 'number' && v > 0);

    for (const val of spacingValues) {
      checked++;
      // Allow section-level padding range if defined
      const sectionRange = ds.layout.sectionPaddingRange;
      if (sectionRange && val >= sectionRange[0] && val <= sectionRange[1]) {
        onScale++;
      } else if (isOnScale(val, scale, 2)) {
        onScale++;
      }
    }
  }

  return checked === 0 ? 1 : onScale / checked;
}

function scoreRadiusCompliance(nodes: INode[], ds: DesignSystem): number {
  const scale = ds.layout.borderRadiusScale;
  if (!scale || scale.length === 0) return 1;

  let checked = 0;
  let onScale = 0;

  for (const node of nodes) {
    const cr = node.cornerRadius;
    if (typeof cr !== 'number' || cr === 0) continue;
    checked++;
    if (isOnScale(cr, scale, 1)) onScale++;
  }

  return checked === 0 ? 1 : onScale / checked;
}

function scoreComponentCompliance(nodes: INode[], ds: DesignSystem): number {
  if (!ds.components) return 1;

  let checked = 0;
  let compliant = 0;

  const buttonSpec = ds.components.button;
  const cardSpec = ds.components.card;
  const badgeSpec = ds.components.badge;
  const inputSpec = ds.components.input;

  for (const node of nodes) {
    const role = (node as any).semanticRole as string | undefined;

    // Button compliance
    if (role === 'button' && buttonSpec) {
      checked++;
      let score = 0;
      let checks = 0;
      // Border radius
      if (typeof node.cornerRadius === 'number') {
        checks++;
        const expectedR = buttonSpec.borderRadius;
        if (Math.abs((node.cornerRadius as number) - expectedR) <= 2 || expectedR === 9999 && (node.cornerRadius as number) >= 100) score++;
      }
      // Min height (44px WCAG)
      if (node.height >= 44) { checks++; score++; }
      else { checks++; }

      if (checks > 0) compliant += score / checks;
    }

    // Card compliance
    if (role === 'card' && cardSpec) {
      checked++;
      let score = 0;
      let checks = 0;
      if (typeof node.cornerRadius === 'number') {
        checks++;
        if (Math.abs((node.cornerRadius as number) - cardSpec.borderRadius) <= 2) score++;
      }
      if (checks > 0) compliant += score / checks;
    }

    // Badge compliance
    if (role === 'badge' && badgeSpec) {
      checked++;
      let score = 0;
      let checks = 0;
      if (typeof node.cornerRadius === 'number') {
        checks++;
        if (Math.abs((node.cornerRadius as number) - badgeSpec.borderRadius) <= 2) score++;
      }
      if (checks > 0) compliant += score / checks;
    }

    // Input compliance
    if (role === 'input' && inputSpec) {
      checked++;
      let score = 0;
      let checks = 0;
      if (typeof node.cornerRadius === 'number') {
        checks++;
        if (Math.abs((node.cornerRadius as number) - inputSpec.borderRadius) <= 2) score++;
      }
      if (checks > 0) compliant += score / checks;
    }
  }

  return checked === 0 ? 1 : compliant / checked;
}

function scorePaletteUsage(nodes: INode[], ds: DesignSystem): number {
  const paletteColors = Array.from(ds.colors.roles.values());
  if (paletteColors.length === 0) return 1;

  const usedColors = new Set<string>();
  for (const node of nodes) {
    const fills = node.fills;
    if (!fills || fills === MIXED) continue;
    for (const fill of fills as IPaint[]) {
      const hex = extractSolidColor(fill);
      if (!hex) continue;
      for (const pc of paletteColors) {
        if (colorDistance(hex, pc) < 20) {
          usedColors.add(hexNormalize(pc));
        }
      }
    }
  }

  // At least use the primary colors (bg, text, primary, accent)
  const coreRoles = ['primary', 'background', 'text', 'accent'].filter(r => ds.colors.roles.has(r));
  if (coreRoles.length === 0) return usedColors.size / paletteColors.length;

  const coreUsed = coreRoles.filter(r => {
    const hex = ds.colors.roles.get(r)!;
    return usedColors.has(hexNormalize(hex));
  });

  // 70% weight on core roles, 30% on total usage
  const coreScore = coreRoles.length > 0 ? coreUsed.length / coreRoles.length : 1;
  const totalScore = Math.min(1, usedColors.size / Math.min(paletteColors.length, 8));
  return coreScore * 0.7 + totalScore * 0.3;
}

// ─── Main ─────────────────────────────────────────────────────

export function computeBrandFidelity(root: INode, ds: DesignSystem): BrandFidelityResult {
  const nodes = collectNodes(root);

  const breakdown: BrandFidelityBreakdown = {
    colorCompliance: scoreColorCompliance(nodes, ds),
    typographyCompliance: scoreTypographyCompliance(nodes, ds),
    spacingCompliance: scoreSpacingCompliance(nodes, ds),
    radiusCompliance: scoreRadiusCompliance(nodes, ds),
    componentCompliance: scoreComponentCompliance(nodes, ds),
    paletteUsage: scorePaletteUsage(nodes, ds),
  };

  const score = Math.round(
    (breakdown.colorCompliance * WEIGHTS.colorCompliance +
     breakdown.typographyCompliance * WEIGHTS.typographyCompliance +
     breakdown.spacingCompliance * WEIGHTS.spacingCompliance +
     breakdown.radiusCompliance * WEIGHTS.radiusCompliance +
     breakdown.componentCompliance * WEIGHTS.componentCompliance +
     breakdown.paletteUsage * WEIGHTS.paletteUsage) * 100,
  );

  const clamped = Math.max(0, Math.min(100, score));

  // Find weakest dimensions
  const dims = Object.entries(breakdown) as [keyof BrandFidelityBreakdown, number][];
  const weakest = dims
    .filter(([, v]) => v < 0.7)
    .sort((a, b) => a[1] - b[1])
    .map(([k, v]) => `${k}: ${Math.round(v * 100)}%`);

  let rating: BrandFidelityResult['rating'];
  if (clamped >= 85) rating = 'Excellent';
  else if (clamped >= 70) rating = 'Good';
  else if (clamped >= 50) rating = 'Fair';
  else rating = 'Poor';

  return {
    score: clamped,
    breakdown,
    rating,
    totalNodes: nodes.length,
    weakest,
  };
}

/** Format brand fidelity for text output (MCP inspect report). */
export function formatBrandFidelity(result: BrandFidelityResult): string {
  const lines: string[] = [];
  lines.push(`Brand Fidelity: ${result.score}/100 (${result.rating})`);
  lines.push(`  Color compliance:     ${pct(result.breakdown.colorCompliance)}`);
  lines.push(`  Typography compliance: ${pct(result.breakdown.typographyCompliance)}`);
  lines.push(`  Spacing compliance:   ${pct(result.breakdown.spacingCompliance)}`);
  lines.push(`  Radius compliance:    ${pct(result.breakdown.radiusCompliance)}`);
  lines.push(`  Component compliance: ${pct(result.breakdown.componentCompliance)}`);
  lines.push(`  Palette usage:        ${pct(result.breakdown.paletteUsage)}`);
  if (result.weakest.length > 0) {
    lines.push(`  Weakest: ${result.weakest.join(', ')}`);
  }
  return lines.join('\n');
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
