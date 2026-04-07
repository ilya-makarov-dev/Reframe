/**
 * Audit — smoke tests
 *
 * Run: npx tsx src/audit.test.ts
 */

import { NodeType } from '../host/types';
import {
  build, frame, rect, text, ellipse, solid,
} from '../builder';
import {
  audit, auditTransform, rule,
  textOverflow, minFontSize, noEmptyText,
  noHiddenNodes, noZeroSize, contrastMinimum,
  fontInPalette, colorInPalette,
} from '../audit';
import { pipe } from '../resize/pipe';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

// ── 1. No issues on clean tree ─────────────────────

{
  const { root } = build(
    frame({ width: 500, height: 500, fills: [solid('#FFFFFF')] },
      text('Hello', { fontSize: 24, x: 10, y: 10 }),
      rect({ width: 100, height: 100, x: 10, y: 50, fills: [solid('#FF0000')] }),
    )
  );

  const issues = audit(root, [minFontSize(10), noEmptyText(), noZeroSize()]);
  assert(issues.length === 0, `clean tree: 0 issues (got ${issues.length})`);
}

// ── 2. Min font size ───────────────────────────────

{
  const { root } = build(
    frame({ width: 300, height: 300 },
      text('Tiny', { fontSize: 6, x: 10, y: 10 }),
      text('Normal', { fontSize: 16, x: 10, y: 30 }),
    )
  );

  const issues = audit(root, [minFontSize(10)]);
  assert(issues.length === 1, `min font: 1 issue (got ${issues.length})`);
  assert(issues[0].rule === 'min-font-size', 'rule name is min-font-size');
  assert(issues[0].severity === 'warning', 'severity is warning');
  assert(issues[0].message.includes('6px'), 'message mentions 6px');
}

// ── 3. Empty text ──────────────────────────────────

{
  const { root } = build(
    frame({ width: 300, height: 300 },
      text('', { fontSize: 16, x: 10, y: 10 }),
      text('   ', { fontSize: 16, x: 10, y: 30 }),
      text('Valid', { fontSize: 16, x: 10, y: 50 }),
    )
  );

  const issues = audit(root, [noEmptyText()]);
  assert(issues.length === 2, `empty text: 2 issues (got ${issues.length})`);
}

// ── 4. Hidden nodes ────────────────────────────────

{
  const { root } = build(
    frame({ width: 300, height: 300 },
      rect({ width: 100, height: 100, visible: false }),
      rect({ width: 100, height: 100, opacity: 0 }),
      rect({ width: 100, height: 100 }),
    )
  );

  const issues = audit(root, [noHiddenNodes()]);
  assert(issues.length === 2, `hidden: 2 issues (got ${issues.length})`);
  assert(issues[0].severity === 'info', 'severity is info');
}

// ── 5. Zero size ───────────────────────────────────

{
  const { root } = build(
    frame({ width: 300, height: 300 },
      rect({ width: 0, height: 50 }),
      rect({ width: 50, height: 0 }),
      rect({ width: 50, height: 50 }),
    )
  );

  const issues = audit(root, [noZeroSize()]);
  assert(issues.length === 2, `zero size: 2 issues (got ${issues.length})`);
}

// ── 6. Contrast check ──────────────────────────────

{
  // White text on white background → low contrast
  const { root } = build(
    frame({ width: 300, height: 300, fills: [solid('#FFFFFF')] },
      text('Invisible', { fontSize: 16, x: 10, y: 10, fills: [solid('#FEFEFE')] }),
    )
  );

  // Set text fills via the build system
  const issues = audit(root, [contrastMinimum(4.5)]);
  assert(issues.length === 1, `low contrast: 1 issue (got ${issues.length})`);
  assert(issues[0].rule === 'contrast-minimum', 'rule is contrast-minimum');
}

{
  // Black text on white background → good contrast
  const { root } = build(
    frame({ width: 300, height: 300, fills: [solid('#FFFFFF')] },
      text('Visible', { fontSize: 16, x: 10, y: 10, fills: [solid('#000000')] }),
    )
  );

  const issues = audit(root, [contrastMinimum(4.5)]);
  assert(issues.length === 0, `good contrast: 0 issues (got ${issues.length})`);
}

// ── 7. Custom rule ─────────────────────────────────

