/**
 * INode Conformance Suite
 *
 * Declarative specification of what every INode property means
 * in every export target. One spec entry → N automatic checks.
 *
 * Usage:
 *   import { ALL_PROPERTY_SPECS, AUDIT_SPECS, runFullSuite } from './spec';
 *   const results = await runFullSuite(ALL_PROPERTY_SPECS, AUDIT_SPECS);
 */

export type {
  PropertySpec,
  PropertyCategory,
  Matcher,
  AuditRuleSpec,
  SpecCheckResult,
  SpecSuiteResult,
  CoverageRow,
  CoverageStatus,
} from './types';

export {
  ALL_PROPERTY_SPECS,
  GEOMETRY_SPECS,
  FILL_SPECS,
  STROKE_SPECS,
  SHAPE_SPECS,
  EFFECT_SPECS,
  OPACITY_SPECS,
  TEXT_SPECS,
  LAYOUT_SPECS,
  COMPOSITION_SPECS,
} from './properties';

export { AUDIT_SPECS } from './audit';
export type { AuditRuleEntry } from './audit';

export { IMPORT_SPECS } from './imports';
export type { ImportSpec, ImportCheck, ImportCategory } from './types';

export { ANIMATION_SPECS } from './animations';
export type { AnimationSpec } from './types';

export { FUNCTIONAL_SPECS } from './functional';
// PIPELINE_SPECS removed — needs rewrite for tools-v2
export { DESIGN_SYSTEM_SPECS } from './design-system';
export type { FunctionalSpec, FunctionalCategory } from './types';

export { runPropertySpecs, runAuditSpecs, runImportSpecs, runAnimationSpecs, runFunctionalSpecs, runFullSuite } from './runner';

export {
  generateCoverageMatrix,
  formatCoverageMatrix,
  analyzeCoverage,
} from './coverage';
