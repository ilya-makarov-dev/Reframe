/**
 * Week 5 #4 Brand vocabulary auto-decoration — parser / wrap / inspect contract.
 *
 * 9 tests:
 *   1. parse vocabulary section (power + industry + style)
 *   2. word boundary (Built ≠ Builty)
 *   3. case-insensitive match, case preserved in output
 *   4. multi-word phrase (Built for ≠ Built + for separately)
 *   5. sorted longest-first (Built for wins over Build)
 *   6. opt-out via data-no-vocab
 *   7. skip excluded elements (existing strong/em/code)
 *   8. industry terms recognized but not wrapped — surfaced as counts
 *   9. backward compat — brand without vocab section → no wrap, identical output
 *
 * Run: npx tsx packages/mcp/src/tests/week5-vocabulary-contract.test.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import { parseDesignMd } from '../../../core/src/design-system/parser.js';
import { wrapVocabulary } from '../../../core/src/importers/vocabulary-wrap.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

const SAMPLE_MD = `# Brand X

## Brand Vocabulary

Power words (auto-emphasized at import):
- Built for, Built to
- Powering, Powers
- scale, scales

Industry terms (recognized, not styled):
- developers, engineers
- API, infrastructure

Style:
  weight: 600
  color: accent
  decoration: none
`;

// ─── TEST 1: parse vocabulary section ──
async function testParse(): Promise<void> {
  const ds = parseDesignMd(SAMPLE_MD);
  assert(ds.vocabulary !== undefined, 'parse: vocabulary present');
  const vocab = ds.vocabulary!;
  assert(vocab.powerWords.includes('Built for'), `parse: "Built for" in power (got ${vocab.powerWords.join(',')})`);
  assert(vocab.powerWords.includes('Built to'), 'parse: "Built to" in power (comma-split)');
  assert(vocab.powerWords.includes('Powering'), 'parse: Powering');
  assert(vocab.powerWords.includes('scale'), 'parse: scale (lowercase)');
  assert(vocab.industryTerms.includes('developers'), 'parse: developers in industry');
  assert(vocab.industryTerms.includes('API'), 'parse: API in industry');
  assert(vocab.style.weight === 600, `parse: style.weight 600 (got ${vocab.style.weight})`);
  assert(vocab.style.color === 'accent', `parse: style.color accent (got ${vocab.style.color})`);
  assert(vocab.style.decoration === 'none', 'parse: style.decoration none');
}

// ─── TEST 2: word boundary ──
async function testWordBoundary(): Promise<void> {
  const ds = parseDesignMd(SAMPLE_MD);
  const html = '<p>Built for makers Builty failed</p>';
  const result = await wrapVocabulary(html, ds.vocabulary, '#635bff');
  assert(result.html.includes('<strong'), 'word-boundary: at least one wrap emitted');
  // "Built for" wrapped; "Builty" stays as plain word.
  assert(result.html.includes('Builty'), 'word-boundary: Builty unchanged in output');
  // The wrap shouldn't appear inside Builty.
  assert(!/<strong[^>]*>Built<\/strong>y/.test(result.html), 'word-boundary: Built inside Builty NOT wrapped');
  // "Built for" should be wrapped as a single phrase.
  assert(/<strong[^>]*>Built for<\/strong>/.test(result.html), 'word-boundary: "Built for" wrapped as phrase');
}

// ─── TEST 3: case-insensitive match, case preserved ──
async function testCasePreserved(): Promise<void> {
  const ds = parseDesignMd(SAMPLE_MD);
  const html = '<p>BUILT FOR developers Powering modern</p>';
  const result = await wrapVocabulary(html, ds.vocabulary, '#635bff');
  // "BUILT FOR" should be wrapped, with original casing preserved (not lowercased to vocab list version).
  assert(/<strong[^>]*>BUILT FOR<\/strong>/.test(result.html), `case: BUILT FOR preserved (got ${result.html.slice(0, 200)})`);
  assert(/<strong[^>]*>Powering<\/strong>/.test(result.html), 'case: Powering wrapped');
}

// ─── TEST 4: multi-word phrase ──
async function testMultiWord(): Promise<void> {
  const ds = parseDesignMd(SAMPLE_MD);
  const html = '<p>Built for makers</p>';
  const result = await wrapVocabulary(html, ds.vocabulary, '#635bff');
  assert(/<strong[^>]*>Built for<\/strong>/.test(result.html), 'multi-word: "Built for" wrapped as one phrase');
  // Make sure we didn't accidentally produce two adjacent wraps.
  assert(!/<strong[^>]*>Built<\/strong>\s*<strong[^>]*>for<\/strong>/.test(result.html), 'multi-word: not split into two wraps');
}

// ─── TEST 5: sorted longest-first ──
async function testLongestFirst(): Promise<void> {
  // Vocabulary explicitly contains both "Built" and "Built for" — wrap
  // pass MUST pick "Built for" first (longest match).
  const md = `# X
## Brand Vocabulary

Power words (auto-emphasized at import):
- Built, Built for

Style:
  weight: 600
  color: accent
`;
  const ds = parseDesignMd(md);
  const html = '<p>Built for the team. Built alone.</p>';
  const result = await wrapVocabulary(html, ds.vocabulary, '#635bff');
  // "Built for" wrapped — single phrase, not "Built" then plain "for".
  assert(/<strong[^>]*>Built for<\/strong>/.test(result.html), `longest-first: "Built for" wrapped as phrase (got ${result.html})`);
  // "Built alone" → "Built" alone is wrapped (vocab also contains "Built").
  assert(/<strong[^>]*>Built<\/strong>\s+alone/.test(result.html), 'longest-first: standalone "Built" still wrapped');
}

// ─── TEST 6: opt-out via data-no-vocab ──
async function testOptOut(): Promise<void> {
  const ds = parseDesignMd(SAMPLE_MD);
  const html = '<div data-no-vocab><p>Built for legalese here.</p></div><p>Built for sibling outside.</p>';
  const result = await wrapVocabulary(html, ds.vocabulary, '#635bff');
  // Inside data-no-vocab → unwrapped.
  assert(/data-no-vocab[^>]*><p>Built for legalese here\.<\/p>/.test(result.html.replace(/\s+/g, ' ')), `opt-out: inside no-vocab unchanged (got ${result.html})`);
  // Sibling outside → wrapped.
  assert(/<strong[^>]*>Built for<\/strong> sibling outside/.test(result.html), 'opt-out: sibling outside still wrapped');
}

// ─── TEST 7: skip excluded elements ──
async function testSkipExcluded(): Promise<void> {
  const ds = parseDesignMd(SAMPLE_MD);
  const html = '<strong>Built for X</strong> <code>Built for Y</code> <p>Built for Z</p>';
  const result = await wrapVocabulary(html, ds.vocabulary, '#635bff');
  // Existing <strong> not double-wrapped.
  assert(!/<strong>\s*<strong/.test(result.html), 'skip: no double-wrap inside <strong>');
  // <code> body not wrapped.
  assert(/<code>Built for Y<\/code>/.test(result.html), 'skip: <code> body unchanged');
  // <p> body wrapped normally.
  assert(/<p><strong[^>]*>Built for<\/strong> Z<\/p>/.test(result.html), `skip: <p> wrapped normally (got ${result.html})`);
}

// ─── TEST 8: industry terms recognized, not wrapped ──
async function testIndustryRecognized(): Promise<void> {
  const ds = parseDesignMd(SAMPLE_MD);
  const html = '<p>developers love this API</p>';
  const result = await wrapVocabulary(html, ds.vocabulary, '#635bff');
  // No <strong> emitted because no power-words match.
  assert(!result.html.includes('<strong'), 'industry: no wrap emitted');
  // Output equals input (modulo linkedom whitespace normalization).
  // Counts surfaced.
  assert(result.industryTermMatches.length === 2, `industry: 2 unique terms counted (got ${result.industryTermMatches.length})`);
  const developers = result.industryTermMatches.find((t) => t.term.toLowerCase() === 'developers');
  const api = result.industryTermMatches.find((t) => t.term.toLowerCase() === 'api');
  assert(developers !== undefined && developers.occurrences === 1, 'industry: developers × 1');
  assert(api !== undefined && api.occurrences === 1, 'industry: API × 1');
}

// ─── TEST 9: backward compat — no vocab section ──
async function testBackwardCompat(): Promise<void> {
  // Brand WITHOUT vocab section.
  const ds = parseDesignMd('# X\n\n## Color Palette\nprimary: #fff\n');
  assert(ds.vocabulary === undefined, 'backward: vocabulary undefined');

  // Wrap pass with undefined vocab → no-op, html unchanged.
  const html = '<p>Built for developers</p>';
  const result = await wrapVocabulary(html, ds.vocabulary, '#635bff');
  assert(result.html === html, `backward: html byte-identical (in: ${html} | out: ${result.html})`);
  assert(result.powerWordMatches.length === 0, 'backward: no power matches');
  assert(result.industryTermMatches.length === 0, 'backward: no industry matches');
}

// ─── Runner ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Week 5 #4 Brand vocabulary contract\n');
  const tests: Array<[string, () => Promise<void>]> = [
    ['parse vocabulary section', testParse],
    ['word boundary (Built ≠ Builty)', testWordBoundary],
    ['case-insensitive match, case preserved', testCasePreserved],
    ['multi-word phrase wrapped as one unit', testMultiWord],
    ['sorted longest-first (Built for over Built)', testLongestFirst],
    ['opt-out via data-no-vocab', testOptOut],
    ['skip excluded <strong>/<em>/<code> elements', testSkipExcluded],
    ['industry terms recognized + counted, not wrapped', testIndustryRecognized],
    ['backward compat — brand without vocab section', testBackwardCompat],
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
