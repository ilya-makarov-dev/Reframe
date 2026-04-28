/**
 * T2 #26 Tweakable Bundle — parser / exporter / panel injection contract.
 *
 * Tests:
 *   1. Parser detects ## Tweak Surface section → tweakSurface populated
 *   2. Parser parses both color + range types with min/max/step/unit
 *   3. Parser drops invalid entries (unknown type, missing min/max for range)
 *   4. Backward compat — tweakable=false (default) produces identical output
 *   5. Backward compat — tweakable=true on brand without ## Tweak Surface
 *      → graceful no-op (warning, output unchanged)
 *   6. CSS vars emitted: tweakable=true + tweakSurface present →
 *      output contains :root block with --reframe-color-primary etc.
 *   7. Panel HTML injected: output contains <div id="reframe-tweak-surface">
 *      with control inputs matching tweakSurface defs
 *   8. Panel CSS injected: position:fixed top-right rules present
 *   9. Runtime IIFE injected: output contains <script> with __reframeTweakRuntime
 *  10. Color vs range — color tokens emit type="color" inputs, range emit type="range"
 *  11. Determinism — bundle same scene + tweakable=true twice → byte-identical
 *  12. localStorage key per pathname: runtime references location.pathname
 *  13. Selective var substitution: only tokens listed in tweakSurface get var()
 *      treatment in scene styles; other token-bound values stay hardcoded
 *  14. tweak-panel helpers (varNameForToken, generateRootVarsCss) — unit checks
 *
 * Run: npx tsx packages/mcp/src/tests/week7-tweakable-bundle-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import { parseDesignMd } from '../../../core/src/design-system/parser.js';
import { exportSceneGraphToBundle } from '../../../core/src/exporters/bundle.js';
import {
  generatePanelHtml,
  generatePanelCss,
  generateRootVarsCss,
  varNameForToken,
} from '../../../core/src/exporters/tweak-panel.js';
import { TWEAK_RUNTIME_SOURCE } from '../../../core/src/exporters/tweak-runtime.js';
import type { TweakDef, DesignSystem } from '../../../core/src/design-system/types.js';
import type { ResourceFetcher } from '../../../core/src/exporters/inline-fonts.js';
import { handleCompile } from '../tools/compile.js';
import { getScene, getSessionId } from '../store.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

async function compileScene(name: string, html: string): Promise<{ sessionId: string }> {
  const result = await handleCompile({ html, name, audit: false, preview: false, exports: [] } as any);
  const text = (result as any).content?.[0]?.text ?? '';
  const sessionId = text.match(/Scenes?:\s*(s\d+)/)?.[1] ?? getSessionId(name) ?? '';
  if (!sessionId) throw new Error(`compileScene: no session for ${name}`);
  if (!getScene(sessionId)) throw new Error(`compileScene: no stored scene for ${name}`);
  return { sessionId };
}

// Mock fetcher — bundle exporter calls this for fonts. Empty map means
// every fetch fails; bundle falls back gracefully (font links retained).
function makeNoopFetcher(): ResourceFetcher {
  return {
    async fetchText(url) { throw new Error(`no-op: ${url}`); },
    async fetchBinary(url) { throw new Error(`no-op: ${url}`); },
  };
}

// Reference DESIGN.md fragment with tweak surface section.
const dsmdWithTweaks = `
# Acme Brand

## Color
primary: #635bff
accent: #00d4ff
background: #ffffff
surface: #fafafa

## Layout
spacing: 16
section-spacing: 96
borderRadiusScale: 4 8 12 16 9999

## Typography
hero: 48px / 700
title: 24px / 600
body: 16px / 400

## Tweak Surface

Tweakable tokens (end-user customizable in bundle exports):

- color/primary
  type: color
  label: Primary brand color
- color/accent
  type: color
  label: Accent
- radius/medium
  type: range
  min: 0
  max: 24
  step: 2
  unit: px
  label: Border radius
- spacing/scale
  type: range
  min: 0.6
  max: 1.4
  step: 0.1
  unit: x
  label: Spacing density
`;

const dsmdNoTweaks = `
# Acme Brand

## Color
primary: #635bff

## Layout
spacing: 16
borderRadiusScale: 4 8 12

## Typography
body: 16px / 400
`;

// ─── TEST 1: parser detects section ──
async function testParserDetect(): Promise<void> {
  const ds = parseDesignMd(dsmdWithTweaks);
  assert(Array.isArray(ds.tweakSurface), 'parser: tweakSurface is array');
  assert(ds.tweakSurface!.length === 4, `parser: 4 entries (got ${ds.tweakSurface!.length})`);
}

// ─── TEST 2: parser handles both types ──
async function testParserBothTypes(): Promise<void> {
  const ds = parseDesignMd(dsmdWithTweaks);
  const byPath = Object.fromEntries(ds.tweakSurface!.map(d => [d.tokenPath, d]));
  const colorPrim = byPath['color/primary'];
  assert(colorPrim?.type === 'color', `parser: color/primary type = color (got ${colorPrim?.type})`);
  assert(colorPrim?.label === 'Primary brand color', 'parser: color label preserved');

  const radius = byPath['radius/medium'];
  assert(radius?.type === 'range', 'parser: radius/medium type = range');
  assert(radius?.min === 0, `parser: radius min=0 (got ${radius?.min})`);
  assert(radius?.max === 24, 'parser: radius max=24');
  assert(radius?.step === 2, 'parser: radius step=2');
  assert(radius?.unit === 'px', 'parser: radius unit=px');

  const spacing = byPath['spacing/scale'];
  assert(spacing?.unit === 'x', 'parser: spacing unit=x (multiplier)');
  assert(spacing?.step === 0.1, `parser: spacing step=0.1 (got ${spacing?.step})`);
}

// ─── TEST 3: parser drops invalid entries ──
async function testParserDropsInvalid(): Promise<void> {
  const md = `
# X

## Tweak Surface

- color/primary
  type: gradient
  label: bogus type
- range/no-bounds
  type: range
  label: missing min and max
- color/good
  type: color
  label: valid color
`;
  // Suppress console warns — parser logs about invalid entries by design.
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const ds = parseDesignMd(md);
    assert(ds.tweakSurface?.length === 1, `parser: 1 valid entry survives (got ${ds.tweakSurface?.length})`);
    assert(ds.tweakSurface?.[0].tokenPath === 'color/good', 'parser: only valid entry kept');
  } finally {
    console.warn = origWarn;
  }
}

// ─── TEST 4: backward compat — tweakable=false (default) ──
async function testBackwardCompatDefault(): Promise<void> {
  const { sessionId } = await compileScene(
    'tweak-bc-default',
    '<div style="width:300px;padding:24px;background:#635bff;color:#fff;font-family:Inter,sans-serif;font-size:16px">Hello</div>',
  );
  const stored = getScene(sessionId)!;
  const noFlag = await exportSceneGraphToBundle(stored.graph, stored.rootId, { fetcher: makeNoopFetcher() });
  const explicitFalse = await exportSceneGraphToBundle(stored.graph, stored.rootId, { fetcher: makeNoopFetcher(), tweakable: false });
  assert(noFlag.html === explicitFalse.html, 'bc: tweakable=false === default');
  assert(!noFlag.html.includes('reframe-tweak-surface'), 'bc: no panel');
  assert(!noFlag.html.includes('__reframeTweakRuntime'), 'bc: no runtime');
  assert(!noFlag.html.includes('--reframe-color-primary'), 'bc: no css vars');
}

// ─── TEST 5: tweakable=true on brand without ## Tweak Surface ──
async function testTweakableNoSection(): Promise<void> {
  const ds = parseDesignMd(dsmdNoTweaks);
  assert(ds.tweakSurface === undefined, 'no-section: tweakSurface undefined');

  const { sessionId } = await compileScene(
    'tweak-no-section',
    '<div style="width:300px;padding:24px;background:#fff;color:#111">Plain</div>',
  );
  const stored = getScene(sessionId)!;
  const result = await exportSceneGraphToBundle(stored.graph, stored.rootId, {
    fetcher: makeNoopFetcher(),
    tweakable: true,
    designSystem: ds,
  });
  assert(!result.html.includes('reframe-tweak-surface'), 'no-section: no panel injected');
  assert(!result.html.includes('__reframeTweakRuntime'), 'no-section: no runtime injected');
  assert(result.warnings.some(w => w.includes('Tweak Surface')), 'no-section: warning emitted about missing section');
}

// ─── TEST 6: CSS vars emitted in :root ──
async function testCssVarsEmitted(): Promise<void> {
  const ds = parseDesignMd(dsmdWithTweaks);
  const { sessionId } = await compileScene(
    'tweak-vars',
    '<div style="width:300px;padding:24px;background:#635bff;color:#fff">Vars</div>',
  );
  const stored = getScene(sessionId)!;
  const result = await exportSceneGraphToBundle(stored.graph, stored.rootId, {
    fetcher: makeNoopFetcher(),
    tweakable: true,
    designSystem: ds,
  });
  assert(result.html.includes('--reframe-color-primary:'), 'vars: --reframe-color-primary present');
  assert(result.html.includes('--reframe-color-accent:'), 'vars: --reframe-color-accent present');
  assert(result.html.includes('--reframe-radius-medium:'), 'vars: --reframe-radius-medium present');
  assert(result.html.includes('#635bff'), 'vars: initial primary value present');
}

// ─── TEST 7: panel HTML injected ──
async function testPanelHtmlInjected(): Promise<void> {
  const ds = parseDesignMd(dsmdWithTweaks);
  const { sessionId } = await compileScene(
    'tweak-panel-html',
    '<div style="width:300px;padding:24px;background:#635bff;color:#fff">Panel</div>',
  );
  const stored = getScene(sessionId)!;
  const result = await exportSceneGraphToBundle(stored.graph, stored.rootId, {
    fetcher: makeNoopFetcher(),
    tweakable: true,
    designSystem: ds,
  });
  assert(result.html.includes('id="reframe-tweak-surface"'), 'panel: root div present');
  assert(result.html.includes('data-token="color/primary"'), 'panel: color/primary input');
  assert(result.html.includes('data-token="color/accent"'), 'panel: color/accent input');
  assert(result.html.includes('data-token="radius/medium"'), 'panel: radius/medium input');
  assert(result.html.includes('data-token="spacing/scale"'), 'panel: spacing/scale input');
  assert(result.html.includes('Reset to default'), 'panel: reset button label');
}

// ─── TEST 8: panel CSS injected ──
async function testPanelCssInjected(): Promise<void> {
  const ds = parseDesignMd(dsmdWithTweaks);
  const { sessionId } = await compileScene(
    'tweak-panel-css',
    '<div style="width:300px;padding:24px;background:#635bff">CSS</div>',
  );
  const stored = getScene(sessionId)!;
  const result = await exportSceneGraphToBundle(stored.graph, stored.rootId, {
    fetcher: makeNoopFetcher(),
    tweakable: true,
    designSystem: ds,
  });
  assert(result.html.includes('position: fixed'), 'css: position:fixed (panel anchoring)');
  assert(result.html.includes('reframe-tweak-collapsed'), 'css: collapsed-state class');
  assert(result.html.includes('reframe-tweak-toggle'), 'css: toggle button rule');
  assert(result.html.includes('z-index: 99999'), 'css: high z-index (panel on top)');
}

// ─── TEST 9: runtime IIFE injected ──
async function testRuntimeIifeInjected(): Promise<void> {
  const ds = parseDesignMd(dsmdWithTweaks);
  const { sessionId } = await compileScene(
    'tweak-runtime',
    '<div style="background:#635bff">x</div>',
  );
  const stored = getScene(sessionId)!;
  const result = await exportSceneGraphToBundle(stored.graph, stored.rootId, {
    fetcher: makeNoopFetcher(),
    tweakable: true,
    designSystem: ds,
  });
  assert(result.html.includes('__reframeTweakRuntime'), 'runtime: idempotent guard present');
  assert(result.html.includes('localStorage'), 'runtime: localStorage wiring');
  assert(result.html.includes('STORAGE_KEY'), 'runtime: per-pathname storage key');
  assert(result.html.includes('location.pathname'), 'runtime: pathname referenced');
}

// ─── TEST 10: color vs range input types ──
async function testColorVsRangeInputs(): Promise<void> {
  const ds = parseDesignMd(dsmdWithTweaks);
  const { sessionId } = await compileScene(
    'tweak-types',
    '<div style="background:#635bff">x</div>',
  );
  const stored = getScene(sessionId)!;
  const result = await exportSceneGraphToBundle(stored.graph, stored.rootId, {
    fetcher: makeNoopFetcher(),
    tweakable: true,
    designSystem: ds,
  });
  // 2 color inputs, 2 range inputs.
  const colorInputs = (result.html.match(/<input type="color"/g) ?? []).length;
  const rangeInputs = (result.html.match(/<input type="range"/g) ?? []).length;
  assert(colorInputs === 2, `inputs: 2 color inputs (got ${colorInputs})`);
  assert(rangeInputs === 2, `inputs: 2 range inputs (got ${rangeInputs})`);
}

// ─── TEST 11: determinism ──
async function testDeterminism(): Promise<void> {
  const ds = parseDesignMd(dsmdWithTweaks);
  const { sessionId } = await compileScene(
    'tweak-det',
    '<div style="width:300px;background:#635bff;color:#fff">det</div>',
  );
  const stored = getScene(sessionId)!;
  const a = await exportSceneGraphToBundle(stored.graph, stored.rootId, {
    fetcher: makeNoopFetcher(),
    tweakable: true,
    designSystem: ds,
  });
  const b = await exportSceneGraphToBundle(stored.graph, stored.rootId, {
    fetcher: makeNoopFetcher(),
    tweakable: true,
    designSystem: ds,
  });
  assert(a.html === b.html, 'determinism: byte-identical across two compiles');
}

// ─── TEST 12: localStorage key per pathname ──
async function testLocalStorageKey(): Promise<void> {
  // The runtime IIFE source itself references location.pathname.
  // Verify the constant has the expected shape rather than rely on
  // bundle output (covered by test 9).
  assert(TWEAK_RUNTIME_SOURCE.includes("'reframe-tweaks-' + location.pathname"), 'runtime: storage key built from pathname');
}

// ─── TEST 13: selective var substitution ──
async function testSelectiveSubstitution(): Promise<void> {
  // Brand has primary tweakable but background NOT tweakable.
  // Scene uses both colors. After substitution, only primary becomes
  // var(...); background stays hardcoded.
  const dsmdSelective = `
# X

## Color
primary: #635bff
accent: #00d4ff
background: #ffffff

## Layout
spacing: 16
borderRadiusScale: 4 8

## Typography
body: 16px / 400

## Tweak Surface

- color/primary
  type: color
  label: Primary
`;
  const ds = parseDesignMd(dsmdSelective);
  const { sessionId } = await compileScene(
    'tweak-selective',
    '<div style="width:300px;padding:24px;background:#635bff;color:#fff"><h1 style="background:#ffffff;color:#111">Title</h1></div>',
  );
  const stored = getScene(sessionId)!;
  const result = await exportSceneGraphToBundle(stored.graph, stored.rootId, {
    fetcher: makeNoopFetcher(),
    tweakable: true,
    designSystem: ds,
  });
  assert(result.html.includes('var(--reframe-color-primary'), 'selective: primary uses var()');
  // Background hex should still appear — but uniquely we want NO
  // var(--reframe-color-background) reference (since it's not tweakable).
  assert(!result.html.includes('--reframe-color-background'), 'selective: background NOT made into var()');
}

// ─── TEST 14: helper functions ──
async function testHelpers(): Promise<void> {
  assert(varNameForToken('color/primary') === '--reframe-color-primary', 'helper: varNameForToken color');
  assert(varNameForToken('radius/medium') === '--reframe-radius-medium', 'helper: varNameForToken radius');
  assert(varNameForToken('spacing/scale') === '--reframe-spacing-scale', 'helper: varNameForToken spacing');

  const defs: TweakDef[] = [
    { tokenPath: 'color/primary', type: 'color', label: 'Primary' },
    { tokenPath: 'radius/medium', type: 'range', label: 'Radius', min: 0, max: 24, step: 2, unit: 'px' },
  ];
  const initial = { 'color/primary': '#635bff', 'radius/medium': '8' };
  const css = generateRootVarsCss(defs, initial);
  assert(css.includes(':root {'), 'helper: generateRootVarsCss emits :root block');
  assert(css.includes('--reframe-color-primary: #635bff;'), 'helper: color var with hex');
  assert(css.includes('--reframe-radius-medium: 8px;'), 'helper: range var with unit');

  const html = generatePanelHtml(defs, initial);
  assert(html.includes('input type="color"'), 'helper: generatePanelHtml emits color input');
  assert(html.includes('input type="range"'), 'helper: generatePanelHtml emits range input');
  assert(html.includes('value="#635bff"'), 'helper: initial color value in attribute');

  const panelCss = generatePanelCss();
  assert(panelCss.includes('position: fixed'), 'helper: generatePanelCss emits position:fixed');
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('T2 #26 Tweakable Bundle contract\n');

  const tests: Array<[string, () => Promise<void>]> = [
    ['parser detects ## Tweak Surface section', testParserDetect],
    ['parser handles color + range types with min/max/step/unit', testParserBothTypes],
    ['parser drops invalid entries (unknown type, missing range bounds)', testParserDropsInvalid],
    ['backward compat — tweakable=false (default) emits unchanged bundle', testBackwardCompatDefault],
    ['tweakable=true on brand without ## Tweak Surface — graceful no-op', testTweakableNoSection],
    ['CSS vars emitted in :root for tweakable tokens', testCssVarsEmitted],
    ['panel HTML injected with all controls', testPanelHtmlInjected],
    ['panel CSS injected (position:fixed top-right)', testPanelCssInjected],
    ['runtime IIFE injected with localStorage wiring', testRuntimeIifeInjected],
    ['color vs range input types — emit type="color" and type="range" correctly', testColorVsRangeInputs],
    ['determinism — bundle twice with same input → byte-identical', testDeterminism],
    ['localStorage key built from location.pathname (per-bundle scoping)', testLocalStorageKey],
    ['selective substitution — only tweakable tokens get var(); rest hardcoded', testSelectiveSubstitution],
    ['helpers (varNameForToken, generateRootVarsCss, generatePanelHtml/Css)', testHelpers],
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
