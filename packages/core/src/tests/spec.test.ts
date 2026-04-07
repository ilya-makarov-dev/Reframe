/**
 * INode Conformance Suite — Runner
 *
 * Executes the full declarative conformance spec:
 * - Property specs: build → export → match patterns
 * - Audit specs: build → audit → check pass/fail
 * - Coverage matrix: which properties × which targets
 *
 * Replaces hundreds of hand-written assertions with a
 * machine-readable spec that IS the documentation.
 */

import {
  ALL_PROPERTY_SPECS,
  AUDIT_SPECS,
  IMPORT_SPECS,
  ANIMATION_SPECS,
  FUNCTIONAL_SPECS,
    DESIGN_SYSTEM_SPECS,
  runFullSuite,
  generateCoverageMatrix,
  formatCoverageMatrix,
  analyzeCoverage,
} from '../spec';

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║           INode Conformance Suite                           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const { properties, audit, imports, animations, functional, designSystem, total } = await runFullSuite(ALL_PROPERTY_SPECS, AUDIT_SPECS, IMPORT_SPECS, ANIMATION_SPECS, FUNCTIONAL_SPECS, [], DESIGN_SYSTEM_SPECS);

  // ─── Property Results ─────────────────────────────────────────

  console.log('─── Property Specs ───\n');

  let currentSpec = '';
  for (const check of properties.checks) {
    if (check.spec !== currentSpec) {
      currentSpec = check.spec;
    }
    const icon = check.passed ? '✓' : '✗';
    const suffix = check.message ? ` — ${check.message}` : '';
    console.log(`  ${icon} ${check.spec} [${check.target}]${suffix}`);
  }

  console.log(`\n  Property specs: ${properties.passed} passed, ${properties.failed} failed (${properties.total} checks)\n`);

  // ─── Audit Results ────────────────────────────────────────────

  console.log('─── Audit Specs ───\n');

  for (const check of audit.checks) {
    const icon = check.passed ? '✓' : '✗';
    const suffix = check.message ? ` — ${check.message}` : '';
    console.log(`  ${icon} ${check.spec} [${check.target}]${suffix}`);
  }

  console.log(`\n  Audit specs: ${audit.passed} passed, ${audit.failed} failed (${audit.total} checks)\n`);

  // ─── Import Results ───────────────────────────────────────────

  if (imports.total > 0) {
    console.log('─── Import Specs ───\n');

    for (const check of imports.checks) {
      const icon = check.passed ? '✓' : '✗';
      const suffix = check.message ? ` — ${check.message}` : '';
      console.log(`  ${icon} ${check.spec} [${check.target}]${suffix}`);
    }

    console.log(`\n  Import specs: ${imports.passed} passed, ${imports.failed} failed (${imports.total} checks)\n`);
  }

  // ─── Animation Results ────────────────────────────────────────

  if (animations.total > 0) {
    console.log('─── Animation Specs ───\n');

    for (const check of animations.checks) {
      const icon = check.passed ? '✓' : '✗';
      const suffix = check.message ? ` — ${check.message}` : '';
      console.log(`  ${icon} ${check.spec} [${check.target}]${suffix}`);
    }

    console.log(`\n  Animation specs: ${animations.passed} passed, ${animations.failed} failed (${animations.total} checks)\n`);
  }

  // ─── Functional Results ───────────────────────────────────────

  if (functional.total > 0) {
    console.log('─── Functional Specs ───\n');

    for (const check of functional.checks) {
      const icon = check.passed ? '✓' : '✗';
      const suffix = check.message ? ` — ${check.message}` : '';
      console.log(`  ${icon} ${check.spec} [${check.target}]${suffix}`);
    }

    console.log(`\n  Functional specs: ${functional.passed} passed, ${functional.failed} failed (${functional.total} checks)\n`);
  }

  // Pipeline specs removed — TODO: rewrite for tools-v2

  // ─── Design System Results ─────────────────────────────────────

  if (designSystem.total > 0) {
    console.log('─── Design System Specs ───\n');

    for (const check of designSystem.checks) {
      const icon = check.passed ? '✓' : '✗';
      const suffix = check.message ? ` — ${check.message}` : '';
      console.log(`  ${icon} ${check.spec} [${check.target}]${suffix}`);
    }

    console.log(`\n  Design system specs: ${designSystem.passed} passed, ${designSystem.failed} failed (${designSystem.total} checks)\n`);
  }

  // ─── Coverage Matrix ──────────────────────────────────────────

  const rows = generateCoverageMatrix(ALL_PROPERTY_SPECS);
  console.log(formatCoverageMatrix(rows));

  // ─── Coverage Analysis ────────────────────────────────────────

  const stats = analyzeCoverage(rows);
  console.log('\nCoverage Analysis:');
  console.log(`  Specs by target: HTML ${stats.byTarget.html}/${stats.total}, SVG ${stats.byTarget.svg}/${stats.total}, React ${stats.byTarget.react}/${stats.total}, Roundtrip ${stats.byTarget.roundtrip}/${stats.total}`);

  if (stats.gaps.length > 0) {
    console.log(`\n  Gaps (partially covered):`);
    for (const gap of stats.gaps) {
      console.log(`    ${gap.name}: missing ${gap.missing.join(', ')}`);
    }
  }

  // ─── Final Summary ────────────────────────────────────────────

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`INode Conformance: ${total.passed} passed, ${total.failed} failed (${total.total} checks from ${ALL_PROPERTY_SPECS.length} property + ${AUDIT_SPECS.length} audit + ${IMPORT_SPECS.length} import + ${ANIMATION_SPECS.length} animation + ${FUNCTIONAL_SPECS.length} functional + ${DESIGN_SYSTEM_SPECS.length} design-system specs)`);
  console.log('═'.repeat(60));

  process.exit(total.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Conformance suite error:', err);
  console.error(err.stack);
  process.exit(1);
});
