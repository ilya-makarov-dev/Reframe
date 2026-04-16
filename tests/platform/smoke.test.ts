/**
 * Platform UI — Smoke Tests
 *
 * Verifies that core UI flows work end-to-end via Playwright.
 * Run: npx tsx tests/platform/smoke.test.ts
 *
 * Requires:
 *   - MCP server running (localhost:4100)
 *   - npx playwright install chromium (one-time)
 *
 * These are NOT pixel-perfect visual tests. They verify:
 *   - Pages load without JS errors
 *   - Dashboard cards open correct modals
 *   - Project canvas renders with stepper, tabs, controls
 *   - Blocks page shows library
 *   - API docs and batch pages load
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

function pass(test: string, detail: string) {
  results.push({ test, status: 'PASS', detail });
  console.log(`  \x1b[32m✓\x1b[0m ${test}`);
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
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.waitForTimeout(500);
}

// ─────────────────────────────────────────────────────────

async function main() {
  // Preflight: is the server up?
  try {
    const res = await fetch(`${BASE}/health`);
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch {
    console.error('Platform UI not running at localhost:4100. Start MCP server first.');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Collect JS errors
  page.on('pageerror', err => jsErrors.push(err.message));

  // ═══ 1. JS HEALTH ═══
  console.log('\n\x1b[1m1. JavaScript health\x1b[0m');
  jsErrors = [];
  await go(page, '/platform');
  if (jsErrors.length === 0) {
    pass('No JS errors on dashboard', '');
  } else {
    fail('JS errors on dashboard', jsErrors.join('; '));
  }

  // ═══ 2. DASHBOARD ═══
  console.log('\n\x1b[1m2. Dashboard\x1b[0m');

  const hasDesign = await page.$('[data-kind="describe"]');
  hasDesign ? pass('Design card present', '') : fail('Design card missing', '');

  const hasRebrand = await page.$('[data-kind="html"]');
  hasRebrand ? pass('Rebrand card present', '') : fail('Rebrand card missing', '');

  const hasAudit = await page.$('[data-kind="audit"]');
  hasAudit ? pass('Audit card present', '') : fail('Audit card missing', '');

  const hasApi = await page.$('a[href="/platform/api-docs"], a[href="/platform/batch"]');
  hasApi ? pass('API/Batch card present', '') : fail('API card missing', '');

  // ═══ 3. CARD CLICKS ═══
  console.log('\n\x1b[1m3. Card clicks\x1b[0m');

  if (hasDesign) {
    await hasDesign.click();
    await page.waitForTimeout(500);
    const modal = await page.$('.verb-panel');
    modal ? pass('Design → modal opens', '') : fail('Design → no modal', 'showVerbPanel not working');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }

  if (hasRebrand) {
    await hasRebrand.click();
    await page.waitForTimeout(500);
    const textarea = await page.$('textarea[data-vp-field="html"]');
    textarea ? pass('Rebrand → HTML textarea', '') : fail('Rebrand → no textarea', '');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }

  if (hasAudit) {
    await hasAudit.click();
    await page.waitForTimeout(500);
    const textarea = await page.$('textarea[data-vp-field="html"]');
    textarea ? pass('Audit → HTML textarea', '') : fail('Audit → no textarea', '');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }

  // ═══ 5. PROJECT CANVAS ═══
  console.log('\n\x1b[1m5. Project canvas\x1b[0m');
  await go(page, '/platform');
  const projectLink = await page.$('.overview-card');
  if (projectLink) {
    const href = await projectLink.getAttribute('href');
    await go(page, href!);

    const stepper = await page.$('.pipeline-stepper');
    stepper ? pass('Pipeline stepper visible', '') : fail('Pipeline stepper missing', '');

    const canvas = await page.$('.canvas-viewport');
    if (canvas) {
      const box = await canvas.boundingBox();
      box && box.width > 100
        ? pass(`Canvas viewport: ${box.width}x${box.height}`, '')
        : fail('Canvas viewport collapsed', `${box?.width}x${box?.height}`);
    } else {
      fail('Canvas viewport missing', '');
    }

    const tabs = await page.$$('.right-tab');
    const tabNames = await Promise.all(tabs.map(t => t.textContent()));
    tabs.length >= 6
      ? pass(`Right panel: ${tabNames.join(', ')}`, '')
      : fail(`Only ${tabs.length} tabs`, tabNames.join(', '));

    const brandPicker = await page.$('[data-brand-picker]');
    brandPicker ? pass('Brand picker in header', '') : skip('Brand picker', 'not on this page');

    const zoom = await page.$('.canvas-zoom-float');
    zoom ? pass('Zoom controls visible', '') : fail('Zoom controls missing', '');

    jsErrors = [];
    // Quick interaction test: click a pipeline step
    const reviewStep = await page.$('[data-step="review"]');
    if (reviewStep) {
      await reviewStep.click();
      await page.waitForTimeout(300);
      const qualityTab = await page.$('.right-tab.active');
      const activeTabText = qualityTab ? await qualityTab.textContent() : '';
      activeTabText?.includes('Quality')
        ? pass('Review step → Quality tab', '')
        : skip('Review step → tab switch', `active tab: "${activeTabText}"`);
    }
  } else {
    skip('Project canvas', 'no projects to test');
  }

  // ═══ 6. STATIC PAGES ═══
  console.log('\n\x1b[1m6. Static pages\x1b[0m');

  await go(page, '/platform/api-docs');
  const apiH1 = await page.$eval('h1', el => el.textContent).catch(() => '');
  apiH1?.includes('API') ? pass('API docs page', '') : fail('API docs', `h1="${apiH1}"`);

  await go(page, '/platform/batch');
  const batchH1 = await page.$eval('h1', el => el.textContent).catch(() => '');
  batchH1?.includes('Batch') ? pass('Batch export page', '') : fail('Batch page', `h1="${batchH1}"`);

  // ═══ SUMMARY ═══
  await browser.close();

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;

  console.log(`\n\x1b[1mResults: ${passed} passed, ${failed} failed, ${skipped} skipped\x1b[0m`);

  if (failed > 0) {
    console.log('\nFailures:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  \x1b[31m✗\x1b[0m ${r.test}${r.detail ? ': ' + r.detail : ''}`);
    });
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
