/**
 * React Exporter — INode → React functional component
 *
 * Generates clean, idiomatic React/JSX.
 * Supports inline styles and CSS modules output.
 * Maps INode layout to flexbox, absolute positioning, typography.
 */

import { type INode, NodeType, MIXED, type ISolidPaint } from '../host';
import type { StateOverride, ResponsiveRule, TokenBindings } from '../engine/types';
import type { DesignSystem } from '../design-system/types';
import type { ITimeline } from '../animation/types';
import { timelineToCss } from '../animation/to-css';

// ─── Types ────────────────────────────────────────────────────

export interface ReactExportOptions {
  /** Component name (default: derived from root node name) */
  componentName?: string;
  /** TypeScript annotations (default: true) */
  typescript?: boolean;
  /** Indent size (default: 2) */
  indent?: number;
  /** Output CSS modules instead of inline styles (default: false) */
  cssModules?: boolean;
  /** Include image placeholders as <img> tags (default: true) */
  images?: boolean;
  /**
   * Phase 5: optional ITimeline to emit as CSS keyframes. When the caller
   * passes a graph-backed INode, they can read `graph.timeline` and hand it
   * here to get animation export out of the react path too. Without this,
   * React components never see animation state.
   */
  timeline?: ITimeline | null;
  /**
   * Phase 3b: when provided, the exporter walks `node.meta.tokenBindings`
   * and emits a `:root` CSS block at the top of the rendered component with
   * `--color-*`, `--font-size-*`, `--radius-*` variables resolved against
   * this DesignSystem. Node-level substitution is opt-in via `useTokenVars`
   * (default true when a designSystem is supplied) — without it you still
   * get the :root block which can then be referenced manually from a theme
   * wrapper, useful for pairing with a CSS-in-JS theme provider.
   */
  designSystem?: DesignSystem;
  /**
   * When true, token-bound node styles are emitted as `var(--color-xyz)`
   * instead of the hardcoded hex. Default: true when designSystem is set.
   */
  useTokenVars?: boolean;
}

// ─── Phase 3b helpers (mirrors html.ts::collectPhase3Tokens) ─

interface ReactPhase3Tables {
  byNode: Map<string, Map<keyof TokenBindings, string>>;
  rootVars: Map<string, string>;
}

function walkINode(node: INode, cb: (n: INode) => void): void {
  cb(node);
  if (node.children) for (const c of node.children) walkINode(c, cb);
}

function collectPhase3ReactTokens(root: INode, ds: DesignSystem): ReactPhase3Tables {
  const byNode = new Map<string, Map<keyof TokenBindings, string>>();
  const rootVars = new Map<string, string>();

  const resolveColor = (role: string): string | undefined =>
    (role === 'primary' && ds.colors.primary)
    || (role === 'background' && ds.colors.background)
    || (role === 'text' && ds.colors.text)
    || (role === 'accent' && ds.colors.accent)
    || ds.colors.roles?.get(role) || undefined;

  const resolveFontSize = (role: string): number | undefined =>
    ds.typography.hierarchy.find(r => r.role === role)?.fontSize;
  const resolveFontFamily = (slot: string): string | undefined =>
    slot === 'primary' ? ds.typography.primaryFont
    : slot === 'secondary' ? ds.typography.secondaryFont
    : undefined;
  const resolveRadius = (idxStr: string): number | undefined => {
    const i = parseInt(idxStr, 10);
    return Number.isFinite(i) ? ds.layout?.borderRadiusScale?.[i] : undefined;
  };

  walkINode(root, (n: INode) => {
    // INode exposes meta via the adapter layer as `meta` — when absent we just skip.
    const bindings = (n as any).meta?.tokenBindings as TokenBindings | undefined;
    if (!bindings) return;
    const fields = new Map<keyof TokenBindings, string>();
    if (bindings.fill) {
      const hex = resolveColor(bindings.fill);
      if (hex) { const v = `--color-${bindings.fill}`; rootVars.set(v, hex); fields.set('fill', v); }
    }
    if (bindings.stroke) {
      const hex = resolveColor(bindings.stroke);
      if (hex) { const v = `--color-${bindings.stroke}`; rootVars.set(v, hex); fields.set('stroke', v); }
    }
    if (bindings.fontSize) {
      const px = resolveFontSize(bindings.fontSize);
      if (px !== undefined) { const v = `--font-size-${bindings.fontSize}`; rootVars.set(v, `${px}px`); fields.set('fontSize', v); }
    }
    if (bindings.fontFamily) {
      const fam = resolveFontFamily(bindings.fontFamily);
      if (fam) { const v = `--font-family-${bindings.fontFamily}`; rootVars.set(v, `'${fam}', sans-serif`); fields.set('fontFamily', v); }
    }
    if (bindings.cornerRadius) {
      const r = resolveRadius(bindings.cornerRadius);
      if (r !== undefined) { const v = `--radius-${bindings.cornerRadius}`; rootVars.set(v, `${r}px`); fields.set('cornerRadius', v); }
    }
    if (fields.size > 0) byNode.set(n.id, fields);
  });

  return { byNode, rootVars };
}

export interface ReactExportResult {
  /** The React component code */
  component: string;
  /** CSS module content (only when cssModules: true) */
  css?: string;
}

// ─── Multi-file tree export (Phase 1–3 scaffold) ──────────────
//
// The single-file `exportToReactModule` produces a technically-correct
// React dump but no production project ships as one 800-line file.
// `exportToReactTree` emits a navigable multi-file tree:
//
//   Phase 1 (implemented): semantic-role → separate section files,
//     entry page that imports/renders them, tokens file, inline/css-modules
//     targets.
//   Phase 2 (scaffold): `extractPrimitives` — shape-hash detection of
//     repeating subtrees across sections → emit primitives in
//     src/components/ui/. Currently returns empty manifest.primitives.
//   Phase 3 (scaffold): `extractHooks` — state-bearing nodes → useXxx
//     hook files in src/hooks/. Currently returns empty manifest.hooks.
//
// Everything is deterministic: the same INode tree produces the same
// file map byte-for-byte. No LLM calls, no AI judgment. The skill layer
// (.claude/skills/reframe-to-react) handles user preference for target
// stack and naming edge cases — the engine handles transformation.

export type ReactTreeTarget = 'inline' | 'css-modules' | 'tailwind' | 'styled-components';

