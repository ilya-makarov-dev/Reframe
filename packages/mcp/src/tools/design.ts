/**
 * reframe_design — Unified design system tool.
 *
 * Merges extract-design + prompt into a single tool with two actions:
 *   - extract: HTML → import → extract design system → DESIGN.md
 *   - prompt:  DESIGN.md → optimized system prompt for AI agents
 */

import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { importFromHtml } from '../../../core/src/importers/html.js';
import { StandaloneNode } from '../../../core/src/adapters/standalone/node.js';
import { StandaloneHost } from '../../../core/src/adapters/standalone/adapter.js';
import { setHost } from '../../../core/src/host/context.js';
import {
  parseDesignMd,
  extractDesignSystemFromFrame,
  exportDesignMd,
  findTypographyForSlot,
  getButtonBorderRadius,
} from '../../../core/src/design-system/index.js';
import type { DesignSystem } from '../../../core/src/design-system/index.js';
import { saveDesignSystem } from '../../../core/src/project/io.js';
import { getSession } from '../session.js';
import { getReframeDir } from '../store.js';
import { getProjectDir } from './project.js';
import { loadBrandDesignMd } from './compile.js';
import { MCP_LIMITS } from '../limits.js';
import { makeToolJsonErrorResult } from '../tool-result.js';

// ─── Schema ────────────────────────────────────────────────────

export const designInputSchema = {
  action: z.enum(['extract', 'prompt', 'list']),
  html: z.string().optional().describe('HTML to extract design system from (for action: extract)'),
  url: z.string().optional().describe('Website URL to fetch and extract design system from (for action: extract). Alternative to html.'),
  brand: z.string().optional().describe(
    'Brand slug to fetch DESIGN.md via npm (npx getdesign). Examples: "stripe", "airbnb", "linear". Use action "list" to see all available brands.',
  ),
  designMd: z.string().optional().describe('DESIGN.md content (for action: prompt)'),
  sizes: z.array(z.object({
    width: z.number(),
    height: z.number(),
    name: z.string().optional(),
  })).optional(),
  focus: z.enum(['banners', 'social', 'web', 'all']).optional().default('all'),
  search: z.string().optional().describe('Filter brand list by keyword (for action: list). Example: "ai", "crypto", "automotive".'),
};

// ─── Handler ───────────────────────────────────────────────────

export async function handleDesign(input: {
  action: 'extract' | 'prompt' | 'list';
  html?: string;
  url?: string;
  brand?: string;
  designMd?: string;
  sizes?: Array<{ width: number; height: number; name?: string }>;
  focus?: 'banners' | 'social' | 'web' | 'all';
  search?: string;
}) {
  if (input.action === 'list') {
    return handleList(input.search);
  }
  if (input.action === 'extract') {
    return handleExtract(input);
  }
  return handlePrompt(input);
}

// ─── List ─────────────────────────────────────────────────────

async function handleList(search?: string) {
  try {
    const raw = execSync('npx getdesign list', { timeout: 30000, stdio: 'pipe' }).toString();
    let lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0 && !l.startsWith('npm'));

    const allLines = [...lines];

    if (search) {
      const q = search.toLowerCase();
      lines = lines.filter(l => l.toLowerCase().includes(q));
    }

    if (lines.length === 0 && search) {
      // No match — show all brands so agent can pick
      const slugs = allLines.map(l => l.split(' ')[0]).filter(Boolean);
      return { content: [{ type: 'text' as const, text:
        `No brands matching "${search}". Pick from all ${allLines.length} available:\n\n` +
        allLines.join('\n') +
        '\n\nUsage: reframe_design({ action: "extract", brand: "<slug>" })',
      }] };
    }

    const header = `Available brands (${lines.length}${search ? ` matching "${search}"` : ''}):\n`;
    const hint = '\n\nUsage: reframe_design({ action: "extract", brand: "<slug>" })';

    return { content: [{ type: 'text' as const, text: header + lines.join('\n') + hint }] };
  } catch (err: any) {
    return makeToolJsonErrorResult(`Failed to list brands: ${err.message}`, 'BRAND_LIST_FAILED');
  }
}

// ─── Extract ───────────────────────────────────────────────────

/** Canonical DESIGN.md on disk — same as reframe_project save_design. */
function persistCanonicalDesignMd(designMd: string): 'manifest' | 'file' {
  const projectDir = getProjectDir();
  if (projectDir) {
    try {
      saveDesignSystem(projectDir, designMd);
      return 'manifest';
    } catch {
      /* fall through to workspace file */
    }
  }
  const rd = getReframeDir();
  if (!existsSync(rd)) mkdirSync(rd, { recursive: true });
  writeFileSync(join(rd, 'design.md'), designMd, 'utf-8');
  return 'file';
}

