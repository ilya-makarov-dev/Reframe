/**
 * Single rule list for Studio + MCP `reframe_inspect` audit section.
 * Keeps human (AuditPanel) and agent (session store) on the same checklist.
 */

import type { DesignSystem } from './design-system';
import {
  audit,
  textOverflow,
  nodeOverflow,
  minFontSize as minFontSizeRule,
  noEmptyText,
  noZeroSize,
  noHiddenNodes,
  contrastMinimum,
  minTouchTarget,
  fontInPalette,
  colorInPalette,
  fontWeightCompliance,
  fontSizeRoleMatch,
  borderRadiusCompliance,
  spacingGridCompliance,
  fontFeaturesCompliance,
  spacingScaleCompliance,
  componentSpecCompliance,
  stateCompleteness,
  visualHierarchy,
  contentDensity,
  visualBalance,
  ctaVisibility,
  exportFidelity,
  type AuditRule,
} from './audit';

export interface InspectAuditRuleOptions {
  minFontSize?: number;
  minContrast?: number;
}

const DEFAULT_MIN_FONT = 8;
const DEFAULT_MIN_CONTRAST = 3;

/**
 * Same 19-rule stack as MCP `reframe_inspect` (+ fontInPalette/colorInPalette when `designSystem` is set).
 */
export function buildInspectAuditRules(
  designSystem: DesignSystem | undefined,
  opts?: InspectAuditRuleOptions,
): AuditRule[] {
  const minFS = opts?.minFontSize ?? DEFAULT_MIN_FONT;
  const minC = opts?.minContrast ?? DEFAULT_MIN_CONTRAST;

  const rules: AuditRule[] = [
    textOverflow(),
    nodeOverflow(),
    minFontSizeRule(minFS),
    noEmptyText(),
    noZeroSize(),
    noHiddenNodes(),
    contrastMinimum(minC),
    minTouchTarget(),
    fontWeightCompliance(),
    fontSizeRoleMatch(),
    borderRadiusCompliance(),
    spacingGridCompliance(),
    visualHierarchy(),
    contentDensity(),
    visualBalance(),
    ctaVisibility(),
    exportFidelity(),
  ];

  if (designSystem) {
    rules.push(fontInPalette());
    rules.push(colorInPalette());
    rules.push(fontFeaturesCompliance());
    rules.push(spacingScaleCompliance());
    rules.push(componentSpecCompliance());
    rules.push(stateCompleteness());
  }

  return rules;
}
