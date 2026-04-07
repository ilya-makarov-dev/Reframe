/**
 * Design Assertions — fluent testing framework for INode trees.
 *
 * Unit testing for design. Wraps the audit engine with a
 * developer-friendly API for validating visual intent.
 *
 * Usage:
 *   const results = assertDesign(root)
 *     .hasMinContrast(4.5)
 *     .fitsWithin(1920, 1080)
 *     .matchesDesignSystem(ds)
 *     .noOverlapping()
 *     .run();
 */

import { type INode, NodeType, MIXED } from './host';
import {
  audit,
  rule,
  type AuditRule,
  type AuditIssue,
  textOverflow,
  minFontSize,
  noEmptyText,
  noZeroSize,
  contrastMinimum,
  fontInPalette,
  colorInPalette,
  fontWeightCompliance,
  fontSizeRoleMatch,
  borderRadiusCompliance,
  spacingGridCompliance,
} from './audit';
import type { DesignSystem } from './design-system/types';

// ─── Types ────────────────────────────────────────────────────

export interface AssertionResult {
  passed: boolean;
  assertion: string;
  message: string;
  details?: Record<string, unknown>;
}

export class DesignAssertionError extends Error {
  constructor(public results: AssertionResult[]) {
    const failed = results.filter(r => !r.passed);
    super(`Design assertion failed: ${failed.map(f => f.assertion).join(', ')}`);
    this.name = 'DesignAssertionError';
  }
}

// ─── Custom Rules ─────────────────────────────────────────────

function fitsWithinRule(maxW: number, maxH: number): AuditRule {
  return rule('fits-within', (node, ctx) => {
    if (node !== ctx.root) return []; // only check root
    const issues: AuditIssue[] = [];
    if (node.width > maxW) {
      issues.push({
        rule: 'fits-within',
        severity: 'error',
        message: `Root width ${node.width} exceeds max ${maxW}`,
        nodeId: node.id,
        nodeName: node.name,
      });
    }
    if (node.height > maxH) {
      issues.push({
        rule: 'fits-within',
        severity: 'error',
        message: `Root height ${node.height} exceeds max ${maxH}`,
        nodeId: node.id,
        nodeName: node.name,
      });
    }
    return issues;
  });
}

function noOverlappingRule(): AuditRule {
  return rule('no-overlapping', (node) => {
    if (!node.children || node.children.length < 2) return [];
    // Skip flex containers — children are auto-positioned
    if (node.layoutMode && node.layoutMode !== 'NONE') return [];

    const issues: AuditIssue[] = [];
    const kids = node.children.filter(c => !c.removed && c.visible !== false);

    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i];
        const b = kids[j];
        if (rectsOverlap(a, b)) {
          const overlapArea = computeOverlap(a, b);
          const smallerArea = Math.min(a.width * a.height, b.width * b.height);
          // Only flag significant overlaps (>25% of smaller node)
          if (smallerArea > 0 && overlapArea / smallerArea > 0.25) {
            issues.push({
              rule: 'no-overlapping',
              severity: 'warning',
              message: `"${a.name}" and "${b.name}" overlap significantly (${Math.round(overlapArea / smallerArea * 100)}%)`,
              nodeId: a.id,
              nodeName: a.name,
            });
          }
        }
      }
    }
    return issues;
  });
}

function rectsOverlap(a: INode, b: INode): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

function computeOverlap(a: INode, b: INode): number {
  const ox = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return ox * oy;
}

function minLineHeightRule(multiplier: number): AuditRule {
  return rule('min-line-height', (node) => {
    if (node.type !== NodeType.Text) return [];
    const fontSize = typeof node.fontSize === 'number' ? node.fontSize : 0;
    if (fontSize <= 0) return [];

    let lhRatio = 1.4; // default
    if (node.lineHeight && node.lineHeight !== MIXED && typeof node.lineHeight === 'object' && 'value' in node.lineHeight) {
      if (node.lineHeight.unit === 'PIXELS' || node.lineHeight.unit === 'PX') {
        lhRatio = node.lineHeight.value / fontSize;
      } else if (node.lineHeight.unit === 'PERCENT') {
        lhRatio = node.lineHeight.value / 100;
      }
    }

    if (lhRatio < multiplier) {
      return [{
        rule: 'min-line-height',
        severity: 'warning',
        message: `Line height ${lhRatio.toFixed(2)} on "${node.name}" is below minimum ${multiplier}`,
        nodeId: node.id,
        nodeName: node.name,
      }];
    }
    return [];
  });
}

