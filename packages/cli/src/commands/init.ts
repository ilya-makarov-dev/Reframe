/**
 * reframe init — scaffold reframe.config.json + design.md
 */

import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_CONFIG = {
  design: './design.md',

  sizes: {
    desktop: { width: 1920, height: 1080 },
    mobile: { width: 390, height: 844 },
    banner: { width: 728, height: 90 },
    social: { width: 1080, height: 1080 },
  },

  scenes: {
    hero: {
      content: {
        headline: 'Your headline here',
        subheadline: 'Supporting text goes here',
        cta: 'Get Started',
      },
      sizes: ['desktop', 'mobile', 'social'],
    },
  },

  assert: [
    { type: 'minContrast', value: 4.5 },
    { type: 'minFontSize', value: 10 },
    { type: 'noTextOverflow' },
  ],

  exports: ['html'],
};

const DEFAULT_DESIGN_MD = `# Brand Design System

## Colors
- Primary: #6366f1
- Background: #0a0a0a
- Text: #ffffff
- Accent: #10b981

## Typography
- Hero: Inter, 48px, weight 700
- Body: Inter, 18px, weight 400
- Button: Inter, 16px, weight 600

## Layout
- Spacing unit: 8px
- Border radius: 12px

## Components
- Button: rounded, 12px radius
`;

export async function initCommand(args: string[]) {
  const dir = args[0] || process.cwd();

  const configPath = path.join(dir, 'reframe.config.json');
  const designPath = path.join(dir, 'design.md');

  if (fs.existsSync(configPath)) {
    console.log('reframe.config.json already exists. Skipping.');
    return;
  }

  fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
  console.log('Created reframe.config.json');

  if (!fs.existsSync(designPath)) {
    fs.writeFileSync(designPath, DEFAULT_DESIGN_MD, 'utf8');
    console.log('Created design.md');
  }

  console.log('\nNext steps:');
  console.log('  1. Edit design.md with your brand rules');
  console.log('  2. Edit reframe.config.json with your scenes');
  console.log('  3. Run: reframe build');
  console.log('  4. Run: reframe test');
}
