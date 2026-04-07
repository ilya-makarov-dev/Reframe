/**
 * DesignSystem exporter — generates DESIGN.md markdown from a DesignSystem object.
 *
 * DESIGN.md is not just a config file — it's a PROMPT for AI.
 * The format is designed to be read by AI agents and used as
 * design guidance. Every section informs the AI HOW to design.
 */

import type { DesignSystem } from './types';

export function exportDesignMd(ds: DesignSystem): string {
  const lines: string[] = [];
  const brand = ds.brand || 'Brand';

  lines.push(`# ${brand}`);
  lines.push('');

  // ── 1. Atmosphere ──────────────────────────────────────────
  // This is the most important section for AI — it sets the TONE.
  const bg = ds.colors.background ?? '#ffffff';
  const isDark = isColorDark(bg);
  const primary = ds.colors.primary ?? '#6366f1';
  const btnStyle = ds.components.button?.style ?? 'rounded';
  const heroWeight = ds.typography.hierarchy[0]?.fontWeight ?? 700;
  const fontFamily = ds.typography.hierarchy[0]?.fontFamily ?? 'Inter';

  lines.push('## Visual Atmosphere');
  lines.push('');
  lines.push(`${isDark ? 'Dark' : 'Light'} theme with ${describeColor(primary)} as primary accent. `
    + `Typography uses ${fontFamily} at weight ${heroWeight} for display — `
    + `${heroWeight <= 400 ? 'light and confident, luxury feel' : heroWeight <= 500 ? 'balanced, modern feel' : 'bold and commanding'}. `
    + `${btnStyle === 'pill' ? 'Pill-shaped buttons (9999px radius) for a modern, friendly feel' : btnStyle === 'rounded' ? 'Rounded buttons for approachable, clean UI' : 'Sharp/square buttons for a precise, technical feel'}.`);
  lines.push('');

  // ── 2. Colors ──────────────────────────────────────────────
  lines.push('## Colors');
  lines.push('');
  if (ds.colors.roles.size > 0) {
    lines.push('| Role | Value |');
    lines.push('|------|-------|');
    for (const [role, hex] of ds.colors.roles) {
      lines.push(`| ${role} | ${hex} |`);
    }
  }
  lines.push('');

  // ── 3. Typography ──────────────────────────────────────────
  lines.push('## Typography');
  lines.push('');
  if (ds.typography.hierarchy.length > 0) {
    lines.push('| Role | Size | Weight | Line Height | Letter Spacing | Font |');
    lines.push('|------|------|--------|-------------|----------------|------|');
    for (const rule of ds.typography.hierarchy) {
      lines.push(
        `| ${rule.role} | ${rule.fontSize}px | ${rule.fontWeight} | ${rule.lineHeight} | ${rule.letterSpacing}px | ${rule.fontFamily ?? fontFamily} |`
      );
    }
  }
  lines.push('');

  // ── 4. Components ──────────────────────────────────────────
  if (ds.components.button) {
    lines.push('## Components');
    lines.push('');
    const btn = ds.components.button;
    lines.push('### Button');
    lines.push(`- Border radius: ${btn.borderRadius}px (${btn.style})`);
    lines.push(`- Min height: 44px (touch target)`);
    if (btn.fontWeight) lines.push(`- Font weight: ${btn.fontWeight}`);
    if (btn.textTransform) lines.push(`- Text transform: ${btn.textTransform}`);
    lines.push('');
  }

  // ── 5. Layout ──────────────────────────────────────────────
  lines.push('## Spacing');
  lines.push('');
  lines.push(`- Base unit: ${ds.layout.spacingUnit}px`);
  if (ds.layout.maxWidth) lines.push(`- Max content width: ${ds.layout.maxWidth}px`);
  lines.push(`- Border radius scale: ${ds.layout.borderRadiusScale.join(', ')}px`);
  lines.push('');

  // ── 6. Responsive ──────────────────────────────────────────
  if (ds.responsive.breakpoints.length > 0) {
    lines.push('## Breakpoints');
    lines.push('');
    lines.push('| Name | Width |');
    lines.push('|------|-------|');
    for (const bp of ds.responsive.breakpoints) {
      lines.push(`| ${bp.name} | ${bp.width}px |`);
    }
    lines.push('');
  }

  // ── 7. Design Patterns ─────────────────────────────────────
  // This section teaches AI HOW to compose layouts.
  lines.push('## Patterns');
  lines.push('');
  lines.push(`### Hero Section`);
  lines.push(`- Background: ${isDark ? bg : 'white or gradient'}`);
  lines.push(`- Padding: ${Math.max(80, ds.layout.spacingUnit * 12)}px vertical, ${Math.max(60, ds.layout.spacingUnit * 8)}px horizontal`);
  lines.push(`- Headline: ${ds.typography.hierarchy[0]?.fontSize ?? 56}px, weight ${heroWeight}, centered`);
  lines.push(`- Subtext: ${ds.typography.hierarchy.find(r => r.role === 'body')?.fontSize ?? 18}px, muted color, max-width 600px, centered`);
  lines.push(`- CTA: 1-2 buttons centered, ${ds.layout.spacingUnit * 2}px gap`);
  lines.push('');
  lines.push(`### Card Grid`);
  lines.push(`- 3 columns desktop, 1 mobile`);
  lines.push(`- Card padding: ${ds.layout.spacingUnit * 3}px`);
  lines.push(`- Gap: ${ds.layout.spacingUnit * 2}px between cards`);
  lines.push(`- Each card: heading + body text + optional icon/stat`);
  lines.push('');
  lines.push(`### Dashboard`);
  lines.push(`- Sidebar: 240-280px fixed width, ${isDark ? 'dark' : 'light gray'} background`);
  lines.push(`- Main: flex-grow, padding ${ds.layout.spacingUnit * 4}px`);
  lines.push(`- Stats row: equal-width cards, ${ds.layout.spacingUnit * 2}px gap`);
  lines.push(`- Use subtle shadows for card elevation`);
  lines.push('');
  lines.push(`### Navbar`);
  lines.push(`- Height: 48-64px, ${isDark ? bg : 'white'} background`);
  lines.push(`- Logo left, nav links center or right, CTA button right`);
  lines.push(`- Nav links: ${ds.typography.hierarchy.find(r => r.role === 'caption' || r.role === 'button')?.fontSize ?? 14}px`);
  lines.push('');

  // ── 8. Do's and Don'ts ─────────────────────────────────────
  lines.push('## Rules');
  lines.push('');
  lines.push('### Do');
  lines.push(`- Use ${fontFamily} for all text`);
  lines.push(`- Use weight ${heroWeight} for headlines`);
  lines.push(`- Use ${primary} as the primary accent color`);
  lines.push(`- Keep border-radius within scale: ${ds.layout.borderRadiusScale.slice(0, 5).join(', ')}px`);
  lines.push(`- Spacing must be multiples of ${ds.layout.spacingUnit}px`);
  lines.push(`- Minimum touch target: 44x44px for buttons`);
  lines.push(`- Text contrast: minimum 4.5:1 for body, 3:1 for large text`);
  lines.push('');
  lines.push('### Don\'t');
  lines.push(`- Don't use colors outside the palette`);
  lines.push(`- Don't use font weights not in the typography table`);
  lines.push(`- Don't use pure black (#000000) for text — use ${ds.colors.text ?? '#1a1a1a'}`);
  lines.push(`- Don't make buttons smaller than 44px height`);
  lines.push(`- Don't overcrowd — ${isDark ? 'dark themes need breathing room' : 'use generous whitespace'}`);
  lines.push('');

  return lines.join('\n');
}

// ── Helpers ──────────────────────────────────────────────────

function isColorDark(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

function describeColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if (r > 200 && g < 100 && b < 100) return 'red';
  if (r > 200 && g > 100 && b < 100) return 'orange';
  if (r > 200 && g > 200 && b < 100) return 'yellow';
  if (r < 100 && g > 180 && b < 100) return 'green';
  if (r < 100 && g < 100 && b > 200) return 'blue';
  if (r > 100 && g < 100 && b > 200) return 'purple';
  if (r > 200 && g < 100 && b > 150) return 'pink';
  return 'accent';
}
