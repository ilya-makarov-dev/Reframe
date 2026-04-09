/**
 * Theme system — brand context that flows through all UI components.
 *
 * createTheme() → Theme object. Pass to themed() wrapper or use theme.color.primary directly.
 *
 * Usage:
 *   const t = createTheme({ primary: '#6366f1', bg: '#09090b', text: '#fafafa' });
 *   heading('Title', { fills: [solid(t.color.text)] });
 *   button('Click', { color: t.color.primary });
 *
 * Or with the themed helpers:
 *   const { H1, H2, Body, Button, Card, Page } = themed(t);
 *   Page(H1('Title'), Body('Text'), Button('Click'));
 */

import { solid } from '../builder.js';
import type { NodeBlueprint, NodeProps } from '../builder.js';
import { parseDesignMd } from '../design-system/index.js';
import type { DesignSystem } from '../design-system/types.js';
import { heading, body, label, caption, display, mono, divider } from './atoms.js';
import { button as rawButton, card as rawCard, badge as rawBadge, chip as rawChip, tag as rawTag, link as rawLink, input as rawInput, navItem as rawNavItem, stat as rawStat, quote as rawQuote, listItem as rawListItem } from './composites.js';
import { page, stack, row, center } from './layout.js';
import { heroSection, featureGrid, pricingSection, testimonialSection, ctaSection, footerSection, navbarSection, logoBar, statsBar } from './sections.js';

// ─── Theme types ─────────────────────────────────────────────

export interface ThemeColors {
  primary: string;
  bg: string;
  text: string;
  muted: string;
  accent: string;
  surface: string;
  border: string;
  error: string;
  success: string;
  warning: string;
}

export interface ThemeTypography {
  fontFamily: string;
  monoFamily: string;
  display: number;
  h1: number;
  h2: number;
  h3: number;
  h4: number;
  body: number;
  small: number;
  tiny: number;
}

export interface ThemeSpacing {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
}

export interface ThemeRadii {
  sm: number;
  md: number;
  lg: number;
  xl: number;
  full: number;
}

export interface Theme {
  color: ThemeColors;
  type: ThemeTypography;
  space: ThemeSpacing;
  radius: ThemeRadii;
}

// ─── Create theme ────────────────────────────────────────────

export interface ThemeInput {
  primary?: string;
  bg?: string;
  text?: string;
  muted?: string;
  accent?: string;
  surface?: string;
  border?: string;
  error?: string;
  success?: string;
  warning?: string;
  fontFamily?: string;
  monoFamily?: string;
  spacingUnit?: number;
  radiusBase?: number;
}

/** Create a complete theme from partial input. Unset values get smart defaults. */
export function createTheme(input: ThemeInput = {}): Theme {
  const primary = input.primary ?? '#6366f1';
  const bg = input.bg ?? '#ffffff';
  const text = input.text ?? '#111827';
  const isDark = isDarkColor(bg);

  return {
    color: {
      primary,
      bg,
      text,
      muted: input.muted ?? (isDark ? '#a1a1aa' : '#6b7280'),
      accent: input.accent ?? primary,
      surface: input.surface ?? (isDark ? '#18181b' : '#f9fafb'),
      border: input.border ?? (isDark ? '#27272a' : '#e5e7eb'),
      error: input.error ?? '#ef4444',
      success: input.success ?? '#10b981',
      warning: input.warning ?? '#f59e0b',
    },
    type: {
      fontFamily: input.fontFamily ?? 'Inter',
      monoFamily: input.monoFamily ?? 'monospace',
      display: 64,
      h1: 48,
      h2: 36,
      h3: 28,
      h4: 24,
      body: 16,
      small: 13,
      tiny: 11,
    },
    space: {
      xs: (input.spacingUnit ?? 8) * 0.5,
      sm: input.spacingUnit ?? 8,
      md: (input.spacingUnit ?? 8) * 2,
      lg: (input.spacingUnit ?? 8) * 3,
      xl: (input.spacingUnit ?? 8) * 5,
      xxl: (input.spacingUnit ?? 8) * 8,
    },
    radius: {
      sm: input.radiusBase ?? 6,
      md: (input.radiusBase ?? 6) * 1.5,
      lg: (input.radiusBase ?? 6) * 2.5,
      xl: (input.radiusBase ?? 6) * 4,
      full: 9999,
    },
  };
}