export interface ReactTreeOptions extends ReactExportOptions {
  /**
   * Styling strategy for the emitted components. Defaults to 'inline'.
   * - `inline`: inline style objects (same as single-file export)
   * - `css-modules`: per-component .module.css files
   * - `tailwind`: Phase 2 — scaffolded, currently falls back to inline
   *   with a tailwind.config.ts extension sketch
   * - `styled-components`: Phase 2 — scaffolded, falls back to inline
   */
  target?: ReactTreeTarget;
  /**
   * When true, each child of the root with a `semanticRole` (nav / hero /
   * section / footer / etc.) is extracted to its own file under
   * `src/components/sections/<Name>.tsx`. Default: true.
   */
  extractSections?: boolean;
  /**
   * Phase 2 flag — when true, repeating subtrees (by shape hash) are
   * extracted to `src/components/ui/<Primitive>.tsx`. NOT YET IMPLEMENTED;
   * option is accepted so call sites don't have to change when the
   * feature lands. Currently no-op.
   */
  extractPrimitives?: boolean;
  /**
   * Phase 3 flag — when true, state-bearing nodes (states / interactive
   * children) get `useX` hooks scaffolded in `src/hooks/`. NOT YET
   * IMPLEMENTED. Option accepted, currently no-op.
   */
  extractHooks?: boolean;
  /**
   * Root directory for emitted paths in the result map. Default: "src".
   * Emitted paths are relative to this — caller decides whether to
   * prefix with their project root.
   */
  outputBase?: string;
  /**
   * Emitted page filename (stem), e.g. "pricing" → "src/pages/pricing.tsx".
   * Default: derived from root node's name (sanitized).
   */
  pageSlug?: string;
}

export interface ReactTreeManifest {
  /** Section components extracted by semanticRole. */
  sections: Array<{
    name: string;           // PascalCase component name
    path: string;           // path in files map
    role: string | null;    // semanticRole that drove the extraction
    sourceNodeId: string;   // INode id of the extracted subtree
  }>;
  /** Repeating subtree primitives. Empty until Phase 2 lands. */
  primitives: Array<{
    name: string;
    path: string;
    usedIn: string[];       // paths that import this primitive
  }>;
  /** Hook files scaffolded from state-bearing nodes. Empty until Phase 3 lands. */
  hooks: Array<{
    name: string;
    path: string;
  }>;
  /** Emitted tokens file path, if a designSystem was supplied. */
  tokensPath?: string;
  /** Target stack the tree was emitted for. */
  target: ReactTreeTarget;
  /** Unsupported-feature notes (when flags were set but not yet implemented). */
  notes: string[];
}

export interface ReactTreeResult {
  /** Emitted files: path → content. Deterministic across runs. */
  files: Record<string, string>;
  /** Entry file path (the page that imports sections). */
  entry: string;
  /** Provenance: what was extracted, where it lives, what's unimplemented. */
  manifest: ReactTreeManifest;
}

// ─── Main Export ──────────────────────────────────────────────

/** Export an INode tree to a React functional component string. */
export function exportToReact(node: INode, options?: ReactExportOptions): string {
  const result = exportToReactModule(node, options);
  if (result.css) {
    return `/* --- ${sanitizeComponentName(options?.componentName ?? node.name)}.module.css --- */\n\n${result.css}\n\n/* --- Component --- */\n\n${result.component}`;
  }
  return result.component;
}

/** Export with separate component and CSS module files. */
export function exportToReactModule(node: INode, options?: ReactExportOptions): ReactExportResult {
  const name = sanitizeComponentName(options?.componentName ?? node.name);
  const ts = options?.typescript ?? true;
  const indentSize = options?.indent ?? 2;
  const useCssModules = options?.cssModules ?? false;
  const useImages = options?.images ?? true;

  const cssClasses = new Map<string, Record<string, string | number>>();
  let classCounter = 0;

  // Phase 3b: collect :root CSS vars from meta.tokenBindings when a DS is supplied.
  // These are appended to the behaviorStyles block so we get one <style> tag.
  const phase3 = options?.designSystem
    ? collectPhase3ReactTokens(node, options.designSystem)
    : { byNode: new Map(), rootVars: new Map() };

  // Phase 5: timeline → @keyframes + per-node animation classes.
  // Prefer an explicit options.timeline; otherwise try the graph attached to
  // the root INode (StandaloneNode exposes it via the adapter). Falling back
  // through the adapter path keeps the API symmetric with html.ts.
  const timelineFromNode = options?.timeline ?? ((node as any).graph?.timeline as ITimeline | null | undefined) ?? null;
  const timelineCss = timelineToCss(timelineFromNode);

  // Collect behavioral CSS (states + responsive) from the tree
  const behaviorStyles: string[] = [];
  let behaviorCounter = 0;
  const behaviorClassMap = new Map<string, string>();

  function collectBehavior(n: INode) {
    if (n.removed || n.visible === false) return;
    const hasStates = n.states && Object.keys(n.states).length > 0;
    const hasResponsive = n.responsive && n.responsive.length > 0;

    if (hasStates || hasResponsive) {
      const cls = `rf${behaviorCounter++}`;
      behaviorClassMap.set(nodeKey(n), cls);

      if (hasStates) {
        const stateMap: Record<string, string> = {
          hover: ':hover', active: ':active', focus: ':focus',
          disabled: '[disabled]', selected: '[aria-selected="true"]',
        };
        for (const [state, override] of Object.entries(n.states!)) {
          const pseudo = stateMap[state] ?? `:${state}`;
          const cssProps = stateOverrideToCssReact(override as StateOverride);
          if (cssProps.length > 0) {
            const transition = (override as StateOverride).transition ?? 150;
            behaviorStyles.push(`.${cls}${pseudo} { ${cssProps.join('; ')} }`);
            if (!behaviorStyles.some(s => s.includes(`.${cls} {`) && s.includes('transition'))) {
              behaviorStyles.push(`.${cls} { transition: all ${transition}ms ease; }`);
            }
          }
        }
      }
      if (hasResponsive) {
        for (const rule of n.responsive!) {
          const cssProps = responsiveRuleToCssReact(rule);
          if (cssProps.length > 0) {
            behaviorStyles.push(`@media (max-width: ${rule.maxWidth}px) { .${cls} { ${cssProps.join('; ')} } }`);
          }
        }
      }
    }
    if (n.children) for (const c of n.children) collectBehavior(c);
  }
  collectBehavior(node);

  // Phase 5: merge timeline animation classes into the behavior class map so
  // renderNode emits them on the element. Uses `nodeKey` (the same key
  // function collectBehavior uses) so state classes and animation classes
  // coexist on the same map entry. Unlike html.ts the nodeKey may not be
  // the raw node id — walk the tree to find INode whose id matches each
  // timeline-targeted id, then merge its key.
  if (timelineCss.perNodeClasses.size > 0) {
    const idToKey = new Map<string, string>();
    const walk = (n: INode) => {
      idToKey.set(n.id, nodeKey(n));
      if (n.children) for (const c of n.children) walk(c);
    };
    walk(node);
    for (const [nid, classes] of timelineCss.perNodeClasses) {
      const key = idToKey.get(nid);
      if (!key) continue;
      const existing = behaviorClassMap.get(key);
      const joined = classes.join(' ');
      behaviorClassMap.set(key, existing ? `${existing} ${joined}` : joined);
    }
  }

  const jsx = renderNode(node, true, indentSize, 1, useCssModules, cssClasses, () => `node${classCounter++}`, useImages, behaviorClassMap, phase3.byNode);

  const typeAnnotation = ts ? ': React.FC' : '';
  const imports: string[] = [`import React from 'react';`];
  if (useCssModules) {
    imports.push(`import styles from './${name}.module.css';`);
  }

  // Build style tag for :root tokens + states + responsive + animations, if any.
  const rootBlock = phase3.rootVars.size > 0
    ? `:root { ${[...phase3.rootVars].map(([k, v]) => `${k}: ${v}`).join('; ')} }`
    : '';
  const animationBlocks: string[] = [];
  if (timelineCss.keyframes) animationBlocks.push(timelineCss.keyframes);
  for (const rule of timelineCss.classRules.values()) animationBlocks.push(rule);
  const combinedStyles = [rootBlock, ...behaviorStyles, ...animationBlocks].filter(Boolean);
  const styleJsx = combinedStyles.length > 0
    ? `\n      <style>{\`\n        ${combinedStyles.join('\n        ')}\n      \`}</style>`
    : '';

  const lines: string[] = [
    ...imports,
    '',
    `const ${name}${typeAnnotation} = () => {`,
    `  return (`,
    `    <>`,
    jsx,
    styleJsx ? styleJsx : '',
    `    </>`,
    `  );`,
    `};`,
    '',
    `export default ${name};`,
    '',
  ].filter(l => l !== '');

  const result: ReactExportResult = { component: lines.join('\n') };

  if (useCssModules) {
    const cssLines: string[] = [];
    for (const [className, styleObj] of cssClasses) {
      cssLines.push(`.${className} {`);
      for (const [prop, val] of Object.entries(styleObj)) {
        cssLines.push(`  ${camelToKebab(prop)}: ${formatCssValue(prop, val)};`);
      }
      cssLines.push('}');
      cssLines.push('');
    }
    result.css = cssLines.join('\n');
  }

  return result;
}

