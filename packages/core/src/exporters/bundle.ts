/**
 * Single-file portable HTML bundle.
 *
 * Goal: user downloads one .html, opens in any browser, scene renders
 * fully without external requests. Foundation for #20 stateful prototype,
 * #26 always-on tweaks, #6 thumbnail.
 *
 * ─── Format ─────────────────────────────────────────────────
 *
 * Plain HTML. NO gzip — that's a transport-layer concern (server
 * Content-Encoding); browsers don't decompress arbitrary gzip from a
 * .html file. Output is debug-readable text with base64'd fonts and
 * images embedded inline.
 *
 * ─── Pipeline ───────────────────────────────────────────────
 *
 *   1. exportToHtml(scene) — produce full HTML doc (existing exporter
 *      already collects used (family, weight) via SceneGraph walk and
 *      requests only those weights from Google Fonts URL).
 *   2. Walk SceneGraph for TEXT nodes — collect (family, weight, style)
 *      tuples as a SAFETY NET for user-imported HTML carrying a
 *      kitchen-sink Google Fonts link (`wght@100;200;...;900`). Used as
 *      a subset filter in the font inliner.
 *   3. Find <link href="https://fonts.googleapis.com/..."> entries.
 *      For each: fetch CSS, filter @font-face by used variants, fetch
 *      each woff2, base64 + emit @font-face with data URI, replace the
 *      <link> with the resulting <style> block. SRI / crossorigin attrs
 *      were on the original <link> — they vanish along with it (the
 *      replacement <style> doesn't carry them, and anything we leave
 *      external retains its integrity untouched).
 *   4. Walk HTML for image URLs (<img src> + style="...background-image:
 *      url(...)..."). Classify each: absolute → fetch + inline; relative
 *      / server-relative / blob → keep + warn; data → no-op.
 *   5. Return { html, warnings, inlinedAssets }.
 *
 * ─── Determinism ────────────────────────────────────────────
 *
 * Given stable network responses (mocked or cached), bundle(scene) twice
 * produces byte-identical output. Sources of stability:
 *   - SceneGraph traversal order is deterministic
 *   - per-call resource cache (same URL → same base64, regardless of
 *     reference count)
 *   - base64 encoding is deterministic from input bytes
 *   - @font-face block ordering: traversal order from the parsed CSS
 *     (Google Fonts response is itself deterministic for a given URL)
 *
 * ─── Annotations ────────────────────────────────────────────
 *
 * Annotations (#1) ride for free: html.ts already emits annotation
 * <span> overlays + the Caveat font link. Both flow through this
 * pipeline unchanged — Caveat gets inlined like any other Google font,
 * spans render exactly as in live mode.
 *
 * ─── No tweak slots ─────────────────────────────────────────
 *
 * Phase 0 emits a clean static bundle. #26 Always-on tweaks lands later
 * and extends bundle output by injecting <script> + <input> controls at
 * end of <body>. No reserved slots, placeholder comments, or "tweakable"
 * markers in this output — the extension just appends.
 */

import type { SceneGraph } from '../engine/scene-graph.js';
import { exportToHtml } from './html.js';
import {
  inlineGoogleFontCss,
  isGoogleFontUrl,
  type UsedVariant,
  type ResourceFetcher,
  type FontInlineResult,
} from './inline-fonts.js';
import { inlineImages } from './inline-images.js';
import { ANNOTATION_FONT } from '../engine/annotation.js';
import type { DesignSystem, TweakDef } from '../design-system/types.js';
import {
  generatePanelHtml,
  generatePanelCss,
  generateRootVarsCss,
  varNameForToken,
  type InitialValues,
} from './tweak-panel.js';
import { TWEAK_RUNTIME_SOURCE } from './tweak-runtime.js';

// ─── Public API ──────────────────────────────────────────────

