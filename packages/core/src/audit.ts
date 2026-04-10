/**
 * Reframe — INode Tree Audit
 *
 * Validate an INode tree against rules: design system compliance,
 * overflow detection, accessibility, structural checks.
 *
 *   const issues = audit(root, [
 *     fontInPalette(designSystem),
 *     textOverflow(),
 *     contrastMinimum(4.5),
 *     minFontSize(10),
 *   ]);
 *
 *   // Or as a pipe transform:
 *   pipe(classify(), auditTransform(rules));
 */

import type { INode, IPaint, ISolidPaint } from './host/types';
import { NodeType, MIXED } from './host/types';
import type { Transform, PipeContext } from './resize/pipe';
import { transform } from './resize/pipe';

// ─── Core Types ────────────────────────────────────────────────

export type Severity = 'error' | 'warning' | 'info';

export interface AutoFix {
  /** CSS property to change (e.g. 'font-size', 'color', 'border-radius'). */
  property: string;
  /** Current value in the design. */
  current: string;
  /** Suggested value from the design system. */
  suggested: string;
  /** Ready-to-use CSS snippet for the agent. */
  css: string;
}

export interface AuditIssue {
  /** Rule that triggered this issue. */
  rule: string;
  /** Severity level. */
  severity: Severity;
  /** Human-readable description. */
  message: string;
  /** Node that caused the issue (if applicable). */
  nodeId?: string;
  /** Node name for readability. */
  nodeName?: string;
  /** Node path from root (for location). */
  path?: string;
  /** Auto-fix suggestion with specific CSS change. */
  fix?: AutoFix;
}

/**
 * An audit rule — checks a single node and returns issues.
 * Rules are applied to every node in the tree via DFS.
 */
export interface AuditRule {
  /** Rule identifier. */
  readonly name: string;
  /** Check a single node. Return issues found (empty array = pass). */
  check(node: INode, ctx: AuditContext): AuditIssue[];
}

/** Context provided to each rule during audit. */
export interface AuditContext {
  /** Root frame of the tree being audited. */
  root: INode;
  /** Root frame dimensions. */
  rootWidth: number;
  rootHeight: number;
  /** Design system (if available). */
  designSystem?: DesignSystemLike;
  /** Path from root to current node (names joined by " > "). */
  path: string;
  /** Parent node (undefined for root). */
  parent?: INode;
  /** All ancestors from root to parent (root first, immediate parent last). */
  ancestors: INode[];
  /** Fields on this node bound to design tokens (auto-pass palette checks). */
  tokenBoundFields?: Set<string>;
}

/** Minimal design system shape for audit rules. */
interface DesignSystemLike {
  colors?: { roles: Map<string, string>; primary?: string; background?: string; text?: string; accent?: string };
  typography?: {
    hierarchy: Array<{ role: string; fontFamily?: string; fontSize: number; fontWeight: number; lineHeight: number; letterSpacing: number; fontFeatures?: string[] }>;
    fontFeatures?: Array<{ tag: string; scope: string }>;
    /** Every font size found in the typography section, even when role dedup hides it. */
    allSizes?: number[];
  };
  layout?: { borderRadiusScale: number[]; spacingUnit: number; spacingScale?: number[]; sectionPaddingRange?: [number, number] };
  components?: {
    button?: { borderRadius: number; style?: string; fontWeight?: number; variants?: Array<{ name: string; background?: string; color?: string; borderRadius?: number; paddingX?: number; paddingY?: number; minHeight?: number; hover?: { background?: string } }> };
    card?: { borderRadius: number; background?: string; borderColor?: string; padding?: number };
    badge?: { borderRadius: number; fontSize?: number; fontWeight?: number; paddingX?: number; paddingY?: number };
    input?: { borderRadius: number; borderColor?: string; fontSize?: number; height?: number; focusBorderColor?: string };
    nav?: { height?: number; fontSize?: number; fontWeight?: number };
  };
}

// ─── Audit Runner ──────────────────────────────────────────────

/**
 * Run audit rules against an INode tree.
 * Walks the entire tree (DFS) and applies every rule to every node.
 *
 * @returns All issues found, sorted by severity (errors first).
 */
export function audit(
  root: INode,
  rules: AuditRule[],
  designSystem?: DesignSystemLike,
  options?: { getTokenBoundFields?: (nodeId: string) => Set<string> | undefined },
): AuditIssue[] {
  const issues: AuditIssue[] = [];

  const walk = (node: INode, path: string, parent: INode | undefined, ancestors: INode[]) => {
    // Scrollable pages (vertical layout): don't flag vertical overflow
    const isScrollable = root.layoutMode === 'VERTICAL';
    const ctx: AuditContext = {
      root,
      rootWidth: root.width,
      rootHeight: isScrollable ? Infinity : root.height,
      designSystem,
      path,
      parent,
      ancestors,
      tokenBoundFields: options?.getTokenBoundFields?.(node.id),
    };

    for (const rule of rules) {
      const found = rule.check(node, ctx);
      issues.push(...found);
    }

    if (node.children) {
      const childAncestors = [...ancestors, node];
      for (const child of node.children) {
        walk(child, `${path} > ${child.name}`, node, childAncestors);
      }
    }
  };

  walk(root, root.name, undefined, []);

  // Sort: errors → warnings → info
  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);

  return issues;
}

/**
 * Audit as a pipeline transform.
 * Stores issues in ctx.state('auditIssues').
 */
export function auditTransform(...rules: AuditRule[]): Transform {
  return transform('audit', (root, ctx) => {
    const ds = ctx.designSystem as DesignSystemLike | undefined;
    const issues = audit(root, rules, ds);
    ctx.state.set('auditIssues', issues);
  });
}

// ─── Rule Constructor ──────────────────────────────────────────

/**
 * Create a named audit rule from a check function.
 */
export function rule(
  name: string,
  check: (node: INode, ctx: AuditContext) => AuditIssue[],
): AuditRule {
  return { name, check };
}

// ─── Built-in Rules ────────────────────────────────────────────

// ── Text Overflow ──

/**
 * Check if a node has a clipping ancestor (any parent with clipsContent=true).
 * If so, overflow is visually hidden and should not be flagged.
 */
function hasClippingAncestor(ctx: AuditContext): boolean {
  for (const ancestor of ctx.ancestors) {
    if (ancestor.clipsContent) return true;
    // Also treat overflow:hidden containers as clipping
    if ((ancestor as any).overflow === 'hidden') return true;
  }
  return false;
}

/** Detect text nodes that extend beyond the root frame boundaries. */
/**
 * Translate a node's absoluteBoundingBox into coordinates relative to
 * the audit root. Figma's `absoluteBoundingBox` (and the standalone
 * adapter's equivalent) returns x/y in the graph's CANVAS space. When a
 * resize pipeline clones a frame and parks it beside the source
 * (`clone.x = source.x + source.width + 50`), every descendant's bb.x
 * picks up that 700+ px offset. The overflow rules were comparing those
 * absolute x values against `ctx.rootWidth` (a *local* number) and
 * flagging every resized scene as overflowing. The fix is to subtract
 * the root's own absoluteBoundingBox so comparisons happen in one
 * coordinate space.
 */
function localBounds(
  bb: { x: number; y: number; width: number; height: number },
  rootBb: { x: number; y: number; width: number; height: number } | null | undefined,
): { x: number; y: number; width: number; height: number } {
  if (!rootBb) return bb;
  return {
    x: bb.x - rootBb.x,
    y: bb.y - rootBb.y,
    width: bb.width,
    height: bb.height,
  };
}

export function textOverflow(): AuditRule {
  return rule('text-overflow', (node, ctx) => {
    if (node.type !== NodeType.Text) return [];

    const rawBb = node.absoluteBoundingBox;
    if (!rawBb) return [];

    // Skip if a clipping ancestor hides the overflow visually
    if (hasClippingAncestor(ctx)) return [];

    // Flex column wrap escape hatch: linkedom doesn't compute flex constraints,
    // so a TEXT node inside a VERTICAL parent can report a natural width much
    // wider than its parent even though it would wrap in a real browser. If
    // the parent is a column and the text's measured width is well past the
    // parent's inner width, trust CSS wrap rather than flag overflow.
    const parent = ctx.parent;
    if (
      parent &&
      parent.layoutMode === 'VERTICAL' &&
      parent.width > 0 &&
      node.width > parent.width * 1.1
    ) {
      return [];
    }

    const bb = localBounds(rawBb, ctx.root.absoluteBoundingBox);
    const issues: AuditIssue[] = [];

    if (bb.x + bb.width > ctx.rootWidth + 1 || bb.y + bb.height > ctx.rootHeight + 1) {
      issues.push({
        rule: 'text-overflow',
        severity: 'warning',
        message: `Text "${truncate(node.characters ?? '', 30)}" extends beyond frame (${Math.round(bb.x + bb.width)}x${Math.round(bb.y + bb.height)} vs ${ctx.rootWidth}x${ctx.rootHeight})`,
        nodeId: node.id,
        nodeName: node.name,
        path: ctx.path,
      });
    }

    if (bb.x < -1 || bb.y < -1) {
      issues.push({
        rule: 'text-overflow',
        severity: 'warning',
        message: `Text "${truncate(node.characters ?? '', 30)}" starts outside frame (x=${Math.round(bb.x)}, y=${Math.round(bb.y)})`,
        nodeId: node.id,
        nodeName: node.name,
        path: ctx.path,
      });
    }

    return issues;
  });
}

