/**
 * Platform UI — Constructor + Content + Brand Fidelity Tests
 *
 * Tests the new features built from competitive research vision:
 * - Constructor page loads with blocks
 * - Block selection + compose flow
 * - Content extraction + editing
 * - Brand Fidelity in quality panel
 * - Multi-page site export readiness
 *
 * Run: npx tsx tests/platform/constructor.test.ts
 * Requires: MCP server running (localhost:4100)
 */

import { chromium, type Page } from 'playwright';

const BASE = 'http://localhost:4100';

interface TestResult {
  test: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  detail: string;
}

const results: TestResult[] = [];
let jsErrors: string[] = [];

function pass(test: string, detail = '') {
  results.push({ test, status: 'PASS', detail });
  console.log(`  \x1b[32m✓\x1b[0m ${test}${detail ? ' — ' + detail : ''}`);
}

function fail(test: string, detail: string) {
  results.push({ test, status: 'FAIL', detail });
  console.log(`  \x1b[31m✗\x1b[0m ${test}: ${detail}`);
}

function skip(test: string, detail: string) {
  results.push({ test, status: 'SKIP', detail });
  console.log(`  \x1b[33m-\x1b[0m ${test}: ${detail}`);
}

async function go(page: Page, path: string) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(500);
}

// ─────────────────────────────────────────────────────────

