/**
 * Test: DESIGN.md → Theme → landing page.
 * Parse real brand guide → auto-theme → full page.
 */
import * as fs from 'fs';
import { fromDesignMd, themed, landing } from '../packages/core/src/ui/index.js';

async function buildBrand(name: string, file: string, content: any) {
  const md = fs.readFileSync(file, 'utf8');
  const t = fromDesignMd(md);
  console.log(`${name}: primary=${t.color.primary} bg=${t.color.bg} font=${t.type.fontFamily} radius=${t.radius.sm}`);

  const html = await landing({
    theme: t,
    width: 1440,
    nav: { brand: name, links: ['Product', 'Pricing', 'Docs'], cta: content.cta },
    hero: { headline: content.headline, subheadline: content.sub, primaryCta: content.cta, badge: content.badge },
    features: { title: 'Why ' + name, features: content.features },
    stats: { stats: content.stats },
    cta: { headline: content.ctaHeadline, primaryCta: content.cta },
    footer: { copyright: `© 2026 ${name}`, links: ['Privacy', 'Terms'] },
  });

  const out = `scripts/brand-${name.toLowerCase().replace(/\s/g, '-')}.html`;
  fs.writeFileSync(out, html);
  console.log(`  → ${html.length} bytes → ${out}`);
}

async function main() {
  await buildBrand('Stripe', 'awesome-design-md-main/design-md/stripe/DESIGN.md', {
    badge: 'New: Terminal SDK',
    headline: 'Financial infrastructure\nfor the internet',
    sub: 'Millions of companies use Stripe to accept payments online.',
    cta: 'Start now',
    ctaHeadline: 'Ready to get started?',
    features: [
      { tag: 'Payments', title: 'Accept payments globally', description: '135+ currencies, dozens of payment methods.' },
      { tag: 'Billing', title: 'Recurring revenue', description: 'Subscriptions, invoicing, revenue recovery.' },
      { tag: 'Connect', title: 'Marketplace payouts', description: 'Route payments to sellers in 40+ countries.' },
    ],
    stats: [{ value: '250M+', label: 'API requests/day' }, { value: '99.999%', label: 'Uptime' }, { value: '135+', label: 'Currencies' }],
  });

  await buildBrand('Linear', 'awesome-design-md-main/design-md/linear.app/DESIGN.md', {
    badge: 'Linear 2025',
    headline: 'Linear is a better way\nto build products',
    sub: 'Meet the new standard for modern software development.',
    cta: 'Get started',
    ctaHeadline: 'Built for the future',
    features: [
      { tag: 'Issues', title: 'Issue tracking', description: 'Create, prioritize, and track work across your team.' },
      { tag: 'Cycles', title: 'Project cycles', description: 'Time-boxed development with automatic scope management.' },
      { tag: 'Roadmaps', title: 'Product roadmaps', description: 'Plan and communicate your product direction.' },
    ],
    stats: [{ value: '10K+', label: 'Teams' }, { value: '<50ms', label: 'Latency' }, { value: '99.99%', label: 'Uptime' }],
  });

  await buildBrand('Vercel', 'awesome-design-md-main/design-md/vercel/DESIGN.md', {
    badge: 'Introducing v0',
    headline: 'Your complete platform\nfor the web',
    sub: 'Vercel provides the developer tools and cloud infrastructure to build, scale, and secure the web.',
    cta: 'Start deploying',
    ctaHeadline: 'Deploy your project today',
    features: [
      { tag: 'Deploy', title: 'Push to deploy', description: 'Git push and your site is live. Zero configuration.' },
      { tag: 'Edge', title: 'Edge network', description: 'Global CDN with automatic edge caching and optimization.' },
      { tag: 'AI', title: 'AI-powered', description: 'v0 generates UI from prompts. Ship faster with AI.' },
    ],
    stats: [{ value: '1M+', label: 'Developers' }, { value: '100+', label: 'Edge locations' }, { value: '4.5B', label: 'Requests/week' }],
  });
}

main().catch(console.error);
