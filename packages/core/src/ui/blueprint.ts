/**
 * Blueprint resolver — JSON tree → @reframe/ui calls → NodeBlueprint.
 *
 * This is the bridge between MCP (JSON) and @reframe/ui (TypeScript).
 * The agent sends a blueprint tree in JSON, this module resolves each node
 * to the corresponding UI lib function call.
 *
 * Features:
 *   - 120+ component types (layout, atoms, composites, data, sections, etc.)
 *   - Define/use: define reusable components, instantiate with $variable substitution
 *   - Theme integration: fills/colors can reference theme roles via "theme.primary"
 *
 * Example with define/use:
 *   {
 *     "define": {
 *       "FeatureCard": {
 *         "type": "card", "pad": 32,
 *         "children": [
 *           { "type": "tag", "text": "$tag", "color": "$color" },
 *           { "type": "h4", "text": "$title" },
 *           { "type": "body", "text": "$desc", "muted": true }
 *         ]
 *       }
 *     },
 *     "type": "page", "w": 1440,
 *     "children": [
 *       { "use": "FeatureCard", "tag": "Fast", "title": "50ms", "desc": "..." },
 *       { "use": "FeatureCard", "tag": "Tested", "title": "19 rules", "desc": "..." }
 *     ]
 *   }
 */

import type { NodeBlueprint } from '../builder.js';
import type { Theme } from './theme.js';
import { solid, frame as rawFrame } from '../builder.js';

// Layout
import { page, stack, row, wrap, grid, center, spacer, container, overlay } from './layout.js';
// Atoms
import { heading, body, label, caption, display, mono, txt, box, circle, divider, vdivider, image, swatch } from './atoms.js';
// Composites
import { button, card, badge, chip, tag, avatar, stat, quote, listItem, navItem, link, input } from './composites.js';
// Data
import { table, tabs, accordion, progress, toggle, select, textarea, keyValue } from './data.js';
// Navigation
import { sidebar, breadcrumb, pagination, stepper, menuItem } from './navigation.js';
// Feedback
import { modal, toast, tooltip, alert, banner, emptyState, skeleton } from './feedback.js';
// Forms
import { checkbox, radio, slider, formGroup, formRow, searchInput, radioGroup, checkboxGroup } from './forms.js';
// Sections
import { heroSection, featureGrid, pricingSection, testimonialSection, ctaSection, footerSection, navbarSection, logoBar, statsBar } from './sections.js';

// ─── Types ───────────────────────────────────────────────────

export interface BlueprintNode {
  /** Component type (e.g. 'stack', 'heading', 'card', 'hero') */
  type?: string;
  /** Reference a defined component */
  use?: string;
  /** Define reusable components: { "CardTpl": { type: "card", ... } } */
  define?: Record<string, BlueprintNode>;
  /** Child nodes */
  children?: BlueprintNode[];
  /** Any props — passed to the component */
  [key: string]: any;
}

// ─── Variable substitution ───────────────────────────────────

/** Replace $variable references in a blueprint tree with actual values. */
function substituteVars(node: any, vars: Record<string, any>): any {
  if (typeof node === 'string') {
    if (node.startsWith('$')) {
      const key = node.slice(1);
      return vars[key] !== undefined ? vars[key] : node;
    }
    // Inline substitution: "Hello $name" → "Hello World"
    return node.replace(/\$(\w+)/g, (_, k) => vars[k] !== undefined ? String(vars[k]) : `$${k}`);
  }
  if (Array.isArray(node)) return node.map(item => substituteVars(item, vars));
  if (node && typeof node === 'object') {
    const result: any = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'define') { result[k] = v; continue; } // Don't substitute inside define blocks
      result[k] = substituteVars(v, vars);
    }
    return result;
  }
  return node;
}

// ─── Resolver ────────────────────────────────────────────────

/** Resolve a blueprint JSON tree into a NodeBlueprint using @reframe/ui functions.
 *
 *  Supports:
 *  - All 120+ @reframe/ui components via type name
 *  - define/use for reusable components with $variable substitution
 *  - Theme integration (fills: "theme.primary", color: "theme.accent")
 */
