/**
 * Test both API levels:
 *   Level 1: landing() — pure data, zero layout code
 *   Level 2: themed() sections — composable, customizable
 */

import * as fs from 'fs';
import { landing, createTheme, themed, render, stack, row, heading, body, mono, divider } from '../packages/core/src/ui/index.js';
import { solid } from '../packages/core/src/builder.js';

// ─── Level 1: One function call ─────────────────────────────

async function level1() {
  const html = await landing({
    theme: { primary: '#635bff', bg: '#000000', text: '#f5f5f7', fontFamily: 'Inter' },
    width: 1440,
    nav: { brand: 'Stripe', links: ['Products', 'Solutions', 'Developers', 'Resources', 'Pricing'], cta: 'Sign in' },
    hero: {
      badge: 'New: Terminal SDK →',
      headline: 'Financial infrastructure\nfor the internet',
      subheadline: 'Millions of companies use Stripe to accept payments, grow their revenue, and accelerate new business opportunities.',
      primaryCta: 'Start now',
      secondaryCta: 'Contact sales',
    },
    logos: { title: 'Trusted by millions of companies', logos: ['Amazon', 'Google', 'Shopify', 'Slack', 'Notion', 'Zoom'] },
    features: {
      title: 'Unified platform',
      subtitle: 'Everything you need to build and scale.',
      columns: 3,
      features: [
        { tag: 'Payments', tagColor: '#635bff', title: 'Accept payments globally', description: 'Support 135+ currencies and dozens of payment methods with a single integration.' },
        { tag: 'Billing', tagColor: '#10b981', title: 'Recurring revenue', description: 'Build and scale subscription models. Flexible billing logic, invoicing, and revenue recovery.' },
        { tag: 'Connect', tagColor: '#f59e0b', title: 'Marketplace payouts', description: 'Route payments to sellers, service providers, or any third party. 40+ countries supported.' },
      ],
    },
    stats: { stats: [
      { value: '250M+', label: 'API requests/day' },
      { value: '99.999%', label: 'Uptime SLA' },
      { value: '135+', label: 'Currencies' },
      { value: '35+', label: 'Countries' },
    ]},
    testimonials: {
      title: 'Built for developers',
      testimonials: [
        { quote: 'Stripe is the best payments infrastructure in the world. Period.', name: 'Patrick Collison', role: 'CEO', company: 'Stripe' },
        { quote: 'We process billions through Stripe. The reliability is unmatched.', name: 'Tobias Lütke', role: 'CEO', company: 'Shopify' },
        { quote: 'The developer experience is years ahead of the competition.', name: 'Guillermo Rauch', role: 'CEO', company: 'Vercel' },
      ],
    },
    pricing: {
      title: 'Simple, transparent pricing',
      subtitle: 'No setup fees. No monthly fees. No hidden costs.',
      plans: [
        { name: 'Integrated', price: '2.9% + 30¢', description: 'Per successful charge', features: ['All payment methods', 'Global coverage', 'Fraud protection', 'Reporting dashboard'], cta: 'Get started' },
        { name: 'Customized', price: 'Custom', description: 'For large businesses', features: ['Volume discounts', 'Multi-product bundles', 'Country-specific rates', 'Dedicated support', 'Custom integrations'], cta: 'Contact sales', highlighted: true },
      ],
    },
    cta: {
      headline: 'Ready to get started?',
      subheadline: 'Explore Stripe Docs, or create an account instantly.',
      primaryCta: 'Start now',
      secondaryCta: 'Contact sales',
    },
    footer: { copyright: '© 2026 Stripe, Inc.', links: ['Products', 'Developers', 'Company', 'Privacy', 'Terms', 'Sitemap'] },
  });

  fs.writeFileSync('scripts/level1-stripe.html', html);
  console.log(`Level 1 (landing): ${html.length} bytes → scripts/level1-stripe.html`);
}

// ─── Level 2: Themed sections + custom ──────────────────────

async function level2() {
  const t = createTheme({ primary: '#0071e3', bg: '#000000', text: '#f5f5f7', fontFamily: 'Inter' });
  const ui = themed(t);

  const html = await render(
    ui.Page({ w: 1440 },
      ui.Navbar({ brand: 'Apple', links: ['Mac', 'iPad', 'iPhone', 'Watch', 'Vision'], cta: 'Buy' }),
      ui.Hero({
        headline: 'iPhone 16 Pro',
        subheadline: 'Hello, Apple Intelligence.',
        primaryCta: 'Learn more',
        secondaryCta: 'Buy',
        align: 'center',
      }),

      // Custom section — mix primitives with themed sections
      stack({ pad: [80, 120], gap: 32, fills: [solid('#111')] },
        row({ gap: 24 },
          ui.Card({ pad: 32, layoutGrow: 1 },
            stack({ gap: 12 },
              mono('A18 Pro chip', { fills: [solid(t.color.primary)], fontSize: 12 }),
              ui.H3('Fastest chip ever\nin a smartphone'),
              ui.Muted('6-core GPU. 16-core Neural Engine. Hardware-accelerated ray tracing.'),
            ),
          ),
          ui.Card({ pad: 32, layoutGrow: 1 },
            stack({ gap: 12 },
              mono('Camera Control', { fills: [solid(t.color.primary)], fontSize: 12 }),
              ui.H3('48MP Fusion camera\nwith 5x Telephoto'),
              ui.Muted('The most advanced camera system ever on iPhone.'),
            ),
          ),
        ),
      ),

      ui.Stats({ stats: [
        { value: '4nm', label: 'Process' },
        { value: '48MP', label: 'Camera' },
        { value: '27h', label: 'Battery' },
      ]}),
      ui.CTA({ headline: 'Which iPhone is right for you?', primaryCta: 'Compare models' }),
      ui.Footer({ copyright: '© 2026 Apple Inc.', links: ['Privacy', 'Terms', 'Sitemap'] }),
    ),
  );

  fs.writeFileSync('scripts/level2-apple.html', html);
  console.log(`Level 2 (themed): ${html.length} bytes → scripts/level2-apple.html`);
}

async function main() {
  await level1();
  await level2();
}

main().catch(console.error);