// ── Node Overflow (generic) ──

/** Detect any node that extends beyond the root frame. */
export function nodeOverflow(): AuditRule {
  return rule('node-overflow', (node, ctx) => {
    if (node === ctx.root) return [];
    const rawBb = node.absoluteBoundingBox;
    if (!rawBb) return [];

    // Skip if a clipping ancestor hides the overflow visually
    if (hasClippingAncestor(ctx)) return [];

    const bb = localBounds(rawBb, ctx.root.absoluteBoundingBox);

    if (
      bb.x + bb.width > ctx.rootWidth + 1 ||
      bb.y + bb.height > ctx.rootHeight + 1 ||
      bb.x < -1 || bb.y < -1
    ) {
      return [{
        rule: 'node-overflow',
        severity: 'info',
        message: `"${node.name}" (${node.type}) extends beyond frame bounds`,
        nodeId: node.id,
        nodeName: node.name,
        path: ctx.path,
      }];
    }
    return [];
  });
}

// ── Minimum Font Size ──

/** Ensure no text node has a font size below the threshold. */
export function minFontSize(min = 10): AuditRule {
  return rule('min-font-size', (node, ctx) => {
    if (node.type !== NodeType.Text) return [];
    const size = node.fontSize;
    if (typeof size !== 'number') return []; // MIXED — skip
    // If the design system explicitly documents this size (e.g. Linear has
    // Tiny=10px / Micro=11px in its hierarchy), it is legal regardless of
    // the global floor — these label-role sizes are intentional.
    const allSizes = ctx.designSystem?.typography?.allSizes;
    if (allSizes && allSizes.includes(size)) return [];
    if (size < min) {
      return [{
        rule: 'min-font-size',
        severity: 'warning',
        message: `Font size ${size}px is below minimum ${min}px`,
        nodeId: node.id,
        nodeName: node.name,
        path: ctx.path,
        fix: { property: 'font-size', current: `${size}px`, suggested: `${min}px`, css: `font-size: ${min}px` },
      }];
    }
    return [];
  });
}

// ── Font Family in Palette ──

/**
 * Check that all text nodes use fonts from the design system.
 * Requires a design system with typography.hierarchy.
 */
export function fontInPalette(): AuditRule {
  return rule('font-in-palette', (node, ctx) => {
    if (node.type !== NodeType.Text) return [];
    if (!ctx.designSystem?.typography?.hierarchy) return [];
    // Token-bound font family is compliant by construction
    if (ctx.tokenBoundFields?.has('fontFamily')) return [];

    const font = node.fontName;
    if (!font || font === MIXED) return [];

    const family = typeof font === 'object' && 'family' in font ? font.family : null;
    if (!family) return [];

    const allowed = new Set(
      ctx.designSystem.typography.hierarchy
        .map(r => r.fontFamily?.toLowerCase())
        .filter(Boolean),
    );

    if (allowed.size > 0 && !allowed.has(family.toLowerCase())) {
      const suggested = [...allowed][0] ?? family;
      return [{
        rule: 'font-in-palette',
        severity: 'warning',
        message: `Font "${family}" is not in the design system. Allowed: ${[...allowed].join(', ')}`,
        nodeId: node.id,
        nodeName: node.name,
        path: ctx.path,
        fix: { property: 'font-family', current: family, suggested, css: `font-family: ${suggested}` },
      }];
    }
    return [];
  });
}

// ── Color in Palette ──

/**
 * Check that solid fills use colors from the design system palette.
 * Tolerance is a max per-channel deviation (0–1 range).
 */
export function colorInPalette(tolerance = 0.05): AuditRule {
  return rule('color-in-palette', (node, ctx) => {
    if (!ctx.designSystem?.colors?.roles) return [];
    const fills = node.fills;
    if (!fills || fills === MIXED) return [];

    // Token-bound fills are compliant by construction
    if (ctx.tokenBoundFields) {
      const allBound = (fills as IPaint[]).every((_, i) => ctx.tokenBoundFields!.has(`fills[${i}].color`));
      if (allBound) return [];
    }

    const palette = parsePalette(ctx.designSystem.colors.roles);
    if (palette.length === 0) return [];

    const issues: AuditIssue[] = [];
    const deltaEThreshold = tolerance * 255 * 2;

    for (let fi = 0; fi < (fills as IPaint[]).length; fi++) {
      const fill = (fills as IPaint[])[fi];
      if (fill.type !== 'SOLID') continue;
      if (fill.visible === false) continue;
      // Skip individual token-bound fills
      if (ctx.tokenBoundFields?.has(`fills[${fi}].color`)) continue;
      const c = (fill as ISolidPaint).color;
      if (!c) continue;

      const match = palette.some(p => deltaE(p, c) <= deltaEThreshold);

      if (!match) {
        const current = `rgb(${r255(c.r)},${r255(c.g)},${r255(c.b)})`;
        const closest = findClosestPaletteColor(c, ctx.designSystem!.colors!.roles);
        issues.push({
          rule: 'color-in-palette',
          severity: 'info',
          message: `Color ${current} on "${node.name}" is not in the design system palette`,
          nodeId: node.id,
          nodeName: node.name,
          path: ctx.path,
          fix: closest ? { property: 'color', current, suggested: `${closest.hex} (${closest.role})`, css: `color: ${closest.hex}` } : undefined,
        });
      }
    }

    return issues;
  });
}

// ── Contrast Ratio ──

/**
 * Check that text nodes have sufficient contrast against the root frame background.
 * Uses WCAG relative luminance formula.
 *
 * @param minRatio - minimum contrast ratio (4.5 for AA normal text, 3.0 for AA large text).
 */
export function contrastMinimum(minRatio = 4.5): AuditRule {
  return rule('contrast-minimum', (node, ctx) => {
    if (node.type !== NodeType.Text) return [];

    // Get text color
    const fills = node.fills;
    if (!fills || fills === MIXED) return [];
    const textFill = (fills as IPaint[]).find(f => f.type === 'SOLID' && f.visible !== false) as ISolidPaint | undefined;
    if (!textFill) return [];

    // Walk up ancestors to find nearest solid background
    const bgColor = findNearestBackground(node, ctx);
    if (!bgColor) return [];

    const ratio = contrastRatio(textFill.color, bgColor);
    if (ratio < minRatio) {
      return [{
        rule: 'contrast-minimum',
        severity: 'warning',
        message: `Contrast ratio ${ratio.toFixed(2)}:1 is below ${minRatio}:1 for "${truncate(node.characters ?? '', 30)}"`,
        nodeId: node.id,
        nodeName: node.name,
        path: ctx.path,
      }];
    }

    return [];
  });
}

/** Walk up all ancestors to find nearest solid background fill. */
function findNearestBackground(node: INode, ctx: AuditContext): { r: number; g: number; b: number } | null {
  // Walk ancestors from nearest (parent) to farthest (root)
  for (let i = ctx.ancestors.length - 1; i >= 0; i--) {
    const ancestor = ctx.ancestors[i];
    const fills = ancestor.fills;
    if (fills && fills !== MIXED) {
      const bg = (fills as IPaint[]).find(f => f.type === 'SOLID' && f.visible !== false) as ISolidPaint | undefined;
      if (bg?.color) return bg.color;
    }
  }
  // Fall back to root background
  const rootFills = ctx.root.fills;
  if (!rootFills || rootFills === MIXED) return null;
  const rootBg = (rootFills as IPaint[]).find(f => f.type === 'SOLID' && f.visible !== false) as ISolidPaint | undefined;
  return rootBg?.color ?? null;
}

// ── Hidden Nodes ──

/** Report invisible nodes (visible=false or opacity=0). */
export function noHiddenNodes(): AuditRule {
  return rule('no-hidden-nodes', (node, ctx) => {
    if (node === ctx.root) return [];
    if (node.visible === false || node.opacity === 0) {
      return [{
        rule: 'no-hidden-nodes',
        severity: 'info',
        message: `"${node.name}" is hidden (${node.visible === false ? 'visible=false' : 'opacity=0'})`,
        nodeId: node.id,
        nodeName: node.name,
        path: ctx.path,
      }];
    }
    return [];
  });
}

// ── Empty Text ──

