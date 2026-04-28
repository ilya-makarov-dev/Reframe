/**
 * HTML/CSS Exporter — Scene Graph → HTML + inline CSS
 *
 * Converts a reframe scene into a self-contained HTML document
 * with absolute-positioned divs that mirror the design layout.
 */

import type { SceneGraph } from '../engine/scene-graph';
import type { SceneNode, Color, Fill, Stroke, Effect, GradientTransform, StateOverride, ResponsiveRule, TokenBindings } from '../engine/types';
import type { AnnotationNode } from '../engine/annotation';
import {
  resolveAnchorPoint,
  resolveAnnotationColor,
  resolveAnnotationStyle,
} from '../engine/annotation';
import { computeAbsolutePosition } from '../engine/geometry';
import type { DesignSystem } from '../design-system/types';
import type { ITimeline } from '../animation/types';
import { timelineToCss } from '../animation/to-css';
import { collectCssTokens, tokenToCssVar } from '../design-system/tokens';
import { semanticTag, ariaRole, headingLevel } from '../semantic';
import {
  MOUSE_REACTIVE_RUNTIME_SOURCE,
  MOUSE_REACTIVE_CSS,
} from '../engine/interactive/mouse-reactive-runtime';
import {
  TEXT_ENTRANCE_RUNTIME_SOURCE,
  entranceCssFor,
} from '../engine/text-entrance/text-entrance-runtime';
import {
  shouldRenderAsSvg,
  shouldRenderTextAsSvg,
  isIconLikeFrame,
  renderNodePrimitive,
  renderTextAsSvg,
  wrapPrimitiveSvg,
  renderIconFrameSvg,
} from './svg-primitives';

/** Convert gradientTransform matrix back to CSS angle in degrees. */
function gradientTransformToAngle(t: GradientTransform): number {
  const rad = Math.atan2(t.m01, t.m00);
  return ((rad * 180 / Math.PI) + 90 + 360) % 360;
}

/**
 * System / generic font families that should NEVER trigger a Google Fonts
 * <link> emission. Requesting these returns 404 from the CDN and wastes a
 * fetch round-trip; they're already available in the OS / browser.
 */
const SYSTEM_FONT_FAMILIES = new Set<string>([
  'system-ui',
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'ui-rounded',
  '-apple-system',
  'blinkmacsystemfont',
  'inherit',
  'initial',
  'unset',
]);

/**
 * Guard against emitting Google Fonts <link> tags for obviously-invalid font names.
 * This catches parser mis-extractions (e.g. "typeface for headings", "primary sans font")
 * and generic descriptors that would produce a 400 from fonts.googleapis.com.
 *
 * Heuristics (reject if ANY):
 *  - Contains generic descriptor words ("typeface", "font", "family", "for", "the", "with", "heading", "display")
 *  - Contains more than 3 whitespace-separated tokens
 *  - Contains characters that can't appear in a real font name (commas, quotes, parens, slashes, digits-at-start)
 *  - Empty, only whitespace, or shorter than 2 chars
 */
