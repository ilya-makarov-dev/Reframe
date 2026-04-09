/**
 * DesignSystem exporter — generates DESIGN.md from extracted DesignSystem.
 *
 * DESIGN.md is brand CONTEXT, not a template. It tells the AI:
 *   - WHAT colors, fonts, spacing to use (Theme, Typography, Spacing)
 *   - HOW components look (Components)
 *   - WHAT to avoid (Rules)
 *
 * It does NOT tell the AI how to structure layouts — that's the AI's job.
 * The AI creates unique designs, reframe validates them.
 */

import type { DesignSystem } from './types';

export function exportDesignMd(ds: DesignSystem): string {
  const s: string[] = [];
  const brand = ds.brand || 'Brand';
  const bg = ds.colors.background ?? '#ffffff';
  const isDark = isColorDark(bg);
  const primary = ds.colors.primary ?? '#6366f1';
  const text = ds.colors.text ?? (isDark ? '#fafafa' : '#111827');
  const muted = ds.colors.roles.get('muted') ?? (isDark ? '#71717a' : '#6b7280');
  const surface = ds.colors.roles.get('surface') ?? (isDark ? '#111827' : '#f9fafb');
  const border = ds.colors.roles.get('border') ?? (isDark ? '#27272a' : '#e5e7eb');
  const unit = ds.layout.spacingUnit || 8;
  const fontFamily = ds.typography.hierarchy[0]?.fontFamily ?? 'Inter';
  const heroWeight = ds.typography.hierarchy[0]?.fontWeight ?? 700;
  const btnRadius = ds.components.button?.borderRadius ?? 8;
  const cardRadius = ds.components.card?.borderRadius ?? 12;
  const radiusScale = ds.layout.borderRadiusScale.length > 0
    ? ds.layout.borderRadiusScale
    : [0, 4, 8, 12, 16, 9999];

  // ── Brand ──
  s.push(`# ${brand}`);
  s.push('');

  // ── Atmosphere (mood, not instructions) ──
  s.push('## Atmosphere');
  s.push('');
  const weightVibe = heroWeight <= 400
    ? 'Light type — luxury, editorial restraint.'
    : heroWeight <= 500
    ? 'Medium type — precision with warmth.'
    : 'Bold type — direct, commanding.';
  const themeVibe = isDark
    ? 'Dark foundation. Content and color lead.'
    : 'Light foundation. Clean, open, focused.';
  s.push(`${themeVibe} ${weightVibe}`);
  s.push('');

  // ── Theme (extracted colors) ──
  s.push('## Theme');
  s.push('');
  s.push('```');
  s.push(`fills.primary:    ${primary}`);
  s.push(`fills.background: ${bg}`);
  s.push(`fills.surface:    ${surface}`);
  s.push(`fills.text:       ${text}`);
  s.push(`fills.muted:      ${muted}`);
  s.push(`fills.border:     ${border}`);
  for (const [role, hex] of ds.colors.roles) {
    if (['primary', 'background', 'surface', 'text', 'muted', 'border'].includes(role)) continue;
    if (role.startsWith('color-')) continue;
    s.push(`fills.${role}:${' '.repeat(Math.max(1, 14 - role.length - 6))}${hex}`);
  }
  s.push('```');
  s.push('');

  // ── Typography (extracted) ──
  s.push('## Typography');
  s.push('');
  s.push('```');
  if (ds.typography.hierarchy.length > 0) {
    for (const r of ds.typography.hierarchy) {
      const roleName = mapTypoRole(r.role);
      const parts = [
        `fontSize ${r.fontSize}`,
        `fontWeight ${r.fontWeight}`,
        `lineHeight ${r.lineHeight}`,
        `letterSpacing ${r.letterSpacing}`,
      ];
      if (r.fontFamily && r.fontFamily !== fontFamily) {
        parts.push(`fontFamily "${r.fontFamily}"`);
      }
      s.push(`${roleName}:${' '.repeat(Math.max(1, 11 - roleName.length))}${parts.join('  ')}`);
    }
  }
  s.push('```');
  s.push('');

  // ── Spacing (derived from unit) ──
  s.push('## Spacing');
  s.push('');
  s.push('```');
  s.push(`unit: ${unit}`);
  s.push(`scale: ${unit * 0.5}  ${unit}  ${unit * 2}  ${unit * 3}  ${unit * 4}  ${unit * 6}  ${unit * 8}  ${unit * 10}  ${unit * 16}  ${unit * 20}`);
  s.push('```');
  s.push('');

  // ── Radius (extracted) ──
  s.push('## Radius');
  s.push('');
  s.push('```');
  s.push(`scale: ${radiusScale.join('  ')}`);
  s.push(`button: ${btnRadius}  card: ${cardRadius}  badge: 9999`);
  s.push('```');
  s.push('');

  // ── Depth ──
  s.push('## Depth');
  s.push('');
  s.push('```');
  if (ds.depth && ds.depth.elevationLevels.length > 0) {
    ds.depth.elevationLevels.forEach((layers, i) => {
      if (layers.length === 0) {
        s.push(`level.${i}: none`);
      } else {
        const shadowStr = layers.map(l => `shadow(${l.offsetX}, ${l.offsetY}, ${l.blur}, ${l.spread}, ${l.color})`).join(' ');
        s.push(`level.${i}: ${shadowStr}`);
      }
    });
  } else {
    s.push('level.0: none');
    s.push('level.1: shadow(0, 1, 3, 0, rgba(0,0,0,0.1))');
    s.push('level.2: shadow(0, 4, 12, 0, rgba(0,0,0,0.15))');
    s.push('level.3: shadow(0, 8, 32, 0, rgba(0,0,0,0.2))');
  }
  s.push('```');
  s.push('');

  // ── Components (specs, not layout templates) ──
  s.push('## Components');
  s.push('');
  s.push('```');
  s.push('button.filled:');
  s.push(`  fills [${primary}]  cornerRadius ${btnRadius}  pad [12, 24]  minHeight 44`);
  s.push(`  text: fills [#ffffff]  fontWeight ${ds.components.button?.fontWeight ?? 600}`);
  s.push('');
  s.push('button.outline:');
  s.push(`  fills []  strokes [${primary}]  cornerRadius ${btnRadius}  pad [12, 24]  minHeight 44`);
  s.push(`  text: fills [${primary}]  fontWeight 500`);
  s.push('');
  s.push('card:');
  s.push(`  fills [${surface}]  cornerRadius ${cardRadius}  pad 24  gap 16`);
  s.push('');
  s.push('badge:');
  s.push(`  fills [rgba(${hexToRgbStr(primary)}, 0.1)]  cornerRadius 9999  pad [4, 12]`);
  s.push(`  text: fontSize 12  fontWeight 500  fills [${primary}]`);
  s.push('');
  s.push('divider:');
  s.push(`  fills [${border}]  height 1`);
  s.push('```');
  s.push('');

  // ── Color Strategy ──
  s.push('## Color Strategy');
  s.push('');
  s.push('```');
  s.push(`approach: ${isDark ? 'dark' : 'light'}`);
  if (isDark) {
    s.push(`elevation: luminance stacking (${bg} → ${surface} → rgba(255,255,255,0.05))`);
  }
  s.push(`semantic: info #3b82f6  success #10b981  warning #f59e0b  error #ef4444`);
  s.push('```');
  s.push('');

  // ── Rules (constraints, not templates) ──
  s.push('## Rules');
  s.push('');
  s.push('```');
  s.push('do:');
  s.push(`  - Spacing multiples of ${unit}`);
  s.push('  - Touch targets min 44px');
  s.push('  - Contrast 4.5:1 body, 3:1 large text');
  s.push('  - Explicit fills on every container and text');
  s.push('  - cornerRadius from scale only');
  s.push('  - Colors from theme only');
  s.push('');
  s.push('dont:');
  s.push('  - Colors outside palette');
  s.push('  - Weights outside typography table');
  s.push('  - cornerRadius outside scale');
  s.push('```');
  s.push('');

  return s.join('\n');
}

// ── Helpers ──────────────────────────────────────────────────

function isColorDark(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  return (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000 < 128;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace('#', '');
  if (h.length < 6) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function hexToRgbStr(hex: string): string {
  const rgb = hexToRgb(hex);
  return rgb ? `${rgb.r},${rgb.g},${rgb.b}` : '99,102,241';
}

function mapTypoRole(role: string): string {
  switch (role) {
    case 'hero': return 'display';
    case 'title': return 'heading';
    case 'subtitle': return 'subhead';
    case 'body': return 'body';
    case 'caption': return 'caption';
    case 'disclaimer': return 'caption';
    case 'button': return 'button';
    default: return role;
  }
}
