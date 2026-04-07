/**
 * Test the unified reframe() function — one call, full page.
 */
import * as fs from 'fs';
import { reframe } from '../packages/core/src/ui/index.js';

async function main() {
  // Test 1: Quick theme + sections
  const html = await reframe({
    theme: { primary: '#635bff', bg: '#0a0a0a', text: '#f5f5f7' },
    width: 1440,
    sections: [
      { type: 'navbar', brand: 'Acme', links: ['Docs', 'Pricing', 'Blog'], cta: 'Get Started' },
      { type: 'hero', headline: 'Ship products faster', subheadline: 'The modern toolkit for teams that build.', primaryCta: 'Start free', badge: 'v2.0' },
      { type: 'stats', stats: [
        { value: '120', label: 'Functions' },
        { value: '19', label: 'Audit rules' },
        { value: '6', label: 'Export formats' },
      ]},
      // Custom section — mix primitives with sections
      { type: 'stack', pad: [80, 80], gap: 48, children: [
        { type: 'center', children: [
          { type: 'heading', text: 'Built for developers', level: 2 },
        ]},
        { type: 'row', gap: 24, children: [
          { type: 'card', pad: 32, layoutGrow: 1, children: [
            { type: 'stack', gap: 12, children: [
              { type: 'tag', text: 'TypeScript', color: '#3178c6' },
              { type: 'h4', text: 'Type-safe' },
              { type: 'body', text: '120 typed functions. Autocomplete everywhere.', muted: true },
            ]},
          ]},
          { type: 'card', pad: 32, layoutGrow: 1, children: [
            { type: 'stack', gap: 12, children: [
              { type: 'tag', text: 'Build', color: '#10b981' },
              { type: 'h4', text: 'Config-driven' },
              { type: 'body', text: 'reframe build compiles, tests, exports. CI/CD ready.', muted: true },
            ]},
          ]},
          { type: 'card', pad: 32, layoutGrow: 1, children: [
            { type: 'stack', gap: 12, children: [
              { type: 'tag', text: 'MCP', color: '#f59e0b' },
              { type: 'h4', text: 'AI-native' },
              { type: 'body', text: '6 tools. Blueprint JSON. Define/use decomposition.', muted: true },
            ]},
          ]},
        ]},
      ]},
      { type: 'cta', headline: 'Ready to build?', primaryCta: 'Get Started', secondaryCta: 'Read Docs' },
      { type: 'footer', copyright: '© 2026 Acme Inc.', links: ['GitHub', 'Docs', 'Discord'] },
    ],
  });

  fs.writeFileSync('scripts/reframe-unified.html', html);
  console.log(`reframe(): ${html.length} bytes → scripts/reframe-unified.html`);
}

main().catch(console.error);
