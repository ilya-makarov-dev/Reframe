/**
 * Auto-fix engine — shared by `reframe_compile` and `reframe_edit`.
 *
 * Callers should run audit with `buildInspectAuditRules` (same stack as `reframe_inspect` / Studio)
 * so auto-fix targets align with the 19-rule feedback loop.
 *
 * Maps audit issue fix suggestions to INode property mutations.
 */

import type { SceneGraph } from '../../../core/src/engine/scene-graph.js';
import type { AuditIssue } from '../../../core/src/audit.js';

// ─── CSS → INode property mapping ────────────────────────────

/** Map CSS property names from audit fixes to INode property names. */
export function cssPropertyToNodeProperty(cssProp: string): string | null {
  const map: Record<string, string> = {
    'font-size': 'fontSize',
    'font-family': 'fontFamily',
    'font-weight': 'fontWeight',
    'color': '_textColor',        // special: needs fill update
    'background': '_background',  // special: needs fill update
    'background-color': '_background',
    'border-radius': 'cornerRadius',
    'left': 'x',
    'top': 'y',
    'opacity': 'opacity',
    'line-height': 'lineHeight',
    'letter-spacing': 'letterSpacing',
    'font-feature-settings': 'fontFeatureSettings',
    'height': 'height',
    'min-width': 'minWidth',
    'min-height': 'minHeight',
    'gap': 'itemSpacing',
    'padding-top': 'paddingTop',
    'padding-right': 'paddingRight',
    'padding-bottom': 'paddingBottom',
    'padding-left': 'paddingLeft',
  };
  return map[cssProp] ?? null;
}

// ─── Color parsing ───────────────────────────────────────────

