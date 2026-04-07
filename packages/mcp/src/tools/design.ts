/**
 * reframe_design — Unified design system tool.
 *
 * Merges extract-design + prompt into a single tool with two actions:
 *   - extract: HTML → import → extract design system → DESIGN.md
 *   - prompt:  DESIGN.md → optimized system prompt for AI agents
 */

import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
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
import { getSession } from '../session.js';

// ─── Schema ────────────────────────────────────────────────────

export const designInputSchema = {
  action: z.enum(['extract', 'prompt']),
  html: z.string().optional().describe('HTML to extract design system from (for action: extract)'),
  url: z.string().optional().describe('Website URL to fetch and extract design system from (for action: extract). Alternative to html.'),
  brand: z.string().optional().describe('Brand name — load pre-built DESIGN.md. Or override name when extracting from html/url.'),
  designMd: z.string().optional().describe('DESIGN.md content (for action: prompt)'),
  sizes: z.array(z.object({
    width: z.number(),
    height: z.number(),
    name: z.string().optional(),
  })).optional(),
  focus: z.enum(['banners', 'social', 'web', 'all']).optional().default('all'),
};

// ─── Handler ───────────────────────────────────────────────────

export async function handleDesign(input: {
  action: 'extract' | 'prompt';
  html?: string;
  url?: string;
  brand?: string;
  designMd?: string;
  sizes?: Array<{ width: number; height: number; name?: string }>;
  focus?: 'banners' | 'social' | 'web' | 'all';
}) {
  if (input.action === 'extract') {
    return handleExtract(input);
  }
  return handlePrompt(input);
}

// ─── Extract ───────────────────────────────────────────────────

// Known brands in the design-md library
const KNOWN_BRANDS = [
  'airbnb', 'airtable', 'apple', 'bmw', 'cal', 'claude', 'clay', 'clickhouse',
  'cohere', 'coinbase', 'composio', 'cursor', 'elevenlabs', 'expo', 'figma',
  'framer', 'hashicorp', 'ibm', 'intercom', 'kraken', 'linear.app', 'lovable',
  'minimax', 'mintlify', 'miro', 'mistral.ai', 'mongodb', 'notion', 'nvidia',
  'ollama', 'opencode.ai', 'pinterest', 'posthog', 'raycast', 'replicate',
  'resend', 'revolut', 'runwayml', 'sanity', 'sentry', 'spacex', 'spotify',
  'stripe', 'supabase', 'superhuman', 'together.ai', 'uber', 'vercel',
  'voltagent', 'warp', 'webflow', 'wise', 'x.ai', 'zapier',
];

const BRAND_ALIASES: Record<string, string> = {
  linear: 'linear.app', mistral: 'mistral.ai', xai: 'x.ai',
  together: 'together.ai', opencode: 'opencode.ai',
};