// ─── Multi-file tree exporter (Phase 1) ──────────────────────

/**
 * Export an INode tree to a multi-file React project structure. The
 * result is byte-deterministic for a given input — no LLM, no AI
 * judgment. The skill layer (.claude/skills/reframe-to-react) picks
 * options on the user's behalf; this function executes them.
 *
 * Phase 1 (implemented): section extraction by semanticRole, entry
 *   page, tokens file, inline + css-modules targets.
 * Phase 2/3 (stubbed): extractPrimitives + extractHooks accept the
 *   option but currently no-op; result.manifest.notes documents this.
 *
 * The file paths in the returned map are POSIX-style relative paths
 * (e.g. `"src/components/sections/Hero.tsx"`). Callers join against
 * their project root to materialize files.
 */
export function exportToReactTree(
  node: INode,
  options?: ReactTreeOptions,
): ReactTreeResult {
  const target: ReactTreeTarget = options?.target ?? 'inline';
  const extractSections = options?.extractSections ?? true;
  const outputBase = (options?.outputBase ?? 'src').replace(/\/+$/, '');
  const pageSlug = slugify(options?.pageSlug ?? node.name ?? 'page');
  const ts = options?.typescript ?? true;
  const notes: string[] = [];

  // Phase 2/3 stubs — accept + document.
  if (options?.extractPrimitives) {
    notes.push(
      'extractPrimitives: NOT YET IMPLEMENTED — shape-hash subtree deduplication is planned. '
      + 'No primitives extracted; all content lives in section files.',
    );
  }
  if (options?.extractHooks) {
    notes.push(
      'extractHooks: NOT YET IMPLEMENTED — state-bearing node detection is planned. '
      + 'No hook files emitted.',
    );
  }
  if (target === 'tailwind') {
    notes.push(
      'target=tailwind: NOT YET IMPLEMENTED — falling back to inline styles. '
      + 'A tailwind.config.ts sketch is emitted with brand tokens if designSystem is provided.',
    );
  }
  if (target === 'styled-components') {
    notes.push(
      'target=styled-components: NOT YET IMPLEMENTED — falling back to inline styles.',
    );
  }

  const effectiveTarget: ReactTreeTarget =
    target === 'tailwind' || target === 'styled-components' ? 'inline' : target;

  const files: Record<string, string> = {};
  const sections: ReactTreeManifest['sections'] = [];

  // ── Identify section candidates ──
  const candidates = extractSections ? collectSectionCandidates(node) : [];

  // ── Emit each section file ──
  // Deterministic naming: semanticRole → PascalCase, fall back to node.name
  // if semanticRole absent, final fallback "SectionN" by index.
  const seenNames = new Set<string>();
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const rawName = c.semanticRole ?? c.node.name ?? `Section${i + 1}`;
    let name = toPascalCase(rawName);
    if (!name) name = `Section${i + 1}`;
    // Disambiguate duplicate names deterministically with a numeric suffix.
    if (seenNames.has(name)) {
      let suffix = 2;
      while (seenNames.has(`${name}${suffix}`)) suffix++;
      name = `${name}${suffix}`;
    }
    seenNames.add(name);

    const path = `${outputBase}/components/sections/${name}.tsx`;
    const content = renderSectionFile(c.node, name, {
      typescript: ts,
      target: effectiveTarget,
      baseOptions: options,
    });
    files[path] = content;
    sections.push({
      name,
      path,
      role: c.semanticRole,
      sourceNodeId: c.node.id,
    });
  }

  // ── Emit tokens file if designSystem provided ──
  let tokensPath: string | undefined;
  if (options?.designSystem) {
    tokensPath = `${outputBase}/styles/tokens.css`;
    files[tokensPath] = renderTokensCss(node, options.designSystem);

    // When target is tailwind, also emit a config sketch alongside so the
    // user sees the intended theme extension even though the components
    // currently use inline styles.
    if (target === 'tailwind') {
      files[`tailwind.config.ts`] = renderTailwindConfigSketch(options.designSystem);
    }
  }

  // ── Emit entry page ──
  const entryPath = `${outputBase}/pages/${pageSlug}.tsx`;
  files[entryPath] = renderEntryPage(node, sections, {
    typescript: ts,
    pageSlug,
    tokensRelPath: tokensPath ? relPath(entryPath, tokensPath) : null,
    // When no sections were extracted, fall back to single-file inline
    // render of the whole scene so the entry file is still usable.
    fallbackInline:
      sections.length === 0
        ? exportToReactModule(node, { ...options, componentName: toPascalCase(pageSlug) })
        : null,
  });

  return {
    files,
    entry: entryPath,
    manifest: {
      sections,
      primitives: [],
      hooks: [],
      tokensPath,
      target,
      notes,
    },
  };
}