export function resolveBlueprint(
  node: BlueprintNode,
  theme?: Theme,
  defines?: Record<string, BlueprintNode>,
  _depth: number = 0,
): NodeBlueprint {
  // Guard against infinite recursion (circular references, deeply nested defines)
  if (_depth > 50) {
    throw new Error('Blueprint: maximum nesting depth exceeded (50). Possible circular reference in define/use.');
  }

  // Merge defines from this node with inherited defines
  const allDefines = { ...defines, ...node.define };

  // Handle "use" — reference a defined component
  if (node.use) {
    const template = allDefines?.[node.use];
    if (!template) {
      throw new Error(`Blueprint: undefined component "${node.use}". Available: ${Object.keys(allDefines ?? {}).join(', ') || 'none'}`);
    }
    // Extract variables (everything except "use", "define", "children")
    const { use: _, define: __, children: extraChildren, ...vars } = node;
    // Deep clone template to avoid mutating the define
    const resolved = substituteVars(JSON.parse(JSON.stringify(template)), vars);
    // If the use-site has children, append them to the resolved template's children
    if (extraChildren) {
      resolved.children = [...(resolved.children ?? []), ...extraChildren];
    }
    return resolveBlueprint(resolved, theme, allDefines, _depth + 1);
  }

  const { type, children: rawChildren, define: _d, use: _u, ...props } = node;
  const children = (rawChildren ?? [])
    .filter((c): c is BlueprintNode => c != null && typeof c === 'object')
    .map(c => resolveBlueprint(c, theme, allDefines, _depth + 1));

  // Apply theme colors where fills reference theme roles
  if (props.fills && theme) {
    props.fills = props.fills.map((f: any) => {
      if (typeof f === 'string' && f.startsWith('theme.')) {
        const role = f.replace('theme.', '') as keyof typeof theme.color;
        return solid(theme.color[role] ?? f);
      }
      if (typeof f === 'string') return solid(f);
      return f;
    });
  }

  // Resolve text color from theme
  if (props.color && typeof props.color === 'string' && props.color.startsWith('theme.') && theme) {
    props.color = theme.color[props.color.replace('theme.', '') as keyof typeof theme.color] ?? props.color;
  }

  switch (type) {
    // ── Layout ──────────────────────────────────────────
    case 'page':
      return page({ w: props.w ?? props.width ?? 1440, h: props.h ?? props.height ?? 8000, ...extractLayoutProps(props) }, ...children);
    case 'stack':
    case 'column':
      return stack(extractLayoutProps(props), ...children);
    case 'row':
    case 'horizontal':
      return row(extractLayoutProps(props), ...children);
    case 'wrap':
      return wrap(extractLayoutProps(props), ...children);
    case 'grid':
      return grid({ columns: props.columns, ...extractLayoutProps(props) }, ...children);
    case 'center':
      return center(extractLayoutProps(props), ...children);
    case 'spacer':
      return spacer(props.size);
    case 'container':
      return container(extractLayoutProps(props), ...children);
    case 'overlay':
      return overlay({ x: props.x, y: props.y, ...extractLayoutProps(props) }, ...children);

    // ── Atoms ────────────────────────────────────────────
    case 'heading':
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      const lvl = type.startsWith('h') ? parseInt(type[1]) : props.level ?? 1;
      return heading(props.text ?? props.characters ?? '', { level: lvl as any, ...extractTextProps(props, theme) });
    }
    case 'body':
    case 'text':
    case 'p':
      return body(props.text ?? props.characters ?? '', extractTextProps(props, theme));
    case 'label':
      return label(props.text ?? '', extractTextProps(props, theme));
    case 'caption':
    case 'small':
      return caption(props.text ?? '', extractTextProps(props, theme));
    case 'display':
    case 'hero-text':
      return display(props.text ?? props.characters ?? '', extractTextProps(props, theme));
    case 'mono':
    case 'code':
      return mono(props.text ?? props.characters ?? '', extractTextProps(props, theme));
    case 'txt':
    case 'raw-text':
      return txt(props.text ?? '', extractTextProps(props, theme));
    case 'box':
    case 'rect':
      return box(props);
    case 'circle':
      return circle(props.diameter ?? props.size ?? 40, props);
    case 'divider':
    case 'hr':
      return divider(props);
    case 'vdivider':
    case 'vertical-divider':
      return vdivider(props);
    case 'image':
    case 'img':
      return image(props.url ?? props.src ?? '', props);
    case 'swatch':
      return swatch(props.color ?? '#000', props.size ?? 24, props);

    // ── Composites ──────────────────────────────────────
    case 'button':
    case 'btn':
      return button(props.text ?? props.label ?? 'Button', {
        variant: props.variant, size: props.size, color: props.color, ...extractStyleProps(props),
      });
    case 'card':
      return card({ pad: props.pad ?? props.padding, ...extractStyleProps(props) }, ...children);
    case 'badge':
      return badge(props.text ?? props.label ?? '', { color: props.color, ...extractStyleProps(props) });
    case 'chip':
      return chip(props.text ?? '', props);
    case 'tag':
      return tag(props.text ?? props.label ?? '', { color: props.color, ...extractStyleProps(props) });
    case 'avatar':
      return avatar({ initials: props.initials, size: props.size, color: props.color, ...extractStyleProps(props) });
    case 'stat':
      return stat(props.value ?? '', props.label ?? '', extractTextProps(props, theme));
    case 'quote':
    case 'blockquote':
      return quote(props.text ?? '', props.author, extractTextProps(props, theme));
    case 'list-item':
    case 'listItem':
    case 'li':
      return listItem(props.text ?? '', { bullet: props.bullet, ...extractTextProps(props, theme) });
    case 'nav-item':
    case 'navItem':
      return navItem(props.text ?? props.label ?? '', { active: props.active, ...extractStyleProps(props) });
    case 'link':
    case 'a':
      return link(props.text ?? props.label ?? '', { color: props.color, ...extractStyleProps(props) });
    case 'input':
      return input(props.placeholder ?? '', { value: props.value, ...extractStyleProps(props) });

    // ── Data ────────────────────────────────────────────
    case 'table':
      return table({ columns: props.columns, rows: props.rows, ...props });
    case 'tabs':
      return tabs(props.items ?? props.labels ?? [], props.active ?? props.activeIndex ?? 0, props);
    case 'accordion':
      return accordion(props.items ?? [], props);
    case 'progress':
      return progress(props.value ?? 0, { color: props.color, showLabel: props.showLabel, ...extractStyleProps(props) });
    case 'toggle':
    case 'switch':
      return toggle(props.on ?? props.checked ?? false, { color: props.color, ...extractStyleProps(props) });
    case 'select':
    case 'dropdown':
      return select(props.value ?? '', props.options, extractStyleProps(props));
    case 'textarea':
      return textarea(props.content ?? props.text ?? '', { rows: props.rows, ...extractStyleProps(props) });
    case 'key-value':
    case 'keyValue':
    case 'kv':
      return keyValue(props.key ?? '', props.value ?? '', { direction: props.direction, ...extractStyleProps(props) });

    // ── Navigation ──────────────────────────────────────
    case 'sidebar':
      return sidebar(props.items ?? [], extractStyleProps(props));
    case 'breadcrumb':
      return breadcrumb(props.items ?? props.path ?? [], extractStyleProps(props));
    case 'pagination':
      return pagination(props.current ?? 1, props.total ?? 1, extractStyleProps(props));
    case 'stepper':
      return stepper(props.steps ?? [], props.current ?? props.currentStep ?? 0, extractStyleProps(props));
    case 'menu-item':
    case 'menuItem':
      return menuItem(props.text ?? props.label ?? '', { active: props.active, disabled: props.disabled, ...extractStyleProps(props) });

    // ── Feedback ────────────────────────────────────────
    case 'modal':
    case 'dialog':
      return modal({ title: props.title ?? '', width: props.width, ...extractStyleProps(props) }, ...children);
    case 'toast':
    case 'notification':
      return toast(props.message ?? props.text ?? '', { variant: props.variant, ...extractStyleProps(props) });
    case 'tooltip':
      return tooltip(props.text ?? '', extractStyleProps(props));
    case 'alert':
      return alert(props.message ?? props.text ?? '', { variant: props.variant, title: props.title, ...extractStyleProps(props) });
    case 'banner':
      return banner(props.message ?? props.text ?? '', { color: props.color, textColor: props.textColor, ...extractStyleProps(props) });
    case 'empty-state':
    case 'emptyState':
      return emptyState({ title: props.title ?? '', description: props.description, action: props.action, ...extractStyleProps(props) });
    case 'skeleton':
    case 'loader':
      return skeleton({ width: props.width, height: props.height, variant: props.variant, ...extractStyleProps(props) });

    // ── Forms ───────────────────────────────────────────
    case 'checkbox':
      return checkbox(props.checked ?? false, props.label, extractStyleProps(props));
    case 'radio':
      return radio(props.selected ?? false, props.label, extractStyleProps(props));
    case 'slider':
    case 'range':
      return slider(props.value ?? 0.5, extractStyleProps(props));
    case 'form-group':
    case 'formGroup':
    case 'field':
      return formGroup(props.label ?? '', children, extractStyleProps(props));
    case 'form-row':
    case 'formRow':
      return formRow(children, extractStyleProps(props));
    case 'search':
    case 'searchInput':
      return searchInput(props.placeholder, extractStyleProps(props));
    case 'radio-group':
    case 'radioGroup':
      return radioGroup(props.options ?? [], props.selected ?? 0, extractStyleProps(props));
    case 'checkbox-group':
    case 'checkboxGroup':
      return checkboxGroup(props.options ?? [], props.checked ?? [], extractStyleProps(props));

    // ── Sections (themed) ───────────────────────────────
    case 'hero':
    case 'heroSection': {
      const sectionFills = theme ? [solid(theme.color.bg)] : undefined;
      return heroSection({ headline: props.headline ?? '', subheadline: props.subheadline, badge: props.badge, primaryCta: props.primaryCta ?? props.cta, secondaryCta: props.secondaryCta, caption: props.caption, align: props.align, fills: sectionFills, ...extractStyleProps(props) });
    }
    case 'features':
    case 'featureGrid': {
      const sectionFills = theme ? [solid(theme.color.bg)] : undefined;
      return featureGrid({ title: props.title, subtitle: props.subtitle, features: props.features ?? props.items ?? [], columns: props.columns, fills: sectionFills, ...extractStyleProps(props) });
    }
    case 'pricing':
    case 'pricingSection': {
      const sectionFills = theme ? [solid(theme.color.bg)] : undefined;
      return pricingSection({ title: props.title, subtitle: props.subtitle, plans: props.plans ?? [], fills: sectionFills, ...extractStyleProps(props) });
    }
    case 'testimonials':
    case 'testimonialSection': {
      const sectionFills = theme ? [solid(theme.color.bg)] : undefined;
      return testimonialSection({ title: props.title, testimonials: props.testimonials ?? props.items ?? [], fills: sectionFills, ...extractStyleProps(props) });
    }
    case 'cta':
    case 'ctaSection': {
      const sectionFills = theme ? [solid(theme.color.bg)] : undefined;
      return ctaSection({ headline: props.headline ?? '', subheadline: props.subheadline, primaryCta: props.primaryCta ?? props.cta, secondaryCta: props.secondaryCta, fills: sectionFills, ...extractStyleProps(props) });
    }
    case 'footer':
    case 'footerSection': {
      const sectionFills = theme ? [solid(theme.color.surface)] : undefined;
      return footerSection({ copyright: props.copyright ?? '', links: props.links, fills: sectionFills, ...extractStyleProps(props) });
    }
    case 'navbar':
    case 'navbarSection':
    case 'nav': {
      const sectionFills = theme ? [solid(theme.color.bg)] : undefined;
      return navbarSection({ brand: props.brand ?? '', links: props.links, cta: props.cta, fills: sectionFills, ...extractStyleProps(props) });
    }
    case 'logos':
    case 'logoBar': {
      const sectionFills = theme ? [solid(theme.color.bg)] : undefined;
      return logoBar({ title: props.title, logos: props.logos ?? props.items ?? [], fills: sectionFills, ...extractStyleProps(props) });
    }
    case 'stats':
    case 'statsBar': {
      const sectionFills = theme ? [solid(theme.color.surface)] : undefined;
      return statsBar({ stats: props.stats ?? props.items ?? [], fills: sectionFills, ...extractStyleProps(props) });
    }

    // ── Fallback: raw frame ─────────────────────────────
    default:
      return rawFrame(extractLayoutProps(props), ...children);
  }
}

