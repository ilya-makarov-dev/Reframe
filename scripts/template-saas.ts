/**
 * Real-world SaaS landing page — Linear/Vercel quality.
 * Full page: navbar, hero, logos, features, stats, testimonials, pricing, CTA, footer.
 */

import * as fs from 'fs';
import {
  render, createTheme, themed,
  page, stack, row, wrap, center, spacer,
  display, body, divider, mono, circle,
  stat, quote, listItem, badge,
  fill, pad, gap, size, radius, pill, shadow, border, opacity, grow, stretch,
} from '../packages/core/src/ui/index.js';
import { solid } from '../packages/core/src/builder.js';

const t = createTheme({
  primary: '#635bff',
  bg: '#000000',
  text: '#f5f5f7',
  muted: '#86868b',
  accent: '#0071e3',
  surface: '#111111',
  fontFamily: 'Inter',
  spacingUnit: 8,
  radiusBase: 8,
});

const { H1, H2, H3, H4, Body, Muted, Caption, Label,
  Button, Card, Badge, Tag, Link, NavItem, Divider,
  solid: s } = themed(t);

// ─── Sections ────────────────────────────────────────────

function navbar() {
  return row({ pad: [20, 64], justify: 'between', align: 'center' },
    row({ gap: 32, align: 'center' },
      H4('acme', { letterSpacing: -0.5 }),
      row({ gap: 4, align: 'center' },
        NavItem('Product'), NavItem('Pricing'), NavItem('Docs'),
        NavItem('Blog'), NavItem('Changelog'),
      ),
    ),
    row({ gap: 12, align: 'center' },
      Link('Log in', { color: t.color.muted, fontSize: 14 }),
      Button('Start building', { size: 'sm' }),
    ),
  );
}

function hero() {
  return center({ pad: [140, 80, 120, 80], gap: 28 },
    Badge('Announcing v2.0 →', { color: t.color.primary }),
    display('Move fast,\nbreak nothing', {
      fills: [s('text')], textAlignHorizontal: 'CENTER', fontSize: 72, lineHeight: 76,
    }),
    Body('The modern toolkit for teams that ship. Plan, build, and launch\nproducts with unprecedented speed and precision.', {
      fills: [s('muted')], textAlignHorizontal: 'CENTER', fontSize: 19, lineHeight: 28,
    }),
    row({ gap: 12 },
      Button('Start for free', { size: 'lg' }),
      Button('Talk to sales', { size: 'lg', variant: 'outline', color: t.color.muted }),
    ),
    Caption('Free for teams up to 5. No credit card required.', { fills: [s('muted')], opacity: 0.5 }),
  );
}

function logoBanner() {
  return stack({ pad: [48, 80], gap: 20, align: 'center' },
    Label('Trusted by world-class teams', {
      fills: [s('muted')], textCase: 'UPPER', letterSpacing: 2, fontSize: 11,
    }),
    row({ gap: 56, justify: 'center', align: 'center' },
      Muted('Vercel', { fontWeight: 600, fontSize: 18, opacity: 0.35 }),
      Muted('Linear', { fontWeight: 600, fontSize: 18, opacity: 0.35 }),
      Muted('Raycast', { fontWeight: 600, fontSize: 18, opacity: 0.35 }),
      Muted('Notion', { fontWeight: 600, fontSize: 18, opacity: 0.35 }),
      Muted('Figma', { fontWeight: 600, fontSize: 18, opacity: 0.35 }),
      Muted('Stripe', { fontWeight: 600, fontSize: 18, opacity: 0.35 }),
    ),
  );
}

function featureCard(tagText: string, tagColor: string, title: string, desc: string) {
  return Card({ pad: 32, layoutGrow: 1, fills: [solid(t.color.surface)], cornerRadius: 16 },
    stack({ gap: 16 },
      Tag(tagText, { color: tagColor }),
      H3(title, { fontSize: 22 }),
      Body(desc, { fills: [s('muted')], fontSize: 15, lineHeight: 24 }),
    ),
  );
}