// ─── Tree helpers ─────────────────────────────────────────────

interface SectionCandidate {
  node: INode;
  semanticRole: string | null;
}

/**
 * Walk the root node's direct children and pick ones that should be
 * extracted as separate section files. A direct child qualifies when:
 *   - it has a non-empty `semanticRole`, OR
 *   - the root has no semanticRole anywhere (fallback: treat every
 *     first-level child with ≥ 3 descendants as a section)
 *
 * Deeper subtrees stay inline within their section's file; only the
 * top-level structural rhythm of the page is split.
 */
function collectSectionCandidates(root: INode): SectionCandidate[] {
  if (!root.children || root.children.length === 0) return [];

  const withRoles: SectionCandidate[] = [];
  const withoutRoles: SectionCandidate[] = [];

  for (const child of root.children) {
    if (child.removed || child.visible === false) continue;
    const role = ((child as any).semanticRole as string | undefined)?.trim() || null;
    if (role) {
      withRoles.push({ node: child, semanticRole: role });
    } else {
      withoutRoles.push({ node: child, semanticRole: null });
    }
  }

  // If at least one child has a semanticRole, use those exclusively —
  // the classifier has opinions, trust them.
  if (withRoles.length > 0) return withRoles;

  // Otherwise, fall back: treat children with sufficient content as
  // sections. Threshold of 3 descendants avoids promoting leaf text
  // spans into their own files.
  return withoutRoles.filter((c) => countDescendants(c.node) >= 3);
}

function countDescendants(n: INode): number {
  let count = 0;
  const walk = (m: INode) => {
    if (m.children) {
      for (const c of m.children) {
        if (c.removed || c.visible === false) continue;
        count++;
        walk(c);
      }
    }
  };
  walk(n);
  return count;
}

/**
 * Emit a single section file. Delegates to the existing single-node
 * renderer (exportToReactModule) with the section node as the root so
 * behavior / timelines / tokens all carry through. The result's component
 * is wrapped in a minimal default-export with the chosen name.
 */
function renderSectionFile(
  node: INode,
  name: string,
  ctx: {
    typescript: boolean;
    target: ReactTreeTarget;
    baseOptions?: ReactTreeOptions;
  },
): string {
  const { component, css } = exportToReactModule(node, {
    ...(ctx.baseOptions ?? {}),
    componentName: name,
    typescript: ctx.typescript,
    cssModules: ctx.target === 'css-modules',
  });

  // exportToReactModule already emits the full file shape (imports,
  // component, default export). For css-modules target the CSS lives
  // in a sibling file which we represent via a conventional import path
  // alongside the component — caller materializes both.
  if (ctx.target === 'css-modules' && css) {
    return [
      component,
      '',
      `/* ${name}.module.css is emitted separately (caller materializes side-by-side) */`,
    ].join('\n');
  }

  return component;
}

/**
 * Emit the page-level entry file that imports each section in order
 * and renders them inside a layout wrapper. Tokens stylesheet is
 * imported at top when present. Falls back to a single-component
 * re-export when no sections were extracted.
 */
