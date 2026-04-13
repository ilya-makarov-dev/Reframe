/**
 * Starter Block Library
 *
 * Generates ~30 block definitions from:
 * 1. Existing ui/sections.ts builders (heroSection, featureGrid, etc.)
 * 2. Hand-crafted additional blocks using the builder API
 *
 * Each block is built → serialized → wrapped in a BlockDefinition.
 */

import { build, frame, text, rect, solid, ellipse } from '../builder';
import type { NodeBlueprint, NodeProps } from '../builder';
import { serializeGraph } from '../serialize';
import type { BlockDefinition, BlockSlot } from './types';
import { registerBlock } from './registry';
import {
  heroSection,
  featureGrid,
  pricingSection,
  testimonialSection,
  ctaSection,
  footerSection,
  navbarSection,
  logoBar,
  statsBar,
} from '../ui/sections';

// ─── Helpers ────────────────────────────────────────────────

function blueprintToTree(bp: NodeBlueprint) {
  const { graph, root } = build(bp);
  const rootId = (root as any).id ?? graph.nodes.keys().next().value;
  return serializeGraph(graph, rootId);
}

function makeBlock(
  category: BlockDefinition['category'],
  name: string,
  description: string,
  slots: BlockSlot[],
  blueprint: NodeBlueprint,
  tags?: string[],
): BlockDefinition {
  const scene = blueprintToTree(blueprint);
  return {
    version: 1,
    category,
    name,
    description,
    tags: tags ?? [category],
    slots,
    tree: scene.root,
  };
}

// ─── Section frame helper (matches ui/sections.ts pattern) ──

function sectionFrame(
  name: string,
  padV: number, padH: number,
  bg: string,
  ...children: NodeBlueprint[]
): NodeBlueprint {
  return frame({
    name,
    width: 1440,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FILL',
    counterAxisAlign: 'STRETCH',
    paddingTop: padV, paddingBottom: padV,
    paddingLeft: padH, paddingRight: padH,
    itemSpacing: 24,
    fills: [solid(bg)],
  }, ...children);
}

function textNode(content: string, props: Partial<NodeProps> = {}): NodeBlueprint {
  return text(content, {
    fontSize: 16,
    fills: [solid('#1A1A1A')],
    textAutoResize: 'WIDTH_AND_HEIGHT',
    ...props,
  });
}

function row(gap: number, ...children: NodeBlueprint[]): NodeBlueprint {
  return frame({
    name: 'Row',
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    itemSpacing: gap,
  }, ...children);
}

function col(gap: number, ...children: NodeBlueprint[]): NodeBlueprint {
  return frame({
    name: 'Column',
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    itemSpacing: gap,
  }, ...children);
}

function btnPrimary(label: string): NodeBlueprint {
  return frame({
    name: 'Button',
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    paddingTop: 14, paddingBottom: 14,
    paddingLeft: 32, paddingRight: 32,
    cornerRadius: 8,
    fills: [solid('#0071E3')],
    semanticRole: 'button',
  }, text(label, { fontSize: 16, fontWeight: 600, fills: [solid('#FFFFFF')], textAutoResize: 'WIDTH_AND_HEIGHT' }));
}

function btnOutline(label: string): NodeBlueprint {
  return frame({
    name: 'ButtonOutline',
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    paddingTop: 14, paddingBottom: 14,
    paddingLeft: 32, paddingRight: 32,
    cornerRadius: 8,
    fills: [],
    strokes: [{ type: 'SOLID' as const, color: { r: 0, g: 0.443, b: 0.89, a: 1 }, visible: true }],
    strokeWeight: 2,
    semanticRole: 'button',
  }, text(label, { fontSize: 16, fontWeight: 600, fills: [solid('#0071E3')], textAutoResize: 'WIDTH_AND_HEIGHT' }));
}

function featureCard(icon: string, title: string, desc: string): NodeBlueprint {
  return frame({
    name: 'FeatureCard',
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FILL',
    paddingTop: 32, paddingBottom: 32,
    paddingLeft: 24, paddingRight: 24,
    itemSpacing: 12,
    cornerRadius: 12,
    fills: [solid('#FFFFFF')],
    semanticRole: 'card',
  },
    text(icon, { fontSize: 32, textAutoResize: 'WIDTH_AND_HEIGHT' }),
    text(title, { fontSize: 20, fontWeight: 700, fills: [solid('#1A1A1A')], textAutoResize: 'WIDTH_AND_HEIGHT' }),
    text(desc, { fontSize: 15, fills: [solid('#666666')], textAutoResize: 'WIDTH_AND_HEIGHT', lineHeight: 24 }),
  );
}

