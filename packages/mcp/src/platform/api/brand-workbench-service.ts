/**
 * Brand Workbench service layer — Phase 3 Brief 3a.
 *
 * Pure orchestration over existing brand state owners. The workbench
 * does NOT own brand state; it presents fragmented sources coherently
 * and emits scoped events for live preview.
 *
 * Owners we wrap (per Brief 3a executor map):
 *   - core/project/io.ts:           manifest.activeBrand + setActiveBrand(virtualSlug)
 *   - mcp/store.ts:                 StoredScene.brand (per-scene)
 *   - api/variations.ts:            applyBrandToScene + applyBrandInheritance
 *   - api/node-edit.ts:             /brand/switch + /brand/apply HTTP routes
 *   - core/design-system/parser.ts: DESIGN.md → DesignSystem
 *
 * Foundation includes Phase 3.5 skill-bus invocation context hooks
 * (skillInvocationContext) ready but NOT wired — bus integration is
 * Phase 3.5 territory. Hooks just collect scope.
 */

import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import type { DesignSystem, BrandVocabulary } from '../../../../core/src/design-system/types.js';
import {
  parseDesignMd,
  replaceSection,
  replaceHexInPlace,
} from '../../../../core/src/design-system/index.js';
import {
  loadProject,
} from '../../../../core/src/project/io.js';
import { getScene, listScenes } from '../../store.js';

// ─── Types ─────────────────────────────────────────────────────

export interface BrandCatalogEntry {
  /** Stable slug used everywhere (URL, manifest, file path). */
  slug: string;
  /** Display name — Title Case from slug, can be overridden by DESIGN.md heading. */
  name: string;
  /** Up to 6 swatch hex strings drawn from the parsed palette. */
  swatches: string[];
  /** Primary font family if parsed. */
  primaryFont?: string;
  /** How many StoredScenes currently use this brand (per-scene `brand` field). */
  scenesUsing: number;
  /** Whether this brand is the project default (`manifest.activeBrand`). */
  isProjectDefault: boolean;
  /** Whether the brand was a Phase 2.5 direction (slugs frozen at ship). */
  isDirection: boolean;
}

export interface SceneRef {
  /** sessionId */
  id: string;
  slug: string;
  name: string;
}

export interface SkillContext {
  brandSlug: string;
  activeSceneId?: string;
  selectedTokens?: string[];
}

/** Phase 2.5 direction slugs. Hard-coded — they ship with the build. */
export const DIRECTION_SLUGS: ReadonlySet<string> = new Set([
  'editorial-monocle',
  'modern-minimal',
  'warm-soft',
  'tech-utility',
  'brutalist-experimental',
]);

// ─── Helpers ───────────────────────────────────────────────────

function brandsDir(projectDir: string): string {
  return join(projectDir, '.reframe', 'brands');
}

function readBrandDesignMd(projectDir: string, slug: string): string | null {
  const file = join(brandsDir(projectDir), slug, 'DESIGN.md');
  if (!existsSync(file)) return null;
  try { return readFileSync(file, 'utf-8'); } catch { return null; }
}