async function handleExtract(input: {
  html?: string;
  url?: string;
  brand?: string;
}) {
  const session = getSession();
  session.recordToolCall('design');

  // ── Path 1: Fetch DESIGN.md by slug (optional local clone + GitHub raw) → canonical design.md ──
  if (input.brand && !input.html && !input.url) {
    const designMd = await loadBrandDesignMd(input.brand);
    if (!designMd?.trim()) {
      return {
        content: [{
          type: 'text' as const,
          text:
            `Could not load DESIGN.md for slug "${input.brand}". ` +
            'Use reframe_design({ action: "list" }) to see available brands, or use url/html to extract from a website.',
        }],
      };
    }

    const ds = session.getOrParseDesignMd(designMd, parseDesignMd);
    const brandLabel = (ds.brand && ds.brand.trim()) || input.brand.trim();
    session.setBrand(brandLabel, designMd, ds);

    const persisted = persistCanonicalDesignMd(designMd);

    const persistNote =
      persisted === 'manifest'
        ? 'Saved to .reframe/design.md and linked in project.json.'
        : 'Saved to .reframe/design.md.';

    // Return the FULL DESIGN.md — it IS the prompt.
    // awesome-design-md files are 300+ lines of prose with exact values,
    // philosophy, do's/don'ts, component prompts, iteration guides.
    // No need to re-digest — the original is the best context for the agent.
    return {
      content: [{
        type: 'text' as const,
        text: `${designMd}\n\n---\n${persistNote}`,
      }],
    };
  }

  // ── Path 2: Fetch URL ──
  let html = input.html;
  if (!html && input.url) {
    html = await fetchHtml(input.url) ?? undefined;
    if (!html) {
      return {
        content: [{ type: 'text' as const, text: `Failed to fetch ${input.url}. Make sure the URL is valid and accessible.` }],
      };
    }
  }

  if (html && html.length > MCP_LIMITS.designFetchHtmlMaxChars) {
    return makeToolJsonErrorResult(
      `Fetched HTML exceeds ${MCP_LIMITS.designFetchHtmlMaxChars} characters (got ${html.length}). Try a smaller page or use html with a fragment.`,
      'design.html_too_large',
      { length: html.length, max: MCP_LIMITS.designFetchHtmlMaxChars },
    );
  }

  if (!html) {
    return {
      content: [{
        type: 'text' as const,
        text:
          'Provide one of:\n' +
          '- brand: slug to fetch DESIGN.md (optional local/GitHub sources in engine)\n' +
          '- url: website URL to extract from\n' +
          '- html: raw HTML string',
      }],
    };
  }

  // ── Extract design system from HTML ──
  // Clean noise (scripts, iframes, hidden SVGs) before parsing
  html = cleanHtmlForExtraction(html);
  const imported = await importFromHtml(html);
  const root = imported.graph.getNode(imported.rootId)!;

  setHost(new StandaloneHost(imported.graph));
  const wrappedRoot = new StandaloneNode(imported.graph, root);

  let ds = extractDesignSystemFromFrame(wrappedRoot);

  // If INode extraction found nothing useful (external CSS site), extract directly from CSS
  const hasColors = ds.colors.roles.size > 2;
  const hasTypo = ds.typography.hierarchy.length > 2;
  if (!hasColors || !hasTypo) {
    const cssDirect = extractFromRawCss(html);

    // Colors — merge, preferring saturated/meaningful over noise
    if (cssDirect.colors.length > 0) {
      for (const c of cssDirect.colors) {
        if (!ds.colors.roles.has(c.role)) ds.colors.roles.set(c.role, c.hex);
      }
      if (!ds.colors.primary) ds.colors.primary = cssDirect.primary;
      if (cssDirect.background) {
        ds.colors.background = cssDirect.background;
        ds.colors.roles.set('background', cssDirect.background);
      }
      if (cssDirect.text) {
        ds.colors.text = cssDirect.text;
        ds.colors.roles.set('text', cssDirect.text);
      }
    }

    // Typography — build from extracted font sizes + weights
    if (cssDirect.fonts.length > 0 && ds.typography.hierarchy.length < 3) {
      const validRoles: Array<'hero' | 'title' | 'subtitle' | 'body' | 'button' | 'caption'> =
        ['hero', 'title', 'subtitle', 'body', 'button', 'caption'];
      const sizes = cssDirect.fontSizes.sort((a, b) => b - a).slice(0, validRoles.length);
      const weights = cssDirect.fontWeights.sort((a, b) => b - a);

      for (let i = 0; i < sizes.length && i < validRoles.length; i++) {
        const role = validRoles[i];
        if (!ds.typography.hierarchy.some(r => r.role === role)) {
          ds.typography.hierarchy.push({
            role,
            fontSize: sizes[i],
            fontWeight: weights[Math.min(i, weights.length - 1)] ?? (i < 2 ? 700 : 400),
            lineHeight: i < 2 ? 1.1 : i < 4 ? 1.3 : 1.5,
            letterSpacing: sizes[i] >= 32 ? Math.round(-sizes[i] * 0.02) : 0,
            fontFamily: cssDirect.fonts[Math.min(i < 2 ? 0 : 1, cssDirect.fonts.length - 1)],
          });
        }
      }
      ds.typography.hierarchy.sort((a, b) => b.fontSize - a.fontSize);
    }

    // Radii
    if (cssDirect.radii.length > 0 && ds.layout.borderRadiusScale.length < 3) {
      ds.layout.borderRadiusScale = [...new Set([0, ...cssDirect.radii])].sort((a, b) => a - b);
    }

    // Brand name
    if (cssDirect.brandName && (ds.brand === '' || ds.brand === 'div')) {
      ds.brand = cssDirect.brandName;
    }

    // Button spec from radii
    if (!ds.components.button && cssDirect.radii.length > 0) {
      const maxRadius = Math.max(...cssDirect.radii);
      ds.components.button = {
        borderRadius: maxRadius >= 9999 ? 9999 : cssDirect.radii[Math.floor(cssDirect.radii.length / 2)],
        style: maxRadius >= 9999 ? 'pill' : maxRadius >= 12 ? 'rounded' : 'square',
      };
    }
  }

  if (input.brand) {
    ds.brand = input.brand;
  }

  const designMd = exportDesignMd(ds);
  session.setBrand(ds.brand || 'extracted', designMd, ds);

  const persisted = persistCanonicalDesignMd(designMd);
  const persistNote = persisted === 'manifest'
    ? 'Saved to .reframe/design.md and linked in project.json.'
    : 'Saved to .reframe/design.md.';

  // Return a PROMPT-format summary — actionable instructions for the agent,
  // not just raw values. Full DESIGN.md is on disk for audit/parser.
  const prompt = buildDesignPrompt(ds);

  return {
    content: [{ type: 'text' as const, text: `${prompt}\n\n---\n${persistNote} Full spec: .reframe/design.md` }],
  };
}

// ─── Prompt ────────────────────────────────────────────────────