function isDarkColor(hex: string): boolean {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) < 0.5;
}

// ─── Themed component factories ──────────────────────────────

/** Create themed component shortcuts bound to a specific theme. */
export function themed(t: Theme) {
  const textFill = [solid(t.color.text)];
  const mutedFill = [solid(t.color.muted)];
  const bgFill = [solid(t.color.bg)];
  const surfaceFill = [solid(t.color.surface)];

  return {
    // Text
    Display: (s: string, p?: Partial<NodeProps>) => display(s, { fills: textFill, fontFamily: t.type.fontFamily, ...p }),
    H1: (s: string, p?: Partial<NodeProps>) => heading(s, { level: 1, fills: textFill, fontFamily: t.type.fontFamily, ...p }),
    H2: (s: string, p?: Partial<NodeProps>) => heading(s, { level: 2, fills: textFill, fontFamily: t.type.fontFamily, ...p }),
    H3: (s: string, p?: Partial<NodeProps>) => heading(s, { level: 3, fills: textFill, fontFamily: t.type.fontFamily, ...p }),
    H4: (s: string, p?: Partial<NodeProps>) => heading(s, { level: 4, fills: textFill, fontFamily: t.type.fontFamily, ...p }),
    Body: (s: string, p?: Partial<NodeProps>) => body(s, { fills: textFill, fontFamily: t.type.fontFamily, ...p }),
    Muted: (s: string, p?: Partial<NodeProps>) => body(s, { fills: mutedFill, fontFamily: t.type.fontFamily, ...p }),
    Label: (s: string, p?: Partial<NodeProps>) => label(s, { fills: mutedFill, fontFamily: t.type.fontFamily, ...p }),
    Caption: (s: string, p?: Partial<NodeProps>) => caption(s, { fills: mutedFill, fontFamily: t.type.fontFamily, ...p }),
    Mono: (s: string, p?: Partial<NodeProps>) => mono(s, { fills: textFill, fontFamily: t.type.monoFamily, ...p }),

    // Interactive
    Button: (s: string, p?: Partial<NodeProps> & { variant?: 'filled' | 'outline' | 'ghost'; size?: 'sm' | 'md' | 'lg' }) =>
      rawButton(s, { color: t.color.primary, cornerRadius: t.radius.md, ...p }),
    Link: (s: string, p?: Partial<NodeProps>) => rawLink(s, { color: t.color.primary, ...p }),
    Input: (s: string, p?: Partial<NodeProps>) => rawInput(s, { ...p }),
    NavItem: (s: string, p?: Partial<NodeProps> & { active?: boolean }) => rawNavItem(s, { ...p }),

    // Containers
    Card: (props: Partial<NodeProps> & { pad?: number }, ...children: NodeBlueprint[]) =>
      rawCard({ fills: surfaceFill, cornerRadius: t.radius.lg, ...props }, ...children),

    // Labels
    Badge: (s: string, p?: Partial<NodeProps>) => rawBadge(s, { color: t.color.primary, ...p }),
    Tag: (s: string, p?: Partial<NodeProps> & { color?: string }) => rawTag(s, { color: t.color.success, ...p }),
    Chip: (s: string, p?: Partial<NodeProps>) => rawChip(s, { ...p }),

    // Layout shortcuts
    Divider: (p?: Partial<NodeProps>) => divider({ color: t.color.border, ...p }),

    // Sections (themed — auto-apply colors)
    Navbar: (p: { brand: string; links?: string[]; cta?: string }) =>
      navbarSection({ ...p, fills: [solid(t.color.bg)] }),
    Hero: (p: { badge?: string; headline: string; subheadline?: string; primaryCta?: string; secondaryCta?: string; caption?: string; align?: 'center' | 'left' }) =>
      heroSection({ ...p, fills: [solid(t.color.bg)] }),
    Features: (p: { title?: string; subtitle?: string; features: Array<{ tag?: string; tagColor?: string; title: string; description: string }>; columns?: 2 | 3 }) =>
      featureGrid({ ...p, fills: [solid(t.color.bg)] }),
    Pricing: (p: { title?: string; subtitle?: string; plans: Array<{ name: string; price: string; period?: string; description?: string; features: string[]; cta: string; highlighted?: boolean }> }) =>
      pricingSection({ ...p, fills: [solid(t.color.bg)] }),
    Testimonials: (p: { title?: string; testimonials: Array<{ quote: string; name: string; role: string; company?: string }> }) =>
      testimonialSection({ ...p, fills: [solid(t.color.bg)] }),
    CTA: (p: { headline: string; subheadline?: string; primaryCta?: string; secondaryCta?: string }) =>
      ctaSection({ ...p, fills: [solid(t.color.bg)] }),
    Footer: (p: { copyright: string; links?: string[] }) =>
      footerSection({ ...p, fills: [solid(t.color.surface)] }),
    Logos: (p: { title?: string; logos: string[] }) =>
      logoBar({ ...p, fills: [solid(t.color.bg)] }),
    Stats: (p: { stats: Array<{ value: string; label: string }> }) =>
      statsBar({ ...p, fills: [solid(t.color.surface)] }),

    // Page with auto-theme (no need for fills: [...])
    Page: (props: { w: number; h?: number } & Partial<NodeProps>, ...children: NodeBlueprint[]) =>
      page({ h: props.h ?? 8000, fills: [solid(t.color.bg)], ...props }, ...children),

    // Direct access
    theme: t,
    fill: (role: keyof ThemeColors) => [solid(t.color[role])],
    solid: (role: keyof ThemeColors, opacity?: number) => solid(t.color[role], opacity),
  };
}

