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
  ButtonStyle,
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

function parseColors(section: Section | undefined): DesignSystemColors {
  const colors: DesignSystemColors = { roles: new Map() };
  if (!section) return colors;

  const lines = section.body.split(/\r?\n/);

  // First pass: extract all named colors with their hex values
  // Pattern: **Name** (`#hex`): description
  for (const line of lines) {
    const hexes = extractHexColors(line);
    if (hexes.length === 0) continue;
    const hex = hexes[0];

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
    const hexes = extractHexColors(line);
    if (hexes.length === 0) continue;
    const hex = hexes[0];

    if (roleName === 'primary' && !colors.primary) { colors.primary = hex; colors.roles.set('primary', hex); }
    if (roleName === 'background' && !colors.background) { colors.background = hex; colors.roles.set('background', hex); }
    if (roleName === 'text' && !colors.text) { colors.text = hex; colors.roles.set('text', hex); }
    if (roleName === 'accent' && !colors.accent) { colors.accent = hex; colors.roles.set('accent', hex); }
    if (!colors.roles.has(roleName)) colors.roles.set(roleName, hex);
  }

  // Third pass: detect semantic roles from context in non-table lines
  // Use stricter matching to avoid false positives like "link text" matching "text"
  for (const line of lines) {
    const hexes = extractHexColors(line);
    if (hexes.length === 0) continue;
    const hex = hexes[0];
    const lower = line.toLowerCase();

    // Match "Primary brand color" or line starts with "**...Primary..." — but NOT "link text" for text role
    if (!colors.primary && /\bprimary\s*(?:brand|color|cta|accent)?\b/i.test(lower) && !/\bprimary\s*(?:heading|text|link)\b/i.test(lower)) {
      colors.primary = hex;
      if (!colors.roles.has('primary')) colors.roles.set('primary', hex);
    }

    // Background: match "page background", "primary background", "canvas" — but not "CTA backgrounds"
    if (!colors.background && (/\bpage\s*background\b|\bprimary.*background\b|^\s*-\s*\*\*.*(?:white|background|canvas)\*\*/i.test(lower))) {
      colors.background = hex;
      if (!colors.roles.has('background')) colors.roles.set('background', hex);
    }

    // Text: match "heading color", "body text", "primary text" — not just any line with "text" in description
    if (!colors.text && (/\b(?:heading|body|primary)\s*(?:text\s*)?color\b|\bheading\s*(?:color|solid)\b/i.test(lower) ||
        /^\s*-\s*\*\*.*(?:navy|heading|foreground|text)\*\*/i.test(lower))) {
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

  return colors;
}

// ---------------------------------------------------------------------------
//  Typography parsing
// ---------------------------------------------------------------------------

const TYPO_ROLE_PATTERNS: [RegExp, TypographyRole][] = [
  [/\bhero\b|display\s*(?:hero|xl)/i, 'hero'],
  [/\btitle\b|h1\b|display(?!\s*hero|\s*xl)\b|headline|section\s*head/i, 'title'],
  [/\bh2\b|subtitle|subhead|sub[- ]?heading/i, 'subtitle'],
  [/\bbody\b|paragraph|base/i, 'body'],
  [/\bcaption\b|small(?!\s*button)|fine\s*print|overline|micro/i, 'caption'],
  [/\bdisclaimer\b|legal|footnote|nano/i, 'disclaimer'],
  [/\bbutton\b(?!\s*small)|cta\b/i, 'button'],
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

    const fsMatch = line.match(/(\d+(?:\.\d+)?)\s*px/);
    if (!fsMatch) continue;
    const fontSize = parseNumber(fsMatch[1]);
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

function parseTypography(section: Section | undefined): { hierarchy: TypographyRule[] } {
  if (!section) return { hierarchy: [] };

  // Extract primary font family from "### Font Family" or "**Primary**: fontName" patterns
  let primaryFont: string | undefined;
  const fontFamilyMatch = section.body.match(/\*\*Primary\*\*[:\s]*`?([A-Za-z][\w\s-]+?)`?(?:\s*,|\s*with|\s*\n)/i)
    || section.body.match(/Primary[:\s]+`?([A-Za-z][\w\s-]+?)`?\s*(?:,|with|\n)/i);
  if (fontFamilyMatch) {
    primaryFont = fontFamilyMatch[1].trim();
  }

  // Try table format first
  let rules = parseTypographyTable(section.body);
  if (rules.length === 0) {
    rules = parseTypographyFreeform(section.body);
  }

  // Backfill font family from section-level font family if not set in table
  if (primaryFont) {
    for (const rule of rules) {
      if (!rule.fontFamily) rule.fontFamily = primaryFont;
    }
  }

  // Sort by fontSize descending (hero → caption)
  rules.sort((a, b) => b.fontSize - a.fontSize);

  return { hierarchy: rules };
}

// ---------------------------------------------------------------------------
//  Component parsing
// ---------------------------------------------------------------------------

function parseButtonSpec(text: string): ButtonSpec | undefined {
  // Focus only on button-related sections (not badges/pills)
  // Extract the text between "### Button" and the next "###" section
  let buttonText = text;
  const buttonSectionMatch = text.match(/###\s*Buttons?\b([\s\S]*?)(?=###|$)/i);
  if (buttonSectionMatch) {
    buttonText = buttonSectionMatch[1];
  }

  const lower = buttonText.toLowerCase();

  // Border radius — look for explicit "Radius: Npx" in button context
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

  // Font weight
  let fontWeight: number | undefined;
  const fwMatch = lower.match(/(?:button|cta).*?(?:weight|wt)[:\s]*(\d{3})/i);
  if (fwMatch) fontWeight = parseNumber(fwMatch[1]) ?? undefined;

  // Text transform
  let textTransform: 'uppercase' | 'none' | undefined;
  if (/button.*uppercase|uppercase.*button/i.test(lower)) textTransform = 'uppercase';

  return { borderRadius, style, fontWeight, textTransform };
}

function parseComponents(section: Section | undefined): DesignSystemComponents {
  if (!section) return {};
  const button = parseButtonSpec(section.body);
  return { button };
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

  // Spacing unit
  const spMatch = text.match(/(?:spacing|grid|base)[:\s]*(\d+)\s*px/i);
  if (spMatch) defaults.spacingUnit = parseNumber(spMatch[1]) ?? 8;

  // Max width — also matches "approximately 1080px", "~1200px", "around 1200px"
  const mwMatch = text.match(/(?:max[- ]?(?:content[- ]?)?width|container)[:\s]*(?:approximately\s*|~\s*|around\s*)?(\d+)\s*px/i);
  if (mwMatch) defaults.maxWidth = parseNumber(mwMatch[1]) ?? undefined;

  // Section spacing
  const ssMatch = text.match(/(?:section[- ]?spacing|section[- ]?gap|vertical[- ]?rhythm)[:\s]*(\d+)\s*px/i);
  if (ssMatch) defaults.sectionSpacing = parseNumber(ssMatch[1]) ?? undefined;

  // Border radius scale: "0, 2, 4, 8, 12, 16, 9999" or similar
  const brScaleMatch = text.match(/(?:border[- ]?radius|radius)[- ]?scale[:\s]*([[\d\s,px]+)/i);
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
    // Also extract from "N px" patterns near "radius" keyword in same paragraph
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (/radius/i.test(line)) {
        const pxValues = [...line.matchAll(/(\d+)\s*px/g)].map(m => parseInt(m[1], 10));
        for (const v of pxValues) if (v <= 100) radiusValues.add(v);
      }
    }
    if (radiusValues.size > defaults.borderRadiusScale.length) {
      defaults.borderRadiusScale = [...radiusValues].sort((a, b) => a - b);
    }
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
  // CSS box-shadow can be: "rgba(...) 0px 4px 8px 0px" OR "0px 4px 8px 0px rgba(...)"
  // Try color-first format (most common in DESIGN.md files)
  const colorFirst = str.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8})\s+([-\d.]+)\s*px?\s+([-\d.]+)\s*px?\s+([-\d.]+)\s*px?(?:\s+([-\d.]+)\s*px?)?/i);
  if (colorFirst) {
    return {
      color: colorFirst[1],
      offsetX: parseNumber(colorFirst[2]) ?? 0,
      offsetY: parseNumber(colorFirst[3]) ?? 0,
      blur: parseNumber(colorFirst[4]) ?? 0,
      spread: parseNumber(colorFirst[5] ?? '0') ?? 0,
    };
  }
  // Try offsets-first format
  const offsetFirst = str.match(/([-\d.]+)\s*px?\s+([-\d.]+)\s*px?\s+([-\d.]+)\s*px?(?:\s+([-\d.]+)\s*px?)?\s+(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8})/i);
  if (offsetFirst) {
    return {
      offsetX: parseNumber(offsetFirst[1]) ?? 0,
      offsetY: parseNumber(offsetFirst[2]) ?? 0,
      blur: parseNumber(offsetFirst[3]) ?? 0,
      spread: parseNumber(offsetFirst[4] ?? '0') ?? 0,
      color: offsetFirst[5],
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

  const colorSection = findSection(sections, 'color', 'palette');
  const typoSection = findSection(sections, 'typography', 'type', 'font');
  const componentSection = findSection(sections, 'component', 'styling', 'button', 'element');
  const layoutSection = findSection(sections, 'layout', 'spacing', 'grid');
  const depthSection = findSection(sections, 'depth', 'elevation', 'shadow');
  const responsiveSection = findSection(sections, 'responsive', 'breakpoint', 'adaptive');

  return {
    brand: extractBrand(markdown),
    colors: parseColors(colorSection),
    typography: parseTypography(typoSection),
    components: parseComponents(componentSection),
    layout: parseLayout(layoutSection),
    responsive: parseResponsive(responsiveSection),
    depth: parseDepth(depthSection),
    rawMarkdown: markdown,
  };
}
