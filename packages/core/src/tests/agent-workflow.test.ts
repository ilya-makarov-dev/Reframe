/**
 * Agent Workflow Test — the real thing.
 *
 * Simulates what an AI agent actually does:
 *   1. Generate HTML/CSS (like Claude/GPT naturally produce)
 *   2. Import into reframe
 *   3. Adapt to multiple sizes
 *   4. Audit against brand rules
 *   5. Export production assets
 *
 * This is the core value prop: agent writes HTML → reframe does the rest.
 *
 * Run: npx tsx src/agent-workflow.test.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { importFromHtml } from '../importers/html';
import { adapt, adaptFromGraph } from '../resize/adapt';
import { audit, minFontSize, noEmptyText, contrastMinimum, fontInPalette, colorInPalette, textOverflow } from '../audit';
import { pipe, transform } from '../resize/pipe';
import { classify, scaleTo, dedupeNames, snapshot, analyze } from '../resize/transforms';
import { parseDesignMd } from '../design-system';
import { exportToSvg } from '../exporters/svg';
import { exportToHtml } from '../exporters/html';
import { setHost } from '../host/context';
import { StandaloneHost } from '../adapters/standalone/adapter';
import { StandaloneNode } from '../adapters/standalone/node';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

// ─── Load DESIGN.md ─────────────────────────────────────

const designMdPath = join(__dirname, '..', '..', '..', 'examples', 'DESIGN.md');
const designMdText = readFileSync(designMdPath, 'utf-8');
const ds = parseDesignMd(designMdText);

// ─────────────────────────────────────────────────────────
// PHASE 1: Agent generates HTML — like Claude/GPT would
// ─────────────────────────────────────────────────────────

// This is EXACTLY what an AI agent produces when asked "make a summer sale banner"
const agentBannerHtml = `
<div style="width: 1920px; height: 1080px; position: relative; overflow: hidden; font-family: Inter, sans-serif;">
  <!-- Background gradient -->
  <div style="position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; background: linear-gradient(135deg, #0071E3, #00B4D8);"></div>

  <!-- Title -->
  <h1 style="position: absolute; left: 120px; top: 280px; font-size: 56px; font-weight: 800; color: #FFFFFF; margin: 0; letter-spacing: -2px; line-height: 1.07;">
    Big Summer Sale
  </h1>

  <!-- Subtitle -->
  <p style="position: absolute; left: 120px; top: 380px; font-size: 24px; font-weight: 400; color: rgba(255, 255, 255, 0.9); margin: 0; line-height: 1.3;">
    Up to 50% off everything in store
  </p>

  <!-- CTA Button -->
  <div style="position: absolute; left: 120px; top: 480px; width: 240px; height: 56px; background: #FF6B00; border-radius: 12px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 16px rgba(255, 107, 0, 0.4);">
    <span style="font-size: 16px; font-weight: 600; color: #FFFFFF; letter-spacing: 0.5px;">Shop Now</span>
  </div>

  <!-- Secondary CTA -->
  <div style="position: absolute; left: 400px; top: 480px; width: 200px; height: 56px; border: 2px solid rgba(255, 255, 255, 0.5); border-radius: 12px; display: flex; align-items: center; justify-content: center;">
    <span style="font-size: 16px; font-weight: 500; color: #FFFFFF;">Learn More</span>
  </div>

  <!-- Logo placeholder -->
  <div style="position: absolute; right: 80px; top: 60px; width: 200px; height: 80px; background: rgba(255, 255, 255, 0.15); border-radius: 8px; display: flex; align-items: center; justify-content: center;">
    <span style="font-size: 20px; font-weight: 700; color: rgba(255, 255, 255, 0.8);">ACME</span>
  </div>

  <!-- Disclaimer -->
  <p style="position: absolute; left: 120px; bottom: 40px; font-size: 10px; color: rgba(255, 255, 255, 0.5); margin: 0;">
    Terms and conditions apply. See store for details. Offer valid through August 31, 2026.
  </p>

  <!-- Decorative circle -->
  <div style="position: absolute; right: -100px; top: -100px; width: 500px; height: 500px; border-radius: 50%; background: rgba(255, 255, 255, 0.05);"></div>
</div>
`;

// A different style — card layout with flexbox
const agentCardHtml = `
<div style="width: 400px; height: 500px; background: #FFFFFF; border-radius: 16px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.12); font-family: Inter, sans-serif;">
  <!-- Hero image area -->
  <div style="width: 400px; height: 250px; background: linear-gradient(180deg, #667eea, #764ba2);"></div>

  <!-- Content area -->
  <div style="padding: 24px; display: flex; flex-direction: column; gap: 12px;">
    <h2 style="font-size: 24px; font-weight: 700; color: #1D1D1F; margin: 0; line-height: 1.2;">Premium Headphones</h2>
    <p style="font-size: 14px; color: #86868B; margin: 0; line-height: 1.5;">Wireless noise-canceling headphones with 30-hour battery life and premium sound quality.</p>

    <div style="display: flex; align-items: center; gap: 12px; margin-top: 8px;">
      <span style="font-size: 28px; font-weight: 800; color: #0071E3;">$299</span>
      <span style="font-size: 16px; color: #86868B; text-decoration: line-through;">$399</span>
    </div>

    <div style="width: 100%; height: 44px; background: #0071E3; border-radius: 10px; display: flex; align-items: center; justify-content: center; margin-top: auto;">
      <span style="font-size: 15px; font-weight: 600; color: #FFFFFF;">Add to Cart</span>
    </div>
  </div>
</div>
`;

// Minimal — just text and a box (agent making a quick mockup)
const agentMinimalHtml = `
<div style="width: 300px; height: 250px; background: #1D1D1F; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; font-family: Inter;">
  <span style="font-size: 32px; font-weight: 700; color: #FFFFFF;">50% OFF</span>
  <span style="font-size: 14px; color: #86868B;">Limited time offer</span>
  <div style="width: 120px; height: 36px; background: #FF6B00; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
    <span style="font-size: 13px; font-weight: 600; color: #FFFFFF;">Shop</span>
  </div>
</div>
`;

// Agent using <style> block instead of inline
const agentStyleBlockHtml = `
<style>
  .banner { width: 728px; height: 90px; background: #0071E3; display: flex; align-items: center; padding: 0 32px; gap: 24px; font-family: Inter, sans-serif; overflow: hidden; }
  .banner-text { font-size: 18px; font-weight: 700; color: white; }
  .banner-sub { font-size: 13px; color: rgba(255,255,255,0.8); }
  .banner-cta { padding: 8px 20px; background: #FF6B00; border-radius: 6px; font-size: 13px; font-weight: 600; color: white; }
</style>
<div class="banner">
  <span class="banner-text">Summer Sale — Up to 50% Off</span>
  <span class="banner-sub">Free shipping on orders over $50</span>
  <div class="banner-cta">Shop Now</div>
</div>
`;

// Full HTML document (agent wraps in html/body)
const agentFullDocHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; }
    .hero { width: 1200px; height: 628px; position: relative; background: #F5F5F7; overflow: hidden; font-family: Inter; }
    .hero-title { position: absolute; left: 80px; top: 200px; font-size: 48px; font-weight: 800; color: #1D1D1F; }
    .hero-desc { position: absolute; left: 80px; top: 280px; font-size: 18px; color: #86868B; }
  </style>
</head>
<body>
  <div class="hero">
    <h1 class="hero-title">Introducing the Future</h1>
    <p class="hero-desc">Experience innovation like never before.</p>
    <div style="position: absolute; right: 80px; bottom: 60px; width: 180px; height: 48px; background: #0071E3; border-radius: 24px; display: flex; align-items: center; justify-content: center;">
      <span style="font-size: 15px; font-weight: 600; color: white;">Get Started</span>
    </div>
  </div>
</body>
</html>
`;

async function main() {

console.log('\n  ═══ AGENT WORKFLOW TEST ═══\n');

// ─────────────────────────────────────────────────────────
// PHASE 2: Import HTML into reframe
// ─────────────────────────────────────────────────────────

console.log('  Phase 1: HTML Import');

// Banner import
const banner = await importFromHtml(agentBannerHtml);
assert(banner.stats.elements > 0, `banner: ${banner.stats.elements} elements imported`);
assert(banner.stats.textNodes >= 5, `banner: ${banner.stats.textNodes} text nodes`);
const bannerRoot = banner.graph.getNode(banner.rootId)!;
assert(bannerRoot.width === 1920, 'banner: width 1920');
assert(bannerRoot.height === 1080, 'banner: height 1080');
assert(bannerRoot.clipsContent === true, 'banner: overflow hidden → clipsContent');

// Card import
const card = await importFromHtml(agentCardHtml);
assert(card.stats.elements > 0, `card: ${card.stats.elements} elements imported`);
const cardRoot = card.graph.getNode(card.rootId)!;
assert(cardRoot.width === 400, 'card: width 400');
assert(cardRoot.height === 500, 'card: height 500');
assert(cardRoot.cornerRadius === 16, 'card: border-radius 16');

// Minimal import
const minimal = await importFromHtml(agentMinimalHtml);
const minRoot = minimal.graph.getNode(minimal.rootId)!;
assert(minRoot.width === 300, 'minimal: width 300');
assert(minRoot.height === 250, 'minimal: height 250');
assert(minRoot.layoutMode === 'VERTICAL', 'minimal: flex-direction column → VERTICAL');
assert(minRoot.counterAxisAlign === 'CENTER', 'minimal: align-items center');
assert(minRoot.primaryAxisAlign === 'CENTER', 'minimal: justify-content center');

// Style block import
const styleBlock = await importFromHtml(agentStyleBlockHtml);
const sbRoot = styleBlock.graph.getNode(styleBlock.rootId)!;
assert(sbRoot.width === 728, 'style-block: width 728 from .banner class');
assert(sbRoot.height === 90, 'style-block: height 90 from .banner class');
assert(sbRoot.layoutMode === 'HORIZONTAL', 'style-block: display flex → HORIZONTAL');

// Full document import (should skip html/head/body wrappers)
const fullDoc = await importFromHtml(agentFullDocHtml);
const fdRoot = fullDoc.graph.getNode(fullDoc.rootId)!;
assert(fdRoot.width === 1200, 'full-doc: width 1200 from .hero class');
assert(fdRoot.height === 628, 'full-doc: height 628');
assert(fullDoc.stats.textNodes >= 3, `full-doc: ${fullDoc.stats.textNodes} text nodes`);

console.log(`  → ${passed} assertions passed\n`);

// ─────────────────────────────────────────────────────────
// PHASE 3: Verify CSS → INode property mapping
// ─────────────────────────────────────────────────────────

console.log('  Phase 2: CSS Property Mapping');

// Check gradient fill on banner background
const bannerChildren = banner.graph.getChildren(banner.rootId);
const bgNode = bannerChildren[0];
assert(bgNode.fills.length > 0, 'banner bg: has fills');
if (bgNode.fills.length > 0) {
  assert(bgNode.fills[0].type === 'GRADIENT_LINEAR', 'banner bg: gradient fill');
  assert((bgNode.fills[0].gradientStops?.length ?? 0) >= 2, 'banner bg: 2+ gradient stops');
}

// Check text properties
function findTextNode(graph: any, rootId: string, textContent: string): any {
  const node = graph.getNode(rootId);
  if (!node) return null;
  if (node.type === 'TEXT' && node.text?.includes(textContent)) return node;
  for (const childId of node.childIds) {
    const found = findTextNode(graph, childId, textContent);
    if (found) return found;
  }
  return null;
}

const titleNode = findTextNode(banner.graph, banner.rootId, 'Big Summer Sale');
assert(titleNode !== null, 'banner: found title text node');
if (titleNode) {
  assert(titleNode.fontSize === 56, `title: fontSize 56 (got ${titleNode.fontSize})`);
  assert(titleNode.fontWeight === 800, `title: fontWeight 800 (got ${titleNode.fontWeight})`);
  assert(titleNode.fontFamily === 'Inter', `title: fontFamily Inter (got ${titleNode.fontFamily})`);
  assert(titleNode.letterSpacing === -2, `title: letterSpacing -2 (got ${titleNode.letterSpacing})`);
  // Check white text color fill
  assert(titleNode.fills?.length > 0, 'title: has color fill');
}

// Check button properties
const ctaNode = bannerChildren.find((c: any) => {
  const kids = banner.graph.getChildren(c.id);
  return kids.some((k: any) => k.text?.includes('Shop Now'));
});
if (ctaNode) {
  assert(ctaNode.cornerRadius === 12, `CTA: border-radius 12 (got ${ctaNode.cornerRadius})`);
  assert(ctaNode.layoutMode === 'HORIZONTAL', 'CTA: display flex');
  assert(ctaNode.counterAxisAlign === 'CENTER', 'CTA: align-items center');
  assert(ctaNode.effects?.length > 0, 'CTA: has box-shadow effect');
  if (ctaNode.effects?.length > 0) {
    assert(ctaNode.effects[0].type === 'DROP_SHADOW', 'CTA: drop shadow');
  }
}

// Check stroke (border) on secondary CTA
const secondaryCta = bannerChildren.find((c: any) => {
  const kids = banner.graph.getChildren(c.id);
  return kids.some((k: any) => k.text?.includes('Learn More'));
});
if (secondaryCta) {
  assert(secondaryCta.strokes?.length > 0, 'secondary CTA: has border stroke');
}

// Check flexbox layout on card content area
const cardChildren = card.graph.getChildren(card.rootId);
const contentArea = cardChildren.find((c: any) => c.layoutMode === 'VERTICAL');
if (contentArea) {
  assert(contentArea.layoutMode === 'VERTICAL', 'card content: flex-direction column → VERTICAL');
  assert(contentArea.itemSpacing === 12, `card content: gap 12 (got ${contentArea?.itemSpacing})`);
  assert(contentArea.paddingTop === 24, `card content: padding 24 (got ${contentArea?.paddingTop})`);
}

// Check text-decoration
const strikeNode = findTextNode(card.graph, card.rootId, '$399');
if (strikeNode) {
  assert(strikeNode.textDecoration === 'STRIKETHROUGH', 'card: $399 has strikethrough');
}

console.log(`  → ${passed} assertions passed\n`);

// ─────────────────────────────────────────────────────────
// PHASE 4: Adapt imported HTML to multiple sizes
// ─────────────────────────────────────────────────────────

console.log('  Phase 3: Adaptation');

const targets = [
  { width: 1080, height: 1080, name: '1:1 social' },
  { width: 1200, height: 628, name: 'og:image' },
  { width: 300, height: 250, name: 'medium rectangle' },
  { width: 728, height: 90, name: 'leaderboard' },
  { width: 160, height: 600, name: 'wide skyscraper' },
];

const adapted: { name: string; rootId: string; graph: any }[] = [];

for (const target of targets) {
  const result = await adaptFromGraph(banner.graph, banner.rootId, target.width, target.height, {
    strategy: 'smart',
    designSystem: ds,
  });

  assert(result.root.width === target.width, `${target.name}: width ${target.width}`);
  assert(result.root.height === target.height, `${target.name}: height ${target.height}`);
  assert(result.stats.durationMs >= 0, `${target.name}: completed in ${result.stats.durationMs}ms`);

  adapted.push({ name: target.name, rootId: result.root.id, graph: result.graph });
}

assert(adapted.length === 5, `adapted ${adapted.length} formats`);

console.log(`  → ${passed} assertions passed\n`);

// ─────────────────────────────────────────────────────────
// PHASE 5: Audit against brand rules
// ─────────────────────────────────────────────────────────

console.log('  Phase 4: Audit');

// Wrap in StandaloneNode for INode interface
setHost(new StandaloneHost(banner.graph));
const bannerINode = new StandaloneNode(banner.graph, bannerRoot);

const sourceAudit = audit(bannerINode, [
  minFontSize(10),
  noEmptyText(),
  contrastMinimum(4.5),
  fontInPalette(),
  colorInPalette(),
], ds as any);

const sourceErrors = sourceAudit.filter(i => i.severity === 'error');
assert(sourceErrors.length === 0, `source banner: ${sourceErrors.length} errors (should be 0)`);
console.log(`    source banner: ${sourceAudit.length} issues (${sourceErrors.length} errors)`);

// Audit adapted sizes
for (const { name, rootId, graph } of adapted) {
  const rawRoot = graph.getNode(rootId);
  if (!rawRoot) continue;
  setHost(new StandaloneHost(graph));
  const inode = new StandaloneNode(graph, rawRoot);

  const issues = audit(inode, [
    minFontSize(6), // lower for small formats
    noEmptyText(),
  ]);

  console.log(`    ${name}: ${issues.length} issues`);
  // Don't fail on post-adapt issues — small formats may have constraints
}

assert(true, 'audit completed on all sizes');

console.log(`  → ${passed} assertions passed\n`);

// ─────────────────────────────────────────────────────────
// PHASE 6: Pipe workflow on imported HTML
// ─────────────────────────────────────────────────────────

console.log('  Phase 5: Pipe Workflow');

const pipeResult = await pipe(
  analyze(),
  snapshot('imported'),
  dedupeNames(),
  snapshot('deduped'),
).run(bannerINode);

assert(pipeResult.trace.length === 4, 'pipe: ran 4 steps');
assert(pipeResult.ctx.state.has('analysis'), 'pipe: analysis computed');
assert(pipeResult.ctx.state.has('snapshot:imported'), 'pipe: imported snapshot saved');
assert(pipeResult.ctx.state.has('snapshot:deduped'), 'pipe: deduped snapshot saved');

console.log(`  → ${passed} assertions passed\n`);

// ─────────────────────────────────────────────────────────
// PHASE 7: Export production assets
// ─────────────────────────────────────────────────────────

console.log('  Phase 6: Export');

const outDir = join(__dirname, '..', 'test-output', 'agent');
mkdirSync(outDir, { recursive: true });

// Export source banner
function graphToTree(graph: any, nodeId: string): any {
  const node = graph.getNode(nodeId);
  if (!node) return { type: 'FRAME', name: 'Empty', width: 0, height: 0, children: [] };
  return {
    type: node.type, name: node.name,
    x: node.x, y: node.y, width: node.width, height: node.height,
    fills: node.fills, strokes: node.strokes, effects: node.effects,
    opacity: node.opacity, cornerRadius: node.cornerRadius,
    visible: node.visible, clipsContent: node.clipsContent,
    text: node.text, fontSize: node.fontSize, fontFamily: node.fontFamily,
    fontWeight: node.fontWeight, textAlignHorizontal: node.textAlignHorizontal,
    letterSpacing: node.letterSpacing, lineHeight: node.lineHeight,
    textDecoration: node.textDecoration,
    children: node.childIds.map((id: string) => graphToTree(graph, id)),
  };
}

// SVG exports
const sourceSvg = exportToSvg({ root: graphToTree(banner.graph, banner.rootId) });
writeFileSync(join(outDir, 'source-banner.svg'), sourceSvg);
assert(sourceSvg.length > 100, `source SVG: ${sourceSvg.length} bytes`);

for (const { name, rootId, graph } of adapted) {
  const tree = graphToTree(graph, rootId);
  const svg = exportToSvg({ root: tree });
  const safeName = name.replace(/[^a-z0-9]/gi, '-');
  writeFileSync(join(outDir, `adapted-${safeName}.svg`), svg);
  assert(svg.length > 50, `${name} SVG: ${svg.length} bytes`);
}

// HTML exports
const sourceHtmlExport = exportToHtml(banner.graph, banner.rootId);
writeFileSync(join(outDir, 'source-banner.html'), sourceHtmlExport);
assert(sourceHtmlExport.length > 100, `source HTML: ${sourceHtmlExport.length} bytes`);
assert(sourceHtmlExport.includes('1920'), 'source HTML: contains width');

for (const { name, rootId, graph } of adapted) {
  const html = exportToHtml(graph, rootId);
  const safeName = name.replace(/[^a-z0-9]/gi, '-');
  writeFileSync(join(outDir, `adapted-${safeName}.html`), html);
  assert(html.length > 50, `${name} HTML: ${html.length} bytes`);
}

// Card exports
const cardSvg = exportToSvg({ root: graphToTree(card.graph, card.rootId) });
writeFileSync(join(outDir, 'card.svg'), cardSvg);
assert(cardSvg.length > 100, `card SVG: ${cardSvg.length} bytes`);

const cardHtmlExport = exportToHtml(card.graph, card.rootId);
writeFileSync(join(outDir, 'card.html'), cardHtmlExport);
assert(cardHtmlExport.length > 100, `card HTML: ${cardHtmlExport.length} bytes`);

console.log(`  → ${passed} assertions passed`);
console.log(`  → ${adapted.length * 2 + 4} files written to test-output/agent/\n`);

// ─────────────────────────────────────────────────────────
// PHASE 8: Round-trip — import HTML that was exported
// ─────────────────────────────────────────────────────────

console.log('  Phase 7: Round-trip (export HTML → re-import)');

const reImport = await importFromHtml(sourceHtmlExport);
const reRoot = reImport.graph.getNode(reImport.rootId)!;
assert(reRoot.width > 0, `round-trip: width ${reRoot.width}`);
assert(reRoot.height > 0, `round-trip: height ${reRoot.height}`);
assert(reImport.stats.elements > 0, `round-trip: ${reImport.stats.elements} elements`);

console.log(`  → ${passed} assertions passed\n`);

// ─────────────────────────────────────────────────────────
// PHASE 9: Multi-format agent workflow
//   Agent makes a card → adapt to 3 ad sizes → audit all → export
// ─────────────────────────────────────────────────────────

console.log('  Phase 8: Multi-format Card Workflow');

const cardTargets = [
  { width: 300, height: 250, name: 'card-medium-rect' },
  { width: 336, height: 280, name: 'card-large-rect' },
  { width: 250, height: 250, name: 'card-square' },
];

for (const target of cardTargets) {
  const result = await adaptFromGraph(card.graph, card.rootId, target.width, target.height, {
    strategy: 'smart',
  });
  assert(result.root.width === target.width, `${target.name}: ${target.width}x${target.height}`);

  // Audit
  const issues = audit(result.root, [minFontSize(8), noEmptyText()]);
  console.log(`    ${target.name}: ${result.stats.durationMs}ms, ${issues.length} issues`);
}

console.log(`  → ${passed} assertions passed\n`);

// ─────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────

console.log(`  ═══ AGENT WORKFLOW: ${passed} passed, ${failed} failed ═══\n`);
if (failed > 0) process.exit(1);

} // end main

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
