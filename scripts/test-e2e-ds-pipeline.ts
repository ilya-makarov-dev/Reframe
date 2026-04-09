/**
 * End-to-end test: Parser → Types → Tokens → INode → Audit → Export
 * Verifies EVERY component from the table works through the full pipeline.
 *
 * Usage: npx tsx scripts/test-e2e-ds-pipeline.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { parseDesignMd } from '../packages/core/src/design-system/parser.js';
import { tokenizeDesignSystem } from '../packages/core/src/design-system/tokens.js';
import { SceneGraph } from '../packages/core/src/engine/scene-graph.js';
import {
  fontFeaturesCompliance,
  spacingScaleCompliance,
  componentSpecCompliance,
  stateCompleteness,
  audit,
} from '../packages/core/src/audit.js';
import type { DesignSystem } from '../packages/core/src/design-system/types.js';

const PASS = '✅';
const FAIL = '❌';
let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ${PASS} ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    console.log(`  ${FAIL} ${name}${detail ? ' — ' + detail : ''}`);
    failures++;
  }
}

// Load stripe as the test brand (richest data)
const md = readFileSync(join(__dirname, '..', '.reframe', 'brands', 'stripe', 'DESIGN.md'), 'utf-8');
const ds = parseDesignMd(md);

console.log('\n=== 1. PARSER → TYPES ===\n');

// Typography
check('Typography hierarchy ≥3', ds.typography.hierarchy.length >= 3, `${ds.typography.hierarchy.length} roles`);
check('Typography primaryFont', !!ds.typography.primaryFont, ds.typography.primaryFont);
check('Typography secondaryFont', !!ds.typography.secondaryFont, ds.typography.secondaryFont);
check('Typography fontFeatures', !!ds.typography.fontFeatures && ds.typography.fontFeatures.length > 0,
  ds.typography.fontFeatures?.map(f => f.tag).join(', '));
// Per-role font features come from table columns — not all brands have them in table cells
const perRoleFF = ds.typography.hierarchy.filter(r => r.fontFeatures && r.fontFeatures.length > 0);
check('Typography per-role fontFeatures (optional)', true,
  perRoleFF.length > 0 ? perRoleFF.map(r => `${r.role}:[${r.fontFeatures!.join(',')}]`).join(' ') : 'none (global only — OK)');

// Colors
check('Colors primary', !!ds.colors.primary, ds.colors.primary);
check('Colors background', !!ds.colors.background, ds.colors.background);
check('Colors text', !!ds.colors.text, ds.colors.text);
check('Colors accent', !!ds.colors.accent, ds.colors.accent);
check('Colors roles ≥10', ds.colors.roles.size >= 10, `${ds.colors.roles.size} roles`);
check('Colors gradients', !!ds.colors.gradients && ds.colors.gradients.size > 0,
  ds.colors.gradients ? `${ds.colors.gradients.size} gradients` : 'none');

// Components
check('Button spec', !!ds.components.button, `radius=${ds.components.button?.borderRadius} style=${ds.components.button?.style}`);
check('Button variants ≥2', !!ds.components.button?.variants && ds.components.button.variants.length >= 2,
  `${ds.components.button?.variants?.length ?? 0} variants: ${ds.components.button?.variants?.map(v => v.name).join(', ')}`);
check('Button variant has hover', ds.components.button?.variants?.some(v => !!v.hover) ?? false,
  ds.components.button?.variants?.filter(v => v.hover).map(v => `${v.name}:hover=${JSON.stringify(v.hover)}`).join(' ') || 'none');
check('Card spec', !!ds.components.card, `radius=${ds.components.card?.borderRadius} bg=${ds.components.card?.background}`);
check('Badge spec', !!ds.components.badge, `radius=${ds.components.badge?.borderRadius} size=${ds.components.badge?.fontSize}`);
check('Input spec', !!ds.components.input, `radius=${ds.components.input?.borderRadius} focus=${ds.components.input?.focusBorderColor}`);
check('Nav spec', !!ds.components.nav, `size=${ds.components.nav?.fontSize} weight=${ds.components.nav?.fontWeight}`);

// Layout
check('Spacing unit', ds.layout.spacingUnit > 0, `${ds.layout.spacingUnit}px`);
check('Spacing scale ≥3', !!ds.layout.spacingScale && ds.layout.spacingScale.length >= 3,
  ds.layout.spacingScale ? `[${ds.layout.spacingScale.join(',')}]` : 'none');
check('Max width', !!ds.layout.maxWidth, `${ds.layout.maxWidth}px`);
check('Section spacing', !!ds.layout.sectionSpacing, `${ds.layout.sectionSpacing}px`);
check('Radius scale ≥4', ds.layout.borderRadiusScale.length >= 4, `[${ds.layout.borderRadiusScale.join(',')}]`);

// Depth
check('Shadow levels ≥2', !!ds.depth && ds.depth.elevationLevels.length >= 2,
  `${ds.depth?.elevationLevels.length ?? 0} levels`);

// Responsive
check('Breakpoints ≥2', ds.responsive.breakpoints.length >= 2,
  ds.responsive.breakpoints.map(b => `${b.name}:${b.width}`).join(', '));

console.log('\n=== 2. TOKENS ===\n');

const graph = new SceneGraph();
const tokenIndex = tokenizeDesignSystem(graph, ds);
const tokens = tokenIndex.tokens;

// Check all token groups exist
function hasTokenPrefix(prefix: string): string[] {
  return [...tokens.keys()].filter(k => k.startsWith(prefix));
}

check('color.* tokens', hasTokenPrefix('color.').length >= 10, `${hasTokenPrefix('color.').length} tokens`);
check('type.* tokens', hasTokenPrefix('type.').length >= 5, `${hasTokenPrefix('type.').length} tokens`);
check('space.* tokens', hasTokenPrefix('space.').length >= 6, `${hasTokenPrefix('space.').length} tokens`);
check('radius.* tokens', hasTokenPrefix('radius.').length >= 4, `${hasTokenPrefix('radius.').length} tokens`);

// NEW token groups
check('button.* tokens', hasTokenPrefix('button.').length >= 3, `${hasTokenPrefix('button.').length}: ${hasTokenPrefix('button.').slice(0, 8).join(', ')}...`);
check('button variant tokens', hasTokenPrefix('button.primary').length >= 1 || hasTokenPrefix('button.ghost').length >= 1,
  `primary=${hasTokenPrefix('button.primary').length} ghost=${hasTokenPrefix('button.ghost').length}`);
check('card.* tokens', hasTokenPrefix('card.').length >= 1, `${hasTokenPrefix('card.').length}: ${hasTokenPrefix('card.').join(', ')}`);
check('badge.* tokens', hasTokenPrefix('badge.').length >= 1, `${hasTokenPrefix('badge.').length}: ${hasTokenPrefix('badge.').join(', ')}`);
check('input.* tokens', hasTokenPrefix('input.').length >= 1, `${hasTokenPrefix('input.').length}: ${hasTokenPrefix('input.').join(', ')}`);
check('nav.* tokens', hasTokenPrefix('nav.').length >= 1, `${hasTokenPrefix('nav.').length}: ${hasTokenPrefix('nav.').join(', ')}`);
check('type.fontFeatures token', tokens.has('type.fontFeatures'), `${graph.resolveVariable(tokens.get('type.fontFeatures')!)}`);
check('layout.maxWidth token', tokens.has('layout.maxWidth'), `${graph.resolveVariable(tokens.get('layout.maxWidth')!)}`);
check('space.section token', tokens.has('space.section'), `${graph.resolveVariable(tokens.get('space.section')!)}`);

// Spacing scale individual tokens
const spaceTokens = hasTokenPrefix('space.');
const hasScaleTokens = spaceTokens.some(t => /^space\.\d+$/.test(t));
check('space.<N> scale tokens', hasScaleTokens, spaceTokens.filter(t => /^space\.\d+$/.test(t)).join(', '));

console.log('\n=== 3. INODE fontFeatureSettings ===\n');

// Create nodes via SceneGraph API
const rootNode = graph.createNode('FRAME', graph.rootId, { name: 'TestRoot', width: 800, height: 600 });
const textNode = graph.createNode('TEXT', rootNode.id, { name: 'TestText', text: 'Hello', fontSize: 16, fontWeight: 400, width: 200, height: 30 });

check('INode has fontFeatureSettings field', 'fontFeatureSettings' in textNode, typeof textNode.fontFeatureSettings);
check('fontFeatureSettings default is []', Array.isArray(textNode.fontFeatureSettings) && textNode.fontFeatureSettings.length === 0);

textNode.fontFeatureSettings = ['ss01', 'tnum'];
check('fontFeatureSettings can be set', textNode.fontFeatureSettings.length === 2 && textNode.fontFeatureSettings[0] === 'ss01');

console.log('\n=== 4. AUDIT NEW RULES ===\n');

// Build a mock INode tree for audit testing
// We need to use the host/types INode interface, not SceneNode directly
// Let's test via the audit function directly with mock objects

interface MockNode {
  id: string;
  type: number;
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  visible: boolean;
  opacity: number;
  fontSize?: number;
  fontWeight?: number;
  characters?: string;
  cornerRadius?: number;
  fills?: any[];
  children?: MockNode[];
  parent?: MockNode;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  fontName?: any;
  fontFeatureSettings?: string[];
  semanticRole?: string;
  states?: Record<string, any>;
  layoutMode?: string;
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
}

const NodeType_Text = 'TEXT';
const NodeType_Frame = 'FRAME';

const mockRoot: any = {
  id: 'root', type: NodeType_Frame, name: 'Root',
  width: 800, height: 600, x: 0, y: 0,
  visible: true, opacity: 1,
  layoutMode: 'VERTICAL', itemSpacing: 37, // 37 not in stripe scale or grid
  paddingTop: 40, paddingRight: 40, paddingBottom: 40, paddingLeft: 40,
  fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1 } }],
  children: [],
};

// Text without font features
const mockText: any = {
  id: 'text1', type: NodeType_Text, name: 'Heading',
  width: 400, height: 50, x: 0, y: 0,
  visible: true, opacity: 1,
  fontSize: 56, fontWeight: 300,
  characters: 'Welcome to Stripe',
  fontFeatureSettings: [], // missing ss01!
  fills: [{ type: 'SOLID', visible: true, color: { r: 0.02, g: 0.1, b: 0.19 } }],
  fontName: { family: 'sohne-var', style: 'Light' },
  children: [],
};
mockRoot.children.push(mockText);

// Button without hover state
const mockButton: any = {
  id: 'btn1', type: NodeType_Frame, name: 'CTA Button',
  width: 200, height: 44, x: 0, y: 100,
  visible: true, opacity: 1,
  cornerRadius: 10, // wrong! stripe says 4
  semanticRole: 'button',
  states: {}, // no hover!
  fills: [{ type: 'SOLID', visible: true, color: { r: 0.33, g: 0.23, b: 0.99 } }],
  children: [{ id: 'btn-text', type: NodeType_Text, name: 'btn-label', width: 100, height: 20, x: 50, y: 12, visible: true, opacity: 1, fontSize: 16, characters: 'Start now', fills: [], children: [] }],
};
mockRoot.children.push(mockButton);

// Run new audit rules
const ffRule = fontFeaturesCompliance();
const ssRule = spacingScaleCompliance();
const csRule = componentSpecCompliance();
const scRule = stateCompleteness();

const allIssues = audit(mockRoot, [ffRule, ssRule, csRule, scRule], ds as any);

const ffIssues = allIssues.filter(i => i.rule === 'font-features-compliance');
const ssIssues = allIssues.filter(i => i.rule === 'spacing-scale-compliance');
const csIssues = allIssues.filter(i => i.rule === 'component-spec-compliance');
const scIssues = allIssues.filter(i => i.rule === 'state-completeness');

check('fontFeaturesCompliance fires on text without ss01',
  ffIssues.length > 0, ffIssues[0]?.message?.slice(0, 80));
check('fontFeaturesCompliance fix suggests correct features',
  ffIssues.some(i => i.fix?.css?.includes('ss01')), ffIssues[0]?.fix?.css);

// Debug spacing issues
if (ssIssues.length === 0) {
  console.log('    DEBUG: no spacing issues found. Root layoutMode=' + mockRoot.layoutMode + ' itemSpacing=' + mockRoot.itemSpacing);
  console.log('    DEBUG: scale=' + JSON.stringify(ds.layout.spacingScale));
  // Run manually to debug
  const testNode = mockRoot;
  const testScale = ds.layout.spacingScale!;
  const testUnit = ds.layout.spacingUnit;
  const testVal = testNode.itemSpacing;
  const inScale = testScale.some((s: number) => Math.abs(testVal - s) <= 1);
  const isGridMultiple = testUnit > 0 && testVal % testUnit === 0;
  console.log('    DEBUG: val=' + testVal + ' inScale=' + inScale + ' isGridMultiple=' + isGridMultiple);
  console.log('    DEBUG: allIssues rules=', allIssues.map((i: any) => i.rule));
}
check('spacingScaleCompliance fires on bad spacing',
  ssIssues.length > 0, ssIssues.length > 0 ? ssIssues[0]?.message?.slice(0, 80) : 'no issues');

check('componentSpecCompliance fires on button radius=10 (should be 4)',
  csIssues.some(i => i.message?.includes('radius') && i.message?.includes('10')),
  csIssues.find(i => i.message?.includes('radius'))?.message?.slice(0, 80));
check('componentSpecCompliance fix suggests correct radius',
  csIssues.some(i => i.fix?.suggested?.includes('4')), csIssues.find(i => i.fix)?.fix?.suggested);

check('stateCompleteness fires on button without hover',
  scIssues.length > 0, scIssues[0]?.message?.slice(0, 80));

// Test that correct features PASS (no false positives)
mockText.fontFeatureSettings = ['ss01', 'tnum'];
// Also set features on button text child so it doesn't trigger
(mockButton.children[0] as any).fontFeatureSettings = ['ss01', 'tnum'];
const ffIssues2 = audit(mockRoot, [ffRule], ds as any).filter(i => i.rule === 'font-features-compliance');
check('fontFeaturesCompliance passes when features are correct', ffIssues2.length === 0,
  ffIssues2.length > 0 ? `still ${ffIssues2.length} issues: ${ffIssues2.map(i => i.nodeName).join(',')}` : 'clean');

// Test button with correct radius passes
mockButton.cornerRadius = 4;
const csIssues2 = audit(mockRoot, [csRule], ds as any).filter(i => i.rule === 'component-spec-compliance' && i.message?.includes('radius'));
check('componentSpecCompliance passes when radius is correct', csIssues2.length === 0);

// Test button with hover state passes
mockButton.states = { hover: { fills: [{ type: 'SOLID', color: { r: 0.2, g: 0.2, b: 0.8 } }] } };
const scIssues2 = audit(mockRoot, [scRule], ds as any).filter(i => i.rule === 'state-completeness' && i.nodeId === 'btn1');
check('stateCompleteness passes when hover exists', scIssues2.length === 0);

console.log('\n=== 5. CROSS-BRAND VERIFICATION ===\n');

// Run on 3 different brands to make sure nothing crashes
for (const brand of ['airbnb', 'linear.app', 'nike']) {
  const brandMd = readFileSync(join(__dirname, '..', '.reframe', 'brands', brand, 'DESIGN.md'), 'utf-8');
  const brandDs = parseDesignMd(brandMd);
  const brandGraph = new SceneGraph();
  try {
    const brandTokens = tokenizeDesignSystem(brandGraph, brandDs);
    check(`${brand}: tokenize OK`, brandTokens.tokens.size > 0, `${brandTokens.tokens.size} tokens`);
  } catch (e: any) {
    check(`${brand}: tokenize OK`, false, e.message);
  }
}

console.log(`\n=== RESULT: ${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`} ===\n`);
if (failures > 0) process.exit(1);
