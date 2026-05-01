/**
 * Phase 1 UI-6b — Missing-surfaces drawer contract.
 *
 * Pins covered:
 *   #1 Drawer infrastructure
 *      — module exports mountDrawer + state shape + Cmd+\ binding
 *      — sibling-of-inspector mount (architectural lock from UI-6a)
 *   #2-5 Tab content modules (Quality / Variations / Tokens / Rebrand)
 *      — each tab body markup + endpoint wiring
 *   #6 Cmd+K palette repointing
 *      — 4 commands invoke window.reframeOpenDrawer with correct tab id
 *   #7 Visual polish CSS
 *      — slide-in transform + active tab border + drop shadow
 *   #8 (this file) Contract assertions
 *
 * No HTTP / DOM mocks beyond bundle string-search. Live behavior
 * (gestures, paint, slide-in animation) covered by the parallel
 * scripts/dev-qa/headless-probe.ts utility under designer-qa.
 *
 * Run: npx tsx packages/mcp/src/tests/week11-drawer-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DRAWER_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '170-drawer.js');
const DRAWER_TABS_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '171-drawer-tabs.js');
const STREAM_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '060-stream.js');
const INIT_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '160-init.js');
const SHELL_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'pages', 'editor-shell-page.ts');
const CSS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'platform-ui.css');

function main(): void {
  console.log('Phase 1 UI-6b — drawer contract\n');

  // ─── Pin #1 — Drawer infrastructure ────────────────────────
  console.log('Pin #1 — Drawer infrastructure');
  {
    const src = fs.readFileSync(DRAWER_JS, 'utf8');
    assert(/function bindDrawer\(/.test(src), 'Module exports bindDrawer');
    assert(/DRAWER_TAB_IDS = \['quality', 'variations', 'tokens', 'rebrand'\]/.test(src),
      'Four canonical tab ids declared in order');
    assert(/DRAWER_STORAGE_KEY = 'reframe-drawer-state'/.test(src),
      'State persisted under reframe-drawer-state key');
    assert(/window\.registerDrawerTab/.test(src),
      'Tab content registry exposed on window');
    assert(/window\.reframeOpenDrawer/.test(src),
      'Public open helper exposed for Cmd+K palette');
    assert(/window\.reframeCloseDrawer/.test(src),
      'Public close helper exposed');
    // Cmd+\ + Esc bindings
    assert(/meta && e\.key === '\\\\'/.test(src),
      'Cmd+\\\\ keydown handler present');
    assert(/lastBackslashAt/.test(src),
      'Sequential 1/2/3/4 tab pick within 1 s of Cmd+\\\\');
    assert(/e\.key === 'Escape'[\s\S]*?shouldDrawerHandleEscape/.test(src),
      'Esc close handler with priority gate');
    // Architectural lock: drawer NOT inside [data-panel="design"].
    const shell = fs.readFileSync(SHELL_TS, 'utf8');
    assert(/<div class="drawer-root"/.test(shell),
      'Editor shell mounts drawer-root');
    const drawerIdx = shell.indexOf('class="drawer-root"');
    const asideIdx = shell.indexOf('</aside>');
    assert(drawerIdx > 0 && asideIdx > 0 && drawerIdx > asideIdx,
      'drawer-root rendered AFTER closing </aside> (sibling, not nested) — UI-6a Pin #4 lock');
  }

  // ─── Pin #2 — Quality tab ──────────────────────────────────
  console.log('\nPin #2 — Quality tab');
  {
    const src = fs.readFileSync(DRAWER_TABS_JS, 'utf8');
    assert(/function renderQualityTab/.test(src), 'renderQualityTab defined');
    assert(/registerDrawerTab\('quality',\s*renderQualityTab\)/.test(src),
      'Quality renderer registered with drawer module');
    assert(/data-quality-analyze/.test(src), 'Analyze button present');
    assert(/\/platform\/api\/audit\?sceneId=/.test(src),
      'Wires to /api/audit endpoint with aesthetic=true');
    assert(/data-brand-fidelity-score/.test(src), 'Brand fidelity sub-section rendered');
  }

  // ─── Pin #3 — Variations tab ───────────────────────────────
  console.log('\nPin #3 — Variations tab');
  {
    const src = fs.readFileSync(DRAWER_TABS_JS, 'utf8');
    assert(/function renderVariationsTab/.test(src), 'renderVariationsTab defined');
    assert(/registerDrawerTab\('variations',\s*renderVariationsTab\)/.test(src),
      'Variations renderer registered');
    assert(/data-vary-axis="density"/.test(src), 'Density axis button');
    assert(/data-vary-axis="radius"/.test(src), 'Radius axis button');
    assert(/data-vary-axis="shadows"/.test(src), 'Shadows axis button');
    assert(/data-vary-axis="rotateColors"/.test(src), 'Rotate colors axis button');
    assert(/\/platform\/api\/variations\/apply/.test(src),
      'Wires to /api/variations/apply endpoint');
  }

  // ─── Pin #4 — Tokens tab ───────────────────────────────────
  console.log('\nPin #4 — Tokens tab');
  {
    const src = fs.readFileSync(DRAWER_TABS_JS, 'utf8');
    assert(/function renderTokensTab/.test(src), 'renderTokensTab defined');
    assert(/registerDrawerTab\('tokens',\s*renderTokensTab\)/.test(src),
      'Tokens renderer registered');
    assert(/\/platform\/api\/tokens\/'\s*\+\s*encodeURIComponent\(sid\)/.test(src),
      'Wires to /api/tokens/{sceneId} endpoint');
    assert(/drawer-token-swatch/.test(src), 'Color swatches inline for COLOR-typed tokens');
  }

  // ─── Pin #5 — Rebrand tab ──────────────────────────────────
  console.log('\nPin #5 — Rebrand tab');
  {
    const src = fs.readFileSync(DRAWER_TABS_JS, 'utf8');
    assert(/function renderRebrandTab/.test(src), 'renderRebrandTab defined');
    assert(/registerDrawerTab\('rebrand',\s*renderRebrandTab\)/.test(src),
      'Rebrand renderer registered');
    // Phase 3 Brief 3a Pin #7 subsumed inline rebrand UI into the brand
    // workbench page (/platform/workbench/brands). The drawer tab now
    // ships a redirect button instead of the old select+apply inline
    // dropdown. Mode toggle (light/dark) stayed — not brand-scoped.
    assert(/data-bw-redirect/.test(src), 'Redirect button to brand workbench present');
    assert(/href="\/platform\/workbench\/brands"/.test(src),
      'Redirect href points at workbench page');
    assert(/data-mode-switch="light"/.test(src) && /data-mode-switch="dark"/.test(src),
      'Light/Dark mode toggle buttons');
    assert(/kind:\s*'mode'/.test(src),
      'Mode switch posts variations/apply with kind=mode');
  }

  // ─── Pin #6 — Cmd+K palette repointing ─────────────────────
  console.log('\nPin #6 — Cmd+K palette');
  {
    const src = fs.readFileSync(STREAM_JS, 'utf8');
    // Each repointed command falls through to reframeOpenDrawer with
    // the right tab id; legacy [data-tab="..."] click is the fallback.
    assert(/reframeOpenDrawer\('quality'\)/.test(src),
      'Quality command opens drawer to quality tab');
    assert(/reframeOpenDrawer\('rebrand'\)/.test(src),
      'Switch brand command opens drawer to rebrand tab');
    assert(/reframeOpenDrawer\('variations'\)/.test(src),
      'Generate variants command opens drawer to variations tab');
    assert(/reframeOpenDrawer\('tokens'\)/.test(src),
      'Tokens command opens drawer to tokens tab');
    // Each command shows the kbd hint
    const hintCount = (src.match(/⌘\\\\/g) || []).length;
    assert(hintCount >= 4, `kbd hint "⌘\\\\" appears in ≥4 command descriptions (got ${hintCount})`);
  }

  // ─── Pin #7 — Visual polish CSS ────────────────────────────
  console.log('\nPin #7 — Visual polish');
  {
    const css = fs.readFileSync(CSS, 'utf8');
    assert(/\.drawer-root\b[\s\S]*?transform:\s*translateX\(100%\)/.test(css),
      'Drawer slides in from right edge (translateX(100%) initial)');
    assert(/\.drawer-root\.open\b[\s\S]*?transform:\s*translateX\(0\)/.test(css),
      '.open class translates to 0 for slide-in');
    assert(/transition:\s*transform 200ms ease-out/.test(css),
      'Slide animation 200ms ease-out');
    assert(/box-shadow:\s*-4px 0 16px/.test(css),
      'Drop shadow on left edge for elevation');
    assert(/\.drawer-tab\.active\b[\s\S]*?border-bottom-color:\s*rgb\(43, 116, 255\)/.test(css),
      'Active tab border matches Phase 1 focus-ring identity');
  }

  // ─── Init wiring ───────────────────────────────────────────
  console.log('\nInit wiring');
  {
    const init = fs.readFileSync(INIT_JS, 'utf8');
    assert(/bindDrawer\(\)/.test(init),
      'bindDrawer called from 160-init.js');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