export function isPlausibleWebFontName(family: string): boolean {
  const name = family.trim();
  if (name.length < 2 || name.length > 64) return false;
  if (!/^[A-Za-z]/.test(name)) return false;
  if (/[,"'`()/\\]/.test(name)) return false;
  const tokens = name.split(/\s+/);
  if (tokens.length > 3) return false;
  if (/\b(?:typeface|font|family|for|the|with|heading|headings|display|primary|secondary|body|regular|fallback|stack)\b/i.test(name)) return false;
  return true;
}

/**
 * Pick a meaningful document title from the scene. Walks the tree in
 * DFS order and returns the first TEXT node tagged `heading` or the
 * first h1/title role frame's inner text. Falls back to null when
 * nothing matches, which the caller replaces with the raw root name.
 */
function findDocumentTitle(graph: SceneGraph, rootId: string): string | null {
  let found = '';
  const walk = (id: string): boolean => {
    const n = graph.getNode(id);
    if (!n) return false;
    const role = (n as any).semanticRole;
    if (n.type === 'TEXT' && (role === 'heading' || role === 'title') && n.text) {
      found = n.text.trim();
      return true;
    }
    // h1/h2 tags get named "h1"/"h2" by the importer — use that as a
    // signal too in case the semantic classifier didn't tag them.
    if (/^h[1-2]$/.test(n.name ?? '')) {
      for (const cid of n.childIds) {
        const c = graph.getNode(cid);
        if (c?.type === 'TEXT' && c.text) {
          found = c.text.trim();
          return true;
        }
      }
    }
    for (const cid of n.childIds) {
      if (walk(cid)) return true;
    }
    return false;
  };
  walk(rootId);
  return found.length > 0 ? found : null;
}

export interface HtmlExportOptions {
  /** Include a full HTML document wrapper (default: true) */
  fullDocument?: boolean;
  /** Include node names as data attributes (default: false) */
  dataAttributes?: boolean;
  /** Emit `data-reframe-inode="<id>"` on every element for annotation
   *  anchoring. Cleaner than `dataAttributes` when the consumer only
   *  needs the INode id (e.g. Platform preview with injected hover
   *  tracking). Default: false. */
  inodeAnchors?: boolean;
  /** Use CSS classes instead of inline styles (default: false) */
  cssClasses?: boolean;
  /** CSS class prefix (default: 'rf-') */
  classPrefix?: string;
  /** Include responsive meta viewport (default: true) */
  responsive?: boolean;
  /**
   * Phase 3b: active DesignSystem. When provided, any node carrying
   * `meta.tokenBindings` will have those properties emitted as CSS custom
   * properties referencing a `:root` block at the top of the document.
   *
   * Example: a button with `meta.tokenBindings.fill = "primary"` and the DS
   * primary color `#533afd` emits `background: var(--color-primary)` instead
   * of the hardcoded hex, plus a `:root { --color-primary: #533afd; }`
   * definition. Change the DS primary → re-export → whole document re-themes
   * without touching individual fills.
   */
  designSystem?: DesignSystem;

  /**
   * Hybrid SVG rendering. When true (default), vector primitives
   * (ELLIPSE, STAR, POLYGON, LINE, VECTOR) and RECTANGLE/FRAME nodes
   * with features HTML can't express (dashed strokes, non-uniform
   * rounded corners) are emitted as inline `<svg>` elements instead
   * of `<div>` with CSS. Icon-like FRAMES (small, vector-only children)
   * collapse into a single `<svg>` with nested shapes for maximum
   * fidelity.
   *
   * The standard HTML path is used for everything else (layout
   * containers, text, images). Failures fall back gracefully to the
   * div path without throwing.
   *
   * Default: true. Set false to force the legacy pure-HTML path for
   * consumers that want no SVG in the output.
   */
  svgDecorations?: boolean;
}

// ─── Phase 3b: meta.tokenBindings → CSS vars ─────────────────

interface Phase3VarTables {
  /** node id → { fill: '--color-primary', ... } */
  byNode: Map<string, Map<keyof TokenBindings, string>>;
  /** CSS var name → hex/value for the :root block */
  rootVars: Map<string, string>;
}

/**
 * Walk the scene and collect every `node.meta.tokenBindings` into two maps:
 *  (a) per-node lookup so renderNode can emit `var(--color-primary)` in
 *      place of the hardcoded value, and
 *  (b) a flat `:root` variable block resolved against the DS.
 *
 * A token that has no match in the DS (e.g. scene saved against a brand that
 * was since deleted) is silently skipped — the hardcoded fallback on the
 * node stays, and the agent gets graceful degradation instead of a missing
 * CSS variable in devtools.
 */
function collectPhase3Tokens(
  graph: SceneGraph,
  rootId: string,
  ds: DesignSystem,
): Phase3VarTables {
  const byNode = new Map<string, Map<keyof TokenBindings, string>>();
  const rootVars = new Map<string, string>();

  function resolveColor(role: string): string | undefined {
    // Priority: explicit shortcut (primary/background/text/accent), then roles map.
    if (role === 'primary' && ds.colors.primary) return ds.colors.primary;
    if (role === 'background' && ds.colors.background) return ds.colors.background;
    if (role === 'text' && ds.colors.text) return ds.colors.text;
    if (role === 'accent' && ds.colors.accent) return ds.colors.accent;
    return ds.colors.roles?.get(role);
  }
  function resolveFontSize(role: string): number | undefined {
    const rule = ds.typography.hierarchy.find(r => r.role === role);
    return rule?.fontSize;
  }
  function resolveFontFamily(slot: string): string | undefined {
    if (slot === 'primary') return ds.typography.primaryFont;
    if (slot === 'secondary') return ds.typography.secondaryFont;
    return undefined;
  }
  function resolveRadius(idxStr: string): number | undefined {
    const idx = parseInt(idxStr, 10);
    if (!Number.isFinite(idx)) return undefined;
    return ds.layout?.borderRadiusScale?.[idx];
  }

  function visit(id: string): void {
    const n = graph.getNode(id);
    if (!n) return;
    const bindings = n.meta?.tokenBindings;
    if (bindings && Object.keys(bindings).length > 0) {
      const fieldMap = new Map<keyof TokenBindings, string>();

      if (bindings.fill) {
        const hex = resolveColor(bindings.fill);
        if (hex) {
          const varName = `--color-${bindings.fill}`;
          rootVars.set(varName, hex);
          fieldMap.set('fill', varName);
        }
      }
      if (bindings.stroke) {
        const hex = resolveColor(bindings.stroke);
        if (hex) {
          const varName = `--color-${bindings.stroke}`;
          rootVars.set(varName, hex);
          fieldMap.set('stroke', varName);
        }
      }
      if (bindings.fontSize) {
        const px = resolveFontSize(bindings.fontSize);
        if (px !== undefined) {
          const varName = `--font-size-${bindings.fontSize}`;
          rootVars.set(varName, `${px}px`);
          fieldMap.set('fontSize', varName);
        }
      }
      if (bindings.fontFamily) {
        const fam = resolveFontFamily(bindings.fontFamily);
        if (fam) {
          const varName = `--font-family-${bindings.fontFamily}`;
          rootVars.set(varName, `'${fam}', sans-serif`);
          fieldMap.set('fontFamily', varName);
        }
      }
      if (bindings.cornerRadius) {
        const r = resolveRadius(bindings.cornerRadius);
        if (r !== undefined) {
          const varName = `--radius-${bindings.cornerRadius}`;
          rootVars.set(varName, `${r}px`);
          fieldMap.set('cornerRadius', varName);
        }
      }

      if (fieldMap.size > 0) byNode.set(id, fieldMap);
    }
    for (const cid of n.childIds) visit(cid);
  }
  visit(rootId);
  return { byNode, rootVars };
}

/**
 * Export a scene graph node to HTML + CSS.
 */
export function exportToHtml(
  graph: SceneGraph,
  rootId: string,
  options: HtmlExportOptions = {},
): string {
  const root = graph.getNode(rootId);
  if (!root) throw new Error(`Node ${rootId} not found`);

  const fullDoc = options.fullDocument ?? true;
  const dataAttrs = options.dataAttributes ?? false;
  const inodeAnchors = options.inodeAnchors ?? false;
  const useCssClasses = options.cssClasses ?? false;
  const prefix = options.classPrefix ?? 'rf-';
  const svgDecorations = options.svgDecorations ?? true;

  const classes: Map<string, string> = new Map();
  let classCounter = 0;
  // T2 #27 — flips when any node carries meta.interactive. Drives whether
  // the runtime IIFE + glow CSS get injected at scene level. Single
  // injection per scene regardless of how many interactive nodes exist
  // (one document-level mousemove handler covers all of them).
  let sceneHasInteractive = false;
  // T2 #32 — collects entrance.type values used in the scene. CSS for
  // unused types is omitted (subset emission). Single runtime IIFE
  // when the set is non-empty.
  const sceneEntranceTypes = new Set<string>();

  function getClassName(): string {
    return `${prefix}${classCounter++}`;
  }

  // Collect CSS custom properties from token bindings (used in :root and per-node var())
  const cssTokens = collectCssTokens(graph, rootId);

  // Build a lookup of node → field → CSS variable name for token-bound properties
  const tokenVarLookup = new Map<string, Map<string, string>>();
  if (cssTokens.size > 0) {
    function buildTokenLookup(nodeId: string) {
      const n = graph.getNode(nodeId);
      if (!n) return;
      const bindings = n.boundVariables;
      if (Object.keys(bindings).length > 0) {
        const fieldMap = new Map<string, string>();
        for (const [field, varId] of Object.entries(bindings)) {
          const variable = graph.variables.get(varId);
          if (variable) fieldMap.set(field, tokenToCssVar(variable.name));
        }
        if (fieldMap.size > 0) tokenVarLookup.set(nodeId, fieldMap);
      }
      for (const cid of n.childIds) buildTokenLookup(cid);
    }
    buildTokenLookup(rootId);
  }

  // ── Phase 3b: meta.tokenBindings → additional CSS vars ─────
  // These live alongside the legacy boundVariables lookup. When a node has
  // both (unusual — only when auto-bind ran on an already-tokenized scene),
  // the phase-3 binding wins because it's registered AFTER the legacy one.
  if (options.designSystem) {
    const { byNode, rootVars } = collectPhase3Tokens(graph, rootId, options.designSystem);
    for (const [varName, value] of rootVars) {
      cssTokens.set(varName, value);
    }
    for (const [nodeId, fields] of byNode) {
      const existing = tokenVarLookup.get(nodeId) ?? new Map<string, string>();
      if (fields.has('fill')) existing.set('fills[0].color', fields.get('fill')!);
      if (fields.has('stroke')) existing.set('strokes[0].color', fields.get('stroke')!);
      if (fields.has('fontSize')) existing.set('fontSize', fields.get('fontSize')!);
      if (fields.has('fontFamily')) existing.set('fontFamily', fields.get('fontFamily')!);
      if (fields.has('cornerRadius')) existing.set('cornerRadius', fields.get('cornerRadius')!);
      tokenVarLookup.set(nodeId, existing);
    }
  }

  // Collect behavior CSS: state pseudo-classes and responsive media queries
  const behaviorStyles: string[] = [];
  let behaviorNodeCounter = 0;

  function collectBehaviorCss(nodeId: string) {
    const n = graph.getNode(nodeId);
    if (!n) return;

    const hasStates = n.states && Object.keys(n.states).length > 0;
    const hasResponsive = n.responsive && n.responsive.length > 0;

    if (hasStates || hasResponsive) {
      const cls = `rf-b${behaviorNodeCounter++}`;
      behaviorClassMap.set(nodeId, cls);

      // State pseudo-classes
      if (hasStates) {
        const stateMap: Record<string, string> = {
          hover: ':hover', active: ':active', focus: ':focus',
          disabled: '[disabled]', selected: '[aria-selected="true"]',
        };
        for (const [state, override] of Object.entries(n.states!)) {
          const pseudo = stateMap[state] ?? `:${state}`;
          const cssProps = stateOverrideToCss(override as StateOverride);
          if (cssProps.length > 0) {
            const transition = (override as StateOverride).transition ?? 150;
            behaviorStyles.push(`.${cls}${pseudo} { ${cssProps.join('; ')} }`);
            // Add transition to base element
            if (!behaviorTransitions.has(cls)) {
              behaviorTransitions.set(cls, `transition: all ${transition}ms ease`);
            }
          }
        }
      }

      // Responsive media queries
      if (hasResponsive) {
        for (const rule of n.responsive!) {
          const cssProps = responsiveRuleToCss(rule);
          if (cssProps.length > 0) {
            behaviorStyles.push(`@media (max-width: ${rule.maxWidth}px) { .${cls} { ${cssProps.join('; ')} } }`);
          }
        }
      }
    }

    for (const cid of n.childIds) collectBehaviorCss(cid);
  }

  const behaviorClassMap = new Map<string, string>();
  const behaviorTransitions = new Map<string, string>();
  collectBehaviorCss(rootId);

  // ── Phase 5: timeline → @keyframes + class rules ──────────
  // Runs BEFORE autoInteractiveHover so animatedNodeIds is populated when
  // the auto-hover heuristic decides to skip animated nodes (Bug #6 fix).
  const animatedNodeIds = new Set<string>();
  const timelineForCss = (graph as any).timeline as ITimeline | null;
  if (timelineForCss && timelineForCss.animations?.length > 0) {
    const cssResult = timelineToCss(timelineForCss);
    if (cssResult.keyframes) behaviorStyles.push(cssResult.keyframes);
    for (const rule of cssResult.classRules.values()) behaviorStyles.push(rule);
    for (const [nodeId, animClasses] of cssResult.perNodeClasses) {
      animatedNodeIds.add(nodeId);
      const existing = behaviorClassMap.get(nodeId);
      const merged = existing ? `${existing} ${animClasses.join(' ')}` : animClasses.join(' ');
      behaviorClassMap.set(nodeId, merged);
    }
  }

  // Auto-add hover for interactive elements (buttons, links) that don't have explicit states.
  // Phase 5b Bug #6: skip nodes that already carry an animation. The
  // auto-hover `transform: translateY(-1px)` would otherwise fight the
  // animation's keyframe transform at pseudo-class specificity, silently
  // cancelling keyframe transforms on hover. Explicit `n.states.hover`
  // still runs via collectBehaviorCss.
  function autoInteractiveHover(nodeId: string) {
    const n = graph.getNode(nodeId);
    if (!n) return;
    const role = n.semanticRole;
    const isInteractive = role === 'button' || role === 'link' || role === 'cta'
      || n.name === 'Button' || n.name === 'CTA' || n.name === 'NavItem' || n.name === 'Link';
    if (isInteractive && !behaviorClassMap.has(nodeId) && !animatedNodeIds.has(nodeId)) {
      const cls = `rf-b${behaviorNodeCounter++}`;
      behaviorClassMap.set(nodeId, cls);
      behaviorStyles.push(`.${cls}:hover { opacity: 0.85; transform: translateY(-1px) }`);
      behaviorTransitions.set(cls, 'transition: all 150ms ease');
    }
    for (const cid of n.childIds) autoInteractiveHover(cid);
  }
  autoInteractiveHover(rootId);

  function renderNode(
    node: SceneNode,
    isRoot: boolean,
    parentLayout?: string,
    parentInteractive: boolean = false,
    parentCounterAlign?: string,
  ): string {
    // Root is often an invisible “artboard” frame; still export children for HTML round-trip / Studio MCP.
    if (!node.visible && !isRoot) return '';

    // Semantic tag selection
    let tag: string;
    if (node.semanticRole === 'heading' && node.type === 'TEXT') {
      tag = headingLevel(node.fontSize || 16) ?? 'h2';
    } else {
      tag = semanticTag(node.semanticRole, node.type);
    }
    // HTML validity: <button>, <a>, and other interactive elements may only
    // contain phrasing content. <p>, <h1>-<h6>, <section>, <small> nested
    // inside them produce invalid markup that browsers auto-recover from
    // by closing the parent early — visually breaking the layout. When the
    // ancestor chain has flagged itself interactive, force any non-phrasing
    // tag down to <span>. The CSS layout still works because the inline
    // styles set display/flex behaviour explicitly on every element.
    if (parentInteractive) {
      const NON_PHRASING = new Set([
        'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article',
        'aside', 'header', 'footer', 'nav', 'main', 'small',
      ]);
      if (NON_PHRASING.has(tag)) tag = 'span';
    }

    const tokenVars = tokenVarLookup.get(node.id);
    // Check once here whether any direct child is absolute-positioned;
    // if so, `computeStyles` will emit `position: relative` so the
    // child's left/top resolve against us instead of escaping to the
    // nearest positioned ancestor (typically the root).
    const hasAbsoluteChild = node.childIds.some(cid => {
      const child = graph.getNode(cid);
      return child?.layoutPositioning === 'ABSOLUTE';
    });
    const styles = computeStyles(node, isRoot, parentLayout, tokenVars, hasAbsoluteChild, parentCounterAlign);

    // Add transition CSS if this node has behavior states
    const behaviorCls = behaviorClassMap.get(node.id);
    const transitionCss = behaviorCls ? behaviorTransitions.get(behaviorCls) : undefined;
    const fullStyles = transitionCss ? `${styles}; ${transitionCss}` : styles;

    const attrs: string[] = [];

    if (useCssClasses) {
      const className = getClassName();
      classes.set(className, fullStyles);
      const allClasses = behaviorCls ? `${className} ${behaviorCls}` : className;
      attrs.push(`class="${allClasses}"`);
    } else {
      attrs.push(`style="${fullStyles}"`);
      if (behaviorCls) attrs.push(`class="${behaviorCls}"`);
    }

    // Navigation link
    if (node.href) {
      tag = 'a';
      attrs.push(`href="${escapeHtml(node.href)}"`);
      if (node.href.startsWith('http')) attrs.push('target="_blank" rel="noopener"');
      // Hash links get data-nav-link for router active state tracking
      if (node.href.startsWith('#')) {
        attrs.push(`data-nav-link="${escapeHtml(node.href.slice(1))}"`);
      }
    }

    // ARIA role attribute
    const aria = ariaRole(node.semanticRole);
    if (aria && tag !== 'a') attrs.push(`role="${aria}"`);

    // Content slot data attribute
    if (node.slot) attrs.push(`data-slot="${escapeHtml(node.slot)}"`);

    // Content slots exposed by this node (for component consumers)
    if (node.contentSlots.length > 0) {
      const slotNames = node.contentSlots.map(s => s.name).join(',');
      attrs.push(`data-content-slots="${escapeHtml(slotNames)}"`);
    }

    if (dataAttrs) {
      attrs.push(`data-id="${node.id}"`);
      attrs.push(`data-name="${escapeHtml(node.name)}"`);
      attrs.push(`data-type="${node.type}"`);
      if (node.semanticRole) attrs.push(`data-role="${node.semanticRole}"`);
    }
    // Phase 8 — INode anchor for annotation system. Kept distinct from
    // user-authorable data-id so there's no collision risk with source
    // HTML that happens to use data-id for other purposes.
    if (inodeAnchors) {
      attrs.push(`data-reframe-inode="${node.id}"`);
    }

    // T2 #27 — mouse-reactive interactive metadata. Re-emit data-* attrs
    // from the typed structure (importer extracted them, exporter puts
    // them back). Companion runtime IIFE is injected once per scene
    // when sceneHasInteractive flag flips during the walk.
    if (node.meta?.interactive) {
      sceneHasInteractive = true;
      const interactive = node.meta.interactive;
      attrs.push(`data-reframe-interactive="${escapeHtml(interactive.type)}"`);
      // Inline JSON config — runtime parses on attach. Smaller than N
      // separate data-reframe-* attrs, easier for the runtime, and
      // round-trips cleanly via JSON.parse.
      const cfgStr = JSON.stringify(interactive.config);
      attrs.push(`data-reframe-interactive-config='${cfgStr.replace(/'/g, '&apos;')}'`);
    }

    // T2 #32 — text entrance animation metadata. Same shape as
    // interactive: data-reframe-entrance + JSON config blob. Runtime
    // IIFE attaches IntersectionObserver per element, splits + animates
    // on viewport entry. CSS keyframes for entrance.type emitted at
    // scene level (subset of the 4 known types).
    if (node.meta?.entrance) {
      sceneEntranceTypes.add(node.meta.entrance.type);
      const entrance = node.meta.entrance;
      attrs.push(`data-reframe-entrance="${escapeHtml(entrance.type)}"`);
      const cfgStr = JSON.stringify(entrance.config);
      attrs.push(`data-reframe-entrance-config='${cfgStr.replace(/'/g, '&apos;')}'`);
    }

    const attrStr = attrs.join(' ');

    // Text node
    if (node.type === 'TEXT' && node.text) {
      // Stroked/outlined text → SVG (HTML has no cross-browser text
      // stroke; `-webkit-text-stroke` is Chromium-only and inconsistent).
      if (svgDecorations && shouldRenderTextAsSvg(node)) {
        try {
          const svg = renderTextAsSvg(node);
          return `<${tag} ${attrStr}>${svg}</${tag}>`;
        } catch { /* fall through to HTML text */ }
      }
      // Rich text: render styleRuns as <span> per range
      if (node.styleRuns.length > 0) {
        const richHtml = renderStyleRuns(node.text, node.styleRuns);
        return `<${tag} ${attrStr}>${richHtml}</${tag}>`;
      }
      const textHtml = escapeHtml(node.text).replace(/\n/g, '<br/>');
      return `<${tag} ${attrStr}>${textHtml}</${tag}>`;
    }

    // Self-closing tags. Image src lives on fills[0].imageHash (set by the
    // HTML importer at line 3120) — preserve it back to the rendered tag
    // so the image actually loads + bundle exporter can find URLs to inline.
    if (tag === 'img') {
      const imgFill = (node.fills ?? []).find((f: any) => f && f.type === 'IMAGE' && typeof f.imageHash === 'string');
      const src = imgFill ? ` src="${escapeHtml(String((imgFill as any).imageHash))}"` : '';
      return `<${tag} ${attrStr}${src} alt="${escapeHtml(node.name)}" />`;
    }

    // ─── Hybrid SVG rendering ──────────────────────────
    //
    // Vector primitives (ELLIPSE, STAR, POLYGON, LINE, VECTOR) and
    // icon-like FRAMEs (small, vector-only descendants) get rendered
    // as inline SVG for fidelity. Everything else falls through to
    // the standard HTML path below. Wrapped in try/catch so any
    // failure in the SVG generator doesn't take down the whole
    // export — graceful fallback is important for first-run stability.
    if (svgDecorations && !isRoot) {
      // Raw SVG passthrough — the importer preserved the exact SVG
      // markup on VECTOR nodes that came from `<svg>` sources, so we
      // can emit it back 1:1. This is the only path that correctly
      // renders complex icons with `<linearGradient>`, `<path>`, and
      // gradient-by-id fill references — everything else falls back to
      // primitives that can't express those.
      const rawSvg = (node.meta as any)?.svgMarkup as string | undefined;
      if (node.type === 'VECTOR' && rawSvg) {
        return `<${tag} ${attrStr}>${rawSvg}</${tag}>`;
      }

      try {
        // Resolve fill/stroke token vars up-front so the SVG primitive
        // can reference them instead of hard-coded colors.
        const fillVar = tokenVars?.get('fills[0].color');
        const strokeVar = tokenVars?.get('strokes[0].color');
        const fillVarCss = fillVar ? `var(${fillVar})` : undefined;
        const strokeVarCss = strokeVar ? `var(${strokeVar})` : undefined;

        // Icon-like FRAME collapse — render whole subtree as single SVG
        if (isIconLikeFrame(node, id => graph.getNode(id))) {
          const svg = renderIconFrameSvg(
            node,
            id => graph.getNode(id),
            (nodeId, field) => {
              const vars = tokenVarLookup.get(nodeId);
              const name = vars?.get(field);
              return name ? `var(${name})` : undefined;
            },
          );
          // Wrap in a div so the parent's layout (flex/grid) still
          // positions this node. Styles on the div control size,
          // margin, padding, etc; the SVG fills 100% of it.
          return `<${tag} ${attrStr}>${svg}</${tag}>`;
        }

        // Per-node SVG for vector primitives + complex rects
        if (shouldRenderAsSvg(node)) {
          const w = node.width ?? 0;
          const h = node.height ?? 0;
          if (w > 0 && h > 0) {
            const inner = renderNodePrimitive(node, { width: w, height: h, fillVar: fillVarCss, strokeVar: strokeVarCss });
            const svg = wrapPrimitiveSvg(inner, w, h);
            return `<${tag} ${attrStr}>${svg}</${tag}>`;
          }
        }
      } catch (err) {
        // Fall through to the normal HTML path on any SVG failure.
        // Logging here would pollute export output; silent recovery
        // is the right behaviour for a layered enhancement.
      }
    }

    // Container with children
    const childLayout = node.layoutMode !== 'NONE' ? node.layoutMode : undefined;
    // Track interactive ancestry: any descendant of <button>, <a>, or an
    // interactive-role wrapper inherits the constraint and uses phrasing
    // content only.
    const INTERACTIVE_TAGS = new Set(['button', 'a']);
    const INTERACTIVE_ROLES_FOR_CHILDREN = new Set(['button', 'cta', 'link', 'input', 'checkbox', 'radio', 'select']);
    const childInteractive = parentInteractive
      || INTERACTIVE_TAGS.has(tag)
      || (node.semanticRole != null && INTERACTIVE_ROLES_FOR_CHILDREN.has(node.semanticRole));
    const children = node.childIds
      .map(id => graph.getNode(id))
      .filter((n): n is SceneNode => n !== null && n !== undefined)
      .map(child => renderNode(child, false, childLayout, childInteractive, node.counterAxisAlign))
      .filter(Boolean);

    if (children.length === 0) {
      return `<${tag} ${attrStr}></${tag}>`;
    }

    return `<${tag} ${attrStr}>\n${indent(children.join('\n'), 2)}\n</${tag}>`;
  }

  const html = renderNode(root, true);

  // Collect all font families used in the tree
  const usedFonts = new Set<string>();
  const usedWeights = new Map<string, Set<number>>();
  function collectFonts(nodeId: string) {
    const n = graph.getNode(nodeId);
    if (!n) return;
    if (n.type === 'TEXT' && n.fontFamily) {
      const family = n.fontFamily;
      if (!SYSTEM_FONT_FAMILIES.has(family.toLowerCase()) && isPlausibleWebFontName(family)) {
        usedFonts.add(family);
        if (!usedWeights.has(family)) usedWeights.set(family, new Set());
        usedWeights.get(family)!.add(n.fontWeight || 400);
      }
    }
    for (const cid of n.childIds) collectFonts(cid);
  }
  collectFonts(rootId);

  // Google Fonts link
  const fontLinks: string[] = [];
  if (usedFonts.size > 0) {
    const families = [...usedFonts].map(f => {
      const weights = [...(usedWeights.get(f) ?? [400])].sort((a, b) => a - b);
      return `family=${f.replace(/ /g, '+')}:wght@${weights.join(';')}`;
    });
    fontLinks.push(
      `<link rel="preconnect" href="https://fonts.googleapis.com">`,
      `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`,
      `<link href="https://fonts.googleapis.com/css2?${families.join('&')}&display=swap" rel="stylesheet">`,
    );
  }

  const tokenBlock = cssTokens.size > 0
    ? `\n  :root {\n${[...cssTokens].map(([k, v]) => `    ${k}: ${v};`).join('\n')}\n  }`
    : '';

  const behaviorBlock = behaviorStyles.length > 0
    ? '\n  ' + behaviorStyles.join('\n  ')
    : '';

  // ── Annotations overlay ─────────────────────────────────────
  // Scene-level annotations render as absolute-positioned spans placed
  // AFTER the main scene content so they sit ATOP it in paint order.
  // Position is computed from the target node's post-Yoga bbox — stored
  // shape is {targetNodeId, anchor, offset}; absolute coords are derived
  // here, which means annotations follow their targets through layout
  // changes (responsive resize, brand swap, user drag).
  const annotationHtml = graph.annotations.length > 0
    ? renderAnnotationLayer(graph, rootId)
    : '';
  const annotationStyles = graph.annotations.length > 0
    ? ANNOTATION_BASE_CSS
    : '';

  // T2 #27 — interactive runtime + CSS injected when scene contains
  // any node with meta.interactive. Single IIFE + single CSS rule set
  // covers all interactive elements in the scene (one document-level
  // mousemove handler iterates a per-element state list).
  const interactiveCss = sceneHasInteractive ? MOUSE_REACTIVE_CSS : '';
  const interactiveScript = sceneHasInteractive
    ? `<script>${MOUSE_REACTIVE_RUNTIME_SOURCE}</script>`
    : '';

  // T2 #32 — text entrance runtime + CSS injected when scene contains
  // any node with meta.entrance. CSS is subset-only (just the keyframes
  // for types actually used in the scene); runtime IIFE is the same
  // single source regardless of which subset is active. Cap-fallback
  // (>200 char / >50 word elements downgrade to fade-up) is handled
  // entirely by the runtime — no exporter coordination needed.
  const entranceCss = sceneEntranceTypes.size > 0 ? entranceCssFor(sceneEntranceTypes) : '';
  const entranceScript = sceneEntranceTypes.size > 0
    ? `<script>${TEXT_ENTRANCE_RUNTIME_SOURCE}</script>`
    : '';

  if (!fullDoc) {
    if (useCssClasses || tokenBlock || behaviorBlock || annotationStyles || interactiveCss || entranceCss) {
      const classBlock = useCssClasses ? generateCssBlock(classes) : '';
      return `<style>${tokenBlock}\n${classBlock}${behaviorBlock}${annotationStyles}${interactiveCss}${entranceCss}</style>\n${html}${annotationHtml}${interactiveScript}${entranceScript}`;
    }
    return `${html}${annotationHtml}${interactiveScript}${entranceScript}`;
  }

  // Full document with production-quality base styles
  const css = useCssClasses ? `\n<style>\n${generateCssBlock(classes)}</style>` : '';
  const viewport = (options.responsive ?? true)
    ? '\n  <meta name="viewport" content="width=device-width, initial-scale=1">'
    : '';

  const primaryFont = [...usedFonts][0] ?? 'system-ui';

  // Document title prefers a meaningful scene name. Most HTML imports
  // name their root element `div` (the outermost tag), which produces
  // `<title>div</title>` in the exported page — not useful in a browser
  // tab, not useful in link previews. Walk the tree for the first title
  // role node and use its text; otherwise fall back to the root name
  // (which for HTML imports is almost always "div").
  const docTitle = findDocumentTitle(graph, rootId) ?? root.name;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">${viewport}
  <title>${escapeHtml(docTitle)}</title>
  ${fontLinks.join('\n  ')}
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility;${rootBgForBody(root, graph)} }
    body { font-family: '${primaryFont}', system-ui, -apple-system, sans-serif; line-height: 1.5;${rootBgForBody(root, graph)} }
    a { color: inherit; text-decoration: none; }
    img, svg { display: block; max-width: 100%; }${tokenBlock}${behaviorBlock}${annotationStyles}${interactiveCss}${entranceCss}
  </style>${css}
  ${graph.annotations.length > 0 ? ANNOTATION_FONT_LINK : ''}
</head>
<body>
${indent(html, 2)}
${indent(annotationHtml, 2)}
${interactiveScript ? indent(interactiveScript, 2) : ''}
${entranceScript ? indent(entranceScript, 2) : ''}
</body>
</html>`;
}

// ─── Annotation overlay rendering ─────────────────────────────

const ANNOTATION_FONT_LINK =
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;600&display=swap">';

const ANNOTATION_BASE_CSS = `
    .reframe-annotation {
      position: absolute;
      pointer-events: none;
      z-index: 9000;
      font-size: 20px;
      line-height: 1.1;
      font-weight: 500;
      max-width: 240px;
      white-space: pre-wrap;
    }
    .reframe-annotation[data-anno-style="caveat"] {
      font-family: 'Caveat', cursive, sans-serif;
      font-size: 22px;
    }
    .reframe-annotation[data-anno-style="mono"] {
      font-family: ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace;
      font-size: 13px;
      letter-spacing: -0.01em;
    }
    .reframe-annotation[data-anno-resolved="true"] { opacity: 0.45; }
    .reframe-annotation::before {
      content: '';
      position: absolute;
      width: 14px;
      height: 14px;
      border: 2px solid currentColor;
    }
    .reframe-annotation[data-anno-bracket="nw"]::before {
      top: -4px; left: -4px; border-right: 0; border-bottom: 0;
    }
    .reframe-annotation[data-anno-bracket="ne"]::before {
      top: -4px; right: -4px; border-left: 0; border-bottom: 0;
    }
    .reframe-annotation[data-anno-bracket="sw"]::before {
      bottom: -4px; left: -4px; border-right: 0; border-top: 0;
    }
    .reframe-annotation[data-anno-bracket="se"]::before {
      bottom: -4px; right: -4px; border-left: 0; border-top: 0;
    }
    .reframe-annotation[data-anno-bracket="top"]::before {
      top: -4px; left: 50%; transform: translateX(-50%); border-right: 0; border-bottom: 0;
    }
    .reframe-annotation[data-anno-bracket="bottom"]::before {
      bottom: -4px; left: 50%; transform: translateX(-50%); border-right: 0; border-top: 0;
    }
  `;

function renderAnnotationLayer(graph: SceneGraph, rootId: string): string {
  const getNode = (id: string) => graph.getNode(id);
  const rootPos = computeAbsolutePosition(rootId, getNode);
  const out: string[] = [];
  for (const a of graph.annotations) {
    const target = graph.getNode(a.targetNodeId);
    if (!target) continue; // silently skip — caller surfaced the id
    const abs = computeAbsolutePosition(a.targetNodeId, getNode);
    const box = {
      // Translate target abs pos into root-relative (scene) coordinate space.
      x: abs.x - rootPos.x,
      y: abs.y - rootPos.y,
      width: target.width,
      height: target.height,
    };
    const point = resolveAnchorPoint(a, box);
    const color = resolveAnnotationColor(a);
    const style = resolveAnnotationStyle(a);
    const textHtml = escapeHtml(a.text);
    out.push(
      `<span class="reframe-annotation" data-anno-id="${a.id}" data-anno-style="${style}" data-anno-bracket="${point.bracketDirection}"${a.resolved ? ' data-anno-resolved="true"' : ''} style="left:${Math.round(point.x)}px; top:${Math.round(point.y)}px; color:${color};">${textHtml}</span>`,
    );
  }
  return out.join('\n');
}

// ─── Behavior CSS Helpers ──────────────────────────────────────

function stateOverrideToCss(override: StateOverride): string[] {
  const props: string[] = [];
  if (override.fills && override.fills.length > 0) {
    const fill = override.fills[0];
    if (fill.type === 'SOLID') {
      props.push(`background: ${colorToRgba(fill.color, fill.opacity)}`);
    }
  }
  if (override.strokes && override.strokes.length > 0) {
    const stroke = override.strokes[0];
    if (stroke.visible) {
      props.push(`border-color: ${colorToRgba(stroke.color, stroke.opacity)}`);
    }
  }
  if (override.effects && override.effects.length > 0) {
    const shadow = computeBoxShadow(override.effects);
    if (shadow) props.push(shadow);
  }
  if (override.opacity !== undefined) props.push(`opacity: ${round(override.opacity)}`);
  if (override.cornerRadius !== undefined) props.push(`border-radius: ${px(override.cornerRadius)}`);
  if (override.fontSize !== undefined) props.push(`font-size: ${px(override.fontSize)}`);
  if (override.fontWeight !== undefined) props.push(`font-weight: ${override.fontWeight}`);
  if (override.letterSpacing !== undefined) props.push(`letter-spacing: ${px(override.letterSpacing)}`);
  return props;
}

function responsiveRuleToCss(rule: ResponsiveRule): string[] {
  const props: string[] = [];
  const p = rule.props;
  if (p.width !== undefined) props.push(`width: ${px(p.width)}`);
  if (p.height !== undefined) props.push(`height: ${px(p.height)}`);
  if (p.fontSize !== undefined) props.push(`font-size: ${px(p.fontSize)}`);
  if (p.fontWeight !== undefined) props.push(`font-weight: ${p.fontWeight}`);
  if (p.lineHeight !== undefined && p.lineHeight !== null) props.push(`line-height: ${lineHeightCss(p.lineHeight)}`);
  if (p.letterSpacing !== undefined) props.push(`letter-spacing: ${px(p.letterSpacing)}`);
  if (p.itemSpacing !== undefined) props.push(`gap: ${px(p.itemSpacing)}`);
  if (p.opacity !== undefined) props.push(`opacity: ${round(p.opacity)}`);
  if (p.visible === false) props.push('display: none');
  if (p.layoutMode !== undefined) {
    props.push(`flex-direction: ${p.layoutMode === 'VERTICAL' ? 'column' : 'row'}`);
  }
  if (p.paddingTop !== undefined || p.paddingRight !== undefined || p.paddingBottom !== undefined || p.paddingLeft !== undefined) {
    props.push(`padding: ${px(p.paddingTop ?? 0)} ${px(p.paddingRight ?? 0)} ${px(p.paddingBottom ?? 0)} ${px(p.paddingLeft ?? 0)}`);
  }
  return props;
}

// ─── Style Computation ─────────────────────────────────────────

function computeStyles(node: SceneNode, isRoot: boolean, parentLayout?: string, tokenVars?: Map<string, string>, hasAbsoluteChild = false, parentCounterAlign?: string): string {
  const s: string[] = [];
  const hasFlexLayout = node.layoutMode !== 'NONE' && node.layoutMode !== 'GRID';

  /** Get CSS value: use var(--token) if token-bound, otherwise use the literal. */
  function tv(field: string, literal: string): string {
    if (tokenVars) {
      const cssVar = tokenVars.get(field);
      if (cssVar) return `var(${cssVar})`;
    }
    return literal;
  }

  // Position & size
  if (isRoot) {
    s.push('position: relative');
    // Studio (and designs) may offset the artboard root — include x/y so drag + round-trip match the graph.
    s.push(`left: ${px(node.x)}`);
    s.push(`top: ${px(node.y)}`);
    s.push(`width: ${px(node.width)}`);
    // Root with auto-layout: min-height so content can grow beyond frame
    if (hasFlexLayout) {
      s.push(`min-height: ${px(node.height)}`);
    } else {
      s.push(`height: ${px(node.height)}`);
    }
    s.push('margin: 0 auto');
  } else if (parentLayout && node.layoutPositioning !== 'ABSOLUTE') {
    // ── Child of a flex container ──
    // parentLayout is HORIZONTAL or VERTICAL.
    // In a HORIZONTAL row: primary axis = width, counter axis = height.
    // In a VERTICAL column: primary axis = height, counter axis = width.

    const isParentRow = parentLayout === 'HORIZONTAL';
    const rawPrimarySizing = node.primaryAxisSizing ?? 'FIXED';
    const rawCounterSizing = node.counterAxisSizing ?? 'FIXED';
    const isText = node.type === 'TEXT';
    const autoResize = node.textAutoResize;
    const hasLayout = node.layoutMode && node.layoutMode !== 'NONE';

    // primaryAxisSizing / counterAxisSizing describe the CHILD's own axes
    // (primary = along its flex-direction). When the child's direction is
    // perpendicular to its parent, what the parent considers its "primary
    // axis" maps to the child's counter axis, and vice versa. Without this
    // remap an explicit width:260 on a HORIZONTAL button inside a VERTICAL
    // section gets dropped because the exporter checks the wrong field.
    const childIsRow = node.layoutMode === 'HORIZONTAL';
    const axesAligned = !hasLayout || childIsRow === isParentRow;
    const primarySizing = axesAligned ? rawPrimarySizing : rawCounterSizing;
    const counterSizing = axesAligned ? rawCounterSizing : rawPrimarySizing;

    // Detect if dimensions are likely invalid (Yoga couldn't compute without font metrics)
    const primaryDim = isParentRow ? node.width : node.height;
    const counterDim = isParentRow ? node.height : node.width;
    const primarySuspect = primaryDim <= 0 || (hasLayout && primarySizing !== 'FIXED' && primaryDim === 100);
    const counterSuspect = counterDim <= 0 || (hasLayout && counterSizing !== 'FIXED' && counterDim === 100);

    // Primary axis (along parent direction)
    if (node.layoutGrow > 0 || primarySizing === 'FILL') {
      s.push(`flex: ${node.layoutGrow || 1}`);
    } else if (primarySizing === 'HUG' || primarySuspect || (isText && autoResize !== 'NONE')) {
      // HUG or suspect dimension = content-sized, let CSS compute
      s.push('flex: 0 0 auto');
    } else {
      // FIXED with valid dimension. Emit the dimension AND flex-shrink: 0 —
      // default flex-shrink:1 lets a sibling with long content crush this
      // child to width:0 (the bug that hid a 32×32 badge in the welcome-email
      // scene when its sibling wrapped to 2 lines). FIXED means "this size,
      // period" and the CSS that conveys that in a flex parent needs the
      // shrink:0 — width alone is a hint the browser ignores under pressure.
      if (isParentRow) {
        s.push(`width: ${px(node.width)}`);
      } else {
        s.push(`height: ${px(node.height)}`);
      }
      s.push('flex-shrink: 0');
    }

    // Counter axis (perpendicular to parent direction)
    const selfAlign = node.layoutAlignSelf;
    // `counterSizing === FILL` used to always emit `align-self: stretch`,
    // but that collides with `max-width` from the source CSS: a child
    // with both `max-width: 900` and `align-self: stretch` ends up
    // clamped to 900 AND flush to the start of the parent's cross axis,
    // ignoring the parent's own `align-items: center`. Source HTML like
    //   section { align-items: center }
    //     h1-wrapper { max-width: 900 } ← should stay centered
    // broke visually — the h1 block glued itself to the left edge.
    // Skip the stretch emission when the node has an explicit
    // max-width so the parent's align-items wins.
    const hasMaxWidth = !isParentRow && node.maxWidth != null && node.maxWidth > 0;
    const hasMaxHeight = isParentRow && node.maxHeight != null && node.maxHeight > 0;
    const hasMaxConstraint = hasMaxWidth || hasMaxHeight;
    // Don't emit align-self: stretch if the parent uses CENTER/MAX alignment
    // and the child didn't explicitly request STRETCH — let the parent's
    // align-items handle positioning so centered children stay centered.
    const parentCentersOrEnds = parentCounterAlign === 'CENTER' || parentCounterAlign === 'MAX';
    const explicitStretch = selfAlign === 'STRETCH';
    const impliedStretch = counterSizing === 'FILL' && !explicitStretch;
    const skipForParentAlign = impliedStretch && parentCentersOrEnds;
    const shouldStretch = (explicitStretch || impliedStretch) && !hasMaxConstraint && !skipForParentAlign;
    if (skipForParentAlign) {
      // Parent aligns children to center/end — don't emit stretch or fixed
      // cross-axis dimension. Let the browser auto-size the child and
      // respect the parent's align-items.
    } else if (shouldStretch) {
      s.push('align-self: stretch');
    } else if (counterSizing === 'HUG' || counterSuspect || (isText && (autoResize === 'WIDTH_AND_HEIGHT' || autoResize === 'HEIGHT'))) {
      // HUG or suspect counter axis — let CSS auto-size
      if (selfAlign && selfAlign !== 'AUTO') {
        const asMap: Record<string, string> = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', STRETCH: 'stretch' };
        if (asMap[selfAlign]) s.push(`align-self: ${asMap[selfAlign]}`);
      }
    } else {
      // FIXED counter axis with valid dimension
      if (isParentRow) {
        if (node.height > 0) s.push(`height: ${px(node.height)}`);
      } else {
        if (node.width > 0) s.push(`width: ${px(node.width)}`);
      }
      if (selfAlign && selfAlign !== 'AUTO') {
        const asMap: Record<string, string> = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', STRETCH: 'stretch' };
        if (asMap[selfAlign]) s.push(`align-self: ${asMap[selfAlign]}`);
      }
    }
  } else {
    s.push('position: absolute');
    s.push(`left: ${px(node.x)}`);
    s.push(`top: ${px(node.y)}`);
    s.push(`width: ${px(node.width)}`);
    s.push(`height: ${px(node.height)}`);
  }

  // Any frame that contains an absolute-positioned direct child must
  // itself be a positioning context — otherwise the child's `left/top`
  // coordinates escape up to the nearest positioned ancestor (usually
  // the root), and a "POPULAR" ribbon at `top:-12px; right:40px`
  // relative to its pricing card ends up absolutely positioned
  // against the 1440-wide canvas instead, landing hundreds of pixels
  // off the card. CSS's `position: relative` without any offset is a
  // pure-anchor no-op — it doesn't shift the node, just establishes
  // the coordinate frame its absolute children resolve against.
  if (hasAbsoluteChild && !isRoot && node.layoutPositioning !== 'ABSOLUTE') {
    s.push('position: relative');
  }

  // Flex layout (when this node IS a flex container)
  const isGrid = node.layoutMode === 'GRID';
  if (isGrid && node.type !== 'TEXT') {
    // CSS Grid layout
    s.push('display: grid');

    if (node.gridTemplateColumns.length > 0) {
      s.push(`grid-template-columns: ${gridTracksToCSS(node.gridTemplateColumns)}`);
    }
    if (node.gridTemplateRows.length > 0) {
      s.push(`grid-template-rows: ${gridTracksToCSS(node.gridTemplateRows)}`);
    }
    if (node.gridAutoRows) {
      s.push(`grid-auto-rows: ${gridTracksToCSS([node.gridAutoRows])}`);
    }
    if (node.gridAutoColumns) {
      s.push(`grid-auto-columns: ${gridTracksToCSS([node.gridAutoColumns])}`);
    }
    if (node.gridColumnGap > 0) s.push(`column-gap: ${px(node.gridColumnGap)}`);
    if (node.gridRowGap > 0) s.push(`row-gap: ${px(node.gridRowGap)}`);

    // Padding
    if (node.paddingTop > 0 || node.paddingRight > 0 || node.paddingBottom > 0 || node.paddingLeft > 0) {
      s.push(`padding: ${tv('paddingTop', px(node.paddingTop))} ${tv('paddingRight', px(node.paddingRight))} ${tv('paddingBottom', px(node.paddingBottom))} ${tv('paddingLeft', px(node.paddingLeft))}`);
    }
  } else if (hasFlexLayout && node.type !== 'TEXT') {
    s.push('display: flex');
    s.push(`flex-direction: ${node.layoutMode === 'VERTICAL' ? 'column' : 'row'}`);

    // primaryAxisAlign → justify-content
    const jc = node.primaryAxisAlign === 'CENTER' ? 'center'
      : node.primaryAxisAlign === 'MAX' ? 'flex-end'
      : node.primaryAxisAlign === 'SPACE_BETWEEN' ? 'space-between'
      : node.primaryAxisAlign === 'SPACE_AROUND' ? 'space-around'
      : 'flex-start';
    s.push(`justify-content: ${jc}`);

    // counterAxisAlign → align-items
    const ai = node.counterAxisAlign === 'CENTER' ? 'center'
      : node.counterAxisAlign === 'MAX' ? 'flex-end'
      : node.counterAxisAlign === 'STRETCH' ? 'stretch'
      : node.counterAxisAlign === 'BASELINE' ? 'baseline'
      : 'flex-start';
    s.push(`align-items: ${ai}`);

    // Wrap
    if (node.layoutWrap === 'WRAP') {
      s.push('flex-wrap: wrap');
    }

    // Gap
    if (node.itemSpacing > 0 && node.counterAxisSpacing > 0) {
      s.push(`gap: ${tv('counterAxisSpacing', px(node.counterAxisSpacing))} ${tv('itemSpacing', px(node.itemSpacing))}`);
    } else if (node.itemSpacing > 0) {
      s.push(`gap: ${tv('itemSpacing', px(node.itemSpacing))}`);
    } else if (node.counterAxisSpacing > 0) {
      s.push(`row-gap: ${tv('counterAxisSpacing', px(node.counterAxisSpacing))}`);
    }

    // Padding
    if (node.paddingTop > 0 || node.paddingRight > 0 || node.paddingBottom > 0 || node.paddingLeft > 0) {
      s.push(`padding: ${tv('paddingTop', px(node.paddingTop))} ${tv('paddingRight', px(node.paddingRight))} ${tv('paddingBottom', px(node.paddingBottom))} ${tv('paddingLeft', px(node.paddingLeft))}`);
    }
  }

  // Grid child positioning
  if (node.gridPosition) {
    const gp = node.gridPosition;
    s.push(`grid-column: ${gp.column} / span ${gp.columnSpan}`);
    s.push(`grid-row: ${gp.row} / span ${gp.rowSpan}`);
  }

  // Size constraints
  if (node.minWidth !== null && node.minWidth > 0) s.push(`min-width: ${px(node.minWidth)}`);
  if (node.maxWidth !== null) s.push(`max-width: ${px(node.maxWidth)}`);
  if (node.minHeight !== null && node.minHeight > 0) s.push(`min-height: ${px(node.minHeight)}`);
  if (node.maxHeight !== null) s.push(`max-height: ${px(node.maxHeight)}`);


  // Opacity
  if (node.opacity < 1) {
    s.push(`opacity: ${round(node.opacity)}`);
  }

  // Blend mode
  if (node.blendMode && node.blendMode !== 'PASS_THROUGH' && node.blendMode !== 'NORMAL') {
    const cssBlend = blendModeToCSS(node.blendMode);
    if (cssBlend) s.push(`mix-blend-mode: ${cssBlend}`);
  }

  // Transform (rotation + flip).
  // T2 #27: when the node is mouse-reactive (tilt or tilt-glow), append a
  // CSS variable hook so the runtime can stack rotateX/rotateY *on top of*
  // any existing rotation/flip without stomping it. Empty fallback in
  // var(--reframe-mouse-tilt, ) means "no-op when var is unset" — keeps
  // SSR'd page identical to pre-runtime baseline before mousemove fires.
  const transforms: string[] = [];
  if (node.rotation !== 0) transforms.push(`rotate(${round(node.rotation)}deg)`);
  if (node.flipX) transforms.push('scaleX(-1)');
  if (node.flipY) transforms.push('scaleY(-1)');
  const interactive = node.meta?.interactive;
  const wantsTilt = interactive && (interactive.type === 'mouse-tilt' || interactive.type === 'mouse-tilt-glow');
  if (wantsTilt) transforms.push('var(--reframe-mouse-tilt, )');
  if (transforms.length > 0) s.push(`transform: ${transforms.join(' ')}`);

  // Background (fills) — skip for TEXT nodes (fills = text color, handled below)
  if (node.type !== 'TEXT') {
    const fillColorVar = tokenVars?.get('fills[0].color');
    if (fillColorVar && node.fills?.length === 1 && node.fills[0]?.type === 'SOLID') {
      // Token-bound single solid fill → use CSS variable
      s.push(`background: var(${fillColorVar})`);
    } else {
      const bg = computeBackground(node.fills);
      if (bg) s.push(bg);
    }
  }

  // Border (strokes)
  if (node.independentStrokeWeights) {
    // Per-side border weights
    const stroke = node.strokes?.find(st => st.visible);
    if (stroke) {
      const hasDash = (stroke.dashPattern?.length ?? 0) > 0 || (node.dashPattern?.length ?? 0) > 0;
      const style = hasDash ? 'dashed' : 'solid';
      const color = colorToRgba(stroke.color, stroke.opacity);
      s.push(`border-style: ${style}`);
      s.push(`border-color: ${color}`);
      s.push(`border-width: ${px(node.borderTopWeight)} ${px(node.borderRightWeight)} ${px(node.borderBottomWeight)} ${px(node.borderLeftWeight)}`);
    }
  } else {
    const border = computeBorder(node.strokes, node.dashPattern);
    if (border) s.push(border);
  }

  // Border radius
  if (node.type === 'ELLIPSE') {
    s.push('border-radius: 50%');
  } else {
    const crVar = tokenVars?.get('cornerRadius');
    if (crVar && node.cornerRadius && !node.independentCorners) {
      s.push(`border-radius: var(${crVar})`);
    } else {
      const radius = computeBorderRadius(node);
      if (radius) s.push(radius);
    }
  }

  // Effects (box-shadow)
  const shadow = computeBoxShadow(node.effects);
  if (shadow) s.push(shadow);

  // Effects (blur filter)
  const blurEffect = node.effects?.find(e => e.visible && e.type === 'LAYER_BLUR');
  if (blurEffect) {
    s.push(`filter: blur(${px(blurEffect.radius)})`);
  }

  // Clip
  if (node.clipsContent) {
    s.push('overflow: hidden');
  }

  // Text styles
  if (node.type === 'TEXT') {
    // Emit the Yoga-computed width as an upper bound so the browser
    // wraps long text the same way the engine did. Without this a
    // 72px heading whose Yoga-measured width is 900px comes out as
    // `flex: 0 0 auto` with no width cap, and the browser lets the
    // text overflow both sides of its parent (the h1 "Linear is a
    // purpose-built tool…" bleed that showed up in the live preview
    // on the 1440 canvas). `max-width` instead of `width` keeps the
    // behaviour soft — if the text happens to fit in less, it does,
    // but it can never exceed the Yoga bbox.
    if (node.width > 0 && node.width < 16000) {
      // The engine estimates text width with a glyph factor (~0.48–0.55)
      // which can undersize by 10–15% vs actual browser font metrics.
      // Apply a 15% safety margin so browsers don't clip the last characters.
      // max-width is a soft cap — parent containers still constrain overflow.
      // No word-wrap or white-space override: the browser's default behavior
      // wraps at spaces (good for multi-line text) and never breaks mid-word
      // (good for labels like "PRODUCT" that were splitting into "PRODU CT").
      const safeWidth = Math.ceil(node.width * 1.15);
      s.push(`max-width: ${px(safeWidth)}`);
    }
    s.push(`font-size: ${tv('fontSize', px(node.fontSize || 16))}`);
    if (node.fontFamily) s.push(`font-family: ${tv('fontFamily', `'${node.fontFamily}', sans-serif`)}`);
    if (node.fontWeight && node.fontWeight !== 400) s.push(`font-weight: ${tv('fontWeight', String(node.fontWeight))}`);
    if (node.italic) s.push('font-style: italic');
    if (node.letterSpacing) s.push(`letter-spacing: ${tv('letterSpacing', px(node.letterSpacing))}`);
    if (node.lineHeight) s.push(`line-height: ${tv('lineHeight', lineHeightCss(node.lineHeight))}`);
    if (node.fontFeatureSettings && node.fontFeatureSettings.length > 0) {
      s.push(`font-feature-settings: ${node.fontFeatureSettings.map(t => `"${t}"`).join(', ')}`);
    }

    const textColor = node.fills?.find(f => f.visible && f.type === 'SOLID');
    if (textColor) {
      // Check if fill[0].color is token-bound
      const fillColorVar = tokenVars?.get('fills[0].color');
      s.push(`color: ${fillColorVar ? `var(${fillColorVar})` : colorToRgba(textColor.color, textColor.opacity)}`);
    }

    // Text align
    if (node.textAlignHorizontal === 'CENTER') s.push('text-align: center');
    else if (node.textAlignHorizontal === 'RIGHT') s.push('text-align: right');
    else if (node.textAlignHorizontal === 'JUSTIFIED') s.push('text-align: justify');

    // Vertical align — only use flex if explicitly centering/bottom-aligning
    if (node.textAlignVertical === 'CENTER' || node.textAlignVertical === 'BOTTOM') {
      s.push('display: flex');
      s.push(`align-items: ${node.textAlignVertical === 'CENTER' ? 'center' : 'flex-end'}`);
    }

    // Text decoration
    if (node.textDecoration === 'UNDERLINE') s.push('text-decoration: underline');
    else if (node.textDecoration === 'STRIKETHROUGH') s.push('text-decoration: line-through');

    // Text transform
    if (node.textCase === 'UPPER') s.push('text-transform: uppercase');
    else if (node.textCase === 'LOWER') s.push('text-transform: lowercase');

    // Text truncation (maxLines + ellipsis)
    if (node.textTruncation === 'ENDING' && node.maxLines && node.maxLines > 0) {
      s.push('overflow: hidden');
      s.push('text-overflow: ellipsis');
      if (node.maxLines === 1) {
        s.push('white-space: nowrap');
      } else {
        s.push('display: -webkit-box');
        s.push(`-webkit-line-clamp: ${node.maxLines}`);
        s.push('-webkit-box-orient: vertical');
      }
    }
  }

  return s.join('; ');
}

/**
 * Paint the body with the root node's background so the exported page
 * looks right even in a narrow preview iframe where the (width:1440)
 * root is auto-centered and leaves margin bars on each side. Without
 * this, a dark scene embedded in a pale parent modal showed beige bars
 * on both sides — the content was fine, the page chrome was wrong.
 *
 * Fallback: for session scenes where the nominal `root` is a CANVAS
 * wrapper (no fills), walk into the first FRAME child and use ITS fill.
 * Without this fallback the body stayed transparent even though the
 * actual page content is dark — Export preview modal's beige showed
 * through the export iframes on every Platform UI scene.
 */
function rootBgForBody(root: SceneNode | null | undefined, graph?: SceneGraph): string {
  const pick = (node: SceneNode | null | undefined): string | null => {
    if (!node || !node.fills || !Array.isArray(node.fills)) return null;
    const fill = (node.fills as any[]).find(f => f && f.type === 'SOLID' && f.visible !== false && f.color);
    if (!fill) return null;
    return colorToRgba(fill.color, typeof fill.opacity === 'number' ? fill.opacity : 1);
  };
  if (!root) return '';
  let bg = pick(root);
  if (!bg && graph && root.childIds && root.childIds.length > 0) {
    const firstChild = graph.getNode(root.childIds[0]);
    bg = pick(firstChild);
  }
  return bg ? ` background: ${bg};` : '';
}

function computeBackground(fills: Fill[]): string | null {
  if (!fills || fills.length === 0) return null;

  const visibleFills = fills.filter(f => f.visible);
  if (visibleFills.length === 0) return null;

  // Single solid fill
  if (visibleFills.length === 1 && visibleFills[0].type === 'SOLID') {
    return `background: ${colorToRgba(visibleFills[0].color, visibleFills[0].opacity)}`;
  }

  // Multiple fills → layered backgrounds (CSS supports this)
  const backgrounds = visibleFills.map(fill => {
    if (fill.type === 'SOLID') {
      return colorToRgba(fill.color, fill.opacity);
    }
    if (fill.type === 'GRADIENT_LINEAR' && fill.gradientStops) {
      const stops = fill.gradientStops
        .map(s => `${colorToRgba(s.color)} ${round(s.position * 100)}%`)
        .join(', ');
      const angle = fill.gradientTransform
        ? `${round(gradientTransformToAngle(fill.gradientTransform))}deg, `
        : '';
      return `linear-gradient(${angle}${stops})`;
    }
    if (fill.type === 'GRADIENT_RADIAL' && fill.gradientStops) {
      const stops = fill.gradientStops
        .map(s => `${colorToRgba(s.color)} ${round(s.position * 100)}%`)
        .join(', ');
      return `radial-gradient(${stops})`;
    }
    return null;
  }).filter(Boolean);

  if (backgrounds.length === 0) return null;
  return `background: ${backgrounds.join(', ')}`;
}

function computeBorder(strokes: Stroke[], nodeDashPattern?: number[]): string | null {
  if (!strokes || strokes.length === 0) return null;
  const stroke = strokes.find(s => s.visible);
  if (!stroke) return null;

  const hasDash = (stroke.dashPattern?.length ?? 0) > 0 || (nodeDashPattern?.length ?? 0) > 0;
  const style = hasDash ? 'dashed' : 'solid';
  return `border: ${px(stroke.weight)} ${style} ${colorToRgba(stroke.color, stroke.opacity)}`;
}

function computeBorderRadius(node: SceneNode): string | null {
  if (node.independentCorners) {
    const tl = node.topLeftRadius || 0;
    const tr = node.topRightRadius || 0;
    const br = node.bottomRightRadius || 0;
    const bl = node.bottomLeftRadius || 0;
    if (tl === 0 && tr === 0 && br === 0 && bl === 0) return null;
    return `border-radius: ${px(tl)} ${px(tr)} ${px(br)} ${px(bl)}`;
  }

  if (!node.cornerRadius) return null;

  // Corner smoothing (Figma's iOS-style squircle) — approximate with mask-image superellipse
  if (node.cornerSmoothing > 0 && node.cornerRadius > 0) {
    // Use CSS mask for smooth corners where supported
    return `border-radius: ${px(node.cornerRadius)}; --corner-smoothing: ${node.cornerSmoothing}`;
  }

  return `border-radius: ${px(node.cornerRadius)}`;
}

function computeBoxShadow(effects: Effect[]): string | null {
  if (!effects || effects.length === 0) return null;

  const shadows = effects
    .filter(e => e.visible && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'))
    .map(e => {
      const inset = e.type === 'INNER_SHADOW' ? 'inset ' : '';
      return `${inset}${px(e.offset.x)} ${px(e.offset.y)} ${px(e.radius)} ${px(e.spread)} ${colorToRgba(e.color)}`;
    });

  if (shadows.length === 0) return null;
  return `box-shadow: ${shadows.join(', ')}`;
}

// ─── CSS Generation ────────────────────────────────────────────

function generateCssBlock(classes: Map<string, string>): string {
  const lines: string[] = [];
  for (const [className, styles] of classes) {
    const props = styles.split('; ').map(p => `  ${p};`).join('\n');
    lines.push(`.${className} {\n${props}\n}`);
  }
  return lines.join('\n\n');
}

// ─── Rich Text ────────────────────────────────────────────────

function renderStyleRuns(text: string, runs: { start: number; length: number; style: any }[]): string {
  // Sort runs by start position
  const sorted = [...runs].sort((a, b) => a.start - b.start);
  const parts: string[] = [];
  let cursor = 0;

  for (const run of sorted) {
    // Gap before this run — render as plain text
    if (run.start > cursor) {
      parts.push(escapeHtml(text.slice(cursor, run.start)).replace(/\n/g, '<br/>'));
    }

    const end = run.start + run.length;
    const fragment = escapeHtml(text.slice(run.start, end)).replace(/\n/g, '<br/>');
    const s = run.style;
    const css: string[] = [];

    if (s.fontSize) css.push(`font-size: ${px(s.fontSize)}`);
    if (s.fontWeight) css.push(`font-weight: ${s.fontWeight}`);
    if (s.fontFamily) css.push(`font-family: '${s.fontFamily}', sans-serif`);
    if (s.italic) css.push('font-style: italic');
    if (s.letterSpacing) css.push(`letter-spacing: ${px(s.letterSpacing)}`);
    if (typeof s.lineHeight === 'number') css.push(`line-height: ${lineHeightCss(s.lineHeight)}`);
    if (s.textDecoration === 'UNDERLINE') css.push('text-decoration: underline');
    else if (s.textDecoration === 'STRIKETHROUGH') css.push('text-decoration: line-through');
    if (s.textCase === 'UPPER') css.push('text-transform: uppercase');
    else if (s.textCase === 'LOWER') css.push('text-transform: lowercase');
    if (s.fillColor) {
      css.push(`color: ${colorToRgba(s.fillColor)}`);
    }

    if (css.length > 0) {
      parts.push(`<span style="${css.join('; ')}">${fragment}</span>`);
    } else {
      parts.push(fragment);
    }
    cursor = end;
  }

  // Remaining text after last run
  if (cursor < text.length) {
    parts.push(escapeHtml(text.slice(cursor)).replace(/\n/g, '<br/>'));
  }

  return parts.join('');
}

// ─── Grid Helpers ─────────────────────────────────────────────

function gridTracksToCSS(tracks: { type: string; value: number }[]): string {
  return tracks.map(t => {
    if (t.type === 'FR') return `${t.value}fr`;
    if (t.type === 'AUTO') return 'auto';
    return px(t.value); // FIXED
  }).join(' ');
}

// ─── Utils ─────────────────────────────────────────────────────

function colorToRgba(color: Color, opacity = 1): string {
  if (!color) return 'transparent';
  const r = Math.round(Math.max(0, Math.min(1, color.r ?? 0)) * 255);
  const g = Math.round(Math.max(0, Math.min(1, color.g ?? 0)) * 255);
  const b = Math.round(Math.max(0, Math.min(1, color.b ?? 0)) * 255);
  const a = round(Math.max(0, Math.min(1, (color.a ?? 1) * opacity)));

  if (a === 1) {
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function hex(n: number): string {
  const clamped = Math.max(0, Math.min(255, n));
  return clamped.toString(16).padStart(2, '0');
}

function px(n: number | undefined | null): string {
  if (n === undefined || n === null || isNaN(n)) return '0';
  if (n === 0) return '0';
  return `${round(n)}px`;
}

/** Values in (0, 4) are treated as unitless multipliers (typical Figma line-height); larger → px. */
function lineHeightCss(lh: number): string {
  if (isNaN(lh)) return '1.5';
  if (lh > 0 && lh < 4) return String(round(lh));
  return px(lh);
}

function round(n: number): number {
  if (isNaN(n)) return 0;
  return Math.round(n * 100) / 100;
}

function blendModeToCSS(mode: string): string | null {
  const map: Record<string, string> = {
    MULTIPLY: 'multiply', SCREEN: 'screen', OVERLAY: 'overlay',
    DARKEN: 'darken', LIGHTEN: 'lighten', COLOR_DODGE: 'color-dodge',
    COLOR_BURN: 'color-burn', HARD_LIGHT: 'hard-light', SOFT_LIGHT: 'soft-light',
    DIFFERENCE: 'difference', EXCLUSION: 'exclusion', HUE: 'hue',
    SATURATION: 'saturation', COLOR: 'color', LUMINOSITY: 'luminosity',
  };
  return map[mode] ?? null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function indent(s: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return s.split('\n').map(l => pad + l).join('\n');
}

// ─── Overlay export (T2 #5) ──────────────────────────────────
//
// Standalone HTML emission for the 'overlay' composition kind.
// Output shape:
//
//   <!DOCTYPE html>...
//   <head>
//     ...base scene's <head>...
//     <style>html, body { margin:0 } .rfd-overlay-root { position: relative }</style>
//   </head>
//   <body>
//     <div class="rfd-overlay-root" style="width:Wpx;height:Hpx">
//       <div class="rfd-overlay-base">...base scene body content...</div>
//       <canvas data-layer-id="layer-0" style="...absolute, pointer-events:none"></canvas>
//       ...
//       <script>
//         /* ALL_LAYERS_BROWSER_SOURCE inlined here */
//         (function () {
//           var layerSpecs = [...];
//           var canvases = layerSpecs.map(spec => document.querySelector('[data-layer-id="' + spec.id + '"]'));
//           var instances = layerSpecs.map((spec, i) => factories[spec.type](canvases[i], spec.config, baseSize, spec.id));
//           function tick(t) { instances.forEach((inst, i) => inst.render(canvases[i].getContext('2d'), t)); requestAnimationFrame(tick); }
//           requestAnimationFrame(function() {
//             instances.forEach((inst, i) => inst.render(canvases[i].getContext('2d'), 0));
//             requestAnimationFrame(tick);
//           });
//         })();
//       </script>
//     </body>
//   </html>
//
// Bundle size: 3 layer impls + utils ≈ 5 KB. Acceptable for Phase 0 —
// inline JS keeps the file truly portable (no fetch dependency, runs
// from `file://`). Future opt: lazy-load layer impls on demand if a
// 5 KB hit becomes meaningful, but that's not Phase 0.

export interface OverlayExportLayer {
  id: string;
  type: string;
  config: Record<string, unknown>;
  zIndex?: number;
  blendMode?: string;
}

export interface OverlayHtmlExportOptions {
  /** Width override in CSS px. Default = base graph root width. */
  width?: number;
  /** Height override in CSS px. Default = base graph root height. */
  height?: number;
}

export function exportOverlayToHtml(
  baseGraph: SceneGraph,
  baseRootId: string,
  layers: OverlayExportLayer[],
  layerRuntimeSource: string,
  options: OverlayHtmlExportOptions = {},
): string {
  const root = baseGraph.getNode(baseRootId);
  if (!root) throw new Error(`exportOverlayToHtml: base root ${baseRootId} not found`);

  // Inline base as fullDoc so we get the <head> with fonts. We'll then
  // inject our overlay <div> + layer canvases into the body, and append
  // the runtime <script>.
  const baseHtml = exportToHtml(baseGraph, baseRootId, { fullDocument: true });

  const width = options.width ?? (root as any).width ?? 1440;
  const height = options.height ?? (root as any).height ?? 900;

  // Sort layers by zIndex (default = array index) for stable z-stack.
  const sortedLayers = layers
    .map((l, i) => ({ l, i, z: l.zIndex ?? i }))
    .sort((a, b) => (a.z - b.z) || (a.i - b.i))
    .map(({ l }) => l);

  const layerCanvasesHtml = sortedLayers.map((l, i) => {
    const z = (l.zIndex ?? i) + 1;
    const blend = l.blendMode ? `mix-blend-mode:${escapeHtml(l.blendMode)};` : '';
    return `<canvas data-layer-id="${escapeHtml(l.id)}" data-layer-type="${escapeHtml(l.type)}" width="${width}" height="${height}" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:${z};${blend}"></canvas>`;
  }).join('\n');

  const layerSpecsLiteral = JSON.stringify(sortedLayers.map(l => ({
    id: l.id,
    type: l.type,
    config: l.config,
  })));

  const runtimeIIFE = `
<script>
${layerRuntimeSource}
(function() {
  var layerSpecs = ${layerSpecsLiteral};
  var factories = {};
  ${sortedLayers.map(l => {
    const fname = 'factory_' + l.type.replace(/-/g, '_');
    return `factories[${JSON.stringify(l.type)}] = (typeof ${fname} === 'function') ? ${fname} : null;`;
  }).join('\n  ')}
  var baseSize = { width: ${width}, height: ${height} };
  var canvases = layerSpecs.map(function(s) { return document.querySelector('canvas[data-layer-id="' + s.id + '"]'); });
  var instances = [];
  for (var i = 0; i < layerSpecs.length; i++) {
    var f = factories[layerSpecs[i].type];
    if (f && canvases[i]) {
      try { instances.push(f(canvases[i], layerSpecs[i].config, baseSize, layerSpecs[i].id)); }
      catch (e) { console.warn('[overlay] factory threw for ' + layerSpecs[i].type, e); instances.push(null); }
    } else {
      instances.push(null);
    }
  }
  function tick(t) {
    for (var i = 0; i < instances.length; i++) {
      var inst = instances[i];
      var canvas = canvases[i];
      if (!inst || !canvas) continue;
      try { inst.render(canvas.getContext('2d'), t); }
      catch (e) { console.warn('[overlay] render threw', e); }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(function(t) {
    // First-frame render at t=0 explicitly for determinism.
    for (var i = 0; i < instances.length; i++) {
      var inst = instances[i];
      var canvas = canvases[i];
      if (!inst || !canvas) continue;
      try { inst.render(canvas.getContext('2d'), 0); }
      catch (e) { console.warn('[overlay] initial render threw', e); }
    }
    requestAnimationFrame(tick);
  });
})();
</script>`;

  // Wrap base body content inside .rfd-overlay-base then add layers.
  // Strategy: split baseHtml at </body> close tag; insert our wrapper-
  // close + canvases + script before it.
  const closeBodyIdx = baseHtml.lastIndexOf('</body>');
  if (closeBodyIdx === -1) {
    throw new Error('exportOverlayToHtml: base HTML missing </body> close — non-fullDocument export?');
  }
  const openBodyMatch = baseHtml.match(/<body[^>]*>/);
  if (!openBodyMatch) {
    throw new Error('exportOverlayToHtml: base HTML missing <body> open tag');
  }
  const openBodyIdx = openBodyMatch.index! + openBodyMatch[0].length;

  const beforeBody = baseHtml.slice(0, openBodyIdx);
  const bodyContent = baseHtml.slice(openBodyIdx, closeBodyIdx);
  const afterBody = baseHtml.slice(closeBodyIdx);

  const wrapperOpen = `<div class="rfd-overlay-root" style="position:relative;width:${width}px;height:${height}px;overflow:hidden;">\n<div class="rfd-overlay-base" style="position:absolute;inset:0;z-index:0;">`;
  const wrapperClose = `</div>\n${layerCanvasesHtml}\n</div>\n${runtimeIIFE}\n`;

  return beforeBody + '\n' + wrapperOpen + bodyContent + wrapperClose + afterBody;
}