function pricingCard(tier: string, price: string, features: string[], highlighted: boolean): NodeBlueprint {
  const featureColor = highlighted ? '#FFFFFFCC' : '#444444';
  const featureNodes = features.map(f =>
    text(`✓  ${f}`, { fontSize: 14, fills: [solid(featureColor)], textAutoResize: 'WIDTH_AND_HEIGHT', lineHeight: 28 })
  );
  return frame({
    name: `Pricing-${tier}`,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FILL',
    paddingTop: 40, paddingBottom: 40,
    paddingLeft: 32, paddingRight: 32,
    itemSpacing: 20,
    cornerRadius: 16,
    fills: [solid(highlighted ? '#0071E3' : '#FFFFFF')],
    strokes: highlighted ? [] : [{ type: 'SOLID' as const, color: { r: 0.9, g: 0.9, b: 0.9, a: 1 }, visible: true }],
    strokeWeight: highlighted ? 0 : 1,
    semanticRole: 'card',
  },
    text(tier, { fontSize: 14, fontWeight: 600, fills: [solid(highlighted ? '#FFFFFF99' : '#666666')], textAutoResize: 'WIDTH_AND_HEIGHT', letterSpacing: 1.5 }),
    text(price, { fontSize: 48, fontWeight: 800, fills: [solid(highlighted ? '#FFFFFF' : '#1A1A1A')], textAutoResize: 'WIDTH_AND_HEIGHT' }),
    col(4, ...featureNodes),
    btnPrimary('Get Started'),
  );
}

// ─── Block Generators ───────────────────────────────────────

