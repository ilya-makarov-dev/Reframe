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
import { ensureSceneLayout } from '../../../core/src/engine/layout.js';

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

  // ── CTA clipped outside frame — clamp position inside root bounds ──
  if (issue.rule === 'cta-visibility' && issue.message?.includes('extends outside')) {
    const root = graph.getNode(graph.rootId);
    if (root) {
      const updates: Record<string, number> = {};
      if (node.x < 0) updates.x = 0;
      if (node.y < 0) updates.y = 0;
      if (node.x + node.width > root.width) {
        updates.x = Math.max(0, root.width - node.width);
      }
      if (node.y + node.height > root.height) {
        updates.y = Math.max(0, root.height - node.height);
      }
      if (Object.keys(updates).length > 0) {
        graph.updateNode(issue.nodeId, updates);
        return true;
      }
    }
    return false;
  }

  if (!issue.fix) return false;

  // Special case: combo "min-width/min-height" property emitted by
  // min-touch-target rule. The combo string isn't in the CSS→node prop
  // map, so the regular cssPropertyToNodeProperty lookup returned null
  // and the touch-target fix silently no-op'd through every iterate
  // pass. Parse out a single numeric value (e.g. "44×44px" → 44) and
  // write both minWidth and minHeight on the node.
  if (issue.fix.property === 'min-width/min-height') {
    const num = parseFloat(issue.fix.suggested);
    if (!isNaN(num) && num > 0) {
      graph.updateNode(issue.nodeId, { minWidth: num, minHeight: num });
      return true;
    }
    return false;
  }

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
    // Safety: never auto-shrink dimensions on container nodes or the scene root.
    // A component-spec rule firing on a mis-classified node (e.g. the old
    // `/input|field|form/i` regex matching "Plainform") used to crush the
    // entire landing from 4326px → 44px in one pass.
    if (nodeProp === 'height' || nodeProp === 'width') {
      const hasChildren = Array.isArray((node as any).children) && (node as any).children.length > 0;
      const isRoot = !(node as any).parentId;
      const current = (node as any)[nodeProp] as number | undefined;
      const shrinkingALot = typeof current === 'number' && current > 0 && numVal < current * 0.5;
      if (hasChildren || isRoot || shrinkingALot) {
        return false;
      }
    }

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
 * Reads current text fill + walks all ancestors to find the nearest solid
 * background, mirroring the logic of the contrast-minimum audit rule.
 *
 * Bug history: this used to look at the immediate parent only and fall
 * back to white. On articles where every text wrapper had
 * `background:transparent`, the immediate parent had no solid fill, the
 * function defaulted to white, computed contrast vs white (16:1, "fine"),
 * skipped the fix, but the audit rule (which DOES walk ancestors) saw the
 * real #fafaf7 article bg and kept reporting failures. Worse, when the
 * audit's reported bg was very light, the white default became the
 * correction target — and the fixer pushed text toward the actual bg
 * color, ending in a 1:1 same-color collapse. Walking ancestors here
 * keeps the fix and the audit on the same effective background.
 */
function applyContrastFix(graph: SceneGraph, nodeId: string, node: any): boolean {
  // Get text color from fills
  const textFill = node.fills?.find((f: any) => f.type === 'SOLID' && f.visible !== false);
  if (!textFill?.color) return false;

  const textR = textFill.color.r ?? 0;
  const textG = textFill.color.g ?? 0;
  const textB = textFill.color.b ?? 0;

  // Walk up ancestors to find the nearest solid (alpha > 0.5) background.
  // Skip the node itself — for TEXT, fills[0] IS the text color.
  let bgR = 1, bgG = 1, bgB = 1; // default white if nothing found
  let bgFound = false;
  let currentParentId: string | undefined = node.parentId;
  while (currentParentId) {
    const ancestor: any = graph.getNode(currentParentId);
    if (!ancestor) break;
    const ancFills = ancestor.fills as any[] | undefined;
    if (Array.isArray(ancFills) && ancFills.length > 0) {
      const bgFill = ancFills.find(
        (f: any) => f?.type === 'SOLID' && f?.visible !== false && (f?.color?.a ?? 1) > 0.5,
      );
      if (bgFill?.color) {
        bgR = bgFill.color.r ?? 1;
        bgG = bgFill.color.g ?? 1;
        bgB = bgFill.color.b ?? 1;
        bgFound = true;
        break;
      }
    }
    const next = ancestor.parentId as string | undefined;
    if (!next || next === currentParentId) break;
    currentParentId = next;
  }
  // No ancestor had a fill → don't guess. Trust the rule: it ran and
  // produced the issue, but we have no ground truth for the bg to fix
  // against. Returning false here is safer than corrupting the text fill.
  if (!bgFound) return false;

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

  // Track which properties changed this pass. Dimension-affecting fixes
  // (font-size, padding, gap, line-height, width/height) invalidate cached
  // bbox geometry — spatial rules (content-overflow, sibling-overlap,
  // container-underflow) would otherwise run against stale positions and
  // produce phantom warnings. Non-dimensional fixes (color / contrast /
  // fills) don't require re-layout and skip the cost.
  const DIMENSION_FIX_PROPS = new Set([
    'font-size', 'font-family', 'font-weight', 'line-height', 'letter-spacing',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'gap', 'width', 'height', 'min-width', 'min-height',
  ]);

  for (let pass = 0; pass < (doAutoFix ? maxPasses : 1); pass++) {
    passCount++;
    const issues = auditFn();

    if (!doAutoFix || issues.length === 0) {
      finalIssues = issues;
      break;
    }

    // Apply fixable issues
    let fixedThisPass = 0;
    let dimensionFixesThisPass = 0;
    for (const issue of issues) {
      const applied = applyFix(graph, issue);
      if (applied) {
        fixedThisPass++;
        if (issue.fix?.property && DIMENSION_FIX_PROPS.has(issue.fix.property)) {
          dimensionFixesThisPass++;
        }
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

    // Re-run layout BEFORE the next audit pass when a fix mutated something
    // that affects geometry. This prevents spatial rules on pass N+1 from
    // reading the cached (pre-fix) y/height of ancestors whose size depends
    // on the fixed node.
    if (dimensionFixesThisPass > 0) {
      ensureSceneLayout(graph, rootId);
    }

    // Last pass: re-audit to get remaining
    if (pass === maxPasses - 1) {
      finalIssues = auditFn();
    }
  }

  return { finalIssues, allFixed, passCount };
}