async function handlePrompt(input: {
  designMd?: string;
  sizes?: Array<{ width: number; height: number; name?: string }>;
  focus?: 'banners' | 'social' | 'web' | 'all';
}) {
  if (!input.designMd) {
    return {
      content: [{ type: 'text' as const, text: 'Error: designMd is required for action: prompt' }],
    };
  }
  if (input.designMd.length > MCP_LIMITS.designPromptDesignMdMaxChars) {
    return makeToolJsonErrorResult(
      `designMd exceeds ${MCP_LIMITS.designPromptDesignMdMaxChars} characters (got ${input.designMd.length}).`,
      'design.design_md_too_large',
      { length: input.designMd.length, max: MCP_LIMITS.designPromptDesignMdMaxChars },
    );
  }

  const session = getSession();
  session.recordToolCall('design');
  const ds = session.getOrParseDesignMd(input.designMd, parseDesignMd);
  const sizes = input.sizes ?? [];
  const focus = input.focus ?? 'all';

  const sections: string[] = [];

  // ── Header
  sections.push(`# Design System: ${ds.brand}`);
  sections.push('');
  sections.push('You are generating HTML/CSS designs. Follow this brand specification EXACTLY.');
  sections.push('');

  // ── Color Palette
  sections.push('## Color Palette (use EXACT hex values)');
  sections.push('');
  if (ds.colors.primary) sections.push(`- **Primary**: ${ds.colors.primary}`);
  if (ds.colors.background) sections.push(`- **Background**: ${ds.colors.background}`);
  if (ds.colors.text) sections.push(`- **Text**: ${ds.colors.text}`);
  if (ds.colors.accent) sections.push(`- **Accent**: ${ds.colors.accent}`);
  for (const [role, hex] of ds.colors.roles) {
    if (['primary', 'background', 'text', 'accent'].includes(role)) continue;
    sections.push(`- **${role}**: ${hex}`);
  }
  sections.push('');

  // ── Typography
  sections.push('## Typography (use these exact sizes and weights)');
  sections.push('');
  sections.push('| Role | Size | Weight | Line Height | Letter Spacing |');
  sections.push('|------|------|--------|-------------|----------------|');
  for (const rule of ds.typography.hierarchy) {
    const font = rule.fontFamily ? ` (${rule.fontFamily})` : '';
    sections.push(`| ${rule.role}${font} | ${rule.fontSize}px | ${rule.fontWeight} | ${rule.lineHeight} | ${rule.letterSpacing}px |`);
  }
  sections.push('');

  const fonts = [...new Set(ds.typography.hierarchy.map(r => r.fontFamily).filter(Boolean))];
  if (fonts.length > 0) {
    sections.push(`**Font family**: Use \`${fonts.join(', ')}\` — do NOT substitute with other fonts.`);
    sections.push('');
  }

  // ── Font Features
  if (ds.typography.fontFeatures && ds.typography.fontFeatures.length > 0) {
    sections.push(`**OpenType features**: Apply \`font-feature-settings: ${ds.typography.fontFeatures.map(f => `"${f.tag}"`).join(', ')}\` on all \`${fonts[0] ?? 'primary font'}\` text.`);
    sections.push('');
  }

  // ── Button Style
  if (ds.components.button) {
    sections.push('## Button Style');
    const btn = ds.components.button;
    sections.push(`- Default radius: ${btn.borderRadius}px (${btn.style})`);
    if (btn.fontWeight) sections.push(`- Font weight: ${btn.fontWeight}`);
    if (btn.textTransform) sections.push(`- Text transform: ${btn.textTransform}`);
    if (btn.variants && btn.variants.length > 0) {
      sections.push('');
      sections.push('**Variants** (use these exact values):');
      for (const v of btn.variants) {
        const parts: string[] = [];
        if (v.background) parts.push(`bg \`${v.background}\``);
        else parts.push('bg transparent');
        if (v.color) parts.push(`text \`${v.color}\``);
        if (v.borderRadius != null) parts.push(`radius \`${v.borderRadius}px\``);
        if (v.paddingY != null && v.paddingX != null) parts.push(`padding \`${v.paddingY}px ${v.paddingX}px\``);
        if (v.hover?.background) parts.push(`hover bg \`${v.hover.background}\``);
        sections.push(`- **${v.name}**: ${parts.join(', ')}`);
      }
    }
    sections.push('');
  }

  // ── Component Specs
  const hasComponentSpecs = ds.components.card || ds.components.badge || ds.components.input || ds.components.nav;
  if (hasComponentSpecs) {
    sections.push('## Component Specs');
    if (ds.components.card) {
      const c = ds.components.card;
      sections.push(`- **Card**: radius \`${c.borderRadius}px\`${c.background ? `, bg \`${c.background}\`` : ''}${c.borderColor ? `, border \`${c.borderColor}\`` : ''}${c.padding ? `, padding \`${c.padding}px\`` : ''}`);
    }
    if (ds.components.badge) {
      const b = ds.components.badge;
      sections.push(`- **Badge**: radius \`${b.borderRadius}px\`${b.fontSize ? `, ${b.fontSize}px` : ''}${b.fontWeight ? ` w${b.fontWeight}` : ''}${b.paddingX != null ? `, padding \`${b.paddingY ?? 0}px ${b.paddingX}px\`` : ''}`);
    }
    if (ds.components.input) {
      const i = ds.components.input;
      sections.push(`- **Input**: radius \`${i.borderRadius}px\`${i.borderColor ? `, border \`${i.borderColor}\`` : ''}${i.height ? `, height \`${i.height}px\`` : ''}${i.focusBorderColor ? `, focus border \`${i.focusBorderColor}\`` : ''}`);
    }
    if (ds.components.nav) {
      const n = ds.components.nav;
      const parts: string[] = [];
      if (n.height) parts.push(`height \`${n.height}px\``);
      if (n.fontSize) parts.push(`${n.fontSize}px`);
      if (n.fontWeight) parts.push(`w${n.fontWeight}`);
      if (n.activeIndicator) parts.push(`active: ${n.activeIndicator}`);
      if (parts.length > 0) sections.push(`- **Nav**: ${parts.join(', ')}`);
    }
    sections.push('');
  }

  // ── Layout
  sections.push('## Layout Rules');
  sections.push(`- Spacing grid: ${ds.layout.spacingUnit}px (all padding/margin/gaps must be multiples of ${ds.layout.spacingUnit})`);
  if (ds.layout.spacingScale && ds.layout.spacingScale.length > 0) {
    sections.push(`- Spacing scale: [${ds.layout.spacingScale.join(', ')}]px — prefer these values`);
  }
  if (ds.layout.maxWidth) sections.push(`- Max content width: ${ds.layout.maxWidth}px`);
  if (ds.layout.sectionSpacing) sections.push(`- Section spacing: ${ds.layout.sectionSpacing}px`);
  sections.push(`- Border radius scale: [${ds.layout.borderRadiusScale.join(', ')}]px — only use these values`);
  sections.push('');

  // ── Size-specific guidelines
  if (sizes.length > 0) {
    sections.push('## Target Sizes');
    sections.push('');
    sections.push('Generate **separate HTML for each size** — do NOT scale one design.');
    sections.push('');

    for (const size of sizes) {
      const name = size.name || `${size.width}x${size.height}`;
      const aspect = size.width / size.height;
      sections.push(`### ${name} (${size.width}x${size.height})`);

      // Typography recommendations scaled for size
      const typoRecs = getTypoRecommendations(ds, size.width, size.height);
      if (typoRecs.length > 0) {
        sections.push('Recommended typography for this size:');
        for (const t of typoRecs) {
          sections.push(`- ${t.role}: ${t.fontSize}px / weight ${t.fontWeight}`);
        }
      }

      // Layout hints by aspect ratio
      if (aspect > 3) {
        sections.push('- **Horizontal strip** — single line of content, keep text SHORT');
        sections.push('- Use flexbox row layout, center vertically');
      } else if (aspect < 0.5) {
        sections.push('- **Vertical tower** — stack content vertically');
        sections.push('- Use flexbox column layout');
      } else if (aspect > 1.5) {
        sections.push('- **Wide format** — hero-style with room for text + image');
      } else if (aspect < 0.8) {
        sections.push('- **Tall format** — stack headline, body, CTA vertically');
      } else {
        sections.push('- **Square-ish** — balanced layout, centered or quadrant');
      }

      const minDim = Math.min(size.width, size.height);
      if (minDim < 100) {
        sections.push('- **Tiny format** — minimum font size 8px, very few words');
      } else if (minDim < 300) {
        sections.push('- Minimum font size: 10px');
      }

      sections.push('');
    }
  }

  // ── Focus-specific
  if (focus === 'banners' || focus === 'all') {
    sections.push('## Banner Best Practices');
    sections.push('- Keep text minimal — 3 elements max (headline, subtitle, CTA)');
    sections.push('- CTA button should be visually prominent (primary color, readable size)');
    sections.push('- Leave breathing room — don\'t fill every pixel');
    sections.push('');
  }

  const prompt = sections.join('\n');

  return {
    content: [{
      type: 'text' as const,
      text: prompt,
    }],
  };
}

