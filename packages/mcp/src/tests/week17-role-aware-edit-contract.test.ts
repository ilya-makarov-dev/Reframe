/**
 * Phase 3 Brief 3c — Role-aware edit contract (replaceHexInPlace + getRoleForHex).
 *
 * Pins covered:
 *   #1 replaceHexInPlace — surgical hex edit, byte-preserves untouched
 *      lines, CRLF-aware, returns {replaced:false} for unknown role.
 *   #2 service.editToken routes hex-only edits through replaceHexInPlace
 *      (regression-locks Brief 3b's lossy section-rewrite).
 *   #3 getRoleForHex — case-insensitive, supports #abc + #aabbcc forms,
 *      returns null on no-match.
 *   #4 Inspector hex-edit auto-infers tokenBindings (bundle string-search
 *      for the inferRoleForHex wire — runtime DOM verified by Pin #5).
 *   #6 Bundle wires HTTP route /api/workbench/role-for-hex.
 *
 * Run: npx tsx packages/mcp/src/tests/week17-role-aware-edit-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  parseDesignMd,
  replaceHexInPlace,
} from '../../../core/src/design-system/index.js';
import {
  editToken,
  getRoleForHex,
} from '../platform/api/brand-workbench-service.js';
import { initProject } from '../../../core/src/project/io.js';
import { setProjectDir, clearScenes } from '../store.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const NODE_EDIT_TS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'api', 'node-edit.ts');
const COLOR_RAIL_JS = path.join(REPO_ROOT, 'packages', 'mcp', 'src', 'platform', 'ui', '116-color-picker-rail.js');

function loadFixture(slug: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, '.reframe', 'brands', slug, 'DESIGN.md'), 'utf-8');
}

function setupProject(brand: { slug: string; md: string }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-3c-test-'));
  initProject(dir, '3c-test');
  const brandDir = path.join(dir, '.reframe', 'brands', brand.slug);
  fs.mkdirSync(brandDir, { recursive: true });
  fs.writeFileSync(path.join(brandDir, 'DESIGN.md'), brand.md, 'utf-8');
  setProjectDir(dir);
  clearScenes();
  return dir;
}

function main(): void {
  console.log('Phase 3 Brief 3c — Role-aware edit contract\n');

  // ─── Pin #1 — replaceHexInPlace ────────────────────────────
  console.log('Pin #1 — replaceHexInPlace');
  for (const slug of ['warm-soft', 'kurzgesagt', 'brutalist-experimental']) {
    const md = loadFixture(slug);
    // Find a role with an explicit bullet anchor in the raw text — the
    // parser's heuristic role map is sparser than what's actually
    // declared (colon-inside-bold lines are skipped by the first-pass
    // regex), so picking from `colors.roles` would miss anchored roles
    // here. Match against the bullet shape directly.
    const bulletMatch = md.match(/^\s*[-*]\s*\*\*([^*]+?)\*\*[^`]*`#[0-9a-fA-F]{3,8}`/m);
    const firstRole = bulletMatch
      ? bulletMatch[1].trim().replace(/:$/, '').trim().toLowerCase().replace(/\s+/g, '-')
      : null;
    if (!firstRole) {
      console.error(`  SKIP [${slug}]: no bullet-anchored roles in fixture`);
      void parseDesignMd; // silence unused import
      continue;
    }
    const result = replaceHexInPlace(md, firstRole, '#abcdef');
    assert(result.replaced === true, `[${slug}] replaceHexInPlace finds & replaces role "${firstRole}"`);
    assert(Math.abs(result.text.length - md.length) <= 4,
      `[${slug}] file length preserved within hex-form delta`);

    // Byte-preservation: every line OTHER than the target must be unchanged.
    const origLines = md.split(/\r?\n/);
    const newLines = result.text.split(/\r?\n/);
    assert(origLines.length === newLines.length,
      `[${slug}] line count unchanged`);
    let changedLines = 0;
    for (let i = 0; i < origLines.length; i++) {
      if (origLines[i] !== newLines[i]) changedLines++;
    }
    assert(changedLines === 1,
      `[${slug}] exactly one line changed (got ${changedLines})`);
  }

  // CRLF awareness — synthetic fixture with explicit \r\n line endings.
  {
    const crlf =
      '# Test\r\n' +
      '\r\n' +
      '## Color Palette & Roles\r\n' +
      '\r\n' +
      '- **Primary:** `#cf6a5f` — terracotta\r\n' +
      '- **Background:** `#fdf3e8` — warm cream\r\n' +
      '\r\n' +
      '## Typography\r\n';
    const result = replaceHexInPlace(crlf, 'primary', '#abcdef');
    assert(result.replaced === true, 'CRLF: replaces primary');
    assert(result.text.includes('\r\n'), 'CRLF line endings preserved');
    assert(result.text.includes('- **Primary:** `#abcdef`'), 'CRLF: new hex written');
    assert(result.text.includes('- **Background:** `#fdf3e8`'), 'CRLF: untouched line preserved verbatim');
    assert(!result.text.includes('#cf6a5f'), 'CRLF: old hex fully replaced');
  }

  // Unknown role → no-op.
  {
    const md = loadFixture('warm-soft');
    const result = replaceHexInPlace(md, 'nonexistent-role-xyz', '#000000');
    assert(result.replaced === false, 'unknown role → replaced:false');
    assert(result.text === md, 'unknown role → text byte-identical to input');
  }

  // Invalid hex throws.
  {
    let threw = false;
    try {
      replaceHexInPlace('## x\n- **primary** `#cf6a5f`\n', 'primary', 'not-hex');
    } catch { threw = true; }
    assert(threw, 'invalid hex throws');
  }

  // ─── Pin #3 — getRoleForHex ─────────────────────────────────
  console.log('\nPin #3 — getRoleForHex');
  {
    const projectDir = setupProject({
      slug: 'test-brand',
      md:
        '# Test\n\n## Color Palette & Roles\n\n' +
        '- **Primary:** `#CF6A5F` — terracotta\n' +
        '- **Background:** `#fdf3e8` — cream\n' +
        '- **Accent:** `#abc` — short-form hex\n',
    });
    assert(getRoleForHex(projectDir, 'test-brand', '#cf6a5f') === 'primary',
      'matches lowercase hex → primary');
    assert(getRoleForHex(projectDir, 'test-brand', '#CF6A5F') === 'primary',
      'matches uppercase input hex → primary (case-insensitive)');
    assert(getRoleForHex(projectDir, 'test-brand', '#fdf3e8') === 'background',
      'matches background');
    // Short-form #abc should be normalised + matched even when caller
    // sends long form.
    assert(getRoleForHex(projectDir, 'test-brand', '#aabbcc') === 'accent',
      '#abc role matches via #aabbcc lookup (normalisation)');
    assert(getRoleForHex(projectDir, 'test-brand', '#000000') === null,
      'unknown hex → null');
    assert(getRoleForHex(projectDir, 'test-brand', 'not-hex') === null,
      'invalid hex format → null');
    fs.rmSync(projectDir, { recursive: true, force: true });
  }

  // ─── Pin #2 — editToken routing through replaceHexInPlace ──
  console.log('\nPin #2 — editToken hex-only routing');
  {
    const projectDir = setupProject({
      slug: 'test-brand',
      md:
        '# Test\n\n## Color Palette & Roles\n\n' +
        '- **Background:** `#fdf3e8` — warm cream <!-- ADAPT: source = oklch(97% 0.018 70) -->\n' +
        '- **Surface:** `#fffbf6` — elevated cards\n' +
        '- **Foreground:** `#221812` — near-black\n' +
        '- **Muted:** `#6c605a` — secondary text\n' +
        '- **Accent:** `#cf6a5f` — terracotta\n',
    });
    const fileBefore = fs.readFileSync(
      path.join(projectDir, '.reframe', 'brands', 'test-brand', 'DESIGN.md'),
      'utf-8',
    );

    const result = editToken(projectDir, 'test-brand', 'accent', '#e8714f');
    assert(result.ok === true, 'editToken on existing role: ok');
    assert(result.skillContext.changeType === 'token-edit',
      'skill-bus changeType=token-edit');
    assert(((result.skillContext as any).changedFields)?.oldHex === '#cf6a5f',
      'skill ctx oldHex captured');

    const fileAfter = fs.readFileSync(
      path.join(projectDir, '.reframe', 'brands', 'test-brand', 'DESIGN.md'),
      'utf-8',
    );
    // Untouched-line preservation — the regression lock for Brief 3b.
    const origLines = fileBefore.split(/\r?\n/);
    const newLines = fileAfter.split(/\r?\n/);
    assert(origLines.length === newLines.length,
      'editToken hex-only: line count unchanged (no compression)');
    assert(fileAfter.includes('- **Background:** `#fdf3e8`'),
      'Background line preserved with comment');
    assert(fileAfter.includes('- **Surface:** `#fffbf6`'),
      'Surface line preserved');
    assert(fileAfter.includes('- **Foreground:** `#221812`'),
      'Foreground line preserved');
    assert(fileAfter.includes('- **Muted:** `#6c605a`'),
      'Muted line preserved');
    assert(fileAfter.includes('ADAPT: source ='),
      'ADAPT comment preserved verbatim');
    assert(fileAfter.includes('#e8714f'), 'new accent hex written');
    assert(!fileAfter.includes('#cf6a5f'), 'old accent hex fully replaced');
    fs.rmSync(projectDir, { recursive: true, force: true });
  }

  // editToken on a new role still works (falls through to the lossy
  // section-rewrite path; that's the documented behaviour for structural
  // edits per Pin #7 honest framing).
  console.log('\nPin #2 — editToken new-role fallback');
  {
    const projectDir = setupProject({
      slug: 'test-brand',
      md: '# Test\n\n## Color Palette & Roles\n\n- **Primary:** `#000000`\n',
    });
    const result = editToken(projectDir, 'test-brand', 'accent', '#16a34a');
    assert(result.ok === true, 'editToken on new role: ok');
    assert(result.ds.colors.roles?.has('accent'),
      'new role appears in DS');
    fs.rmSync(projectDir, { recursive: true, force: true });
  }

  // ─── Pin #4 — inspector auto-tokenRef inference ─────────────
  console.log('\nPin #4 — Inspector auto-tokenRef inference');
  {
    const rail = fs.readFileSync(COLOR_RAIL_JS, 'utf-8');
    assert(/inferRoleForHex/.test(rail),
      'rail defines inferRoleForHex helper');
    assert(/\/platform\/api\/workbench\/role-for-hex/.test(rail),
      'rail calls the role-for-hex endpoint');
    assert(/async function commitHex/.test(rail),
      'commitHex is async (awaits inferRoleForHex)');
    assert(/await inferRoleForHex\(/.test(rail),
      'commitHex awaits role inference before patch');
    // The patch shape: tokenBindings[engineKey] now equals `role`
    // (string when matched, null when not) — NOT hardcoded null.
    assert(/patch\.tokenBindings\[engineKey\]\s*=\s*role;/.test(rail),
      'tokenBindings[engineKey] set to inferred role (not hardcoded null)');
  }

  // ─── Pin #4 backend route ──────────────────────────────────
  console.log('\nPin #4 — backend role-for-hex route');
  {
    const ne = fs.readFileSync(NODE_EDIT_TS, 'utf-8');
    assert(/'\/platform\/api\/workbench\/role-for-hex' && req\.method === 'GET'/.test(ne),
      '/role-for-hex GET route declared');
    assert(/getRoleForHex\(ctx\.projectDir, brandSlug, hex\)/.test(ne),
      'route invokes service helper with correct args');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
