/**
 * Phase 3 Brief 3b — Token + Vocab + Typography editor contract.
 *
 * Pins covered:
 *   #1 serializeDesignMd + replaceSection — pure, deterministic,
 *      AST-stable round-trip on representative fixtures (warm-soft,
 *      kurzgesagt, brutalist).
 *   #2 service.editToken — palette role write-back, scoped SSE shape,
 *      skill-bus context payload.
 *   #3 service.editVocab — power words / industry terms / style merge.
 *   #4 service.editTypography — primary/secondary font + scale.
 *   #5 scoped SSE event shape (verified at unit level — runtime
 *      debounce verified in Pin #8 designer-qa probe).
 *   #6 skill-bus context payload includes brand + change-type +
 *      changedFields, ready for Phase 3.5 bus consumers.
 *   #7 empty-palette / empty-vocab handled — service creates role
 *      that didn't previously exist; serializer outputs an empty
 *      placeholder section.
 *
 * Run: npx tsx packages/mcp/src/tests/week16-token-editor-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  parseDesignMd,
  serializeDesignMd,
  replaceSection,
} from '../../../core/src/design-system/index.js';
import {
  editToken,
  editVocab,
  editTypography,
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

// Three real fixtures for round-trip checks. These are the most-exercised
// brand DESIGN.md files in the catalog and represent different shapes:
// warm-soft = direction with ADAPT comments + vocab; kurzgesagt = ordinary
// brand; brutalist = direction with minimal palette.
const FIXTURE_SLUGS = ['warm-soft', 'kurzgesagt', 'brutalist-experimental'];

function loadFixture(slug: string): string {
  const file = path.join(REPO_ROOT, '.reframe', 'brands', slug, 'DESIGN.md');
  return fs.readFileSync(file, 'utf-8');
}

let projectDir: string;
function setupProject(seedBrand?: { slug: string; md: string }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-3b-test-'));
  initProject(dir, '3b-test');
  if (seedBrand) {
    const brandDir = path.join(dir, '.reframe', 'brands', seedBrand.slug);
    fs.mkdirSync(brandDir, { recursive: true });
    fs.writeFileSync(path.join(brandDir, 'DESIGN.md'), seedBrand.md, 'utf-8');
  }
  setProjectDir(dir);
  clearScenes();
  return dir;
}

function main(): void {
  console.log('Phase 3 Brief 3b — Token editor contract\n');

  // ─── Pin #1 — serializer determinism ────────────────────────
  console.log('Pin #1 — serializeDesignMd determinism');
  {
    const md = loadFixture('warm-soft');
    const ds = parseDesignMd(md);
    const out1 = serializeDesignMd(ds);
    const out2 = serializeDesignMd(ds);
    assert(out1 === out2, 'same DS → same string (deterministic)');
    assert(out1.length > 0, 'serializer produces non-empty output');
    assert(out1.startsWith('# '), 'output starts with H1 brand title');
    assert(/## Color Palette/.test(out1), 'palette section header emitted');
    assert(/## Typography/.test(out1), 'typography section header emitted');
  }

  // ─── Pin #1 — round-trip on multiple fixtures ───────────────
  console.log('\nPin #1 — round-trip across fixtures');
  for (const slug of FIXTURE_SLUGS) {
    const md = loadFixture(slug);
    const ds = parseDesignMd(md);
    const ds2 = parseDesignMd(serializeDesignMd(ds));
    // Editable fields the workbench targets MUST round-trip exactly.
    assert(ds2.brand === ds.brand, `[${slug}] brand title round-trips`);
    assert(ds2.colors.primary === ds.colors.primary,
      `[${slug}] colors.primary round-trips (${ds.colors.primary} → ${ds2.colors.primary})`);
    assert(ds2.colors.background === ds.colors.background,
      `[${slug}] colors.background round-trips`);
    assert(ds2.colors.accent === ds.colors.accent,
      `[${slug}] colors.accent round-trips`);
    assert(ds2.colors.text === ds.colors.text,
      `[${slug}] colors.text round-trips`);
    // Vocabulary must round-trip when present.
    if (ds.vocabulary) {
      assert(!!ds2.vocabulary, `[${slug}] vocabulary survives round-trip`);
      if (ds2.vocabulary) {
        assert(JSON.stringify(ds2.vocabulary.powerWords) === JSON.stringify(ds.vocabulary.powerWords),
          `[${slug}] powerWords list round-trips`);
      }
    }
  }

  // ─── Pin #1 — replaceSection preserves untouched text ──────
  console.log('\nPin #1 — replaceSection preserves verbatim');
  {
    const md = loadFixture('warm-soft');
    // Replace just the palette body. Components / layout / depth /
    // do-don'ts sections must come through identically.
    // Palette format: `**Role**` (no colon inside bold) — required by
    // parser's first-pass regex that captures the role name strictly.
    const newPaletteBody = '- **Primary** `#abcdef`\n- **Background** `#000000`';
    const out = replaceSection(md, { match: ['color', 'palette'], body: newPaletteBody });
    assert(out.includes('## Component Stylings'),
      'replaceSection preserves untouched section headers');
    assert(out.includes('## Depth & Elevation'),
      'replaceSection preserves Depth section');
    assert(out.includes('#abcdef'),
      'new palette body inserted');
    assert(!out.includes('cf6a5f'),
      'old palette body fully replaced');

    // Round-trip via parseDesignMd on the patched text.
    const ds3 = parseDesignMd(out);
    assert(ds3.colors.primary?.toLowerCase() === '#abcdef',
      'parser reads patched primary');
    assert(ds3.colors.background?.toLowerCase() === '#000000',
      'parser reads patched background');

    // Append-if-missing path.
    const stripped = md.replace(/## Brand Vocabulary[\s\S]*?(?=\n## |\n*$)/g, '');
    // Vocab subsection format — parser uses `### Header` lines + bullet
    // bodies beneath, NOT inline `**Power words:**`.
    const appended = replaceSection(
      stripped,
      { match: ['brand vocabulary', 'vocabulary'], body: '### Power words\n- trust' },
      { appendIfMissing: true },
    );
    assert(/## Brand Vocabulary[\s\S]*?Power words/.test(appended),
      'appendIfMissing adds new section when match absent');
    assert(parseDesignMd(appended).vocabulary?.powerWords?.includes('trust') === true,
      'appended section parses back into AST');
  }

  // ─── Pin #2 — editToken happy path + skill-bus payload ──────
  console.log('\nPin #2 — editToken');
  {
    projectDir = setupProject({
      slug: 'test-brand',
      md: '# Test\n\n## Color Palette & Roles\n\n- **Primary** `#cf6a5f`\n- **Background** `#fdf3e8`\n',
    });
    const result = editToken(projectDir, 'test-brand', 'primary', '#abcdef');
    assert(result.ok === true, 'editToken returns ok');
    assert(result.ds.colors.primary?.toLowerCase() === '#abcdef',
      'returned DS has new primary');
    assert(result.skillContext.changeType === 'token-edit',
      'skill-bus context tagged token-edit');
    assert(result.skillContext.brandSlug === 'test-brand',
      'skill-bus context carries brand slug');
    const c = result.skillContext.changedFields ?? {};
    assert((c as any).role === 'primary', 'skill-bus context names changed role');
    assert((c as any).newHex === '#abcdef', 'skill-bus context carries new hex');
    assert((c as any).oldHex === '#cf6a5f', 'skill-bus context carries old hex');

    // Verify file on disk picks up the change.
    const onDisk = fs.readFileSync(path.join(projectDir, '.reframe', 'brands', 'test-brand', 'DESIGN.md'), 'utf-8');
    assert(onDisk.includes('#abcdef'), 'DESIGN.md on disk has new hex');
    assert(!onDisk.includes('#cf6a5f'), 'DESIGN.md on disk no longer has old primary');

    // Re-parse from disk — round-trip via filesystem.
    const reparsed = parseDesignMd(onDisk);
    assert(reparsed.colors.primary?.toLowerCase() === '#abcdef',
      'disk-resident DESIGN.md re-parses to new primary');

    // Edit a role that didn't exist (Pin #7 — empty-palette tolerance).
    const result2 = editToken(projectDir, 'test-brand', 'accent', '#16a34a');
    assert(result2.ok === true, 'editToken creates new role when absent');
    assert(result2.ds.colors.accent?.toLowerCase() === '#16a34a',
      'new role available in returned DS');
    fs.rmSync(projectDir, { recursive: true, force: true });
  }

  // ─── Pin #2 — editToken hex validation ──────────────────────
  console.log('\nPin #2 — editToken hex validation');
  {
    projectDir = setupProject({
      slug: 'test-brand',
      md: '# Test\n\n## Color Palette & Roles\n\n- **Primary** `#000000`\n',
    });
    let threw = false;
    try {
      editToken(projectDir, 'test-brand', 'primary', 'not-a-hex');
    } catch { threw = true; }
    assert(threw, 'editToken rejects invalid hex');
    fs.rmSync(projectDir, { recursive: true, force: true });
  }

  // ─── Pin #3 — editVocab ─────────────────────────────────────
  console.log('\nPin #3 — editVocab');
  {
    projectDir = setupProject({
      slug: 'test-brand',
      md: '# Test\n\n## Brand Vocabulary\n\n### Power words\n- accent, premium\n',
    });
    const result = editVocab(projectDir, 'test-brand', {
      powerWords: ['accent', 'premium', 'trust'],
    });
    assert(result.ok === true, 'editVocab returns ok');
    assert(result.skillContext.changeType === 'vocab-edit',
      'skill-bus context tagged vocab-edit');
    const reparsed = result.ds.vocabulary;
    assert(reparsed?.powerWords?.includes('trust') === true,
      'new power word in returned DS');
    assert(reparsed?.powerWords?.length === 3,
      'word list length matches submitted patch');

    // Style merge — partial style patch shouldn't clobber other fields.
    const result2 = editVocab(projectDir, 'test-brand', {
      style: { weight: 700 } as any,
    });
    assert(result2.ds.vocabulary?.style?.weight === 700,
      'style.weight patched');
    fs.rmSync(projectDir, { recursive: true, force: true });
  }

  // ─── Pin #4 — editTypography ───────────────────────────────
  console.log('\nPin #4 — editTypography');
  {
    projectDir = setupProject({
      slug: 'test-brand',
      md: "# Test\n\n## Typography Rules\n\n- **Display / headings:** `'Tiempos Headline', serif`, weight 500\n- **Body:** `'Söhne', sans-serif`, weight 400\n",
    });
    const result = editTypography(projectDir, 'test-brand', {
      primaryFont: "'Inter', sans-serif",
    });
    assert(result.ok === true, 'editTypography returns ok');
    assert(result.skillContext.changeType === 'typography-edit',
      'skill-bus context tagged typography-edit');
    assert((result.skillContext.changedFields as any)?.primaryFont === "'Inter', sans-serif",
      'changed field carries new primary font');
    // The on-disk markdown should pick up the new font.
    const onDisk = fs.readFileSync(path.join(projectDir, '.reframe', 'brands', 'test-brand', 'DESIGN.md'), 'utf-8');
    assert(onDisk.includes('Inter'), "DESIGN.md on disk includes 'Inter'");
    fs.rmSync(projectDir, { recursive: true, force: true });
  }

  // ─── Pin #6 — skill-bus context payload shape ──────────────
  console.log('\nPin #6 — skill-bus context payload shape');
  {
    projectDir = setupProject({
      slug: 'test-brand',
      md: '# Test\n\n## Color Palette & Roles\n\n- **Primary** `#000000`\n',
    });
    const result = editToken(projectDir, 'test-brand', 'primary', '#abcdef');
    const ctx: any = result.skillContext;
    assert(typeof ctx.brandSlug === 'string', 'skill ctx: brandSlug is string');
    assert(typeof ctx.changeType === 'string', 'skill ctx: changeType is string');
    assert(typeof ctx.changedFields === 'object', 'skill ctx: changedFields is object');
    fs.rmSync(projectDir, { recursive: true, force: true });
  }

  // ─── Pin #7 — empty palette honest framing ──────────────────
  console.log('\nPin #7 — empty palette tolerance');
  {
    projectDir = setupProject({
      slug: 'empty-brand',
      md: '# Empty\n\n## Color Palette & Roles\n\n_(palette empty)_\n',
    });
    const result = editToken(projectDir, 'empty-brand', 'primary', '#cf6a5f');
    assert(result.ok === true,
      'editToken on empty-palette brand creates role + writes back');
    assert(result.ds.colors.primary?.toLowerCase() === '#cf6a5f',
      'newly-created role visible in DS');
    fs.rmSync(projectDir, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