/** Detect text nodes with empty or whitespace-only content. */
export function noEmptyText(): AuditRule {
  return rule('no-empty-text', (node, ctx) => {
    if (node.type !== NodeType.Text) return [];
    const chars = node.characters ?? '';
    if (chars.trim().length === 0) {
      return [{
        rule: 'no-empty-text',
        severity: 'warning',
        message: `Text node "${node.name}" has no visible content`,
        nodeId: node.id,
        nodeName: node.name,
        path: ctx.path,
      }];
    }
    return [];
  });
}

// ── Zero-Size Nodes ──

/** Detect nodes with zero width or height. */
export function noZeroSize(): AuditRule {
  return rule('no-zero-size', (node, ctx) => {
    if (node === ctx.root) return [];
    if (node.width === 0 || node.height === 0) {
      return [{
        rule: 'no-zero-size',
        severity: 'warning',
        message: `"${node.name}" has zero ${node.width === 0 ? 'width' : 'height'}`,
        nodeId: node.id,
        nodeName: node.name,
        path: ctx.path,
      }];
    }
    return [];
  });
}

// ── Font Weight Compliance ──

/**
 * Check that text node font weights match the design system typography hierarchy.
 * If a text node has weight 700 but the design system says hero is 300, flag it.
 */
export function fontWeightCompliance(): AuditRule {
  return rule('font-weight-compliance', (node, ctx) => {
    if (node.type !== NodeType.Text) return [];
    if (!ctx.designSystem?.typography?.hierarchy) return [];

    const fontSize = node.fontSize;
    if (typeof fontSize !== 'number') return [];

    // Get the font weight from the node — check fontName.style
    const fontName = node.fontName;
    if (!fontName || fontName === MIXED) return [];
    const style = typeof fontName === 'object' && 'style' in fontName ? fontName.style : '';
    const nodeWeight = styleToWeight(style);

    // Find the closest matching typography role by size, tie-breaking on weight
    const hierarchy = ctx.designSystem.typography.hierarchy;
    const match = findClosestTypoRule(hierarchy, fontSize, nodeWeight);
    if (!match) return [];

    if (nodeWeight !== match.fontWeight && Math.abs(nodeWeight - match.fontWeight) > 100) {
      return [{
        rule: 'font-weight-compliance',
        severity: 'warning',
        message: `Font weight ${nodeWeight} on "${node.name}" doesn't match design system ${match.role} (expected ${match.fontWeight})`,
        nodeId: node.id,
        nodeName: node.name,
        path: ctx.path,
        fix: { property: 'font-weight', current: `${nodeWeight}`, suggested: `${match.fontWeight}`, css: `font-weight: ${match.fontWeight}` },
      }];
    }
    return [];
  });
}

// ── Border Radius Compliance ──

/**
 * Check that cornerRadius values are in the design system's borderRadiusScale.
 * Flags nodes with non-standard radius values.
 */
export function borderRadiusCompliance(): AuditRule {
  return rule('border-radius-compliance', (node, ctx) => {
    if (!ctx.designSystem?.layout?.borderRadiusScale) return [];
    const cr = node.cornerRadius;
    if (typeof cr !== 'number' || cr === 0) return [];

    const scale = ctx.designSystem.layout.borderRadiusScale;
    if (scale.length === 0) return [];

    // Check if cornerRadius is in the scale (exact or within 1px)
    const inScale = scale.some(r => Math.abs(cr - r) <= 1);
    if (inScale) return [];

    // Find closest scale value
    let closest = scale[0];
    let closestDist = Math.abs(cr - closest);
    for (const r of scale) {
      const d = Math.abs(cr - r);
      if (d < closestDist) { closestDist = d; closest = r; }
    }

    return [{
      rule: 'border-radius-compliance',
      severity: 'info',
      message: `Border radius ${cr}px on "${node.name}" is not in the design system scale [${scale.join(', ')}]`,
      nodeId: node.id,
      nodeName: node.name,
      path: ctx.path,
      fix: { property: 'border-radius', current: `${cr}px`, suggested: `${closest}px`, css: `border-radius: ${closest}px` },
    }];
  });
}

// ── Spacing Grid Compliance ──

/**
 * Check that node positions and sizes snap to the design system spacing grid.
 * Only checks direct children of root (top-level elements).
 */
export function spacingGridCompliance(): AuditRule {
  return rule('spacing-grid', (node, ctx) => {
    if (!ctx.designSystem?.layout?.spacingUnit) return [];
    if (node === ctx.root) return [];
    // Only check direct children of root for cleaner results
    if (node.parent?.id !== ctx.root.id) return [];

    const unit = ctx.designSystem.layout.spacingUnit;
    const issues: AuditIssue[] = [];

    // Check x, y positions
    for (const [prop, val] of [['x', node.x], ['y', node.y]] as const) {
      if (val === 0) continue;
      const remainder = val % unit;
      if (remainder !== 0 && Math.min(remainder, unit - remainder) > unit * 0.25) {
        const snapped = Math.round(val / unit) * unit;
        issues.push({
          rule: 'spacing-grid',
          severity: 'info',
          message: `"${node.name}" ${prop}=${val}px doesn't align to ${unit}px grid (nearest: ${snapped}px)`,
          nodeId: node.id,
          nodeName: node.name,
          path: ctx.path,
          fix: { property: prop === 'x' ? 'left' : 'top', current: `${val}px`, suggested: `${snapped}px`, css: `${prop === 'x' ? 'left' : 'top'}: ${snapped}px` },
        });
      }
    }

    return issues;
  });
}

// ── Font Size Role Match ──

/**
 * Check that font sizes approximately match expected sizes from the design system.
 * A 72px font when design system says hero=56px → flag with suggestion.
 */
export function fontSizeRoleMatch(): AuditRule {
  return rule('font-size-role', (node, ctx) => {
    if (node.type !== NodeType.Text) return [];
    if (!ctx.designSystem?.typography?.hierarchy) return [];

    const fontSize = node.fontSize;
    if (typeof fontSize !== 'number') return [];

    const hierarchy = ctx.designSystem.typography.hierarchy;
    // Authoritative size set: every size found in the typography table, not
    // just the role-deduplicated hierarchy. Linear's table has Display 72/64/48
    // all under role "hero" — without allSizes the parser keeps only 72 and
    // legitimate 48px display headers get auto-fixed to 32px.
    const allSizes = ctx.designSystem.typography.allSizes;
    if (allSizes && allSizes.includes(fontSize)) return [];

    // Check if this font size is approximately in the hierarchy (±25%)
    const exactMatch = hierarchy.some(r => {
      const ratio = fontSize / r.fontSize;
      return ratio >= 0.75 && ratio <= 1.25;
    });

    if (exactMatch) return [];

    // Also accept if within ±15% of any documented size (covers responsive
    // scaling and small per-platform tweaks).
    if (allSizes && allSizes.some(s => Math.abs(fontSize - s) / s <= 0.15)) return [];

    // Brand DESIGN.md files often only document UI chrome sizes (largest entry is
    // a "Section Title" at 24–48px for editorial brands like Ferrari/Tesla). Agents
    // building marketing landings legitimately need display sizes well above that.
    // Any size ≥ 1.5× the largest documented role is treated as hero/display and
    // allowed silently — there is no authoritative remap target.
    const sizes = hierarchy.map(r => r.fontSize).filter(n => typeof n === 'number');
    if (sizes.length === 0) return [];
    const maxDocSize = Math.max(...sizes);
    const minDocSize = Math.min(...sizes);
    if (fontSize >= maxDocSize * 1.5) return [];
    // Tiny text (legal copy, footnotes) that's smaller than smallest-role × 0.6:
    // leave alone — over-enlarging is also destructive.
    if (fontSize <= minDocSize * 0.6) return [];

    // Find closest match for the remaining "in-range but off" cases.
    const closest = findClosestTypoRule(hierarchy, fontSize);
    if (!closest) return [];

    // Only flag if significantly off (>25% deviation)
    const deviation = Math.abs(fontSize - closest.fontSize) / closest.fontSize;
    if (deviation <= 0.25) return [];

    // Safety clamp: if the fix would shrink text by more than 2×, it's almost
    // certainly a display-text false positive. Report as info but omit the fix
    // so auto-fix won't apply it.
    const wouldShrinkTooMuch = fontSize > closest.fontSize * 2;

    const issue: AuditIssue = {
      rule: 'font-size-role',
      severity: 'info',
      message: `Font size ${fontSize}px on "${node.name}" doesn't match any design system role (closest: ${closest.role} at ${closest.fontSize}px)`,
      nodeId: node.id,
      nodeName: node.name,
      path: ctx.path,
    };
    if (!wouldShrinkTooMuch) {
      issue.fix = {
        property: 'font-size',
        current: `${fontSize}px`,
        suggested: `${closest.fontSize}px`,
        css: `font-size: ${closest.fontSize}px`,
      };
    }
    return [issue];
  });
}

