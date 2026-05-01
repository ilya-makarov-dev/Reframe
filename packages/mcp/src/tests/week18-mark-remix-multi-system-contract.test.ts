/**
 * Phase 3 Brief 3d — Brand mark upload + Remix + Follow-scene contract.
 *
 * Pins covered:
 *   #1 brand-mark POST upload + GET list endpoints — variant validation,
 *      SVG mimetype check, on-disk write at .reframe/brands/<slug>/marks/.
 *   #2 Workbench Brand Mark section markup (drop zone + variants strip
 *      + preview) — bundle string-search.
 *   #3 Catalog card logo display — page renderer + brandInitials helper.
 *   #4 cloneBrand helper — slug validation + DESIGN.md byte-identical
 *      copy + marks copy + manifest registration.
 *   #5 Remix modal markup + POST /api/workbench/clone-brand route.
 *   #6 Follow-scene toggle markup + localStorage key + subscriber
 *      filter (only pivots when toggle ON).
 *
 * Run: npx tsx packages/mcp/src/tests/week18-mark-remix-multi-system-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { initProject, cloneBrand, registerBrand, loadProject } from '../../../core/src/project/io.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const BRAND_MARK_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'api', 'brand-mark.ts');
const NODE_EDIT_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'api', 'node-edit.ts');
const ROUTER_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'router.ts');
const WORKBENCH_PAGE = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'pages', 'workbench-brands.ts');
const WORKBENCH_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '155-workbench-brands.js');
const CSS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'platform-ui.css');

function setup(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-3d-test-'));
  initProject(dir, '3d-test');
  // Seed source brand on disk + manifest.
  registerBrand(dir, 'source-brand',
    '# Source\n\n## Color Palette & Roles\n\n- **Primary** `#cf6a5f`\n',
    { setActive: false });
  // Add a marks/ directory with two SVG variants.
  const marksDir = path.join(dir, '.reframe', 'brands', 'source-brand', 'marks');
  fs.mkdirSync(marksDir, { recursive: true });
  fs.writeFileSync(path.join(marksDir, 'primary.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="8"/></svg>');
  fs.writeFileSync(path.join(marksDir, 'mono.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><rect width="20" height="20"/></svg>');
  return dir;
}

function main(): void {
  console.log('Phase 3 Brief 3d — Mark + Remix + Follow-scene contract\n');

  // ─── Pin #4 — cloneBrand helper ─────────────────────────────
  console.log('Pin #4 — cloneBrand');
  {
    const dir = setup();

    // Invalid slug → error
    const r1 = cloneBrand(dir, 'source-brand', 'Invalid Slug');
    assert(r1.ok === false, 'invalid slug rejected');

    // Same slug → error
    const r2 = cloneBrand(dir, 'source-brand', 'source-brand');
    assert(r2.ok === false, 'same source/new slug rejected');

    // Missing source → error
    const r3 = cloneBrand(dir, 'nonexistent', 'new-brand');
    assert(r3.ok === false, 'missing source brand rejected');

    // Happy path
    const r4 = cloneBrand(dir, 'source-brand', 'remixed-brand');
    assert(r4.ok === true, 'cloneBrand happy path');
    if (r4.ok) {
      assert(r4.entry.slug === 'remixed-brand', 'returned entry has new slug');
    }

    // Verify DESIGN.md copied byte-identical
    const sourceMd = fs.readFileSync(
      path.join(dir, '.reframe', 'brands', 'source-brand', 'DESIGN.md'), 'utf-8');
    const newMd = fs.readFileSync(
      path.join(dir, '.reframe', 'brands', 'remixed-brand', 'DESIGN.md'), 'utf-8');
    assert(sourceMd === newMd, 'DESIGN.md byte-identical after clone');

    // Verify marks copied
    const newMarksDir = path.join(dir, '.reframe', 'brands', 'remixed-brand', 'marks');
    assert(fs.existsSync(newMarksDir), 'marks/ directory created on clone');
    const newMarks = fs.readdirSync(newMarksDir).sort();
    assert(newMarks.length === 2 && newMarks[0] === 'mono.svg' && newMarks[1] === 'primary.svg',
      'both source marks copied');

    // Verify manifest registration
    const manifest = loadProject(dir);
    assert(manifest.brands?.['remixed-brand'] !== undefined,
      'new brand registered in manifest');

    // Existing slug → error
    const r5 = cloneBrand(dir, 'source-brand', 'remixed-brand');
    assert(r5.ok === false, 'cloning to existing slug rejected');

    // copyMarks: false skips marks copy
    const r6 = cloneBrand(dir, 'source-brand', 'no-marks-clone', { copyMarks: false });
    assert(r6.ok === true, 'copyMarks=false succeeds');
    const noMarksDir = path.join(dir, '.reframe', 'brands', 'no-marks-clone', 'marks');
    assert(!fs.existsSync(noMarksDir), 'marks/ NOT copied when copyMarks=false');

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ─── Pin #1 — brand-mark route declarations ─────────────────
  console.log('\nPin #1 — brand-mark POST + list routes');
  {
    const src = fs.readFileSync(BRAND_MARK_TS, 'utf-8');
    assert(/parseBrandMarksListPath/.test(src),
      'list path parser declared');
    assert(/req\.method === 'POST'/.test(src),
      'POST upload branch declared');
    assert(/parseFirstFilePart/.test(src),
      'multipart parser implemented');
    assert(/MAX_MARK_BYTES\s*=\s*200\s*\*\s*1024/.test(src),
      'size cap = 200 KB');
    assert(/VARIANT_NAME_RE/.test(src),
      'variant name regex defined');
    assert(/image\/svg\+xml/.test(src),
      'SVG mimetype check present');
    assert(/Sniff the bytes for/.test(src),
      'SVG body sniff guard present');
    assert(/emitEvent\(\{[\s\S]{0,80}'brand:edited'/.test(src),
      'upload broadcasts scoped brand:edited SSE');
  }

  // ─── Router whitelists /marks ───────────────────────────────
  console.log('\nPin #1 — router whitelist');
  {
    const r = fs.readFileSync(ROUTER_TS, 'utf-8');
    assert(/pathname\.endsWith\('\/marks'\)/.test(r),
      'router routes /marks list path to handleBrandMarkApi');
  }

  // ─── Pin #2 — workbench Brand Mark section markup ───────────
  console.log('\nPin #2 — Workbench Mark section markup');
  {
    const page = fs.readFileSync(WORKBENCH_PAGE, 'utf-8');
    assert(/function renderMarkSection/.test(page),
      'renderMarkSection function defined');
    assert(/data-bw-mark-block/.test(page),
      'mark block carries data attr');
    assert(/data-bw-mark-strip/.test(page),
      'variants strip data attr');
    assert(/data-bw-mark-drop/.test(page),
      'drop zone data attr');
    assert(/data-bw-mark-file/.test(page),
      'file input data attr');
    assert(/accept="image\/svg\+xml,\.svg"/.test(page),
      'file input accepts SVG only');
    assert(/Drag SVG here/.test(page),
      'drop zone copy present');

    const js = fs.readFileSync(WORKBENCH_JS, 'utf-8');
    assert(/function bindWorkbenchMarkUpload/.test(js),
      'mark-upload binder defined');
    assert(/new FormData/.test(js),
      'binder uses FormData for multipart upload');
    assert(/dropZone\.addEventListener\('drop'/.test(js),
      'drop event handler wired');
  }

  // ─── Pin #3 — catalog card logo display ─────────────────────
  console.log('\nPin #3 — catalog logo');
  {
    const page = fs.readFileSync(WORKBENCH_PAGE, 'utf-8');
    assert(/function brandInitials/.test(page),
      'brandInitials fallback helper defined');
    assert(/markInfo\?.defaultVariant/.test(page),
      'card consults markInfo.defaultVariant');
    assert(/<img class="bw-card-logo"/.test(page),
      'card emits bw-card-logo image when mark exists');

    const css = fs.readFileSync(CSS, 'utf-8');
    assert(/\.bw-card-logo/.test(css), 'card logo CSS rule present');
  }

  // ─── Pin #5 — Remix modal + clone-brand route ───────────────
  console.log('\nPin #5 — Remix modal + clone-brand route');
  {
    const page = fs.readFileSync(WORKBENCH_PAGE, 'utf-8');
    assert(/function renderRemixModal/.test(page),
      'renderRemixModal function defined');
    assert(/<dialog class="bw-remix-modal"/.test(page),
      'native <dialog> element used');
    assert(/data-bw-remix-input/.test(page),
      'slug input data attr');
    assert(/data-bw-remix-copy-marks/.test(page),
      'copy-marks checkbox data attr');
    assert(/-personal/.test(page),
      'auto-suggest slug appends -personal');
    assert(/pattern="\^\[a-z\]\[a-z0-9\\-\]\*\$"/.test(page),
      'inline pattern validation');

    const js = fs.readFileSync(WORKBENCH_JS, 'utf-8');
    assert(/function bindWorkbenchRemixModal/.test(js),
      'Remix modal binder defined');
    assert(/\/platform\/api\/workbench\/clone-brand/.test(js),
      'binder POSTs to clone-brand route');
    assert(/window\.location\.href\s*=\s*'\/platform\/workbench\/brands\?slug='/.test(js),
      'success path navigates to new slug workbench');

    const ne = fs.readFileSync(NODE_EDIT_TS, 'utf-8');
    assert(/'\/platform\/api\/workbench\/clone-brand' && req\.method === 'POST'/.test(ne),
      'clone-brand POST route declared');
    assert(/projectIo\.cloneBrand\(ctx\.projectDir, sourceSlug, newSlug/.test(ne),
      'route invokes core cloneBrand helper');
  }

  // ─── Pin #6 — follow-scene toggle ───────────────────────────
  console.log('\nPin #6 — Follow-scene toggle');
  {
    const page = fs.readFileSync(WORKBENCH_PAGE, 'utf-8');
    assert(/data-bw-follow-scene/.test(page),
      'follow-scene toggle data attr present');
    assert(/Follow active scene/.test(page),
      'toggle label copy present');

    const js = fs.readFileSync(WORKBENCH_JS, 'utf-8');
    assert(/function bindWorkbenchFollowScene/.test(js),
      'follow-scene binder defined');
    assert(/'reframe-workbench-follow-scene'/.test(js),
      'localStorage key matches brief');
    assert(/window\.__reframeBrandSubscribers\.push/.test(js),
      'subscriber registered for brand:applied events');
    assert(/if \(!toggle\.checked\) return;/.test(js),
      'subscriber early-returns when toggle OFF');
    assert(/encodeURIComponent\(ev\.slug\)/.test(js),
      'pivot navigates to active scene\'s brand slug');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
