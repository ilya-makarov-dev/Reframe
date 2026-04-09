/**
 * INode Conformance Spec — Design System Specifications
 *
 * Tests the DESIGN.md pipeline: extract → export → parse roundtrip.
 * Ensures brand tokens survive the markdown serialization cycle.
 */

import type { FunctionalSpec } from './types';
import { build, frame, rect, text, solid } from '../builder';
import { importFromHtml } from '../importers/html';
import { setHost } from '../host/context';
import { StandaloneHost } from '../adapters/standalone/adapter';
import { StandaloneNode } from '../adapters/standalone/node';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { extractDesignSystemFromFrame } from '../design-system/extractor';
import { exportDesignMd } from '../design-system/exporter';
import { parseDesignMd } from '../design-system/parser';

// ─── Helper: build INode from builder scene ──────────────────

function buildINode(scene: ReturnType<typeof frame>) {
  const { root, graph } = build(scene);
  const node = graph.getNode(root.id)!;
  setHost(new StandaloneHost(graph));
  return new StandaloneNode(graph, node);
}

// ─── Helper: full roundtrip ──────────────────────────────────

function extractAndRoundtrip(inode: StandaloneNode, brand?: string) {
  const ds = extractDesignSystemFromFrame(inode, brand);
  const md = exportDesignMd(ds);
  const parsed = parseDesignMd(md);
  return { ds, md, parsed };
}

// ─── Specs ───────────────────────────────────────────────────

