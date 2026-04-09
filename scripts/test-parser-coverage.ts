/**
 * Test parser coverage across all getdesign brands.
 *
 * Criteria: primary, background, text, ≥3 typography roles, font family, radius scale.
 * Extended metrics: font features, component variants, hover states, spacing scale, gradients.
 * Usage: npx tsx scripts/test-parser-coverage.ts
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parseDesignMd } from '../packages/core/src/design-system/parser.js';

const BRANDS_DIR = join(__dirname, '..', '.reframe', 'brands');

interface Result {
  brand: string;
  ok: boolean;
  missing: string[];
  // Core
  typoRoles: number;
  fontFamily: string | undefined;
  radiusScale: number[];
  colorRoles: number;
  // Extended
  fontFeatures: number;
  buttonVariants: number;
  hasCard: boolean;
  hasBadge: boolean;
  hasInput: boolean;
  hasNav: boolean;
  spacingScale: number;
  gradients: number;
  shadows: number;
  hoverStates: number;
}

const results: Result[] = [];

const slugs = readdirSync(BRANDS_DIR).filter(d => {
  return existsSync(join(BRANDS_DIR, d, 'DESIGN.md'));
});

for (const slug of slugs) {
  const md = readFileSync(join(BRANDS_DIR, slug, 'DESIGN.md'), 'utf-8');
  const ds = parseDesignMd(md);

  const missing: string[] = [];

  if (!ds.colors.primary) missing.push('primary');
  if (!ds.colors.background) missing.push('background');
  if (!ds.colors.text) missing.push('text');

  const typoRoles = ds.typography.hierarchy.length;
  if (typoRoles < 3) missing.push(`typography(${typoRoles}/3)`);

  const fontFamily = ds.typography.hierarchy.find(r => r.fontFamily)?.fontFamily;
  if (!fontFamily) missing.push('fontFamily');

  const radiusScale = ds.layout.borderRadiusScale;
  if (!radiusScale || radiusScale.length < 2) missing.push('radiusScale');

  // Count hover states across components
  let hoverStates = 0;
  if (ds.components.button?.variants) {
    for (const v of ds.components.button.variants) {
      if (v.hover) hoverStates++;
    }
  }
  if (ds.components.card?.hover) hoverStates++;

  results.push({
    brand: slug,
    ok: missing.length === 0,
    missing,
    typoRoles,
    fontFamily,
    radiusScale,
    colorRoles: ds.colors.roles.size,
    fontFeatures: ds.typography.fontFeatures?.length ?? 0,
    buttonVariants: ds.components.button?.variants?.length ?? 0,
    hasCard: !!ds.components.card,
    hasBadge: !!ds.components.badge,
    hasInput: !!ds.components.input,
    hasNav: !!ds.components.nav,
    spacingScale: ds.layout.spacingScale?.length ?? 0,
    gradients: ds.colors.gradients?.size ?? 0,
    shadows: ds.depth?.elevationLevels?.length ?? 0,
    hoverStates,
  });
}

// Print results
const passed = results.filter(r => r.ok);
const failed = results.filter(r => !r.ok);

console.log(`\n=== PARSER COVERAGE: ${passed.length}/${results.length} ===\n`);

if (failed.length > 0) {
  console.log('FAILED:');
  for (const r of failed) {
    console.log(`  ✗ ${r.brand.padEnd(20)} missing: ${r.missing.join(', ')}`);
  }
  console.log('');
}

console.log('DETAILED:');
for (const r of results) {
  const mark = r.ok ? '✓' : '✗';
  const extras = [
    `colors=${r.colorRoles}`,
    `typo=${r.typoRoles}`,
    r.fontFeatures > 0 ? `ff=${r.fontFeatures}` : '',
    r.buttonVariants > 0 ? `btn=${r.buttonVariants}` : '',
    r.hasCard ? 'card' : '',
    r.hasBadge ? 'badge' : '',
    r.hasInput ? 'input' : '',
    r.hasNav ? 'nav' : '',
    r.spacingScale > 0 ? `space=${r.spacingScale}` : '',
    r.gradients > 0 ? `grad=${r.gradients}` : '',
    r.shadows > 0 ? `shadow=${r.shadows}` : '',
    r.hoverStates > 0 ? `hover=${r.hoverStates}` : '',
  ].filter(Boolean).join(' ');
  console.log(`  ${mark} ${r.brand.padEnd(20)} ${extras}`);
}

// Summary stats
const totalBtnVariants = results.reduce((s, r) => s + r.buttonVariants, 0);
const totalFontFeatures = results.filter(r => r.fontFeatures > 0).length;
const totalCards = results.filter(r => r.hasCard).length;
const totalBadges = results.filter(r => r.hasBadge).length;
const totalInputs = results.filter(r => r.hasInput).length;
const totalNavs = results.filter(r => r.hasNav).length;
const totalSpacing = results.filter(r => r.spacingScale > 0).length;
const totalGradients = results.filter(r => r.gradients > 0).length;
const totalShadows = results.filter(r => r.shadows > 0).length;
const totalHover = results.filter(r => r.hoverStates > 0).length;

console.log(`\n=== SUMMARY ===`);
console.log(`Core:     ${passed.length}/${results.length} pass (primary, bg, text, typo≥3, font, radius)`);
console.log(`Extended:`);
console.log(`  Font features:    ${totalFontFeatures}/${results.length} brands`);
console.log(`  Button variants:  ${totalBtnVariants} total across ${results.filter(r => r.buttonVariants > 0).length} brands`);
console.log(`  Cards:            ${totalCards}/${results.length}`);
console.log(`  Badges:           ${totalBadges}/${results.length}`);
console.log(`  Inputs:           ${totalInputs}/${results.length}`);
console.log(`  Navs:             ${totalNavs}/${results.length}`);
console.log(`  Spacing scale:    ${totalSpacing}/${results.length}`);
console.log(`  Gradients:        ${totalGradients}/${results.length}`);
console.log(`  Shadow levels:    ${totalShadows}/${results.length}`);
console.log(`  Hover states:     ${totalHover}/${results.length}`);

if (failed.length > 0) process.exit(1);
