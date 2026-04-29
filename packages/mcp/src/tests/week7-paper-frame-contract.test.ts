/**
 * T3 #12 Paper-frame wrapper — Platform UI styling contract.
 *
 * The paper-frame is shell-only — no engine changes. Tests cover:
 *   1. CSS rules present in platform-ui.css bundle (the shipping artifact)
 *   2. Editor-mode body class scoping rule keyed to .reframe-editor-mode
 *   3. Iframe creation in renderer.ts attaches the class
 *   4. Three-tier shadow stack present (close + medium + depth)
 *   5. Hover rule intensifies shadow
 *   6. Desk background only applies under .reframe-editor-mode (not bare body)
 *
 * No HTTP / DOM probe — Platform UI CSS + iframe class are static files.
 * Reading them as fixtures is the most direct contract surface; runtime
 * behavior in a real browser is covered by manual probe (live verify).
 *
 * Run: npx tsx packages/mcp/src/tests/week7-paper-frame-contract.test.ts
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
const PLATFORM_CSS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'platform-ui.css');
const RENDERER_TS = path.join(REPO_ROOT, 'packages', 'editor', 'src', 'canvas-dom', 'renderer.ts');
const BOOTSTRAP_TS = path.join(REPO_ROOT, 'packages', 'editor', 'src', 'app', 'platform-bootstrap.ts');

let cssText = '';
let rendererText = '';
let bootstrapText = '';

function loadFixtures(): void {
  cssText = fs.readFileSync(PLATFORM_CSS, 'utf-8');
  rendererText = fs.readFileSync(RENDERER_TS, 'utf-8');
  bootstrapText = fs.readFileSync(BOOTSTRAP_TS, 'utf-8');
}

// ─── TEST 1: CSS class rule present ──
async function testCssClassRule(): Promise<void> {
  loadFixtures();
  assert(cssText.includes('.reframe-canvas-iframe'), 'css: .reframe-canvas-iframe selector present');
  // Rule body has the visual treatment we're after.
  assert(/\.reframe-canvas-iframe\s*\{[^}]*border-radius/s.test(cssText), 'css: border-radius declared');
  assert(/\.reframe-canvas-iframe\s*\{[^}]*box-shadow/s.test(cssText), 'css: box-shadow declared');
  assert(/\.reframe-canvas-iframe\s*\{[^}]*transition/s.test(cssText), 'css: transition declared (for hover ease)');
}

// ─── TEST 2: editor-mode body class rule ──
async function testEditorModeRule(): Promise<void> {
  assert(cssText.includes('body.reframe-editor-mode'), 'css: body.reframe-editor-mode selector present');
  assert(/body\.reframe-editor-mode\s*\{[^}]*background:\s*#?[a-fA-F0-9]{3,6}/s.test(cssText), 'css: editor-mode background colour set');
  // Subtle radial gradient overlay.
  assert(/body\.reframe-editor-mode\s*\{[^}]*radial-gradient/s.test(cssText), 'css: editor-mode has radial-gradient overlay');
}

// ─── TEST 3: renderer.ts attaches class ──
async function testRendererAttachesClass(): Promise<void> {
  // The iframe element must carry the class set on creation. If the
  // attachment line is absent, the visual treatment never reaches the
  // DOM no matter how many CSS rules we ship.
  assert(rendererText.includes("iframe.className = 'reframe-canvas-iframe'"), 'renderer: iframe.className assigns reframe-canvas-iframe');
}

// ─── TEST 4: three-tier shadow stack ──
async function testThreeTierShadow(): Promise<void> {
  // Pull the .reframe-canvas-iframe rule body and count box-shadow layers.
  const m = cssText.match(/\.reframe-canvas-iframe\s*\{([^}]*)\}/s);
  assert(m !== null, 'shadow: rule body extracted');
  if (m) {
    const body = m[1];
    const shadowMatch = body.match(/box-shadow:\s*([^;]+);/);
    assert(shadowMatch !== null, 'shadow: box-shadow declaration parsed');
    if (shadowMatch) {
      // Three-tier = three rgba() entries separated by top-level commas.
      // Counting occurrences of `rgba(` is robust against the commas
      // inside each rgba() value that would confuse a naive .split(',').
      const layers = (shadowMatch[1].match(/rgba\(/g) ?? []).length;
      assert(layers === 3, `shadow: three-tier stack (got ${layers} layers)`);
    }
  }
}

// ─── TEST 5: hover rule intensifies ──
async function testHoverRule(): Promise<void> {
  assert(cssText.includes('.reframe-canvas-iframe:hover'), 'hover: :hover selector present');
  // Hover rule should also have box-shadow (intensified version).
  assert(/\.reframe-canvas-iframe:hover\s*\{[^}]*box-shadow/s.test(cssText), 'hover: box-shadow declared');
}

// ─── TEST 6: bootstrap adds editor-mode class ──
async function testBootstrapAddsClass(): Promise<void> {
  // Verify the platform-bootstrap (editor entry point) actually adds
  // the class to body. Without this, the desk background never
  // activates because the rule is keyed on body.reframe-editor-mode.
  assert(bootstrapText.includes("classList.add('reframe-editor-mode')"), 'bootstrap: body.classList.add(reframe-editor-mode) present');
}

// ─── TEST 7: desk background scoped to editor mode ──
async function testDeskBackgroundScoped(): Promise<void> {
  // The desk background must NOT apply to plain `body` — only
  // body.reframe-editor-mode. Otherwise dashboard / project-list views
  // would also pick it up, breaking their existing chrome.
  // Look for any rule body that targets bare `body` and sets the desk
  // colour (#f5f5f3); should be NONE.
  // Pull every CSS rule with selector "body { ... }" (no class on body)
  // and verify none of them sets the desk colour. The editor-mode rule
  // uses body.reframe-editor-mode — the dot prevents matching here.
  const bareBodyRules = [...cssText.matchAll(/(?:^|\})\s*body\s*\{([^}]+)\}/g)];
  let leakedDeskColour = false;
  for (const r of bareBodyRules) {
    if (r[1].includes('#f5f5f3')) leakedDeskColour = true;
  }
  assert(!leakedDeskColour, 'scope: desk colour #f5f5f3 NOT in bare body { ... } rules');
  // And the editor-mode rule does have it.
  assert(/body\.reframe-editor-mode\s*\{[^}]*#f5f5f3/s.test(cssText), 'scope: editor-mode rule does set desk colour');
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('T3 #12 Paper-frame contract\n');

  const tests: Array<[string, () => Promise<void>]> = [
    ['CSS .reframe-canvas-iframe rule present (border-radius / box-shadow / transition)', testCssClassRule],
    ['CSS body.reframe-editor-mode rule present (background + radial-gradient)', testEditorModeRule],
    ['renderer.ts assigns iframe.className = reframe-canvas-iframe', testRendererAttachesClass],
    ['three-tier shadow stack (close + medium + depth)', testThreeTierShadow],
    ['hover rule intensifies box-shadow', testHoverRule],
    ['platform-bootstrap adds .reframe-editor-mode to body on mount', testBootstrapAddsClass],
    ['desk background scoped to .reframe-editor-mode (not leaked to bare body)', testDeskBackgroundScoped],
  ];

  for (const [name, fn] of tests) {
    console.log(`▸ ${name}`);
    try { await fn(); }
    catch (err: any) {
      failed++;
      console.error(`  UNEXPECTED ERROR: ${err?.message ?? err}`);
      if (err?.stack) console.error(err.stack.split('\n').slice(0, 6).join('\n'));
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