function features() {
  return stack({ pad: [100, 80], gap: 56 },
    center({},
      stack({ gap: 16, align: 'center' },
        Badge('Features'),
        H2('Everything you need\nto ship faster', { textAlignHorizontal: 'CENTER', fontSize: 40, lineHeight: 48 }),
        Body('A complete toolkit designed for modern product teams.', {
          fills: [s('muted')], textAlignHorizontal: 'CENTER', fontSize: 17,
        }),
      ),
    ),
    row({ gap: 20 },
      featureCard('Linear Sync', '#5e6ad2', 'Issue tracking', 'Bi-directional sync with Linear. Create, assign, and close issues without leaving your workflow.'),
      featureCard('AI Native', '#10b981', 'Smart automation', 'AI understands your codebase. Auto-triage bugs, suggest reviewers, generate changelogs.'),
      featureCard('Realtime', '#f59e0b', 'Live collaboration', 'See your team editing in real-time. Presence cursors, live comments, instant sync.'),
    ),
    row({ gap: 20 },
      featureCard('API First', t.color.primary, 'Developer experience', 'TypeScript SDK, webhook events, GraphQL API. Build anything on top of the platform.'),
      featureCard('Security', '#ef4444', 'Enterprise ready', 'SOC 2 Type II, SSO/SAML, audit logs, role-based access. Deploy on-premise or cloud.'),
    ),
  );
}

function statsSection() {
  return row({ pad: [80, 120], justify: 'between', align: 'center', fills: [solid(t.color.surface)] },
    stat('10M+', 'Issues managed', { fills: [s('text')] }),
    divider({ color: t.color.border, thickness: 1, width: 1, height: 48 } as any),
    stat('50K+', 'Teams worldwide', { fills: [s('text')] }),
    divider({ color: t.color.border, thickness: 1, width: 1, height: 48 } as any),
    stat('99.99%', 'Uptime SLA', { fills: [s('text')] }),
    divider({ color: t.color.border, thickness: 1, width: 1, height: 48 } as any),
    stat('<50ms', 'API latency', { fills: [s('text')] }),
  );
}

function testimonialCard(text: string, name: string, role: string, company: string) {
  return Card({ pad: 32, layoutGrow: 1, fills: [solid(t.color.surface)], cornerRadius: 16 },
    stack({ gap: 20 },
      Body(`"${text}"`, { fills: [s('text')], fontSize: 15, lineHeight: 24, italic: true }),
      row({ gap: 12, align: 'center' },
        circle(40, { fills: [solid('#27272a')] }),
        stack({ gap: 2 },
          Body(name, { fills: [s('text')], fontWeight: 600, fontSize: 14 }),
          Caption(`${role}, ${company}`, { fills: [s('muted')] }),
        ),
      ),
    ),
  );
}

function testimonials() {
  return stack({ pad: [100, 80], gap: 48 },
    center({},
      H2('Loved by teams everywhere', { textAlignHorizontal: 'CENTER', fontSize: 36 }),
    ),
    row({ gap: 20 },
      testimonialCard(
        'Switched from Jira and never looked back. The speed is unreal.',
        'Sarah Chen', 'VP Engineering', 'Vercel',
      ),
      testimonialCard(
        'Finally a tool that thinks like engineers. The API-first approach changes everything.',
        'Marcus Reid', 'CTO', 'Linear',
      ),
      testimonialCard(
        'Our team shipped 3x more features in the first quarter after switching.',
        'Aya Tanaka', 'Head of Product', 'Raycast',
      ),
    ),
  );
}