// ─── Helpers ───────────────────────────────────────────────────

function getTypoRecommendations(
  ds: DesignSystem,
  width: number,
  height: number,
): Array<{ role: string; fontSize: number; fontWeight: number }> {
  const results: Array<{ role: string; fontSize: number; fontWeight: number }> = [];
  const minDim = Math.min(width, height);

  for (const rule of ds.typography.hierarchy) {
    let fontSize = rule.fontSize;

    // Check responsive overrides
    const sorted = [...ds.responsive.breakpoints].sort((a, b) => b.width - a.width);
    const bp = sorted.find(b => width >= b.width);
    if (bp) {
      const override = ds.responsive.typographyOverrides.find(
        o => o.breakpointName === bp.name && o.role === rule.role,
      );
      if (override) fontSize = override.fontSize;
    }

    // Scale down for small formats
    if (minDim < 100) {
      fontSize = Math.max(Math.round(fontSize * 0.3), 8);
    } else if (minDim < 300) {
      fontSize = Math.max(Math.round(fontSize * 0.5), 10);
    } else if (minDim < 500) {
      fontSize = Math.max(Math.round(fontSize * 0.7), 10);
    }

    // Clamp: text shouldn't be taller than 60% of height
    const maxFontHeight = height * 0.6;
    if (fontSize * 1.2 > maxFontHeight) {
      fontSize = Math.round(maxFontHeight / 1.2);
    }

    results.push({ role: rule.role, fontSize, fontWeight: rule.fontWeight });
  }

  return results;
}

// ─── Direct CSS extraction (for sites with external/CSS-module styles) ──