function titleCase(slug: string): string {
  return slug.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function pickSwatches(ds: DesignSystem | null, max = 6): string[] {
  if (!ds) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (hex: string | undefined | null) => {
    if (!hex || typeof hex !== 'string') return;
    const norm = hex.toLowerCase().trim();
    if (!/^#[0-9a-f]{3,8}$/.test(norm)) return;
    if (seen.has(norm)) return;
    seen.add(norm);
    out.push(norm);
  };
  // Priority: brand role colors first (primary / accent / surface / text),
  // then full palette.
  const colors = ds.colors as any;
  if (colors) {
    push(colors.primary);
    push(colors.accent);
    push(colors.background);
    push(colors.surface);
    push(colors.text);
    push(colors.muted);
    if (Array.isArray(colors.palette)) {
      for (const p of colors.palette) push(typeof p === 'string' ? p : p?.hex);
    }
    if (colors.scale && typeof colors.scale === 'object') {
      for (const v of Object.values(colors.scale)) push(typeof v === 'string' ? v : (v as any)?.hex);
    }
  }
  return out.slice(0, max);
}

// ─── Public service surface ────────────────────────────────────

/**
 * Catalog the brands currently visible to the workbench. Source = the
 * filesystem cache at .reframe/brands/<slug>/DESIGN.md. Remote getdesign
 * registry is NOT polled here (it's slow + flaky on Windows per design.ts
 * comment) — the dashboard's existing brand-extract flow remains the way
 * to add new brands; the workbench shows what's locally available so the
 * page renders fast.
 */
export function listBrandCatalog(projectDir: string): BrandCatalogEntry[] {
  const dir = brandsDir(projectDir);
  if (!existsSync(dir)) return [];
  const manifest = loadProject(projectDir);
  const projectDefault = manifest?.activeBrand ?? null;

  // Per-scene usage map: count StoredScenes whose `brand` matches each slug.
  const usageBySlug = new Map<string, number>();
  for (const s of listScenes()) {
    const stored = getScene(s.id);
    const b = stored?.brand;
    if (b) usageBySlug.set(b, (usageBySlug.get(b) ?? 0) + 1);
  }

  const entries: BrandCatalogEntry[] = [];
  for (const slug of readdirSync(dir)) {
    try {
      const sub = join(dir, slug);
      if (!statSync(sub).isDirectory()) continue;
      const md = readBrandDesignMd(projectDir, slug);
      if (!md) continue;
      let ds: DesignSystem | null = null;
      try { ds = parseDesignMd(md); } catch { /* tolerate parse errors */ }
      // Prefer the DESIGN.md "# Title" heading when present.
      const headingMatch = md.match(/^#\s+(.+)$/m);
      const name = (headingMatch?.[1] || ds?.brand || titleCase(slug)).trim();
      entries.push({
        slug,
        name,
        swatches: pickSwatches(ds),
        primaryFont: ds?.typography?.primaryFont,
        scenesUsing: usageBySlug.get(slug) ?? 0,
        isProjectDefault: slug === projectDefault,
        isDirection: DIRECTION_SLUGS.has(slug),
      });
    } catch { /* skip malformed brand dirs */ }
  }
  // Stable sort: directions first (curated), then alpha.
  entries.sort((a, b) => {
    if (a.isDirection !== b.isDirection) return a.isDirection ? -1 : 1;
    return a.slug.localeCompare(b.slug);
  });
  return entries;
}

/**
 * Load a single brand's parsed DesignSystem. Returns null when the slug
 * has no cached DESIGN.md — caller decides whether to extract or 404.
 */
export function loadBrandDS(projectDir: string, slug: string): {
  ds: DesignSystem;
  raw: string;
} | null {
  const md = readBrandDesignMd(projectDir, slug);
  if (!md) return null;
  try {
    return { ds: parseDesignMd(md), raw: md };
  } catch {
    return null;
  }
}

/**
 * Resolve the brand a given scene is currently using.
 *
 * Per the executor's Q2 finding: engine supports per-scene brand fully
 * (StoredScene.brand). UI surfaces (color picker rail, bottom chat chip,
 * dashboard chips) historically read manifest.activeBrand globally and
 * thus pivot incorrectly when a scene's brand differs from the project
 * default. This helper is the canonical resolver — surfaces should call
 * it instead of touching manifest.activeBrand directly.
 */
export function getActiveBrandForScene(
  projectDir: string,
  sceneId: string | null,
): string | null {
  if (sceneId) {
    const stored = getScene(sceneId);
    if (stored?.brand) return stored.brand;
  }
  const manifest = loadProject(projectDir);
  return manifest?.activeBrand ?? null;
}

/**
 * Enumerate scenes that are pinned to a brand. Used by the workbench's
 * "scenes using this brand" strip. Reads StoredScene.brand directly.
 */
export function listScenesUsingBrand(brandSlug: string): SceneRef[] {
  const out: SceneRef[] = [];
  for (const s of listScenes()) {
    const stored = getScene(s.id);
    if (stored?.brand === brandSlug) {
      out.push({ id: s.id, slug: s.slug, name: s.name });
    }
  }
  return out;
}

// ─── Editor write-back surface — Phase 3 Brief 3b ──────────────
//
// Three editors share the same flow: read DESIGN.md, mutate the
// targeted section's body via replaceSection (so untouched sections
// stay verbatim — components / layout / depth / etc. are heuristic-
// parsed and re-serializing them whole would lose prose), write
// back, return the new parsed DesignSystem.
//
// All three return the new DS so the caller can decide whether to
// reload from disk or use the in-memory copy. Callers also get a
// SkillContext payload for Phase 3.5 — this is the foundation hook
// the brief flagged: when the skill-bus arrives, /critic could
// auto-suggest a fidelity check after dramatic edits without any
// further wiring on the editor side.

export interface EditResult {
  ok: true;
  ds: DesignSystem;
  skillContext: SkillContext & {
    changeType: 'token-edit' | 'vocab-edit' | 'typography-edit';
    changedFields?: Record<string, unknown>;
  };
}

function writeAndReparse(
  projectDir: string,
  brandSlug: string,
  sectionMatch: string[],
  newBody: string,
): { md: string; ds: DesignSystem } {
  const file = join(brandsDir(projectDir), brandSlug, 'DESIGN.md');
  if (!existsSync(file)) {
    throw new Error(`brand ${brandSlug} has no DESIGN.md to edit`);
  }
  const original = readFileSync(file, 'utf-8');
  const updated = replaceSection(original, { match: sectionMatch, body: newBody }, { appendIfMissing: true });
  writeFileSync(file, updated, 'utf-8');
  const ds = parseDesignMd(updated);
  return { md: updated, ds };
}

/** Render the palette section as DESIGN.md bullets. Mirrors the parser's
 *  expected `- **Role:** \`#hex\`` shape. Stable iteration (Map insertion
 *  order) so determinism holds. */
function paletteToMarkdown(roles: Map<string, string>): string {
  if (roles.size === 0) return '_(palette empty)_';
  const lines: string[] = [];
  for (const [role, hex] of roles) {
    const display = role.split(/[\s-_]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    // NO colon inside `**Role**` — parser's first-pass regex requires the
    // role name capture to end before `**`; a colon inside the bold breaks
    // the regex and forces the parser onto its weaker context-heuristic
    // pass, which mis-reads "Text" / "Background" lines.
    lines.push(`- **${display}** \`${hex}\``);
  }
  return lines.join('\n');
}

function vocabToMarkdown(vocab: BrandVocabulary): string {
  // Mirrors serializer's vocab section format. Parser splits by
  // subsection HEADERS (### Power words / ### Industry terms / ### Style)
  // and reads bullet items beneath. Single-line `**Power words:** ...`
  // doesn't work — the bucket switches on the header but no body lines
  // follow it.
  const lines: string[] = [];
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
    // Parser regex for the Style subsection header is anchored
    // (^style\s*[:]?\s*$/i) — must be plain `Style:` on its own line,
    // NOT `### Style`.
    lines.push('Style:');
    if (typeof s.weight === 'number') lines.push(`- weight: ${s.weight}`);
    if (typeof s.color === 'string') lines.push(`- color: ${s.color}`);
    if (typeof s.decoration === 'string') lines.push(`- decoration: ${s.decoration}`);
  }
  return lines.length === 0 ? '_(vocabulary empty)_' : lines.join('\n').replace(/\n+$/, '');
}

function typographyToMarkdown(opts: {
  primaryFont?: string;
  secondaryFont?: string;
  scale?: number[];
}): string {
  const lines: string[] = [];
  if (opts.primaryFont) lines.push(`- **Display / headings:** \`${opts.primaryFont}\``);
  if (opts.secondaryFont) lines.push(`- **Body:** \`${opts.secondaryFont}\``);
  if (opts.scale && opts.scale.length > 0) {
    const sorted = [...opts.scale].sort((a, b) => a - b);
    lines.push(`- Scale (px): ${sorted.join(' · ')}`);
  }
  return lines.length === 0 ? '_(typography not yet declared)_' : lines.join('\n');
}

/**
 * Resolve which brand role a hex value represents. Reads the brand's
 * parsed palette and returns the role name on case-insensitive hex
 * match, normalising both `#abc` shorthand and `#aabbcc` long forms.
 *
 * Used by:
 *   - editToken (Pin #2) to decide whether to surgical-replace or
 *     fall back to full re-serialize
 *   - inspector hex-edit (Pin #4) to auto-infer tokenBindings when a
 *     designer picks a color that happens to match a brand role
 *
 * Returns null when no role matches — caller treats the value as
 * arbitrary / decoupled from brand semantics.
 */
export function getRoleForHex(
  projectDir: string,
  brandSlug: string,
  hex: string,
): string | null {
  if (!hex || !/^#[0-9a-fA-F]{3,8}$/.test(hex)) return null;
  const loaded = readBrandDesignMd(projectDir, brandSlug);
  if (!loaded) return null;
  const target = normalizeHex(hex);

  // Walk the raw DESIGN.md text first, scanning bullet lines that declare
  // a role. This matches what the workbench / inspector designer sees,
  // independent of which roles the parser's heuristic passes happened to
  // populate (parser's first-pass regex skips colon-inside-bold lines so
  // colors.roles is often a strict subset of what's actually declared).
  const lineRe = /^\s*[-*]\s*\*\*([^*]+?)\*\*[^`]*`(#[0-9a-fA-F]{3,8})`/gmi;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(loaded)) !== null) {
    if (normalizeHex(m[2]) !== target) continue;
    // Strip trailing colon, slash-aliases (e.g. "Display / headings"),
    // whitespace. Lowercase + collapse spaces to dashes for stable
    // role-name comparison.
    const role = m[1].trim().replace(/:$/, '').trim();
    return role.toLowerCase().replace(/\s+/g, '-');
  }

  // Fallback: parser-populated roles map. Some fixtures (etalon JSON
  // re-imports) carry roles via the second-pass / fallback paths that
  // never matched a bullet anchor — those still resolve here.
  const ds = parseDesignMd(loaded);
  if (ds.colors.roles) {
    for (const [role, roleHex] of ds.colors.roles) {
      if (normalizeHex(roleHex) === target) return role;
    }
  }
  return null;
}

function normalizeHex(hex: string): string {
  let h = hex.toLowerCase().trim();
  // #abc → #aabbcc expansion. Long forms stay unchanged.
  if (/^#[0-9a-f]{3}$/.test(h)) {
    h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }
  return h;
}

/**
 * Edit one role's hex value.
 *
 * Phase 3 Brief 3c Pin #2 — routing decision:
 *   - Existing role + hex change only → replaceHexInPlace (preserves
 *     every untouched line byte-identical, including comments,
 *     ADAPT markers, prose descriptions). 95% of designer flow.
 *   - New role addition → fall to writeAndReparse (Brief 3b path),
 *     accepting the lossy section-rewrite for this rare case.
 *   - Hex unchanged → no write, return the existing DS.
 */
export function editToken(
  projectDir: string,
  brandSlug: string,
  role: string,
  newHex: string,
): EditResult {
  if (!/^#[0-9a-fA-F]{3,8}$/.test(newHex)) {
    throw new Error(`invalid hex: ${newHex}`);
  }
  const loaded = readBrandDesignMd(projectDir, brandSlug);
  if (!loaded) throw new Error(`brand ${brandSlug} not found`);
  const dsBefore = parseDesignMd(loaded);
  const normalizedNew = newHex.toLowerCase();

  // Always attempt replaceHexInPlace first — it operates on the raw text
  // and finds the bullet anchor regardless of whether the parser's
  // heuristic palette extraction ended up populating colors.roles for
  // this role. (Parser's first-pass regex skips colon-inside-bold lines
  // like `**Accent:**`, so for many fixtures the roles map is sparser
  // than the actual file content.)
  const inPlace = replaceHexInPlace(loaded, role, normalizedNew);

  let newDs: DesignSystem;
  let oldHex: string | null;

  if (inPlace.replaced) {
    oldHex = inPlace.oldHex ?? null;
    if (oldHex && normalizeHex(oldHex) === normalizeHex(normalizedNew)) {
      // No-op: hex unchanged. Don't touch disk.
      newDs = dsBefore;
    } else {
      const file = join(brandsDir(projectDir), brandSlug, 'DESIGN.md');
      writeFileSync(file, inPlace.text, 'utf-8');
      newDs = parseDesignMd(inPlace.text);
    }
  } else {
    // No bullet anchor found — this is a new-role addition. Brief 3b
    // structural path: re-emit the palette section (lossy on heuristic-
    // detected roles the parser couldn't anchor, accepted for this rare
    // flow per Pin #7 honest framing).
    oldHex = dsBefore.colors.roles?.get(role) ?? null;
    newDs = fullSerializeFallback(projectDir, brandSlug, dsBefore, role, normalizedNew);
  }

  const skillContext = skillInvocationContext({ brandSlug });
  return {
    ok: true,
    ds: newDs,
    skillContext: {
      ...skillContext,
      changeType: 'token-edit',
      changedFields: { role, oldHex, newHex: normalizedNew },
    },
  };
}

function fullSerializeFallback(
  projectDir: string,
  brandSlug: string,
  ds: DesignSystem,
  role: string,
  newHex: string,
): DesignSystem {
  if (!ds.colors.roles) ds.colors.roles = new Map();
  ds.colors.roles.set(role, newHex);
  const lower = role.toLowerCase();
  if (lower === 'primary') ds.colors.primary = newHex;
  if (lower === 'background' || lower === 'bg') ds.colors.background = newHex;
  if (lower === 'text' || lower === 'foreground') ds.colors.text = newHex;
  if (lower === 'accent') ds.colors.accent = newHex;
  const newBody = paletteToMarkdown(ds.colors.roles);
  const { ds: newDs } = writeAndReparse(projectDir, brandSlug, ['color', 'palette'], newBody);
  return newDs;
}

/**
 * Patch the brand vocabulary. Pass partial fields — power-words and
 * industry-terms are arrays (full replacement, not append-merge so the
 * UI can implement remove via "send the new array minus the removed
 * pill"). Style is a Partial<style> merged onto the existing record.
 */
export function editVocab(
  projectDir: string,
  brandSlug: string,
  patch: Partial<BrandVocabulary>,
): EditResult {
  const loaded = readBrandDesignMd(projectDir, brandSlug);
  if (!loaded) throw new Error(`brand ${brandSlug} not found`);
  const ds = parseDesignMd(loaded);
  const current: BrandVocabulary = ds.vocabulary ?? {
    powerWords: [],
    industryTerms: [],
    style: { weight: 600, color: 'accent', decoration: 'none' },
  };
  const merged: BrandVocabulary = {
    powerWords: patch.powerWords ?? current.powerWords,
    industryTerms: patch.industryTerms ?? current.industryTerms,
    style: { ...current.style, ...(patch.style ?? {}) },
  };
  ds.vocabulary = merged;
  const newBody = vocabToMarkdown(merged);
  const { ds: newDs } = writeAndReparse(
    projectDir,
    brandSlug,
    ['brand vocabulary', 'vocabulary', 'voice'],
    newBody,
  );
  const skillContext = skillInvocationContext({ brandSlug });
  return {
    ok: true,
    ds: newDs,
    skillContext: {
      ...skillContext,
      changeType: 'vocab-edit',
      changedFields: { ...patch },
    },
  };
}

/**
 * Edit typography fields — primaryFont (display/headings stack),
 * secondaryFont (body stack), and the size scale array. Other typography
 * fields (line-height, letter-spacing, hierarchy rules) stay locked
 * behind Phase 3c — the UI surface for those isn't in scope for 3b.
 */
export function editTypography(
  projectDir: string,
  brandSlug: string,
  patch: { primaryFont?: string; secondaryFont?: string; scale?: number[] },
): EditResult {
  const loaded = readBrandDesignMd(projectDir, brandSlug);
  if (!loaded) throw new Error(`brand ${brandSlug} not found`);
  const ds = parseDesignMd(loaded);
  const next = {
    primaryFont: patch.primaryFont ?? ds.typography.primaryFont,
    secondaryFont: patch.secondaryFont ?? ds.typography.secondaryFont,
    scale: patch.scale ?? ds.typography.allSizes,
  };
  ds.typography.primaryFont = next.primaryFont;
  ds.typography.secondaryFont = next.secondaryFont;
  ds.typography.allSizes = next.scale;
  const newBody = typographyToMarkdown(next);
  const { ds: newDs } = writeAndReparse(
    projectDir,
    brandSlug,
    ['typography', 'type', 'font'],
    newBody,
  );
  const skillContext = skillInvocationContext({ brandSlug });
  return {
    ok: true,
    ds: newDs,
    skillContext: {
      ...skillContext,
      changeType: 'typography-edit',
      changedFields: { ...patch },
    },
  };
}

/**
 * Phase 3.5 skill-bus context builder. Foundation hook only — collects
 * scope; the bus that consumes it lands in Phase 3.5. Wiring this now
 * means brand workbench skill affordances ("/vocalise", "/verify-fidelity",
 * "/extract from URL") have a stable shape to land into when the bus
 * arrives. Nothing in Brief 3a invokes a skill via this; it's a marker
 * for retroactive integration.
 */
export function skillInvocationContext(opts: {
  brandSlug: string;
  activeSceneId?: string;
  selectedTokens?: string[];
}): SkillContext {
  return {
    brandSlug: opts.brandSlug,
    activeSceneId: opts.activeSceneId,
    selectedTokens: opts.selectedTokens,
  };
}
