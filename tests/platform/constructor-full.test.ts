/**
 * Full Constructor E2E — drag reorder, duplicate, section library, live preview.
 */
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));

  await page.goto('http://localhost:4100/platform/constructor', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(500);

  let passed = 0;
  let failed = 0;

  function check(name: string, ok: boolean, detail = '') {
    if (ok) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
    else { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}: ${detail}`); }
  }

  console.log('\n\x1b[1mConstructor Full E2E\x1b[0m\n');

  check('No JS errors', errors.length === 0, errors.join('; '));
  check('Block buttons exist', (await page.locator('.block-btn').count()) > 0);

  // Add 3 blocks
  const btns = await page.locator('.block-btn').all();
  await btns[0].click(); await page.waitForTimeout(2000);
  await btns[3].click(); await page.waitForTimeout(2000);
  await btns[6].click(); await page.waitForTimeout(2000);

  const items = await page.locator('.section-item').count();
  check('3 sections added', items === 3, `got ${items}`);

  // Check drag handles exist
  const handles = await page.locator('.drag-handle').count();
  check('Drag handles present', handles === 3, `got ${handles}`);

  // Check duplicate buttons exist
  const dups = await page.locator('.section-item .dup').count();
  check('Duplicate buttons present', dups === 3, `got ${dups}`);

  // Live preview iframe exists
  const iframe = await page.locator('.ctr-preview iframe').count();
  check('Live preview iframe', iframe > 0);

  // Duplicate a section
  await page.locator('.section-item .dup').first().click();
  await page.waitForTimeout(2000);
  const afterDup = await page.locator('.section-item').count();
  check('Duplicate works', afterDup === 4, `got ${afterDup}`);

  // Remove a section
  await page.locator('.section-item .remove').first().click();
  await page.waitForTimeout(2000);
  const afterRemove = await page.locator('.section-item').count();
  check('Remove works', afterRemove === 3, `got ${afterRemove}`);

  // Status shows count
  const statusText = await page.locator('#ctr-status').textContent();
  check('Status shows section count', statusText?.includes('3') || statusText?.includes('section') || false, `"${statusText}"`);

  // Section library API
  const res = await fetch('http://localhost:4100/platform/api/constructor/sections');
  const data = await res.json();
  check('Section API returns data', data.ok === true);
  check('Section count >= 60', data.count >= 60, `got ${data.count}`);
  check('Has categories', data.categories?.length > 5, `got ${data.categories?.length}`);

  await browser.close();

  console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