// ─── Fluent Builder ───────────────────────────────────────────

interface PendingAssertion {
  name: string;
  rules: AuditRule[];
  designSystem?: DesignSystem;
}

class DesignAssertionBuilder {
  private root: INode;
  private pending: PendingAssertion[] = [];

  constructor(root: INode) {
    this.root = root;
  }

  /** Check WCAG contrast ratio on all text nodes. */
  hasMinContrast(ratio: number): this {
    this.pending.push({ name: `minContrast(${ratio})`, rules: [contrastMinimum(ratio)] });
    return this;
  }

  /** Verify root fits within bounds. */
  fitsWithin(width: number, height: number): this {
    this.pending.push({ name: `fitsWithin(${width}x${height})`, rules: [fitsWithinRule(width, height)] });
    return this;
  }

  /** Validate against a full design system. */
  matchesDesignSystem(ds: DesignSystem): this {
    this.pending.push({
      name: 'matchesDesignSystem',
      rules: [
        fontInPalette(),
        colorInPalette(),
        fontWeightCompliance(),
        fontSizeRoleMatch(),
        borderRadiusCompliance(),
        spacingGridCompliance(),
      ],
      designSystem: ds,
    });
    return this;
  }

  /** Check no significant sibling overlap. */
  noOverlapping(): this {
    this.pending.push({ name: 'noOverlapping', rules: [noOverlappingRule()] });
    return this;
  }

  /** Minimum font size. */
  hasMinFontSize(size: number): this {
    this.pending.push({ name: `minFontSize(${size})`, rules: [minFontSize(size)] });
    return this;
  }

  /** No empty text nodes. */
  noEmptyText(): this {
    this.pending.push({ name: 'noEmptyText', rules: [noEmptyText()] });
    return this;
  }

  /** No zero-size nodes. */
  noZeroSize(): this {
    this.pending.push({ name: 'noZeroSize', rules: [noZeroSize()] });
    return this;
  }

  /** Text doesn't overflow containers. */
  noTextOverflow(): this {
    this.pending.push({ name: 'noTextOverflow', rules: [textOverflow()] });
    return this;
  }

  /** Minimum line height as multiplier of font size. */
  hasMinLineHeight(multiplier: number): this {
    this.pending.push({ name: `minLineHeight(${multiplier})`, rules: [minLineHeightRule(multiplier)] });
    return this;
  }

  /** Run a custom AuditRule. */
  passes(customRule: AuditRule): this {
    this.pending.push({ name: customRule.name, rules: [customRule] });
    return this;
  }

  /** Execute all assertions and return results. */
  run(): AssertionResult[] {
    const results: AssertionResult[] = [];

    for (const assertion of this.pending) {
      const issues = audit(this.root, assertion.rules, assertion.designSystem as any);
      if (issues.length === 0) {
        results.push({
          passed: true,
          assertion: assertion.name,
          message: `PASS: ${assertion.name}`,
        });
      } else {
        results.push({
          passed: false,
          assertion: assertion.name,
          message: `FAIL: ${assertion.name} — ${issues[0].message}`,
          details: {
            issueCount: issues.length,
            issues: issues.map(i => ({ rule: i.rule, message: i.message, nodeId: i.nodeId })),
          },
        });
      }
    }

    return results;
  }

  /** Execute and throw on first failure. */
  runOrThrow(): void {
    const results = this.run();
    const failed = results.filter(r => !r.passed);
    if (failed.length > 0) throw new DesignAssertionError(results);
  }
}

// ─── Entry Point ──────────────────────────────────────────────

/** Create a fluent design assertion chain. */
export function assertDesign(node: INode): DesignAssertionBuilder {
  return new DesignAssertionBuilder(node);
}

/** Format assertion results as human-readable text. */
export function formatAssertions(results: AssertionResult[]): string {
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const lines = [
    `${passed} passed, ${failed} failed (${results.length} total)\n`,
  ];

  for (const r of results) {
    const icon = r.passed ? 'PASS' : 'FAIL';
    lines.push(`  ${icon}  ${r.assertion}`);
    if (!r.passed && r.details?.issues) {
      for (const issue of r.details.issues as any[]) {
        lines.push(`         ${issue.message}`);
      }
    }
  }

  return lines.join('\n');
}
