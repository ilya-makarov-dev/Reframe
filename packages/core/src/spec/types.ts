/**
 * INode Conformance Spec — Type Definitions
 *
 * Declarative specification of what each INode property means
 * in every export target. One spec entry → N automatic checks.
 */

import type { NodeBlueprint } from '../builder';

// ─── Matchers ─────────────────────────────────────────────────

/** What to check in the exported output. */
export type Matcher =
  | string                      // output.includes(string)
  | string[]                    // all strings must be present
  | RegExp                      // output.match(regexp)
  | ((output: string) => boolean);  // custom check

// ─── Property Spec ────────────────────────────────────────────

export type PropertyCategory =
  | 'geometry'
  | 'fill'
  | 'stroke'
  | 'shape'
  | 'effect'
  | 'opacity'
  | 'text'
  | 'layout'
  | 'composition';

export interface PropertySpec {
  /** Human-readable name, e.g. 'cornerRadius/uniform' */
  name: string;
  /** Which category of INode behavior this tests */
  category: PropertyCategory;
  /** The scene to build (via builder API) */
  scene: NodeBlueprint;

  /** Expected patterns in HTML export output */
  html?: Matcher;
  /** Expected patterns in SVG export output */
  svg?: Matcher;
  /** Expected patterns in React export output */
  react?: Matcher;

  /**
   * Roundtrip check: export to HTML → reimport → compare these SceneNode properties.
   * If true, uses default roundtrip-safe property list.
   * If string[], compares only those specific properties.
   */
  roundtrip?: boolean | string[];
}

// ─── Audit Spec ───────────────────────────────────────────────

export interface AuditRuleSpec {
  /** Rule name (matches the exported function name) */
  rule: string;
  /** Scene that should PASS (zero issues from this rule) */
  pass: NodeBlueprint;
  /** Scene that should FAIL (at least one issue from this rule) */
  fail: NodeBlueprint;
  /** Expected number of failures (default: 1) */
  failCount?: number;
  /** Optional design system context for DS-dependent rules */
  designSystem?: Record<string, any>;
}

// ─── Import Spec ─────────────────────────────────────────────

export type ImportCategory =
  | 'gradient'
  | 'transform'
  | 'layout'
  | 'text'
  | 'border'
  | 'general';

export interface ImportSpec {
  /** Human-readable name */
  name: string;
  /** Category of import behavior */
  category: ImportCategory;
  /** HTML input to import */
  html: string;
  /** Checks on the imported INode tree — path is dot-separated property chain */
  checks: ImportCheck[];
}

export interface ImportCheck {
  /** Dot-path to a property on the root or child, e.g. 'children[0].rotation' */
  path: string;
  /** Expected value or matcher */
  expected: unknown | ((value: unknown) => boolean);
  /** Tolerance for numeric comparisons (default 0.5) */
  tolerance?: number;
}

// ─── Functional Spec ─────────────────────────────────────────

export type FunctionalCategory =
  | 'assert'
  | 'serialize'
  | 'diff'
  | 'preset'
  | 'timeline'
  | 'stagger'
  | 'audit'
  | 'lottie'
  | 'roundtrip'
  | 'pipeline'
  | 'design-system'
  | 'component';

export interface FunctionalSpec {
  /** Human-readable name */
  name: string;
  /** Category */
  category: FunctionalCategory;
  /** Test function — returns true if passed, string error if failed */
  test: () => Promise<true | string> | true | string;
}

// ─── Animation Spec ──────────────────────────────────────────

export interface AnimationSpec {
  /** Human-readable name */
  name: string;
  /** Scene blueprint to animate */
  scene: NodeBlueprint;
  /** Timeline to apply (or preset name + node targets) */
  timeline: Record<string, any>;
  /** Expected patterns in animated HTML output */
  html?: Matcher;
  /** Expected patterns in Lottie JSON output */
  lottie?: Matcher;
}

// ─── Results ──────────────────────────────────────────────────

export interface SpecCheckResult {
  spec: string;
  target: string;
  passed: boolean;
  message?: string;
}

export interface SpecSuiteResult {
  checks: SpecCheckResult[];
  passed: number;
  failed: number;
  total: number;
}

// ─── Coverage ─────────────────────────────────────────────────

export type CoverageStatus = '✓' | '✗' | '-';

export interface CoverageRow {
  name: string;
  category: PropertyCategory;
  html: CoverageStatus;
  svg: CoverageStatus;
  react: CoverageStatus;
  roundtrip: CoverageStatus;
}