function pricingCard(name: string, price: string, desc: string, feats: string[], highlighted: boolean) {
  const bg = highlighted ? t.color.primary : t.color.surface;
  const textFill = highlighted ? [solid('#ffffff')] : [s('text')];
  const mutedFill = highlighted ? [solid('#ffffff', 0.7)] : [s('muted')];
  return Card({
    pad: 36, width: 380,
    fills: [solid(bg)],
    cornerRadius: 20,
    ...(highlighted ? shadow(32, '#635bff', 0) : {}),
  },
    stack({ gap: 24 },
      stack({ gap: 8 },
        row({ gap: 8, align: 'center' },
          H4(name, { fills: textFill }),
          ...(highlighted ? [Badge('Popular', { color: '#ffffff' })] : []),
        ),
        Body(desc, { fills: mutedFill, fontSize: 14 }),
      ),
      row({ gap: 4, align: 'end' },
        display(price, { fills: textFill, fontSize: 48, lineHeight: 48 }),
        Body('/month', { fills: mutedFill, fontSize: 15 }),
      ),
      Divider({ color: highlighted ? '#ffffff' : t.color.border }),
      stack({ gap: 10 },
        ...feats.map(f => listItem(f, { fills: textFill, bullet: '✓' })),
      ),
      Button(highlighted ? 'Start now' : 'Get started', {
        size: 'lg',
        color: highlighted ? '#ffffff' : t.color.primary,
        fills: highlighted ? [solid('#ffffff')] : undefined,
        layoutAlignSelf: 'STRETCH',
        cornerRadius: 12,
      }),
    ),
  );
}

function pricing() {
  return stack({ pad: [100, 80], gap: 48 },
    center({},
      stack({ gap: 16, align: 'center' },
        Badge('Pricing'),
        H2('Start free, scale as you grow', { textAlignHorizontal: 'CENTER', fontSize: 40 }),
        Body('No hidden fees. Upgrade or downgrade at any time.', {
          fills: [s('muted')], textAlignHorizontal: 'CENTER',
        }),
      ),
    ),
    row({ gap: 24, justify: 'center', align: 'start' },
      pricingCard('Starter', '$0', 'For individuals and small teams', [
        'Up to 5 team members',
        '100 issues per month',
        'Basic integrations',
        'Community support',
      ], false),
      pricingCard('Pro', '$19', 'For growing teams that need more', [
        'Unlimited team members',
        'Unlimited issues',
        'Advanced integrations',
        'Priority support',
        'Custom workflows',
        'API access',
      ], true),
      pricingCard('Enterprise', '$79', 'For organizations at scale', [
        'Everything in Pro',
        'SSO / SAML',
        'Audit logs',
        'Dedicated support',
        'On-premise option',
        'SLA guarantee',
      ], false),
    ),
  );
}

function ctaSection() {
  return center({ pad: [120, 80], gap: 24 },
    H2('Ready to build faster?', { textAlignHorizontal: 'CENTER', fontSize: 44, lineHeight: 48 }),
    Body('Join 50,000+ teams already shipping with Acme.', {
      fills: [s('muted')], textAlignHorizontal: 'CENTER', fontSize: 18,
    }),
    row({ gap: 12 },
      Button('Start for free', { size: 'lg' }),
      Button('Schedule demo', { size: 'lg', variant: 'outline', color: t.color.muted }),
    ),
  );
}

function footer() {
  return row({ pad: [48, 80], justify: 'between', align: 'center', fills: [solid(t.color.surface)] },
    Caption('© 2026 Acme Inc. All rights reserved.', { fills: [s('muted')] }),
    row({ gap: 24 },
      Link('Privacy', { color: t.color.muted, fontSize: 13 }),
      Link('Terms', { color: t.color.muted, fontSize: 13 }),
      Link('Status', { color: t.color.muted, fontSize: 13 }),
      Link('GitHub', { color: t.color.muted, fontSize: 13 }),
      Link('Twitter', { color: t.color.muted, fontSize: 13 }),
    ),
  );
}

// ─── Full page ───────────────────────────────────────────

async function main() {
  const html = await render(
    page({ w: 1440, h: 6000, fills: [s('bg')] },
      navbar(),
      hero(),
      logoBanner(),
      features(),
      statsSection(),
      testimonials(),
      pricing(),
      ctaSection(),
      footer(),
    ),
  );

  fs.writeFileSync('scripts/template-saas.html', html);
  console.log(`SaaS landing: ${html.length} bytes → scripts/template-saas.html`);
}

main().catch(console.error);
