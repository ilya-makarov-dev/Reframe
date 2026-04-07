/**
 * Test reframe() — design ANYTHING.
 * Landing page, dashboard, mobile screen, email, card.
 */
import * as fs from 'fs';
import { reframe } from '../packages/core/src/ui/index.js';

async function test(name: string, config: any) {
  try {
    const html = await reframe(config);
    fs.writeFileSync(`scripts/${name}.html`, html);
    console.log(`  [OK] ${name}: ${html.length} bytes`);
  } catch (e: any) {
    console.error(`  [FAIL] ${name}: ${e.message}`);
  }
}

async function main() {
  console.log('Testing reframe() — design anything:\n');

  // 1. Landing page (sections sugar)
  await test('landing', {
    theme: { primary: '#6366f1', bg: '#09090b', text: '#fafafa' },
    sections: [
      { type: 'navbar', brand: 'Acme', links: ['Docs', 'Pricing'], cta: 'Start' },
      { type: 'hero', headline: 'Build faster', subheadline: 'Ship with confidence.', primaryCta: 'Try free' },
      { type: 'features', features: [
        { tag: 'Fast', title: '50ms builds', description: 'Deterministic.' },
        { tag: 'Tested', title: '19 rules', description: 'Auto-fix.' },
      ]},
      { type: 'footer', copyright: '© 2026 Acme' },
    ],
  });

  // 2. Dashboard (content — any tree)
  await test('dashboard', {
    theme: { primary: '#3b82f6', bg: '#ffffff', text: '#111827' },
    content: {
      type: 'row', children: [
        { type: 'sidebar', items: [
          { label: 'Dashboard', active: true },
          { label: 'Analytics' },
          { label: 'Settings' },
        ]},
        { type: 'stack', layoutGrow: 1, pad: [24, 32], gap: 24, children: [
          { type: 'row', justify: 'between', align: 'center', children: [
            { type: 'h2', text: 'Dashboard' },
            { type: 'button', text: 'Export', variant: 'outline', size: 'sm' },
          ]},
          { type: 'row', gap: 16, children: [
            { type: 'card', pad: 24, layoutGrow: 1, children: [
              { type: 'stat', value: '1,234', label: 'Active users' },
            ]},
            { type: 'card', pad: 24, layoutGrow: 1, children: [
              { type: 'stat', value: '$45.2K', label: 'Revenue' },
            ]},
            { type: 'card', pad: 24, layoutGrow: 1, children: [
              { type: 'progress', value: 0.73, showLabel: true, color: '#3b82f6' },
              { type: 'caption', text: 'Goal: 73% complete' },
            ]},
          ]},
          { type: 'table', columns: ['Customer', 'Status', 'Revenue', 'Date'],
            rows: [
              ['Acme Corp', 'Active', '$12,400', '2026-04-01'],
              ['Globex', 'Pending', '$8,200', '2026-04-03'],
              ['Initech', 'Active', '$15,800', '2026-04-05'],
            ],
          },
        ]},
      ],
    },
  });

  // 3. Mobile screen
  await test('mobile', {
    width: 390, height: 844,
    theme: { primary: '#0071e3', bg: '#f5f5f7', text: '#1d1d1f' },
    content: {
      type: 'stack', gap: 0, children: [
        // Status bar
        { type: 'row', pad: [8, 20], justify: 'between', align: 'center', children: [
          { type: 'caption', text: '9:41' },
          { type: 'row', gap: 6, children: [
            { type: 'caption', text: '5G' },
            { type: 'caption', text: '100%' },
          ]},
        ]},
        // Nav
        { type: 'row', pad: [12, 16], justify: 'between', align: 'center', children: [
          { type: 'h4', text: 'Messages' },
          { type: 'button', text: 'New', size: 'sm' },
        ]},
        // Search
        { type: 'stack', pad: [0, 16], children: [
          { type: 'searchInput', placeholder: 'Search messages...' },
        ]},
        // Message list
        { type: 'stack', pad: [12, 16], gap: 8, children: [
          { type: 'card', pad: 16, children: [
            { type: 'row', justify: 'between', children: [
              { type: 'body', text: 'Sarah Chen', bold: true },
              { type: 'caption', text: '2m ago' },
            ]},
            { type: 'body', text: 'Hey, are you free for lunch?', muted: true },
          ]},
          { type: 'card', pad: 16, children: [
            { type: 'row', justify: 'between', children: [
              { type: 'body', text: 'Team Design', bold: true },
              { type: 'caption', text: '1h ago' },
            ]},
            { type: 'body', text: 'New mockups ready for review', muted: true },
          ]},
          { type: 'card', pad: 16, children: [
            { type: 'row', justify: 'between', children: [
              { type: 'body', text: 'Alex Rivera', bold: true },
              { type: 'caption', text: 'Yesterday' },
            ]},
            { type: 'body', text: 'Shipped the new feature!', muted: true },
          ]},
        ]},
      ],
    },
  });

  // 4. Email header
  await test('email', {
    width: 600,
    theme: { primary: '#10b981', bg: '#ffffff', text: '#111827' },
    content: {
      type: 'center', pad: [48, 32], gap: 20, children: [
        { type: 'heading', text: 'Welcome to Acme', level: 2 },
        { type: 'body', text: 'Your account has been created. Click below to get started.', muted: true, textAlign: 'CENTER' },
        { type: 'button', text: 'Activate Account', size: 'lg' },
        { type: 'caption', text: 'If you didn\'t create this account, please ignore this email.' },
      ],
    },
  });

  // 5. Pricing card (single component)
  await test('pricing-card', {
    width: 380,
    theme: { primary: '#6366f1' },
    content: {
      type: 'card', pad: 36, children: [
        { type: 'stack', gap: 20, children: [
          { type: 'row', gap: 8, align: 'center', children: [
            { type: 'h3', text: 'Pro' },
            { type: 'badge', text: 'Popular' },
          ]},
          { type: 'row', gap: 4, align: 'end', children: [
            { type: 'display', text: '$29', fontSize: 48 },
            { type: 'body', text: '/month', muted: true },
          ]},
          { type: 'divider' },
          { type: 'stack', gap: 8, children: [
            { type: 'listItem', text: 'Unlimited projects', bullet: '✓' },
            { type: 'listItem', text: '10GB storage', bullet: '✓' },
            { type: 'listItem', text: 'Priority support', bullet: '✓' },
            { type: 'listItem', text: 'Custom domain', bullet: '✓' },
          ]},
          { type: 'button', text: 'Get Started', size: 'lg', layoutAlignSelf: 'STRETCH' },
        ]},
      ],
    },
  });

  // 6. With DESIGN.md (brand context)
  const fs2 = await import('fs');
  const designMd = fs2.existsSync('awesome-design-md-main/design-md/stripe/DESIGN.md')
    ? fs2.readFileSync('awesome-design-md-main/design-md/stripe/DESIGN.md', 'utf8')
    : undefined;

  if (designMd) {
    await test('stripe-branded', {
      designMd,
      sections: [
        { type: 'navbar', brand: 'Stripe', links: ['Products', 'Developers', 'Pricing'], cta: 'Sign in' },
        { type: 'hero', headline: 'Financial infrastructure\nfor the internet', primaryCta: 'Start now', secondaryCta: 'Contact sales' },
        { type: 'footer', copyright: '© 2026 Stripe, Inc.' },
      ],
    });
  } else {
    console.log('  [SKIP] stripe-branded: awesome-design-md not available');
  }

  // 7. No theme at all (neutral defaults)
  await test('no-theme', {
    content: {
      type: 'center', pad: 48, gap: 16, children: [
        { type: 'heading', text: 'No theme needed', level: 2 },
        { type: 'body', text: 'Works with neutral defaults.' },
        { type: 'button', text: 'Click me' },
      ],
    },
  });

  console.log('\nDone.');
}

main().catch(console.error);
