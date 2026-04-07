/**
 * reframe.config.ts — type definitions for the design build system.
 *
 * One config file describes: design system, scenes, sizes, assertions, exports.
 * `reframe build` compiles everything. `reframe test` validates everything.
 */

export interface ReframeConfig {
  /** Path to DESIGN.md (relative to config file) */
  design?: string;

  /** Inline DESIGN.md content (alternative to file path) */
  designMd?: string;

  /** Named size presets */
  sizes: Record<string, SizeSpec>;

  /** Scene definitions — content + which sizes to generate */
  scenes: Record<string, SceneSpec>;

  /** Assertions to run on every compiled scene */
  assert?: AssertionSpec[];

  /** Export formats */
  exports?: ExportFormat[];

  /** Output directory (default: .reframe/dist/) */
  outDir?: string;
}

export interface SizeSpec {
  width: number;
  height: number;
  /** Override layout for this size */
  layout?: LayoutStyle;
}

export interface SceneSpec {
  content: ContentSpec;
  /** Size names from the sizes map, or 'all' */
  sizes: string[] | 'all';
  /** Override layout for this scene */
  layout?: LayoutStyle;
  /** Override assertions for this scene */
  assert?: AssertionSpec[];
  /** Override export formats for this scene */
  exports?: ExportFormat[];
}

export interface ContentSpec {
  headline?: string;
  subheadline?: string;
  cta?: string;
  body?: string;
  disclaimer?: string;
  imageUrl?: string;
  logoUrl?: string;
}

export interface AssertionSpec {
  type: 'minContrast' | 'minFontSize' | 'noTextOverflow' | 'noEmptyText'
    | 'noZeroSize' | 'noOverlapping' | 'fitsWithin' | 'minLineHeight'
    | 'ctaVisible';
  value?: any;
}

export type LayoutStyle = 'centered' | 'left-aligned' | 'split' | 'stacked' | 'auto';
export type ExportFormat = 'html' | 'svg' | 'png' | 'react';

/** Result of building a single scene+size combination */
export interface BuildResult {
  scene: string;
  size: string;
  width: number;
  height: number;
  layout: string;
  sceneId: string;
  auditPassed: boolean;
  auditFixed: number;
  auditRemaining: number;
  exports: Record<string, string>; // format → file path or content
  durationMs: number;
}

/** Result of testing a single scene+size combination */
export interface TestResult {
  scene: string;
  size: string;
  width: number;
  height: number;
  assertions: AssertionResult[];
  passed: boolean;
}

export interface AssertionResult {
  type: string;
  passed: boolean;
  message: string;
  actual?: any;
  expected?: any;
}

/** Full build output */
export interface BuildOutput {
  results: BuildResult[];
  passed: number;
  failed: number;
  totalMs: number;
}

/** Full test output */
export interface TestOutput {
  results: TestResult[];
  passed: number;
  failed: number;
  totalMs: number;
}
