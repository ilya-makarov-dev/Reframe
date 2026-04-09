/**
 * DESIGN.md parser — converts markdown design system spec into DesignSystem object.
 *
 * Supports the 9-section standard format from awesome-design-md:
 *   1. Visual Theme & Atmosphere
 *   2. Color Palette & Roles
 *   3. Typography Rules
 *   4. Component Stylings
 *   5. Layout Principles
 *   6. Depth & Elevation
 *   7. Do's and Don'ts
 *   8. Responsive Behavior
 *   9. Agent Prompt Guide
 *
 * The parser is deterministic (no ML) — regex + section markers.
 */

import type {
  DesignSystem,
  DesignSystemColors,
  DesignSystemComponents,
  DesignSystemLayout,
  DesignSystemResponsive,
  DesignSystemDepth,
  TypographyRule,
  TypographyRole,
  TypographyBreakpointOverride,
  Breakpoint,
  ButtonSpec,
  ButtonVariant,
  ButtonStyle,
  InteractiveState,
  CardSpec,
  BadgeSpec,
  InputSpec,
  NavSpec,
  FontFeature,
  ShadowLayer,
  ColorRole,
} from './types';

// ---------------------------------------------------------------------------
//  Section splitting
// ---------------------------------------------------------------------------

interface Section {
  title: string;
  body: string;
}

function splitSections(md: string): Section[] {
  const lines = md.split(/\r?\n/);
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const line of lines) {
    // Only split on ## (level 2) headers — ### sub-headers stay in the body.
    // This ensures sections like "## 2. Color Palette" include their "### Primary" sub-sections.
    const m = line.match(/^##\s+(?:\d+\.\s*)?(.+)/);
    if (m && !line.startsWith('###')) {
      if (current) sections.push(current);
      current = { title: m[1].trim(), body: '' };
    } else if (current) {
      current.body += line + '\n';
    }
  }
  if (current) sections.push(current);
  return sections;
}

function findSection(sections: Section[], ...keywords: string[]): Section | undefined {
  return sections.find(s => {
    const lower = s.title.toLowerCase();
    return keywords.some(k => lower.includes(k.toLowerCase()));
  });
}

// ---------------------------------------------------------------------------
//  Color parsing
// ---------------------------------------------------------------------------

const HEX_RE = /#(?:[0-9a-fA-F]{3,8})\b/g;
const RGBA_RE = /rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*[\d.]+)?\s*\)/gi;

function extractHexColors(text: string): string[] {
  return [...text.matchAll(HEX_RE)].map(m => m[0]);
}

function rgbStringToHex(rgb: string): string | null {
  const m = rgb.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*[\d.]+)?\s*\)/i);
  if (!m) return null;
  const r = Math.max(0, Math.min(255, Math.round(parseFloat(m[1]))));
  const g = Math.max(0, Math.min(255, Math.round(parseFloat(m[2]))));
  const b = Math.max(0, Math.min(255, Math.round(parseFloat(m[3]))));
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function extractFirstColor(text: string): string | null {
  const hex = text.match(HEX_RE)?.[0];
  if (hex) return hex;
  const rgb = text.match(RGBA_RE)?.[0];
  if (!rgb) return null;
  return rgbStringToHex(rgb);
}

function parseColors(section: Section | undefined): DesignSystemColors {
  const colors: DesignSystemColors = { roles: new Map() };
  if (!section) return colors;

  const lines = section.body.split(/\r?\n/);

  // First pass: extract all named colors with their hex values
  // Pattern: **Name** (`#hex`): description
  for (const line of lines) {
    const hex = extractFirstColor(line);
    if (!hex) continue;

    // Generic role extraction: "**Role Name** (`#hex`): description"
    const roleMatch = line.match(/\*\*([A-Za-z][\w\s/-]{1,40})\*\*\s*\(?[`(]?#[0-9a-fA-F]{3,8}/);
    if (roleMatch) {
      const roleName = roleMatch[1].trim().toLowerCase().replace(/\s+/g, '-');
      if (!colors.roles.has(roleName)) {
        colors.roles.set(roleName, hex);
      }
    }
  }

  // Second pass: detect from table rows like "| text | #1D1D1F | Body text |"
  for (const line of lines) {
    if (!line.includes('|')) continue;
    const cells = line.split('|').map(c => c.trim().toLowerCase()).filter(c => c.length > 0);
    if (cells.length < 2) continue;
    const roleName = cells[0].replace(/[`*]/g, '');
    const hex = extractFirstColor(line);
    if (!hex) continue;

    if (roleName === 'primary' && !colors.primary) { colors.primary = hex; colors.roles.set('primary', hex); }
    if (roleName === 'background' && !colors.background) { colors.background = hex; colors.roles.set('background', hex); }
    if (roleName === 'text' && !colors.text) { colors.text = hex; colors.roles.set('text', hex); }
    if (roleName === 'accent' && !colors.accent) { colors.accent = hex; colors.roles.set('accent', hex); }
    if (!colors.roles.has(roleName)) colors.roles.set(roleName, hex);
  }

  // Second-pass fallback: list/key-value lines like "- primary: #0071E3" or "fills.primary: #hex"
  for (const line of lines) {
    const m = line.match(/^\s*(?:[-*]\s*)?([A-Za-z][\w.\s/-]{1,40})\s*:\s*`?(#[0-9a-fA-F]{3,8})`?\b/);
    if (!m) continue;
    // Strip "fills." prefix from etalon format (fills.primary → primary)
    const roleName = m[1].trim().toLowerCase().replace(/^fills\./, '').replace(/\s+/g, '-');
    const hex = m[2];
    if (roleName === 'primary' && !colors.primary) colors.primary = hex;
    if (roleName === 'background' && !colors.background) colors.background = hex;
    if (roleName === 'text' && !colors.text) colors.text = hex;
    if (roleName === 'accent' && !colors.accent) colors.accent = hex;
    if (!colors.roles.has(roleName)) colors.roles.set(roleName, hex);
  }

  // Third pass: detect semantic roles from context in non-table lines
  // Use stricter matching to avoid false positives like "link text" matching "text"
  for (const line of lines) {
    const hex = extractFirstColor(line);
    if (!hex) continue;
    const lower = line.toLowerCase();

    // Match "Primary brand color" or line starts with "**...Primary..." — but NOT "link text" for text role
    if (!colors.primary && /\bprimary\s*(?:brand|color|cta|accent)?\b/i.test(lower) && !/\bprimary\s*(?:heading|text|link|surface|background)\b/i.test(lower)) {
      colors.primary = hex;
      if (!colors.roles.has('primary')) colors.roles.set('primary', hex);
    }

    // Background: match "page background", "primary background", "canvas" — but not "CTA backgrounds"
    if (!colors.background && (/\bpage\s*background\b|\bprimary.*background\b|^\s*-\s*\*\*.*(?:white|background|canvas)\*\*/i.test(lower))) {
      colors.background = hex;
      if (!colors.roles.has('background')) colors.roles.set('background', hex);
    }

    // Text: match "primary text", "heading color", "body text", or bold names with "text/black/foreground"
    if (!colors.text && (/\bprimary\s*text\b|\b(?:heading|body)\s*(?:text\s*)?color\b|\bheading\s*(?:color|solid)\b/i.test(lower) ||
        /^\s*-\s*\*\*.*(?:navy|heading|foreground|black|text)\*\*/i.test(lower))) {
      colors.text = hex;
      if (!colors.roles.has('text')) colors.roles.set('text', hex);
    }

    // Accent: match lines where the BOLD name contains "accent" or "brand"
    if (!colors.accent && /^\s*-\s*\*\*.*(?:accent|brand)\*\*/i.test(lower) && !/primary/i.test(lower)) {
      colors.accent = hex;
      if (!colors.roles.has('accent')) colors.roles.set('accent', hex);
    }

    if (/\bcta\b|interactive\b/i.test(lower) && !/\bcta\s*backgrounds\b/i.test(lower)) {
      if (!colors.roles.has('cta')) colors.roles.set('cta', hex);
    }
    if (/\berror\b|danger\b|destructive\b/i.test(lower)) {
      if (!colors.roles.has('error')) colors.roles.set('error', hex);
    }
    if (/\bsuccess\b/i.test(lower)) {
      if (!colors.roles.has('success')) colors.roles.set('success', hex);
    }
    if (/\bwarning\b/i.test(lower)) {
      if (!colors.roles.has('warning')) colors.roles.set('warning', hex);
    }
  }

  // Fallback: if primary not found, try accent, link, or most saturated named color
  if (!colors.primary) {
    const fallbackPrimary = colors.accent
      ?? colors.roles.get('cta')
      ?? colors.roles.get('link-blue') ?? colors.roles.get('link')
      ?? findMostSaturatedRole(colors.roles);
    if (fallbackPrimary) {
      colors.primary = fallbackPrimary;
      if (!colors.roles.has('primary')) colors.roles.set('primary', fallbackPrimary);
    }
  }

  // Fallback: if text not found, use darkest named color role
  if (!colors.text) {
    let darkest: string | undefined;
    let darkestLum = 1;
    for (const [, hex] of colors.roles) {
      const lum = hexLuminance(hex);
      if (lum < darkestLum && lum < 0.3) { darkestLum = lum; darkest = hex; }
    }
    if (darkest) { colors.text = darkest; colors.roles.set('text', darkest); }
  }

  // Fallback: if background not found, use lightest named color role
  if (!colors.background) {
    let lightest: string | undefined;
    let lightestLum = 0;
    for (const [, hex] of colors.roles) {
      const lum = hexLuminance(hex);
      if (lum > lightestLum && lum > 0.7) { lightestLum = lum; lightest = hex; }
    }
    if (lightest) { colors.background = lightest; colors.roles.set('background', lightest); }
  }

  // Fallback: if accent not found, try common accent role names or second most saturated
  if (!colors.accent) {
    const accentFallback = colors.roles.get('ruby') ?? colors.roles.get('brand') ?? colors.roles.get('brand-dark')
      ?? colors.roles.get('interactive') ?? colors.roles.get('link');
    if (accentFallback && accentFallback !== colors.primary) {
      colors.accent = accentFallback;
      if (!colors.roles.has('accent')) colors.roles.set('accent', accentFallback);
    }
  }

  // Parse gradients: "linear-gradient(...)" or "Name gradient: #hex to #hex"
  const gradients = new Map<string, string>();
  for (const line of lines) {
    // CSS gradient syntax
    const cssGrad = line.match(/((?:linear|radial)-gradient\([^)]+\))/i);
    if (cssGrad) {
      // Try to name it from bold text or context
      const nameMatch = line.match(/\*\*([^*]+)\*\*/);
      const name = nameMatch ? nameMatch[1].trim().toLowerCase().replace(/\s+/g, '-') : `gradient-${gradients.size}`;
      gradients.set(name, cssGrad[1]);
      continue;
    }
    // "Color1 (#hex) to Color2 (#hex)" or "`#hex` to `#hex`" pattern
    const toGrad = line.match(/`?(#[0-9a-fA-F]{3,8})`?\)?\s+to\s+\(?`?(#[0-9a-fA-F]{3,8})`?\)?/i);
    if (toGrad) {
      const nameMatch = line.match(/\*\*([^*]+)\*\*/);
      const name = nameMatch ? nameMatch[1].trim().toLowerCase().replace(/\s+/g, '-') : `gradient-${gradients.size}`;
      gradients.set(name, `linear-gradient(135deg, ${toGrad[1]}, ${toGrad[2]})`);
    }
  }
  if (gradients.size > 0) colors.gradients = gradients;

  return colors;
}

