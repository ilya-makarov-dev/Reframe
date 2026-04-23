/**
 * Phase 3.1 — Self-host /platform/design-system through INode.
 *
 * Verifies the brand-gallery panel composer produces a full page rendering
 * that replaces hand-written HTML, with zero tech debt:
 *   - Colors section with N swatches (chips tokenBinding'ed for live repaint)
 *   - Typography hierarchy with real fontFamily sampling
 *   - Radius scale chips
 *   - Export DTCG button with browser.download client-side gesture
 *
 * Static composition against a Ferrari-style DESIGN.md fixture; the page
 * is rendered through renderDesignSystemPage() which inlines the panel
 * into page.main via the registry. Verifies HTML contains every section,
 * CSS vars emitted for swatches, and the export gesture is wired up.
 *
 * Invoke: `npx tsx packages/mcp/src/tests/phase3-self-host.ts`
 * Exit 0 = all green.
 */

import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { renderPanel } from '../platform/panels';
import { renderDesignSystemPage } from '../platform/pages/design-system';
import { registerBrand, initProject } from '../../../core/src/project/io';

const FERRARI_DESIGN_MD = [
  '# Ferrari Brand',
  '',
  '## Palette',
  '',
  '- **Racing Red** (`#FF2800`): Primary — brand red for hero accents',
  '- **Pure White** (`#FFFFFF`): Background — editorial canvas',
  '- **Warm Cream** (`#F8F6F2`): Surface — paper tone for panels',
  '- **Near Black** (`#181818`): Text — body copy',
  '- **Cool Gray** (`#9B9BA5`): Muted — secondary text',
  '- **Signal Yellow** (`#FFD500`): Accent — alerts and callouts',
  '',
  '## Typography',
  '',
  '**Primary font**: Inter',
  '**Secondary font**: Source Serif 4',
  '',
  '| Role | Size | Weight |',
  '|------|------|--------|',
  '| Hero | 72 | 700 |',
  '| Title | 48 | 600 |',
  '| Subtitle | 32 | 500 |',
  '| Body | 16 | 400 |',
  '| Caption | 12 | 400 |',
  '',
  '## Layout',
  '',
  '**Spacing unit**: 8px',
  '**Border radius scale**: 0, 4, 8, 12, 16, 24',
  '',
].join('\n');

function setupProject(): { projectDir: string; brandSlug: string } {
  const tmp = mkdtempSync(join(tmpdir(), 'rf-phase3-'));
  initProject(tmp, 'phase3-bench');
  registerBrand(tmp, 'ferrari', FERRARI_DESIGN_MD, { label: 'Ferrari', setActive: true });
  return { projectDir: tmp, brandSlug: 'ferrari' };
}

function fmt(s: 'green' | 'yellow' | 'red') {
  return s === 'green' ? '🟢 GREEN' : s === 'yellow' ? '🟡 YELLOW' : '🔴 RED';
}
function line(n = 72) { return '─'.repeat(n); }
function now() { return performance.now(); }