// ─── Prop extractors ─────────────────────────────────────────

function extractLayoutProps(props: Record<string, any>) {
  const p: Record<string, any> = {};
  // Layout shorthands
  if (props.pad !== undefined) p.pad = props.pad;
  if (props.padding !== undefined) p.pad = props.padding;
  if (props.gap !== undefined) p.gap = props.gap;
  if (props.justify !== undefined) p.justify = props.justify;
  if (props.align !== undefined) p.align = props.align;
  if (props.w !== undefined) p.w = props.w;
  if (props.h !== undefined) p.h = props.h;
  if (props.width !== undefined) p.w = props.width;
  if (props.height !== undefined) p.h = props.height;
  // Pass through other style props
  Object.assign(p, extractStyleProps(props));
  return p;
}

function extractStyleProps(props: Record<string, any>) {
  const skip = new Set(['type', 'children', 'text', 'characters', 'label', 'w', 'h', 'width', 'height',
    'pad', 'padding', 'gap', 'justify', 'align', 'items', 'columns', 'rows', 'options',
    'headline', 'subheadline', 'primaryCta', 'secondaryCta', 'badge', 'brand', 'links',
    'copyright', 'plans', 'testimonials', 'features', 'stats', 'logos', 'path', 'steps',
    'current', 'total', 'currentStep', 'message', 'title', 'subtitle', 'description',
    'action', 'variant', 'size', 'level', 'muted', 'bold', 'active', 'disabled', 'checked',
    'selected', 'on', 'value', 'key', 'direction', 'placeholder', 'content',
    'author', 'bullet', 'initials', 'diameter', 'url', 'src', 'fit',
    'color', 'textColor', 'showLabel', 'activeIndex',
    'headerColor', 'headerTextColor', 'cellColor', 'textColor', 'borderColor', 'striped',
  ]);
  const p: Record<string, any> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!skip.has(k) && v !== undefined) p[k] = v;
  }
  return p;
}