function hexLuminance(hex: string): number {
  const h = hex.replace('#', '');
  if (h.length < 6) return 0.5;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function hexSaturationParser(hex: string): number {
  const h = hex.replace('#', '');
  if (h.length < 6) return 0;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

function findMostSaturatedRole(roles: Map<string, string>): string | undefined {
  let best: string | undefined;
  let bestSat = 0;
  for (const [, hex] of roles) {
    const sat = hexSaturationParser(hex);
    if (sat > bestSat && sat > 0.3) { bestSat = sat; best = hex; }
  }
  return best;
}

// ---------------------------------------------------------------------------
//  Typography parsing
// ---------------------------------------------------------------------------

const TYPO_ROLE_PATTERNS: [RegExp, TypographyRole][] = [
  // Order matters: more specific patterns first
  [/\bbutton\b(?!\s*small)|\bcta\b/i, 'button'],
  [/\bdisclaimer\b|\blegal\b|\bfootnote\b|\bnano\b/i, 'disclaimer'],
  [/\bcaption\b|\blabel\b|\bsmall\b(?!\s*button)|\bfine\s*print\b|\boverline\b|\bmicro\b|\bmono\b|\blink\b|\bnav\b|\btabular\b/i, 'caption'],
  [/\bbody\b|\bbodyLarge\b|\bparagraph\b|\bbase\b|\bdescription\b/i, 'body'],
  [/\bh[2-3]\b|\bheading\s*[2-3]\b|\bsubhead\b|\bsubtitle\b|\bsub[- ]?heading\b|\bsub[- ]?section\b|\bcard[- ]?head\w*\b|\bfeature[- ]?title\b/i, 'subtitle'],
  [/\btitle\b|\bh1\b|\bheading\s*1\b|\bheading(?!\s*[2-6])\b|\bheadline\b|\bsection[- ]?heading\b|\bsection[- ]?title\b/i, 'title'],
  [/\bhero\b|\bdisplay\b/i, 'hero'],
];

function detectTypoRole(text: string): TypographyRole | null {
  for (const [re, role] of TYPO_ROLE_PATTERNS) {
    if (re.test(text)) return role;
  }
  return null;
}

function parseNumber(s: string): number | null {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse typography table rows.
 * Supports formats like:
 *   | Hero    | 72px  | 700  | 1.07 | -2.16px |
 *   | Body    | 16px  | 400  | 1.5  | 0       |
 */
function parseTypographyTable(text: string): TypographyRule[] {
  const rules: TypographyRule[] = [];
  const lines = text.split(/\r?\n/);

  // Find table rows (lines with |)
  const tableRows = lines.filter(l => l.includes('|') && !l.match(/^\s*\|[\s-|]+\|\s*$/));
  if (tableRows.length < 2) return rules;

  // Detect column layout from header row
  const headerCells = tableRows[0].split('|').map(c => c.trim().toLowerCase()).filter(c => c.length > 0);
  const colMap: Record<string, number> = {};
  for (let i = 0; i < headerCells.length; i++) {
    const h = headerCells[i];
    if (/role|name|style/i.test(h)) colMap.role = i;
    else if (/font(?!\s*(?:size|weight))|family|typeface/i.test(h)) colMap.font = i;
    else if (/size/i.test(h)) colMap.size = i;
    else if (/weight/i.test(h)) colMap.weight = i;
    else if (/line[- ]?height|leading/i.test(h)) colMap.lineHeight = i;
    else if (/spacing|tracking|letter/i.test(h)) colMap.letterSpacing = i;
  }

  // Process data rows (skip header)
  for (let ri = 1; ri < tableRows.length; ri++) {
    const row = tableRows[ri];
    const cells = row.split('|').map(c => c.trim()).filter(c => c.length > 0);
    if (cells.length < 2) continue;

    // First cell = role/name
    const roleName = cells[colMap.role ?? 0] ?? cells[0];
    const role = detectTypoRole(roleName);
    if (!role) continue;

    let fontSize = 16;
    let fontWeight = 400;
    let lineHeight = 1.4;
    let letterSpacing = 0;
    let fontFamily: string | undefined;
    let textTransform: 'uppercase' | 'lowercase' | 'capitalize' | 'none' | undefined;

    // Extract font family from font column or from role name parentheses e.g. "hero (Poppins)"
    if (colMap.font != null && cells[colMap.font]) {
      const fontCell = cells[colMap.font].trim();
      if (fontCell && !/^[-–—]$/.test(fontCell)) {
        fontFamily = fontCell.replace(/`/g, '');
      }
    }
    if (!fontFamily) {
      const parenMatch = roleName.match(/\(([A-Za-z][\w\s-]+)\)/);
      if (parenMatch) fontFamily = parenMatch[1].trim();
    }

    // Extract from specific columns if detected, otherwise scan all cells
    const cellsToScan = colMap.size != null ? cells : cells.slice(1);

    // fontSize — from size column or any cell with Npx pattern (px suffix optional in size column)
    const sizeCell = colMap.size != null ? cells[colMap.size] : undefined;
    if (sizeCell) {
      const fsMatch = sizeCell.match(/(\d+(?:\.\d+)?)\s*(?:px)?/i);
      if (fsMatch) {
        const val = parseNumber(fsMatch[1]);
        if (val && val >= 6 && val <= 200) fontSize = val;
      }
    } else {
      for (const cell of cellsToScan) {
        const fsMatch = cell.match(/(\d+(?:\.\d+)?)\s*px/i);
        if (fsMatch && !cell.toLowerCase().includes('spacing') && !cell.toLowerCase().includes('tracking')) {
          const val = parseNumber(fsMatch[1]);
          if (val && val >= 6 && val <= 200) { fontSize = val; break; }
        }
      }
    }

    // fontWeight — from weight column or any cell with 3-digit number
    const weightCell = colMap.weight != null ? cells[colMap.weight] : undefined;
    if (weightCell) {
      fontWeight = parseWeightCell(weightCell);
    } else {
      for (const cell of cellsToScan) {
        const w = parseWeightCell(cell);
        if (w !== 400 || /\bRegular\b|Normal\b/i.test(cell)) { fontWeight = w; break; }
      }
    }

    // lineHeight — from column or any cell with decimal like "1.03 (tight)"
    const lhCell = colMap.lineHeight != null ? cells[colMap.lineHeight] : undefined;
    if (lhCell) {
      lineHeight = parseLineHeightCell(lhCell) ?? 1.4;
    } else {
      for (const cell of cellsToScan) {
        const lh = parseLineHeightCell(cell);
        if (lh != null) { lineHeight = lh; break; }
      }
    }

    // letterSpacing — from column or any cell with negative px value
    const lsCell = colMap.letterSpacing != null ? cells[colMap.letterSpacing] : undefined;
    if (lsCell) {
      letterSpacing = parseLetterSpacingCell(lsCell) ?? 0;
    }

    // textTransform
    for (const cell of cells) {
      if (/\buppercase\b/i.test(cell)) textTransform = 'uppercase';
    }

    // Font family from Notes column or any cell mentioning a font name
    if (!fontFamily) {
      for (const cell of cellsToScan) {
        // Match font names like "Universal Sans Display", "Inter Variable", "Airbnb Cereal VF"
        const fontMatch = cell.match(/([A-Z][a-z]+(?:\s+[A-Za-z]+){1,4})\s*(?:,|$|\.|—)/);
        if (fontMatch && !/^(?:Primary|Secondary|Hero|Section|Body|Button|Card|Nav|Sub)/i.test(fontMatch[1])) {
          fontFamily = fontMatch[1].trim();
          break;
        }
      }
    }

    // Deduplicate: keep the first occurrence of each role
    if (!rules.some(r => r.role === role)) {
      rules.push({ role, fontFamily, fontSize, fontWeight, lineHeight, letterSpacing, textTransform });
    }
  }

  return rules;
}

function parseWeightCell(cell: string): number {
  // Handle ranges like "300-400" → take first
  const rangeMatch = cell.match(/\b(\d{3})\s*[-–]\s*\d{3}\b/);
  if (rangeMatch) return parseNumber(rangeMatch[1]) ?? 400;
  const weightMatch = cell.match(/\b(\d{3})\b/);
  if (weightMatch) {
    const val = parseNumber(weightMatch[1]);
    if (val && val >= 100 && val <= 900) return val;
  }
  if (/\bBold\b/i.test(cell) && !/\bSemi/i.test(cell) && !/\bExtra/i.test(cell)) return 700;
  if (/\bSemiBold\b|Semi[- ]?Bold/i.test(cell)) return 600;
  if (/\bMedium\b/i.test(cell)) return 500;
  if (/\bLight\b/i.test(cell)) return 300;
  return 400;
}

function parseLineHeightCell(cell: string): number | null {
  // Handle "1.03 (tight)" or "1.40" or "normal" or "1.33-1.45"
  const m = cell.match(/(\d+(?:\.\d+)?)(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(?:\([^)]*\))?/);
  if (!m) return null;
  const val = parseNumber(m[1]);
  if (val != null && val >= 0.8 && val <= 3) return val;
  // percentage
  const pct = cell.match(/(\d+)\s*%/);
  if (pct) {
    const p = parseNumber(pct[1]);
    if (p != null && p >= 80 && p <= 300) return p / 100;
  }
  if (/\bnormal\b/i.test(cell)) return 1.4;
  return null;
}

function parseLetterSpacingCell(cell: string): number | null {
  if (/\bnormal\b/i.test(cell)) return 0;
  const m = cell.match(/([-+]?\d+(?:\.\d+)?)\s*px/i);
  if (m) {
    const val = parseNumber(m[1]);
    if (val != null && Math.abs(val) < 20) return val;
  }
  // em values
  const em = cell.match(/([-+]?\d+(?:\.\d+)?)\s*em/i);
  if (em) {
    const val = parseNumber(em[1]);
    if (val != null) return val; // keep in em, approximate
  }
  return null;
}

/**
 * Parse typography from freeform text (non-table format).
 * Looks for patterns like:
 *   Hero: 72px / 700 / line-height 1.07 / tracking -2.16px
 *   **Title** — fontSize: 48px, weight: 600
 */
function parseTypographyFreeform(text: string): TypographyRule[] {
  const rules: TypographyRule[] = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const role = detectTypoRole(line);
    if (!role) continue;

    // INode-native format: "display:   fontSize 56  fontWeight 700  lineHeight 1.05  letterSpacing -2"
    const inodeFs = line.match(/fontSize\s+([\d.]+)/i);
    if (inodeFs) {
      const fontSize = parseNumber(inodeFs[1]);
      if (!fontSize || fontSize < 6 || fontSize > 200) continue;
      const fontWeight = parseNumber(line.match(/fontWeight\s+([\d]+)/i)?.[1] ?? '') ?? 400;
      const lineHeight = parseNumber(line.match(/lineHeight\s+([\d.]+)/i)?.[1] ?? '') ?? 1.4;
      const letterSpacing = parseNumber(line.match(/letterSpacing\s+([-\d.]+)/i)?.[1] ?? '') ?? 0;
      const fontFamilyMatch = line.match(/fontFamily\s+"([^"]+)"/i);
      if (!rules.some(r => r.role === role)) {
        rules.push({
          role, fontSize, fontWeight, lineHeight, letterSpacing,
          ...(fontFamilyMatch ? { fontFamily: fontFamilyMatch[1] } : {}),
        });
      }
      continue;
    }

    // Classic format: "Hero: 72px / 700 / line-height 1.07"
    const fsMatch = line.match(/(\d+(?:\.\d+)?)\s*px/i);
    const fallbackSizeMatch = !fsMatch
      ? line.match(/^\s*(?:[-*]\s*)?(?:\*\*)?[A-Za-z][\w\s/-]{1,30}(?:\*\*)?\s*[:\-]\s*(\d+(?:\.\d+)?)/)
      : null;
    const fontSize = parseNumber(fsMatch?.[1] ?? fallbackSizeMatch?.[1] ?? '');
    if (!fontSize || fontSize < 6 || fontSize > 200) continue;

    let fontWeight = 400;
    const wMatch = line.match(/(?:weight|wt)[:\s]*(\d{3})/i) || line.match(/\b([1-9]00)\b/);
    if (wMatch) fontWeight = parseNumber(wMatch[1]) ?? 400;
    if (/\bBold\b/i.test(line)) fontWeight = 700;
    if (/\bSemiBold\b/i.test(line)) fontWeight = 600;
    if (/\bMedium\b/i.test(line)) fontWeight = 500;
    if (/\bLight\b/i.test(line)) fontWeight = 300;

    let lineHeight = 1.4;
    const lhMatch = line.match(/line[- ]?height[:\s]*([\d.]+)/i);
    if (lhMatch) {
      const lh = parseNumber(lhMatch[1]);
      if (lh && lh >= 0.8 && lh <= 3) lineHeight = lh;
    }

    let letterSpacing = 0;
    const lsMatch = line.match(/(?:tracking|letter[- ]?spacing)[:\s]*([-+]?[\d.]+)\s*px/i);
    if (lsMatch) {
      const ls = parseNumber(lsMatch[1]);
      if (ls != null && Math.abs(ls) < 20) letterSpacing = ls;
    }

    if (!rules.some(r => r.role === role)) {
      rules.push({ role, fontSize, fontWeight, lineHeight, letterSpacing });
    }
  }

  return rules;
}

function parseFontFeatures(text: string): FontFeature[] {
  const features: FontFeature[] = [];
  const seen = new Set<string>();
  // Match OpenType feature tags: "ss01", "tnum", 'cv01', `salt`, "lnum", "locl"
  const tagRe = /[""`''""]([a-z]{2,4}\d{0,2})[""`''""]|`([a-z]{2,4}\d{0,2})`/gi;
  // Known OpenType feature tags
  const KNOWN_OT_TAGS = new Set(['ss01','ss02','ss03','ss04','ss05','ss06','ss07','ss08','ss09','ss10','ss11','ss12',
    'tnum','lnum','salt','cv01','cv02','cv03','cv04','cv05','locl','kern','liga','calt','onum','pnum','smcp','c2sc',
    'swsh','frac','ordn','subs','sups','zero','case','cpsp','titl','cswh','rlig','dlig','hlig']);

  for (const m of text.matchAll(tagRe)) {
    const tag = (m[1] || m[2]).toLowerCase();
    if (!KNOWN_OT_TAGS.has(tag)) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);

    // Determine scope from surrounding context
    const ctx = text.slice(Math.max(0, m.index! - 100), m.index! + 100).toLowerCase();
    let scope: FontFeature['scope'] = 'global';
    if (/\bbody\b|\bparagraph\b/.test(ctx)) scope = 'body';
    else if (/\bhead\b|\bdisplay\b|\bhero\b|\btitle\b/.test(ctx)) scope = 'heading';
    else if (/\bcode\b|\bmono\b/.test(ctx)) scope = 'code';

    // Try to extract description
    const descRe = new RegExp(`[""\`]${tag}[""\`]\\s*(?:\\(([^)]+)\\)|[:\\-—]\\s*([^\\n,]{3,60}))`, 'i');
    const descMatch = text.match(descRe);
    const description = descMatch?.[1]?.trim() || descMatch?.[2]?.trim();

    features.push({ tag, scope, description });
  }
  return features;
}

function extractFontFeaturesForLine(line: string): string[] | undefined {
  const tags: string[] = [];
  const re = /[""`''""]([a-z]{2,4}\d{0,2})[""`''""]|`([a-z]{2,4}\d{0,2})`/gi;
  const KNOWN = new Set(['ss01','ss02','ss03','ss04','ss05','ss06','ss07','ss08','ss09','ss10','ss11','ss12',
    'tnum','lnum','salt','cv01','cv02','cv03','cv04','cv05','locl','kern','liga','calt','onum','pnum','smcp']);
  for (const m of line.matchAll(re)) {
    const tag = (m[1] || m[2]).toLowerCase();
    if (KNOWN.has(tag) && !tags.includes(tag)) tags.push(tag);
  }
  return tags.length > 0 ? tags : undefined;
}

function parseTypography(section: Section | undefined): DesignSystem['typography'] {
  if (!section) return { hierarchy: [] };

  // Extract primary font family from "### Font Family" or "**Primary**: fontName" patterns
  let primaryFont: string | undefined;
  let secondaryFont: string | undefined;
  const fontFamilyMatch = section.body.match(/\*\*Primary\*\*[:\s]*`?([A-Za-z][\w\s-]+?)`?(?:\s*,|\s*with|\s*\n)/i)
    || section.body.match(/Primary[:\s]+`?([A-Za-z][\w\s-]+?)`?\s*(?:,|with|\n)/i);
  if (fontFamilyMatch) {
    primaryFont = fontFamilyMatch[1].trim();
  }

  // Fallback: first bold name in "### Font Family" subsection — e.g. "- **NouvelR**: The sole typeface"
  if (!primaryFont) {
    const fontSubsection = section.body.match(/###\s*Font\s*Family\b([\s\S]*?)(?=###|$)/i);
    if (fontSubsection) {
      const boldMatch = fontSubsection[1].match(/\*\*([A-Za-z][\w\s-]{1,30})\*\*/);
      if (boldMatch) primaryFont = boldMatch[1].trim();
    }
  }

  // Secondary font: "**Secondary**: fontName" or "**Monospace**: fontName"
  const secondaryMatch = section.body.match(/\*\*(?:Secondary|Monospace|Code|Accent)\*\*[:\s]*`?([A-Za-z][\w\s-]+?)`?(?:\s*,|\s*with|\s*\n)/i);
  if (secondaryMatch) {
    secondaryFont = secondaryMatch[1].trim();
  }
  // Fallback: second bold name in Font Family subsection (skip "No secondary", "OpenType", "Primary")
  if (!secondaryFont) {
    const fontSubsection = section.body.match(/###\s*Font\s*Family\b([\s\S]*?)(?=###|$)/i);
    if (fontSubsection) {
      const boldNames = [...fontSubsection[1].matchAll(/\*\*([A-Za-z][\w\s-]{1,30})\*\*/g)]
        .map(m => m[1].trim())
        .filter(n => !/^(?:Primary|No |OpenType|Font)/i.test(n));
      if (boldNames.length >= 2) secondaryFont = boldNames[1];
    }
  }

  // Try table format first
  let rules = parseTypographyTable(section.body);
  if (rules.length === 0) {
    rules = parseTypographyFreeform(section.body);
  }

  // Extract font features per table row — scan the same table rows
  const tableLines = section.body.split(/\r?\n/).filter(l => l.includes('|') && !l.match(/^\s*\|[\s-|]+\|\s*$/));
  if (tableLines.length >= 2) {
    for (let ri = 1; ri < tableLines.length; ri++) {
      const line = tableLines[ri];
      const role = detectTypoRole(line);
      if (!role) continue;
      const features = extractFontFeaturesForLine(line);
      if (features) {
        const rule = rules.find(r => r.role === role);
        if (rule && !rule.fontFeatures) rule.fontFeatures = features;
      }
    }
  }

  // Backfill font family from section-level font family if not set in table
  if (primaryFont) {
    for (const rule of rules) {
      if (!rule.fontFamily) rule.fontFamily = primaryFont;
    }
  }

  // Sort by fontSize descending (hero → caption)
  rules.sort((a, b) => b.fontSize - a.fontSize);

  // Parse global font features
  const fontFeatures = parseFontFeatures(section.body);

  return {
    hierarchy: rules,
    fontFeatures: fontFeatures.length > 0 ? fontFeatures : undefined,
    primaryFont,
    secondaryFont,
  };
}

// ---------------------------------------------------------------------------
//  Component parsing
// ---------------------------------------------------------------------------

// ─── Shared component helpers ────────────────────────────────

function extractColor(line: string): string | undefined {
  return extractFirstColor(line) ?? undefined;
}

function extractPadding(text: string): { paddingX?: number; paddingY?: number } {
  // "Padding: 8px 16px" or "padding: 12px 32px" or "0px 6px"
  const m = text.match(/padding[:\s]*([\d.]+)\s*px\s+([\d.]+)\s*px/i);
  if (m) {
    const py = parseNumber(m[1]);
    const px = parseNumber(m[2]);
    return { paddingY: py != null ? py : undefined, paddingX: px != null ? px : undefined };
  }
  const single = text.match(/padding[:\s]*([\d.]+)\s*px/i);
  if (single) { const v = parseNumber(single[1]); return { paddingX: v != null ? v : undefined, paddingY: v != null ? v : undefined }; }
  return {};
}

function extractRadius(text: string): number | undefined {
  const m = text.match(/radius[:\s]*(\d+)\s*(?:px|%)/i);
  if (m) return parseNumber(m[1]) ?? undefined;
  if (/\bpill\b/i.test(text)) return 9999;
  return undefined;
}

function parseInteractiveState(text: string, prefix: string): InteractiveState | undefined {
  // "Hover: #4434d4 background" or "hover: background shifts to rgba(...)"
  const re = new RegExp(`${prefix}[:\\s]*(.+)`, 'im');
  const m = text.match(re);
  if (!m) return undefined;
  const line = m[1];
  const state: InteractiveState = {};
  const bg = extractColor(line);
  if (bg) state.background = bg;
  const opMatch = line.match(/opacity[:\s]*([\d.]+)/i);
  if (opMatch) state.opacity = parseNumber(opMatch[1]) ?? undefined;
  const scaleMatch = line.match(/scale[:\s]*([\d.]+)/i);
  if (scaleMatch) state.scale = parseNumber(scaleMatch[1]) ?? undefined;
  if (Object.keys(state).length === 0) return undefined;
  return state;
}

// ─── Button parsing ──────────────────────────────────────────

function parseButtonVariants(text: string): ButtonVariant[] {
  const variants: ButtonVariant[] = [];
  // Split on bold names: **Primary Purple**, **Ghost / Outlined**, etc.
  const variantBlocks = text.split(/\n\s*\*\*/).filter(b => b.trim().length > 0);

  for (const block of variantBlocks) {
    const nameMatch = block.match(/^([^*\n]+)\*\*/);
    if (!nameMatch) continue;
    const rawName = nameMatch[1].trim().toLowerCase();

    // Map to canonical variant name
    let name = 'primary';
    if (/ghost|outline/i.test(rawName)) name = 'ghost';
    else if (/secondary/i.test(rawName)) name = 'secondary';
    else if (/transparent|tertiary|info/i.test(rawName)) name = 'tertiary';
    else if (/neutral|muted|disabled/i.test(rawName)) name = 'neutral';
    else if (/destructive|danger|delete/i.test(rawName)) name = 'destructive';
    else if (/icon/i.test(rawName)) name = 'icon';
    else if (/pill/i.test(rawName)) name = 'pill';
    else if (/super/i.test(rawName)) name = 'super';

    if (variants.some(v => v.name === name)) continue;

    const lines = block.split(/\r?\n/);
    const variant: ButtonVariant = { name };

    for (const line of lines) {
      const lower = line.toLowerCase();
      if (/^-\s*background/i.test(line.trim())) variant.background = extractColor(line);
      if (/^-\s*text/i.test(line.trim()) && !/text-transform/i.test(lower)) variant.color = extractColor(line);
      if (/^-\s*border/i.test(line.trim())) variant.borderColor = extractColor(line);
      if (/radius/i.test(lower)) variant.borderRadius = extractRadius(line);
      if (/font.*weight|weight/i.test(lower)) {
        const w = line.match(/(\d{3})/);
        if (w) variant.fontWeight = parseNumber(w[1]) ?? undefined;
      }
      if (/font.*(\d+(?:\.\d+)?)\s*px/i.test(line)) {
        const fs = line.match(/(\d+(?:\.\d+)?)\s*px/i);
        if (fs) variant.fontSize = parseNumber(fs[1]) ?? undefined;
      }
      if (/uppercase/i.test(lower)) variant.textTransform = 'uppercase';
      if (/min[- ]?height/i.test(lower)) {
        const mh = line.match(/(\d+)\s*px/);
        if (mh) variant.minHeight = parseNumber(mh[1]) ?? undefined;
      }
    }

    // Padding
    const padBlock = lines.join('\n');
    const pad = extractPadding(padBlock);
    if (pad.paddingX != null) variant.paddingX = pad.paddingX;
    if (pad.paddingY != null) variant.paddingY = pad.paddingY;

    // Hover state
    variant.hover = parseInteractiveState(padBlock, 'hover');

    variants.push(variant);
  }

  return variants;
}

function parseButtonSpec(text: string): ButtonSpec | undefined {
  let buttonText = text;
  const buttonSectionMatch = text.match(/###\s*Buttons?\b([\s\S]*?)(?=###|$)/i);
  if (buttonSectionMatch) {
    buttonText = buttonSectionMatch[1];
  }

  const lower = buttonText.toLowerCase();

  let borderRadius = 8;
  let style: ButtonStyle = 'rounded';

  const brMatch = lower.match(/radius[:\s]*(\d+)\s*px/i);
  if (brMatch) {
    borderRadius = parseNumber(brMatch[1]) ?? 8;
    style = borderRadius >= 50 ? 'pill' : borderRadius === 0 ? 'square' : 'rounded';
  } else if (/\bpill\b.*button|button.*\bpill\b/i.test(lower)) {
    borderRadius = 9999;
    style = 'pill';
  } else if (/\bsquare\b.*button|button.*\bsquare\b/i.test(lower) || /radius[:\s]*0\s*px/i.test(lower)) {
    borderRadius = 0;
    style = 'square';
  }

  let fontWeight: number | undefined;
  const fwMatch = lower.match(/(?:button|cta).*?(?:weight|wt)[:\s]*(\d{3})/i)
    || lower.match(/(?:font[- ]?weight|weight|wt)[:\s]*(\d{3})/i);
  if (fwMatch) fontWeight = parseNumber(fwMatch[1]) ?? undefined;

  let textTransform: 'uppercase' | 'none' | undefined;
  if (/text[- ]?transform[:\s]*uppercase|button.*uppercase|uppercase.*button/i.test(lower)) textTransform = 'uppercase';
  if (/text[- ]?transform[:\s]*none/i.test(lower)) textTransform = 'none';

  // Parse variants
  const variants = parseButtonVariants(buttonText);

  return { borderRadius, style, fontWeight, textTransform, variants: variants.length > 0 ? variants : undefined };
}

// ─── Card parsing ────────────────────────────────────────────

function parseCardSpec(text: string): CardSpec | undefined {
  const cardSection = text.match(/###\s*Cards?\b([\s\S]*?)(?=###|$)/i);
  if (!cardSection) return undefined;
  const block = cardSection[1];

  const card: CardSpec = { borderRadius: 8 };
  const r = extractRadius(block);
  if (r != null) card.borderRadius = r;

  const bg = block.match(/background[:\s]*`?([^`\n]+)`?/i);
  if (bg) card.background = extractColor(bg[1]) ?? undefined;

  const border = block.match(/border[:\s]*`?([^`\n]+)`?/i);
  if (border) card.borderColor = extractColor(border[1]) ?? undefined;

  const pad = extractPadding(block);
  if (pad.paddingX != null) card.padding = pad.paddingX;

  // Shadow layer count
  const shadowMatches = block.match(/shadow/gi);
  if (shadowMatches) card.shadowLayers = Math.min(shadowMatches.length, 5);

  card.hover = parseInteractiveState(block, 'hover');

  return card;
}

// ─── Badge parsing ───────────────────────────────────────────

function parseBadgeSpec(text: string): BadgeSpec | undefined {
  const badgeSection = text.match(/###\s*(?:Badges?|Tags?|Pills?)\b([\s\S]*?)(?=###|$)/i);
  if (!badgeSection) return undefined;
  const block = badgeSection[1];

  // Take the first variant block
  const firstVariant = block.match(/\*\*([^*]+)\*\*([\s\S]*?)(?=\*\*|$)/);
  const varBlock = firstVariant ? firstVariant[2] : block;

  const badge: BadgeSpec = { borderRadius: extractRadius(varBlock) ?? 4 };
  const bg = varBlock.match(/background[:\s]*`?([^`\n]+)`?/i);
  if (bg) badge.background = extractColor(bg[1]) ?? undefined;
  const color = varBlock.match(/^-\s*text[:\s]*`?([^`\n]+)`?/im);
  if (color) badge.color = extractColor(color[1]) ?? undefined;
  const font = varBlock.match(/font[:\s]*(\d+)\s*px/i);
  if (font) badge.fontSize = parseNumber(font[1]) ?? undefined;
  const fw = varBlock.match(/weight\s*(\d{3})/i);
  if (fw) badge.fontWeight = parseNumber(fw[1]) ?? undefined;
  const pad = extractPadding(varBlock);
  if (pad.paddingX != null) badge.paddingX = pad.paddingX;
  if (pad.paddingY != null) badge.paddingY = pad.paddingY;

  return badge;
}

// ─── Input parsing ───────────────────────────────────────────

function parseInputSpec(text: string): InputSpec | undefined {
  const inputSection = text.match(/###\s*(?:Inputs?|Forms?)\b([\s\S]*?)(?=###|$)/i);
  if (!inputSection) return undefined;
  const block = inputSection[1];

  const input: InputSpec = { borderRadius: extractRadius(block) ?? 4 };
  const border = block.match(/border[:\s]*`?([^`\n]+)`?/i);
  if (border) input.borderColor = extractColor(border[1]) ?? undefined;
  const font = block.match(/(?:font|label|text)[:\s]*.*?(\d+)\s*px/i);
  if (font) input.fontSize = parseNumber(font[1]) ?? undefined;
  const height = block.match(/height[:\s]*(\d+)\s*px/i);
  if (height) input.height = parseNumber(height[1]) ?? undefined;
  const bg = block.match(/background[:\s]*`?([^`\n]+)`?/i);
  if (bg) input.background = extractColor(bg[1]) ?? undefined;

  // Focus state
  const focusBorder = block.match(/focus[:\s]*`?([^`\n]+)`?/i);
  if (focusBorder) input.focusBorderColor = extractColor(focusBorder[1]) ?? undefined;
  input.focus = parseInteractiveState(block, 'focus');

  return input;
}

// ─── Nav parsing ─────────────────────────────────────────────

function parseNavSpec(text: string): NavSpec | undefined {
  const navSection = text.match(/###\s*Navigation\b([\s\S]*?)(?=###|$)/i);
  if (!navSection) return undefined;
  const block = navSection[1];

  const nav: NavSpec = {};
  const height = block.match(/height[:\s]*(\d+)\s*px/i);
  if (height) nav.height = parseNumber(height[1]) ?? undefined;
  const bg = block.match(/background[:\s]*`?([^`\n]+)`?/i);
  if (bg) nav.background = extractColor(bg[1]) ?? undefined;
  const font = block.match(/(\d+)\s*px/i);
  if (font) nav.fontSize = parseNumber(font[1]) ?? undefined;
  const fw = block.match(/weight\s*(\d{3})/i);
  if (fw) nav.fontWeight = parseNumber(fw[1]) ?? undefined;
  if (/underline|border-bottom/i.test(block)) nav.activeIndicator = 'underline';
  else if (/bold|font-weight.*700/i.test(block)) nav.activeIndicator = 'bold';
  else if (/dot\b/i.test(block)) nav.activeIndicator = 'dot';

  return nav;
}

// ─── Unified component parser ────────────────────────────────

function parseComponents(section: Section | undefined): DesignSystemComponents {
  if (!section) return {};
  const text = section.body;
  return {
    button: parseButtonSpec(text),
    card: parseCardSpec(text),
    badge: parseBadgeSpec(text),
    input: parseInputSpec(text),
    nav: parseNavSpec(text),
  };
}

// ---------------------------------------------------------------------------
//  Layout parsing
// ---------------------------------------------------------------------------

function parseLayout(section: Section | undefined): DesignSystemLayout {
  const defaults: DesignSystemLayout = {
    spacingUnit: 8,
    borderRadiusScale: [0, 2, 4, 8, 12, 16],
  };
  if (!section) return defaults;

  const text = section.body;

  // Spacing unit: "spacing: 8px" or "unit: 8" (INode-native)
  const spMatch = text.match(/(?:spacing|grid|base|unit)[:\s]*(\d+)\s*(?:px)?/i);
  if (spMatch) defaults.spacingUnit = parseNumber(spMatch[1]) ?? 8;

  // Max width — also matches "approximately 1080px", "~1200px", "around 1200px"
  const mwMatch = text.match(/(?:max[- ]?(?:content[- ]?)?width|container)[:\s]*(?:approximately\s*|~\s*|around\s*)?(\d+)\s*px/i);
  if (mwMatch) defaults.maxWidth = parseNumber(mwMatch[1]) ?? undefined;

  // Section spacing
  const ssMatch = text.match(/(?:section[- ]?spacing|section[- ]?gap|vertical[- ]?rhythm)[:\s]*(\d+)\s*(?:px)?[+]?/i);
  if (ssMatch) defaults.sectionSpacing = parseNumber(ssMatch[1]) ?? undefined;

  // Border radius scale: look for scale within radius context
  // Match "radius scale: 0 4 8 12" or lines with "button: N  card: N  badge: N"
  const lines = text.split(/\r?\n/);
  let inRadiusContext = false;
  for (const line of lines) {
    if (/radius/i.test(line)) inRadiusContext = true;
    if (/spacing|typography|theme/i.test(line)) inRadiusContext = false;

    if (inRadiusContext) {
      // "scale: 0  4  8  12  16  9999"
      const scaleMatch = line.match(/^scale[:\s]*([\d\s,]+)/i);
      if (scaleMatch) {
        const nums = scaleMatch[1].match(/\d+/g);
        if (nums && nums.length >= 3) {
          defaults.borderRadiusScale = nums.map(n => parseInt(n, 10)).filter(n => Number.isFinite(n));
        }
      }
      // "button: 8  card: 12  badge: 9999"
      const componentRadii = [...line.matchAll(/(?:button|card|badge|input|image)[:\s]*(\d+)/gi)];
      if (componentRadii.length >= 2) {
        const vals = new Set(defaults.borderRadiusScale);
        for (const m of componentRadii) vals.add(parseInt(m[1], 10));
        defaults.borderRadiusScale = [...vals].sort((a, b) => a - b);
      }
    }
  }

  // Legacy: border-radius-scale: 0, 2, 4, 8
  const brScaleMatch = text.match(/(?:border[- ]?radius)[- ]?scale[:\s]*([\d\s,px]+)/i);
  if (brScaleMatch) {
    const nums = brScaleMatch[1].match(/\d+/g);
    if (nums && nums.length >= 3) {
      defaults.borderRadiusScale = nums.map(n => parseInt(n, 10)).filter(n => Number.isFinite(n));
    }
  }

  // Fallback: extract radius values from lines like "Standard (4px)", "- Micro (1px)"
  if (defaults.borderRadiusScale.length <= 6) {
    const radiusValues = new Set(defaults.borderRadiusScale);
    const radiusLines = text.match(/(?:radius|corner|rounding)[:\s]*(\d+)\s*px/gi);
    if (radiusLines) {
      for (const match of radiusLines) {
        const n = match.match(/(\d+)\s*px/);
        if (n) radiusValues.add(parseInt(n[1], 10));
      }
    }
    // Extract from lines near "radius" keyword — including lines AFTER a radius heading
    const lines = text.split(/\r?\n/);
    let inRadiusBlock = false;
    for (const line of lines) {
      if (/radius/i.test(line)) inRadiusBlock = true;
      else if (/^#{2,3}\s/.test(line) || line.trim() === '') inRadiusBlock = line.trim() === '' ? inRadiusBlock : false;

      if (inRadiusBlock || /radius/i.test(line)) {
        const pxValues = [...line.matchAll(/(\d+)\s*(?:px|%)/g)].map(m => parseInt(m[1], 10));
        for (const v of pxValues) if (v <= 100 || v === 9999) radiusValues.add(v);
      }
    }
    if (radiusValues.size > defaults.borderRadiusScale.length) {
      defaults.borderRadiusScale = [...radiusValues].sort((a, b) => a - b);
    }
  }

  // Spacing scale: "| space-1 | 4px |" or "scale: 4, 8, 12, 16, 24, 32, 48, 64"
  const spacingScale = new Set<number>();
  const scaleLineMatch = text.match(/(?:spacing\s*)?scale[:\s]*([\d\s,px]+)/i);
  if (scaleLineMatch) {
    const nums = scaleLineMatch[1].match(/\d+/g);
    if (nums) for (const n of nums) spacingScale.add(parseInt(n, 10));
  }
  // Table rows: "| space-N | Npx |" or "| token | value |"
  for (const line of lines) {
    if (!line.includes('|')) continue;
    const spTableMatch = line.match(/space[- ]?\d+\s*\|\s*(\d+)\s*px/i);
    if (spTableMatch) spacingScale.add(parseInt(spTableMatch[1], 10));
  }
  if (spacingScale.size >= 3) {
    defaults.spacingScale = [...spacingScale].sort((a, b) => a - b);
  }

  return defaults;
}

// ---------------------------------------------------------------------------
//  Responsive parsing
// ---------------------------------------------------------------------------

function parseResponsive(section: Section | undefined): DesignSystemResponsive {
  const result: DesignSystemResponsive = {
    breakpoints: [],
    typographyOverrides: [],
  };
  if (!section) return result;

  const text = section.body;

  // Parse breakpoints from table or list
  // Handles: "| Mobile | <640px |", "| Tablet | 640-1024px |", "| Desktop | >1280px |"
  // Also: "| Mobile Small | <600px |", "| Large Desktop | >1280px |"
  // And en-dash: "600–640px"
  const bpLines = text.split(/\r?\n/);
  const BP_NAME_RE = /\b(mobile\s*(?:small)?|tablet|desktop|laptop|large\s*desktop|wide|small|medium|large|xl|xxl)\b/i;

  for (const line of bpLines) {
    const nameMatch = line.match(BP_NAME_RE);
    if (!nameMatch) continue;

    // Extract width: try <N, N-N, >N, or standalone N patterns
    const widths = [...line.matchAll(/(\d{3,4})\s*px/g)].map(m => parseInt(m[1], 10));
    if (widths.length === 0) continue;

    const name = nameMatch[1].trim().toLowerCase().replace(/\s+/g, '-');
    // Use the first width value (for <640px → 640, for 640-1024px → 640)
    const width = widths[0];

    if (!result.breakpoints.some(b => b.name === name)) {
      result.breakpoints.push({ name, width });
    }
  }

  // Sort breakpoints ascending
  result.breakpoints.sort((a, b) => a.width - b.width);

  // Parse typography overrides: "Hero: 72px → 48px → 36px" or table with breakpoint columns
  // Look for responsive typography table
  const tableStart = text.indexOf('|');
  if (tableStart >= 0) {
    const tableText = text.slice(tableStart);
    const tableLines = tableText.split(/\r?\n/).filter(l => l.includes('|') && !l.match(/^\s*\|[\s-|]+\|\s*$/));

    if (tableLines.length >= 2) {
      // First row might be header
      const headerCells = tableLines[0].split('|').map(c => c.trim()).filter(c => c.length > 0);

      // Try to find breakpoint names in header
      const bpColumns: { index: number; name: string }[] = [];
      for (let i = 1; i < headerCells.length; i++) {
        const bpName = headerCells[i].toLowerCase();
        if (result.breakpoints.some(b => bpName.includes(b.name)) || /mobile|tablet|desktop/i.test(bpName)) {
          bpColumns.push({ index: i, name: bpName.replace(/[^a-z]/g, '') });
        }
      }

      if (bpColumns.length > 0) {
        for (let r = 1; r < tableLines.length; r++) {
          const cells = tableLines[r].split('|').map(c => c.trim()).filter(c => c.length > 0);
          const role = detectTypoRole(cells[0] ?? '');
          if (!role) continue;

          for (const { index, name } of bpColumns) {
            const cell = cells[index];
            if (!cell) continue;
            const fsMatch = cell.match(/(\d+(?:\.\d+)?)\s*px/);
            if (fsMatch) {
              const fontSize = parseNumber(fsMatch[1]);
              if (fontSize && fontSize >= 6 && fontSize <= 200) {
                result.typographyOverrides.push({ breakpointName: name, role, fontSize });
              }
            }
          }
        }
      }
    }
  }

  // Fallback: parse "Hero: 72px → 48px → 36px" patterns
  if (result.typographyOverrides.length === 0 && result.breakpoints.length > 0) {
    const arrowLines = text.split(/\r?\n/).filter(l => l.includes('→') || l.includes('->'));
    for (const line of arrowLines) {
      const role = detectTypoRole(line);
      if (!role) continue;
      const sizes = [...line.matchAll(/(\d+(?:\.\d+)?)\s*px/g)].map(m => parseNumber(m[1])).filter(n => n != null) as number[];
      if (sizes.length >= 2) {
        // First size = desktop (largest breakpoint), subsequent = smaller breakpoints
        const bpsSorted = [...result.breakpoints].sort((a, b) => b.width - a.width);
        for (let i = 0; i < Math.min(sizes.length, bpsSorted.length); i++) {
          result.typographyOverrides.push({
            breakpointName: bpsSorted[i].name,
            role,
            fontSize: sizes[i],
          });
        }
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
//  Depth / Shadow parsing
// ---------------------------------------------------------------------------

function parseShadowValue(str: string): ShadowLayer | null {
  const isInset = /\binset\b/i.test(str);
  const clean = str.replace(/\binset\b/gi, '').trim();

  // CSS box-shadow can be: "rgba(...) 0px 4px 8px 0px" OR "0px 4px 8px 0px rgba(...)"
  // Try color-first format (most common in DESIGN.md files)
  const colorFirst = clean.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8})\s+([-\d.]+)\s*px?\s+([-\d.]+)\s*px?\s+([-\d.]+)\s*px?(?:\s+([-\d.]+)\s*px?)?/i);
  if (colorFirst) {
    return {
      color: colorFirst[1],
      offsetX: parseNumber(colorFirst[2]) ?? 0,
      offsetY: parseNumber(colorFirst[3]) ?? 0,
      blur: parseNumber(colorFirst[4]) ?? 0,
      spread: parseNumber(colorFirst[5] ?? '0') ?? 0,
      ...(isInset ? { inset: true } : {}),
    };
  }
  // Try offsets-first format
  const offsetFirst = clean.match(/([-\d.]+)\s*px?\s+([-\d.]+)\s*px?\s+([-\d.]+)\s*px?(?:\s+([-\d.]+)\s*px?)?\s+(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8})/i);
  if (offsetFirst) {
    return {
      offsetX: parseNumber(offsetFirst[1]) ?? 0,
      offsetY: parseNumber(offsetFirst[2]) ?? 0,
      blur: parseNumber(offsetFirst[3]) ?? 0,
      spread: parseNumber(offsetFirst[4] ?? '0') ?? 0,
      color: offsetFirst[5],
      ...(isInset ? { inset: true } : {}),
    };
  }
  return null;
}

function parseDepth(section: Section | undefined): DesignSystemDepth | undefined {
  if (!section) return undefined;

  const levels: ShadowLayer[][] = [];
  const lines = section.body.split(/\r?\n/);

  for (const line of lines) {
    // Skip table headers and separators
    if (/^\s*\|[\s-|]+\|\s*$/.test(line)) continue;
    if (/Level\s*\|.*Treatment/i.test(line)) continue;

    // Extract shadow values from the line (may be in backticks or free text)
    // Remove backticks and pipe separators for cleaner parsing
    const cleanLine = line.replace(/`/g, '').replace(/\|/g, ' ');

    // Find all shadow patterns: rgba/hex followed by px values, or px values followed by rgba/hex
    const shadows: ShadowLayer[] = [];

    // Split multi-layer shadows: "rgba(...) 0px 4px 8px, rgba(...) 0px 2px 4px"
    // Split on comma followed by rgba or hex (start of new shadow)
    const shadowParts = cleanLine.split(/,\s*(?=rgba|#[0-9a-f])/i);
    for (const part of shadowParts) {
      const shadow = parseShadowValue(part);
      if (shadow) shadows.push(shadow);
    }

    if (shadows.length > 0) {
      levels.push(shadows);
    }
  }

  return levels.length > 0 ? { elevationLevels: levels } : undefined;
}

// ---------------------------------------------------------------------------
//  Brand name extraction
// ---------------------------------------------------------------------------

function extractBrand(md: string): string {
  // Look for # BrandName at the top
  const lines = md.split(/\r?\n/).slice(0, 10);
  for (const line of lines) {
    const m = line.match(/^#\s+(.+?)(?:\s*[-–—]\s*.+)?$/);
    if (m) {
      let brand = m[1].trim();
      // Strip "Design System:" prefix if present
      brand = brand.replace(/^Design\s+System[:\s]*/i, '').trim();
      return brand;
    }
  }
  return 'Unknown';
}

// ---------------------------------------------------------------------------
//  Main parser
// ---------------------------------------------------------------------------

/**
 * Parse a DESIGN.md markdown string into a DesignSystem object.
 *
 * The parser is forgiving — missing sections produce empty/default values.
 * It handles the standard 9-section format and common variations.
 */
export function parseDesignMd(markdown: string): DesignSystem {
  const sections = splitSections(markdown);

  // Fallback: if standard section headers are missing/unusual, parse from full markdown body.
  const fallbackSection: Section = { title: 'full-document', body: markdown };
  // Find color section — careful: "Visual Theme & Atmosphere" is NOT the color section
  const colorSection = findSection(sections, 'color', 'palette')
    ?? sections.find(s => s.title.toLowerCase() === 'theme')  // exact "Theme" (our format)
    ?? fallbackSection;
  const typoSection = findSection(sections, 'typography', 'type', 'font') ?? fallbackSection;
  const componentSection = findSection(sections, 'component', 'styling', 'button', 'element') ?? fallbackSection;
  const layoutSection = findSection(sections, 'layout', 'spacing', 'grid') ?? fallbackSection;
  const radiusSection = findSection(sections, 'radius', 'corner');
  const depthSection = findSection(sections, 'depth', 'elevation', 'shadow');
  const responsiveSection = findSection(sections, 'responsive', 'breakpoint', 'adaptive');
  const rulesSection = findSection(sections, 'rules', 'do', 'don');

  // Parse layout, then overlay radius if separate section exists
  const parsedLayout = parseLayout(layoutSection);
  if (radiusSection) {
    const radiusText = radiusSection.body;
    // "scale: 0  4  8  12  16  9999"
    const scaleMatch = radiusText.match(/scale[:\s]*([\d\s,]+)/i);
    if (scaleMatch) {
      const nums = scaleMatch[1].match(/\d+/g);
      if (nums && nums.length >= 2) {
        parsedLayout.borderRadiusScale = nums.map(n => parseInt(n, 10)).filter(n => Number.isFinite(n));
      }
    }
    // "button: 8  card: 12  badge: 9999" — add to scale
    const componentRadii = [...radiusText.matchAll(/(?:button|card|badge|input|image)[:\s]*(\d+)/gi)];
    if (componentRadii.length > 0) {
      const vals = new Set(parsedLayout.borderRadiusScale);
      for (const m of componentRadii) vals.add(parseInt(m[1], 10));
      parsedLayout.borderRadiusScale = [...vals].sort((a, b) => a - b);
    }
  }

  // Extract section spacing from responsive section if not in layout
  if (!parsedLayout.sectionSpacing && responsiveSection) {
    const ssMatch = responsiveSection.body.match(/section[- ]?spacing[:\s]*(\d+)\s*(?:px)?[+]?/i);
    if (ssMatch) parsedLayout.sectionSpacing = parseNumber(ssMatch[1]) ?? undefined;
  }

  const parsedColors = parseColors(colorSection);

  // If gradients not found in color section, scan component section and full doc
  if (!parsedColors.gradients || parsedColors.gradients.size === 0) {
    for (const fallbackSec of [componentSection, fallbackSection]) {
      if (!fallbackSec) continue;
      const gradColors = parseColors(fallbackSec);
      if (gradColors.gradients && gradColors.gradients.size > 0) {
        parsedColors.gradients = gradColors.gradients;
        break;
      }
    }
  }

  return {
    brand: extractBrand(markdown),
    colors: parsedColors,
    typography: parseTypography(typoSection),
    components: parseComponents(componentSection),
    layout: parsedLayout,
    responsive: parseResponsive(responsiveSection),
    depth: parseDepth(depthSection),
    rawMarkdown: markdown,
  };
}