export interface BundleOptions {
  /** Inline font @font-face data URIs. Default true. */
  inlineFonts?: boolean;
  /** Inline image data URIs. Default true. */
  inlineImages?: boolean;
  /** Fail (throw) on any fetch error vs best-effort warning. Default false. */
  failOnFetchError?: boolean;
  /** Per-resource fetch timeout in ms. Default 10s. */
  fetchTimeout?: number;
  /** Test override — deterministic mock fetcher. */
  fetcher?: ResourceFetcher;
  /**
   * Project root for the brand-mark special-case (Week 5 #21).
   * URLs matching /platform/api/brand/<slug>/mark/<variant> resolve from
   * `.reframe/brands/<slug>/marks/<variant>.svg` directly (no HTTP fetch).
   * Required when scenes reference brand marks; harmless when they don't.
   */
  projectDir?: string;
  /**
   * T2 #26 — emit an end-user tweak surface (sliders + color pickers
   * persisted via localStorage). Default false. When true:
   *   - reads `designSystem.tweakSurface` for the list of tweakable tokens
   *   - resolves each token's initial value from `designSystem`
   *   - emits a :root CSS var block with those initials
   *   - swaps inline style values with `var(...)` references where the
   *     literal value matches a tweakable token's initial value
   *   - injects floating panel HTML + scoped CSS + runtime IIFE
   *
   * Backward compat strict: tweakable=false (default) → byte-identical
   * to pre-#26 baseline. Tweakable=true on a brand without a `## Tweak
   * Surface` section → graceful no-op (warning logged, output identical
   * to non-tweakable bundle).
   */
  tweakable?: boolean;
  /**
   * Resolved DesignSystem to read tweakSurface defs + initial token
   * values from. Required when tweakable=true; ignored otherwise.
   * Caller (export.ts handler) loads + parses the brand DESIGN.md before
   * invoking the bundle exporter.
   */
  designSystem?: DesignSystem;
}

export interface BundleResult {
  html: string;
  warnings: string[];
  inlinedAssets: { fonts: number; images: number };
}

/**
 * Render a SceneGraph to a single-file portable HTML bundle.
 *
 * Async because the inliners issue network fetches for fonts and images.
 * Best-effort by default — failed fetches degrade gracefully and emit
 * warnings; the produced HTML still loads (with fallback chains for
 * fonts, external src for images).
 */
export async function exportSceneGraphToBundle(
  graph: SceneGraph,
  rootId: string,
  options: BundleOptions = {},
): Promise<BundleResult> {
  const inlineFontsOpt = options.inlineFonts !== false;
  const inlineImagesOpt = options.inlineImages !== false;

  // Step 1: produce full HTML via the existing exporter.
  // fullDoc:true gives us the complete <html><head><body> with the Google
  // Fonts <link> already emitted.
  const baseHtml = exportToHtml(graph, rootId, { fullDocument: true });

  let html = baseHtml;
  const warnings: string[] = [];
  let fontsInlined = 0;
  let imagesInlined = 0;

  // Step 2: collect used variants from SceneGraph as a safety subset
  // filter. html.ts already restricts via URL; this guards against
  // user-imported HTML whose Google Fonts <link> requests every weight.
  const usedVariants = inlineFontsOpt ? collectUsedVariants(graph, rootId) : [];

  // Step 3: font inlining.
  if (inlineFontsOpt) {
    const result = await inlineFontsInHtml(html, {
      usedVariants,
      fetcher: options.fetcher,
      fetchTimeout: options.fetchTimeout,
      failOnFetchError: options.failOnFetchError,
    });
    html = result.html;
    fontsInlined = result.facesEmitted;
    warnings.push(...result.warnings);
  }

  // Step 4: image inlining.
  if (inlineImagesOpt) {
    const result = await inlineImages(html, {
      fetcher: options.fetcher,
      fetchTimeout: options.fetchTimeout,
      failOnFetchError: options.failOnFetchError,
      projectDir: options.projectDir,
    });
    html = result.html;
    imagesInlined = result.inlinedCount;
    warnings.push(...result.warnings);
  }

  // Step 5 (T2 #26): tweakable surface — value→var substitution +
  // panel injection + runtime IIFE. Strictly opt-in; tweakable=false
  // (default) leaves output byte-identical to pre-#26 baseline.
  if (options.tweakable) {
    const result = applyTweakableSurface(html, options.designSystem);
    html = result.html;
    if (result.warning) warnings.push(result.warning);
  }

  return {
    html,
    warnings,
    inlinedAssets: { fonts: fontsInlined, images: imagesInlined },
  };
}

// ─── Tweak surface integration (T2 #26) ──────────────────────

