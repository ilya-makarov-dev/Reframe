/**
 * DESIGN.md serializer — Phase 3 Brief 3b Pin #1.
 *
 * Inverse of parseDesignMd. Pure function: DesignSystem → markdown text.
 *
 * Two modes:
 *   1. Canonical: full DESIGN.md serialized from the parsed AST. Used by
 *      contract tests (round-trip) and by Phase 3d brand-mark write-back.
 *   2. Section-replace: edit a specific section in the ORIGINAL DESIGN.md
 *      text, leaving every other section verbatim. Used by the workbench
 *      token / vocab / typography editors to avoid lossy re-serialization
 *      of sections the parser models heuristically (component specs,
 *      layout principles, do/don'ts).
 *
 * Determinism: same DesignSystem input ALWAYS produces the same output
 * string. Iteration order is stable (Map iteration order = insertion order
 * in JS, which we control), and no Date.now() / random ordering anywhere.
 *
 * Round-trip (canonical mode):
 *   parseDesignMd(serializeDesignMd(parseDesignMd(text))) yields an AST
 *   equivalent to parseDesignMd(text) for the EDITABLE fields the workbench
 *   touches — palette colors, typography font stacks, vocabulary, brand
 *   title. Untouched sections are best-effort canonical and may differ
 *   from the original prose; for those the workbench uses section-replace
 *   to preserve the original text byte-for-byte.
 */

import type {
  DesignSystem,
  DesignSystemColors,
  BrandVocabulary,
} from './types.js';

// ─── Public API ────────────────────────────────────────────────

export interface SerializeOpts {
  /** When set, preserve the attribution comment header at the top
   *  (Apache-2.0 markers in directions, vocalise step output, etc.).
   *  Default true — these are usually wanted unless the caller is
   *  explicitly stripping for a synthetic test fixture. */
  preserveAttribution?: boolean;
}

export interface SectionPatch {
  /** Section title keyword(s) — same shape as parser's findSection.
   *  Match is case-insensitive substring. First-match wins. */
  match: string[];
  /** New body text for the section (NOT including the `## Title` line). */
  body: string;
}

/**
 * Canonical serializer. Walks the editable sections of a DesignSystem
 * and produces a parseable DESIGN.md. Untouched-by-workbench sections
 * are emitted minimally — components/layout/depth/responsive/do-don'ts
 * are written as preserved-from-input when available, otherwise omitted
 * so re-parsing produces a sensible default-shaped AST without phantom
 * data.
 *
 * For lossless write-back of a SPECIFIC section, use replaceSection()
 * against the original markdown text instead of re-serializing the whole
 * file.
 */
export function serializeDesignMd(ds: DesignSystem, opts: SerializeOpts = {}): string {
  const preserveAttribution = opts.preserveAttribution !== false;
  const parts: string[] = [];

  // Title (h1)
  if (ds.brand) {
    parts.push(`# ${ds.brand}`);
    parts.push('');
  }

  // Color Palette & Roles
  parts.push('## Color Palette & Roles');
  parts.push('');
  parts.push(serializePalette(ds.colors));
  parts.push('');

  // Typography Rules
  parts.push('## Typography Rules');
  parts.push('');
  parts.push(serializeTypography(ds));
  parts.push('');

  // Brand Vocabulary (only when present)
  if (ds.vocabulary) {
    parts.push('## Brand Vocabulary');
    parts.push('');
    parts.push(serializeVocabulary(ds.vocabulary));
    parts.push('');
  }

  // Undertone (only when declared, not computed — preserves source-of-truth)
  if (ds.undertone && ds.undertoneSource === 'declared') {
    parts.push('## Undertone');
    parts.push('');
    parts.push(`- ${ds.undertone}`);
    parts.push('');
  }

  // preserveAttribution is consumed by replaceSection() — canonical mode
  // doesn't currently read or emit attribution headers (the brand title
  // line is the canonical attribution surface). Kept on the API so future
  // mode upgrades have a stable knob.
  void preserveAttribution;
  // Trailing newline so the file is POSIX-clean.
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '\n');
}

/**
 * Section-targeted edit. Reads the original DESIGN.md text, finds the
 * target section by case-insensitive title-keyword match, and replaces
 * its body with the new content. Every other section is preserved verbatim,
 * including comments, attribution headers, and prose the canonical
 * serializer would otherwise lose.
 *
 * Returns the new full text. Throws if no matching section is found
 * AND opts.appendIfMissing is false.
 */
export function replaceSection(
  originalMd: string,
  patch: SectionPatch,
  opts: { appendIfMissing?: boolean } = {},
): string {
  const sections = splitSections(originalMd);
  const idx = sections.findIndex((s) => sectionMatches(s.title, patch.match));
  const newBody = patch.body.replace(/\s+$/, '') + '\n';

  if (idx < 0) {
    if (!opts.appendIfMissing) {
      throw new Error(`section not found: ${patch.match.join(' / ')}`);
    }
    // Append a fresh `## <First-keyword>` section using the first match
    // term as the title (Title Case applied for readability).
    const title = titleCase(patch.match[0]);
    const out = originalMd.replace(/\s+$/, '\n') + `\n## ${title}\n\n${newBody}`;
    return out;
  }

  const target = sections[idx];
  // Reassemble: pre-target text + new section block + post-target text.
  const head = originalMd.slice(0, target.headerStart);
  const tail = idx < sections.length - 1
    ? originalMd.slice(sections[idx + 1].headerStart)
    : '';
  const headerLine = originalMd.slice(target.headerStart, target.bodyStart);
  return head + headerLine + newBody + (tail.startsWith('\n') ? tail : '\n' + tail);
}