// ═══ LAYOUT INTELLIGENCE ═══════════════════════════════════════
// These rules analyze visual quality, not just rule compliance.
// They catch things agents can't see: bad hierarchy, poor balance,
// too much text, invisible CTAs.

// ── Visual Hierarchy ──

/**
 * Check that text sizes create a clear visual hierarchy.
 * Title should be largest, then subtitle, then body, then caption.
 * Flags when hierarchy is inverted or flat.
 */
export function visualHierarchy(): AuditRule {
  return rule('visual-hierarchy', (node, ctx) => {
    // Only check at root level
    if (node !== ctx.root) return [];

    const textNodes = collectTextNodes(node);
    if (textNodes.length < 2) return [];

    // Sort by font size descending
    const sorted = textNodes
      .filter(n => typeof n.fontSize === 'number' && n.fontSize > 0)
      .sort((a, b) => (b.fontSize as number) - (a.fontSize as number));

    if (sorted.length < 2) return [];

    const issues: AuditIssue[] = [];

    // Check: largest text should be significantly larger than smallest
    const largest = sorted[0].fontSize as number;
    const smallest = sorted[sorted.length - 1].fontSize as number;
    const ratio = largest / smallest;

    if (ratio < 1.3 && sorted.length >= 3) {
      issues.push({
        rule: 'visual-hierarchy',
        severity: 'warning',
        message: `Flat text hierarchy: largest ${largest}px vs smallest ${smallest}px (ratio ${ratio.toFixed(1)}). Need more variation for visual hierarchy.`,
        fix: { property: 'font-size', current: `${largest}px / ${smallest}px`, suggested: `${Math.round(smallest * 2)}px / ${smallest}px`, css: `Increase headline to at least ${Math.round(smallest * 2)}px` },
      });
    }

    // Check: no two texts with same size should have very different visual importance (position-based)
    // If the topmost text is smaller than a lower text, the hierarchy is confused
    const byPosition = [...sorted].sort((a, b) => a.y - b.y);
    if (byPosition.length >= 2) {
      const topText = byPosition[0];
      const topSize = topText.fontSize as number;
      // Find the largest text in the bottom half
      const bottomHalf = byPosition.filter(n => n.y > ctx.rootHeight * 0.5);
      for (const btm of bottomHalf) {
        const btmSize = btm.fontSize as number;
        if (btmSize > topSize * 1.3) {
          issues.push({
            rule: 'visual-hierarchy',
            severity: 'info',
            message: `Inverted hierarchy: "${btm.name}" (${btmSize}px) below "${topText.name}" (${topSize}px) is larger. Usually headline goes on top.`,
          });
          break;
        }
      }
    }

    return issues;
  });
}

// ── Content Density ──

/**
 * Check that the design isn't too dense (too much content) or too sparse.
 * For banners: less text is more. A 300x250 with 5 paragraphs is bad.
 */
export function contentDensity(): AuditRule {
  return rule('content-density', (node, ctx) => {
    if (node !== ctx.root) return [];

    const textNodes = collectTextNodes(node);
    const area = ctx.rootWidth * ctx.rootHeight;
    const minDim = Math.min(ctx.rootWidth, ctx.rootHeight);

    // Count total characters
    const totalChars = textNodes.reduce((sum, n) => sum + (n.characters?.length ?? 0), 0);

    // Density = characters per 10,000 pixels
    const density = (totalChars / area) * 10000;

    const issues: AuditIssue[] = [];

    // For small formats (< 500px min dim), density should be low
    if (minDim < 500 && density > 15) {
      issues.push({
        rule: 'content-density',
        severity: 'warning',
        message: `Too much text for ${ctx.rootWidth}x${ctx.rootHeight} format: ${totalChars} chars (density: ${density.toFixed(1)}/10kpx). Reduce text for small formats.`,
      });
    }

    // For tiny formats (< 200px), should have very little text
    if (minDim < 200 && totalChars > 30) {
      issues.push({
        rule: 'content-density',
        severity: 'warning',
        message: `${totalChars} characters is too many for a ${ctx.rootWidth}x${ctx.rootHeight} format. Aim for under 30 characters.`,
      });
    }

    // Too many text nodes for the format
    const maxTextNodes = minDim < 200 ? 2 : minDim < 400 ? 4 : minDim < 800 ? 8 : 15;
    if (textNodes.length > maxTextNodes) {
      issues.push({
        rule: 'content-density',
        severity: 'info',
        message: `${textNodes.length} text elements for ${ctx.rootWidth}x${ctx.rootHeight} — consider fewer, punchier text elements (recommended max: ${maxTextNodes}).`,
      });
    }

    return issues;
  });
}

// ── Visual Balance ──

/**
 * Check that content is reasonably distributed across the frame.
 * Flags designs where everything is crammed into one corner.
 */
export function visualBalance(): AuditRule {
  return rule('visual-balance', (node, ctx) => {
    if (node !== ctx.root) return [];
    if (!node.children) return [];

    const children = [...node.children].filter(c => c.visible !== false && c.opacity !== 0);
    if (children.length < 2) return [];

    // Calculate center of mass of all visible children
    let totalArea = 0;
    let weightedX = 0;
    let weightedY = 0;

    for (const child of children) {
      const area = child.width * child.height;
      const cx = child.x + child.width / 2;
      const cy = child.y + child.height / 2;
      weightedX += cx * area;
      weightedY += cy * area;
      totalArea += area;
    }

    if (totalArea === 0) return [];

    const centerX = weightedX / totalArea;
    const centerY = weightedY / totalArea;

    // How far is the center of mass from the frame center?
    // Use real root dimensions (rootHeight may be Infinity for scrollable pages)
    const realW = ctx.root.width;
    const realH = ctx.root.height;
    const frameCenterX = realW / 2;
    const frameCenterY = realH / 2;

    const offsetX = Math.abs(centerX - frameCenterX) / realW;
    const offsetY = Math.abs(centerY - frameCenterY) / realH;

    const issues: AuditIssue[] = [];

    // Flag if center of mass is > 35% off-center
    if (offsetX > 0.35 || offsetY > 0.35) {
      const direction = offsetX > offsetY
        ? (centerX < frameCenterX ? 'left' : 'right')
        : (centerY < frameCenterY ? 'top' : 'bottom');
      issues.push({
        rule: 'visual-balance',
        severity: 'info',
        message: `Content is heavily weighted to the ${direction}. Consider better distribution for visual balance.`,
      });
    }

    // Check if all content is in one quadrant
    const inTopHalf = children.filter(c => c.y + c.height / 2 < realH / 2).length;
    const inBottomHalf = children.length - inTopHalf;
    if (children.length >= 3 && (inTopHalf === 0 || inBottomHalf === 0)) {
      issues.push({
        rule: 'visual-balance',
        severity: 'info',
        message: `All ${children.length} elements are in the ${inTopHalf > 0 ? 'top' : 'bottom'} half. Use vertical space more evenly.`,
      });
    }

    return issues;
  });
}

// ── CTA Visibility ──

/**
 * Check that button/CTA elements are visually prominent.
 * A CTA should have sufficient size relative to the frame and be accessible.
 */