// ─── Landing page builder ────────────────────────────────────

export interface LandingConfig {
  theme?: ThemeInput;
  width?: number;
  nav?: { brand: string; links?: string[]; cta?: string };
  hero?: { badge?: string; headline: string; subheadline?: string; primaryCta?: string; secondaryCta?: string; caption?: string };
  logos?: { title?: string; logos: string[] };
  features?: { title?: string; subtitle?: string; features: Array<{ tag?: string; tagColor?: string; title: string; description: string }>; columns?: 2 | 3 };
  stats?: { stats: Array<{ value: string; label: string }> };
  testimonials?: { title?: string; testimonials: Array<{ quote: string; name: string; role: string; company?: string }> };
  pricing?: { title?: string; subtitle?: string; plans: Array<{ name: string; price: string; period?: string; description?: string; features: string[]; cta: string; highlighted?: boolean }> };
  cta?: { headline: string; subheadline?: string; primaryCta?: string; secondaryCta?: string };
  footer?: { copyright: string; links?: string[] };
  /** Custom sections — NodeBlueprints inserted in order. Use `{ after: 'hero' }` to position. */
  custom?: Array<{ section: NodeBlueprint; after?: string }>;
}

/** Build a complete landing page from pure data. One function, zero layout code.
 *
 * ```typescript
 * const html = await landing({
 *   theme: { primary: '#6366f1', bg: '#000', text: '#fff' },
 *   nav: { brand: 'Acme', links: ['Docs', 'Pricing'], cta: 'Get Started' },
 *   hero: { headline: 'Build faster', cta: 'Try free' },
 *   features: { features: [{ title: 'Fast', description: '...' }] },
 *   footer: { copyright: '© 2026' },
 * });
 * ```
 */