function extractTextProps(props: Record<string, any>, theme?: Theme) {
  const p: Record<string, any> = {};
  if (props.fontSize) p.fontSize = props.fontSize;
  if (props.fontWeight) p.fontWeight = props.fontWeight;
  if (props.fontFamily) p.fontFamily = props.fontFamily;
  if (props.letterSpacing) p.letterSpacing = props.letterSpacing;
  if (props.lineHeight) p.lineHeight = props.lineHeight;
  if (props.italic) p.italic = props.italic;
  if (props.textAlign) p.textAlignHorizontal = props.textAlign;
  if (props.textAlignHorizontal) p.textAlignHorizontal = props.textAlignHorizontal;
  if (props.muted) p.muted = true;
  if (props.bold) p.bold = true;
  if (props.fills) p.fills = props.fills;
  if (props.opacity) p.opacity = props.opacity;
  // Auto-apply text color from theme if no fills specified
  if (!p.fills && theme) {
    p.fills = props.muted ? [solid(theme.color.muted)] : [solid(theme.color.text)];
  }
  Object.assign(p, extractStyleProps(props));
  return p;
}

// ─── List all available component types (for tool description) ───

export const BLUEPRINT_TYPES = {
  layout: ['page', 'stack', 'row', 'wrap', 'grid', 'center', 'spacer', 'container', 'overlay'],
  text: ['heading/h1-h6', 'body/text/p', 'label', 'caption', 'display', 'mono/code', 'txt'],
  shapes: ['box/rect', 'circle', 'divider/hr', 'image/img', 'swatch'],
  composites: ['button/btn', 'card', 'badge', 'chip', 'tag', 'avatar', 'stat', 'quote', 'listItem/li', 'navItem', 'link/a', 'input'],
  data: ['table', 'tabs', 'accordion', 'progress', 'toggle/switch', 'select/dropdown', 'textarea', 'keyValue/kv'],
  navigation: ['sidebar', 'breadcrumb', 'pagination', 'stepper', 'menuItem'],
  feedback: ['modal/dialog', 'toast', 'tooltip', 'alert', 'banner', 'emptyState', 'skeleton'],
  forms: ['checkbox', 'radio', 'slider', 'formGroup/field', 'formRow', 'search', 'radioGroup', 'checkboxGroup'],
  sections: ['hero', 'features', 'pricing', 'testimonials', 'cta', 'footer', 'navbar/nav', 'logos', 'stats'],
};