/** Parse a CSS color to INode Color { r, g, b, a } (0-1 range). */
export function parseCssColor(value: string): { r: number; g: number; b: number; a: number } | null {
  // Hex
  const hexMatch = value.match(/^#([0-9a-fA-F]{3,8})$/);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    if (hex.length === 4) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3];
    return {
      r: parseInt(hex.slice(0, 2), 16) / 255,
      g: parseInt(hex.slice(2, 4), 16) / 255,
      b: parseInt(hex.slice(4, 6), 16) / 255,
      a: hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }

  // rgb/rgba
  const rgbMatch = value.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (rgbMatch) {
    return {
      r: parseFloat(rgbMatch[1]) / 255,
      g: parseFloat(rgbMatch[2]) / 255,
      b: parseFloat(rgbMatch[3]) / 255,
      a: rgbMatch[4] ? parseFloat(rgbMatch[4]) : 1,
    };
  }

  return null;
}

// ─── Contrast helpers ────────────────────────────────────────

/** Relative luminance per WCAG 2.1. */
function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(c =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** Contrast ratio between two luminances (returns >= 1). */
function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Adjust a text color to meet a target contrast ratio against a background.
 * Moves toward black or white depending on which gets closer faster.
 */
function fixContrastColor(
  textR: number, textG: number, textB: number,
  bgR: number, bgG: number, bgB: number,
  targetRatio: number,
): { r: number; g: number; b: number } {
  const bgLum = relativeLuminance(bgR, bgG, bgB);

  // Try darkening toward black
  let bestDark = { r: textR, g: textG, b: textB };
  for (let t = 0; t <= 1; t += 0.02) {
    const r = textR * (1 - t);
    const g = textG * (1 - t);
    const b = textB * (1 - t);
    const ratio = contrastRatio(relativeLuminance(r, g, b), bgLum);
    if (ratio >= targetRatio) {
      bestDark = { r, g, b };
      break;
    }
    bestDark = { r, g, b };
  }

  // Try lightening toward white
  let bestLight = { r: textR, g: textG, b: textB };
  for (let t = 0; t <= 1; t += 0.02) {
    const r = textR + (1 - textR) * t;
    const g = textG + (1 - textG) * t;
    const b = textB + (1 - textB) * t;
    const ratio = contrastRatio(relativeLuminance(r, g, b), bgLum);
    if (ratio >= targetRatio) {
      bestLight = { r, g, b };
      break;
    }
    bestLight = { r, g, b };
  }

  // Pick whichever achieves target with less color shift
  const darkRatio = contrastRatio(relativeLuminance(bestDark.r, bestDark.g, bestDark.b), bgLum);
  const lightRatio = contrastRatio(relativeLuminance(bestLight.r, bestLight.g, bestLight.b), bgLum);

  if (darkRatio >= targetRatio && lightRatio >= targetRatio) {
    // Both work — pick the one closer to original
    const darkDist = Math.abs(bestDark.r - textR) + Math.abs(bestDark.g - textG) + Math.abs(bestDark.b - textB);
    const lightDist = Math.abs(bestLight.r - textR) + Math.abs(bestLight.g - textG) + Math.abs(bestLight.b - textB);
    return darkDist <= lightDist ? bestDark : bestLight;
  }
  return darkRatio >= targetRatio ? bestDark : bestLight;
}

// ─── Apply fix ───────────────────────────────────────────────

/** Apply a single auto-fix to the scene graph. Returns true if applied. */
export function applyFix(graph: SceneGraph, issue: AuditIssue): boolean {
  if (!issue.nodeId) return false;

  const node = graph.getNode(issue.nodeId);
  if (!node) return false;

  // ── Contrast auto-fix (special case — no CSS fix field) ──
  if (issue.rule === 'contrast-minimum' && node.type === 'TEXT') {
    return applyContrastFix(graph, issue.nodeId, node);
  }

  if (!issue.fix) return false;

  const nodeProp = cssPropertyToNodeProperty(issue.fix.property);
  if (!nodeProp) return false;

  const suggested = issue.fix.suggested;

  // Special case: text color → update fills
  if (nodeProp === '_textColor' && node.type === 'TEXT') {
    const hexMatch = suggested.match(/#[0-9a-fA-F]{3,8}/);
    if (hexMatch) {
      const color = parseCssColor(hexMatch[0]);
      if (color) {
        graph.updateNode(issue.nodeId, {
          fills: [{ type: 'SOLID', color: { r: color.r, g: color.g, b: color.b, a: 1 }, opacity: color.a, visible: true }],
        });
        return true;
      }
    }
    return false;
  }

  // Special case: background color → update fills on FRAME
  if (nodeProp === '_background' && node.type !== 'TEXT') {
    const hexMatch = suggested.match(/#[0-9a-fA-F]{3,8}/);
    if (hexMatch) {
      const color = parseCssColor(hexMatch[0]);
      if (color) {
        graph.updateNode(issue.nodeId, {
          fills: [{ type: 'SOLID', color: { r: color.r, g: color.g, b: color.b, a: 1 }, opacity: color.a, visible: true }],
        });
        return true;
      }
    }
    return false;
  }

  // Numeric properties
  const numVal = parseFloat(suggested);
  if (!isNaN(numVal)) {
    const updates: Record<string, number> = { [nodeProp]: numVal };

    // When fontSize changes, proportionally scale the baked-in absolute line-height
    // so it stays visually correct. HTML importer bakes `line-height: 1.2` as an
    // absolute px value (fontSize × 1.2); without this adjustment, shrinking fontSize
    // would leave the old leading baked in and open up massive empty gaps between
    // lines. Only applied when the current lineHeight clearly represents a ratio-
    // derived px value (lineHeight > fontSize × 0.8, i.e. sane leading).
    if (nodeProp === 'fontSize' && node.type === 'TEXT') {
      const oldFontSize = (node as any).fontSize;
      const currentLH = (node as any).lineHeight;
      if (
        typeof oldFontSize === 'number' && oldFontSize > 0 &&
        typeof currentLH === 'number' && currentLH > 0 &&
        numVal > 0 && numVal !== oldFontSize
      ) {
        const ratio = currentLH / oldFontSize;
        // Ratio must look like real leading (between 0.8 and 3.0). Outside that, leave
        // lineHeight alone — it may already be a small fixed override.
        if (ratio >= 0.8 && ratio <= 3.0) {
          updates.lineHeight = Math.round(numVal * ratio * 100) / 100;
        }
      }
    }

    graph.updateNode(issue.nodeId, updates);
    return true;
  }

  // String properties (font-family)
  if (nodeProp === 'fontFamily') {
    const clean = suggested.replace(/['"`]/g, '').split(',')[0].trim();
    graph.updateNode(issue.nodeId, { fontFamily: clean });
    return true;
  }

  return false;
}

/**
 * Auto-fix contrast by adjusting text color to meet WCAG AA (4.5:1).
 * Reads current text fill + parent background, computes corrected color.
 */
function applyContrastFix(graph: SceneGraph, nodeId: string, node: any): boolean {
  // Get text color from fills
  const textFill = node.fills?.find((f: any) => f.type === 'SOLID' && f.visible !== false);
  if (!textFill?.color) return false;

  const textR = textFill.color.r ?? 0;
  const textG = textFill.color.g ?? 0;
  const textB = textFill.color.b ?? 0;

  // Find parent background
  let bgR = 1, bgG = 1, bgB = 1; // default white
  if (node.parentId) {
    const parent = graph.getNode(node.parentId);
    if (parent?.fills) {
      const bgFill = parent.fills.find((f: any) => f.type === 'SOLID' && f.visible !== false);
      if (bgFill?.color) {
        bgR = bgFill.color.r ?? 1;
        bgG = bgFill.color.g ?? 1;
        bgB = bgFill.color.b ?? 1;
      }
    }
  }

  // Check if already good
  const currentRatio = contrastRatio(
    relativeLuminance(textR, textG, textB),
    relativeLuminance(bgR, bgG, bgB),
  );
  if (currentRatio >= 4.5) return false;

  // Fix it
  const fixed = fixContrastColor(textR, textG, textB, bgR, bgG, bgB, 4.5);
  graph.updateNode(nodeId, {
    fills: [{ type: 'SOLID', color: { r: fixed.r, g: fixed.g, b: fixed.b, a: 1 }, opacity: 1, visible: true }],
  });
  return true;
}

// ─── Auto-fix loop ───────────────────────────────────────────

export interface AutoFixResult {
  finalIssues: AuditIssue[];
  allFixed: string[];
  passCount: number;
}

/**
 * Run the audit → fix → re-audit loop.
 */
export function runAutoFixLoop(
  graph: SceneGraph,
  rootId: string,
  auditFn: () => AuditIssue[],
  options: { autoFix?: boolean; maxPasses?: number },
): AutoFixResult {
  const doAutoFix = options.autoFix !== false;
  const maxPasses = options.maxPasses ?? 3;
  const allFixed: string[] = [];
  let finalIssues: AuditIssue[] = [];
  let passCount = 0;

  for (let pass = 0; pass < (doAutoFix ? maxPasses : 1); pass++) {
    passCount++;
    const issues = auditFn();

    if (!doAutoFix || issues.length === 0) {
      finalIssues = issues;
      break;
    }

    // Apply fixable issues
    let fixedThisPass = 0;
    for (const issue of issues) {
      const applied = applyFix(graph, issue);
      if (applied) {
        fixedThisPass++;
        if (issue.fix) {
          allFixed.push(`${issue.rule}: ${issue.fix.property} ${issue.fix.current} → ${issue.fix.suggested}`);
        } else {
          allFixed.push(`${issue.rule}: auto-corrected`);
        }
      }
    }

    if (fixedThisPass === 0) {
      finalIssues = issues;
      break;
    }

    // Last pass: re-audit to get remaining
    if (pass === maxPasses - 1) {
      finalIssues = auditFn();
    }
  }

  return { finalIssues, allFixed, passCount };
}