export async function landing(config: LandingConfig): Promise<string> {
  const t = createTheme(config.theme ?? {});
  const ui = themed(t);
  const w = config.width ?? 1440;

  const sections: NodeBlueprint[] = [];
  const customAfter = new Map<string, NodeBlueprint[]>();
  for (const c of config.custom ?? []) {
    const key = c.after ?? '_end';
    if (!customAfter.has(key)) customAfter.set(key, []);
    customAfter.get(key)!.push(c.section);
  }

  function addSection(name: string, bp: NodeBlueprint) {
    sections.push(bp);
    for (const custom of customAfter.get(name) ?? []) sections.push(custom);
  }

  if (config.nav) addSection('nav', ui.Navbar(config.nav));
  if (config.hero) addSection('hero', ui.Hero(config.hero));
  if (config.logos) addSection('logos', ui.Logos(config.logos));
  if (config.features) addSection('features', ui.Features(config.features));
  if (config.stats) addSection('stats', ui.Stats(config.stats));
  if (config.testimonials) addSection('testimonials', ui.Testimonials(config.testimonials));
  if (config.pricing) addSection('pricing', ui.Pricing(config.pricing));
  if (config.cta) addSection('cta', ui.CTA(config.cta));
  if (config.footer) addSection('footer', ui.Footer(config.footer));
  for (const custom of customAfter.get('_end') ?? []) sections.push(custom);

  const { render: doRender } = await import('./render.js');
  return doRender(ui.Page({ w }, ...sections));
}

// ─── reframe() — the ONE function ────────────────────────────

export interface ReframePage {
  /** Page name (displayed in nav, used for slug). */
  name: string;
  /** URL slug (default: auto from name). */
  path?: string;
  /** Sections for this page. */
  sections: Array<Record<string, any>>;
}

export interface ReframeConfig {
  /** DESIGN.md content — full brand guide. Optional. */
  designMd?: string;
  /** Quick theme — colors, font, spacing. Optional. */
  theme?: ThemeInput;
  /** Width in pixels (default: 1440). */
  width?: number;
  /** Height in pixels (default: auto from content). */
  height?: number;
  /** Output format (default: 'html'). */
  format?: 'html' | 'svg' | 'react';

  /** The design — ANY blueprint tree. Design anything. */
  content?: Record<string, any>;

  /** Page sections shorthand — wraps in a page container. */
  sections?: Array<Record<string, any>>;

  /** Multi-page site — array of pages with sections. */
  pages?: ReframePage[];
  /** Page transition preset (default: 'fadeSlideUp'). */
  transition?: 'fadeIn' | 'slideInUp' | 'slideInLeft' | 'fadeSlideUp' | 'none';
  /** Site title (for multi-page, shown in browser tab). */
  title?: string;
}

/**
 * The unified API. One function, design anything.
 *
 * ANYTHING — not just web pages:
 * ```typescript
 * // Landing page
 * await reframe({ sections: [
 *   { type: 'navbar', brand: 'Acme', cta: 'Start' },
 *   { type: 'hero', headline: 'Build faster' },
 * ]});
 *
 * // Dashboard
 * await reframe({ content: {
 *   type: 'row', children: [
 *     { type: 'sidebar', items: [{ label: 'Home' }, { label: 'Settings' }] },
 *     { type: 'stack', layoutGrow: 1, pad: 24, gap: 24, children: [
 *       { type: 'h2', text: 'Dashboard' },
 *       { type: 'row', gap: 16, children: [
 *         { type: 'card', children: [{ type: 'stat', value: '1,234', label: 'Users' }] },
 *         { type: 'card', children: [{ type: 'stat', value: '$45K', label: 'Revenue' }] },
 *       ]},
 *       { type: 'table', columns: ['Name', 'Status', 'Revenue'], rows: [...] },
 *     ]},
 *   ],
 * }});
 *
 * // Mobile screen
 * await reframe({ width: 390, height: 844, content: {
 *   type: 'stack', children: [
 *     { type: 'row', pad: [12, 16], justify: 'between', children: [...] },
 *     { type: 'stack', pad: 16, gap: 12, children: [...] },
 *   ],
 * }});
 *
 * // Email header
 * await reframe({ width: 600, content: {
 *   type: 'center', pad: [40, 20], children: [
 *     { type: 'h3', text: 'Welcome' },
 *     { type: 'button', text: 'Get Started' },
 *   ],
 * }});
 * ```
 *
 * Theme/DESIGN.md is optional brand context, not required workflow.
 * 120 component types available. Define/use for reusable components.
 */
