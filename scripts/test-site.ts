/**
 * Test: multi-page site export via reframe()
 */
import { reframe } from '../packages/core/src/ui/theme';
import { writeFileSync } from 'fs';

async function main() {
  console.log('Testing multi-page site export...\n');

  const html = await reframe({
    title: 'Acme SaaS',
    theme: { primary: '#6366f1', bg: '#ffffff', text: '#111' },
    transition: 'fadeSlideUp',
    pages: [
      {
        name: 'Home',
        sections: [
          { type: 'navbar', brand: 'Acme', links: ['Features', 'Pricing', 'About'], cta: 'Sign Up' },
          { type: 'hero', headline: 'Build faster with Acme', subheadline: 'The modern platform for ambitious teams.', primaryCta: 'Get Started', secondaryCta: 'Learn More' },
          { type: 'features', headline: 'Why Acme?', items: [
            { title: 'Fast', description: 'Blazing fast performance.' },
            { title: 'Secure', description: 'Enterprise-grade security.' },
            { title: 'Scalable', description: 'Grows with your team.' },
          ]},
          { type: 'footer', copyright: '© 2026 Acme', links: ['Privacy', 'Terms'] },
        ],
      },
      {
        name: 'Features',
        sections: [
          { type: 'navbar', brand: 'Acme', links: ['Home', 'Pricing', 'About'], cta: 'Sign Up' },
          { type: 'hero', headline: 'Powerful Features', subheadline: 'Everything you need to ship faster.', primaryCta: 'Try Free' },
          { type: 'features', headline: 'Core Platform', items: [
            { title: 'API First', description: 'RESTful APIs for everything.' },
            { title: 'Real-time', description: 'WebSocket-powered live updates.' },
            { title: 'Analytics', description: 'Built-in usage analytics.' },
            { title: 'Integrations', description: '200+ native integrations.' },
          ]},
          { type: 'cta', headline: 'Ready to start?', primaryCta: 'Create Account' },
          { type: 'footer', copyright: '© 2026 Acme', links: ['Privacy', 'Terms'] },
        ],
      },
      {
        name: 'Pricing',
        sections: [
          { type: 'navbar', brand: 'Acme', links: ['Home', 'Features', 'About'], cta: 'Sign Up' },
          { type: 'hero', headline: 'Simple Pricing', subheadline: 'No hidden fees. Cancel anytime.' },
          { type: 'pricing', plans: [
            { name: 'Starter', price: '$9/mo', features: ['5 projects', '10GB storage', 'Email support'] },
            { name: 'Pro', price: '$29/mo', features: ['Unlimited projects', '100GB storage', 'Priority support', 'Custom domain'], highlighted: true },
            { name: 'Enterprise', price: 'Contact us', features: ['Everything in Pro', 'SSO', 'SLA', 'Dedicated account manager'] },
          ]},
          { type: 'footer', copyright: '© 2026 Acme', links: ['Privacy', 'Terms'] },
        ],
      },
      {
        name: 'About',
        sections: [
          { type: 'navbar', brand: 'Acme', links: ['Home', 'Features', 'Pricing'], cta: 'Sign Up' },
          { type: 'hero', headline: 'About Acme', subheadline: 'We are building the future of development tools.' },
          { type: 'testimonials', items: [
            { quote: 'Acme transformed how we ship products.', author: 'Jane Smith', role: 'CTO, TechCorp' },
            { quote: 'The best developer experience I have ever used.', author: 'Alex Chen', role: 'Lead Engineer, StartupX' },
          ]},
          { type: 'cta', headline: 'Join thousands of happy developers', primaryCta: 'Start Free Trial' },
          { type: 'footer', copyright: '© 2026 Acme', links: ['Privacy', 'Terms'] },
        ],
      },
    ],
  });

  // Validate output
  let ok = 0;
  let fail = 0;

  function assert(cond: boolean, msg: string) {
    if (cond) { ok++; }
    else { fail++; console.error(`  FAIL: ${msg}`); }
  }

  assert(html.length > 1000, `output size: ${html.length} bytes`);
  assert(html.includes('<!DOCTYPE html>'), 'has doctype');
  assert(html.includes('page-home'), 'has home page section');
  assert(html.includes('page-features'), 'has features page section');
  assert(html.includes('page-pricing'), 'has pricing page section');
  assert(html.includes('page-about'), 'has about page section');
  assert(html.includes('rf-page'), 'has page routing class');
  assert(html.includes('rf-page-in'), 'has page-in animation');
  assert(html.includes('hashchange'), 'has hash router');
  assert(html.includes('data-nav-link'), 'has nav link data attributes');
  assert(html.includes('href="#'), 'has internal hash links');
  assert(html.includes('<a '), 'has anchor tags');
  assert(html.includes('Acme SaaS'), 'has site title');
  assert(html.includes('Build faster with Acme'), 'has hero headline');
  assert(html.includes('Simple Pricing'), 'has pricing headline');
  assert((html.match(/class="rf-page"/g) || []).length === 4, '4 page sections');

  // Write output for manual inspection
  writeFileSync('scripts/test-site-output.html', html);

  console.log(`\nSite export: ${ok} passed, ${fail} failed`);
  console.log(`Output: scripts/test-site-output.html (${html.length} bytes)`);
  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
