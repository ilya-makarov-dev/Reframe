/**
 * Brand tokens endpoint — Phase 1 UI-5b Pin #1.
 *
 *   GET /platform/api/brand/tokens?slug=<brand>
 *     → 200 { palette: { name, hex, role }[] }
 *     → 404 { ok:false, error:"brand not loaded" }
 *
 * Reads `.reframe/brands/<slug>/DESIGN.md` and extracts every named
 * color token into a flat list with role inference. Powers the color
 * picker rail's top row (brand palette) — designer's brand chips show
 * up before custom hex even comes into view.
 *
 * Why a fresh helper instead of reusing `core/design-system/parser.ts`:
 *
 *   - parser.ts emits a structured `DesignSystemColors` (primary /
 *     background / text / accent + Map of generic roles). The picker
 *     rail wants the OPPOSITE — a flat ordered list with original
 *     name + hex preserved, including secondary accents the structured
 *     parser collapses into a single 'accent' bucket.
 *   - parser.ts's role-extraction regex requires `**Name**` followed
 *     directly by `\`#hex\`` or `(`. It misses kurzgesagt-style
 *     `- **Solar orange:** \`#ff9f1c\` — desc` because the colon is
 *     inside the bold span. We need permissive list-bullet support.
 *   - Designer expectation: clicking a swatch labelled "Solar orange"
 *     should bind to the token literally named "Solar orange", not
 *     "accent". Token names are part of the brand's vocabulary.
 *
 * Role inference: scans the closest preceding `### Subhead` for
 * keywords (Background → 'background', Accent → 'accent', Text →
 * 'text', Semantic / Status → 'semantic'). When the subhead is
 * unambiguous and the line itself has a "Primary"/"Secondary" name,
 * the more specific name role wins (e.g. under `### Background` a
 * line `- **Primary:** \`#hex\`` → role: 'primary' not 'background').
 *
 * Cache profile: per-process Map keyed by slug + DESIGN.md mtime.
 * Brand DESIGN.md changes rarely; reading + parsing on every request
 * is fine but the cache saves ~5ms on busy inspector sessions.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PlatformContext } from '../router.js';

export interface BrandPaletteToken {
  /** Original name as written in DESIGN.md (e.g. "Solar orange", "Primary"). */
  name: string;
  /** 6-digit lowercase hex with leading #. Always normalized. */
  hex: string;
  /**
   * Inferred role bucket. Coarse — designers see the *name*, role is
   * for grouping when the rail wants to render headings ("Accents",
   * "Neutrals") above the swatches.
   */
  role: 'primary' | 'accent' | 'background' | 'text' | 'neutral' | 'semantic' | 'other';
}

const HEX_RE = /#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\b/i;

/** Normalize 3-digit hex to 6-digit, lowercase, drop alpha (last 2 chars on 8-digit). */
function normalizeHex(raw: string): string | null {
  const m = raw.toLowerCase().match(/^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length === 8) h = h.slice(0, 6);
  return '#' + h;
}

function inferRole(subhead: string, name: string): BrandPaletteToken['role'] {
  const sh = subhead.toLowerCase();
  const nm = name.toLowerCase();
  // Specific-name override (within a generic subhead): primary/secondary
  // remain semantically meaningful even under "### Background".
  if (nm.includes('primary') && !nm.includes('text')) return 'primary';
  // Subhead keywords
  if (/accent|highlight/.test(sh)) return 'accent';
  if (/background|surface|canvas|fill/.test(sh)) return 'background';
  if (/\btext\b|typography|copy|label/.test(sh)) return 'text';
  if (/neutral|grey|gray|muted|chrome/.test(sh)) return 'neutral';
  if (/semantic|status|alert|state|feedback/.test(sh)) return 'semantic';
  // Name-keyword fallback when subhead is generic/empty
  if (/accent|highlight|cta/.test(nm)) return 'accent';
  if (/text|label|caption/.test(nm)) return 'text';
  if (/bg|background|surface/.test(nm)) return 'background';
  if (/muted|grey|gray|neutral/.test(nm)) return 'neutral';
  return 'other';
}

/**
 * Pure helper. Extracts every named color token from a DESIGN.md body.
 *
 * Permissive line shapes (each pulled from real brand cache):
 *   - **Primary:** `#1c2541` — deep navy
 *   - **Solar orange:** `#ff9f1c` — the sun
 *   - **Primary text:** `#f7f9fb` (near-white)
 *   - Primary: `#0071E3`
 *   - **Accent BG:** `#3a506b` — muted slate for cards
 *
 * Returns [] when the input has no Colors section or no parseable
 * tokens. Caller turns [] into "Brand not loaded" empty state in UI.
 */