async function handleExtract(input: {
  html?: string;
  url?: string;
  brand?: string;
}) {
  const session = getSession();
  session.recordToolCall('design');

  // ── Path 1: Brand from awesome-design-md library ──
  if (input.brand && !input.html && !input.url) {
    const brandKey = BRAND_ALIASES[input.brand.toLowerCase()] ?? input.brand.toLowerCase();
    if (KNOWN_BRANDS.includes(brandKey)) {
      // Try local files first (monorepo or installed)
      const localPaths = [
        join(process.cwd(), 'awesome-design-md-main', 'design-md', brandKey, 'DESIGN.md'),
        join(__dirname, '..', '..', '..', '..', '..', '..', 'awesome-design-md-main', 'design-md', brandKey, 'DESIGN.md'),
        join(__dirname, '..', '..', '..', '..', 'awesome-design-md-main', 'design-md', brandKey, 'DESIGN.md'),
      ];
      for (const p of localPaths) {
        try {
          const resolved = resolve(p);
          if (existsSync(resolved)) {
            const designMd = readFileSync(resolved, 'utf-8');
            // Set active brand for session
            const ds = session.getOrParseDesignMd(designMd, parseDesignMd);
            session.setBrand(brandKey, designMd, ds);
            // Save to .reframe/brand.md for AI to read on demand
            const brandDir = join(process.cwd(), '.reframe');
            if (!existsSync(brandDir)) mkdirSync(brandDir, { recursive: true });
            writeFileSync(join(brandDir, 'brand.md'), designMd, 'utf-8');
            // Return compact cheat sheet — AI reads full file when needed
            const cheatSheet = generateBrandCheatSheet(ds);
            return {
              content: [{ type: 'text' as const, text: `Brand **${brandKey}** loaded → \`.reframe/brand.md\`\nRead the file for full design philosophy, do's/don'ts, and component specs.\n\n${cheatSheet}` }],
            };
          }
        } catch {}
      }

      // Fallback: fetch from GitHub
      const ghUrls = [
        `https://raw.githubusercontent.com/anthropics/awesome-design-md/main/design-md/${brandKey}/DESIGN.md`,
        `https://raw.githubusercontent.com/ilya-makarov-dev/awesome-design-md/main/design-md/${brandKey}/DESIGN.md`,
      ];
      for (const ghUrl of ghUrls) {
        try {
          const resp = await fetch(ghUrl, { signal: AbortSignal.timeout(5000) });
          if (resp.ok) {
            const designMd = await resp.text();
            return {
              content: [{ type: 'text' as const, text: designMd }],
            };
          }
        } catch {}
      }
    }
    // Brand not found
    return {
      content: [{
        type: 'text' as const,
        text: `Brand "${input.brand}" not found in library. Available: ${KNOWN_BRANDS.join(', ')}.\n\nAlternatively, provide \`html\` or \`url\` to extract from a website.`,
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

  if (!html) {
    return {
      content: [{
        type: 'text' as const,
        text: 'Provide one of:\n- `brand`: brand name from library (stripe, linear, vercel, ...)\n- `url`: website URL to extract from\n- `html`: raw HTML string',
      }],
    };
  }

  // ── Extract design system from HTML ──
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

  return {
    content: [{ type: 'text' as const, text: designMd }],
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

  // ── Button Style
  if (ds.components.button) {
    sections.push('## Button Style');
    const btn = ds.components.button;
    sections.push(`- Border radius: ${btn.borderRadius}px (${btn.style})`);
    if (btn.fontWeight) sections.push(`- Font weight: ${btn.fontWeight}`);
    if (btn.textTransform) sections.push(`- Text transform: ${btn.textTransform}`);
    sections.push('');
  }

  // ── Layout
  sections.push('## Layout Rules');
  sections.push(`- Spacing grid: ${ds.layout.spacingUnit}px (all padding/margin/gaps must be multiples of ${ds.layout.spacingUnit})`);
  if (ds.layout.maxWidth) sections.push(`- Max content width: ${ds.layout.maxWidth}px`);
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
    if (html.length > 100) return html;
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
    if (resp.ok) return await resp.text();
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
async function fetchHtml(url: string): Promise<string | null> {
  let html = await fetchUrl(url);
  if (!html) return null;

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

  if (cssUrls.size === 0) return html;

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

  return `## Quick Reference for ${ds.brand}

\`\`\`
HERO:     pad [${heroPad}, ${Math.round(heroPad * 0.75)}] · display ${heroSize}/${heroWeight}/${heroLS} · lh ${heroLH} · bg ${bg}
BODY:     ${bodySize}/${bodyWeight} · color ${muted} · lh 1.6
BUTTON:   filled ${primary} · radius ${radius} · ghost transparent + border
CARD:     pad ${spacing * 3} · gap ${spacing * 1.5} · bg ${cardBg} · radius ${cardRadius}
SECTION:  pad [${sectionPad}, ${Math.round(sectionPad * 0.8)}] · gap ${spacing * 6}
TEXT:     primary ${text} · muted ${muted} · accent ${primary}
SPACING:  unit ${spacing} · hero ${heroPad} · section ${sectionPad} · card ${spacing * 3}
FONT:     ${font} · hero w${heroWeight} · body w${bodyWeight}
THEME:    ${isDark ? 'dark' : 'light'} · card bg ${cardBg} · surface ${isDark ? '#111827' : '#f9fafb'}
\`\`\``;
}