{
  const { root } = build(
    frame({ width: 300, height: 300 },
      rect({ name: 'bad-name', width: 50, height: 50 }),
      rect({ name: 'good', width: 50, height: 50 }),
    )
  );

  const noHyphens = rule('no-hyphens', (node, ctx) => {
    if (node.name.includes('-')) {
      return [{
        rule: 'no-hyphens',
        severity: 'warning' as const,
        message: `Node "${node.name}" contains hyphens`,
        nodeId: node.id,
        nodeName: node.name,
        path: ctx.path,
      }];
    }
    return [];
  });

  const issues = audit(root, [noHyphens]);
  assert(issues.length === 1, `custom rule: 1 issue (got ${issues.length})`);
  assert(issues[0].rule === 'no-hyphens', 'custom rule name');
}

// ── 8. Severity sorting ────────────────────────────

{
  const { root } = build(
    frame({ width: 300, height: 300 },
      rect({ width: 100, height: 100, visible: false }),  // info (hidden)
      text('', { fontSize: 6 }),                            // warning (empty + small font)
    )
  );

  const issues = audit(root, [noHiddenNodes(), noEmptyText(), minFontSize(10)]);
  // warnings should come before info
  const firstWarnIdx = issues.findIndex(i => i.severity === 'warning');
  const firstInfoIdx = issues.findIndex(i => i.severity === 'info');
  if (firstWarnIdx >= 0 && firstInfoIdx >= 0) {
    assert(firstWarnIdx < firstInfoIdx, 'warnings sorted before info');
  } else {
    assert(issues.length >= 2, `mixed severity: at least 2 issues (got ${issues.length})`);
  }
}

// ── 9. Audit as pipe transform ─────────────────────

async function testAuditTransform() {
  const { root } = build(
    frame({ width: 300, height: 300 },
      text('Tiny', { fontSize: 5 }),
    )
  );

  const result = await pipe(
    auditTransform(minFontSize(10)),
  ).run(root);

  const issues = result.ctx.state.get('auditIssues') as any[];
  assert(Array.isArray(issues), 'auditIssues in context');
  assert(issues.length === 1, `audit transform: 1 issue (got ${issues.length})`);
}

// ── 10. Font in palette ────────────────────────────

{
  const { root } = build(
    frame({ width: 300, height: 300 },
      text('Title', { fontSize: 24, fontFamily: 'Comic Sans' }),
      text('Body', { fontSize: 16, fontFamily: 'Inter' }),
    )
  );

  const ds = {
    typography: {
      hierarchy: [
        { role: 'title', fontFamily: 'Inter', fontSize: 24, fontWeight: 700 },
        { role: 'body', fontFamily: 'Inter', fontSize: 16, fontWeight: 400 },
      ],
    },
  };

  const issues = audit(root, [fontInPalette()], ds as any);
  assert(issues.length === 1, `font palette: 1 issue (got ${issues.length})`);
  assert(issues[0].message.includes('Comic Sans'), 'mentions Comic Sans');
}

// ── 11. Color in palette ───────────────────────────

{
  const { root } = build(
    frame({ width: 300, height: 300 },
      rect({ width: 100, height: 100, fills: [solid('#FF0000')] }),  // red — not in palette
      rect({ width: 100, height: 100, fills: [solid('#0071E3')] }),  // in palette
    )
  );

  const ds = {
    colors: {
      roles: new Map([
        ['primary', '#0071E3'],
        ['background', '#FFFFFF'],
      ]),
    },
  };

  const issues = audit(root, [colorInPalette()], ds as any);
  assert(issues.length === 1, `color palette: 1 issue (got ${issues.length})`);
  assert(issues[0].message.includes('255,0,0'), 'mentions red color');
}

// ── 12. Multiple rules combined ────────────────────

{
  const { root } = build(
    frame({ width: 300, height: 300, fills: [solid('#FFF')] },
      text('', { fontSize: 5 }),                               // empty + small
      rect({ width: 0, height: 50, visible: false }),           // zero + hidden
      text('OK', { fontSize: 16, fills: [solid('#000')] }),     // clean
    )
  );

  const issues = audit(root, [
    minFontSize(10),
    noEmptyText(),
    noZeroSize(),
    noHiddenNodes(),
  ]);
  // At least 4 issues: small font, empty text, zero width, hidden
  assert(issues.length >= 4, `combined: at least 4 issues (got ${issues.length})`);
}

// ── Run All ────────────────────────────────────────

async function main() {
  // sync tests already ran above
  await testAuditTransform();

  console.log(`\n  Audit tests: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main();