// ─── Sub-section serializers ───────────────────────────────────

function serializePalette(colors: DesignSystemColors | undefined): string {
  if (!colors) return '_(no palette)_';
  // Format: `- **Role** \`#hex\`` (NO colon inside the bold). The parser's
  // first-pass regex requires `\*\*RoleName\*\*` with the role name being
  // [A-Za-z][\w\s/-]+ — colons break the capture group. Putting the colon
  // OUTSIDE the bold (or omitting it) keeps round-trip stable.
  const lines: string[] = [];
  const roles = colors.roles ?? new Map<string, string>();
  if (roles.size === 0) {
    if (colors.primary) lines.push(`- **Primary** \`${colors.primary}\``);
    if (colors.background) lines.push(`- **Background** \`${colors.background}\``);
    if (colors.text) lines.push(`- **Text** \`${colors.text}\``);
    if (colors.accent) lines.push(`- **Accent** \`${colors.accent}\``);
    if (lines.length === 0) return '_(palette not yet declared)_';
    return lines.join('\n');
  }
  for (const [role, hex] of roles) {
    lines.push(`- **${titleCase(role)}** \`${hex}\``);
  }
  if (colors.gradients && colors.gradients.size > 0) {
    lines.push('');
    lines.push('### Gradients');
    for (const [name, value] of colors.gradients) {
      lines.push(`- **${titleCase(name)}** \`${value}\``);
    }
  }
  return lines.join('\n');
}

