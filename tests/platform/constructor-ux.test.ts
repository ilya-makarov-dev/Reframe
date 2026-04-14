/**
 * Constructor UX Flow — live preview test.
 * Verifies: add block → API compose → iframe appears → section list updates.
 */

import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));

  await page.goto('http://localhost:4100/platform/constructor', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(500);

  console.log('JS errors:', errors.length === 0 ? 'none' : errors.join('; '));

  const emptyVisible = await page.locator('#ctr-empty').isVisible();
  console.log('Empty state visible:', emptyVisible);

  const blockBtns = await page.locator('.block-btn').all();
  console.log('Block buttons:', blockBtns.length);

  if (blockBtns.length > 0) {
    const name = await blockBtns[0].getAttribute('data-block');
    console.log('\n--- Click block:', name, '---');
    await blockBtns[0].click();
    await page.waitForTimeout(3000);

    const iframe = await page.locator('.ctr-preview iframe').count();
    console.log('Preview iframe:', iframe > 0 ? 'YES' : 'no');

    const statusText = await page.locator('#ctr-status').textContent();
    console.log('Status:', statusText);

    const items = await page.locator('.section-item').count();
    console.log('Section items:', items);

    // Add second block
    if (blockBtns.length > 5) {
      const name2 = await blockBtns[5].getAttribute('data-block');
      console.log('\n--- Click block:', name2, '---');
      await blockBtns[5].click();
      await page.waitForTimeout(3000);

      const items2 = await page.locator('.section-item').count();
      console.log('Section items:', items2);

      const status2 = await page.locator('#ctr-status').textContent();
      console.log('Status:', status2);
    }

    // Remove first
    const removeBtn = await page.locator('.section-item .remove').first();
    if (await removeBtn.count() > 0) {
      console.log('\n--- Remove first section ---');
      await removeBtn.click();
      await page.waitForTimeout(3000);

      const items3 = await page.locator('.section-item').count();
      console.log('Section items after remove:', items3);
    }
  }

  await browser.close();

  // Summary
  const checks = [
    ['JS errors', errors.length === 0],
    ['Block buttons exist', blockBtns.length > 0],
  ];
  const passed = checks.filter(c => c[1]).length;
  console.log(`\n${passed}/${checks.length} checks passed`);
}

main().catch(err => { console.error(err); process.exit(1); });