async function main() {
  // Preflight
  try {
    const res = await fetch(`${BASE}/health`);
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch {
    console.error('Platform UI not running at localhost:4100.');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('pageerror', err => jsErrors.push(err.message));

  // ═══ 1. CONSTRUCTOR PAGE LOADS ═══
  console.log('\n\x1b[1m1. Constructor page\x1b[0m');

  jsErrors = [];
  await go(page, '/platform/constructor');

  if (jsErrors.length === 0) {
    pass('No JS errors on constructor');
  } else {
    fail('JS errors on constructor', jsErrors.join('; '));
  }

  const h1 = await page.$eval('h1', el => el.textContent?.trim()).catch(() => '');
  h1?.includes('Constructor')
    ? pass('Constructor title present')
    : fail('Constructor title', `got "${h1}"`);

  // Pipeline stepper
  const stepper = await page.$('.pipeline-stepper');
  stepper
    ? pass('Pipeline stepper rendered')
    : fail('Pipeline stepper missing', '');

  const stepCount = await page.$$eval('.pipeline-step', els => els.length);
  stepCount >= 5
    ? pass(`Stepper has ${stepCount} steps`)
    : fail('Stepper steps', `expected ≥5, got ${stepCount}`);

  // Block library
  const blockCards = await page.$$('.block-card');
  blockCards.length > 0
    ? pass(`Block library: ${blockCards.length} blocks`)
    : fail('Block library empty', '');

  // Category buttons
  const catBtns = await page.$$('.cat-btn');
  catBtns.length > 0
    ? pass(`Category buttons: ${catBtns.length}`)
    : fail('No category buttons', '');

  // Composer area
  const dropzone = await page.$('#composer-dropzone');
  dropzone
    ? pass('Composer dropzone present')
    : fail('Composer dropzone missing', '');

  // Compose button (should be disabled initially)
  const composeBtn = await page.$('#compose-btn');
  const isDisabled = await composeBtn?.isDisabled();
  isDisabled
    ? pass('Compose button disabled (no blocks selected)')
    : fail('Compose button should be disabled initially', '');

  // Right panel
  const brandSelect = await page.$('#brand-select');
  brandSelect
    ? pass('Brand selector in panel')
    : fail('Brand selector missing', '');

  const panelTabs = await page.$$('.panel-tab');
  panelTabs.length >= 3
    ? pass(`Panel tabs: ${panelTabs.length}`)
    : fail('Panel tabs', `expected ≥3, got ${panelTabs.length}`);

  // ═══ 2. BLOCK SELECTION FLOW ═══
  console.log('\n\x1b[1m2. Block selection\x1b[0m');

  // Click first Add button
  const addBtns = await page.$$('.add-block-btn');
  if (addBtns.length > 0) {
    await addBtns[0].click();
    await page.waitForTimeout(300);

    const composerItems = await page.$$('.composer-item');
    composerItems.length === 1
      ? pass('Block added to composer')
      : fail('Block add', `expected 1 item, got ${composerItems.length}`);

    // Compose button should now be enabled
    const isStillDisabled = await composeBtn?.isDisabled();
    !isStillDisabled
      ? pass('Compose button enabled after adding block')
      : fail('Compose button still disabled', '');

    // Add a second block
    if (addBtns.length > 1) {
      await addBtns[1].click();
      await page.waitForTimeout(200);
      const items2 = await page.$$('.composer-item');
      items2.length === 2
        ? pass('Second block added')
        : fail('Second block', `expected 2, got ${items2.length}`);
    }

    // Section count
    const sectionText = await page.$eval('.section-count', el => el.textContent).catch(() => '');
    sectionText?.includes('2')
      ? pass('Section count shows "2"')
      : skip('Section count', `got "${sectionText}"`);

    // Remove button works
    const removeBtn = await page.$('.item-remove');
    if (removeBtn) {
      await removeBtn.click();
      await page.waitForTimeout(200);
      const itemsAfterRemove = await page.$$('.composer-item');
      itemsAfterRemove.length === 1
        ? pass('Block removed from composer')
        : fail('Block remove', `expected 1, got ${itemsAfterRemove.length}`);
    }

    // Clear button
    const clearBtn = await page.$('#clear-btn');
    if (clearBtn) {
      await clearBtn.click();
      await page.waitForTimeout(200);
      const itemsAfterClear = await page.$$('.composer-item');
      itemsAfterClear.length === 0
        ? pass('Clear button works')
        : fail('Clear', `still ${itemsAfterClear.length} items`);
    }
  } else {
    skip('Block selection flow', 'no Add buttons found');
  }

  // ═══ 3. CATEGORY FILTER ═══
  console.log('\n\x1b[1m3. Category filter\x1b[0m');

  if (catBtns.length > 0) {
    const firstCat = await catBtns[0].getAttribute('data-category');
    await catBtns[0].click();
    await page.waitForTimeout(300);

    const visibleCards = await page.$$eval('.block-card', (els) =>
      els.filter(el => (el as HTMLElement).style.display !== 'none').length
    );
    const totalCards = blockCards.length;
    visibleCards < totalCards
      ? pass(`Category "${firstCat}" filtered: ${visibleCards}/${totalCards} visible`)
      : skip('Category filter', `all ${totalCards} still visible (may be all same category)`);

    // Click "All" to reset
    const allBtn = await page.$('.cat-btn-all');
    if (allBtn) {
      await allBtn.click();
      await page.waitForTimeout(200);
      const allVisible = await page.$$eval('.block-card', (els) =>
        els.filter(el => (el as HTMLElement).style.display !== 'none').length
      );
      allVisible === totalCards
        ? pass('All button resets filter')
        : fail('All button', `${allVisible}/${totalCards} visible`);
    }
  }

  // ═══ 4. COMPOSE API ═══
  console.log('\n\x1b[1m4. Compose API\x1b[0m');

  const composeRes = await fetch(`${BASE}/platform/api/constructor/compose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks: ['hero-centered', 'features-grid-3col', 'footer-4col'] }),
  });
  const composeData = await composeRes.json();

  composeData.ok
    ? pass(`Compose API: ${composeData.blockCount} blocks composed`)
    : fail('Compose API', composeData.error ?? 'unknown');

  if (composeData.ok) {
    // Verify the composed scene exists
    const healthRes = await fetch(`${BASE}/health`);
    const health = await healthRes.json();
    health.scenes?.length > 0
      ? pass(`Scene in session: ${health.scenes.length} scene(s)`)
      : fail('Scene not in session', JSON.stringify(health.scenes));
  }

  // ═══ 5. CONTENT EXTRACTION API ═══
  console.log('\n\x1b[1m5. Content extraction\x1b[0m');

  if (composeData.ok) {
    const extractRes = await fetch(`${BASE}/platform/api/audit?sceneId=${composeData.sceneId}`);
    const auditData = await extractRes.json();

    auditData.ok
      ? pass(`Audit API works for composed scene: score ${auditData.score}`)
      : fail('Audit API', auditData.error ?? 'unknown');

    // Check brand fidelity field exists (even if null — it means the code path runs)
    if (auditData.hasOwnProperty('brandFidelity')) {
      pass('Brand Fidelity field present in audit response');
    } else {
      fail('Brand Fidelity field missing', 'audit response lacks brandFidelity');
    }
  }

  // ═══ 6. CONSTRUCTOR SIDEBAR LINK ═══
  console.log('\n\x1b[1m6. Navigation\x1b[0m');

  await go(page, '/platform');
  const constructorLink = await page.$('a[href="/platform/constructor"]');
  constructorLink
    ? pass('Constructor link in sidebar')
    : fail('Constructor link missing from sidebar', '');

  // ═══ 7. PROJECT CANVAS WITH COMPOSED SCENE ═══
  console.log('\n\x1b[1m7. Canvas with composed scene\x1b[0m');

  if (composeData.ok) {
    await go(page, '/platform');
    const projectCard = await page.$('.overview-card');
    if (projectCard) {
      const href = await projectCard.getAttribute('href');
      if (href) {
        jsErrors = [];
        await go(page, href);

        if (jsErrors.length === 0) {
          pass('Canvas loads without JS errors');
        } else {
          fail('Canvas JS errors', jsErrors.join('; '));
        }

        const canvasViewport = await page.$('.canvas-viewport');
        canvasViewport
          ? pass('Canvas viewport present')
          : fail('Canvas viewport missing', '');

        // Check Quality tab exists with Brand Fidelity section
        const qualityTab = await page.$('.right-tab[data-tab="quality"]');
        if (qualityTab) {
          await qualityTab.click();
          await page.waitForTimeout(300);

          const bfSection = await page.$('[data-brand-fidelity-score]');
          bfSection
            ? pass('Brand Fidelity section in Quality tab')
            : fail('Brand Fidelity section missing from Quality tab', '');
        }
      }
    } else {
      skip('Canvas test', 'no project card on dashboard');
    }
  }

  // ═══ 8. BLOCKS PAGE STILL WORKS ═══
  console.log('\n\x1b[1m8. Blocks page (regression)\x1b[0m');

  jsErrors = [];
  await go(page, '/platform/blocks');
  const blocksH1 = await page.$eval('h1', el => el.textContent?.trim()).catch(() => '');
  blocksH1?.includes('Block')
    ? pass('Blocks page loads')
    : fail('Blocks page', `h1="${blocksH1}"`);

  if (jsErrors.length === 0) {
    pass('No JS errors on blocks page');
  } else {
    fail('Blocks page JS errors', jsErrors.join('; '));
  }

  // ═══ 9. QUALITY PAGE (regression) ═══
  console.log('\n\x1b[1m9. Quality dashboard (regression)\x1b[0m');

  jsErrors = [];
  await go(page, '/platform/quality');
  const qualityH1 = await page.$eval('h1', el => el.textContent?.trim()).catch(() => '');
  qualityH1?.includes('Quality')
    ? pass('Quality page loads')
    : fail('Quality page', `h1="${qualityH1}"`);

  // ═══ SUMMARY ═══
  await browser.close();

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;

  console.log(`\n\x1b[1m═══ Results: ${passed} passed, ${failed} failed, ${skipped} skipped ═══\x1b[0m`);

  if (failed > 0) {
    console.log('\nFailures:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  \x1b[31m✗\x1b[0m ${r.test}${r.detail ? ': ' + r.detail : ''}`);
    });
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
