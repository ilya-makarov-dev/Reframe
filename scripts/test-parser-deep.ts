/**
 * Deep parser inspection for a single brand — shows EVERYTHING parsed.
 * Usage: npx tsx scripts/test-parser-deep.ts stripe
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { parseDesignMd } from '../packages/core/src/design-system/parser.js';

const slug = process.argv[2] || 'stripe';
const md = readFileSync(join(__dirname, '..', '.reframe', 'brands', slug, 'DESIGN.md'), 'utf-8');
const ds = parseDesignMd(md);

console.log(`\n=== ${ds.brand} ===\n`);

console.log('COLORS:');
console.log(`  primary: ${ds.colors.primary}`);
console.log(`  background: ${ds.colors.background}`);
console.log(`  text: ${ds.colors.text}`);
console.log(`  accent: ${ds.colors.accent}`);
console.log(`  roles (${ds.colors.roles.size}):`);
for (const [name, hex] of ds.colors.roles) {
  console.log(`    ${name}: ${hex}`);
}
if (ds.colors.gradients) {
  console.log(`  gradients (${ds.colors.gradients.size}):`);
  for (const [name, val] of ds.colors.gradients) {
    console.log(`    ${name}: ${val}`);
  }
}

console.log('\nTYPOGRAPHY:');
console.log(`  primaryFont: ${ds.typography.primaryFont}`);
console.log(`  secondaryFont: ${ds.typography.secondaryFont}`);
if (ds.typography.fontFeatures) {
  console.log(`  fontFeatures (${ds.typography.fontFeatures.length}):`);
  for (const ff of ds.typography.fontFeatures) {
    console.log(`    ${ff.tag} [${ff.scope}] ${ff.description || ''}`);
  }
}
console.log(`  hierarchy (${ds.typography.hierarchy.length}):`);
for (const r of ds.typography.hierarchy) {
  const ff = r.fontFeatures ? ` ff=[${r.fontFeatures.join(',')}]` : '';
  const tt = r.textTransform ? ` tt=${r.textTransform}` : '';
  console.log(`    ${r.role.padEnd(12)} ${r.fontSize}px w${r.fontWeight} lh${r.lineHeight} ls${r.letterSpacing} "${r.fontFamily || '-'}"${ff}${tt}`);
}

console.log('\nCOMPONENTS:');
if (ds.components.button) {
  const b = ds.components.button;
  console.log(`  button: radius=${b.borderRadius} style=${b.style} weight=${b.fontWeight} tt=${b.textTransform}`);
  if (b.variants) {
    console.log(`  button variants (${b.variants.length}):`);
    for (const v of b.variants) {
      console.log(`    ${v.name}: bg=${v.background} color=${v.color} radius=${v.borderRadius} weight=${v.fontWeight} px=${v.paddingX} py=${v.paddingY} hover=${JSON.stringify(v.hover)}`);
    }
  }
}
if (ds.components.card) {
  const c = ds.components.card;
  console.log(`  card: radius=${c.borderRadius} bg=${c.background} border=${c.borderColor} shadow=${c.shadowLayers} hover=${JSON.stringify(c.hover)}`);
}
if (ds.components.badge) {
  const b = ds.components.badge;
  console.log(`  badge: radius=${b.borderRadius} bg=${b.background} color=${b.color} size=${b.fontSize} weight=${b.fontWeight} px=${b.paddingX} py=${b.paddingY}`);
}
if (ds.components.input) {
  const i = ds.components.input;
  console.log(`  input: radius=${i.borderRadius} border=${i.borderColor} size=${i.fontSize} height=${i.height} bg=${i.background} focusBorder=${i.focusBorderColor}`);
}
if (ds.components.nav) {
  const n = ds.components.nav;
  console.log(`  nav: height=${n.height} bg=${n.background} size=${n.fontSize} weight=${n.fontWeight} active=${n.activeIndicator}`);
}

console.log('\nLAYOUT:');
console.log(`  spacingUnit: ${ds.layout.spacingUnit}`);
console.log(`  spacingScale: ${ds.layout.spacingScale ? `[${ds.layout.spacingScale.join(', ')}]` : 'none'}`);
console.log(`  maxWidth: ${ds.layout.maxWidth}`);
console.log(`  sectionSpacing: ${ds.layout.sectionSpacing}`);
console.log(`  borderRadiusScale: [${ds.layout.borderRadiusScale.join(', ')}]`);

console.log('\nRESPONSIVE:');
console.log(`  breakpoints (${ds.responsive.breakpoints.length}):`);
for (const bp of ds.responsive.breakpoints) {
  console.log(`    ${bp.name}: ${bp.width}px`);
}
console.log(`  typographyOverrides (${ds.responsive.typographyOverrides.length}):`);
for (const o of ds.responsive.typographyOverrides) {
  console.log(`    ${o.breakpointName}/${o.role}: ${o.fontSize}px`);
}

console.log('\nDEPTH:');
if (ds.depth) {
  console.log(`  elevationLevels (${ds.depth.elevationLevels.length}):`);
  for (let i = 0; i < ds.depth.elevationLevels.length; i++) {
    const layers = ds.depth.elevationLevels[i];
    console.log(`    L${i}: ${layers.map(l => `${l.inset ? 'inset ' : ''}${l.color} ${l.offsetX} ${l.offsetY} ${l.blur} ${l.spread}`).join(' | ')}`);
  }
} else {
  console.log('  none');
}