export const DESIGN_SYSTEM_SPECS: FunctionalSpec[] = [

  // ─── Color Extraction ────────────────────────────────────

  {
    name: 'ds/extract-colors-primary',
    category: 'design-system',
    test: () => {
      const inode = buildINode(
        frame({ width: 800, height: 600, name: 'Banner', fills: [solid('#FFFFFF')] },
          // Vivid blue button — should be primary (high saturation)
          frame({ width: 200, height: 56, name: 'CTA Button', fills: [solid('#0071E3')], cornerRadius: 28 },
            text('Get Started', { fontSize: 16, fontWeight: 600, fills: [solid('#FFFFFF')] }),
          ),
          // Body text — should be text color
          text('Welcome to our platform', { fontSize: 16, fills: [solid('#1D1D1F')], width: 400, height: 24 }),
          text('Discover features', { fontSize: 16, fills: [solid('#1D1D1F')], width: 400, height: 24 }),
          // Title
          text('Platform', { fontSize: 48, fontWeight: 700, fills: [solid('#1D1D1F')], width: 600, height: 60 }),
        ),
      );

      const ds = extractDesignSystemFromFrame(inode, 'TestBrand');

      // Should extract background
      if (!ds.colors.background) return 'missing background color';
      // Should extract some colors in roles
      if (ds.colors.roles.size < 2) return `only ${ds.colors.roles.size} color roles extracted`;

      return true;
    },
  },

  {
    name: 'ds/extract-colors-roundtrip',
    category: 'design-system',
    test: () => {
      const inode = buildINode(
        frame({ width: 800, height: 600, name: 'Banner', fills: [solid('#F5F5F7')] },
          frame({ width: 200, height: 56, name: 'Button', fills: [solid('#0071E3')], cornerRadius: 28 },
            text('Click', { fontSize: 16, fontWeight: 600, fills: [solid('#FFFFFF')] }),
          ),
          text('Hello World', { fontSize: 32, fontWeight: 700, fills: [solid('#1D1D1F')], width: 400, height: 48 }),
          text('Subtitle here', { fontSize: 18, fills: [solid('#86868B')], width: 400, height: 28 }),
        ),
      );

      const { ds, parsed } = extractAndRoundtrip(inode, 'TestBrand');

      // Colors should survive roundtrip
      if (ds.colors.roles.size === 0) return 'no colors extracted';
      if (parsed.colors.roles.size === 0) return 'no colors after roundtrip parse';

      // At least the primary roles should survive
      const origRoles = [...ds.colors.roles.keys()];
      const parsedRoles = [...parsed.colors.roles.keys()];
      if (parsedRoles.length < origRoles.length * 0.5) {
        return `color roles lost: ${origRoles.length} → ${parsedRoles.length}`;
      }

      return true;
    },
  },

  // ─── Typography Extraction ───────────────────────────────

  {
    name: 'ds/extract-typography-roles',
    category: 'design-system',
    test: () => {
      const inode = buildINode(
        frame({ width: 800, height: 600, name: 'Banner', fills: [solid('#FFFFFF')] },
          text('Big Hero Title', { fontSize: 64, fontWeight: 700, fills: [solid('#000000')], width: 600, height: 80 }),
          text('Section Title', { fontSize: 32, fontWeight: 600, fills: [solid('#000000')], width: 400, height: 48 }),
          text('Body text paragraph with more content', { fontSize: 16, fontWeight: 400, fills: [solid('#333333')], width: 400, height: 24 }),
          text('Another body line here', { fontSize: 16, fontWeight: 400, fills: [solid('#333333')], width: 400, height: 24 }),
          text('Fine print disclaimer', { fontSize: 12, fontWeight: 400, fills: [solid('#999999')], width: 300, height: 18 }),
        ),
      );

      const ds = extractDesignSystemFromFrame(inode);
      const h = ds.typography.hierarchy;

      if (h.length < 3) return `only ${h.length} typography rules (expected ≥3)`;

      // Largest should be hero or title role
      const largest = h[0];
      if (largest.fontSize < 48) return `largest fontSize ${largest.fontSize}, expected ≥48`;
      if (!['hero', 'title', 'display'].includes(largest.role)) return `largest role is "${largest.role}", expected hero/title`;

      // Should have a body-like role
      const bodyLike = h.find(r => r.fontSize >= 14 && r.fontSize <= 18);
      if (!bodyLike) return 'no body-size typography rule found';

      return true;
    },
  },

  {
    name: 'ds/typography-roundtrip',
    category: 'design-system',
    test: () => {
      const inode = buildINode(
        frame({ width: 800, height: 600, name: 'Banner', fills: [solid('#FFFFFF')] },
          text('Hero', { fontSize: 72, fontWeight: 700, fills: [solid('#000000')], width: 600, height: 90 }),
          text('Title', { fontSize: 36, fontWeight: 600, fills: [solid('#000000')], width: 400, height: 48 }),
          text('Body text', { fontSize: 16, fontWeight: 400, fills: [solid('#333333')], width: 400, height: 24 }),
        ),
      );

      const { ds, parsed } = extractAndRoundtrip(inode);

      if (ds.typography.hierarchy.length === 0) return 'no typography extracted';
      if (parsed.typography.hierarchy.length === 0) return 'no typography after parse';

      // Font sizes should survive roundtrip
      const origSizes = ds.typography.hierarchy.map(r => r.fontSize).sort((a, b) => b - a);
      const parsedSizes = parsed.typography.hierarchy.map(r => r.fontSize).sort((a, b) => b - a);

      if (parsedSizes.length < origSizes.length) {
        return `typography rules lost: ${origSizes.length} → ${parsedSizes.length}`;
      }

      // Largest font size should match within tolerance
      if (Math.abs(origSizes[0] - parsedSizes[0]) > 1) {
        return `hero fontSize mismatch: ${origSizes[0]} → ${parsedSizes[0]}`;
      }

      // Font weights should survive roundtrip
      for (const orig of ds.typography.hierarchy) {
        const match = parsed.typography.hierarchy.find(p =>
          Math.abs(p.fontSize - orig.fontSize) <= 2
        );
        if (!match) {
          return `typography role ${orig.role} (${orig.fontSize}px) lost after roundtrip`;
        }
        if (Math.abs(match.fontWeight - orig.fontWeight) > 100) {
          return `fontWeight for ${orig.role}: ${orig.fontWeight} → ${match.fontWeight}`;
        }
      }

      return true;
    },
  },

  // ─── Layout Extraction ───────────────────────────────────

  {
    name: 'ds/extract-layout-spacing',
    category: 'design-system',
    test: () => {
      const inode = buildINode(
        frame({ width: 800, height: 600, name: 'Banner', fills: [solid('#FFFFFF')], layoutMode: 'VERTICAL', itemSpacing: 24 },
          text('Title', { fontSize: 32, fontWeight: 700, fills: [solid('#000000')], width: 400, height: 48 }),
          text('Body', { fontSize: 16, fills: [solid('#333333')], width: 400, height: 24 }),
          frame({ width: 200, height: 48, fills: [solid('#0066CC')], cornerRadius: 8 },
            text('Button', { fontSize: 14, fontWeight: 600, fills: [solid('#FFFFFF')] }),
          ),
        ),
      );

      const ds = extractDesignSystemFromFrame(inode);

      // Should detect spacing unit
      if (!ds.layout.spacingUnit || ds.layout.spacingUnit < 4) {
        return `spacingUnit=${ds.layout.spacingUnit}, expected ≥4`;
      }

      // Should have border-radius scale
      if (ds.layout.borderRadiusScale.length === 0) {
        return 'empty borderRadiusScale';
      }

      return true;
    },
  },

  {
    name: 'ds/layout-roundtrip',
    category: 'design-system',
    test: () => {
      const inode = buildINode(
        frame({ width: 800, height: 600, name: 'Banner', fills: [solid('#FFFFFF')], layoutMode: 'VERTICAL', itemSpacing: 16 },
          rect({ width: 760, height: 200, fills: [solid('#F0F0F0')], cornerRadius: 12 }),
          rect({ width: 760, height: 200, fills: [solid('#E0E0E0')], cornerRadius: 8 }),
        ),
      );

      const { ds, parsed } = extractAndRoundtrip(inode);

      // Spacing unit should survive
      if (parsed.layout.spacingUnit < 4) {
        return `spacingUnit lost: ${ds.layout.spacingUnit} → ${parsed.layout.spacingUnit}`;
      }

      // Border-radius scale should survive
      if (parsed.layout.borderRadiusScale.length === 0) {
        return `borderRadiusScale lost after roundtrip`;
      }

      return true;
    },
  },

  // ─── Button Detection ────────────────────────────────────

  {
    name: 'ds/extract-button-spec',
    category: 'design-system',
    test: () => {
      const inode = buildINode(
        frame({ width: 800, height: 600, name: 'Banner', fills: [solid('#FFFFFF')] },
          text('Welcome', { fontSize: 48, fontWeight: 700, fills: [solid('#000000')], width: 600, height: 60 }),
          // Pill button — name matches, has border-radius, fill, text child
          frame({ width: 220, height: 56, name: 'CTA Button', fills: [solid('#FF6600')], cornerRadius: 28 },
            text('Get Started', { fontSize: 16, fontWeight: 600, fills: [solid('#FFFFFF')] }),
          ),
        ),
      );

      const ds = extractDesignSystemFromFrame(inode);

      if (!ds.components.button) return 'no button detected';
      if (ds.components.button.style !== 'pill') {
        return `button style: "${ds.components.button.style}", expected "pill"`;
      }
      if (ds.components.button.borderRadius < 20) {
        return `button radius: ${ds.components.button.borderRadius}, expected ≥20 for pill`;
      }

      return true;
    },
  },

  // ─── Parse Robustness ────────────────────────────────────

  {
    name: 'ds/parse-handwritten-designmd',
    category: 'design-system',
    test: () => {
      const md = `# Acme Corp — DESIGN.md

## Color Palette & Roles
| Role | Hex |
|------|-----|
| primary | \`#0071E3\` |
| background | \`#FFFFFF\` |
| text | \`#1D1D1F\` |
| accent | \`#FF6B35\` |
| muted | \`#86868B\` |

## Typography Rules
| Role | Size | Weight | Line Height | Letter Spacing |
|------|------|--------|-------------|----------------|
| hero | 72px | 700 | 1.07 | -2px |
| title | 36px | 600 | 1.2 | 0px |
| body | 16px | 400 | 1.5 | 0px |
| caption | 12px | 400 | 1.4 | 0.5px |

## Component Stylings
**Button**: pill (border-radius: 9999px)
- Font weight: 600
- Text transform: uppercase

## Layout Principles
- Spacing unit: 8px
- Border radius scale: 0, 4, 8, 12, 16, 9999px
`;

      const ds = parseDesignMd(md);

      // Colors
      if (!ds.colors.primary) return 'missing primary color';
      if (!ds.colors.primary.includes('0071')) return `primary="${ds.colors.primary}", expected #0071E3`;
      if (!ds.colors.background) return 'missing background';
      if (!ds.colors.text) return 'missing text color';
      if (ds.colors.roles.size < 4) return `only ${ds.colors.roles.size} roles, expected ≥4`;

      // Typography
      if (ds.typography.hierarchy.length < 3) return `only ${ds.typography.hierarchy.length} typo rules`;
      const hero = ds.typography.hierarchy.find(r => r.role === 'hero');
      if (!hero) return 'no hero typography role';
      if (hero.fontSize !== 72) return `hero size=${hero.fontSize}, expected 72`;
      if (hero.fontWeight !== 700) return `hero weight=${hero.fontWeight}, expected 700`;

      // Button
      if (!ds.components.button) return 'no button component';
      if (ds.components.button.style !== 'pill') return `button style="${ds.components.button.style}"`;

      // Layout
      if (ds.layout.spacingUnit !== 8) return `spacingUnit=${ds.layout.spacingUnit}, expected 8`;
      if (ds.layout.borderRadiusScale.length < 4) return `radius scale has ${ds.layout.borderRadiusScale.length} values`;

      return true;
    },
  },

  {
    name: 'ds/parse-minimal-designmd',
    category: 'design-system',
    test: () => {
      // Minimal format that AI agents might produce
      const md = `# MyBrand

## Colors
**primary**: #3366FF
**background**: #FAFAFA
**text**: #222222

## Typography
- Hero: 64px / Bold
- Body: 16px / Regular
`;

      const ds = parseDesignMd(md);

      // Should still extract something useful
      if (ds.colors.roles.size === 0) return 'zero colors from minimal format';
      if (ds.typography.hierarchy.length === 0) return 'zero typography from minimal format';

      return true;
    },
  },

  {
    name: 'ds/parse-etalon-freeform-nonstandard',
    category: 'design-system',
    test: () => {
      const md = `# BrandX

### Palette
- primary: #5B6CFF
- background: #0B1020
- text: #E5E7EB
- surface: #111827

### Type Scale
- Heading: 48 / 700 / line-height 1.1
- Subheading: 24 / Medium / line-height 1.3
- Body: 16 / Regular / line-height 1.5

### UI
**Button**: rounded
- border-radius: 10px
- font-weight: 600
- text-transform: uppercase

### Grid
- Base unit: 10px
- Border radius scale: 0, 4, 8, 10, 16, 9999
`;

      const ds = parseDesignMd(md);

      if (ds.colors.roles.size < 4) return `colors not parsed enough: ${ds.colors.roles.size}`;
      if (!ds.colors.primary || !ds.colors.primary.toLowerCase().includes('5b6cff')) return `bad primary: ${ds.colors.primary}`;
      if (ds.typography.hierarchy.length < 3) return `typography not parsed: ${ds.typography.hierarchy.length}`;
      const title = ds.typography.hierarchy.find(r => r.role === 'title');
      if (!title) return 'missing title rule from "Heading" alias';
      if (Math.round(title.fontSize) !== 48) return `title size mismatch: ${title.fontSize}`;
      if (!ds.components.button) return 'missing button';
      if (ds.components.button.borderRadius !== 10) return `button radius mismatch: ${ds.components.button.borderRadius}`;
      if (ds.components.button.fontWeight !== 600) return `button font weight mismatch: ${ds.components.button.fontWeight}`;
      if (ds.components.button.textTransform !== 'uppercase') return `button transform mismatch: ${ds.components.button.textTransform}`;
      if (ds.layout.spacingUnit !== 10) return `spacing mismatch: ${ds.layout.spacingUnit}`;

      return true;
    },
  },

  {
    name: 'ds/parse-rgb-colors',
    category: 'design-system',
    test: () => {
      const md = `# RGBBrand

## Colors
- primary: rgb(99, 102, 241)
- background: rgb(9, 9, 11)
- text: rgb(250, 250, 250)
`;
      const ds = parseDesignMd(md);
      if (!ds.colors.primary) return 'missing rgb primary';
      if (ds.colors.primary.toLowerCase() !== '#6366f1') return `rgb->hex primary mismatch: ${ds.colors.primary}`;
      if (!ds.colors.background || ds.colors.background.toLowerCase() !== '#09090b') return `rgb->hex bg mismatch: ${ds.colors.background}`;
      if (!ds.colors.text || ds.colors.text.toLowerCase() !== '#fafafa') return `rgb->hex text mismatch: ${ds.colors.text}`;
      return true;
    },
  },

  // ─── Full Pipeline: HTML → extract → markdown → parse ───

  {
    name: 'ds/html-to-designmd-roundtrip',
    category: 'design-system',
    test: async () => {
      const html = `
<div style="width:800px;height:600px;background:#FFFFFF;display:flex;flex-direction:column;align-items:center;padding:40px;gap:24px">
  <h1 style="font-size:48px;font-weight:700;color:#1D1D1F;margin:0">Welcome</h1>
  <p style="font-size:18px;color:#86868B;margin:0">Discover what's possible</p>
  <button style="background:#0071E3;color:#FFFFFF;font-size:16px;font-weight:600;padding:12px 32px;border-radius:9999px;border:none">Get Started</button>
</div>`;

      // Import HTML → INode
      const { graph, rootId } = await importFromHtml(html);
      setHost(new StandaloneHost(graph));
      const root = new StandaloneNode(graph, graph.getNode(rootId)!);

      // Extract → Export → Parse
      const ds = extractDesignSystemFromFrame(root, 'TestBrand');
      const md = exportDesignMd(ds);
      const parsed = parseDesignMd(md);

      // Validate the full roundtrip
      if (ds.typography.hierarchy.length === 0) return 'extraction produced no typography';
      if (parsed.typography.hierarchy.length === 0) return 'parse lost all typography';

      // Markdown should contain recognizable content
      if (!md.includes('TestBrand')) return 'brand name missing from markdown';
      if (!md.includes('##')) return 'no sections in markdown';

      // Colors should survive full pipeline
      if (ds.colors.roles.size === 0) return 'no colors extracted from HTML';
      if (parsed.colors.roles.size === 0) return 'colors lost after markdown roundtrip';

      return true;
    },
  },

  // ─── Linkedom + Design System integration ────────────────

  {
    name: 'ds/extract-from-styled-html',
    category: 'design-system',
    test: async () => {
      // Real-world pattern: CSS in <style> block with selectors, not inline styles
      const html = `
<div style="width:800px;height:600px;background:#FAFAFA">
  <style>
    .hero { font-size: 56px; font-weight: 700; color: #1A1A2E; }
    .body-text { font-size: 16px; color: #4A4A68; }
    .cta-btn { background: #E94560; color: #FFFFFF; font-size: 14px; font-weight: 600; border-radius: 9999px; }
    .card { background: #FFFFFF; border-radius: 12px; }
  </style>
  <div class="card" style="width:700px;height:500px;padding:40px;display:flex;flex-direction:column;gap:24px">
    <h1 class="hero">Welcome</h1>
    <p class="body-text">Build something amazing with our platform</p>
    <div class="cta-btn" style="width:180px;height:48px;display:flex;align-items:center;justify-content:center">
      <span style="color:#FFFFFF;font-size:14px;font-weight:600">Get Started</span>
    </div>
  </div>
</div>`;

      const { graph, rootId } = await importFromHtml(html);
      setHost(new StandaloneHost(graph));
      const root = new StandaloneNode(graph, graph.getNode(rootId)!);

      const ds = extractDesignSystemFromFrame(root, 'StyledBrand');
      const md = exportDesignMd(ds);
      const parsed = parseDesignMd(md);

      // Should extract colors from <style> block (linkedom resolves .hero, .cta-btn, etc.)
      if (ds.colors.roles.size < 2) return `only ${ds.colors.roles.size} colors from styled HTML`;

      // Typography should include the hero size (56px from .hero class)
      const hasLargeFont = ds.typography.hierarchy.some(r => r.fontSize >= 48);
      if (!hasLargeFont) return 'hero font size (56px from .hero class) not extracted — linkedom CSS resolution failed';

      // Roundtrip: markdown → parse should preserve
      if (parsed.typography.hierarchy.length === 0) return 'typography lost after roundtrip';
      if (parsed.colors.roles.size === 0) return 'colors lost after roundtrip';

      return true;
    },
  },

  {
    name: 'ds/extract-specificity-correct-colors',
    category: 'design-system',
    test: async () => {
      // CSS specificity test: #id overrides .class overrides tag
      const html = `
<div style="width:600px;height:400px;background:#FFFFFF">
  <style>
    p { color: #999999; font-size: 14px; }
    .branded { color: #0066CC; }
    #hero-title { color: #FF3366; font-size: 48px; font-weight: 700; }
  </style>
  <p id="hero-title" class="branded">Hero Title</p>
  <p class="branded">Branded paragraph</p>
  <p>Plain paragraph</p>
</div>`;

      const { graph, rootId } = await importFromHtml(html);
      const heroNode = graph.getNode(rootId)!;
      // First child should be the hero — check that #id color (#FF3366) won
      const children = heroNode.childIds.map(id => graph.getNode(id)!);
      const hero = children[0];

      if (!hero) return 'no hero node found';
      if (hero.fontSize !== 48) return `hero fontSize=${hero.fontSize}, expected 48 (#id should override)`;

      // Check hero fill color is #FF3366 (r≈1, g≈0.2, b≈0.4)
      const fills = hero.fills as any[];
      if (!fills || fills.length === 0) return 'hero has no fills';
      const r = fills[0]?.color?.r;
      if (typeof r !== 'number' || r < 0.9) return `hero color.r=${r}, expected ~1.0 (#FF3366 from #id selector)`;

      return true;
    },
  },

  // ─── getdesign npm: parser coverage across all brands ───

  {
    name: 'ds/getdesign-parser-coverage',
    category: 'design-system',
    test: () => {
      const brandsDir = join(__dirname, '..', '..', '..', '..', '.reframe', 'brands');
      if (!existsSync(brandsDir)) return 'skip: .reframe/brands/ not found (run npx getdesign add <slug> first)';

      const slugs = readdirSync(brandsDir).filter(d =>
        existsSync(join(brandsDir, d, 'DESIGN.md')),
      );
      if (slugs.length === 0) return 'skip: no brands downloaded';

      const failures: string[] = [];

      for (const slug of slugs) {
        const md = readFileSync(join(brandsDir, slug, 'DESIGN.md'), 'utf-8');
        const ds = parseDesignMd(md);
        const missing: string[] = [];

        if (!ds.colors.primary) missing.push('primary');
        if (!ds.colors.background) missing.push('background');
        if (!ds.colors.text) missing.push('text');
        if (ds.typography.hierarchy.length < 3) missing.push(`typography(${ds.typography.hierarchy.length}/3)`);
        if (!ds.typography.hierarchy.some(r => r.fontFamily)) missing.push('fontFamily');
        if (!ds.layout.borderRadiusScale || ds.layout.borderRadiusScale.length < 2) missing.push('radiusScale');

        if (missing.length > 0) {
          failures.push(`${slug}: ${missing.join(', ')}`);
        }
      }

      if (failures.length > 0) {
        return `${failures.length}/${slugs.length} brands failed:\n${failures.join('\n')}`;
      }

      return true;
    },
  },
];
