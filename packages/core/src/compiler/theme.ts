import type { DesignSystem } from '../design-system/types.js';
import { findTypographyForSlot, getButtonBorderRadius } from '../design-system/index.js';
import type { ResolvedTheme } from './types.js';

export function resolveTheme(ds: DesignSystem, width: number, height: number): ResolvedTheme {
  // Resolve typography for each slot
  const heroTypo = findTypographyForSlot(ds, 'title');
  const subTypo = findTypographyForSlot(ds, 'description');
  const bodyTypo = subTypo; // reuse description slot
  const btnTypo = findTypographyForSlot(ds, 'button') ?? findTypographyForSlot(ds, 'description');
  const disclaimerTypo = findTypographyForSlot(ds, 'disclaimer');

  // Scale typography for target size
  const scale = computeScale(width, height);
  const heroSize = scaleFont(heroTypo?.fontSize ?? 48, scale);
  const subSize = scaleFont(subTypo?.fontSize ?? 18, scale);
  const bodySize = scaleFont(bodyTypo?.fontSize ?? 16, scale);
  const btnSize = Math.max(13, scaleFont(btnTypo?.fontSize ?? 16, scale));
  const disclaimerSize = scaleFont(disclaimerTypo?.fontSize ?? 10, scale);

  // Resolve colors (validated)
  const bg = ds.colors.background ?? '#FFFFFF';
  const textColor = ds.colors.text ?? '#1A1A1A';
  const primary = ds.colors.primary ?? '#0071E3';
  const accent = ds.colors.accent ?? primary;
  const btnRadius = getButtonBorderRadius(ds);
  const spacing = ds.layout.spacingUnit || 8;

  // Font families
  const heroFont = heroTypo?.fontFamily ?? 'Inter';
  const bodyFont = subTypo?.fontFamily ?? heroFont;

  return {
    bg, textColor, primary, accent, btnRadius, spacing,
    heroSize, subSize, bodySize, btnSize, disclaimerSize,
    heroFont, bodyFont,
    heroWeight: heroTypo?.fontWeight ?? 700,
    subWeight: subTypo?.fontWeight ?? 400,
    btnWeight: btnTypo?.fontWeight ?? 600,
  };
}

/** Compute a scale factor based on canvas area relative to a reference 1080x1080. */
function computeScale(w: number, h: number): number {
  const area = w * h;
  const ref = 1080 * 1080;
  return Math.max(0.4, Math.min(2.0, Math.sqrt(area / ref)));
}

/** Scale a font size, round to integer, clamp minimum. */
function scaleFont(base: number, scale: number): number {
  return Math.max(8, Math.round(base * scale));
}
