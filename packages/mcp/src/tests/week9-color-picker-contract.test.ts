/**
 * Phase 1 UI-5b — Brand color picker rail contract.
 *
 * Pins covered:
 *   #1 parsePaletteFromDesignMd extracts named tokens with role inference
 *   #1 endpoint shape (bundle string-search; live HTTP exercised in
 *      designer-qa probe step #7)
 *   #2 color-picker-rail module: 3 rows + mountColorPickerRail export
 *   #3 inspector field swap: 120-widgets.js wires .fill-swatch click
 *      to mountColorPickerRail with engineKey mapping
 *   #4 node-edit handler accepts tokenBindings sibling key, null = unbind
 *   #5 platform-ui.css carries swatch grid + visual polish
 *
 * No HTTP / DOM mocks — pure helpers exercised directly, bundle wiring
 * asserted via string-search on the shipping artifact.
 *
 * Run: npx tsx packages/mcp/src/tests/week9-color-picker-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parsePaletteFromDesignMd,
  type BrandPaletteToken,
} from '../platform/api/brand-tokens.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const RAIL_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '116-color-picker-rail.js');
const WIDGETS_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '120-widgets.js');
const NODE_EDIT_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'api', 'node-edit.ts');
const ROUTER_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'router.ts');
const CSS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'platform-ui.css');

// Sample DESIGN.md in the kurzgesagt format (kept minimal — just the
// shapes the parser is asked to handle).
const SAMPLE_DESIGN_MD = `# Sample Brand

## Philosophy
Some intro text here.

## Colors

### Background
- **Primary:** \`#1c2541\` — deep navy
- **Secondary:** \`#0b132b\` — near-black
- **Accent BG:** \`#3a506b\` — muted slate

### Accents
- **Solar orange:** \`#ff9f1c\` — the sun
- **Cyan pop:** \`#5bc0eb\` — sky / data
- **Pink coral:** \`#ff6b6b\` — warmth

### Text
- **Primary text:** \`#f7f9fb\`
- **Muted text:** \`#a8b8cc\`

## Typography

- Display: Inter
`;

function main(): void {
  console.log('Phase 1 UI-5b — color picker rail contract\n');

  // ─── Pin #1 — parsePaletteFromDesignMd ───────────────────────
  console.log('Pin #1 — parsePaletteFromDesignMd');
  {
    const tokens = parsePaletteFromDesignMd(SAMPLE_DESIGN_MD);
    assert(tokens.length >= 8, `Extracted >=8 tokens (got ${tokens.length})`);

    const byName = new Map(tokens.map((t) => [t.name.toLowerCase(), t]));
    assert(byName.has('primary'), 'Token "Primary" extracted');
    assert(byName.has('solar orange'), 'Token "Solar orange" extracted (kurzgesagt format)');
    assert(byName.has('cyan pop'), 'Multi-word names preserved');
    assert(byName.has('primary text'), 'Token "Primary text" extracted');

    const primary = byName.get('primary')!;
    assert(primary.hex === '#1c2541', `Primary hex normalized (got ${primary.hex})`);
    assert(primary.role === 'primary', `Role inferred as primary, got ${primary.role}`);

    const solar = byName.get('solar orange')!;
    assert(solar.hex === '#ff9f1c', 'Solar orange hex captured');
    assert(solar.role === 'accent', `Solar orange role inferred as accent (under ### Accents subhead) got ${solar.role}`);

    const primaryText = byName.get('primary text')!;
    assert(primaryText.role === 'text', `Primary text role inferred as text, got ${primaryText.role}`);

    // Empty content → []
    const empty = parsePaletteFromDesignMd('');
    assert(Array.isArray(empty) && empty.length === 0, 'Empty input returns []');

    // No Colors section → []
    const noColors = parsePaletteFromDesignMd('# Brand\n## Typography\n- Inter\n');
    assert(noColors.length === 0, 'No Colors section returns []');

    // Hex normalization: 3-digit → 6, uppercase → lowercase, with-alpha → 6
    const normSample = `## Colors\n### Accents\n- **Short:** \`#abc\`\n- **Upper:** \`#FF00AA\`\n- **Alpha:** \`#11223344\`\n`;
    const norm = parsePaletteFromDesignMd(normSample);
    const normMap = new Map(norm.map((t) => [t.name.toLowerCase(), t.hex]));
    assert(normMap.get('short') === '#aabbcc', `3-digit normalized (got ${normMap.get('short')})`);
    assert(normMap.get('upper') === '#ff00aa', `Uppercase lowercased (got ${normMap.get('upper')})`);
    assert(normMap.get('alpha') === '#112233', `8-digit alpha stripped to 6 (got ${normMap.get('alpha')})`);

    // Dedup: same name+hex appearing twice collapses to one
    const dupSample = `## Colors\n- **A:** \`#111111\`\n- **A:** \`#111111\`\n`;
    const dup = parsePaletteFromDesignMd(dupSample);
    assert(dup.length === 1, 'Duplicate name+hex dedups to 1 entry');

    // Section exit on same-or-shallower heading
    const exitSample = `## Colors\n- **A:** \`#111111\`\n## Typography\n- **B:** \`#222222\`\n`;
    const exit = parsePaletteFromDesignMd(exitSample);
    assert(exit.length === 1 && exit[0].name.toLowerCase() === 'a',
      'Tokens after Colors section heading are excluded');
  }

  // ─── Pin #1 — endpoint shape (router wired + handler exists) ─
  console.log('\nPin #1 — endpoint shape');
  {
    const router = fs.readFileSync(ROUTER_TS, 'utf8');
    assert(/'\/platform\/api\/brand\/tokens'/.test(router),
      'Router whitelists /platform/api/brand/tokens');
    assert(/handleBrandTokensApi/.test(router), 'Router imports handleBrandTokensApi');

    const handler = fs.readFileSync(
      path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'api', 'brand-tokens.ts'),
      'utf8',
    );
    assert(/export async function handleBrandTokensApi/.test(handler),
      'handleBrandTokensApi exported');
    assert(/404[^]*?brand not loaded/.test(handler),
      'Returns 404 when brand DESIGN.md not on disk');
    assert(/200[^]*?palette/.test(handler), 'Returns 200 + palette envelope on success');
    assert(/PALETTE_CACHE/.test(handler), 'Per-process cache keyed by slug + mtime');
  }

  // ─── Pin #2 — color picker rail module ───────────────────────
  console.log('\nPin #2 — color picker rail module');
  {
    const src = fs.readFileSync(RAIL_JS, 'utf8');
    assert(/mountColorPickerRail/.test(src), 'Module defines mountColorPickerRail');
    assert(/window\.reframeMountColorPickerRail/.test(src), 'Mount fn exposed on window');
    assert(/data-row="brand"/.test(src), 'Row 1 brand palette');
    assert(/data-row="scene"/.test(src), 'Row 2 scene-used');
    assert(/data-row="custom"/.test(src), 'Row 3 custom hex');
    assert(/fetchBrandPalette/.test(src), 'Brand palette fetch helper');
    assert(/harvestSceneColors/.test(src), 'Scene-used color harvest helper');
    assert(/onOutsideMouseDown/.test(src), 'Outside-click closer wired');
    assert(/onEscapeKey/.test(src), 'Escape closer wired');
    assert(/positionRail/.test(src), 'Anchor positioning honors viewport');
  }

  // ─── Pin #2 — wire shape on swatch click ─────────────────────
  console.log('\nPin #2 — engine-direct wire shape');
  {
    const src = fs.readFileSync(RAIL_JS, 'utf8');
    // Brand swatch sets tokenBindings.<engineKey> = tokenName
    assert(/source === 'brand' && tokenName/.test(src),
      'Brand swatch sets tokenBindings to token name');
    // Scene-used / custom hex sets tokenBindings.<engineKey> = null
    assert(/null;\s*\/\/ custom = unbind|tokenBindings\[engineKey\] = null/.test(src),
      'Custom hex sets tokenBindings to null (unbind)');
    // Source-aware: brand → name, scene → null
    assert(/data-source="brand"|source === 'brand'/.test(src),
      'Source attribute distinguishes brand vs scene-used vs custom');
  }

  // ─── Pin #3 — inspector field swap ───────────────────────────
  console.log('\nPin #3 — inspector field swap');
  {
    const src = fs.readFileSync(WIDGETS_JS, 'utf8');
    assert(/COLOR_PROP_TO_ENGINE_KEY/.test(src), 'CSS-prop→engine-key map present');
    assert(/'background': 'fill'/.test(src), 'background → fill engineKey');
    assert(/'color': 'fill'/.test(src), 'color → fill engineKey');
    assert(/'border-color': 'stroke'/.test(src), 'border-color → stroke engineKey');
    assert(/window\.reframeMountColorPickerRail/.test(src),
      'Widgets call rail via global mount fn');
    // Legacy openColorPopover removed (not just commented out).
    assert(!/function openColorPopover\(/.test(src),
      'Legacy openColorPopover dead code removed');
  }

  // ─── Pin #4 — tokenBindings handler ──────────────────────────
  console.log('\nPin #4 — node-edit tokenBindings handler');
  {
    const src = fs.readFileSync(NODE_EDIT_TS, 'utf8');
    assert(/tokenBindingsEdit\s*=\s*\(edits\s*as\s*any\)\.tokenBindings/.test(src),
      'Handler reads tokenBindings sibling key from edits payload');
    assert(/node\.meta\.tokenBindings/.test(src) || /meta\.tokenBindings/.test(src),
      'Handler writes to node.meta.tokenBindings');
    assert(/val === null \|\| val === undefined \|\| val === ''/.test(src),
      'Null value triggers unbind (delete key)');
    assert(/Object\.keys\(existingBindings\)\.length === 0/.test(src),
      'Empty bindings object dropped (exporter cleanliness)');
  }

  // ─── Pin #5 — visual polish CSS ──────────────────────────────
  console.log('\nPin #5 — visual polish CSS');
  {
    const css = fs.readFileSync(CSS, 'utf8');
    assert(/#rfd-color-picker-rail/.test(css), 'CSS scopes color picker rail');
    assert(/\.rfd-cp-swatch/.test(css), 'Swatch class styled');
    // Find the .rfd-cp-swatch rule block and assert 24px appears within it.
    const swatchBlockMatch = css.match(/\.rfd-cp-swatch\s*\{[^}]*\}/);
    assert(!!swatchBlockMatch && /width:\s*24px/.test(swatchBlockMatch[0])
      && /height:\s*24px/.test(swatchBlockMatch[0]),
      '24×24 swatch dims declared in .rfd-cp-swatch block');
    assert(/transform:\s*scale\(1\.1\)/.test(css), 'Hover scale 1.1 effect');
    // Polish ring parity with UI-5a: rgba(43,116,255,0.15) glow
    // (lives in inline style of root, but custom-input focus also
    // mirrors it for consistency).
    assert(/rgba\(43,\s*116,\s*255,\s*0\.15\)/.test(css),
      'Custom hex input focus mirrors UI-5a edit ring color');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