interface RawCssExtract {
  colors: Array<{ role: string; hex: string }>;
  primary?: string;
  background?: string;
  text?: string;
  fonts: string[];
  fontSizes: number[];
  fontWeights: number[];
  radii: number[];
  brandName?: string;
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function isNeutral(hex: string): boolean {
  const { s, l } = hexToHsl(hex);
  return s < 0.1 || l > 0.95 || l < 0.05;
}

function extractFromRawCss(html: string): RawCssExtract {
  const result: RawCssExtract = { colors: [], fonts: [], fontSizes: [], fontWeights: [], radii: [] };

  // Extract brand name from <title> or og:site_name
  const titleMatch = html.match(/<title[^>]*>([^<]+)/i);
  if (titleMatch) {
    const title = titleMatch[1].split(/[|\-–—]/)[0].trim();
    if (title.length < 30) result.brandName = title;
  }

  // Collect ALL CSS: inline <style> blocks + fetched external (already inlined by fetchHtml)
  const allCss: string[] = [];
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = styleRe.exec(html)) !== null) {
    allCss.push(sm[1]);
  }
  // Also inline styles from elements
  const inlineRe = /style="([^"]+)"/gi;
  while ((sm = inlineRe.exec(html)) !== null) {
    allCss.push(sm[1]);
  }

  const css = allCss.join('\n');

  // ── Extract CSS custom properties from :root ──
  const rootRe = /:root\s*\{([^}]+)\}/g;
  const cssVars = new Map<string, string>();
  while ((sm = rootRe.exec(css)) !== null) {
    const props = sm[1];
    const varRe = /--([\w-]+)\s*:\s*([^;]+)/g;
    let vm: RegExpExecArray | null;
    while ((vm = varRe.exec(props)) !== null) {
      cssVars.set(vm[1], vm[2].trim());
    }
  }

  // ── Colors from CSS vars and raw CSS ──
  const hexRe = /#([0-9a-fA-F]{3,8})\b/g;
  const colorFreq = new Map<string, number>();

  // Colors from CSS variables
  for (const [name, value] of cssVars) {
    const hexM = value.match(/#([0-9a-fA-F]{6})\b/);
    if (hexM) {
      const hex = `#${hexM[1].toLowerCase()}`;
      colorFreq.set(hex, (colorFreq.get(hex) ?? 0) + 3); // boost var-defined colors
      // Try to infer role from variable name
      const n = name.toLowerCase();
      if (n.includes('primary') || n.includes('brand') || n.includes('accent')) {
        result.colors.push({ role: 'primary', hex });
      } else if (n.includes('background') || n.includes('bg') || n === 'void') {
        result.background = hex;
      } else if ((n.includes('text') || n.includes('foreground')) && !n.includes('secondary')) {
        result.text = hex;
      }
    }
  }

  // Colors from all CSS
  while ((sm = hexRe.exec(css)) !== null) {
    let hex = sm[0].toLowerCase();
    if (hex.length === 4) hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
    if (hex.length === 7) {
      colorFreq.set(hex, (colorFreq.get(hex) ?? 0) + 1);
    }
  }

  // Separate chromatic colors from neutrals
  const chromatic = [...colorFreq.entries()]
    .filter(([hex]) => !isNeutral(hex))
    .sort((a, b) => {
      // Score: frequency * saturation — prioritize vivid, common colors
      const sA = hexToHsl(a[0]).s;
      const sB = hexToHsl(b[0]).s;
      return (b[1] * (sB + 0.3)) - (a[1] * (sA + 0.3));
    });

  const neutrals = [...colorFreq.entries()]
    .filter(([hex]) => isNeutral(hex))
    .sort((a, b) => b[1] - a[1]);

  // Primary = most saturated + frequent chromatic color
  if (chromatic.length > 0 && !result.colors.some(c => c.role === 'primary')) {
    result.primary = chromatic[0][0];
    result.colors.push({ role: 'primary', hex: chromatic[0][0] });
  }

  // Secondary, accent from next chromatic colors
  const chromaticRoles = ['secondary', 'accent'];
  for (let i = 1; i < chromatic.length && i <= chromaticRoles.length; i++) {
    result.colors.push({ role: chromaticRoles[i - 1], hex: chromatic[i][0] });
  }

  // Background & text — detect dark vs light theme
  const darkNeutrals = neutrals.filter(([h]) => hexToHsl(h).l < 0.2);
  const lightNeutrals = neutrals.filter(([h]) => hexToHsl(h).l > 0.8);
  const darkFreq = darkNeutrals.reduce((sum, [, f]) => sum + f, 0);
  const lightFreq = lightNeutrals.reduce((sum, [, f]) => sum + f, 0);

  const isDark = darkFreq > lightFreq;
  if (!result.background) {
    result.background = isDark ? (darkNeutrals[0]?.[0] ?? '#000000') : (lightNeutrals[0]?.[0] ?? '#ffffff');
    result.text = isDark ? (lightNeutrals[0]?.[0] ?? '#f0f0f0') : (darkNeutrals[0]?.[0] ?? '#1a1a1a');
  }

  // Surface, muted from mid-range neutrals
  const midNeutrals = neutrals.filter(([h]) => {
    const l = hexToHsl(h).l;
    return l > 0.2 && l < 0.8;
  });
  if (midNeutrals.length > 0) result.colors.push({ role: 'muted', hex: midNeutrals[0][0] });
  if (midNeutrals.length > 1) result.colors.push({ role: 'surface', hex: midNeutrals[1][0] });

  // ── Fonts ──
  const fontRe = /font-family\s*:\s*['"]?([A-Za-z][\w\s-]+?)['"]?\s*[,;}\n]/g;
  const fontFreq = new Map<string, number>();
  const systemFonts = new Set(['system-ui', 'sans-serif', 'serif', 'monospace', 'cursive', 'inherit', 'initial', 'ui-sans-serif', 'ui-serif', 'ui-monospace', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial']);
  while ((sm = fontRe.exec(css)) !== null) {
    const font = sm[1].trim();
    if (!systemFonts.has(font) && font.length > 1) {
      fontFreq.set(font, (fontFreq.get(font) ?? 0) + 1);
    }
  }
  // Also from CSS vars
  for (const [name, value] of cssVars) {
    if (name.includes('font')) {
      const fontM = value.match(/['"]?([A-Za-z][\w\s-]+?)['"]?\s*,/);
      if (fontM && !systemFonts.has(fontM[1].trim())) {
        const f = fontM[1].trim();
        fontFreq.set(f, (fontFreq.get(f) ?? 0) + 5);
      }
    }
  }
  result.fonts = [...fontFreq.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]).slice(0, 4);

  // ── Font weights ──
  const weightRe = /font-weight\s*:\s*(\d{3})\b/g;
  const weightSet = new Set<number>();
  while ((sm = weightRe.exec(css)) !== null) {
    const w = parseInt(sm[1]);
    if (w >= 100 && w <= 900) weightSet.add(w);
  }
  // Also from Google Fonts link: wght@300;400;500;600;700
  const gfWeightRe = /wght@([\d;]+)/g;
  while ((sm = gfWeightRe.exec(html)) !== null) {
    for (const w of sm[1].split(';')) {
      const n = parseInt(w);
      if (n >= 100 && n <= 900) weightSet.add(n);
    }
  }
  result.fontWeights = [...weightSet];

  // ── Font sizes ──
  const sizeRe = /font-size\s*:\s*(\d+(?:\.\d+)?)\s*px/g;
  const sizeSet = new Set<number>();
  while ((sm = sizeRe.exec(css)) !== null) {
    const s = parseFloat(sm[1]);
    if (s >= 8 && s <= 200) sizeSet.add(Math.round(s));
  }
  // Also from CSS vars
  for (const [, value] of cssVars) {
    const sM = value.match(/^(\d+(?:\.\d+)?)\s*px$/);
    if (sM) {
      const s = parseFloat(sM[1]);
      if (s >= 10 && s <= 200) sizeSet.add(Math.round(s));
    }
  }
  result.fontSizes = [...sizeSet];

  // ── Border radii ──
  const radiusRe = /border-radius\s*:\s*(\d+(?:\.\d+)?)\s*px/g;
  const radiusSet = new Set<number>();
  while ((sm = radiusRe.exec(css)) !== null) {
    const r = parseFloat(sm[1]);
    if (r > 0 && r < 100) radiusSet.add(Math.round(r));
  }
  result.radii = [...radiusSet].sort((a, b) => a - b);

  return result;
}

// ─── URL fetcher — fetches HTML + all external CSS, inlines everything ──

async function fetchUrl(url: string): Promise<string | null> {
  try {
    const result = execSync(
      `curl -sL -m 15 -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" "${url}"`,
      { maxBuffer: 5 * 1024 * 1024, timeout: 20000 },
    );
    const html = result.toString('utf-8');
    if (html.length > 100 && html.length <= MCP_LIMITS.designFetchHtmlMaxChars) return html;
  } catch {}

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    if (resp.ok) {
      const text = await resp.text();
      if (text.length <= MCP_LIMITS.designFetchHtmlMaxChars) return text;
    }
  } catch {}

  return null;
}

function curlFetchSync(cssUrl: string): string | null {
  try {
    const result = execSync(
      `curl -sL -m 10 -A "Mozilla/5.0" "${cssUrl}"`,
      { maxBuffer: 2 * 1024 * 1024, timeout: 12000 },
    );
    return result.toString('utf-8');
  } catch { return null; }
}

function resolveUrl(base: string, href: string): string {
  try { return new URL(href, base).href; } catch { return href; }
}

/**
 * Fetch HTML + all external CSS stylesheets, inline them as <style> blocks.
 * This makes linkedom see ALL styles, not just inline ones.
 */
/** Strip noise from HTML before design extraction — scripts, iframes, SVG sprites, hidden elements. */
function cleanHtmlForExtraction(html: string): string {
  // Remove elements that are never visual design
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  html = html.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
  html = html.replace(/<template[\s\S]*?<\/template>/gi, '');
  // Remove hidden SVG sprite sheets (large, no visual impact)
  html = html.replace(/<svg[^>]*style="[^"]*display:\s*none[^"]*"[\s\S]*?<\/svg>/gi, '');
  html = html.replace(/<svg[^>]*hidden[\s\S]*?<\/svg>/gi, '');
  // Remove HTML comments (can be huge in CMS output)
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  // Remove data URIs in images (bloat, not needed for design extraction)
  html = html.replace(/src="data:image\/[^"]{1000,}"/gi, 'src=""');
  return html;
}

async function fetchHtml(url: string): Promise<string | null> {
  let html = await fetchUrl(url);
  if (!html) return null;

  // Clean noise before processing
  html = cleanHtmlForExtraction(html);

  // Find all <link rel="stylesheet" href="..."> and fetch them
  const linkRe = /<link[^>]+rel=["']?stylesheet["']?[^>]*href=["']([^"']+)["'][^>]*>/gi;
  const linkRe2 = /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']?stylesheet["']?[^>]*>/gi;

  const cssUrls = new Set<string>();
  let m: RegExpExecArray | null;
  for (const re of [linkRe, linkRe2]) {
    while ((m = re.exec(html)) !== null) {
      const href = m[1];
      if (href && !href.startsWith('data:')) {
        cssUrls.add(resolveUrl(url, href));
      }
    }
  }

  if (cssUrls.size === 0) {
    if (html.length > MCP_LIMITS.designFetchHtmlMaxChars) return null;
    return html;
  }

  // Fetch all CSS in parallel (up to 10)
  const urls = [...cssUrls].slice(0, 10);
  const cssBlocks: string[] = [];

  // Parallel fetch via concurrent curl processes
  const promises = urls.map(async (cssUrl) => {
    const css = curlFetchSync(cssUrl);
    if (css && css.length > 50 && !css.includes('<!DOCTYPE')) {
      return css;
    }
    return null;
  });

  const results = await Promise.all(promises);
  for (const css of results) {
    if (css) cssBlocks.push(css);
  }

  if (cssBlocks.length === 0) return html;

  // Inject fetched CSS as <style> blocks before </head>
  const injectedStyles = cssBlocks.map(css => `<style>${css}</style>`).join('\n');

  if (html.includes('</head>')) {
    html = html.replace('</head>', `${injectedStyles}\n</head>`);
  } else {
    html = `${injectedStyles}\n${html}`;
  }

  if (html.length > MCP_LIMITS.designFetchHtmlMaxChars) {
    return null;
  }

  return html;
}

// ─── Brand cheat sheet generator ─────────────────────────────
// Compact key-value reference. AI knows the LANGUAGE from CLAUDE.md,
// just needs the VALUES from this brand. 5 lines, not 200.

function generateBrandCheatSheet(ds: DesignSystem): string {
  const hero = ds.typography.hierarchy[0];
  const bodyRule = ds.typography.hierarchy.find(r => r.role === 'body') ?? ds.typography.hierarchy[1];
  const primary = ds.colors.primary ?? '#6366f1';
  const bg = ds.colors.background ?? '#ffffff';
  const text = ds.colors.text ?? '#1a1a1a';
  const muted = ds.colors.roles.get('text-secondary') ?? ds.colors.roles.get('body') ?? '#666';
  const radius = ds.components.button?.borderRadius ?? 8;
  const cardRadius = ds.layout.borderRadiusScale[Math.min(3, ds.layout.borderRadiusScale.length - 1)] ?? 12;
  const spacing = ds.layout.spacingUnit || 8;
  const isDark = parseInt(bg.slice(1, 3), 16) < 30;
  const heroSize = hero?.fontSize ?? 56;
  const heroWeight = hero?.fontWeight ?? 700;
  const heroLS = hero?.letterSpacing ?? 0;
  const heroLH = hero?.lineHeight ?? 1.1;
  const bodySize = bodyRule?.fontSize ?? 18;
  const bodyWeight = bodyRule?.fontWeight ?? 400;
  const font = hero?.fontFamily ?? 'Inter';
  const heroPad = Math.max(100, Math.round(heroSize * 2.5));
  const sectionPad = Math.max(80, Math.round(heroSize * 1.5));
  const cardBg = isDark ? '#111' : '#ffffff';

  const fontFeatures = ds.typography.fontFeatures;
  const ffStr = fontFeatures && fontFeatures.length > 0
    ? ` · ff ${fontFeatures.map(f => `"${f.tag}"`).join(',')}`
    : '';
  const btnVariants = ds.components.button?.variants;
  const btnLine = btnVariants && btnVariants.length > 0
    ? `BUTTON:   ${btnVariants.map(v => `${v.name}${v.background ? ' ' + v.background : ''}`).join(' · ')} · radius ${radius}`
    : `BUTTON:   filled ${primary} · radius ${radius} · ghost transparent + border`;

  return `## Quick Reference for ${ds.brand}

\`\`\`
HERO:     display ${heroSize}/${heroWeight}/${heroLS} · lh ${heroLH} · bg ${bg}${ffStr}
BODY:     ${bodySize}/${bodyWeight} · color ${muted} · lh 1.6
${btnLine}
CARD:     pad ${spacing * 3} · bg ${cardBg} · radius ${cardRadius}${ds.components.card?.borderColor ? ' · border ' + ds.components.card.borderColor : ''}
SECTION:  pad [${sectionPad}, ${Math.round(sectionPad * 0.8)}] · gap ${spacing * 6}
TEXT:     primary ${text} · muted ${muted} · accent ${primary}
SPACING:  unit ${spacing}${ds.layout.spacingScale ? ' · scale [' + ds.layout.spacingScale.slice(0, 8).join(',') + ']' : ''}
FONT:     ${font}${ds.typography.secondaryFont ? ' · mono ' + ds.typography.secondaryFont : ''} · hero w${heroWeight} · body w${bodyWeight}
THEME:    ${isDark ? 'dark' : 'light'} · card bg ${cardBg} · surface ${isDark ? '#111827' : '#f9fafb'}
\`\`\``;
}

// ─── Design Prompt Builder ─────────────────────────────────────

/**
 * Build an actionable prompt from DesignSystem — tells the agent HOW to use values,
 * not just what they are. This is what the agent sees after extract.
 */
function buildDesignPrompt(ds: DesignSystem): string {
  const brand = ds.brand || 'Brand';
  const bg = ds.colors.background ?? '#ffffff';
  const text = ds.colors.text ?? '#fafafa';
  const muted = ds.colors.roles.get('muted') ?? ds.colors.roles.get('body') ?? '#71717a';
  const primary = ds.colors.primary ?? '#6366f1';
  const accent = ds.colors.accent;
  const surface = ds.colors.roles.get('surface') ?? ds.colors.roles.get('surface-alt') ?? '#18181b';
  const border = ds.colors.roles.get('border-default') ?? ds.colors.roles.get('border') ?? '#27272a';
  const isDark = bg < '#888888';
  const unit = ds.layout.spacingUnit || 8;

  const typo = ds.typography.hierarchy;
  const heroRule = typo.find(r => r.role === 'hero');
  const titleRule = typo.find(r => r.role === 'title');
  const subtitleRule = typo.find(r => r.role === 'subtitle');
  const bodyRule = typo.find(r => r.role === 'body');
  const buttonRule = typo.find(r => r.role === 'button');
  const captionRule = typo.find(r => r.role === 'caption');
  const font = ds.typography.primaryFont ?? heroRule?.fontFamily ?? 'Inter';
  const monoFont = ds.typography.secondaryFont;

  const lines: string[] = [];

  lines.push(`# ${brand} — Design Context`);
  lines.push('');
  lines.push(`**${isDark ? 'Dark' : 'Light'} theme.** Background \`${bg}\`, text \`${text}\`, muted \`${muted}\`.`);
  lines.push(`**Primary accent** \`${primary}\` — buttons, links, highlights.${accent ? ` **Decorative accent** \`${accent}\`.` : ''}`);
  lines.push(`**Surface** \`${surface}\` — cards, containers. **Border** \`${border}\`.`);
  lines.push('');

  // ── Typography
  lines.push('## Typography');
  lines.push(`Font: \`${font}\`${monoFont ? ` · Mono: \`${monoFont}\`` : ''}`);
  if (heroRule) lines.push(`- Hero: \`${heroRule.fontSize}px\` w\`${heroRule.fontWeight}\` lh\`${heroRule.lineHeight}\` ls\`${heroRule.letterSpacing}px\``);
  if (titleRule) lines.push(`- Title: \`${titleRule.fontSize}px\` w\`${titleRule.fontWeight}\` lh\`${titleRule.lineHeight}\` ls\`${titleRule.letterSpacing}px\``);
  if (subtitleRule) lines.push(`- Subtitle: \`${subtitleRule.fontSize}px\` w\`${subtitleRule.fontWeight}\``);
  if (bodyRule) lines.push(`- Body: \`${bodyRule.fontSize}px\` w\`${bodyRule.fontWeight}\` lh\`${bodyRule.lineHeight}\``);
  if (buttonRule) lines.push(`- Button: \`${buttonRule.fontSize}px\` w\`${buttonRule.fontWeight}\``);
  if (captionRule) lines.push(`- Caption: \`${captionRule.fontSize}px\` w\`${captionRule.fontWeight}\``);

  // Font features
  const fontFeatures = ds.typography.fontFeatures;
  if (fontFeatures && fontFeatures.length > 0) {
    const featureStr = fontFeatures.map(f => `\`"${f.tag}"\`${f.description ? ` (${f.description})` : ''}`).join(', ');
    lines.push(`- **OpenType**: ${featureStr} — apply via \`font-feature-settings\``);
  }
  lines.push('');

  // ── Components
  lines.push('## Components');

  // Button variants
  const btn = ds.components.button;
  if (btn?.variants && btn.variants.length > 0) {
    for (const v of btn.variants) {
      const parts = [`radius \`${v.borderRadius ?? btn.borderRadius}px\``];
      if (v.background) parts.push(`bg \`${v.background}\``);
      if (v.color) parts.push(`text \`${v.color}\``);
      if (v.paddingY != null && v.paddingX != null) parts.push(`pad \`${v.paddingY}px ${v.paddingX}px\``);
      if (v.hover?.background) parts.push(`hover \`${v.hover.background}\``);
      lines.push(`- **Button ${v.name}**: ${parts.join(' · ')}`);
    }
  } else if (btn) {
    lines.push(`- **Button**: radius \`${btn.borderRadius}px\` (${btn.style}), min-height \`44px\``);
  }

  // Card
  const card = ds.components.card;
  if (card) {
    const parts = [`radius \`${card.borderRadius}px\``];
    if (card.background) parts.push(`bg \`${card.background}\``);
    if (card.borderColor) parts.push(`border \`${card.borderColor}\``);
    if (card.padding) parts.push(`pad \`${card.padding}px\``);
    lines.push(`- **Card**: ${parts.join(' · ')}`);
  }

  // Badge
  const badge = ds.components.badge;
  if (badge) {
    const parts = [`radius \`${badge.borderRadius}px\``];
    if (badge.fontSize) parts.push(`${badge.fontSize}px`);
    if (badge.fontWeight) parts.push(`w${badge.fontWeight}`);
    if (badge.paddingX != null) parts.push(`pad \`${badge.paddingY ?? 0}px ${badge.paddingX}px\``);
    lines.push(`- **Badge**: ${parts.join(' · ')}`);
  }

  // Input
  const input = ds.components.input;
  if (input) {
    const parts = [`radius \`${input.borderRadius}px\``];
    if (input.borderColor) parts.push(`border \`${input.borderColor}\``);
    if (input.height) parts.push(`height \`${input.height}px\``);
    if (input.focusBorderColor) parts.push(`focus \`${input.focusBorderColor}\``);
    lines.push(`- **Input**: ${parts.join(' · ')}`);
  }

  // Nav
  const nav = ds.components.nav;
  if (nav) {
    const parts: string[] = [];
    if (nav.height) parts.push(`height \`${nav.height}px\``);
    if (nav.fontSize) parts.push(`${nav.fontSize}px`);
    if (nav.fontWeight) parts.push(`w${nav.fontWeight}`);
    if (nav.activeIndicator) parts.push(`active: ${nav.activeIndicator}`);
    if (parts.length > 0) lines.push(`- **Nav**: ${parts.join(' · ')}`);
  }
  lines.push('');

  // ── Layout & Spacing
  lines.push('## Layout');
  lines.push(`Spacing grid: \`${unit}px\`. All padding/margin/gaps must be multiples of ${unit}.`);
  if (ds.layout.spacingScale && ds.layout.spacingScale.length > 0) {
    lines.push(`Scale: \`[${ds.layout.spacingScale.join(', ')}]\`px`);
  }
  if (ds.layout.maxWidth) lines.push(`Max content width: \`${ds.layout.maxWidth}px\``);
  if (ds.layout.sectionSpacing) lines.push(`Section spacing: \`${ds.layout.sectionSpacing}px\``);
  lines.push(`Radius scale: \`[${ds.layout.borderRadiusScale.join(', ')}]\`px — only use these values`);

  // Gradients
  if (ds.colors.gradients && ds.colors.gradients.size > 0) {
    lines.push('');
    lines.push('**Gradients:**');
    for (const [name, css] of ds.colors.gradients) {
      lines.push(`- ${name}: \`${css}\``);
    }
  }
  lines.push('');

  // ── Shadows
  if (ds.depth && ds.depth.elevationLevels.length > 0) {
    lines.push('## Shadows');
    const levelNames = ['Flat', 'Subtle', 'Standard', 'Elevated', 'Floating'];
    for (let i = 0; i < ds.depth.elevationLevels.length; i++) {
      const layers = ds.depth.elevationLevels[i];
      const shadowCss = layers.map(l =>
        `${l.inset ? 'inset ' : ''}${l.color} ${l.offsetX}px ${l.offsetY}px ${l.blur}px ${l.spread}px`
      ).join(', ');
      lines.push(`- L${i} (${levelNames[i] ?? `Level ${i}`}): \`${shadowCss}\``);
    }
    lines.push('');
  }

  // ── Rules
  lines.push('## Rules');
  lines.push('Colors only from palette. Weights only from typography. Radius only from scale.');
  lines.push('Every container needs explicit background + text color. Min touch target 44px.');
  if (fontFeatures && fontFeatures.length > 0) {
    lines.push(`Apply \`font-feature-settings: ${fontFeatures.map(f => `"${f.tag}"`).join(', ')}\` on all \`${font}\` text.`);
  }

  return lines.join('\n');
}