/**
 * Resolve the initial value for a tokenPath against a DesignSystem.
 *
 * Phase 0 supported paths:
 *   color/<role>     → DesignSystem.colors.semantic[<role>]?.value (hex)
 *   radius/<role>    → DesignSystem.layout.borderRadiusScale (heuristic by role label)
 *   spacing/scale    → 1 (multiplier semantics — designer-defined)
 *
 * Returns `undefined` for paths the resolver can't map. Caller skips
 * those defs (with a warning), so a minor schema mismatch doesn't kill
 * the whole tweak panel.
 */
function resolveInitialValue(
  tokenPath: string,
  ds: DesignSystem | undefined,
): string | undefined {
  if (!ds) return undefined;
  const [domain, role] = tokenPath.split('/');
  if (!domain || !role) return undefined;

  if (domain === 'color') {
    const semantic = (ds.colors as any)?.semantic;
    if (semantic && semantic[role]?.value) {
      return String(semantic[role].value);
    }
    // Fallback — try `colors[role]` as a flat lookup.
    const flat = (ds.colors as any)?.[role];
    if (typeof flat === 'string') return flat;
    return undefined;
  }
  if (domain === 'radius') {
    // Resolve from borderRadiusScale by heuristic role mapping. Phase 0
    // picks the lower-median: for [4,8,12,16] it returns 8 (not 12),
    // matching designer convention where "medium" sits at the typical
    // card / button radius — usually the second-smallest entry of a
    // 4-step scale. Pill-radius outliers (>=200) filtered before pick.
    const scale = ds.layout?.borderRadiusScale;
    if (Array.isArray(scale) && scale.length > 0) {
      const sorted = [...scale].sort((a, b) => a - b);
      const usable = sorted.filter((n) => n < 200);
      const pool = usable.length > 0 ? usable : sorted;
      const mid = pool[Math.floor((pool.length - 1) / 2)];
      return String(mid);
    }
    return undefined;
  }
  if (domain === 'spacing' && role === 'scale') {
    // Multiplier semantics — 1.0 is "no change". Designer-defined.
    return '1';
  }
  return undefined;
}

interface TweakApplyResult {
  html: string;
  warning?: string;
}

function applyTweakableSurface(html: string, ds: DesignSystem | undefined): TweakApplyResult {
  const defs = ds?.tweakSurface;
  if (!defs || defs.length === 0) {
    return {
      html,
      warning:
        'tweakable=true but no `## Tweak Surface` section in DESIGN.md (or it parsed empty); ' +
        'bundle emitted without tweak panel — output identical to non-tweakable build.',
    };
  }

  // Resolve initial values per def. Drop defs we can't resolve (warn,
  // continue with the rest) — partial panel is more useful than no panel.
  const initial: InitialValues = {};
  const resolved: TweakDef[] = [];
  const skipped: string[] = [];
  for (const def of defs) {
    const value = resolveInitialValue(def.tokenPath, ds);
    if (value === undefined) {
      skipped.push(def.tokenPath);
      continue;
    }
    initial[def.tokenPath] = value;
    resolved.push(def);
  }
  if (resolved.length === 0) {
    return {
      html,
      warning:
        `tweakable=true: every tweak surface entry failed to resolve an initial value (${skipped.join(', ')}); ` +
        'bundle emitted without tweak panel.',
    };
  }

  // Build value-to-var substitution map. Each tweakable token's initial
  // value becomes the search key; var() reference is the replacement.
  // Phase 0 substitution is literal-string match inside style="..." attrs
  // and embedded <style> blocks.
  const rootCss = generateRootVarsCss(resolved, initial);
  const panelCss = generatePanelCss();
  const panelHtml = generatePanelHtml(resolved, initial);

  // Substitution — value-based literal replacement. We search inline
  // style attribute values + <style> block contents. Skipping the
  // <head> font links + base CSS keeps font URLs and antialiasing
  // settings untouched even if a token value happens to overlap.
  let mutated = html;
  for (const def of resolved) {
    const initialValue = initial[def.tokenPath];
    const varName = varNameForToken(def.tokenPath);
    const unit = def.type === 'range' ? (def.unit ?? '') : '';
    if (def.type === 'color' && /^#[0-9a-fA-F]{3,8}$/.test(initialValue)) {
      // Match the exact hex (case-insensitive, word-bounded by non-hex).
      // Use both lowercase and uppercase forms so designer-written
      // styles in either case get covered.
      const hexLower = initialValue.toLowerCase();
      const hexUpper = initialValue.toUpperCase();
      mutated = swapValueOccurrences(mutated, hexLower, `var(${varName}, ${hexLower})`);
      if (hexUpper !== hexLower) {
        mutated = swapValueOccurrences(mutated, hexUpper, `var(${varName}, ${hexUpper})`);
      }
    } else if (def.type === 'range') {
      const literal = `${initialValue}${unit}`;
      // Only substitute when the literal is non-trivial (not '1' / '0' / '0px'
      // alone — those would clobber unrelated values). Phase 0 heuristic:
      // require at least 2 chars OR a non-zero unit suffix.
      if (literal.length >= 2 && literal !== '0px' && literal !== '0') {
        mutated = swapValueOccurrences(mutated, literal, `var(${varName}, ${literal})`);
      }
    }
  }

  // Inject :root vars + panel CSS into the existing <style> block,
  // panel HTML + runtime <script> before </body>.
  // The base style is between the FIRST `<style>` after `<head>` and
  // its closing `</style>`. Append our blocks to that style content.
  const styleClose = mutated.indexOf('</style>');
  if (styleClose !== -1) {
    const insert = `\n${rootCss}${panelCss}`;
    mutated = mutated.slice(0, styleClose) + insert + mutated.slice(styleClose);
  }
  // Inject panel HTML + runtime IIFE before </body>. Both go together
  // so the runtime always finds the panel in the DOM.
  const bodyClose = mutated.lastIndexOf('</body>');
  if (bodyClose !== -1) {
    const insert = `\n${panelHtml}\n<script>${TWEAK_RUNTIME_SOURCE}</script>\n`;
    mutated = mutated.slice(0, bodyClose) + insert + mutated.slice(bodyClose);
  }

  const warning = skipped.length > 0
    ? `tweakable: ${skipped.length} tweak surface entr${skipped.length === 1 ? 'y' : 'ies'} failed to resolve initial value (${skipped.join(', ')}) — those controls omitted from panel.`
    : undefined;
  return { html: mutated, warning };
}

