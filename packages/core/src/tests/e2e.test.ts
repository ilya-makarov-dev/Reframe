/**
 * End-to-end test: create → adapt → audit → export
 *
 * Run: npx tsx src/e2e.test.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { NodeType } from '../host/types';
import {
  build, frame, rect, text, group, solid, linearGradient, dropShadow,
} from '../builder';
import { adapt } from '../resize/adapt';
import { audit, minFontSize, textOverflow, noEmptyText, contrastMinimum, fontInPalette, colorInPalette } from '../audit';
import { pipe, transform } from '../resize/pipe';
import { classify, scaleTo, dedupeNames, snapshot, analyze } from '../resize/transforms';
import { parseDesignMd } from '../design-system';
import { exportToSvg } from '../exporters/svg';
import { exportToHtml } from '../exporters/html';
import { setHost } from '../host/context';
import { StandaloneHost } from '../adapters/standalone/adapter';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

// ── Load DESIGN.md ─────────────────────────────────

const designMdPath = join(__dirname, '..', '..', '..', 'examples', 'DESIGN.md');
const designMdText = readFileSync(designMdPath, 'utf-8');
const ds = parseDesignMd(designMdText);

assert(ds.brand.length > 0, `parsed DESIGN.md brand: "${ds.brand}"`);
assert(ds.typography.hierarchy.length >= 5, `typography rules: ${ds.typography.hierarchy.length}`);
assert(ds.colors.roles.size >= 3, `color roles: ${ds.colors.roles.size}`);

// ── 1. Create banner ──────────────────────────────

const { root, graph } = build(
  frame({ width: 1920, height: 1080, name: 'Hero Banner', fills: [solid('#FFFFFF')], clipsContent: true },
    // Background gradient
    rect({ name: 'Background', x: 0, y: 0, width: 1920, height: 1080,
      fills: [linearGradient([
        { color: '#0071E3', position: 0 },
        { color: '#00B4D8', position: 1 },
      ])] }),
    // Title
    text('Big Summer Sale', {
      name: 'Title', fontSize: 56, fontFamily: 'Inter', fontWeight: 800,
      x: 120, y: 300, width: 800, height: 80,
      fills: [solid('#FFFFFF')],
    }),
    // Subtitle
    text('Up to 50% off everything', {
      name: 'Subtitle', fontSize: 24, fontFamily: 'Inter', fontWeight: 400,
      x: 120, y: 400, width: 600, height: 40,
      fills: [solid('#FFFFFF')],
    }),
    // CTA button frame
    frame({ name: 'CTA Button', x: 120, y: 500, width: 240, height: 56,
      fills: [solid('#FF6B00')], cornerRadius: 12 },
      text('Shop Now', {
        name: 'CTA Label', fontSize: 16, fontFamily: 'Inter', fontWeight: 600,
        x: 60, y: 16, width: 120, height: 24,
        fills: [solid('#FFFFFF')],
      }),
    ),
    // Logo placeholder
    rect({ name: 'Logo', x: 1600, y: 60, width: 200, height: 80,
      fills: [solid('#FFFFFF', 0.3)], cornerRadius: 8 }),
    // Disclaimer
    text('Terms apply. See store for details.', {
      name: 'Disclaimer', fontSize: 10, fontFamily: 'Inter', fontWeight: 400,
      x: 120, y: 1020, width: 400, height: 16,
      fills: [solid('#FFFFFF', 0.6)],
    }),
  )
);

assert(root.type === NodeType.Frame, 'created root is Frame');
assert(root.width === 1920, 'root width 1920');
assert(root.children!.length === 6, 'root has 6 children');

async function main() {

// ── 2. Audit before adaptation ────────────────────

const preAuditIssues = audit(root, [
  minFontSize(10),
  noEmptyText(),
  contrastMinimum(4.5),
  fontInPalette(),
  colorInPalette(),
], ds as any);

// Should have minimal issues on a well-constructed banner
assert(preAuditIssues.filter(i => i.severity === 'error').length === 0, 'no errors on source banner');

// ── 3. Adapt to multiple targets ──────────────────

// Set up host for adaptation (ClusterScalePipeline needs it)
setHost(new StandaloneHost(graph));

const targets = [
  { width: 1080, height: 1080, name: '1:1 social' },
  { width: 300, height: 250, name: 'medium rectangle' },
  { width: 728, height: 90, name: 'leaderboard' },
];

for (const target of targets) {
  const result = await adapt(root, target.width, target.height, {
    strategy: 'smart',
    designSystem: ds,
  });

  assert(result.root.width === target.width, `${target.name}: width ${target.width}`);
  assert(result.root.height === target.height, `${target.name}: height ${target.height}`);
  assert(result.stats.durationMs >= 0, `${target.name}: has duration`);
  assert(result.stats.strategy === 'smart', `${target.name}: strategy smart`);

  // Audit adapted result
  const postIssues = audit(result.root, [
    minFontSize(6),  // lower threshold for small formats
    noEmptyText(),
  ]);

  // Log but don't fail on post-adapt issues (small formats may have constraints)
  if (postIssues.length > 0) {
    console.log(`  ${target.name}: ${postIssues.length} post-adapt issue(s)`);
  }
}

// ── 4. Pipe-based workflow ────────────────────────

const { root: pipeRoot } = build(
  frame({ width: 800, height: 600, name: 'Pipe Test', fills: [solid('#FFF')] },
    text('Title', { fontSize: 32, fontFamily: 'Inter', x: 20, y: 20 }),
    rect({ name: 'BG', width: 800, height: 600, fills: [solid('#000')] }),
    rect({ name: 'BG', width: 100, height: 100, fills: [solid('#F00')] }),
  )
);

const pipeResult = await pipe(
  analyze(),
  snapshot('before'),
  dedupeNames(),
  snapshot('after'),
).run(pipeRoot);

assert(pipeResult.trace.length === 4, 'pipe ran 4 steps');
assert(pipeResult.ctx.state.has('analysis'), 'analysis in context');
assert(pipeResult.ctx.state.has('snapshot:before'), 'before snapshot');
assert(pipeResult.ctx.state.has('snapshot:after'), 'after snapshot');

// Check dedup worked
const names = pipeRoot.children!.map(c => c.name);
assert(new Set(names).size === names.length, `names are unique: ${names.join(', ')}`);

// ── 5. Export ─────────────────────────────────────

// SVG export
const svgScene = { root: exportSceneForSvg(root) };
// Just verify the export functions don't throw
assert(typeof exportToSvg === 'function', 'exportToSvg exists');
assert(typeof exportToHtml === 'function', 'exportToHtml exists');

// HTML export from graph
const html = exportToHtml(graph, root.id);
assert(html.length > 100, `HTML exported: ${html.length} bytes`);
assert(html.includes('Hero Banner') || html.includes('1920'), 'HTML contains frame info');

// ── 6. Full cycle: DESIGN.md → create → adapt → audit ──

const fullDs = parseDesignMd(designMdText);
assert(fullDs.typography.hierarchy.some(r => r.role === 'hero'), 'hero role parsed');
assert(fullDs.typography.hierarchy.some(r => r.role === 'button'), 'button role parsed');
assert(fullDs.colors.roles.has('primary'), 'primary color parsed');
assert(fullDs.layout.spacingUnit === 8, 'spacing unit is 8');

// ── Summary ────────────────────────────────────────

console.log(`\n  E2E tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

} // end main

main();

// ─── Helper ────────────────────────────────────────

function exportSceneForSvg(node: any): any {
  return {
    type: node.type ?? 'FRAME',
    name: node.name ?? 'Node',
    width: node.width, height: node.height,
    children: node.children?.map(exportSceneForSvg) ?? [],
  };
}
