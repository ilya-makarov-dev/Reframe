/**
 * Test the build system end-to-end:
 * 1. Create config + design.md in temp dir
 * 2. Run build
 * 3. Run test
 * 4. Verify outputs exist
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { initYoga } from '../packages/core/src/engine/yoga-init.js';
import { loadConfigJson } from '../packages/core/src/config/loader.js';
import { buildAll } from '../packages/core/src/config/build.js';
import { testAll } from '../packages/core/src/config/test.js';

const DESIGN_MD = `# Test Brand

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

const CONFIG = {
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
        headline: 'Build faster',
        subheadline: 'Ship products users love',
        cta: 'Get Started',
      },
      sizes: ['desktop', 'mobile', 'social'],
    },
    promo: {
      content: {
        headline: 'Summer Sale',
        cta: 'Shop Now',
        disclaimer: 'Terms apply',
      },
      sizes: ['banner', 'social'],
    },
  },
  assert: [
    { type: 'minContrast', value: 3 },
    { type: 'minFontSize', value: 8 },
    { type: 'noTextOverflow' },
  ],
  exports: ['html'],
};

async function main() {
  console.log('=== reframe build system test ===\n');

  // Setup temp dir
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-test-'));
  console.log(`Temp dir: ${tmpDir}`);

  fs.writeFileSync(path.join(tmpDir, 'reframe.config.json'), JSON.stringify(CONFIG, null, 2));
  fs.writeFileSync(path.join(tmpDir, 'design.md'), DESIGN_MD);

  await initYoga();

  // Load config
  const config = loadConfigJson(path.join(tmpDir, 'reframe.config.json'));
  console.log(`Config: ${Object.keys(config.scenes).length} scenes, ${Object.keys(config.sizes).length} sizes\n`);

  // BUILD
  console.log('--- BUILD ---');
  const buildOutput = await buildAll(config, tmpDir, {
    scene(name) { console.log(`\n  >> ${name}`); },
    size(_s, size, w, h) { process.stdout.write(`    ${size} ${w}x${h} `); },
    compiled(_s, _sz, layout) { process.stdout.write(`[${layout}] `); },
    audited(_s, _sz, passed, fixed, rem) {
      process.stdout.write(passed ? '[OK]' : `[${rem} issues]`);
      if (fixed > 0) process.stdout.write(` (${fixed} fixed)`);
    },
    exported(_s, _sz, fmt, bytes) { process.stdout.write(` → ${fmt}(${bytes}b)`); },
    error(s, sz, msg) { console.error(`\n    [FAIL] ${s}/${sz}: ${msg}`); },
    done(out) {
      console.log(`\n\n  Build: ${out.passed} passed, ${out.failed} failed (${out.totalMs}ms)`);
    },
  });

  // Verify output files
  const outDir = path.join(tmpDir, '.reframe/dist');
  const heroDir = path.join(outDir, 'hero');
  const promoDir = path.join(outDir, 'promo');

  const heroFiles = fs.existsSync(heroDir) ? fs.readdirSync(heroDir) : [];
  const promoFiles = fs.existsSync(promoDir) ? fs.readdirSync(promoDir) : [];
  console.log(`  Output: hero/ [${heroFiles.join(', ')}], promo/ [${promoFiles.join(', ')}]`);

  // TEST
  console.log('\n--- TEST ---');
  const testOutput = await testAll(config, tmpDir, {
    scene(name) { console.log(`\n  ${name}`); },
    assertion(_s, size, type, passed, msg) {
      console.log(`    ${passed ? '\u2713' : '\u2717'} ${size}: ${type} — ${msg}`);
    },
    done(out) {
      console.log(`\n  Test: ${out.passed} passed, ${out.failed} failed (${out.totalMs}ms)`);
    },
  });

  // Summary
  console.log('\n=== RESULTS ===');
  console.log(`Build: ${buildOutput.results.length} scenes compiled, ${buildOutput.passed} passed`);
  console.log(`Test:  ${testOutput.results.length} scenes tested, ${testOutput.passed} passed, ${testOutput.failed} failed`);
  console.log(`Files: ${heroFiles.length + promoFiles.length} exported`);

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const allPassed = buildOutput.failed === 0 && testOutput.failed === 0;
  console.log(allPassed ? '\nALL PASSED' : '\nSOME FAILED');
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