export async function reframe(config: ReframeConfig): Promise<string> {
  const theme = config.designMd
    ? fromDesignMd(config.designMd)
    : config.theme ? createTheme(config.theme) : undefined;

  const { resolveBlueprint } = await import('./blueprint.js');
  const { render: doRender } = await import('./render.js');

  // ── Multi-page site ─────────────────────────────────────────
  if (config.pages && config.pages.length > 0) {
    const { build } = await import('../builder.js');
    const { StandaloneHost } = await import('../adapters/standalone/adapter.js');
    const { setHost } = await import('../host/context.js');
    const { exportSite } = await import('../exporters/site.js');

    // Ensure layout engine is ready
    try {
      const { initYoga } = await import('../engine/yoga-init.js');
      await initYoga();
    } catch (_) {}

    const pageNames = config.pages.map(p => p.name);
    const sitePages: Array<import('../exporters/site.js').SitePage> = [];

    for (const pageDef of config.pages) {
      const slug = pageDef.path?.replace(/^\//, '') || pageDef.name.toLowerCase().replace(/\s+/g, '-');

      // Auto-inject page links into navbar/footer sections
      const sections = pageDef.sections.map(s => {
        if (s.type === 'navbar' && !s._linkedPages) {
          // Auto-link nav items to pages
          const links = s.links ?? pageNames.filter(n => n !== pageDef.name);
          return { ...s, links, _linkedPages: pageNames, _currentPage: pageDef.name };
        }
        if (s.type === 'footer' && s.links && !s._linkedPages) {
          return { ...s, _linkedPages: pageNames };
        }
        return s;
      });

      const root = {
        type: 'page',
        w: config.width ?? 1440,
        h: config.height,
        children: sections,
      };

      const blueprint = resolveBlueprint(root, theme);
      const { graph, root: builtRoot } = build(blueprint);
      setHost(new StandaloneHost(graph));

      const { ensureSceneLayout } = await import('../engine/layout.js');
      ensureSceneLayout(graph, builtRoot.id);

      // Inject href into nav items and footer links pointing to other pages
      injectPageLinks(graph, builtRoot.id, pageNames, pageDef.name);

      sitePages.push({ slug, name: pageDef.name, graph, rootId: builtRoot.id });
    }

    return exportSite(sitePages, {
      title: config.title ?? pageNames[0],
      transition: config.transition,
    });
  }

  // ── Single page ─────────────────────────────────────────────
  let root: Record<string, any>;

  if (config.content) {
    // Direct content — any blueprint tree, wrap in page if not already
    if (config.content.type === 'page') {
      root = config.content;
      if (config.width) root.w = config.width;
      if (config.height) root.h = config.height;
    } else {
      root = {
        type: 'page',
        w: config.width ?? 1440,
        h: config.height,
        children: [config.content],
      };
    }
  } else if (config.sections) {
    // Sections shorthand — wrap in page
    root = {
      type: 'page',
      w: config.width ?? 1440,
      h: config.height,
      children: config.sections,
    };
  } else {
    throw new Error('reframe(): provide content, sections, or pages');
  }

  const blueprint = resolveBlueprint(root, theme);
  return doRender(blueprint, config.format ?? 'html');
}

/** Walk a built scene graph and inject href="#slug" on nav items matching page names. */
function injectPageLinks(
  graph: import('../engine/scene-graph.js').SceneGraph,
  rootId: string,
  pageNames: string[],
  currentPage: string,
) {
  const slugMap = new Map<string, string>();
  for (const name of pageNames) {
    slugMap.set(name.toLowerCase(), name.toLowerCase().replace(/\s+/g, '-'));
  }

  function walk(nodeId: string) {
    const node = graph.getNode(nodeId);
    if (!node) return;

    // Text nodes inside nav/button-like parents — check if text matches a page name
    if (node.type === 'TEXT' && node.text) {
      const lower = node.text.trim().toLowerCase();
      const slug = slugMap.get(lower);
      if (slug && lower !== currentPage.toLowerCase()) {
        // Set href on parent frame (the navItem/link wrapper)
        const parent = node.parentId ? graph.getNode(node.parentId) : null;
        if (parent && parent.type !== 'TEXT') {
          (parent as any).href = `#${slug}`;
        }
      }
    }

    for (const childId of node.childIds) {
      walk(childId);
    }
  }

  walk(rootId);
}

// ─── DESIGN.md → Theme bridge ────────────────────────────────

/** Create a Theme from a DESIGN.md string (awesome-design-md format).
 *
 * ```typescript
 * const t = fromDesignMd(fs.readFileSync('design-md/stripe/DESIGN.md', 'utf8'));
 * const ui = themed(t);
 * // All components auto-use Stripe's colors, fonts, spacing
 * ```
 */
export function fromDesignMd(markdown: string): Theme {
  const ds = parseDesignMd(markdown);
  return fromDesignSystem(ds);
}

/** Create a Theme from a parsed DesignSystem object. */
export function fromDesignSystem(ds: DesignSystem): Theme {
  const hero = ds.typography.hierarchy.find(r => r.role === 'hero');
  const body = ds.typography.hierarchy.find(r => r.role === 'body');
  const btn = ds.typography.hierarchy.find(r => r.role === 'button');

  const bg = ds.colors.background ?? '#ffffff';

  return {
    color: {
      primary: ds.colors.primary ?? '#6366f1',
      bg,
      text: ds.colors.text ?? '#111827',
      muted: ds.colors.roles?.get('body') ?? ds.colors.roles?.get('secondary') ?? (isDarkColor(bg) ? '#a1a1aa' : '#6b7280'),
      accent: ds.colors.accent ?? ds.colors.primary ?? '#6366f1',
      surface: ds.colors.roles?.get('surface') ?? ds.colors.roles?.get('panel') ?? (isDarkColor(bg) ? '#18181b' : '#f9fafb'),
      border: ds.colors.roles?.get('border') ?? ds.colors.roles?.get('border default') ?? (isDarkColor(bg) ? '#27272a' : '#e5e7eb'),
      error: ds.colors.roles?.get('error') ?? ds.colors.roles?.get('ruby') ?? '#ef4444',
      success: ds.colors.roles?.get('success') ?? ds.colors.roles?.get('green') ?? '#10b981',
      warning: ds.colors.roles?.get('warning') ?? ds.colors.roles?.get('lemon') ?? '#f59e0b',
    },
    type: {
      fontFamily: hero?.fontFamily ?? body?.fontFamily ?? 'Inter',
      monoFamily: 'monospace',
      display: hero?.fontSize ?? 64,
      h1: hero?.fontSize ?? 48,
      h2: ds.typography.hierarchy.find(r => r.role === 'title')?.fontSize ?? 36,
      h3: ds.typography.hierarchy.find(r => r.role === 'subtitle')?.fontSize ?? 28,
      h4: 24,
      body: body?.fontSize ?? 16,
      small: ds.typography.hierarchy.find(r => r.role === 'caption')?.fontSize ?? 13,
      tiny: 11,
    },
    space: {
      xs: (ds.layout.spacingUnit ?? 8) * 0.5,
      sm: ds.layout.spacingUnit ?? 8,
      md: (ds.layout.spacingUnit ?? 8) * 2,
      lg: (ds.layout.spacingUnit ?? 8) * 3,
      xl: (ds.layout.spacingUnit ?? 8) * 5,
      xxl: (ds.layout.spacingUnit ?? 8) * 8,
    },
    radius: {
      sm: ds.components.button?.borderRadius ?? 6,
      md: Math.round((ds.components.button?.borderRadius ?? 6) * 1.5),
      lg: Math.round((ds.components.button?.borderRadius ?? 6) * 2.5),
      xl: Math.round((ds.components.button?.borderRadius ?? 6) * 4),
      full: 9999,
    },
  };
}