async function run() {
  console.log(line());
  console.log('  Phase 3.1 — Self-host /platform/design-system');
  console.log(line());

  const { projectDir, brandSlug } = setupProject();

  // ─── T1: panel composer produces expected structure ──
  const t1 = now();
  const rendered = renderPanel('brand-gallery', { brandSlug }, { projectDir });
  const t1ms = now() - t1;
  const html = rendered.html;

  const checks = {
    title: /Design system/.test(html),
    brandLead: /Active brand:\s*Ferrari/i.test(html),
    colorsSection: /Colors\s*·\s*\d+/.test(html),
    // Ferrari has 6 color roles after parser normalization; at least 5 chips.
    swatchChips: (html.match(/data-intent-role="brand-gallery\/swatch-chip"/g) || []).length,
    typographySection: html.includes('Typography'),
    typographyRows: (html.match(/data-intent-role="brand-gallery\/type-row"/g) || []).length,
    radiusSection: html.includes('Border radius scale'),
    radiusChips: (html.match(/data-intent-role="brand-gallery\/radius-chip"/g) || []).length,
    exportButton: /data-intent-role="brand-gallery\/export-dtcg"/.test(html),
    exportGesture: /browser\.download/.test(html),
    cssVars: (html.match(/--color-[\w-]+:/g) || []).length,
    varRefs: (html.match(/var\(--color-/g) || []).length,
  };

  const t1Status: 'green' | 'yellow' | 'red' =
    checks.title && checks.brandLead && checks.colorsSection &&
    checks.swatchChips >= 5 && checks.typographySection && checks.typographyRows >= 3 &&
    checks.radiusSection && checks.radiusChips >= 3 &&
    checks.exportButton && checks.exportGesture &&
    checks.cssVars >= 5 && checks.varRefs >= 5
      ? 'green' : 'red';

  console.log();
  console.log(`T1 ${fmt(t1Status)} brand-gallery panel structure (${t1ms.toFixed(2)}ms)`);
  console.log(`    nodes: ${rendered.nodeCount}  htmlBytes: ${rendered.html.length}`);
  console.log(`    title: ${checks.title}  lead: ${checks.brandLead}`);
  console.log(`    colors: ${checks.colorsSection}  swatchChips: ${checks.swatchChips}`);
  console.log(`    typography: ${checks.typographySection}  rows: ${checks.typographyRows}`);
  console.log(`    radius: ${checks.radiusSection}  chips: ${checks.radiusChips}`);
  console.log(`    export: ${checks.exportButton}  gesture: ${checks.exportGesture}`);
  console.log(`    --color-* defs: ${checks.cssVars}  var(--color-*) refs: ${checks.varRefs}`);

  // ─── T2: full page via renderDesignSystemPage wraps in shell ──
  const t2 = now();
  const pageHtml = renderDesignSystemPage({
    brandSlug,
    projectDir,
    activeBrand: brandSlug,
    sidebarScenes: [],
    sidebarComponents: [],
    sidebarMacros: [],
  });
  const t2ms = now() - t2;

  const pageChecks = {
    doctype: pageHtml.startsWith('<!DOCTYPE html>'),
    shellWrap: /<aside class="sidebar">/.test(pageHtml),
    embedsGallery: pageHtml.includes('brand-gallery/root'),
    mainContent: /<main class="main">/.test(pageHtml),
    exportPreserved: /data-intent-role="brand-gallery\/export-dtcg"/.test(pageHtml),
    noLegacyHandwrittenGallery: !/\.color-swatches|\.tokens-section|\.color-swatch/.test(pageHtml),
  };
  const t2Status: 'green' | 'yellow' | 'red' =
    Object.values(pageChecks).every(Boolean) ? 'green' : 'red';

  console.log();
  console.log(`T2 ${fmt(t2Status)} renderDesignSystemPage full page (${t2ms.toFixed(2)}ms, ${pageHtml.length} bytes)`);
  for (const [k, v] of Object.entries(pageChecks)) console.log(`    ${k}: ${v}`);

  // ─── T3: no-brand fallback renders CTA instead of empty page ──
  const t3 = now();
  const rendered3 = renderPanel('brand-gallery', {}, { projectDir: '/nonexistent' });
  const t3ms = now() - t3;
  const hasNoBrandCTA = /No brand loaded/.test(rendered3.html);
  const hasEmptyColorsStub = /No color tokens/.test(rendered3.html);
  const t3Status: 'green' | 'yellow' | 'red' = hasNoBrandCTA && hasEmptyColorsStub ? 'green' : 'red';

  console.log();
  console.log(`T3 ${fmt(t3Status)} no-brand fallback (${t3ms.toFixed(2)}ms)`);
  console.log(`    no-brand CTA: ${hasNoBrandCTA}  empty colors state: ${hasEmptyColorsStub}`);

  // ─── Summary ────────────────────────────────────
  console.log();
  console.log(line());
  const all = [t1Status, t2Status, t3Status];
  const anyRed = all.some(s => s === 'red');
  const allGreen = all.every(s => s === 'green');
  console.log(`  VERDICT: ${allGreen ? '🟢 ALL GREEN — self-host works offline, live-Chrome up next' : anyRed ? '🔴 RED' : '🟡 YELLOW'}`);
  console.log(line());

  if (anyRed) process.exit(1);
}

run().catch(err => {
  console.error('Phase 3.1 bench crashed:', err);
  process.exit(2);
});