function heroBlocks(): BlockDefinition[] {
  return [
    makeBlock('hero', 'hero-centered', 'Centered hero with headline, subtitle, and CTA buttons', [
      { name: 'headline', role: 'heading', type: 'text', defaultValue: 'Build Something Amazing' },
      { name: 'subtitle', role: 'paragraph', type: 'text', defaultValue: 'The fastest way to ship your next big idea.' },
      { name: 'cta', role: 'button', type: 'text', defaultValue: 'Get Started' },
    ], sectionFrame('Hero', 120, 80, '#FAFAFA',
      col(24,
        textNode('Build Something Amazing', { name: 'headline', fontSize: 64, fontWeight: 800, fills: [solid('#1A1A1A')], textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER' }),
        textNode('The fastest way to ship your next big idea.', { name: 'subtitle', fontSize: 20, fills: [solid('#666666')], textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER' }),
        row(16, btnPrimary('Get Started'), btnOutline('Learn More')),
      ),
    ), ['centered', 'minimal']),

    makeBlock('hero', 'hero-split', 'Split hero — text left, visual right', [
      { name: 'headline', role: 'heading', type: 'text', defaultValue: 'Ship Faster Than Ever' },
      { name: 'subtitle', role: 'paragraph', type: 'text', defaultValue: 'Deploy in seconds, not hours.' },
      { name: 'cta', role: 'button', type: 'text', defaultValue: 'Start Free' },
    ], sectionFrame('HeroSplit', 80, 80, '#FFFFFF',
      frame({ name: 'SplitRow', layoutMode: 'HORIZONTAL', primaryAxisSizing: 'HUG', counterAxisSizing: 'FILL', itemSpacing: 64 },
        col(24,
          textNode('Ship Faster Than Ever', { name: 'headline', fontSize: 56, fontWeight: 800, fills: [solid('#1A1A1A')] }),
          textNode('Deploy in seconds, not hours. Our platform handles the complexity.', { name: 'subtitle', fontSize: 18, fills: [solid('#555555')], lineHeight: 28 }),
          row(16, btnPrimary('Start Free'), btnOutline('See Demo')),
        ),
        rect({ name: 'visual', width: 560, height: 420, cornerRadius: 16, fills: [solid('#E8E4F0')] }),
      ),
    ), ['split', 'image']),

    makeBlock('hero', 'hero-gradient', 'Hero with gradient background', [
      { name: 'headline', role: 'heading', type: 'text', defaultValue: 'The Future is Here' },
      { name: 'subtitle', role: 'paragraph', type: 'text', defaultValue: 'Experience next-generation design tools.' },
      { name: 'cta', role: 'button', type: 'text', defaultValue: 'Try Now' },
    ], frame({
      name: 'HeroGradient', width: 1440,
      layoutMode: 'VERTICAL', primaryAxisSizing: 'HUG', counterAxisSizing: 'FILL',
      counterAxisAlign: 'CENTER', primaryAxisAlign: 'CENTER',
      paddingTop: 160, paddingBottom: 160, paddingLeft: 80, paddingRight: 80,
      itemSpacing: 24,
      fills: [solid('#0F0F23')],
    },
      textNode('The Future is Here', { name: 'headline', fontSize: 72, fontWeight: 900, fills: [solid('#FFFFFF')], textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER' }),
      textNode('Experience next-generation design tools.', { name: 'subtitle', fontSize: 20, fills: [solid('#AAAACC')], textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER' }),
      btnPrimary('Try Now'),
    ), ['dark', 'gradient']),
  ];
}

function featureBlocks(): BlockDefinition[] {
  return [
    makeBlock('features', 'features-grid-3col', 'Three-column feature grid with icons', [
      { name: 'title', role: 'heading', type: 'text', defaultValue: 'Why Choose Us' },
      { name: 'feature1', role: 'heading', type: 'text', defaultValue: 'Fast' },
      { name: 'feature2', role: 'heading', type: 'text', defaultValue: 'Secure' },
      { name: 'feature3', role: 'heading', type: 'text', defaultValue: 'Reliable' },
    ], sectionFrame('Features', 96, 80, '#FFFFFF',
      textNode('Why Choose Us', { name: 'title', fontSize: 40, fontWeight: 800, fills: [solid('#1A1A1A')], textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER' }),
      row(32,
        featureCard('⚡', 'Lightning Fast', 'Built for speed from the ground up. Every millisecond matters.'),
        featureCard('🔒', 'Enterprise Security', 'Bank-grade encryption and compliance built in.'),
        featureCard('🌍', 'Global Scale', '99.99% uptime with edge deployment worldwide.'),
      ),
    ), ['grid', '3col', 'icons']),

    makeBlock('features', 'features-alternating', 'Alternating left-right feature sections', [
      { name: 'feature1_title', role: 'heading', type: 'text', defaultValue: 'Design at Scale' },
      { name: 'feature2_title', role: 'heading', type: 'text', defaultValue: 'Ship with Confidence' },
    ], sectionFrame('FeaturesAlt', 80, 80, '#FFFFFF',
      frame({ name: 'Row1', layoutMode: 'HORIZONTAL', primaryAxisSizing: 'HUG', counterAxisSizing: 'FILL', itemSpacing: 64 },
        col(16,
          textNode('Design at Scale', { name: 'feature1_title', fontSize: 36, fontWeight: 700, fills: [solid('#1A1A1A')] }),
          textNode('Create thousands of variations from a single source of truth.', { fontSize: 16, fills: [solid('#555555')], lineHeight: 26 }),
        ),
        rect({ name: 'visual1', width: 560, height: 340, cornerRadius: 12, fills: [solid('#F0F0FF')] }),
      ),
      frame({ name: 'Row2', layoutMode: 'HORIZONTAL', primaryAxisSizing: 'HUG', counterAxisSizing: 'FILL', itemSpacing: 64 },
        rect({ name: 'visual2', width: 560, height: 340, cornerRadius: 12, fills: [solid('#F0FFF0')] }),
        col(16,
          textNode('Ship with Confidence', { name: 'feature2_title', fontSize: 36, fontWeight: 700, fills: [solid('#1A1A1A')] }),
          textNode('Automated quality checks ensure every export meets your standards.', { fontSize: 16, fills: [solid('#555555')], lineHeight: 26 }),
        ),
      ),
    ), ['alternating', 'zigzag']),
  ];
}

function pricingBlocks(): BlockDefinition[] {
  return [
    makeBlock('pricing', 'pricing-3col', 'Three-tier pricing table', [
      { name: 'title', role: 'heading', type: 'text', defaultValue: 'Simple Pricing' },
    ], sectionFrame('Pricing', 96, 80, '#FAFAFA',
      textNode('Simple Pricing', { name: 'title', fontSize: 40, fontWeight: 800, fills: [solid('#1A1A1A')], textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER' }),
      textNode('No hidden fees. Cancel anytime.', { fontSize: 18, fills: [solid('#666666')], textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER' }),
      row(24,
        pricingCard('STARTER', '$9/mo', ['5 projects', '1 GB storage', 'Email support'], false),
        pricingCard('PRO', '$29/mo', ['Unlimited projects', '10 GB storage', 'Priority support', 'API access'], true),
        pricingCard('ENTERPRISE', '$99/mo', ['Everything in Pro', 'Unlimited storage', 'Dedicated support', 'SSO & SAML', 'Custom integrations'], false),
      ),
    ), ['3col', 'tiers']),
  ];
}

function testimonialBlocks(): BlockDefinition[] {
  return [
    makeBlock('testimonials', 'testimonials-grid', 'Grid of testimonial cards', [
      { name: 'title', role: 'heading', type: 'text', defaultValue: 'What Our Customers Say' },
    ], sectionFrame('Testimonials', 96, 80, '#FFFFFF',
      textNode('What Our Customers Say', { name: 'title', fontSize: 40, fontWeight: 800, fills: [solid('#1A1A1A')], textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER' }),
      row(24,
        frame({ name: 'Testimonial1', layoutMode: 'VERTICAL', primaryAxisSizing: 'HUG', counterAxisSizing: 'FILL', paddingTop: 32, paddingBottom: 32, paddingLeft: 24, paddingRight: 24, itemSpacing: 16, cornerRadius: 12, fills: [solid('#F9F9F9')], semanticRole: 'card' },
          text('★★★★★', { fontSize: 16, fills: [solid('#F5A623')], textAutoResize: 'WIDTH_AND_HEIGHT' }),
          text('"This tool saved us hundreds of hours. Absolutely game-changing."', { fontSize: 15, fills: [solid('#333333')], textAutoResize: 'WIDTH_AND_HEIGHT', lineHeight: 24 }),
          text('— Sarah Chen, CEO at TechCorp', { fontSize: 13, fills: [solid('#888888')], textAutoResize: 'WIDTH_AND_HEIGHT' }),
        ),
        frame({ name: 'Testimonial2', layoutMode: 'VERTICAL', primaryAxisSizing: 'HUG', counterAxisSizing: 'FILL', paddingTop: 32, paddingBottom: 32, paddingLeft: 24, paddingRight: 24, itemSpacing: 16, cornerRadius: 12, fills: [solid('#F9F9F9')], semanticRole: 'card' },
          text('★★★★★', { fontSize: 16, fills: [solid('#F5A623')], textAutoResize: 'WIDTH_AND_HEIGHT' }),
          text('"The best design infrastructure we\'ve ever used. Period."', { fontSize: 15, fills: [solid('#333333')], textAutoResize: 'WIDTH_AND_HEIGHT', lineHeight: 24 }),
          text('— Marcus Johnson, CTO at DesignLab', { fontSize: 13, fills: [solid('#888888')], textAutoResize: 'WIDTH_AND_HEIGHT' }),
        ),
        frame({ name: 'Testimonial3', layoutMode: 'VERTICAL', primaryAxisSizing: 'HUG', counterAxisSizing: 'FILL', paddingTop: 32, paddingBottom: 32, paddingLeft: 24, paddingRight: 24, itemSpacing: 16, cornerRadius: 12, fills: [solid('#F9F9F9')], semanticRole: 'card' },
          text('★★★★★', { fontSize: 16, fills: [solid('#F5A623')], textAutoResize: 'WIDTH_AND_HEIGHT' }),
          text('"Cut our design-to-production cycle from weeks to days."', { fontSize: 15, fills: [solid('#333333')], textAutoResize: 'WIDTH_AND_HEIGHT', lineHeight: 24 }),
          text('— Aisha Williams, Head of Design at Rapid', { fontSize: 13, fills: [solid('#888888')], textAutoResize: 'WIDTH_AND_HEIGHT' }),
        ),
      ),
    ), ['grid', 'cards', 'reviews']),
  ];
}

function ctaBlocks(): BlockDefinition[] {
  return [
    makeBlock('cta', 'cta-centered', 'Centered call-to-action banner', [
      { name: 'headline', role: 'heading', type: 'text', defaultValue: 'Ready to Get Started?' },
      { name: 'subtitle', role: 'paragraph', type: 'text', defaultValue: 'Join thousands of teams already shipping faster.' },
      { name: 'cta', role: 'button', type: 'text', defaultValue: 'Start Free Trial' },
    ], frame({
      name: 'CTA', width: 1440,
      layoutMode: 'VERTICAL', primaryAxisSizing: 'HUG', counterAxisSizing: 'FILL',
      counterAxisAlign: 'CENTER', primaryAxisAlign: 'CENTER',
      paddingTop: 96, paddingBottom: 96, paddingLeft: 80, paddingRight: 80,
      itemSpacing: 24, fills: [solid('#0071E3')],
    },
      textNode('Ready to Get Started?', { name: 'headline', fontSize: 44, fontWeight: 800, fills: [solid('#FFFFFF')], textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER' }),
      textNode('Join thousands of teams already shipping faster.', { name: 'subtitle', fontSize: 18, fills: [solid('#FFFFFFCC')], textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER' }),
      frame({
        name: 'CTAButton', layoutMode: 'HORIZONTAL', primaryAxisSizing: 'HUG', counterAxisSizing: 'HUG',
        paddingTop: 16, paddingBottom: 16, paddingLeft: 40, paddingRight: 40,
        cornerRadius: 8, fills: [solid('#FFFFFF')], semanticRole: 'button',
      }, text('Start Free Trial', { fontSize: 16, fontWeight: 700, fills: [solid('#0071E3')], textAutoResize: 'WIDTH_AND_HEIGHT' })),
    ), ['banner', 'conversion']),

    makeBlock('cta', 'cta-split', 'Split CTA with text and form', [
      { name: 'headline', role: 'heading', type: 'text', defaultValue: 'Stay in the Loop' },
      { name: 'subtitle', role: 'paragraph', type: 'text', defaultValue: 'Get updates on new features and releases.' },
    ], sectionFrame('CTASplit', 80, 80, '#F5F5F7',
      frame({ name: 'SplitRow', layoutMode: 'HORIZONTAL', primaryAxisSizing: 'HUG', counterAxisSizing: 'FILL', itemSpacing: 64, primaryAxisAlign: 'SPACE_BETWEEN' },
        col(16,
          textNode('Stay in the Loop', { name: 'headline', fontSize: 36, fontWeight: 700, fills: [solid('#1A1A1A')] }),
          textNode('Get updates on new features and releases.', { name: 'subtitle', fontSize: 16, fills: [solid('#666666')], lineHeight: 26 }),
        ),
        row(12,
          frame({ name: 'EmailInput', width: 280, height: 48, cornerRadius: 8, fills: [solid('#FFFFFF')], strokes: [{ type: 'SOLID' as const, color: { r: 0.85, g: 0.85, b: 0.85, a: 1 }, visible: true }], strokeWeight: 1, semanticRole: 'input', layoutMode: 'HORIZONTAL', paddingLeft: 16, paddingRight: 16, counterAxisAlign: 'CENTER' },
            text('your@email.com', { fontSize: 14, fills: [solid('#AAAAAA')], textAutoResize: 'WIDTH_AND_HEIGHT' }),
          ),
          btnPrimary('Subscribe'),
        ),
      ),
    ), ['newsletter', 'email', 'form']),
  ];
}

function statsBlocks(): BlockDefinition[] {
  return [
    makeBlock('stats', 'stats-bar', 'Horizontal stats bar', [
      { name: 'stat1_value', role: 'heading', type: 'text', defaultValue: '10K+' },
      { name: 'stat2_value', role: 'heading', type: 'text', defaultValue: '99.9%' },
      { name: 'stat3_value', role: 'heading', type: 'text', defaultValue: '150+' },
      { name: 'stat4_value', role: 'heading', type: 'text', defaultValue: '24/7' },
    ], sectionFrame('Stats', 64, 80, '#FFFFFF',
      frame({ name: 'StatsRow', layoutMode: 'HORIZONTAL', primaryAxisSizing: 'HUG', counterAxisSizing: 'FILL', itemSpacing: 0, primaryAxisAlign: 'SPACE_BETWEEN' },
        ...[
          ['10K+', 'Active Users'],
          ['99.9%', 'Uptime SLA'],
          ['150+', 'Countries'],
          ['24/7', 'Support'],
        ].map(([val, label]) =>
          col(8,
            textNode(val, { name: `stat_${label.toLowerCase().replace(/\s/g, '_')}`, fontSize: 40, fontWeight: 800, fills: [solid('#0071E3')], textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER' }),
            textNode(label, { fontSize: 14, fills: [solid('#888888')], textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER' }),
          ),
        ),
      ),
    ), ['numbers', 'metrics']),
  ];
}

function footerBlocks(): BlockDefinition[] {
  return [
    makeBlock('footer', 'footer-4col', 'Four-column footer with links', [
      { name: 'brand', role: 'heading', type: 'text', defaultValue: 'Reframe' },
    ], sectionFrame('Footer', 64, 80, '#1A1A1A',
      frame({ name: 'FooterGrid', layoutMode: 'HORIZONTAL', primaryAxisSizing: 'HUG', counterAxisSizing: 'FILL', itemSpacing: 64, primaryAxisAlign: 'SPACE_BETWEEN' },
        col(16,
          textNode('Reframe', { name: 'brand', fontSize: 20, fontWeight: 700, fills: [solid('#FFFFFF')] }),
          textNode('Programmable design infrastructure.', { fontSize: 14, fills: [solid('#888888')], lineHeight: 22 }),
        ),
        col(12,
          textNode('Product', { fontSize: 13, fontWeight: 600, fills: [solid('#FFFFFF')], letterSpacing: 1 }),
          textNode('Features', { fontSize: 14, fills: [solid('#888888')] }),
          textNode('Pricing', { fontSize: 14, fills: [solid('#888888')] }),
          textNode('Changelog', { fontSize: 14, fills: [solid('#888888')] }),
        ),
        col(12,
          textNode('Company', { fontSize: 13, fontWeight: 600, fills: [solid('#FFFFFF')], letterSpacing: 1 }),
          textNode('About', { fontSize: 14, fills: [solid('#888888')] }),
          textNode('Blog', { fontSize: 14, fills: [solid('#888888')] }),
          textNode('Careers', { fontSize: 14, fills: [solid('#888888')] }),
        ),
        col(12,
          textNode('Legal', { fontSize: 13, fontWeight: 600, fills: [solid('#FFFFFF')], letterSpacing: 1 }),
          textNode('Privacy', { fontSize: 14, fills: [solid('#888888')] }),
          textNode('Terms', { fontSize: 14, fills: [solid('#888888')] }),
          textNode('Cookies', { fontSize: 14, fills: [solid('#888888')] }),
        ),
      ),
      rect({ width: 1280, height: 1, fills: [solid('#333333')] }),
      textNode('© 2026 Reframe. All rights reserved.', { fontSize: 13, fills: [solid('#666666')], textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER' }),
    ), ['links', 'legal', 'columns']),

    makeBlock('footer', 'footer-simple', 'Simple single-line footer', [
      { name: 'brand', role: 'heading', type: 'text', defaultValue: 'Reframe' },
    ], sectionFrame('FooterSimple', 32, 80, '#F5F5F7',
      frame({ name: 'FooterRow', layoutMode: 'HORIZONTAL', primaryAxisSizing: 'HUG', counterAxisSizing: 'FILL', primaryAxisAlign: 'SPACE_BETWEEN', counterAxisAlign: 'CENTER' },
        textNode('© 2026 Reframe', { name: 'brand', fontSize: 14, fills: [solid('#888888')] }),
        row(24,
          textNode('Privacy', { fontSize: 14, fills: [solid('#666666')] }),
          textNode('Terms', { fontSize: 14, fills: [solid('#666666')] }),
          textNode('Contact', { fontSize: 14, fills: [solid('#666666')] }),
        ),
      ),
    ), ['minimal', 'copyright']),
  ];
}

function navBlocks(): BlockDefinition[] {
  return [
    makeBlock('nav', 'nav-simple', 'Simple navigation bar', [
      { name: 'brand', role: 'logo', type: 'text', defaultValue: 'Reframe' },
    ], frame({
      name: 'Nav', width: 1440, height: 72,
      layoutMode: 'HORIZONTAL', counterAxisSizing: 'FIXED', primaryAxisSizing: 'FILL',
      primaryAxisAlign: 'SPACE_BETWEEN', counterAxisAlign: 'CENTER',
      paddingLeft: 40, paddingRight: 40,
      fills: [solid('#FFFFFF')],
      semanticRole: 'nav',
    },
      textNode('Reframe', { name: 'brand', fontSize: 18, fontWeight: 700, fills: [solid('#1A1A1A')] }),
      row(32,
        textNode('Product', { fontSize: 14, fontWeight: 500, fills: [solid('#555555')] }),
        textNode('Pricing', { fontSize: 14, fontWeight: 500, fills: [solid('#555555')] }),
        textNode('Docs', { fontSize: 14, fontWeight: 500, fills: [solid('#555555')] }),
        textNode('Blog', { fontSize: 14, fontWeight: 500, fills: [solid('#555555')] }),
      ),
      btnPrimary('Sign Up'),
    ), ['header', 'navigation', 'topbar']),
  ];
}

function faqBlocks(): BlockDefinition[] {
  const faqItem = (q: string, a: string) => frame({
    name: 'FAQItem', layoutMode: 'VERTICAL', primaryAxisSizing: 'HUG', counterAxisSizing: 'FILL',
    paddingTop: 24, paddingBottom: 24, itemSpacing: 8,
    strokes: [{ type: 'SOLID' as const, color: { r: 0.92, g: 0.92, b: 0.92, a: 1 }, visible: true }],
    strokeWeight: 1,
  },
    textNode(q, { fontSize: 18, fontWeight: 600, fills: [solid('#1A1A1A')] }),
    textNode(a, { fontSize: 15, fills: [solid('#666666')], lineHeight: 24 }),
  );

  return [
    makeBlock('faq', 'faq-simple', 'FAQ section with expandable items', [
      { name: 'title', role: 'heading', type: 'text', defaultValue: 'Frequently Asked Questions' },
    ], sectionFrame('FAQ', 96, 80, '#FFFFFF',
      textNode('Frequently Asked Questions', { name: 'title', fontSize: 40, fontWeight: 800, fills: [solid('#1A1A1A')], textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER' }),
      frame({ name: 'FAQList', layoutMode: 'VERTICAL', primaryAxisSizing: 'HUG', counterAxisSizing: 'FILL', width: 800, layoutAlignSelf: 'CENTER' },
        faqItem('How does it work?', 'Our engine compiles your HTML into an INode AST, validates it against 30+ design rules, and exports to any format.'),
        faqItem('Can I use my own brand?', 'Absolutely. Import your DESIGN.md or .tokens.json and the engine applies your brand to any design.'),
        faqItem('What formats are supported?', 'HTML, React, SVG, PNG, PDF, Lottie, animated HTML, and multi-page sites.'),
        faqItem('Is there an API?', 'Yes — our headless render API lets you generate assets programmatically via REST endpoints.'),
      ),
    ), ['questions', 'help', 'support']),
  ];
}

function contactBlocks(): BlockDefinition[] {
  const inputField = (label: string, placeholder: string) => col(6,
    textNode(label, { fontSize: 13, fontWeight: 600, fills: [solid('#444444')], letterSpacing: 0.5 }),
    frame({ name: `Input-${label}`, width: 400, height: 44, cornerRadius: 8, fills: [solid('#FFFFFF')], strokes: [{ type: 'SOLID' as const, color: { r: 0.85, g: 0.85, b: 0.85, a: 1 }, visible: true }], strokeWeight: 1, semanticRole: 'input', layoutMode: 'HORIZONTAL', paddingLeft: 14, counterAxisAlign: 'CENTER' },
      text(placeholder, { fontSize: 14, fills: [solid('#AAAAAA')], textAutoResize: 'WIDTH_AND_HEIGHT' }),
    ),
  );

  return [
    makeBlock('contact', 'contact-form', 'Contact form section', [
      { name: 'title', role: 'heading', type: 'text', defaultValue: 'Get in Touch' },
    ], sectionFrame('Contact', 96, 80, '#FAFAFA',
      textNode('Get in Touch', { name: 'title', fontSize: 40, fontWeight: 800, fills: [solid('#1A1A1A')], textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER' }),
      frame({ name: 'Form', layoutMode: 'VERTICAL', primaryAxisSizing: 'HUG', counterAxisSizing: 'HUG', itemSpacing: 20, layoutAlignSelf: 'CENTER' },
        inputField('Name', 'John Doe'),
        inputField('Email', 'john@example.com'),
        col(6,
          textNode('Message', { fontSize: 13, fontWeight: 600, fills: [solid('#444444')], letterSpacing: 0.5 }),
          frame({ name: 'TextArea', width: 400, height: 120, cornerRadius: 8, fills: [solid('#FFFFFF')], strokes: [{ type: 'SOLID' as const, color: { r: 0.85, g: 0.85, b: 0.85, a: 1 }, visible: true }], strokeWeight: 1, semanticRole: 'input', paddingLeft: 14, paddingTop: 12 },
            text('Your message...', { fontSize: 14, fills: [solid('#AAAAAA')], textAutoResize: 'WIDTH_AND_HEIGHT' }),
          ),
        ),
        btnPrimary('Send Message'),
      ),
    ), ['form', 'email', 'support']),
  ];
}

function galleryBlocks(): BlockDefinition[] {
  const imgPlaceholder = (i: number) => rect({
    name: `Image${i}`,
    width: 400, height: 300,
    cornerRadius: 8,
    fills: [solid(['#E8E4F0', '#E4F0E8', '#F0E8E4', '#E4E8F0', '#F0F0E4', '#F0E4F0'][i % 6])],
  });

  return [
    makeBlock('gallery', 'gallery-grid', 'Image gallery grid', [
      { name: 'title', role: 'heading', type: 'text', defaultValue: 'Gallery' },
    ], sectionFrame('Gallery', 96, 80, '#FFFFFF',
      textNode('Gallery', { name: 'title', fontSize: 40, fontWeight: 800, fills: [solid('#1A1A1A')], textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER' }),
      frame({ name: 'Grid', layoutMode: 'HORIZONTAL', primaryAxisSizing: 'HUG', counterAxisSizing: 'FILL', itemSpacing: 16, layoutWrap: 'WRAP', counterAxisSpacing: 16 },
        imgPlaceholder(0), imgPlaceholder(1), imgPlaceholder(2),
        imgPlaceholder(3), imgPlaceholder(4), imgPlaceholder(5),
      ),
    ), ['images', 'photos', 'portfolio']),
  ];
}

function teamBlocks(): BlockDefinition[] {
  const teamCard = (name: string, role: string) => col(12,
    ellipse({ width: 80, height: 80, fills: [solid('#E0E0E0')], name: 'Avatar' }),
    textNode(name, { fontSize: 16, fontWeight: 600, fills: [solid('#1A1A1A')], textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER' }),
    textNode(role, { fontSize: 14, fills: [solid('#888888')], textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER' }),
  );

  return [
    makeBlock('team', 'team-grid', 'Team member grid', [
      { name: 'title', role: 'heading', type: 'text', defaultValue: 'Our Team' },
    ], sectionFrame('Team', 96, 80, '#FAFAFA',
      textNode('Our Team', { name: 'title', fontSize: 40, fontWeight: 800, fills: [solid('#1A1A1A')], textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER' }),
      row(48,
        teamCard('Alex Rivera', 'CEO & Founder'),
        teamCard('Jordan Chen', 'CTO'),
        teamCard('Sam Williams', 'Head of Design'),
        teamCard('Taylor Kim', 'Lead Engineer'),
      ),
    ), ['people', 'members', 'about']),
  ];
}

// ─── Register All Starters ──────────────────────────────────

/**
 * Register all starter blocks in the in-memory registry.
 * @returns Number of blocks registered.
 */
export function registerStarterBlocks(): number {
  const allBlocks = [
    ...heroBlocks(),
    ...featureBlocks(),
    ...pricingBlocks(),
    ...testimonialBlocks(),
    ...ctaBlocks(),
    ...statsBlocks(),
    ...footerBlocks(),
    ...navBlocks(),
    ...faqBlocks(),
    ...contactBlocks(),
    ...galleryBlocks(),
    ...teamBlocks(),
  ];

  for (const block of allBlocks) {
    registerBlock(block);
  }

  return allBlocks.length;
}