/**
 * Replace every occurrence of `needle` with `replacement` in `haystack`.
 * Plain string replace (no regex) — needle treated as literal. Used for
 * value substitution in tweakable bundles; intentionally simple — Phase 0
 * takes the corpus risk of accidental match (e.g. a hex color string
 * appearing as a non-style coincidence) in exchange for not building a
 * full CSS parser. Future Variant 2 schema-driven controls will replace
 * this with structural substitution against parsed style attrs.
 */
function swapValueOccurrences(haystack: string, needle: string, replacement: string): string {
  // Avoid ReDoS / regex escaping by using split+join — O(n) on string length.
  return haystack.split(needle).join(replacement);
}

// ─── Variant walker ──────────────────────────────────────────

/**
 * Walk SceneGraph TEXT nodes, collect (family, weight, style) tuples.
 *
 * Normalization (Refinement 1):
 *   - fontWeight: 'bold' → 700, 'normal' / absent → 400, numeric pass-through
 *   - italic boolean → 'italic' / 'normal' style
 *
 * Scene-level annotations always include Caveat @ 500 (hard-coded by
 * html.ts annotation emission), but ONLY if scene actually has annotations.
 * Skip Caveat entirely otherwise.
 */
export function collectUsedVariants(graph: SceneGraph, rootId: string): UsedVariant[] {
  const set = new Map<string, UsedVariant>();
  const key = (v: UsedVariant) => `${v.family}|${v.weight}|${v.style}`;

  function walk(id: string): void {
    const n = graph.getNode(id);
    if (!n) return;
    if (n.type === 'TEXT' && n.fontFamily) {
      const v = normalizeVariant({
        family: n.fontFamily,
        weight: (n as any).fontWeight,
        italic: (n as any).italic,
      });
      set.set(key(v), v);
    }
    if (n.childIds?.length) for (const c of n.childIds) walk(c);
  }
  walk(rootId);

  // Annotation font (Caveat 500 today) — only when scene has annotations.
  // Family/weight/style from the canonical engine binding so changes there
  // propagate without hand-syncing this file.
  if (graph.annotations && graph.annotations.length > 0) {
    const annoFont: UsedVariant = {
      family: ANNOTATION_FONT.family,
      weight: ANNOTATION_FONT.weight,
      style: ANNOTATION_FONT.style,
    };
    set.set(key(annoFont), annoFont);
  }

  return [...set.values()];
}