export function parsePaletteFromDesignMd(content: string): BrandPaletteToken[] {
  const tokens: BrandPaletteToken[] = [];
  const seen = new Set<string>(); // dedup by name+hex
  if (!content || typeof content !== 'string') return tokens;
  const lines = content.split(/\r?\n/);

  // Find the Colors / Color Palette section (case-insensitive). Numbered
  // headings like "## 2. Color Palette" are common — match loosely.
  let inColors = false;
  let colorsHeadingDepth = 0;
  let currentSubhead = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      const depth = headingMatch[1].length;
      const text = headingMatch[2].toLowerCase();
      if (/(^|\b)(colors?|color\s*palette|palette)(\b|$)/.test(text)) {
        // Entering Colors section.
        inColors = true;
        colorsHeadingDepth = depth;
        currentSubhead = '';
        continue;
      }
      if (inColors) {
        // Exit Colors when a same-or-shallower heading appears that
        // isn't itself a Colors-related header.
        if (depth <= colorsHeadingDepth) { inColors = false; currentSubhead = ''; continue; }
        // Sub-heading inside Colors — track for role inference.
        currentSubhead = headingMatch[2];
        continue;
      }
    }
    if (!inColors) continue;

    // Skip code fences inside the section.
    if (/^\s*```/.test(line)) continue;

    // Look for hex on this line; if absent, skip.
    const hexMatch = line.match(HEX_RE);
    if (!hexMatch) continue;
    const hex = normalizeHex(hexMatch[0]);
    if (!hex) continue;

    // Extract a name. Try patterns in order of specificity.
    let name: string | null = null;

    //  1) `**Name:** \`#hex\``  or  `**Name:** #hex` (kurzgesagt / standard)
    const m1 = line.match(/\*\*([^*:]{1,60}?)\s*:\s*\*\*\s*[`]?#/);
    if (m1) name = m1[1].trim();

    //  2) `**Name** (\`#hex\`)`  or  `**Name** \`#hex\``
    if (!name) {
      const m2 = line.match(/\*\*([^*]{1,60}?)\*\*\s*\(?\s*[`]?#/);
      if (m2) name = m2[1].trim().replace(/[:()]/g, '').trim();
    }

    //  3) `Name: #hex` or `- name: #hex` (list / table cell)
    if (!name) {
      const m3 = line.match(/^\s*(?:[-*]\s*)?([A-Za-z][\w\s/-]{1,60})\s*[:=]\s*[`]?#/);
      if (m3) name = m3[1].trim();
    }

    //  4) `| Name | #hex |` (table)
    if (!name && line.includes('|')) {
      const cells = line.split('|').map((c) => c.trim()).filter((c) => c.length > 0);
      if (cells.length >= 2) {
        // First non-hex cell is the name.
        const nameCell = cells.find((c) => !/^#?[0-9a-f]{3,8}$/i.test(c) && !c.startsWith('`#'));
        if (nameCell) name = nameCell.replace(/[`*]/g, '').trim();
      }
    }

    if (!name) continue;
    // Strip residual markdown / punctuation and normalize whitespace.
    name = name.replace(/[`*]/g, '').replace(/\s+/g, ' ').trim();
    if (!name || name.length > 60) continue;

    const dedupKey = name.toLowerCase() + '|' + hex;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const role = inferRole(currentSubhead, name);
    tokens.push({ name, hex, role });
  }
  return tokens;
}

// ─── Cache + endpoint ──────────────────────────────────────────

interface CacheEntry { mtimeMs: number; tokens: BrandPaletteToken[]; }
const PALETTE_CACHE = new Map<string, CacheEntry>();

function brandsRoot(projectDir: string): string {
  return path.join(projectDir, '.reframe', 'brands');
}

function designMdPath(projectDir: string, slug: string): string {
  return path.join(brandsRoot(projectDir), slug, 'DESIGN.md');
}

/** Test hook — reset the per-process cache between tests. */
export function clearBrandTokensCache(): void {
  PALETTE_CACHE.clear();
}

export async function handleBrandTokensApi(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PlatformContext,
): Promise<boolean> {
  if (req.method !== 'GET') return false;
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/platform/api/brand/tokens') return false;

  const slug = url.searchParams.get('slug') ?? '';
  if (!slug || !/^[A-Za-z0-9_-]+$/.test(slug)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'slug required' }));
    return true;
  }

  const projectDir = ctx.projectDir;
  if (!projectDir) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'no project open' }));
    return true;
  }

  const filePath = designMdPath(projectDir, slug);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'brand not loaded', slug }));
    return true;
  }

  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(filePath).mtimeMs;
  } catch {
    mtimeMs = 0;
  }

  const cached = PALETTE_CACHE.get(slug);
  if (cached && cached.mtimeMs === mtimeMs) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, palette: cached.tokens }));
    return true;
  }

  let body: string;
  try {
    body = fs.readFileSync(filePath, 'utf8');
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: `read failed: ${err?.message ?? err}` }));
    return true;
  }

  const tokens = parsePaletteFromDesignMd(body);
  PALETTE_CACHE.set(slug, { mtimeMs, tokens });

  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ ok: true, palette: tokens }));
  return true;
}