export function ctaVisibility(): AuditRule {
  return rule('cta-visibility', (node, ctx) => {
    if (node !== ctx.root) return [];

    // Find button-like elements (frames with small area, containing text)
    const buttons = findButtonElements(node);
    if (buttons.length === 0) return [];

    const issues: AuditIssue[] = [];
    // Use real root dimensions (rootHeight may be Infinity for scrollable pages)
    const realWidth = ctx.root.width;
    const realHeight = ctx.root.height;
    const minDim = Math.min(realWidth, realHeight);

    // Detect scrollable / long-page context. If any element extends well past
    // the declared root height, the page is intended to scroll — the clipping
    // check must use the *content* bounds, not the declared frame height.
    let contentBottom = realHeight;
    if (ctx.root.children) {
      const walkBounds = (n: INode) => {
        const bottom = (n.y ?? 0) + (n.height ?? 0);
        if (bottom > contentBottom) contentBottom = bottom;
        if (n.children) for (const c of n.children) walkBounds(c);
      };
      walkBounds(ctx.root);
    }
    const isScrollable = contentBottom > realHeight * 1.25;
    // Use content bottom for vertical clip check when scrollable; still use root
    // width for horizontal (pages rarely scroll sideways).
    const clipBottom = isScrollable ? contentBottom + 5 : realHeight + 5;

    for (const btn of buttons) {
      // CTA should be at least touchable size
      if (btn.width < 40 || btn.height < 20) {
        issues.push({
          rule: 'cta-visibility',
          severity: 'warning',
          message: `CTA "${btn.name}" is too small (${Math.round(btn.width)}x${Math.round(btn.height)}px). Min recommended: 40x20px.`,
          nodeId: btn.id,
          nodeName: btn.name,
        });
      }

      // CTA should have sufficient area relative to frame — but only on fixed-size
      // layouts. Area ratio is meaningless for a 7000px-tall scrollable landing.
      if (!isScrollable) {
        const btnArea = btn.width * btn.height;
        const frameArea = realWidth * realHeight;
        const areaRatio = btnArea / frameArea;
        if (areaRatio < 0.005 && minDim > 200) {
          issues.push({
            rule: 'cta-visibility',
            severity: 'info',
            message: `CTA "${btn.name}" occupies only ${(areaRatio * 100).toFixed(1)}% of frame area. Consider making it more prominent.`,
            nodeId: btn.id,
            nodeName: btn.name,
          });
        }
      }

      // Absolute-positioned elements are intentionally placed outside the
      // normal flow — a "POPULAR" ribbon pinned at `top: -12px` on a pricing
      // card is correct, not broken. Skip the clip check for them. Without
      // this carve-out every authored decoration trips the rule on import.
      if ((btn as any).layoutPositioning === 'ABSOLUTE') continue;

      // CTA shouldn't be fully clipped (outside frame) — use content-bottom on
      // scrollable pages so buttons below the fold don't all register as clipped.
      if (btn.x + btn.width > realWidth + 5 || btn.y + btn.height > clipBottom ||
          btn.x < -5 || btn.y < -5) {
        issues.push({
          rule: 'cta-visibility',
          severity: 'error',
          message: `CTA "${btn.name}" extends outside the frame and may be clipped.`,
          nodeId: btn.id,
          nodeName: btn.name,
        });
      }
    }

    return issues;
  });
}

// ── Min Touch Target ──

/**
 * Check that interactive-looking elements meet WCAG minimum 44×44px touch target.
 * Targets: nodes whose name contains "button", "cta", "btn", "link", "toggle", "checkbox".
 */
export function minTouchTarget(minSize = 44): AuditRule {
  const INTERACTIVE_PATTERNS = /(button|btn|cta|link|toggle|checkbox|radio|switch|tab|action|click|tap|submit)/i;

  return rule('min-touch-target', (node, ctx) => {
    if (node.type === NodeType.Text) return [];
    if (!INTERACTIVE_PATTERNS.test(node.name)) return [];
    if (node.visible === false || node.opacity === 0) return [];

    const issues: AuditIssue[] = [];
    if (node.width < minSize || node.height < minSize) {
      const current = `${Math.round(node.width)}×${Math.round(node.height)}px`;
      issues.push({
        rule: 'min-touch-target',
        severity: 'warning',
        message: `"${node.name}" is ${current} — below ${minSize}×${minSize}px WCAG minimum touch target`,
        nodeId: node.id,
        nodeName: node.name,
        path: ctx.path,
        fix: {
          property: 'min-width/min-height',
          current,
          suggested: `${minSize}×${minSize}px`,
          css: `min-width: ${minSize}px; min-height: ${minSize}px`,
        },
      });
    }
    return issues;
  });
}

// ── Export Fidelity (Roundtrip) ──

/**
 * Detect INode properties that won't survive an HTML export → re-import roundtrip.
 *
 * Catches structural issues like:
 * - Flex containers whose children would lose layout context
 * - Text nodes with missing content
 * - Image fills (not preserved in HTML export)
 * - Gradient fills without gradient stops
 * - Effects with missing offset/radius data
 *
 * Runs only at root: walks the entire tree once.
 */