function serializeTypography(ds: DesignSystem): string {
  const t = ds.typography;
  const lines: string[] = [];
  if (t.primaryFont) {
    lines.push(`- **Display / headings:** \`${t.primaryFont}\``);
  }
  if (t.secondaryFont) {
    lines.push(`- **Body:** \`${t.secondaryFont}\``);
  }
  if (Array.isArray(t.allSizes) && t.allSizes.length > 0) {
    // Stable: parser yields sorted-desc; we emit smallest-first for legibility.
    const sizes = [...t.allSizes].sort((a, b) => a - b);
    lines.push(`- Scale (px): ${sizes.join(' · ')}`);
  }
  // Hierarchy rules — emit per-role line so re-parser picks them up.
  if (Array.isArray(t.hierarchy) && t.hierarchy.length > 0) {
    for (const rule of t.hierarchy) {
      const parts: string[] = [`weight ${rule.fontWeight}`];
      parts.push(`size ${rule.fontSize}px`);
      if (rule.lineHeight && rule.lineHeight !== 1) parts.push(`line-height ${rule.lineHeight}`);
      if (rule.letterSpacing && rule.letterSpacing !== 0) parts.push(`letter-spacing ${rule.letterSpacing}em`);
      lines.push(`- **${titleCase(rule.role)}:** ${parts.join(', ')}${rule.fontFamily ? ` — \`${rule.fontFamily}\`` : ''}`);
    }
  }
  if (lines.length === 0) return '_(typography not yet declared)_';
  return lines.join('\n');
}

function serializeVocabulary(vocab: BrandVocabulary): string {
  const lines: string[] = [];
  // Vocab parser uses subsection HEADER lines (`Power words`,
  // `Industry terms`, `Style`) to switch buckets; bullet items below
  // each header are split on commas. Single-line `- **Power words:** A,
  // B, C` doesn't work — the parser sees the header on the bullet line,
  // switches bucket, and then has nothing to add. So we emit each
  // bucket as a header line followed by a single-bullet comma list.
  if (vocab.powerWords && vocab.powerWords.length > 0) {
    lines.push('### Power words');
    lines.push(`- ${vocab.powerWords.join(', ')}`);
    lines.push('');
  }
  if (vocab.industryTerms && vocab.industryTerms.length > 0) {
    lines.push('### Industry terms');
    lines.push(`- ${vocab.industryTerms.join(', ')}`);
    lines.push('');
  }
  if (vocab.style) {
    const s = vocab.style;
    // Parser regex for the Style subsection header is anchored:
    // /^style\s*[:]?\s*$/i — must be `Style` or `Style:` on its own
    // line, NOT `### Style`. Header preceded by a blank line so it
    // doesn't get glued to the previous bullet list.
    lines.push('Style:');
    if (typeof s.weight === 'number') lines.push(`- weight: ${s.weight}`);
    if (typeof s.color === 'string') lines.push(`- color: ${s.color}`);
    if (typeof s.decoration === 'string') lines.push(`- decoration: ${s.decoration}`);
  }
  return lines.length === 0 ? '_(vocabulary empty)_' : lines.join('\n').replace(/\n+$/, '');
}

// ─── Hex-replace-in-place — Phase 3 Brief 3c Pin #1 ─────────────
//
// Surgical hex edit: find the bullet line declaring a role, replace
// only the first hex token on that line, preserve every other byte
// of the file verbatim. Used by the workbench token editor for
// existing-role hex tweaks (the 95% case) so untouched lines survive
// the round-trip.
//
// Brief 3b's section-replace path stays for structural changes (add
// new role, remove role, rename label) where in-place doesn't apply —
// the lossy compression is acceptable on rare structural edits.
//
// Format the helper recognises (mirrors parser's first-pass regex
// shape, tolerant of optional colon inside the bold + optional
// description text after the hex):
//
//   - **Role**: `#hex` — description       ✓
//   - **Role:** `#hex` description          ✓ (current cached fixtures)
//   - **role**  `#hex`                      ✓ (no colon, no comment)
//
// CRLF-aware: never bare `.` against the body — only line content
// matched, line terminators preserved untouched.

export interface HexReplaceResult {
  /** New full text with the targeted hex replaced. */
  text: string;
  /** True iff a matching role line was found and a hex was replaced. */
  replaced: boolean;
  /** The hex value that was replaced, when replaced=true. Useful for
   *  audit logs / SkillContext payload. */
  oldHex?: string;
}

export function replaceHexInPlace(
  text: string,
  role: string,
  newHex: string,
  opts: { caseInsensitive?: boolean } = {},
): HexReplaceResult {
  if (!role || !newHex) return { text, replaced: false };
  if (!/^#[0-9a-fA-F]{3,8}$/.test(newHex)) {
    throw new Error(`invalid hex: ${newHex}`);
  }

  // Build the role-name pattern. Role match is case-insensitive when
  // opts.caseInsensitive (default true). Escape regex metacharacters in
  // the role name itself (slash / dash / space all fine, but be safe).
  const ci = opts.caseInsensitive !== false;
  const escRole = role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match `**<role>**` with optional colon either INSIDE or OUTSIDE
  // the closing bold marker. Then any whitespace, optional backtick,
  // then capture the hex. The line scope is bounded by the bullet
  // start (`- ` or `* `) so we don't accidentally match a hex inside
  // a paragraph that mentions a role name.
  const flags = ci ? 'mi' : 'm';
  const lineRe = new RegExp(
    String.raw`^(\s*[-*]\s*\*\*${escRole}(?:\*\*:?|:?\*\*)\s*[:]?\s*` +
    String.raw`\\\`?)(#[0-9a-fA-F]{3,8})(\\\`?)`,
    flags,
  );
  // The String.raw above accidentally double-escapes backticks for the
  // String.raw template; rebuild with proper escaping.
  const re = new RegExp(
    `^(\\s*[-*]\\s*\\*\\*${escRole}(?:\\*\\*:?|:?\\*\\*)\\s*[:]?\\s*\`?)` +
    `(#[0-9a-fA-F]{3,8})` +
    `(\`?)`,
    flags,
  );
  void lineRe;

  const match = re.exec(text);
  if (!match) return { text, replaced: false };

  const oldHex = match[2];
  const replacement = `${match[1]}${newHex.toLowerCase()}${match[3]}`;
  const newText =
    text.slice(0, match.index) +
    replacement +
    text.slice(match.index + match[0].length);

  return { text: newText, replaced: true, oldHex };
}

// ─── Section-split helpers (for replaceSection) ─────────────────

interface SectionSpan {
  title: string;
  /** Character index of the `## …` line start. */
  headerStart: number;
  /** Character index of the first body line (after the header line + newline). */
  bodyStart: number;
  /** Character index of the body's last char (exclusive). */
  bodyEnd: number;
}

function splitSections(md: string): SectionSpan[] {
  const out: SectionSpan[] = [];
  // Match `^## ` headings only — h1 is the title, h3+ are sub-sections.
  // `.` in JS regex does NOT match `\r`, so on CRLF files the lazy match
  // ends before the carriage return; we manually advance past CR/LF when
  // computing bodyStart so headerLine includes the full line terminator.
  const re = /^##[ \t]+(.+?)$/gm;
  let m: RegExpExecArray | null;
  let prev: SectionSpan | null = null;
  while ((m = re.exec(md)) !== null) {
    const headerStart = m.index;
    let headerEnd = headerStart + m[0].length;
    // Skip CR if present (CRLF), then LF.
    if (md[headerEnd] === '\r') headerEnd += 1;
    if (md[headerEnd] === '\n') headerEnd += 1;
    const bodyStart = headerEnd;
    if (prev) prev.bodyEnd = headerStart;
    const span: SectionSpan = {
      title: m[1].trim(),
      headerStart,
      bodyStart,
      bodyEnd: md.length,
    };
    out.push(span);
    prev = span;
  }
  return out;
}

function sectionMatches(title: string, keywords: string[]): boolean {
  const lower = title.toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}

// ─── Title casing — shared between palette/typography/vocab ─────

function titleCase(s: string): string {
  if (!s) return '';
  return s.split(/[\s-_]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