function normalizeVariant(input: {
  family: string;
  weight?: number | string;
  italic?: boolean;
}): UsedVariant {
  let weight: number;
  if (typeof input.weight === 'number') weight = input.weight;
  else if (input.weight === 'bold') weight = 700;
  else if (input.weight === 'normal' || input.weight === undefined || input.weight === null) weight = 400;
  else {
    const parsed = parseInt(String(input.weight), 10);
    weight = Number.isFinite(parsed) ? parsed : 400;
  }
  const style: 'normal' | 'italic' = input.italic ? 'italic' : 'normal';
  return { family: input.family, weight, style };
}

// ─── Font link replacement ───────────────────────────────────

/**
 * Find every Google Fonts <link href="https://fonts.googleapis.com/..."
 * rel="stylesheet"> in the HTML, fetch + inline, replace each with the
 * resulting <style> block. Non-Google CDN <link>s log a warning and stay
 * as external links (no break, just no inline benefit).
 *
 * Also drops <link rel="preconnect" href="https://fonts.gstatic.com|googleapis.com">
 * elements — they're hints for external CDN, irrelevant once content is
 * inline. Leaving them wouldn't break anything but would be dead markup.
 */
async function inlineFontsInHtml(
  html: string,
  opts: {
    usedVariants: UsedVariant[];
    fetcher?: ResourceFetcher;
    fetchTimeout?: number;
    failOnFetchError?: boolean;
  },
): Promise<{ html: string; facesEmitted: number; warnings: string[] }> {
  const warnings: string[] = [];
  let facesEmitted = 0;
  let out = html;

  // Match a stylesheet <link> that points at fonts.googleapis.com — must
  // carry an actual CSS path (`/css2?...`), not a bare hostname (which is
  // what `rel="preconnect"` hints use). Filtering by URL pathname is more
  // robust than requiring `rel="stylesheet"` which may be omitted.
  const linkRe = /<link\s+([^>]*?)href\s*=\s*"(https:\/\/fonts\.googleapis\.com\/css2?[^"]*)"([^>]*)>/gi;
  // Find all matches first (regex iteration + collect), then resolve in
  // sequence + apply replacements deterministically.
  const matches: Array<{ full: string; pre: string; href: string; post: string }> = [];
  let m: RegExpExecArray | null;
  linkRe.lastIndex = 0;
  while ((m = linkRe.exec(html)) !== null) {
    matches.push({ full: m[0], pre: m[1], href: m[2], post: m[3] });
  }

  for (const match of matches) {
    if (!isGoogleFontUrl(match.href)) {
      warnings.push(`Skipping non-Google font CDN link: ${match.href}`);
      continue;
    }
    const result: FontInlineResult = await inlineGoogleFontCss(match.href, {
      usedVariants: opts.usedVariants,
      fetcher: opts.fetcher,
      fetchTimeout: opts.fetchTimeout,
      failOnFetchError: opts.failOnFetchError,
    });
    facesEmitted += result.facesEmitted;
    warnings.push(...result.warnings);
    // Replace the original <link> with the inlined <style> (or empty if
    // every fetch failed — fallback chain handles render).
    out = out.split(match.full).join(result.styleBlock);
  }

  // Drop now-orphan <link rel="preconnect" href="https://fonts.gstatic.com">
  // and "https://fonts.googleapis.com" elements — they're hints for the
  // external CDN, redundant once everything is inline.
  out = out.replace(
    /<link\s+[^>]*rel\s*=\s*"preconnect"[^>]*href\s*=\s*"https:\/\/fonts\.(?:gstatic|googleapis)\.com"[^>]*>/gi,
    '',
  );
  // Same with rel/href in reversed attribute order.
  out = out.replace(
    /<link\s+[^>]*href\s*=\s*"https:\/\/fonts\.(?:gstatic|googleapis)\.com"[^>]*rel\s*=\s*"preconnect"[^>]*>/gi,
    '',
  );

  return { html: out, facesEmitted, warnings };
}

// ─── Re-export for callers that want the variant walker directly ─
export type { UsedVariant } from './inline-fonts.js';