export function exportFidelity(): AuditRule {
  return rule('export-fidelity', (node, ctx) => {
    if (node !== ctx.root) return [];

    const issues: AuditIssue[] = [];
    const walk = (n: INode, parentLayoutMode?: string) => {
      const name = n.name || n.id;

      // 1. Flex container with children — verify layout properties are coherent
      const layoutMode = (n as any).layoutMode as string | undefined;
      const hasFlexLayout = layoutMode && layoutMode !== 'NONE';

      if (hasFlexLayout && n.children && n.children.length > 0) {
        // Check: primaryAxisAlign should be set (not undefined/null)
        const paa = (n as any).primaryAxisAlign;
        if (!paa || paa === '') {
          issues.push({
            rule: 'export-fidelity',
            severity: 'warning',
            message: `Flex container "${name}" has layoutMode=${layoutMode} but no primaryAxisAlign — justify-content will default to flex-start in export.`,
            nodeId: n.id,
            nodeName: name,
          });
        }
      }

      // 2. Text nodes without text content (skip containers with children)
      if (n.type === NodeType.Text && (!n.children || n.children.length === 0)) {
        const text = (n as any).characters ?? (n as any).text ?? '';
        if (!text || (typeof text === 'string' && text.trim() === '')) {
          issues.push({
            rule: 'export-fidelity',
            severity: 'warning',
            message: `Text node "${name}" has no text content — will render as empty span after export.`,
            nodeId: n.id,
            nodeName: name,
          });
        }
      }

      // 3. Image fills — lost in HTML export (no <img> generation from fills)
      const fills = (n as any).fills as Array<{ type: string; visible: boolean }> | undefined;
      if (fills) {
        for (const fill of fills) {
          if (!fill.visible) continue;
          if (fill.type === 'IMAGE') {
            issues.push({
              rule: 'export-fidelity',
              severity: 'info',
              message: `Node "${name}" has an image fill that won't survive HTML roundtrip — image data is lost on export.`,
              nodeId: n.id,
              nodeName: name,
            });
          }
          // Gradient without stops
          if ((fill.type === 'GRADIENT_LINEAR' || fill.type === 'GRADIENT_RADIAL') && !(fill as any).gradientStops?.length) {
            issues.push({
              rule: 'export-fidelity',
              severity: 'warning',
              message: `Node "${name}" has a ${fill.type} fill with no gradient stops — will be lost in export.`,
              nodeId: n.id,
              nodeName: name,
            });
          }
        }
      }

      // 4. Effects with missing data
      const effects = (n as any).effects as Array<{ type: string; visible: boolean; offset?: any; radius?: number }> | undefined;
      if (effects) {
        for (const effect of effects) {
          if (!effect.visible) continue;
          if ((effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') && !effect.offset) {
            issues.push({
              rule: 'export-fidelity',
              severity: 'warning',
              message: `Node "${name}" has a ${effect.type} effect with no offset — box-shadow will be malformed in export.`,
              nodeId: n.id,
              nodeName: name,
            });
          }
          if (effect.type === 'LAYER_BLUR' || effect.type === 'BACKGROUND_BLUR') {
            issues.push({
              rule: 'export-fidelity',
              severity: 'info',
              message: `Node "${name}" has ${effect.type} — blur effects are not exported to HTML.`,
              nodeId: n.id,
              nodeName: name,
            });
          }
        }
      }

      // 5. Complex stroke properties that simplify in export
      const strokes = (n as any).strokes as Array<{ visible: boolean }> | undefined;
      if (strokes) {
        const visibleStrokes = strokes.filter(s => s.visible);
        if (visibleStrokes.length > 1) {
          issues.push({
            rule: 'export-fidelity',
            severity: 'info',
            message: `Node "${name}" has ${visibleStrokes.length} visible strokes — only the first is preserved in HTML export.`,
            nodeId: n.id,
            nodeName: name,
          });
        }
      }
      if ((n as any).independentStrokeWeights) {
        issues.push({
          rule: 'export-fidelity',
          severity: 'info',
          message: `Node "${name}" has independent stroke weights — simplified to uniform border in HTML export.`,
          nodeId: n.id,
          nodeName: name,
        });
      }

      // 6. Non-zero rotation + flex layout = CSS order-of-operations mismatch
      const rotation = (n as any).rotation as number | undefined;
      if (rotation && rotation !== 0 && hasFlexLayout) {
        issues.push({
          rule: 'export-fidelity',
          severity: 'warning',
          message: `Flex container "${name}" has rotation=${rotation}° — transform on flex containers may render differently after roundtrip.`,
          nodeId: n.id,
          nodeName: name,
        });
      }

      // Recurse
      if (n.children) {
        for (const child of n.children) {
          walk(child, hasFlexLayout ? layoutMode : undefined);
        }
      }
    };

    walk(ctx.root);
    return issues;
  });
}

// ═══ DESIGN SYSTEM DEEP COMPLIANCE ════════════════════════════
// These rules validate INode trees against the full design system
// spec: component specs, font features, spacing scale, interactive states.

// ── Font Features Compliance ──

/**
 * Check that text nodes have correct OpenType font features applied.
 * If the design system specifies ss01/tnum/cv01, text nodes should use them.
 */
export function fontFeaturesCompliance(): AuditRule {
  return rule('font-features-compliance', (node, ctx) => {
    if (node.type !== NodeType.Text) return [];
    if (!ctx.designSystem?.typography?.fontFeatures) return [];
    if (ctx.designSystem.typography.fontFeatures.length === 0) return [];

    const nodeFeatures = (node as any).fontFeatureSettings as string[] | undefined;
    const requiredTags = ctx.designSystem.typography.fontFeatures
      .filter(f => f.scope === 'global' || f.scope === 'heading')
      .map(f => f.tag);

    if (requiredTags.length === 0) return [];

    const missing = requiredTags.filter(tag => !nodeFeatures?.includes(tag));
    if (missing.length === 0) return [];

    return [{
      rule: 'font-features-compliance',
      severity: 'info',
      message: `Text "${truncate(node.characters ?? '', 20)}" is missing font features: ${missing.map(t => `"${t}"`).join(', ')}`,
      nodeId: node.id,
      nodeName: node.name,
      path: ctx.path,
      fix: {
        property: 'font-feature-settings',
        current: nodeFeatures?.length ? nodeFeatures.map(t => `"${t}"`).join(', ') : 'none',
        suggested: requiredTags.map(t => `"${t}"`).join(', '),
        css: `font-feature-settings: ${requiredTags.map(t => `"${t}"`).join(', ')}`,
      },
    }];
  });
}

// ── Spacing Scale Compliance ──

/**
 * Check that padding/gap values snap to the design system spacing scale.
 * Validates itemSpacing, paddingTop/Right/Bottom/Left on layout containers.
 */
export function spacingScaleCompliance(): AuditRule {
  return rule('spacing-scale-compliance', (node, ctx) => {
    if (!ctx.designSystem?.layout?.spacingScale) return [];
    const scale = ctx.designSystem.layout.spacingScale;
    if (scale.length < 3) return [];

    const layoutMode = (node as any).layoutMode;
    if (!layoutMode || layoutMode === 'NONE') return [];

    const issues: AuditIssue[] = [];
    const unit = ctx.designSystem.layout.spacingUnit;
    const sectionRange = ctx.designSystem.layout.sectionPaddingRange;

    // Detect "section-class" containers — direct children of root with full or
    // near-full width and big vertical padding. They legitimately use marketing
    // padding (80–160px) that lives outside the micro spacing scale.
    const isDirectRootChild = node.parent?.id === ctx.root?.id;
    const isFullWidthish = (node.width ?? 0) >= (ctx.root?.width ?? 0) * 0.9;
    const isSectionLike = isDirectRootChild && isFullWidthish && layoutMode !== 'NONE';

    const checkValue = (prop: string, val: number, cssProp: string) => {
      if (val === 0) return;
      // Check if value is in the scale (exact or within 1px)
      const inScale = scale.some(s => Math.abs(val - s) <= 1);
      // Also allow multiples of the spacing unit
      const isGridMultiple = unit > 0 && val % unit === 0;
      // For section-class containers, allow vertical padding within the
      // documented section padding range. Linear DESIGN.md says "Section: pad
      // 80–100" but the parsed spacingScale (1, 4, 7, 8, 11... 35) tops out at
      // 35px, so without this exemption every hero gets crushed.
      const isVerticalSectionPadding =
        isSectionLike &&
        (cssProp === 'padding-top' || cssProp === 'padding-bottom') &&
        sectionRange &&
        val >= sectionRange[0] * 0.9 &&
        val <= sectionRange[1] * 1.25;
      // Horizontal section padding: sites routinely use 40-120px left/right
      // gutters on full-width sections. These live outside the micro spacing
      // scale but are design-legal. Exempt when the container is section-like.
      const isHorizontalSectionPadding =
        isSectionLike &&
        (cssProp === 'padding-left' || cssProp === 'padding-right') &&
        val >= 32 && val <= 160;
      const isSectionPadding = isVerticalSectionPadding || isHorizontalSectionPadding;
      if (!inScale && !isGridMultiple && !isSectionPadding) {
        const closest = scale.reduce((a, b) => Math.abs(b - val) < Math.abs(a - val) ? b : a);
        issues.push({
          rule: 'spacing-scale-compliance',
          severity: 'info',
          message: `${prop}=${val}px on "${node.name}" is not in spacing scale. Nearest: ${closest}px`,
          nodeId: node.id,
          nodeName: node.name,
          path: ctx.path,
          fix: { property: cssProp, current: `${val}px`, suggested: `${closest}px`, css: `${cssProp}: ${closest}px` },
        });
      }
    };

    checkValue('itemSpacing', (node as any).itemSpacing ?? 0, 'gap');
    checkValue('paddingTop', (node as any).paddingTop ?? 0, 'padding-top');
    checkValue('paddingRight', (node as any).paddingRight ?? 0, 'padding-right');
    checkValue('paddingBottom', (node as any).paddingBottom ?? 0, 'padding-bottom');
    checkValue('paddingLeft', (node as any).paddingLeft ?? 0, 'padding-left');

    return issues;
  });
}

// ── Component Spec Compliance ──

/**
 * Check that nodes with semantic roles (button, card, badge, input, nav)
 * have properties matching the design system component specs.
 */
export function componentSpecCompliance(): AuditRule {
  return rule('component-spec-compliance', (node, ctx) => {
    if (!ctx.designSystem?.components) return [];
    const components = ctx.designSystem.components;
    const issues: AuditIssue[] = [];

    const role = (node as any).semanticRole as string | null;
    const name = (node.name ?? '').toLowerCase();

    // Button compliance
    if ((role === 'button' || role === 'cta' || /button|btn|cta/i.test(name)) && components.button) {
      const spec = components.button;
      const cr = node.cornerRadius;
      if (typeof cr === 'number' && cr > 0 && Math.abs(cr - spec.borderRadius) > 2) {
        issues.push({
          rule: 'component-spec-compliance',
          severity: 'info',
          message: `Button "${node.name}" radius ${cr}px doesn't match spec (${spec.borderRadius}px)`,
          nodeId: node.id, nodeName: node.name, path: ctx.path,
          fix: { property: 'border-radius', current: `${cr}px`, suggested: `${spec.borderRadius}px`, css: `border-radius: ${spec.borderRadius}px` },
        });
      }
    }

    // Card compliance
    if ((role === 'card' || /card/i.test(name)) && components.card) {
      const spec = components.card;
      const cr = node.cornerRadius;
      if (typeof cr === 'number' && cr > 0 && Math.abs(cr - spec.borderRadius) > 2) {
        issues.push({
          rule: 'component-spec-compliance',
          severity: 'info',
          message: `Card "${node.name}" radius ${cr}px doesn't match spec (${spec.borderRadius}px)`,
          nodeId: node.id, nodeName: node.name, path: ctx.path,
          fix: { property: 'border-radius', current: `${cr}px`, suggested: `${spec.borderRadius}px`, css: `border-radius: ${spec.borderRadius}px` },
        });
      }
    }

    // Badge compliance
    if ((role === 'badge' || role === 'tag' || /badge|tag|pill/i.test(name)) && components.badge) {
      const spec = components.badge;
      if (node.type === NodeType.Text && spec.fontSize) {
        const fs = node.fontSize;
        if (typeof fs === 'number' && Math.abs(fs - spec.fontSize) > 2) {
          issues.push({
            rule: 'component-spec-compliance',
            severity: 'info',
            message: `Badge text "${node.name}" fontSize ${fs}px doesn't match spec (${spec.fontSize}px)`,
            nodeId: node.id, nodeName: node.name, path: ctx.path,
            fix: { property: 'font-size', current: `${fs}px`, suggested: `${spec.fontSize}px`, css: `font-size: ${spec.fontSize}px` },
          });
        }
      }
    }

    // Input compliance
    if ((role === 'input' || /input|field|form/i.test(name)) && components.input) {
      const spec = components.input;
      const cr = node.cornerRadius;
      if (typeof cr === 'number' && cr > 0 && Math.abs(cr - spec.borderRadius) > 2) {
        issues.push({
          rule: 'component-spec-compliance',
          severity: 'info',
          message: `Input "${node.name}" radius ${cr}px doesn't match spec (${spec.borderRadius}px)`,
          nodeId: node.id, nodeName: node.name, path: ctx.path,
          fix: { property: 'border-radius', current: `${cr}px`, suggested: `${spec.borderRadius}px`, css: `border-radius: ${spec.borderRadius}px` },
        });
      }
      if (spec.height && node.height > 0 && Math.abs(node.height - spec.height) > 4) {
        issues.push({
          rule: 'component-spec-compliance',
          severity: 'info',
          message: `Input "${node.name}" height ${node.height}px doesn't match spec (${spec.height}px)`,
          nodeId: node.id, nodeName: node.name, path: ctx.path,
          fix: { property: 'height', current: `${node.height}px`, suggested: `${spec.height}px`, css: `height: ${spec.height}px` },
        });
      }
    }

    return issues;
  });
}

// ── Interactive State Completeness ──

/**
 * Check that interactive nodes (buttons, links, inputs) have hover states defined.
 * A button without a hover state creates a flat, non-interactive feel.
 */
export function stateCompleteness(): AuditRule {
  return rule('state-completeness', (node, ctx) => {
    const role = (node as any).semanticRole as string | null;
    const name = (node.name ?? '').toLowerCase();
    const isInteractive = role === 'button' || role === 'cta' || role === 'link' || role === 'input'
      || /button|btn|cta|link|input/i.test(name);

    if (!isInteractive) return [];

    const states = (node as any).states as Record<string, unknown> | undefined;
    const hasHover = states && 'hover' in states && states.hover != null;

    if (!hasHover) {
      return [{
        rule: 'state-completeness',
        severity: 'info',
        message: `Interactive element "${node.name}" has no hover state defined`,
        nodeId: node.id,
        nodeName: node.name,
        path: ctx.path,
      }];
    }

    return [];
  });
}

// ─── Semantic-aware rules ──────────────────────────────────────
//
// These rules read `node.semanticRole` (set by the semantic classifier
// during compile/inspect) and enforce role-specific constraints. They
// are additive to the existing name- or shape-based rules: nothing
// fires when a scene has no semantic tags, and they target roles
// directly so they don't fight with classifier-agnostic checks.
//
// All rules silently no-op when classifier hasn't run.

const INTERACTIVE_ROLES = new Set([
  'button', 'cta', 'link', 'input', 'checkbox', 'radio', 'select',
]);

const HEADING_ROLES = new Set(['heading']);

// ── semantic-cta-contrast ──

/**
 * Buttons / CTAs / links must meet WCAG AA contrast (4.5:1 by default) between
 * their label text fill and the button background. Walks each interactive
 * node, finds the first TEXT child, computes contrast against the button's
 * own fill (or its first ancestor with fill), and flags violations.
 *
 * Stricter than the global `contrast-minimum` rule which uses the configurable
 * minContrast (often 3.0 for large text) — interactive elements need 4.5
 * regardless of size to remain reliably readable on tap.
 */
export function semanticCtaContrast(minRatio = 4.5): AuditRule {
  return rule('semantic-cta-contrast', (node, ctx) => {
    if (!node.semanticRole || !INTERACTIVE_ROLES.has(node.semanticRole)) return [];

    // Find first TEXT descendant — that's the label
    let labelNode: INode | null = null;
    const walk = (n: INode): void => {
      if (labelNode) return;
      if (n.type === NodeType.Text) { labelNode = n; return; }
      if (n.children) for (const c of n.children) walk(c);
    };
    if (node.children) for (const c of node.children) walk(c);
    if (!labelNode) return [];

    // Label text fill
    const labelFills = (labelNode as INode).fills;
    if (!labelFills || labelFills === MIXED) return [];
    const labelFill = (labelFills as IPaint[]).find(
      (f: IPaint) => f.type === 'SOLID' && f.visible !== false,
    ) as ISolidPaint | undefined;
    if (!labelFill?.color) return [];

    // Button's own background (preferred) or nearest ancestor with fill
    let bgColor: { r: number; g: number; b: number } | null = null;
    const ownFills = node.fills;
    if (ownFills && ownFills !== MIXED) {
      const own = (ownFills as IPaint[]).find(
        f => f.type === 'SOLID' && f.visible !== false,
      ) as ISolidPaint | undefined;
      if (own?.color) bgColor = own.color;
    }
    if (!bgColor) {
      bgColor = findNearestBackground(node, ctx);
    }
    if (!bgColor) return [];

    const ratio = contrastRatio(labelFill.color, bgColor);
    if (ratio < minRatio) {
      return [{
        rule: 'semantic-cta-contrast',
        severity: 'warning',
        message: `Interactive "${node.name}" (${node.semanticRole}) has contrast ${ratio.toFixed(2)}:1, below WCAG AA ${minRatio}:1 for interactive elements.`,
        nodeId: node.id,
        nodeName: node.name,
        path: ctx.path,
      }];
    }
    return [];
  });
}

// ── semantic-heading-hierarchy ──

/**
 * Headings should descend monotonically by font size in DFS order. A heading
 * larger than the previous heading suggests an out-of-order document outline
 * (h2 → h1 → h2), which screen readers and search engines treat as an error.
 *
 * Implementation note: collected once on root via state map keyed by root.id,
 * then each heading visit checks against the running max.
 */
export function semanticHeadingHierarchy(): AuditRule {
  return rule('semantic-heading-hierarchy', (node, ctx) => {
    // Run once at the root to collect all headings in DFS order
    if (node !== ctx.root) return [];

    interface H { node: INode; fs: number }
    const headings: H[] = [];
    const walk = (n: INode) => {
      if (n.semanticRole && HEADING_ROLES.has(n.semanticRole)) {
        // Find the actual text node — semanticRole may sit on the wrapper
        let fs: number | undefined;
        if (n.type === NodeType.Text) {
          fs = typeof n.fontSize === 'number' ? n.fontSize : undefined;
        } else if (n.children) {
          for (const c of n.children) {
            if (c.type === NodeType.Text && typeof c.fontSize === 'number') {
              fs = c.fontSize; break;
            }
          }
        }
        if (fs && fs > 0) headings.push({ node: n, fs });
      }
      if (n.children) for (const c of n.children) walk(c);
    };
    walk(ctx.root);

    if (headings.length < 2) return [];

    const issues: AuditIssue[] = [];
    let prev = headings[0];
    for (let i = 1; i < headings.length; i++) {
      const cur = headings[i];
      // Allow equal sizes (siblings at same level). Flag any heading larger
      // than the previous one — that's an outline jump up.
      if (cur.fs > prev.fs * 1.05) {
        issues.push({
          rule: 'semantic-heading-hierarchy',
          severity: 'info',
          message: `Heading "${truncate((cur.node as any).characters ?? cur.node.name, 30)}" is ${cur.fs}px after a ${prev.fs}px heading — outline jumps back up.`,
          nodeId: cur.node.id,
          nodeName: cur.node.name,
          path: ctx.path,
        });
      }
      // The new running maximum is the max of fs seen so far at this depth-1
      // level — but we actually want the previous *visited* heading, since
      // that captures DFS order which mirrors visual reading order.
      prev = cur;
    }
    return issues;
  });
}

// ── semantic-caption-readability ──

/**
 * Caption text (disclaimers, legal lines, fine print) must remain readable.
 * Stricter than the global `min-font-size` (default 8px which only catches
 * "browser will refuse to render") — captions specifically need ≥ 9px to
 * stay legible on a real display, and the rule pitches a concrete bump.
 */
export function semanticCaptionReadability(minPx = 9): AuditRule {
  return rule('semantic-caption-readability', (node, ctx) => {
    if (node.semanticRole !== 'caption') return [];
    if (node.type !== NodeType.Text) return [];
    const fs = typeof node.fontSize === 'number' ? node.fontSize : 0;
    if (fs > 0 && fs < minPx) {
      return [{
        rule: 'semantic-caption-readability',
        severity: 'warning',
        message: `Caption "${truncate(node.characters ?? node.name, 30)}" is ${fs}px — below readable minimum ${minPx}px for fine print.`,
        nodeId: node.id,
        nodeName: node.name,
        path: ctx.path,
        fix: { property: 'font-size', current: `${fs}px`, suggested: `${minPx}px`, css: `font-size: ${minPx}px` },
      }];
    }
    return [];
  });
}

// ── semantic-touch-target ──

/**
 * Interactive nodes (button/cta/link/input/checkbox/radio/select) must meet
 * the 44×44px touch-target minimum (WCAG 2.5.5 / Apple HIG). Improvement
 * over `min-touch-target` which matches by name pattern (`/button|btn|cta/`)
 * — semantic mode tags actual roles, so this rule fires on the right nodes
 * even when names are `div-1`, `Frame 42`, etc.
 */
export function semanticTouchTarget(minSize = 44): AuditRule {
  return rule('semantic-touch-target', (node, ctx) => {
    if (!node.semanticRole || !INTERACTIVE_ROLES.has(node.semanticRole)) return [];
    if (node.width >= minSize && node.height >= minSize) return [];
    return [{
      rule: 'semantic-touch-target',
      severity: 'warning',
      message: `Interactive "${node.name}" (${node.semanticRole}) is ${Math.round(node.width)}×${Math.round(node.height)}px — below WCAG ${minSize}×${minSize}px touch target.`,
      nodeId: node.id,
      nodeName: node.name,
      path: ctx.path,
    }];
  });
}

// ── semantic-landmark-presence ──

/**
 * A page-sized scene (height ≥ 600px) should expose at least one landmark
 * region — `header`, `nav`, `main`, `footer`, or `hero`. Without any of
 * these, screen readers have no skip-link targets and SEO indexers cannot
 * identify the document structure. Fires once per scene at the root.
 *
 * Skips small scenes (banners, badges, snippets) where landmark structure
 * is meaningless.
 */
export function semanticLandmarkPresence(): AuditRule {
  const LANDMARK_ROLES = new Set(['header', 'nav', 'main', 'footer', 'hero', 'section']);
  return rule('semantic-landmark-presence', (node, ctx) => {
    if (node !== ctx.root) return [];
    if (ctx.root.height < 600) return [];

    let found = false;
    const walk = (n: INode) => {
      if (found) return;
      if (n.semanticRole && LANDMARK_ROLES.has(n.semanticRole)) { found = true; return; }
      if (n.children) for (const c of n.children) walk(c);
    };
    walk(ctx.root);

    if (found) return [];
    return [{
      rule: 'semantic-landmark-presence',
      severity: 'info',
      message: `Scene has no landmark regions (header / nav / main / hero / section). Screen readers and SEO indexers will see flat content.`,
      nodeId: ctx.root.id,
      nodeName: ctx.root.name,
      path: ctx.path,
    }];
  });
}

// ─── Helpers ───────────────────────────────────────────────────

/** Collect all text nodes in a tree. */
function collectTextNodes(root: INode): INode[] {
  const result: INode[] = [];
  const walk = (node: INode) => {
    if (node.type === NodeType.Text) result.push(node);
    if (node.children) for (const c of node.children) walk(c);
  };
  walk(root);
  return result;
}

/** Find button-like elements: small frames containing text, named "button"/"cta"/"btn". */
function findButtonElements(root: INode): INode[] {
  const buttons: INode[] = [];
  const walk = (node: INode) => {
    // Absolute-positioned decoration (badges, ribbons, pinned chips) is
    // never an interactive CTA — it's authored placement outside the
    // normal flow. Excluding it here stops the cta-visibility clip check
    // from flagging intentional overhang like `top: -12px` pricing
    // ribbons as "extends outside frame".
    if ((node as any).layoutPositioning === 'ABSOLUTE') {
      if (node.children) for (const c of node.children) walk(c);
      return;
    }
    if (node.type === NodeType.Frame || node.type === NodeType.Instance) {
      const name = (node.name ?? '').toLowerCase();
      // Must contain a TEXT child with enough content to be a real label.
      // Single character ("F", "×", "1") or very short strings indicate an icon,
      // badge, avatar, or logo lozenge — not an interactive CTA.
      const textChildren = (node.children ?? []).filter(c => c.type === NodeType.Text);
      const labelText = textChildren.map(c => (c as any).characters ?? (c as any).text ?? '').join(' ').trim();
      const hasMeaningfulLabel = labelText.length >= 3 && /[A-Za-z]/.test(labelText);

      // Rough sizing sanity: CTA should not dominate the screen, but also should
      // not be tiny (avatars 24×24, tiny icons 16×16 are not CTAs).
      // Absolute 80×24 floor: on a 1440×6000 landing page the relative check
      // (width < 0.6·root, height < 0.4·root) lets 40×24 chips through and a
      // real Stripe-style 96×32 CTA gets lost in the noise of false positives.
      // Anchoring the minimum in absolute pixels keeps detection stable across
      // tiny banners and long landing pages.
      const isSmall = node.width < root.width * 0.6 && node.height < root.height * 0.4;
      const isButtonSized = node.width >= 80 && node.height >= 24;

      // Must either be explicitly named like a button OR actually look+behave like
      // one: rounded corners AND a meaningful label AND button-sized.
      const namedLikeButton = /button|btn|cta/i.test(name);
      const shapedLikeButton =
        node.cornerRadius != null &&
        typeof node.cornerRadius === 'number' &&
        node.cornerRadius > 0 &&
        hasMeaningfulLabel &&
        isButtonSized;

      if (isSmall && hasMeaningfulLabel && (namedLikeButton || shapedLikeButton)) {
        buttons.push(node);
      }
    }
    if (node.children) for (const c of node.children) walk(c);
  };
  walk(root);
  return buttons;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function r255(v: number): number {
  return Math.round(v * 255);
}

/** Parse hex palette from design system roles map. */
function parsePalette(roles: Map<string, string>): Array<{ r: number; g: number; b: number }> {
  const result: Array<{ r: number; g: number; b: number }> = [];
  for (const hex of roles.values()) {
    const h = hex.replace('#', '');
    if (h.length < 6) continue;
    const n = parseInt(h.slice(0, 6), 16);
    result.push({
      r: ((n >> 16) & 0xFF) / 255,
      g: ((n >> 8) & 0xFF) / 255,
      b: (n & 0xFF) / 255,
    });
  }
  return result;
}

/** WCAG relative luminance. */
function luminance(c: { r: number; g: number; b: number }): number {
  const f = (v: number) => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** WCAG contrast ratio between two colors. */
function contrastRatio(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): number {
  const la = luminance(a);
  const lb = luminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Perceptual color distance (CIE76 ΔE in approximate Lab space).
 *  Input r,g,b in 0–1 range. Returns a value where <5 is imperceptible. */
function deltaE(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  // Linearize sRGB → approximate Lab via simple gamma + weighted euclidean
  const toLinear = (v: number) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const ar = toLinear(a.r) * 255, ag = toLinear(a.g) * 255, ab = toLinear(a.b) * 255;
  const br = toLinear(b.r) * 255, bg = toLinear(b.g) * 255, bb = toLinear(b.b) * 255;
  // Weighted euclidean (redmean approximation for perceptual distance)
  const rmean = (ar + br) / 2;
  const dr = ar - br, dg = ag - bg, db = ab - bb;
  return Math.sqrt((2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db);
}

/**
 * Find the closest typography rule by font size. When a weight hint is
 * supplied and multiple roles share the same size (e.g. Apple has Card Title
 * weight 700 AND Sub-heading weight 400 both at 21px), prefer the role whose
 * weight is closest to the hint. Without this, the first-declared role wins
 * and valid bold text at that size gets "fixed" to regular — or vice versa.
 */
function findClosestTypoRule(
  hierarchy: Array<{ role: string; fontSize: number; fontWeight: number }>,
  fontSize: number,
  weightHint?: number,
): { role: string; fontSize: number; fontWeight: number } | null {
  if (hierarchy.length === 0) return null;
  let bestSizeDist = Infinity;
  for (const r of hierarchy) {
    const d = Math.abs(fontSize - r.fontSize);
    if (d < bestSizeDist) bestSizeDist = d;
  }
  const candidates = hierarchy.filter(r => Math.abs(fontSize - r.fontSize) === bestSizeDist);
  if (candidates.length === 1 || weightHint === undefined) return candidates[0];
  let best = candidates[0];
  let bestWeightDist = Math.abs(weightHint - best.fontWeight);
  for (const r of candidates) {
    const d = Math.abs(weightHint - r.fontWeight);
    if (d < bestWeightDist) { bestWeightDist = d; best = r; }
  }
  return best;
}

/** Convert font style name to weight number. */
function styleToWeight(style: string): number {
  const lower = style.toLowerCase();
  if (/\bthin\b/.test(lower)) return 100;
  if (/\bextra\s*light\b/.test(lower)) return 200;
  if (/\blight\b/.test(lower)) return 300;
  if (/\bregular\b|^normal$/.test(lower)) return 400;
  if (/\bmedium\b/.test(lower)) return 500;
  if (/\bsemi\s*bold\b/.test(lower)) return 600;
  if (/\bbold\b/.test(lower) && !/\bsemi/.test(lower) && !/\bextra/.test(lower)) return 700;
  if (/\bextra\s*bold\b/.test(lower)) return 800;
  if (/\bblack\b/.test(lower)) return 900;
  // Try extracting number from style like "Weight 510"
  const m = style.match(/\b(\d{3})\b/);
  if (m) return parseInt(m[1], 10);
  return 400;
}

/** Find the closest palette color to a given RGB color. Returns role name + hex. */
function findClosestPaletteColor(
  c: { r: number; g: number; b: number },
  roles: Map<string, string>,
): { role: string; hex: string } | null {
  let best: { role: string; hex: string } | null = null;
  let bestDist = Infinity;

  for (const [role, hex] of roles) {
    const h = hex.replace('#', '');
    if (h.length < 6) continue;
    const n = parseInt(h.slice(0, 6), 16);
    const pr = ((n >> 16) & 0xFF) / 255;
    const pg = ((n >> 8) & 0xFF) / 255;
    const pb = (n & 0xFF) / 255;
    const dist = Math.sqrt((c.r - pr) ** 2 + (c.g - pg) ** 2 + (c.b - pb) ** 2);
    if (dist < bestDist) {
      bestDist = dist;
      best = { role, hex };
    }
  }
  return best;
}