function renderEntryPage(
  root: INode,
  sections: ReactTreeManifest['sections'],
  ctx: {
    typescript: boolean;
    pageSlug: string;
    tokensRelPath: string | null;
    fallbackInline: ReactExportResult | null;
  },
): string {
  const typeAnnotation = ctx.typescript ? ': React.FC' : '';
  const pascalSlug = toPascalCase(ctx.pageSlug) || 'Page';

  // Fallback: no sections extracted → just re-emit the whole scene here
  // rather than leaving an empty page. Keeps the output useful even on
  // scenes without semantic roles.
  if (ctx.fallbackInline) {
    const header = [
      `// Auto-generated by reframe exportToReactTree (single-file fallback).`,
      `// No sections with semanticRole were found in the scene — the full`,
      `// tree is rendered inline here. Re-run with semanticRole set on`,
      `// top-level children to get a split file tree.`,
      '',
    ].join('\n');
    return header + ctx.fallbackInline.component;
  }

  const lines: string[] = [
    `import React from 'react';`,
  ];
  if (ctx.tokensRelPath) {
    lines.push(`import '${ctx.tokensRelPath.replace(/\\/g, '/')}';`);
  }
  for (const s of sections) {
    const rel = relPath(`src/pages/${ctx.pageSlug}.tsx`, s.path)
      .replace(/\.tsx$/, '')
      .replace(/\\/g, '/');
    lines.push(`import ${s.name} from '${rel}';`);
  }
  lines.push('');
  lines.push(`const ${pascalSlug}${typeAnnotation} = () => {`);
  lines.push(`  return (`);
  lines.push(`    <>`);
  for (const s of sections) {
    lines.push(`      <${s.name} />`);
  }
  lines.push(`    </>`);
  lines.push(`  );`);
  lines.push(`};`);
  lines.push('');
  lines.push(`export default ${pascalSlug};`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Render a tokens.css file from the active DesignSystem. CSS custom
 * properties under `:root` — compatible with any React setup that can
 * import CSS. Deterministic: iteration order is the DS's own order.
 */
function renderTokensCss(_root: INode, ds: DesignSystem): string {
  const lines: string[] = [
    '/* Reframe-generated design tokens — do not edit by hand. */',
    '',
    ':root {',
  ];
  // Colors
  if (ds.colors.background) lines.push(`  --color-background: ${ds.colors.background};`);
  if (ds.colors.primary) lines.push(`  --color-primary: ${ds.colors.primary};`);
  if (ds.colors.accent) lines.push(`  --color-accent: ${ds.colors.accent};`);
  if (ds.colors.text) lines.push(`  --color-text: ${ds.colors.text};`);
  if (ds.colors.roles) {
    for (const [role, hex] of ds.colors.roles) {
      lines.push(`  --color-${role}: ${hex};`);
    }
  }
  // Typography
  if (ds.typography.primaryFont) lines.push(`  --font-primary: '${ds.typography.primaryFont}', sans-serif;`);
  if (ds.typography.secondaryFont) lines.push(`  --font-secondary: '${ds.typography.secondaryFont}', sans-serif;`);
  for (const rule of ds.typography.hierarchy ?? []) {
    lines.push(`  --font-size-${rule.role}: ${rule.fontSize}px;`);
  }
  // Radii
  const radii = ds.layout?.borderRadiusScale ?? [];
  for (let i = 0; i < radii.length; i++) {
    lines.push(`  --radius-${i}: ${radii[i]}px;`);
  }
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

/**
 * Sketch of a tailwind.config.ts extension. Emitted alongside the
 * tokens.css when target=tailwind — the user can merge it into their
 * existing config. Fully deterministic; the actual Tailwind-class
 * rendering in components is NOT YET implemented (target falls back
 * to inline styles; see manifest.notes).
 */
function renderTailwindConfigSketch(ds: DesignSystem): string {
  const colors: string[] = [];
  if (ds.colors.background) colors.push(`        background: '${ds.colors.background}',`);
  if (ds.colors.primary) colors.push(`        primary: '${ds.colors.primary}',`);
  if (ds.colors.accent) colors.push(`        accent: '${ds.colors.accent}',`);
  if (ds.colors.text) colors.push(`        text: '${ds.colors.text}',`);
  if (ds.colors.roles) {
    for (const [role, hex] of ds.colors.roles) colors.push(`        '${role}': '${hex}',`);
  }

  return [
    `// Reframe-generated Tailwind theme extension sketch.`,
    `// Merge this into your project's tailwind.config.ts under theme.extend.`,
    `// NOTE: component files currently render with inline styles; Tailwind-`,
    `// class rendering is planned (Phase 2). This file is reference-only.`,
    `import type { Config } from 'tailwindcss';`,
    ``,
    `const config: Partial<Config> = {`,
    `  theme: {`,
    `    extend: {`,
    `      colors: {`,
    ...colors,
    `      },`,
    `      fontFamily: {`,
    `        primary: ['${ds.typography.primaryFont ?? 'Inter'}', 'sans-serif'],`,
    ds.typography.secondaryFont
      ? `        secondary: ['${ds.typography.secondaryFont}', 'sans-serif'],`
      : '',
    `      },`,
    `    },`,
    `  },`,
    `};`,
    ``,
    `export default config;`,
    '',
  ].filter(l => l !== '').join('\n');
}

// ─── Path utilities ──────────────────────────────────────────

/**
 * Compute a POSIX-style relative path from `from` to `to`. Both inputs
 * should be paths within the same emitted tree (e.g. "src/pages/home.tsx"
 * → "src/components/sections/Hero.tsx" yields "../components/sections/Hero.tsx").
 *
 * Intentionally home-grown so the exporter stays dependency-free on node
 * platform APIs that would need polyfills for browser-test runs.
 */
function relPath(from: string, to: string): string {
  const fromParts = from.split('/').slice(0, -1);
  const toParts = to.split('/');
  let i = 0;
  while (
    i < fromParts.length
    && i < toParts.length - 1
    && fromParts[i] === toParts[i]
  ) i++;
  const ups = new Array(fromParts.length - i).fill('..').join('/');
  const down = toParts.slice(i).join('/');
  const joined = ups ? `${ups}/${down}` : `./${down}`;
  return joined;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'page';
}

function toPascalCase(s: string): string {
  return s
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

// ─── Node Rendering ───────────────────────────────────────────

/**
 * Decide the HTML tag for a node. The importer stamps `meta.sourceTag`
 * and `semanticRole` on every imported element, and honoring those here
 * turns `<button>Deploy</button>` into a real React `<button>` instead
 * of a styled `<div>`. Accessibility audits, screen readers, keyboard
 * focus, and form submission all depend on this being right.
 */
function tagForNode(node: INode): { tag: string; attrs: string } {
  const role = (node as any).semanticRole as string | undefined;
  const sourceTag = ((node as any).meta?.sourceTag as string | undefined) ?? '';
  const href = (node as any).href as string | undefined;

  // Interactive / semantic leaf tags first — they carry attributes too.
  if (role === 'link' || sourceTag === 'a') {
    const hrefAttr = href ? ` href="${href.replace(/"/g, '&quot;')}"` : '';
    return { tag: 'a', attrs: hrefAttr };
  }
  if (role === 'button' || sourceTag === 'button') {
    return { tag: 'button', attrs: ' type="button"' };
  }

  // Sectioning / landmark tags from raw source.
  const passthrough = new Set([
    'nav', 'header', 'footer', 'main', 'section', 'article', 'aside',
    'figure', 'figcaption', 'blockquote', 'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'label', 'pre', 'code',
  ]);
  if (passthrough.has(sourceTag)) return { tag: sourceTag, attrs: '' };

  return { tag: '', attrs: '' };
}

function renderNode(
  node: INode, isRoot: boolean, indentSize: number, depth: number,
  useCssModules: boolean, cssClasses: Map<string, Record<string, string | number>>,
  genClassName: () => string, useImages: boolean,
  behaviorClassMap?: Map<string, string>,
  phase3ByNode?: Map<string, Map<keyof TokenBindings, string>>,
): string {
  const pad = ' '.repeat(indentSize * (depth + 2));
  const style = computeStyle(node, isRoot);

  // Phase 3b: substitute hardcoded values with var(--token) references.
  // Operates on the already-computed style object so we don't duplicate the
  // switch-on-node-type logic that computeStyle/applyTextStyles carry.
  const tokenFields = phase3ByNode?.get(node.id);
  if (tokenFields) {
    if (tokenFields.has('fill')) {
      const v = `var(${tokenFields.get('fill')})`;
      // Text nodes bind fill → `color`, everything else → `background`.
      if (node.type === NodeType.Text) style.color = v;
      else style.background = v;
    }
    if (tokenFields.has('stroke') && style.borderColor !== undefined) {
      style.borderColor = `var(${tokenFields.get('stroke')})`;
    }
    if (tokenFields.has('cornerRadius')) {
      style.borderRadius = `var(${tokenFields.get('cornerRadius')})`;
    }
    if (tokenFields.has('fontSize')) {
      style.fontSize = `var(${tokenFields.get('fontSize')})`;
    }
    if (tokenFields.has('fontFamily')) {
      style.fontFamily = `var(${tokenFields.get('fontFamily')})`;
    }
  }

  const behaviorCls = behaviorClassMap?.get(nodeKey(node));
  let styleAttr: string;
  if (useCssModules) {
    const className = genClassName();
    cssClasses.set(className, style);
    styleAttr = behaviorCls
      ? `className={\`\${styles.${className}} ${behaviorCls}\`}`
      : `className={styles.${className}}`;
  } else {
    styleAttr = `style={${formatStyleObject(style, pad, indentSize)}}`;
    if (behaviorCls) styleAttr += ` className="${behaviorCls}"`;
  }

  // Image node
  if (hasImageFill(node) && useImages) {
    const src = getImageSrc(node);
    const alt = node.name || 'image';
    return `${pad}<img src="${src}" alt="${escapeJsx(alt)}" ${styleAttr} />`;
  }

  // VECTOR with preserved raw SVG — emit via dangerouslySetInnerHTML so
  // the original `<linearGradient>` / `<path>` / attribute casing makes
  // it to the DOM intact. JSX doesn't accept kebab-cased SVG attrs
  // directly, so string passthrough is the pragmatic fidelity win.
  const rawSvg = (node as any).meta?.svgMarkup as string | undefined;
  if (node.type === NodeType.Vector && rawSvg) {
    const escaped = rawSvg.replace(/`/g, '\\`').replace(/\$/g, '\\$');
    return `${pad}<div ${styleAttr} dangerouslySetInnerHTML={{ __html: \`${escaped}\` }} />`;
  }

  const semantic = tagForNode(node);

  // Text node — keep as leaf but honor headings/paragraphs/labels.
  if (node.type === NodeType.Text) {
    const text = escapeJsx(node.characters ?? '');
    const textTag = semantic.tag && /^(h[1-6]|p|label|a|button|code|li|blockquote)$/.test(semantic.tag)
      ? semantic.tag
      : 'span';
    const attrs = textTag === semantic.tag ? semantic.attrs : '';
    if (text.includes('\n')) {
      const lines = text.split('\n');
      const content = lines.map((l, i) => i < lines.length - 1 ? `${l}<br />` : l).join(`\n${pad}  `);
      return `${pad}<${textTag} ${styleAttr}${attrs}>\n${pad}  ${content}\n${pad}</${textTag}>`;
    }
    return `${pad}<${textTag} ${styleAttr}${attrs}>${text}</${textTag}>`;
  }

  // Container / shape — pick a semantic tag when the importer recorded one.
  const containerTag = semantic.tag || 'div';
  const containerAttrs = semantic.tag ? semantic.attrs : '';
  const children = (node.children ?? []).filter(c => !c.removed && c.visible !== false);

  if (children.length === 0) {
    return `${pad}<${containerTag} ${styleAttr}${containerAttrs} />`;
  }

  const childJsx = children
    .map(c => renderNode(c, false, indentSize, depth + 1, useCssModules, cssClasses, genClassName, useImages, behaviorClassMap, phase3ByNode))
    .join('\n');

  return `${pad}<${containerTag} ${styleAttr}${containerAttrs}>\n${childJsx}\n${pad}</${containerTag}>`;
}

// ─── Style Computation ────────────────────────────────────────

function computeStyle(node: INode, isRoot: boolean): Record<string, string | number> {
  const s: Record<string, string | number> = {};

  // Position & Size
  if (isRoot) {
    s.position = 'relative';
    s.width = node.width;
    s.height = node.height;
  } else {
    const isFlexChild = node.parent?.layoutMode && node.parent.layoutMode !== 'NONE';
    if (!isFlexChild) {
      s.position = 'absolute';
      s.left = node.x;
      s.top = node.y;
    }
    s.width = node.width;
    s.height = node.height;

    // Flex grow
    if (isFlexChild && node.layoutGrow && node.layoutGrow > 0) {
      s.flexGrow = node.layoutGrow;
    }

    // Align-self
    if (isFlexChild && node.layoutAlignSelf && node.layoutAlignSelf !== 'AUTO') {
      const asMap: Record<string, string> = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', STRETCH: 'stretch' };
      if (asMap[node.layoutAlignSelf]) s.alignSelf = asMap[node.layoutAlignSelf];
    }
  }

  // Layout (flex)
  if (node.layoutMode && node.layoutMode !== 'NONE') {
    s.display = 'flex';
    s.flexDirection = node.layoutMode === 'HORIZONTAL' ? 'row' : 'column';

    if (node.primaryAxisAlign) {
      const map: Record<string, string> = {
        MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', SPACE_BETWEEN: 'space-between',
      };
      if (map[node.primaryAxisAlign]) s.justifyContent = map[node.primaryAxisAlign];
    }

    if (node.counterAxisAlign) {
      const map: Record<string, string> = {
        MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', STRETCH: 'stretch', BASELINE: 'baseline',
      };
      if (map[node.counterAxisAlign]) s.alignItems = map[node.counterAxisAlign];
    }

    // Gap
    if (node.itemSpacing && node.counterAxisSpacing) {
      s.gap = `${node.counterAxisSpacing}px ${node.itemSpacing}px`;
    } else if (node.itemSpacing) {
      s.gap = node.itemSpacing;
    } else if (node.counterAxisSpacing) {
      s.rowGap = node.counterAxisSpacing;
    }

    if (node.layoutWrap === 'WRAP') s.flexWrap = 'wrap';
  }

  // Padding
  const pt = node.paddingTop, pr = node.paddingRight, pb = node.paddingBottom, pl = node.paddingLeft;
  if (pt || pr || pb || pl) {
    if (pt === pr && pr === pb && pb === pl && pt) {
      s.padding = pt;
    } else {
      s.padding = `${pt ?? 0}px ${pr ?? 0}px ${pb ?? 0}px ${pl ?? 0}px`;
    }
  }

  // Background
  const bg = computeBackground(node);
  if (bg) s.background = bg;

  // Border
  if (node.independentStrokeWeights) {
    const stroke = node.strokes?.find(st => st.type === 'SOLID' && st.visible !== false);
    if (stroke) {
      const solid = stroke as ISolidPaint;
      const color = colorToRgba(solid.color, solid.opacity);
      s.borderStyle = 'solid';
      s.borderColor = color;
      s.borderWidth = `${node.borderTopWeight ?? 0}px ${node.borderRightWeight ?? 0}px ${node.borderBottomWeight ?? 0}px ${node.borderLeftWeight ?? 0}px`;
    }
  } else {
    const border = computeBorder(node);
    if (border) s.border = border;
  }

  // Border radius
  const radius = computeBorderRadius(node);
  if (radius) s.borderRadius = radius;

  // Effects (box-shadow)
  const shadow = computeBoxShadow(node);
  if (shadow) s.boxShadow = shadow;

  // Opacity
  if (node.opacity !== undefined && node.opacity < 1) {
    s.opacity = round(node.opacity);
  }

  // Rotation
  if (node.rotation !== undefined && node.rotation !== 0) {
    s.transform = `rotate(${round(node.rotation)}deg)`;
  }

  // Blend mode
  if (node.blendMode && node.blendMode !== 'PASS_THROUGH' && node.blendMode !== 'NORMAL') {
    s.mixBlendMode = node.blendMode.toLowerCase().replace(/_/g, '-');
  }

  // Clip
  if (node.clipsContent) s.overflow = 'hidden';

  // Blur filter
  if (node.effects) {
    const blurEffect = node.effects.find(e => e.visible !== false && (e.type === 'LAYER_BLUR' || e.type === 'BLUR'));
    if (blurEffect) {
      s.filter = `blur(${blurEffect.radius ?? 0}px)`;
    }
  }

  // Text styles
  if (node.type === NodeType.Text) {
    applyTextStyles(s, node);
  }

  // Ellipse → 50% border radius
  if (node.type === NodeType.Ellipse) {
    s.borderRadius = '50%';
  }

  return s;
}

function applyTextStyles(s: Record<string, string | number>, node: INode): void {
  const fontSize = node.fontSize;
  if (typeof fontSize === 'number') s.fontSize = fontSize;

  if (node.fontFamily) s.fontFamily = `"${node.fontFamily}", sans-serif`;
  if (node.fontWeight && node.fontWeight !== 400) s.fontWeight = node.fontWeight;
  if (node.italic) s.fontStyle = 'italic';

  // Text color from fills
  const textColor = getFirstSolidFill(node);
  if (textColor) s.color = colorToRgba(textColor.color, textColor.opacity);

  // Alignment
  if (node.textAlignHorizontal === 'CENTER') s.textAlign = 'center';
  else if (node.textAlignHorizontal === 'RIGHT') s.textAlign = 'right';
  else if (node.textAlignHorizontal === 'JUSTIFIED') s.textAlign = 'justify';

  // Line height
  if (node.lineHeight && node.lineHeight !== MIXED) {
    if (typeof node.lineHeight === 'number') {
      s.lineHeight = `${node.lineHeight}px`;
    } else if (typeof node.lineHeight === 'object' && 'value' in node.lineHeight) {
      s.lineHeight = node.lineHeight.unit === 'PERCENT'
        ? round(node.lineHeight.value / 100)
        : `${node.lineHeight.value}px`;
    }
  }

  // Letter spacing
  if (node.letterSpacing && node.letterSpacing !== MIXED) {
    if (typeof node.letterSpacing === 'number') {
      s.letterSpacing = `${node.letterSpacing}px`;
    } else if (typeof node.letterSpacing === 'object' && 'value' in node.letterSpacing) {
      s.letterSpacing = `${node.letterSpacing.value}px`;
    }
  }

  // Decoration
  if (node.textDecoration === 'UNDERLINE') s.textDecoration = 'underline';
  else if (node.textDecoration === 'STRIKETHROUGH') s.textDecoration = 'line-through';

  // Case
  if (node.textCase === 'UPPER') s.textTransform = 'uppercase';
  else if (node.textCase === 'LOWER') s.textTransform = 'lowercase';
  else if (node.textCase === 'TITLE') s.textTransform = 'capitalize';

  // Text truncation
  if (node.textTruncation === 'ENDING' && node.maxLines && node.maxLines > 0) {
    s.overflow = 'hidden';
    s.textOverflow = 'ellipsis';
    if (node.maxLines === 1) {
      s.whiteSpace = 'nowrap';
    } else {
      s.display = '-webkit-box';
      (s as any).WebkitLineClamp = node.maxLines;
      (s as any).WebkitBoxOrient = 'vertical';
    }
  }
}

// ─── Style Helpers ────────────────────────────────────────────

function hasImageFill(node: INode): boolean {
  if (!node.fills || node.fills === MIXED) return false;
  return node.fills.some(f => f.type === 'IMAGE');
}

function getImageSrc(node: INode): string {
  if (!node.fills || node.fills === MIXED) return '';
  const img = node.fills.find(f => f.type === 'IMAGE');
  if (!img) return '';
  return (img as any).imageHash ?? '';
}

function getFirstSolidFill(node: INode): ISolidPaint | null {
  if (!node.fills || node.fills === MIXED) return null;
  const fill = node.fills.find(f => f.type === 'SOLID' && f.visible !== false);
  return fill ? fill as ISolidPaint : null;
}

function computeBackground(node: INode): string | null {
  if (!node.fills || node.fills === MIXED) return null;
  if (node.type === NodeType.Text) return null;
  if (hasImageFill(node)) return null; // images rendered as <img>

  const visible = node.fills.filter(f => f.visible !== false);
  if (visible.length === 0) return null;

  const backgrounds: string[] = [];
  for (const fill of visible) {
    if (fill.type === 'SOLID') {
      const solid = fill as ISolidPaint;
      backgrounds.push(colorToRgba(solid.color, solid.opacity));
    } else if (fill.type === 'GRADIENT_LINEAR' && 'gradientStops' in fill) {
      const stops = ((fill as any).gradientStops ?? []) as GradientStop[];
      const gt = (fill as any).gradientTransform;
      const anglePrefix = gt ? `${round(gradientTransformToAngle(gt))}deg, ` : '';
      backgrounds.push(`linear-gradient(${anglePrefix}${stops.map(gs => `${colorToRgba(gs.color)} ${round(gs.position * 100)}%`).join(', ')})`);
    } else if (fill.type === 'GRADIENT_RADIAL' && 'gradientStops' in fill) {
      const stops = ((fill as any).gradientStops ?? []) as GradientStop[];
      backgrounds.push(`radial-gradient(${stops.map(gs => `${colorToRgba(gs.color)} ${round(gs.position * 100)}%`).join(', ')})`);
    }
  }

  return backgrounds.length > 0 ? backgrounds.join(', ') : null;
}

interface GradientStop { color: { r: number; g: number; b: number; a?: number }; position: number }

function computeBorder(node: INode): string | null {
  if (!node.strokes || node.strokes.length === 0) return null;
  const stroke = node.strokes.find(s => s.type === 'SOLID' && s.visible !== false);
  if (!stroke) return null;
  const solid = stroke as ISolidPaint;
  const weight = (typeof node.strokeWeight === 'number') ? node.strokeWeight : 1;
  return `${weight}px solid ${colorToRgba(solid.color, solid.opacity)}`;
}

function computeBorderRadius(node: INode): string | null {
  if (node.topLeftRadius || node.topRightRadius || node.bottomLeftRadius || node.bottomRightRadius) {
    const tl = node.topLeftRadius ?? 0;
    const tr = node.topRightRadius ?? 0;
    const br = node.bottomRightRadius ?? 0;
    const bl = node.bottomLeftRadius ?? 0;
    if (tl === tr && tr === br && br === bl) return `${tl}px`;
    return `${tl}px ${tr}px ${br}px ${bl}px`;
  }
  if (node.cornerRadius && node.cornerRadius !== MIXED && typeof node.cornerRadius === 'number' && node.cornerRadius > 0) {
    return `${node.cornerRadius}px`;
  }
  return null;
}

function computeBoxShadow(node: INode): string | null {
  if (!node.effects || node.effects.length === 0) return null;
  const shadows = node.effects
    .filter(e => e.visible !== false && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'))
    .map(e => {
      const offset = (e as any).offset ?? { x: 0, y: 0 };
      const radius = e.radius ?? 0;
      const spread = (e as any).spread ?? 0;
      const color = (e as any).color ? colorToRgba((e as any).color) : 'rgba(0,0,0,0.25)';
      const inset = e.type === 'INNER_SHADOW' ? 'inset ' : '';
      return `${inset}${offset.x}px ${offset.y}px ${radius}px ${spread}px ${color}`;
    });
  return shadows.length > 0 ? shadows.join(', ') : null;
}

// ─── Utilities ────────────────────────────────────────────────

function colorToRgba(color: { r: number; g: number; b: number; a?: number }, opacity?: number): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = round((color.a ?? 1) * (opacity ?? 1));
  if (a >= 1) {
    // Use hex for clean output
    const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    return hex;
  }
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Stable key for a node (used to match behavior classes) */
function nodeKey(node: INode): string {
  return node.id ?? `${node.name}:${node.x}:${node.y}`;
}

/** Convert StateOverride to CSS properties */
function stateOverrideToCssReact(override: StateOverride): string[] {
  const props: string[] = [];
  if (override.fills && override.fills.length > 0) {
    const fill = override.fills[0] as any;
    if (fill?.type === 'SOLID' && fill.color) {
      props.push(`background: ${colorToRgba(fill.color, fill.opacity)}`);
    }
  }
  if (override.opacity !== undefined) props.push(`opacity: ${round(override.opacity)}`);
  if (override.cornerRadius !== undefined) props.push(`border-radius: ${override.cornerRadius}px`);
  if (override.fontSize !== undefined) props.push(`font-size: ${override.fontSize}px`);
  if (override.fontWeight !== undefined) props.push(`font-weight: ${override.fontWeight}`);
  return props;
}

/** Convert ResponsiveRule to CSS properties */
function responsiveRuleToCssReact(rule: ResponsiveRule): string[] {
  const props: string[] = [];
  const p = rule.props as any;
  if (p.width !== undefined) props.push(`width: ${p.width}px`);
  if (p.height !== undefined) props.push(`height: ${p.height}px`);
  if (p.fontSize !== undefined) props.push(`font-size: ${p.fontSize}px`);
  if (p.fontWeight !== undefined) props.push(`font-weight: ${p.fontWeight}`);
  if (p.opacity !== undefined) props.push(`opacity: ${p.opacity}`);
  if (p.visible === false) props.push('display: none');
  if (p.layoutMode !== undefined) {
    props.push(`flex-direction: ${p.layoutMode === 'VERTICAL' ? 'column' : 'row'}`);
  }
  return props;
}

function gradientTransformToAngle(t: { m00: number; m01: number; m02: number; m10: number; m11: number; m12: number }): number {
  const rad = Math.atan2(t.m01, t.m00);
  return ((rad * 180 / Math.PI) + 90 + 360) % 360;
}

function escapeJsx(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/{/g, '&#123;')
    .replace(/}/g, '&#125;');
}

function sanitizeComponentName(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .replace(/^[0-9]+/, '')
    .replace(/[-_\s]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^(.)/, (_, c) => c.toUpperCase());
  return cleaned || 'Design';
}

function formatStyleObject(style: Record<string, string | number>, pad: string, indent: number): string {
  const entries = Object.entries(style);
  if (entries.length === 0) return '{}';
  if (entries.length <= 3) {
    const pairs = entries.map(([k, v]) => `${k}: ${formatStyleValue(v)}`).join(', ');
    return `{ ${pairs} }`;
  }
  const inner = ' '.repeat(indent);
  const pairs = entries.map(([k, v]) => `${pad}${inner}${k}: ${formatStyleValue(v)},`).join('\n');
  return `{\n${pairs}\n${pad}}`;
}

function formatStyleValue(v: string | number): string {
  if (typeof v === 'number') return String(v);
  return `'${v}'`;
}

function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);
}

function formatCssValue(prop: string, val: string | number): string {
  if (typeof val === 'number') {
    // Properties that don't need units
    const unitless = new Set(['opacity', 'fontWeight', 'flexGrow', 'flexShrink', 'zIndex', 'lineHeight']);
    if (unitless.has(prop)) return String(val);
    return `${val}px`;
  }
  return val;
}
